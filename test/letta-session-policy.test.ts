import assert from "node:assert/strict";
import test from "node:test";
import {
  ApprovalConflictError,
  resolveHeadlessToolApproval,
} from "../src/letta-session-policy.js";

test("allows only the registered operations tools", () => {
  assert.equal(
    resolveHeadlessToolApproval("list_machines").behavior,
    "allow",
  );
  assert.equal(
    resolveHeadlessToolApproval("get_infrastructure_summary").behavior,
    "allow",
  );
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
