import { config } from "./config.js";
import { pool } from "./database.js";
import { withDistributedLock } from "./redis-leases.js";
import {
  getOrCreateUserAgent,
  runMemoryReflection,
} from "./agent-service.js";
import { renderAttachmentContextForReflection } from "./attachment-context.js";

type ReflectionTurn = {
  id: string;
  conversation_id: string;
  user_id: string;
  user_message: string;
  assistant_message: string | null;
  attachment_context: unknown;
  created_at: Date;
};

let reflectionTimer: NodeJS.Timeout | null = null;
let reflectionRunning = false;

function renderTranscript(turns: ReflectionTurn[]): string {
  return turns
    .map((turn, index) => {
      const attachmentContext = renderAttachmentContextForReflection(
        turn.attachment_context,
      );
      return [
        `Turn ${index + 1}`,
        `Conversation: ${turn.conversation_id}`,
        `User: ${turn.user_message}`,
        attachmentContext,
        `Assistant: ${turn.assistant_message ?? ""}`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

async function markTurns(
  ids: string[],
  status: "processing" | "completed" | "failed",
  error: string | null = null,
): Promise<void> {
  if (!ids.length) return;
  await pool.query(
    `UPDATE turns
     SET memory_reflection_status = $2,
         memory_reflected_at = CASE WHEN $2 = 'completed' THEN now() ELSE memory_reflected_at END,
         memory_reflection_error = $3
     WHERE id = ANY($1::uuid[])`,
    [ids, status, error],
  );
}

async function pollMemoryReflection(): Promise<void> {
  if (!config.MEMORY_REFLECTION_ENABLED || reflectionRunning) return;
  reflectionRunning = true;
  try {
    await withDistributedLock(
      "memory-reflection-worker",
      async () => {
        const result = await pool.query<ReflectionTurn>(
          `SELECT id, conversation_id, user_id, user_message, assistant_message,
                  attachment_context, created_at
           FROM turns
           WHERE status = 'completed'
             AND assistant_message IS NOT NULL
             AND memory_reflected_at IS NULL
             AND COALESCE(memory_reflection_status, '') <> 'processing'
             AND completed_at <= now() - interval '1 minute'
           ORDER BY completed_at ASC
           LIMIT $1`,
          [config.MEMORY_REFLECTION_BATCH_SIZE],
        );
        if (!result.rowCount) return;

        const groups = new Map<string, ReflectionTurn[]>();
        for (const turn of result.rows) {
          const group = groups.get(turn.user_id) ?? [];
          group.push(turn);
          groups.set(turn.user_id, group);
        }

        for (const [userId, turns] of groups) {
          const ids = turns.map((turn) => turn.id);
          await markTurns(ids, "processing");
          try {
            const agentId = await getOrCreateUserAgent(userId);
            await runMemoryReflection({
              userId,
              agentId,
              transcript: renderTranscript(turns),
            });
            await markTurns(ids, "completed");
          } catch (error) {
            await markTurns(
              ids,
              "failed",
              error instanceof Error ? error.message : String(error),
            );
          }
        }
      },
      { timeoutMs: 1_000, leaseMs: 600_000 },
    );
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !error.message.includes("Timed out waiting")
    ) {
      console.error("[memory-reflection] failed", error);
    }
  } finally {
    reflectionRunning = false;
  }
}

export function startMemoryReflectionWorker(): void {
  if (!config.MEMORY_REFLECTION_ENABLED || reflectionTimer) return;
  reflectionTimer = setInterval(() => {
    void pollMemoryReflection();
  }, config.MEMORY_REFLECTION_POLL_MS);
  reflectionTimer.unref();
  void pollMemoryReflection();
}

export function stopMemoryReflectionWorker(): void {
  if (!reflectionTimer) return;
  clearInterval(reflectionTimer);
  reflectionTimer = null;
}
