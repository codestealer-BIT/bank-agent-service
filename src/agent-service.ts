import {
  extractStreamTextDelta,
  LettaAgentClient,
  type BootstrapStateOptions,
  type BootstrapStateResult,
  type LettaCodeClientSessionOptions,
  type LettaCodeSession,
  type SDKMessage,
  type SDKProtocolCommand,
  type SDKProtocolMessage,
  type SDKResultMessage,
  type MessageContentItem,
  type SendMessage,
} from "@letta-ai/letta-agent-sdk";
import { stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./config.js";
import {
  contextNeedsCompaction,
  estimatePendingMessageBytes,
  measureConversationContextBytes,
} from "./conversation-compaction.js";
import { createOperationsTools } from "./agent-tools.js";
import { BANK_OPERATIONS_MEMORY_SCOPE_POLICY } from "./memory-policy.js";
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
import { composeExplicitSkillRuntimeMessage } from "./skill-service.js";
import {
  withDistributedLock,
  withGlobalTurnSlot,
} from "./redis-leases.js";
import { preparePdfForModel } from "./pdf-service.js";
import { extractDocumentText } from "./document-service.js";
import { userFacingAnswer } from "./response-policy.js";
import type { AttachmentContextRecord } from "./attachment-context.js";
import {
  ModelFailoverSuppressedError,
  runWithModelFailover,
  type ModelAttemptContext,
} from "./model-failover.js";

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
  runTurn(message: SendMessage): Promise<SDKResultMessage>;
  updateToolset(toolsetPreference: string): Promise<void>;
};

type ConversationCompactResponse = SDKProtocolMessage<"conversation_compact_response"> & {
  success?: boolean;
  error?: string | null;
  compaction?: {
    num_messages_before?: number;
    num_messages_after?: number;
    summary?: string;
  } | null;
};

const GIT_CONFIG_LOCK_RETRY_ATTEMPTS = 5;
const GIT_CONFIG_LOCK_RETRY_BASE_MS = 150;
const STALE_GIT_CONFIG_LOCK_MS = 30_000;

function isGitConfigLockError(error: unknown): boolean {
  const text =
    error instanceof Error
      ? `${error.message}\n${error.stack ?? ""}`
      : String(error);
  return (
    text.includes(".git/config.lock") ||
    text.includes("config.lock") ||
    text.includes("File exists") ||
    text.includes("EEXIST")
  );
}

function gitConfigLockPath(agentId: string): string {
  return join(
    config.LETTA_LOCAL_BACKEND_DIR,
    "memfs",
    agentId,
    "memory",
    ".git",
    "config.lock",
  );
}

async function removeStaleGitConfigLock(agentId: string): Promise<void> {
  const lockPath = gitConfigLockPath(agentId);
  try {
    const lockStat = await stat(lockPath);
    if (Date.now() - lockStat.mtimeMs < STALE_GIT_CONFIG_LOCK_MS) return;
    await unlink(lockPath);
    console.warn("[agent-local-backend] removed stale git config lock", {
      agentId,
      lockPath,
    });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      console.warn("[agent-local-backend] could not inspect git config lock", {
        agentId,
        lockPath,
        error,
      });
    }
  }
}

async function withGitConfigLockRetry<T>(
  agentId: string,
  work: () => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= GIT_CONFIG_LOCK_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      if (!isGitConfigLockError(error)) throw error;
      lastError = error;
      await removeStaleGitConfigLock(agentId);
      const backoffMs =
        GIT_CONFIG_LOCK_RETRY_BASE_MS * attempt +
        Math.floor(Math.random() * GIT_CONFIG_LOCK_RETRY_BASE_MS);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }
  throw lastError;
}

async function prepareLocalSession(
  agentId: string,
  session: RecoverableTurnSession,
): Promise<BootstrapStateResult> {
  return withGitConfigLockRetry(agentId, async () => {
    const state = await session.bootstrapState({ limit: 1 });
    // The local App Server does not support per-session allowedTools yet.
    // Disabling the built-in harness toolset leaves only the SDK-registered
    // infrastructure tools available for this session.
    await session.updateToolset("none");
    return state;
  });
}

async function compactConversationBeforeTurn(
  session: RecoverableTurnSession,
  conversationId: string | null,
  pendingMessageBytes = 0,
): Promise<void> {
  if (!conversationId || config.LETTA_COMPACTION_THRESHOLD_BYTES === 0) return;

  const before = await measureConversationContextBytes(
    config.LETTA_LOCAL_BACKEND_DIR,
    conversationId,
  );
  if (
    !contextNeedsCompaction(
      before,
      config.LETTA_COMPACTION_THRESHOLD_BYTES,
      pendingMessageBytes,
    )
  ) {
    return;
  }

  const command = {
    type: "conversation_compact",
    conversation_id: conversationId,
    body: {
      compaction_settings: {
        mode: "all",
        clip_chars: 12_000,
      },
    },
  } as SDKProtocolCommand;
  const response = (await session.sendCommand(command, {
    responseType: "conversation_compact_response",
    timeoutMs: config.LETTA_REQUEST_TIMEOUT_MS,
  })) as ConversationCompactResponse;

  if (response.success !== true || !response.compaction) {
    throw new Error(
      `Conversation history compaction failed: ${response.error ?? "unknown error"}`,
    );
  }

  const after = await measureConversationContextBytes(
    config.LETTA_LOCAL_BACKEND_DIR,
    conversationId,
  );
  if (after.totalBytes >= before.totalBytes) {
    throw new Error(
      `Conversation history compaction did not reduce context bytes (${before.totalBytes} -> ${after.totalBytes}).`,
    );
  }
  console.info("[conversation-compaction] compacted local conversation", {
    conversationId,
    beforeBytes: before.totalBytes,
    pendingMessageBytes,
    projectedBytes: before.totalBytes + pendingMessageBytes,
    afterBytes: after.totalBytes,
    messagesBefore:
      response.compaction.num_messages_before ?? before.inContextMessageCount,
    messagesAfter:
      response.compaction.num_messages_after ?? after.inContextMessageCount,
  });
}

type AttachmentPreparationDiagnostics = {
  inputCount: number;
  outputCount: number;
  visualCount: number;
  visualBytes: number;
  textChars: number;
  prepMs: number;
  files: Array<{
    name: string;
    kind: TurnAttachment["kind"];
    mediaType: string;
    size?: number;
    outputCount: number;
    visualCount: number;
    visualBytes: number;
    textChars: number;
    prepMs: number;
  }>;
};

function qualifyAgentModel(model: string): string {
  if (model.includes("/")) return model;
  const providerSeparator = config.AGENT_MODEL.indexOf("/");
  return providerSeparator < 0
    ? model
    : `${config.AGENT_MODEL.slice(0, providerSeparator)}/${model}`;
}

const agentModels = Array.from(
  new Set([
    config.AGENT_MODEL,
    ...config.AGENT_FALLBACK_MODELS.map(qualifyAgentModel),
  ]),
);

function getSessionModelOptions(model: string): Pick<
  LettaCodeClientSessionOptions,
  "model" | "reasoningEffort"
> {
  // The Letta SDK resolves reasoningEffort through listModels(). Custom
  // OpenAI-compatible/LiteLLM handles such as lmstudio/MiniMax-M3 are not in
  // that catalog, so passing reasoningEffort makes the SDK fail before the
  // turn reaches LiteLLM. Keep the model explicit, but only pass the reasoning
  // tier for catalog-backed model handles.
  if (model.startsWith("lmstudio/")) {
    return { model };
  }

  return {
    model,
    reasoningEffort: config.AGENT_REASONING_EFFORT,
  };
}

function conciseError(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 500);
  return String(error).slice(0, 500);
}

async function withAgentModelFailover<T>(
  operation: string,
  work: (context: ModelAttemptContext) => Promise<T>,
) {
  return runWithModelFailover(
    {
      models: agentModels,
      primaryAttempts: config.AGENT_PRIMARY_ATTEMPTS,
      fallbackAttempts: config.AGENT_FALLBACK_ATTEMPTS,
      backoffBaseMs: config.AGENT_FAILOVER_BACKOFF_BASE_MS,
      backoffMaxMs: config.AGENT_FAILOVER_BACKOFF_MAX_MS,
      onFailure: ({ model, attempt, nextModel, delayMs, error }) => {
        console.warn("[model-failover] retrying model operation", {
          operation,
          failedModel: model,
          attempt,
          nextModel,
          delayMs,
          error: conciseError(error),
        });
      },
    },
    work,
  );
}

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
  diagnostics: {
    attachmentPrep: AttachmentPreparationDiagnostics;
    memoryRetrievalMs: number;
  };
}> {
  const prepareStartedAt = performance.now();
  const prepared = await prepareAttachments(input.attachments ?? []);
  prepared.diagnostics.prepMs = Math.round(performance.now() - prepareStartedAt);
  let memoryContext = "";
  const memoryStartedAt = performance.now();
  try {
    memoryContext = formatMemoryContext(
      await searchMemory({
        agentId: input.agentId,
        query: input.message,
        limit: 12,
      }),
    );
  } catch (error) {
    // BGE-M3 can take a while to download and warm up after the first Docker
    // start. Long-term memory is an enrichment layer, so a temporary RAG
    // outage must not make the primary chat path unavailable.
    console.warn("Semantic memory retrieval is temporarily unavailable", error);
  }
  const memoryRetrievalMs = Math.round(performance.now() - memoryStartedAt);
  const textMessage = composeRuntimeText(
    composeExplicitSkillRuntimeMessage(input.message),
    memoryContext,
  );

  if (prepared.diagnostics.inputCount > 0) {
    console.info(
      "[attachment-diagnostics]",
      JSON.stringify({
        userId: input.userId,
        agentId: input.agentId,
        prepMs: prepared.diagnostics.prepMs,
        memoryRetrievalMs,
        inputCount: prepared.diagnostics.inputCount,
        outputCount: prepared.diagnostics.outputCount,
        visualCount: prepared.diagnostics.visualCount,
        visualBytes: prepared.diagnostics.visualBytes,
        textChars: prepared.diagnostics.textChars,
        files: prepared.diagnostics.files,
      }),
    );
  }

  return {
    message: buildTurnMessage(textMessage, prepared.attachments),
    attachmentContext: prepared.context,
    diagnostics: {
      attachmentPrep: prepared.diagnostics,
      memoryRetrievalMs,
    },
  };
}

export async function runConversationTurn(input: {
  userId: string;
  agentId: string;
  lettaConversationId: string | null;
  message: string;
  attachments?: TurnAttachment[];
  emailRecipient?: string | null;
  includeEmailTool?: boolean;
}): Promise<{
  answer: string;
  lettaConversationId: string;
  durationMs: number;
  attachmentContext: AttachmentContextRecord[];
}> {
  // The route serializes each conversation. Different conversations may run
  // concurrently; shared-memory writes are serialized by the memory service.
  return withGlobalTurnSlot(async () => {
    const preparedMessage = await buildRuntimeMessage(input);
    const failover = await withAgentModelFailover(
      "conversation_turn",
      async ({ model }) => {
        let sideEffectTool: string | null = null;
        const sessionOptions: LettaCodeClientSessionOptions = {
          ...getSessionModelOptions(model),
          permissionMode: "unrestricted",
          skillSources: [],
          cwd: "/workspace",
          tools: createOperationsTools(input.userId, input.agentId, {
            emailRecipient: input.emailRecipient,
            includeEmail: input.includeEmailTool,
            onSideEffect: (toolName) => {
              sideEffectTool = toolName;
            },
          }),
        };
        const session = (input.lettaConversationId
          ? client.resumeSession(input.lettaConversationId, sessionOptions)
          : client.createSession(input.agentId, sessionOptions)) as RecoverableTurnSession;

        try {
          await prepareLocalSession(input.agentId, session);
          await compactConversationBeforeTurn(
            session,
            input.lettaConversationId,
            estimatePendingMessageBytes(preparedMessage.message),
          );

          const modelStartedAt = performance.now();
          const result = await session.runTurn(preparedMessage.message);
          const modelMs = Math.round(performance.now() - modelStartedAt);
          if (!result.success) throw resultError(result);

          const conversationId = result.conversationId ?? session.conversationId;
          if (!conversationId) {
            throw new Error("Letta did not return a conversation id");
          }
          return { result, conversationId, modelMs };
        } catch (error) {
          if (sideEffectTool) {
            throw new ModelFailoverSuppressedError(
              `The model failed after the ${sideEffectTool} side effect completed`,
              error,
            );
          }
          throw error;
        } finally {
          session.close();
        }
      },
    );

    const { result, conversationId, modelMs } = failover.value;
    if ((input.attachments ?? []).length > 0) {
      console.info(
        "[turn-diagnostics]",
        JSON.stringify({
          userId: input.userId,
          agentId: input.agentId,
          mode: "non_stream",
          model: failover.model,
          modelAttempts: failover.totalAttempts,
          attachmentPrepMs: preparedMessage.diagnostics.attachmentPrep.prepMs,
          memoryRetrievalMs: preparedMessage.diagnostics.memoryRetrievalMs,
          modelMs,
          visualCount: preparedMessage.diagnostics.attachmentPrep.visualCount,
          visualBytes: preparedMessage.diagnostics.attachmentPrep.visualBytes,
        }),
      );
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
    includeEmailTool?: boolean;
  },
  onDelta: (delta: string) => void | Promise<void>,
): Promise<{
  answer: string;
  lettaConversationId: string;
  durationMs: number;
  attachmentContext: AttachmentContextRecord[];
}> {
  return withGlobalTurnSlot(async () => {
    const preparedMessage = await buildRuntimeMessage(input);
    const failover = await withAgentModelFailover(
      "stream_conversation_turn",
      async ({ model, attempt }) => {
        let sideEffectTool: string | null = null;
        const sessionOptions: LettaCodeClientSessionOptions = {
          ...getSessionModelOptions(model),
          permissionMode: "unrestricted",
          skillSources: [],
          cwd: "/workspace",
          tools: createOperationsTools(input.userId, input.agentId, {
            emailRecipient: input.emailRecipient,
            includeEmail: input.includeEmailTool,
            onSideEffect: (toolName) => {
              sideEffectTool = toolName;
            },
          }),
        };
        const session = (input.lettaConversationId
          ? client.resumeSession(input.lettaConversationId, sessionOptions)
          : client.createSession(input.agentId, sessionOptions)) as RecoverableTurnSession;
        let emittedVisibleText = "";

        try {
          await prepareLocalSession(input.agentId, session);
          await compactConversationBeforeTurn(
            session,
            input.lettaConversationId,
            estimatePendingMessageBytes(preparedMessage.message),
          );
          const startedAt = performance.now();
          if ((input.attachments ?? []).length > 0) {
            console.info(
              "[turn-diagnostics]",
              JSON.stringify({
                userId: input.userId,
                agentId: input.agentId,
                mode: "stream_started",
                model,
                modelAttempt: attempt,
                attachmentPrepMs: preparedMessage.diagnostics.attachmentPrep.prepMs,
                memoryRetrievalMs: preparedMessage.diagnostics.memoryRetrievalMs,
                visualCount: preparedMessage.diagnostics.attachmentPrep.visualCount,
                visualBytes: preparedMessage.diagnostics.attachmentPrep.visualBytes,
              }),
            );
          }
          const sendStartedAt = performance.now();
          await session.send(preparedMessage.message);
          const sendMs = Math.round(performance.now() - sendStartedAt);

          let finalResult: SDKResultMessage | null = null;
          let rawAssistantText = "";
          let firstSdkEventAt: number | null = null;
          let firstAssistantTextAt: number | null = null;
          let firstVisibleTextAt: number | null = null;

          const logFirstTokenDiagnostic = (
            mode: string,
            extra: Record<string, unknown> = {},
          ) => {
            if ((input.attachments ?? []).length === 0) return;
            console.info(
              "[turn-diagnostics]",
              JSON.stringify({
                userId: input.userId,
                agentId: input.agentId,
                mode,
                model,
                modelAttempt: attempt,
                sendMs,
                elapsedMs: Math.round(performance.now() - startedAt),
                attachmentPrepMs: preparedMessage.diagnostics.attachmentPrep.prepMs,
                memoryRetrievalMs: preparedMessage.diagnostics.memoryRetrievalMs,
                visualCount: preparedMessage.diagnostics.attachmentPrep.visualCount,
                visualBytes: preparedMessage.diagnostics.attachmentPrep.visualBytes,
                ...extra,
              }),
            );
          };

          for await (const sdkMessage of session.stream() as AsyncGenerator<SDKMessage>) {
            if (!firstSdkEventAt) {
              firstSdkEventAt = performance.now();
              logFirstTokenDiagnostic("stream_first_sdk_event", {
                sdkType: sdkMessage.type,
                firstSdkEventMs: Math.round(firstSdkEventAt - startedAt),
              });
            }
            if (sdkMessage.type === "stream_event") {
              const delta = extractStreamTextDelta(sdkMessage.event);
              if (delta?.kind === "assistant" && delta.text) {
                if (!firstAssistantTextAt) {
                  firstAssistantTextAt = performance.now();
                  logFirstTokenDiagnostic("stream_first_assistant_text", {
                    firstAssistantTextMs: Math.round(firstAssistantTextAt - startedAt),
                    firstAssistantTextChars: delta.text.length,
                  });
                }
                rawAssistantText += delta.text;
                const nextVisibleText = visibleStreamingText(rawAssistantText);
                const visibleDelta = nextVisibleText.slice(emittedVisibleText.length);
                if (visibleDelta) {
                  if (!firstVisibleTextAt) {
                    firstVisibleTextAt = performance.now();
                    logFirstTokenDiagnostic("stream_first_visible_text", {
                      firstVisibleTextMs: Math.round(firstVisibleTextAt - startedAt),
                      firstVisibleTextChars: visibleDelta.length,
                    });
                  }
                  emittedVisibleText = nextVisibleText;
                  await onDelta(visibleDelta);
                }
              }
              continue;
            }
            if (sdkMessage.type === "assistant" && sdkMessage.content) {
              if (!firstAssistantTextAt) {
                firstAssistantTextAt = performance.now();
                logFirstTokenDiagnostic("stream_first_assistant_text", {
                  firstAssistantTextMs: Math.round(firstAssistantTextAt - startedAt),
                  firstAssistantTextChars: sdkMessage.content.length,
                  sdkType: sdkMessage.type,
                });
              }
              rawAssistantText += sdkMessage.content;
              const nextVisibleText = visibleStreamingText(rawAssistantText);
              const visibleDelta = nextVisibleText.slice(emittedVisibleText.length);
              if (visibleDelta) {
                if (!firstVisibleTextAt) {
                  firstVisibleTextAt = performance.now();
                  logFirstTokenDiagnostic("stream_first_visible_text", {
                    firstVisibleTextMs: Math.round(firstVisibleTextAt - startedAt),
                    firstVisibleTextChars: visibleDelta.length,
                    sdkType: sdkMessage.type,
                  });
                }
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

          if (!finalResult) throw new Error("Agent stream ended without a final result");
          if (!finalResult.success) throw resultError(finalResult);

          const conversationId = finalResult.conversationId ?? session.conversationId;
          if (!conversationId) {
            throw new Error("Letta did not return a conversation id");
          }
          return {
            finalResult,
            rawAssistantText,
            conversationId,
            startedAt,
            sendMs,
            firstSdkEventAt,
            firstAssistantTextAt,
            firstVisibleTextAt,
          };
        } catch (error) {
          if (emittedVisibleText || sideEffectTool) {
            throw new ModelFailoverSuppressedError(
              emittedVisibleText
                ? "The streaming model failed after response text was emitted"
                : `The streaming model failed after the ${sideEffectTool} side effect completed`,
              error,
            );
          }
          throw error;
        } finally {
          session.close();
        }
      },
    );

    const {
      finalResult,
      rawAssistantText,
      conversationId,
      startedAt,
      sendMs,
      firstSdkEventAt,
      firstAssistantTextAt,
      firstVisibleTextAt,
    } = failover.value;
    if ((input.attachments ?? []).length > 0) {
      console.info(
        "[turn-diagnostics]",
        JSON.stringify({
          userId: input.userId,
          agentId: input.agentId,
          mode: "stream_finished",
          model: failover.model,
          modelAttempts: failover.totalAttempts,
          attachmentPrepMs: preparedMessage.diagnostics.attachmentPrep.prepMs,
          memoryRetrievalMs: preparedMessage.diagnostics.memoryRetrievalMs,
          modelMs: Math.round(performance.now() - startedAt),
          sendMs,
          firstSdkEventMs: firstSdkEventAt
            ? Math.round(firstSdkEventAt - startedAt)
            : null,
          firstAssistantTextMs: firstAssistantTextAt
            ? Math.round(firstAssistantTextAt - startedAt)
            : null,
          firstVisibleTextMs: firstVisibleTextAt
            ? Math.round(firstVisibleTextAt - startedAt)
            : null,
          visualCount: preparedMessage.diagnostics.attachmentPrep.visualCount,
          visualBytes: preparedMessage.diagnostics.attachmentPrep.visualBytes,
        }),
      );
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
  diagnostics: AttachmentPreparationDiagnostics;
}> {
  const prepared = await Promise.all(
    attachments.map(async (attachment): Promise<{
      attachments: TurnAttachment[];
      context: AttachmentContextRecord;
      diagnostics: AttachmentPreparationDiagnostics["files"][number];
    }> => {
      const fileStartedAt = performance.now();
      if (attachment.kind === "document") {
        const extracted = await extractDocumentText({
          name: attachment.name,
          mediaType: attachment.mediaType,
          data: attachment.data,
        });
        const extractionNote = !extracted.hasExtractableText
          ? extracted.visualImages?.length
            ? "No readable text was found. Analyze the embedded slide images included with this turn."
            : "No readable text was found. The file may contain only scanned pages or embedded images."
          : extracted.truncated
            ? "Only the first 60,000 extracted characters are included because the document is long."
            : "The complete extractable document text is included below.";
        const visualNote = extracted.visualImages?.length
          ? [
              `${extracted.visualImages.length} embedded image(s) are included for visual analysis.`,
              extracted.visualImagesTruncated
                ? "Only the first embedded images are included because the document exceeds the visual image or payload limit."
                : "All supported embedded images are included.",
            ].join(" ")
          : "";
        const outputAttachments: TurnAttachment[] = [
            {
              kind: "text_file",
              name: attachment.name,
              mediaType: attachment.mediaType,
              size: attachment.size,
              text: [
                `Document format: ${extracted.format}`,
                extracted.details ?? "",
                extracted.visualDetails ?? "",
                extractionNote,
                visualNote,
                "",
                extracted.text,
              ]
                .filter((line, index) => line || index >= 5)
                .join("\n"),
            },
            ...(extracted.visualImages ?? []).map(
              (image, index): TurnAttachment => ({
                kind: "image",
                name: `${attachment.name} · embedded image ${index + 1}`,
                mediaType: image.mediaType,
                data: image.data,
                size: image.size,
              }),
            ),
          ];
        return {
          attachments: outputAttachments,
          context: {
            name: attachment.name,
            mediaType: attachment.mediaType,
            size: attachment.size,
            kind: "document",
            extractionStatus: extracted.hasExtractableText
              ? "extracted"
              : extracted.visualImages?.length
                ? "visual_only"
                : "empty",
            parser: extracted.visualImages?.length
              ? "document-parser-and-embedded-images"
              : "document-parser",
            extractedText: extracted.text,
            format: extracted.format,
            truncated: extracted.truncated,
            details: [extracted.details, extracted.visualDetails]
              .filter(Boolean)
              .join("; "),
          },
          diagnostics: summarizePreparedAttachment(
            attachment,
            outputAttachments,
            Math.round(performance.now() - fileStartedAt),
          ),
        };
      }
      if (attachment.kind !== "pdf") {
        if (attachment.kind === "text_file") {
          const outputAttachments = [attachment];
          return {
            attachments: outputAttachments,
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
            diagnostics: summarizePreparedAttachment(
              attachment,
              outputAttachments,
              Math.round(performance.now() - fileStartedAt),
            ),
          };
        }
        const outputAttachments = [attachment];
        return {
          attachments: outputAttachments,
          context: {
            name: attachment.name,
            mediaType: attachment.mediaType,
            size: attachment.size,
            kind: attachment.kind,
            extractionStatus:
              attachment.kind === "image" ? "visual_only" : "metadata_only",
            parser: attachment.kind === "image" ? "model-vision" : "none",
          },
          diagnostics: summarizePreparedAttachment(
            attachment,
            outputAttachments,
            Math.round(performance.now() - fileStartedAt),
          ),
        };
      }

      const extracted = await preparePdfForModel(attachment.data);
      const extractionNote = !extracted.hasExtractableText
        ? extracted.visualPages.length
          ? "This PDF has no text layer. Analyze the rendered page images included with this turn."
          : "This PDF has no extractable text and its pages could not be rendered."
        : extracted.truncated
          ? "Only the first 60,000 extracted characters are included because the document is long."
          : "The complete extractable PDF text is included below.";
      const visualNote = extracted.hasExtractableText
        ? "No rendered page images are included because the PDF text layer was extracted successfully."
        : extracted.visualPages.length
          ? [
              `${extracted.visualPages.length} rendered page image(s) are included for visual analysis.`,
              extracted.visualPagesTruncated
                ? "Only the first rendered pages are included because the PDF exceeds the visual page or payload limit."
                : "All PDF pages are included as rendered images.",
            ].join(" ")
          : `No rendered page images are available.${extracted.visualError ? ` Renderer detail: ${extracted.visualError}` : ""}`;
      const outputAttachments: TurnAttachment[] = [
          {
            kind: "text_file",
            name: attachment.name,
            mediaType: attachment.mediaType,
            size: attachment.size,
            text: [
              `PDF pages: ${extracted.pages}`,
              extractionNote,
              visualNote,
              "",
              extracted.text,
            ].join("\n"),
          },
          ...extracted.visualPages.map(
            (page): TurnAttachment => ({
              kind: "image",
              name: `${attachment.name} · page ${page.pageNumber}`,
              mediaType: page.mediaType,
              data: page.data,
              size: page.size,
            }),
          ),
        ];
      return {
        attachments: outputAttachments,
        context: {
          name: attachment.name,
          mediaType: attachment.mediaType,
          size: attachment.size,
          kind: "pdf",
          extractionStatus: extracted.hasExtractableText ? "extracted" : "empty",
          parser: extracted.visualPages.length
            ? "pdf-text-and-page-renderer"
            : "pdf-parse",
          extractedText: extracted.text,
          format: "PDF",
          pageCount: extracted.pages,
          truncated: extracted.truncated,
        },
        diagnostics: summarizePreparedAttachment(
          attachment,
          outputAttachments,
          Math.round(performance.now() - fileStartedAt),
        ),
      };
    }),
  );
  const files = prepared.map((item) => item.diagnostics);
  return {
    attachments: prepared.flatMap((item) => item.attachments),
    context: prepared.map((item) => item.context),
    diagnostics: {
      inputCount: attachments.length,
      outputCount: files.reduce((sum, item) => sum + item.outputCount, 0),
      visualCount: files.reduce((sum, item) => sum + item.visualCount, 0),
      visualBytes: files.reduce((sum, item) => sum + item.visualBytes, 0),
      textChars: files.reduce((sum, item) => sum + item.textChars, 0),
      prepMs: 0,
      files,
    },
  };
}

function summarizePreparedAttachment(
  input: TurnAttachment,
  output: TurnAttachment[],
  prepMs: number,
): AttachmentPreparationDiagnostics["files"][number] {
  return {
    name: input.name,
    kind: input.kind,
    mediaType: input.mediaType,
    size: input.size,
    outputCount: output.length,
    visualCount: output.filter((attachment) => attachment.kind === "image")
      .length,
    visualBytes: output.reduce(
      (sum, attachment) =>
        attachment.kind === "image" ? sum + (attachment.size ?? 0) : sum,
      0,
    ),
    textChars: output.reduce(
      (sum, attachment) =>
        attachment.kind === "text_file" ? sum + attachment.text.length : sum,
      0,
    ),
    prepMs,
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
    const reflectionMessage = [
      "Background memory reflection task for the banking web app.",
      "Review the transcript below and decide whether it contains durable knowledge directly and materially about bank infrastructure or bank IT operations.",
      ...BANK_OPERATIONS_MEMORY_SCOPE_POLICY,
      "If nothing is worth remembering, do not call memory_save.",
      "",
      "<TRANSCRIPT>",
      input.transcript,
      "</TRANSCRIPT>",
    ].join("\n");

    const failover = await withAgentModelFailover(
      "memory_reflection",
      async ({ model }) => {
        let sideEffectTool: string | null = null;
        const sessionOptions: LettaCodeClientSessionOptions = {
          ...getSessionModelOptions(model),
          permissionMode: "unrestricted",
          skillSources: [],
          cwd: "/workspace",
          tools: createOperationsTools(input.userId, input.agentId, {
            includeEmail: false,
            onSideEffect: (toolName) => {
              sideEffectTool = toolName;
            },
          }),
        };
        const session = client.createSession(
          input.agentId,
          sessionOptions,
        ) as RecoverableTurnSession;

        try {
          await prepareLocalSession(input.agentId, session);
          const result = await session.runTurn(reflectionMessage);
          if (!result.success) throw resultError(result);

          const conversationId = result.conversationId ?? session.conversationId;
          if (!conversationId) {
            throw new Error("Letta did not return a reflection conversation id");
          }
          return { result, conversationId };
        } catch (error) {
          if (sideEffectTool) {
            throw new ModelFailoverSuppressedError(
              `The reflection model failed after the ${sideEffectTool} side effect completed`,
              error,
            );
          }
          throw error;
        } finally {
          session.close();
        }
      },
    );

    return {
      summary: stripHiddenReasoning(failover.value.result.result ?? ""),
      lettaConversationId: failover.value.conversationId,
      durationMs: failover.value.result.durationMs,
    };
  });
}

export async function readUserMemory(
  agentId: string,
): Promise<
  Array<{ path: string; content: string }>
> {
  return readSharedMemory(agentId);
}
