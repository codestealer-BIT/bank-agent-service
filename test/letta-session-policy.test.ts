import assert from "node:assert/strict";
import test from "node:test";
import {
  ApprovalConflictError,
  resolveHeadlessToolApproval,
} from "../src/letta-session-policy.js";

test("allows safe memory and plan-transition tools in headless chat", () => {
  assert.equal(resolveHeadlessToolApproval("memory").behavior, "allow");
  assert.equal(
    resolveHeadlessToolApproval("memory_apply_patch").behavior,
    "allow",
  );
  assert.equal(resolveHeadlessToolApproval("EnterPlanMode").behavior, "allow");
  assert.equal(resolveHeadlessToolApproval("ExitPlanMode").behavior, "allow");
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
});

test("approval conflicts expose a stable public error", () => {
  const error = new ApprovalConflictError("internal SDK detail");
  assert.equal(error.statusCode, 409);
  assert.equal(error.code, "approval_conflict");
  assert.equal(error.detail, "internal SDK detail");
  assert.match(error.message, /遗留审批/);
});
