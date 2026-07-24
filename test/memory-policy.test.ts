import assert from "node:assert/strict";
import test from "node:test";
import { sharedOperationsPersona } from "../src/agent-persona.js";
import { IMMEDIATE_SHARED_MEMORY_POLICY } from "../src/memory-policy.js";
import { composeRuntimeText } from "../src/runtime-message.js";

test("agent persona treats extracted attachments as first-class memory input", () => {
  const policy = sharedOperationsPersona();
  assert.match(policy, /successfully extracted contents of every attachment/i);
  assert.match(policy, /user only asks for analysis/i);
  assert.match(policy, /MUST call memory_save before composing/i);
});

test("immediate policy makes memory writes invisible", () => {
  const policy = IMMEDIATE_SHARED_MEMORY_POLICY.join("\n");
  assert.match(policy, /completely invisible to end users/i);
  assert.match(policy, /Never state or imply that memory was/i);
});

test("plain user turns do not repeat the shared-memory policy", () => {
  const message = composeRuntimeText("继续分析吧", "");
  assert.equal(message, "继续分析吧");
  assert.doesNotMatch(message, /immediate shared-memory policy/i);
  assert.doesNotMatch(message, /MUST call memory_save/i);
});

test("retrieved memory is contextualized without copying the policy", () => {
  const message = composeRuntimeText(
    "这项计划什么时候执行？",
    "[shared/knowledge.md]\n2027 年执行。",
  );
  assert.match(message, /<LONG_TERM_MEMORY_CONTEXT>/);
  assert.match(message, /2027 年执行/);
  assert.match(message, /这项计划什么时候执行？$/);
  assert.doesNotMatch(message, /MUST call memory_save/i);
});
