import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

type StoredConversation = {
  in_context_message_ids?: unknown;
};

export type ConversationContextSize = {
  messageBytes: number;
  systemPromptBytes: number;
  totalBytes: number;
  inContextMessageCount: number;
};

function conversationDirectory(root: string, conversationId: string): string {
  const encoded = Buffer.from(`conversation:${conversationId}`).toString(
    "base64url",
  );
  return join(root, "conversations", encoded);
}

async function fileBytes(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
}

export async function measureConversationContextBytes(
  root: string,
  conversationId: string,
): Promise<ConversationContextSize> {
  const directory = conversationDirectory(root, conversationId);
  const conversationPath = join(directory, "conversation.json");
  const messagesPath = join(directory, "messages.jsonl");
  const systemPromptPath = join(directory, "system-prompt.json");

  let conversation: StoredConversation;
  let messagesText: string;
  try {
    [conversation, messagesText] = await Promise.all([
      readFile(conversationPath, "utf8").then(
        (text) => JSON.parse(text) as StoredConversation,
      ),
      readFile(messagesPath, "utf8"),
    ]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      const systemPromptBytes = await fileBytes(systemPromptPath);
      return {
        messageBytes: 0,
        systemPromptBytes,
        totalBytes: systemPromptBytes,
        inContextMessageCount: 0,
      };
    }
    throw error;
  }

  const rawIds = conversation.in_context_message_ids;
  const inContextIds = new Set(
    Array.isArray(rawIds)
      ? rawIds.filter((value): value is string => typeof value === "string")
      : [],
  );
  const legacyPositions = new Set(
    [...inContextIds]
      .map((id) => /^ui-msg-(\d+)$/.exec(id)?.[1])
      .filter((value): value is string => value !== undefined)
      .map(Number),
  );
  const records = messagesText
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      try {
        const message = JSON.parse(line) as { id?: unknown; type?: unknown };
        return {
          line,
          id: typeof message.id === "string" ? message.id : undefined,
          isSession: message.type === "session",
        };
      } catch {
        return { line, id: undefined, isSession: false };
      }
    });
  const usesStoredMessageIds = records.some(
    (record) => record.id && inContextIds.has(record.id),
  );
  let messageBytes = 0;
  let inContextMessageCount = 0;
  let messagePosition = 0;

  for (const record of records) {
    if (record.isSession) continue;
    messagePosition += 1;
    if (inContextIds.size > 0) {
      const isActive = usesStoredMessageIds
        ? record.id !== undefined && inContextIds.has(record.id)
        : legacyPositions.has(messagePosition);
      if (!isActive) continue;
    }
    messageBytes += Buffer.byteLength(record.line) + 1;
    inContextMessageCount += 1;
  }

  const systemPromptBytes = await fileBytes(systemPromptPath);
  return {
    messageBytes,
    systemPromptBytes,
    totalBytes: messageBytes + systemPromptBytes,
    inContextMessageCount,
  };
}

export function contextNeedsCompaction(
  context: ConversationContextSize,
  thresholdBytes: number,
  pendingMessageBytes = 0,
): boolean {
  return (
    thresholdBytes > 0 &&
    context.totalBytes + Math.max(0, pendingMessageBytes) >= thresholdBytes
  );
}

export function estimatePendingMessageBytes(message: unknown): number {
  // Leave room for the protocol envelope that wraps the serialized message.
  return Buffer.byteLength(JSON.stringify(message)) + 4_096;
}
