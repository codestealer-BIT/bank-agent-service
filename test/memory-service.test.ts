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
    const saved = await saveMemory({
      agentId: "agent-test",
      content:
        "The confirmed infrastructure plan is to purchase 10086 Huawei servers and retire 1024 ZTE servers next year.",
      category: "organization-plan",
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

    const chunks = chunkMemoryDocument(stored, 300, 40);
    assert.equal(chunks.length, 1);
    assert.match(chunks[0], /10086/);
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
