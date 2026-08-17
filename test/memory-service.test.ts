import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("memory service stores one shared knowledge pool and chunks it for RAG", async () => {
  const root = await mkdtemp(join(tmpdir(), "bank-agent-memory-"));
  process.env.LETTA_LOCAL_BACKEND_DIR = root;
  const { chunkMemoryDocument, memoryRoot, saveMemory } = await import(
    "../src/memory-service.js"
  );

  try {
    const rejected = await saveMemory({
      agentId: "agent-test",
      content: "A generic research summary must not enter bank operations memory.",
      category: "reusable_operations_lesson",
    });
    assert.equal(rejected.saved, false);
    assert.match(rejected.reason ?? "", /bank_operations_lesson/);

    const saved = await saveMemory({
      agentId: "agent-test",
      content:
        "The confirmed infrastructure plan is to purchase 10086 Huawei servers and retire 1024 ZTE servers next year.",
      category: "bank_operations_policy",
      tags: ["procurement-plan"],
    });

    assert.equal(saved.saved, true);
    assert.equal(saved.path, "shared/knowledge.md");

    const stored = await readFile(
      join(memoryRoot("agent-test"), "shared", "knowledge.md"),
      "utf8",
    );
    assert.match(stored, /10086 Huawei servers/);
    assert.match(stored, /1024 ZTE servers/);

    const conflicting = await saveMemory({
      agentId: "agent-test",
      content:
        "A different confirmed infrastructure plan is to purchase 12000 Inspur servers and retain the existing ZTE fleet next year.",
      category: "bank_operations_policy",
      tags: ["procurement-plan"],
    });
    assert.equal(conflicting.saved, true);

    const storedWithConflict = await readFile(
      join(memoryRoot("agent-test"), "shared", "knowledge.md"),
      "utf8",
    );
    assert.match(storedWithConflict, /10086 Huawei servers/);
    assert.match(storedWithConflict, /12000 Inspur servers/);

    await Promise.all([
      saveMemory({
        agentId: "agent-test",
        content: "Concurrent planning record alpha must remain available.",
        category: "bank_operations_policy",
      }),
      saveMemory({
        agentId: "agent-test",
        content: "Concurrent planning record beta must remain available.",
        category: "bank_operations_policy",
      }),
    ]);

    const storedAfterConcurrentWrites = await readFile(
      join(memoryRoot("agent-test"), "shared", "knowledge.md"),
      "utf8",
    );
    assert.match(storedAfterConcurrentWrites, /record alpha/);
    assert.match(storedAfterConcurrentWrites, /record beta/);

    const chunks = chunkMemoryDocument(storedAfterConcurrentWrites, 300, 40);
    assert.equal(chunks.length, 4);
    assert.match(chunks[0], /10086/);
    assert.match(chunks[1], /12000/);
    assert.doesNotMatch(chunks[0], /^---/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("long memory blocks are split with overlap", async () => {
  const { chunkMemoryDocument } = await import("../src/memory-service.js");
  const content = `---\ndescription: test\n---\n\n${"A".repeat(360)}`;
  const chunks = chunkMemoryDocument(content, 300, 50);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].length, 300);
  assert.equal(chunks[1].length, 110);
  assert.equal(chunks[0].slice(-50), chunks[1].slice(0, 50));
});

test("keeps timestamped memory records in stable independent chunks", async () => {
  const { chunkMemoryDocument } = await import("../src/memory-service.js");
  const content = [
    "---",
    "description: test",
    "---",
    "",
    "- 2026-01-01T00:00:00.000Z (plan): Existing version.",
    "- 2026-02-01T00:00:00.000Z (plan): Candidate version.",
  ].join("\n");

  const chunks = chunkMemoryDocument(content, 300, 50);
  assert.deepEqual(chunks, [
    "- 2026-01-01T00:00:00.000Z (plan): Existing version.",
    "- 2026-02-01T00:00:00.000Z (plan): Candidate version.",
  ]);
});

test("formats retrieved versions without internal memory metadata", async () => {
  const { formatMemoryContext } = await import("../src/memory-service.js");
  const context = formatMemoryContext([
    {
      path: "shared/knowledge.md",
      content:
        "- 2026-08-05T06:30:00.000Z (organization-plan) [strategy]: Revenue target is 8%.",
      score: 0.9,
      scope: "shared",
    },
  ]);

  assert.equal(context, "Evidence version 1:\nRevenue target is 8%.");
  assert.doesNotMatch(context, /2026-08-05T/);
  assert.doesNotMatch(context, /knowledge\.md|shared|organization-plan|strategy/);
});
