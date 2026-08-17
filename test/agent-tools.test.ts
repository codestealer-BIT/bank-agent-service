import assert from "node:assert/strict";
import test from "node:test";
import { createOperationsTools } from "../src/agent-tools.js";

function toolNames(options?: Parameters<typeof createOperationsTools>[2]): string[] {
  return createOperationsTools("test-user", "test-agent", options).map(
    (tool) => tool.name,
  );
}

test("keeps email available for ordinary conversations", () => {
  assert.ok(toolNames().includes("send_email"));
});

test("removes email from non-email scheduled executions", () => {
  const names = toolNames({ includeEmail: false });
  assert.ok(!names.includes("send_email"));
  assert.ok(names.includes("get_infrastructure_summary"));
});

test("keeps email for schedules with a backend-bound recipient", () => {
  assert.ok(
    toolNames({
      includeEmail: true,
      emailRecipient: "operations@example.com",
    }).includes("send_email"),
  );
});
