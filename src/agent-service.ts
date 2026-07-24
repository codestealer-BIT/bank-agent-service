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
  readSharedMemory,
  searchMemory,
} from "./memory-service.js";
import {
  sharedOperationsPersona,
  syncSharedOperationsPersona,
} from "./agent-persona.js";
import { composeRuntimeText } from "./runtime-message.js";
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
import { extractPdfText } from "./pdf-service.js";
import { extractDocumentText } from "./document-service.js";
import { userFacingAnswer } from "./response-policy.js";
import type { AttachmentContextRecord } from "./attachment-context.js";

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
    persona: sharedOperationsPersona(),
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
  await withDistributedLock(
    `sync-shared-agent-persona:${agentId}`,
    () => syncSharedOperationsPersona(agentId),
    { timeoutMs: 120_000 },
  );
  return agentId;
}

async function buildRuntimeMessage(input: {
  userId: string;
  agentId: string;
  message: string;
  attachments?: TurnAttachment[];
}): Promise<{
  message: SendMessage;
  attachmentContext: AttachmentContextRecord[];
}> {
  const prepared = await prepareAttachments(input.attachments ?? []);
  let memoryContext = "";
  try {
    memoryContext = formatMemoryContext(
      await searchMemory({
        agentId: input.agentId,
        query: input.message,
        limit: 5,
      }),
    );
  } catch (error) {
    // BGE-M3 can take a while to download and warm up after the first Docker
    // start. Long-term memory is an enrichment layer, so a temporary RAG
    // outage must not make the primary chat path unavailable.
    console.warn("Semantic memory retrieval is temporarily unavailable", error);
  }
  const textMessage = composeRuntimeText(input.message, memoryContext);

  return {
    message: buildTurnMessage(textMessage, prepared.attachments),
    attachmentContext: prepared.context,
  };
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
  attachmentContext: AttachmentContextRecord[];
}> {
  // The route serializes each conversation. Different conversations may run
  // concurrently; shared-memory writes are serialized by the memory service.
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

      const preparedMessage = await buildRuntimeMessage(input);

      const result = await session.runTurn(preparedMessage.message, {
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
        attachmentContext: preparedMessage.attachmentContext,
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
  attachmentContext: AttachmentContextRecord[];
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

      const preparedMessage = await buildRuntimeMessage(input);
      const startedAt = performance.now();
      await session.send(preparedMessage.message);

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
        attachmentContext: preparedMessage.attachmentContext,
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
      kind: "pdf";
      name: string;
      mediaType: "application/pdf";
      data: string;
      size?: number;
    }
  | {
      kind: "document";
      name: string;
      mediaType: string;
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

async function prepareAttachments(
  attachments: TurnAttachment[],
): Promise<{
  attachments: TurnAttachment[];
  context: AttachmentContextRecord[];
}> {
  const prepared = await Promise.all(
    attachments.map(async (attachment): Promise<{
      attachment: TurnAttachment;
      context: AttachmentContextRecord;
    }> => {
      if (attachment.kind === "document") {
        const extracted = await extractDocumentText({
          name: attachment.name,
          mediaType: attachment.mediaType,
          data: attachment.data,
        });
        const extractionNote = !extracted.hasExtractableText
          ? "No readable text was found. The file may contain only scanned pages or embedded images."
          : extracted.truncated
            ? "Only the first 60,000 extracted characters are included because the document is long."
            : "The complete extractable document text is included below.";
        return {
          attachment: {
            kind: "text_file",
            name: attachment.name,
            mediaType: attachment.mediaType,
            size: attachment.size,
            text: [
              `Document format: ${extracted.format}`,
              extracted.details ?? "",
              extractionNote,
              "",
              extracted.text,
            ]
              .filter((line, index) => line || index >= 3)
              .join("\n"),
          },
          context: {
            name: attachment.name,
            mediaType: attachment.mediaType,
            size: attachment.size,
            kind: "document",
            extractionStatus: extracted.hasExtractableText ? "extracted" : "empty",
            parser: "document-parser",
            extractedText: extracted.text,
            format: extracted.format,
            truncated: extracted.truncated,
            details: extracted.details,
          },
        };
      }
      if (attachment.kind !== "pdf") {
        if (attachment.kind === "text_file") {
          return {
            attachment,
            context: {
              name: attachment.name,
              mediaType: attachment.mediaType,
              size: attachment.size,
              kind: "text_file",
              extractionStatus: attachment.text.trim() ? "extracted" : "empty",
              parser: "client-text",
              extractedText: attachment.text.slice(0, 60_000),
              truncated: attachment.text.length > 60_000,
            },
          };
        }
        return {
          attachment,
          context: {
            name: attachment.name,
            mediaType: attachment.mediaType,
            size: attachment.size,
            kind: attachment.kind,
            extractionStatus:
              attachment.kind === "image" ? "visual_only" : "metadata_only",
            parser: attachment.kind === "image" ? "model-vision" : "none",
          },
        };
      }

      const extracted = await extractPdfText(attachment.data);
      const extractionNote = !extracted.hasExtractableText
        ? "This PDF contains no extractable text. It may be a scanned document and requires OCR before its contents can be analyzed."
        : extracted.truncated
          ? "Only the first 60,000 extracted characters are included because the document is long."
          : "The complete extractable PDF text is included below.";
      return {
        attachment: {
          kind: "text_file",
          name: attachment.name,
          mediaType: attachment.mediaType,
          size: attachment.size,
          text: [
            `PDF pages: ${extracted.pages}`,
            extractionNote,
            "",
            extracted.text,
          ].join("\n"),
        },
        context: {
          name: attachment.name,
          mediaType: attachment.mediaType,
          size: attachment.size,
          kind: "pdf",
          extractionStatus: extracted.hasExtractableText ? "extracted" : "empty",
          parser: "pdf-parse",
          extractedText: extracted.text,
          format: "PDF",
          pageCount: extracted.pages,
          truncated: extracted.truncated,
        },
      };
    }),
  );
  return {
    attachments: prepared.map((item) => item.attachment),
    context: prepared.map((item) => item.context),
  };
}

function renderAttachmentContext(attachments: TurnAttachment[]): string {
  if (!attachments.length) return "";
  const lines = attachments.map((attachment, index) => {
    const prefix = `Attachment ${index + 1}: ${attachment.name} (${attachment.mediaType}`;
    const size = attachment.size == null ? "" : `, ${attachment.size} bytes`;
    if (attachment.kind === "text_file") {
      return `${prefix}${size})\n${attachment.text.slice(0, 60_000)}`;
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
          "Call memory_save only for durable organization-wide facts, confirmed plans, policies, procedures, or verified reusable operations lessons.",
          "There is no private long-term memory. Do not save personal preferences, identity facts, private discussions, or other user-specific content because every saved memory is shared across authenticated accounts.",
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
): Promise<
  Array<{ path: string; content: string }>
> {
  return readSharedMemory(agentId);
}
