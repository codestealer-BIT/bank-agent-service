import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import {
  LettaAgentClient,
  type BootstrapStateOptions,
  type BootstrapStateResult,
  type LettaCodeClientSessionOptions,
  type LettaCodeSession,
  type RecoverPendingApprovalsOptions,
  type RecoverPendingApprovalsResult,
  type RunTurnOptions,
  type SDKResultMessage,
} from "@letta-ai/letta-agent-sdk";
import { config } from "./config.js";
import { pool } from "./database.js";
import {
  withDistributedLock,
  withGlobalTurnSlot,
} from "./redis-leases.js";
import {
  APPROVAL_RECOVERY_TIMEOUT_MS,
  ApprovalConflictError,
  MAX_APPROVAL_RECOVERY_ATTEMPTS,
  resolveHeadlessToolApproval,
} from "./letta-session-policy.js";

const client = new LettaAgentClient({
  backend: "local",
  appServer: {
    harnessBackend: "local",
    requestTimeoutMs: config.LETTA_REQUEST_TIMEOUT_MS,
    startupTimeoutMs: 60_000,
  },
});

// SDK 0.2.6 implements these helpers on local sessions, but its public
// LettaCodeSession interface does not yet declare them.
type RecoverableTurnSession = LettaCodeSession & {
  bootstrapState(options?: BootstrapStateOptions): Promise<BootstrapStateResult>;
  recoverPendingApprovals(
    options?: RecoverPendingApprovalsOptions,
  ): Promise<RecoverPendingApprovalsResult>;
  runTurn(
    message: string,
    options?: RunTurnOptions,
  ): Promise<SDKResultMessage>;
};

function stripHiddenReasoning(value: string): string {
  return value.replace(/<think>[\s\S]*?<\/think>\s*/gi, "").trim();
}

async function createIsolatedUserAgent(userId: string): Promise<string> {
  return client.createAgent({
    model: config.AGENT_MODEL,
    name: `${config.AGENT_NAME}-${userId.slice(0, 12)}`,
    description: "A private, persistent bank assistant for exactly one user.",
    persona: [
      "You are a careful internal banking assistant.",
      "Treat all user and bank data as confidential.",
      "Never claim that one user's information belongs to another user.",
      "Use memory_apply_patch for stable preferences, durable facts, and reusable lessons when they are genuinely useful.",
      "Do not use shell, network, code-execution, or project-file tools. This service is a chat assistant, not a coding workspace.",
      "Do not store passwords, API keys, authentication codes, card PINs, or full account numbers in memory.",
    ].join("\n"),
    human: `This agent belongs only to opaque bank user ${userId}.`,
    memfs: true,
    baseTools: [],
    permissionMode: "standard",
    skillSources: [],
    cwd: "/workspace",
  });
}

export async function getOrCreateUserAgent(userId: string): Promise<string> {
  const existing = await pool.query<{ agent_id: string }>(
    "SELECT agent_id FROM user_agents WHERE user_id = $1",
    [userId],
  );
  if (existing.rowCount) return existing.rows[0].agent_id;

  return withDistributedLock(
    `provision-user:${userId}`,
    async () => {
      const afterLock = await pool.query<{ agent_id: string }>(
        "SELECT agent_id FROM user_agents WHERE user_id = $1",
        [userId],
      );
      if (afterLock.rowCount) return afterLock.rows[0].agent_id;

      const agentId = await createIsolatedUserAgent(userId);
      await pool.query(
        "INSERT INTO user_agents(user_id, agent_id) VALUES ($1, $2)",
        [userId, agentId],
      );
      return agentId;
    },
    { timeoutMs: 120_000 },
  );
}

export async function runConversationTurn(input: {
  userId: string;
  agentId: string;
  lettaConversationId: string | null;
  message: string;
}): Promise<{
  answer: string;
  lettaConversationId: string;
  durationMs: number;
}> {
  // A Letta agent can retain approval state across conversations. Serialize all
  // turns for one agent, not just turns within one application conversation.
  return withDistributedLock(`agent-turn:${input.agentId}`, () =>
    withGlobalTurnSlot(async () => {
      const sessionOptions: LettaCodeClientSessionOptions = {
        permissionMode: "standard",
        skillSources: [],
        cwd: "/workspace",
        canUseTool: (toolName: string) =>
          resolveHeadlessToolApproval(toolName),
        maxApprovalRecoveryAttempts: MAX_APPROVAL_RECOVERY_ATTEMPTS,
        approvalRecoveryTimeoutMs: APPROVAL_RECOVERY_TIMEOUT_MS,
      };
      const session = (input.lettaConversationId
        ? client.resumeSession(input.lettaConversationId, sessionOptions)
        : client.createSession(
            input.agentId,
            sessionOptions,
          )) as RecoverableTurnSession;

      try {
        // Pending approvals are persistent conversation state. Recover them
        // before sending so the user's message is not submitted twice by a
        // conflict-then-retry cycle.
        const state = await session.bootstrapState({ limit: 1 });
        if (state.hasPendingApproval === true) {
          const recovery = await session.recoverPendingApprovals({
            timeoutMs: APPROVAL_RECOVERY_TIMEOUT_MS,
          });
          if (!recovery.recovered) {
            throw new ApprovalConflictError(recovery.detail);
          }
        }

        const result = await session.runTurn(input.message, {
          maxApprovalRecoveryAttempts: MAX_APPROVAL_RECOVERY_ATTEMPTS,
          recoveryTimeoutMs: APPROVAL_RECOVERY_TIMEOUT_MS,
        });
        if (!result.success) {
          if (
            result.approvalConflict === true ||
            result.errorCode === "approval_conflict" ||
            result.errorCode === "approval_conflict_terminal"
          ) {
            throw new ApprovalConflictError(
              result.errorDetail ?? result.error ?? result.stopReason,
            );
          }
          throw new Error(
            result.errorDetail ??
              result.error ??
              result.stopReason ??
              "Agent turn failed",
          );
        }
        const conversationId = result.conversationId ?? session.conversationId;
        if (!conversationId) {
          throw new Error("Letta did not return a conversation id");
        }
        return {
          answer: stripHiddenReasoning(result.result ?? ""),
          lettaConversationId: conversationId,
          durationMs: result.durationMs,
        };
      } finally {
        session.close();
      }
    }),
  );
}

async function listMarkdownFiles(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolute = join(current, entry.name);
    if (entry.isDirectory() && entry.name !== ".git") {
      files.push(...(await listMarkdownFiles(root, absolute)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(relative(root, absolute).replaceAll("\\", "/"));
    }
  }
  return files.sort();
}

export async function readUserMemory(agentId: string): Promise<
  Array<{ path: string; content: string }>
> {
  const root = join(config.LETTA_LOCAL_BACKEND_DIR, "memfs", agentId, "memory");
  const paths = await listMarkdownFiles(root);
  return Promise.all(
    paths.map(async (path) => ({
      path,
      content: await readFile(join(root, path), "utf8"),
    })),
  );
}
