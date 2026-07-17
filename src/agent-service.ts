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
import { createOperationsTools } from "./agent-tools.js";
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
  updateToolset(toolsetPreference: string): Promise<void>;
};

function stripHiddenReasoning(value: string): string {
  return value.replace(/<think>[\s\S]*?<\/think>\s*/gi, "").trim();
}

async function createSharedOperationsAgent(): Promise<string> {
  return client.createAgent({
    model: config.AGENT_MODEL,
    name: config.AGENT_NAME,
    description:
      "A shared operations assistant for the bank infrastructure demo.",
    persona: [
      "You are a careful bank infrastructure operations assistant used by multiple employees.",
      "Each conversation is private conversation context even though all conversations share one agent.",
      "Use the infrastructure query tools for machine counts, datacenter information, machine status, and alerts. Never invent operational data when a tool can answer.",
      "Do not expose one conversation's user-specific content in another conversation.",
      "Do not write directly to MemFS during normal chat turns.",
      "Only call submit_shared_knowledge_candidate when a conversation produced a reusable, verified problem-solving lesson that contains no personal information, credentials, secrets, customer data, or raw conversation text.",
      "Do not use shell, network, code-execution, or project-file tools.",
    ].join("\n"),
    human:
      "Users are authenticated by the host application and may each create multiple private conversations.",
    memfs: true,
    baseTools: [],
    permissionMode: "unrestricted",
    skillSources: [],
    cwd: "/workspace",
  });
}

export async function getOrCreateUserAgent(userId: string): Promise<string> {
  const existing = await pool.query<{ agent_id: string }>(
    "SELECT agent_id FROM shared_agents WHERE scope = $1",
    [config.SHARED_AGENT_SCOPE],
  );
  let agentId = existing.rows[0]?.agent_id;

  if (!agentId) {
    agentId = await withDistributedLock(
      `provision-shared-agent:${config.SHARED_AGENT_SCOPE}`,
      async () => {
        const afterLock = await pool.query<{ agent_id: string }>(
          "SELECT agent_id FROM shared_agents WHERE scope = $1",
          [config.SHARED_AGENT_SCOPE],
        );
        if (afterLock.rowCount) return afterLock.rows[0].agent_id;

        const createdAgentId = await createSharedOperationsAgent();
        await pool.query(
          "INSERT INTO shared_agents(scope, agent_id) VALUES ($1, $2)",
          [config.SHARED_AGENT_SCOPE, createdAgentId],
        );
        return createdAgentId;
      },
      { timeoutMs: 120_000 },
    );
  }

  await pool.query(
    `INSERT INTO user_agents(user_id, agent_id)
     VALUES ($1, $2)
     ON CONFLICT (user_id)
     DO UPDATE SET agent_id = EXCLUDED.agent_id`,
    [userId, agentId],
  );
  await pool.query(
    "UPDATE user_agents SET agent_id = $1 WHERE agent_id <> $1",
    [agentId],
  );
  return agentId;
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
  // The route serializes each conversation. Shared MemFS writes are disabled
  // during normal turns, so different conversations can run concurrently.
  return withGlobalTurnSlot(async () => {
    const sessionOptions: LettaCodeClientSessionOptions = {
      permissionMode: "unrestricted",
      skillSources: [],
      cwd: "/workspace",
      canUseTool: (toolName: string) =>
        resolveHeadlessToolApproval(toolName),
      maxApprovalRecoveryAttempts: MAX_APPROVAL_RECOVERY_ATTEMPTS,
      approvalRecoveryTimeoutMs: APPROVAL_RECOVERY_TIMEOUT_MS,
      tools: createOperationsTools(input.userId),
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
      // The local App Server does not support per-session allowedTools yet.
      // Disabling the built-in harness toolset leaves only the SDK-registered
      // infrastructure tools available for this session.
      await session.updateToolset("none");
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
  });
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
