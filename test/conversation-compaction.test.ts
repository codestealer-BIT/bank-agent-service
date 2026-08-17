import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  contextNeedsCompaction,
  estimatePendingMessageBytes,
  measureConversationContextBytes,
} from "../src/conversation-compaction.js";

function encodedConversationDirectory(root: string, conversationId: string) {
  return join(
    root,
    "conversations",
    Buffer.from(`conversation:${conversationId}`).toString("base64url"),
  );
}

test("measures only messages that remain in the active context", async () => {
  const root = await mkdtemp(join(tmpdir(), "conversation-compaction-"));
  const directory = encodedConversationDirectory(root, "local-conv-test");
  await mkdir(directory, { recursive: true });

  const active = JSON.stringify({ id: "message-active", role: "user", text: "A" });
  const archived = JSON.stringify({
    id: "message-archived",
    role: "user",
    data: "X".repeat(10_000),
  });
  await writeFile(
    join(directory, "conversation.json"),
    JSON.stringify({ in_context_message_ids: ["message-active"] }),
  );
  await writeFile(join(directory, "messages.jsonl"), `${active}\n${archived}\n`);
  await writeFile(join(directory, "system-prompt.json"), "prompt");

  try {
    const measured = await measureConversationContextBytes(
      root,
      "local-conv-test",
    );
    assert.equal(measured.messageBytes, Buffer.byteLength(active) + 1);
    assert.equal(measured.systemPromptBytes, 6);
    assert.equal(measured.inContextMessageCount, 1);
    assert.equal(
      measured.totalBytes,
      Buffer.byteLength(active) + 1 + measured.systemPromptBytes,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("uses the byte threshold and supports disabling compaction", () => {
  const context = {
    messageBytes: 690_000,
    systemPromptBytes: 10_000,
    totalBytes: 700_000,
    inContextMessageCount: 20,
  };
  assert.equal(contextNeedsCompaction(context, 700_000), true);
  assert.equal(contextNeedsCompaction(context, 700_001), false);
  assert.equal(contextNeedsCompaction(context, 700_001, 1), true);
  assert.equal(contextNeedsCompaction(context, 0), false);
});

test("includes the pending multimodal message in the compaction decision", () => {
  const context = {
    messageBytes: 580_000,
    systemPromptBytes: 18_000,
    totalBytes: 598_000,
    inContextMessageCount: 22,
  };
  const message = [
    { type: "text", text: "analyze these images" },
    {
      type: "image",
      source: {
        type: "base64",
        media_type: "image/png",
        data: "A".repeat(480_000),
      },
    },
  ];
  const pendingBytes = estimatePendingMessageBytes(message);

  assert.ok(pendingBytes > 480_000);
  assert.equal(contextNeedsCompaction(context, 700_000), false);
  assert.equal(contextNeedsCompaction(context, 700_000, pendingBytes), true);
});

test("supports legacy positional in-context message ids", async () => {
  const root = await mkdtemp(join(tmpdir(), "conversation-compaction-legacy-"));
  const directory = encodedConversationDirectory(root, "local-conv-legacy");
  await mkdir(directory, { recursive: true });

  const session = JSON.stringify({ id: "local-conv-legacy", type: "session" });
  const first = JSON.stringify({ id: "stored-a", role: "user", text: "A" });
  const second = JSON.stringify({ id: "stored-b", role: "assistant", text: "B" });
  await writeFile(
    join(directory, "conversation.json"),
    JSON.stringify({ in_context_message_ids: ["ui-msg-2"] }),
  );
  await writeFile(
    join(directory, "messages.jsonl"),
    `${session}\n${first}\n${second}\n`,
  );

  try {
    const measured = await measureConversationContextBytes(
      root,
      "local-conv-legacy",
    );
    assert.equal(measured.messageBytes, Buffer.byteLength(second) + 1);
    assert.equal(measured.inContextMessageCount, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
