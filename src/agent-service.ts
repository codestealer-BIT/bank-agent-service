import {
  extractStreamTextDelta,
  LettaAgentClient,
  type BootstrapStateOptions,
  type BootstrapStateResult,
  type LettaCodeClientSessionOptions,
  type LettaCodeSession,
  type RecoverPendingApprovalsOptions,
  type RecoverPendingApprovalsResult,
  type RunTurnOptions,
  type SDKMessage,
  type SDKResultMessage,
  type MessageContentItem,
  type SendMessage,
} from "@letta-ai/letta-agent-sdk";
import { config } from "./config.js";
import { createOperationsTools } from "./agent-tools.js";
import { pool } from "./database.js";
import {
  formatMemoryContext,
  readVisibleMemory,
  searchMemory,
} from "./memory-service.js";
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
import { userFacingAnswer } from "./response-policy.js";

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
    message: SendMessage,
    options?: RunTurnOptions,
  ): Promise<SDKResultMessage>;
  updateToolset(toolsetPreference: string): Promise<void>;
};

function stripHiddenReasoning(value: string): string {
  return value.replace(/<think>[\s\S]*?<\/think>\s*/gi, "").trim();
}

function visibleStreamingText(value: string): string {
  const withoutClosedThinking = value.replace(/<think>[\s\S]*?<\/think>\s*/gi, "");
  const openThinkingIndex = withoutClosedThinking.search(/<think>/i);
  return openThinkingIndex >= 0
    ? withoutClosedThinking.slice(0, openThinkingIndex)
    : withoutClosedThinking;
}

function resultError(result: SDKResultMessage): Error {
  if (
    result.approvalConflict === true ||
    result.errorCode === "approval_conflict" ||
    result.errorCode === "approval_conflict_terminal"
  ) {
    return new ApprovalConflictError(
      result.errorDetail ?? result.error ?? result.stopReason,
    );
  }
  return new Error(
    result.errorDetail ??
      result.error ??
      result.stopReason ??
      "Agent turn failed",
  );
}

async function createSharedOperationsAgent(): Promise<string> {
  return client.createAgent({
    model: config.AGENT_MODEL,
    name: config.AGENT_NAME,
    description:
      "A shared operations assistant for the bank infrastructure demo.",
    persona: [
      "You are a careful bank infrastructure operations assistant used by multiple employees.",
      "Each conversation is private conversation context even though all conversations share one top-level agent.",
      "Long-term memory is stored in MemFS. User-specific memory lives under the current authenticated user's private memory area; shared operations lessons live under shared memory.",
      "Use the infrastructure query tools for machine counts, datacenter information, machine status, and alerts. Never invent operational data when a tool can answer.",
      "Do not expose one conversation's user-specific content in another conversation.",
      "Use memory_search when a question may relate to remembered preferences, prior work context, or reusable operations knowledge.",
      "Use memory_save during normal chat when the user reveals a durable preference, identity fact, work context, or verified reusable lesson worth remembering. Keep memories concise and generalized.",
      "Use private memory for user-specific facts and preferences. Use shared memory only for reusable bank operations lessons that contain no private data.",
      "The only approved outbound action is send_email. Call it only when the user explicitly requests an email or a schedule explicitly requires an emailed report, and call it at most once per turn.",
      "Never put passwords, authorization codes, keys, customer data, or other sensitive information in an email.",
      "Only call submit_shared_knowledge_candidate when a conversation produced a reusable, verified problem-solving lesson that contains no personal information, credentials, secrets, customer data, or raw conversation text.",
      "Memory writes and shared-knowledge submissions are silent backend maintenance. Do not mention tool names, MemFS paths, candidate IDs, review queues, review status, memory scopes, or background reflection in a user-facing answer unless the user explicitly asks about system internals.",
      "After silently maintaining memory or submitting a knowledge candidate, answer only the user's business question. Do not announce that anything was remembered, submitted, queued, or stored.",
      "Do not use shell, arbitrary network, code-execution, or project-file tools.",
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

async function buildRuntimeMessage(input: {
  userId: string;
  agentId: string;
  message: string;
  attachments?: TurnAttachment[];
}): Promise<SendMessage> {
  const memoryContext = formatMemoryContext(
    await searchMemory({
      agentId: input.agentId,
      userId: input.userId,
      query: input.message,
      limit: 5,
    }),
  );
  const policy = [
    "Runtime memory policy for this banking web app:",
    "- You may call memory_search when remembered context may help.",
    "- You may call memory_save when the user reveals durable preferences, stable work context, or verified reusable operations lessons.",
    "- Use private memory for user-specific facts. Use shared memory only for non-private reusable operations lessons.",
    "- Never save secrets, credentials, authorization codes, customer data, or raw transcripts.",
    "- Memory and knowledge-governance actions are silent backend maintenance. Never mention tool names, MemFS, candidate IDs, review queues, review status, memory scopes, or background reflection unless the user explicitly asks about system internals.",
    "- After an internal memory or knowledge action, answer only the business question; do not announce that anything was remembered, submitted, queued, or stored.",
  ];
  const textMessage = memoryContext
    ? [
        ...policy,
        "",
        "<LONG_TERM_MEMORY_CONTEXT>",
        memoryContext,
        "</LONG_TERM_MEMORY_CONTEXT>",
        "",
        "Use the memory context only when it is relevant. Do not reveal memory paths unless the user asks how memory was used.",
        "",
        input.message,
      ].join("\n")
    : [...policy, "", input.message].join("\n");

  return buildTurnMessage(textMessage, input.attachments ?? []);
}

export async function runConversationTurn(input: {
  userId: string;
  agentId: string;
  lettaConversationId: string | null;
  message: string;
  attachments?: TurnAttachment[];
  emailRecipient?: string | null;
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
      tools: createOperationsTools(input.userId, input.agentId, {
        emailRecipient: input.emailRecipient,
      }),
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

      const message = await buildRuntimeMessage(input);

      const result = await session.runTurn(message, {
        maxApprovalRecoveryAttempts: MAX_APPROVAL_RECOVERY_ATTEMPTS,
        recoveryTimeoutMs: APPROVAL_RECOVERY_TIMEOUT_MS,
      });
      if (!result.success) {
        throw resultError(result);
      }
      const conversationId = result.conversationId ?? session.conversationId;
      if (!conversationId) {
        throw new Error("Letta did not return a conversation id");
      }
      return {
        answer: userFacingAnswer(
          stripHiddenReasoning(result.result ?? ""),
          input.message,
        ),
        lettaConversationId: conversationId,
        durationMs: result.durationMs,
      };
    } finally {
      session.close();
    }
  });
}

export async function streamConversationTurn(
  input: {
    userId: string;
    agentId: string;
    lettaConversationId: string | null;
    message: string;
    attachments?: TurnAttachment[];
    emailRecipient?: string | null;
  },
  onDelta: (delta: string) => void | Promise<void>,
): Promise<{
  answer: string;
  lettaConversationId: string;
  durationMs: number;
}> {
  return withGlobalTurnSlot(async () => {
    const sessionOptions: LettaCodeClientSessionOptions = {
      permissionMode: "unrestricted",
      skillSources: [],
      cwd: "/workspace",
      canUseTool: (toolName: string) =>
        resolveHeadlessToolApproval(toolName),
      maxApprovalRecoveryAttempts: MAX_APPROVAL_RECOVERY_ATTEMPTS,
      approvalRecoveryTimeoutMs: APPROVAL_RECOVERY_TIMEOUT_MS,
      tools: createOperationsTools(input.userId, input.agentId, {
        emailRecipient: input.emailRecipient,
      }),
    };
    const session = (input.lettaConversationId
      ? client.resumeSession(input.lettaConversationId, sessionOptions)
      : client.createSession(
          input.agentId,
          sessionOptions,
        )) as RecoverableTurnSession;

    try {
      const state = await session.bootstrapState({ limit: 1 });
      await session.updateToolset("none");
      if (state.hasPendingApproval === true) {
        const recovery = await session.recoverPendingApprovals({
          timeoutMs: APPROVAL_RECOVERY_TIMEOUT_MS,
        });
        if (!recovery.recovered) {
          throw new ApprovalConflictError(recovery.detail);
        }
      }

      const message = await buildRuntimeMessage(input);
      const startedAt = performance.now();
      await session.send(message);

      let finalResult: SDKResultMessage | null = null;
      let rawAssistantText = "";
      let emittedVisibleText = "";

      for await (const sdkMessage of session.stream() as AsyncGenerator<SDKMessage>) {
        if (sdkMessage.type === "stream_event") {
          const delta = extractStreamTextDelta(sdkMessage.event);
          if (delta?.kind === "assistant" && delta.text) {
            rawAssistantText += delta.text;
            const nextVisibleText = visibleStreamingText(rawAssistantText);
            const visibleDelta = nextVisibleText.slice(emittedVisibleText.length);
            if (visibleDelta) {
              emittedVisibleText = nextVisibleText;
              await onDelta(visibleDelta);
            }
          }
          continue;
        }
        if (sdkMessage.type === "assistant" && sdkMessage.content) {
          rawAssistantText += sdkMessage.content;
          const nextVisibleText = visibleStreamingText(rawAssistantText);
          const visibleDelta = nextVisibleText.slice(emittedVisibleText.length);
          if (visibleDelta) {
            emittedVisibleText = nextVisibleText;
            await onDelta(visibleDelta);
          }
          continue;
        }
        if (sdkMessage.type === "result") {
          finalResult = sdkMessage;
          break;
        }
        if (sdkMessage.type === "error") {
          throw new Error(
            sdkMessage.errorDetail ?? sdkMessage.message ?? sdkMessage.stopReason,
          );
        }
      }

      if (!finalResult) {
        throw new Error("Agent stream ended without a final result");
      }
      if (!finalResult.success) {
        throw resultError(finalResult);
      }

      const conversationId = finalResult.conversationId ?? session.conversationId;
      if (!conversationId) {
        throw new Error("Letta did not return a conversation id");
      }

      return {
        answer: userFacingAnswer(
          stripHiddenReasoning(finalResult.result ?? rawAssistantText),
          input.message,
        ),
        lettaConversationId: conversationId,
        durationMs: finalResult.durationMs ?? Math.round(performance.now() - startedAt),
      };
    } finally {
      session.close();
    }
  });
}

export type TurnAttachment =
  | {
      kind: "image";
      name: string;
      mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
      data: string;
      size?: number;
    }
  | {
      kind: "text_file";
      name: string;
      mediaType: string;
      text: string;
      size?: number;
    }
  | {
      kind: "file";
      name: string;
      mediaType: string;
      size?: number;
    };

function renderAttachmentContext(attachments: TurnAttachment[]): string {
  if (!attachments.length) return "";
  const lines = attachments.map((attachment, index) => {
    const prefix = `Attachment ${index + 1}: ${attachment.name} (${attachment.mediaType}`;
    const size = attachment.size == null ? "" : `, ${attachment.size} bytes`;
    if (attachment.kind === "text_file") {
      return `${prefix}${size})\n${attachment.text.slice(0, 20_000)}`;
    }
    if (attachment.kind === "image") {
      return [
        `${prefix}${size})`,
        "This turn includes a real multimodal image part that the current model can inspect.",
        "If earlier conversation history says images were placeholders or unreadable, treat that as stale information and ignore it for this turn.",
        "Answer by directly analyzing the attached image pixels.",
      ].join("\n");
    }
    return `${prefix}${size})\nOnly file metadata is available for this attachment.`;
  });
  return ["<ATTACHMENTS>", ...lines, "</ATTACHMENTS>"].join("\n\n");
}

function buildTurnMessage(text: string, attachments: TurnAttachment[]): SendMessage {
  if (!attachments.length) return text;
  const attachmentContext = renderAttachmentContext(attachments);
  const content: MessageContentItem[] = [
    {
      type: "text",
      text: attachmentContext ? `${text}\n\n${attachmentContext}` : text,
    },
  ];
  for (const attachment of attachments) {
    if (attachment.kind === "image") {
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: attachment.mediaType,
          data: attachment.data,
        },
      });
    }
  }
  return content;
}

export async function runMemoryReflection(input: {
  userId: string;
  agentId: string;
  transcript: string;
}): Promise<{ summary: string; lettaConversationId: string; durationMs: number }> {
  return withGlobalTurnSlot(async () => {
    const sessionOptions: LettaCodeClientSessionOptions = {
      permissionMode: "unrestricted",
      skillSources: [],
      cwd: "/workspace",
      canUseTool: (toolName: string) =>
        resolveHeadlessToolApproval(toolName),
      maxApprovalRecoveryAttempts: MAX_APPROVAL_RECOVERY_ATTEMPTS,
      approvalRecoveryTimeoutMs: APPROVAL_RECOVERY_TIMEOUT_MS,
      tools: createOperationsTools(input.userId, input.agentId),
    };
    const session = client.createSession(
      input.agentId,
      sessionOptions,
    ) as RecoverableTurnSession;

    try {
      await session.bootstrapState({ limit: 1 });
      await session.updateToolset("none");
      const result = await session.runTurn(
        [
          "Background memory reflection task for the banking web app.",
          "Review the transcript below and decide whether any concise long-term memory should be saved.",
          "Use memory_search first when needed to avoid duplicates.",
          "Call memory_save only for durable user preferences, stable work context, or verified reusable operations lessons.",
          "Use private scope for user-specific facts. Use shared scope only for non-private reusable bank operations lessons.",
          "Never save passwords, tokens, authorization codes, customer data, raw transcript text, or transient one-off details.",
          "If nothing is worth remembering, do not call memory_save.",
          "",
          "<TRANSCRIPT>",
          input.transcript,
          "</TRANSCRIPT>",
        ].join("\n"),
        {
          maxApprovalRecoveryAttempts: MAX_APPROVAL_RECOVERY_ATTEMPTS,
          recoveryTimeoutMs: APPROVAL_RECOVERY_TIMEOUT_MS,
        },
      );
      if (!result.success) {
        throw new Error(
          result.errorDetail ??
            result.error ??
            result.stopReason ??
            "Memory reflection failed",
        );
      }
      const conversationId = result.conversationId ?? session.conversationId;
      if (!conversationId) {
        throw new Error("Letta did not return a reflection conversation id");
      }
      return {
        summary: stripHiddenReasoning(result.result ?? ""),
        lettaConversationId: conversationId,
        durationMs: result.durationMs,
      };
    } finally {
      session.close();
    }
  });
}

export async function readUserMemory(
  agentId: string,
  userId: string,
): Promise<
  Array<{ path: string; content: string }>
> {
  return readVisibleMemory(agentId, userId);
}
