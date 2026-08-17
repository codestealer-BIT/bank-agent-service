import assert from "node:assert/strict";
import test from "node:test";
import { sharedOperationsPersona } from "../src/agent-persona.js";
import {
  BANK_OPERATIONS_MEMORY_SCOPE_POLICY,
  IMMEDIATE_SHARED_MEMORY_POLICY,
} from "../src/memory-policy.js";
import { composeRuntimeText } from "../src/runtime-message.js";

test("agent persona restricts attachment memory to bank operations knowledge", () => {
  const policy = sharedOperationsPersona();
  assert.match(policy, /successfully extracted attachments/i);
  assert.match(policy, /directly and materially about bank infrastructure/i);
  assert.match(policy, /competition or student-project materials/i);
  assert.match(policy, /If and only if an item satisfies all eligibility requirements/i);
});

test("immediate policy makes memory writes invisible", () => {
  const policy = IMMEDIATE_SHARED_MEMORY_POLICY.join("\n");
  assert.match(policy, /completely invisible to end users/i);
  assert.match(policy, /Never state or imply that memory was/i);
});

test("immediate policy allows only stable bank operations lessons and policies", () => {
  const policy = IMMEDIATE_SHARED_MEMORY_POLICY.join("\n");
  assert.match(policy, /bank_operations_lesson/i);
  assert.match(policy, /bank_operations_policy/i);
  assert.match(policy, /real and verified bank operations situation/i);
  assert.match(policy, /confirmed and currently applicable bank operations rule/i);
  assert.match(policy, /If relevance, verification, durability, or policy status is uncertain/i);
});

test("shared bank operations scope policy is included in immediate memory", () => {
  for (const rule of BANK_OPERATIONS_MEMORY_SCOPE_POLICY) {
    assert.ok(IMMEDIATE_SHARED_MEMORY_POLICY.includes(rule));
  }
});

test("plain user turns include Beijing time but not shared-memory policy", () => {
  const message = composeRuntimeText("Continue analysis.", "");
  assert.match(message, /<CURRENT_TIME_CONTEXT>/);
  assert.match(message, /当前北京时间:/);
  assert.match(message, /Continue analysis\.$/);
  assert.doesNotMatch(message, /immediate shared-memory policy/i);
  assert.doesNotMatch(message, /MUST call memory_save/i);
});

test("retrieved memory is contextualized without copying the policy", () => {
  const message = composeRuntimeText(
    "When does this plan run?",
    "[shared/knowledge.md]\nExecute in 2027.",
  );
  assert.match(message, /<CURRENT_TIME_CONTEXT>/);
  assert.match(message, /<LONG_TERM_MEMORY_CONTEXT>/);
  assert.match(message, /Execute in 2027/);
  assert.match(message, /When does this plan run\?$/);
  assert.doesNotMatch(message, /MUST call memory_save/i);
});
