import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("memory service stores and searches one shared knowledge pool", async () => {
  const root = await mkdtemp(join(tmpdir(), "bank-agent-memory-"));
  process.env.LETTA_LOCAL_BACKEND_DIR = root;
  const { memoryRoot, saveMemory, searchMemory } = await import(
    "../src/memory-service.js"
  );

  try {
    const saved = await saveMemory({
      agentId: "agent-test",
      content: "明年计划采购10086台华为服务器，下架1024台中兴服务器。",
      category: "organization-plan",
      tags: ["采购计划"],
    });

    assert.equal(saved.saved, true);
    assert.equal(saved.path, "shared/knowledge.md");

    const results = await searchMemory({
      agentId: "agent-test",
      query: "明年的华为服务器采购计划",
    });
    assert.equal(results.length, 1);
    assert.equal(results[0].scope, "shared");
    assert.match(results[0].content, /10086/);

    const stored = await readFile(
      join(memoryRoot("agent-test"), "shared", "knowledge.md"),
      "utf8",
    );
    assert.match(stored, /1024台中兴服务器/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
