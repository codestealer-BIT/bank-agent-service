import assert from "node:assert/strict";
import test from "node:test";
import { OPERATIONS_TOOL_NAMES } from "../src/agent-tools.js";
import {
  ApprovalConflictError,
  resolveHeadlessToolApproval,
} from "../src/letta-session-policy.js";

test("allows only the registered operations tools", () => {
  for (const toolName of OPERATIONS_TOOL_NAMES) {
    assert.equal(resolveHeadlessToolApproval(toolName).behavior, "allow");
  }
  assert.ok(OPERATIONS_TOOL_NAMES.includes("send_email"));
  assert.equal(resolveHeadlessToolApproval("EnterPlanMode").behavior, "deny");
  assert.equal(resolveHeadlessToolApproval("ExitPlanMode").behavior, "deny");
});

test("denies tools that require unsupported UI or broader access", () => {
  const interactive = resolveHeadlessToolApproval("AskUserQuestion");
  assert.equal(interactive.behavior, "deny");
  assert.match(
    interactive.behavior === "deny" ? interactive.message : "",
    /normal assistant message/,
  );

  const shell = resolveHeadlessToolApproval("Bash");
  assert.equal(shell.behavior, "deny");
  assert.equal(resolveHeadlessToolApproval("memory_apply_patch").behavior, "deny");
});

test("approval conflicts expose a stable public error", () => {
  const error = new ApprovalConflictError("internal SDK detail");
  assert.equal(error.statusCode, 409);
  assert.equal(error.code, "approval_conflict");
  assert.equal(error.detail, "internal SDK detail");
  assert.match(error.message, /遗留审批/);
});
