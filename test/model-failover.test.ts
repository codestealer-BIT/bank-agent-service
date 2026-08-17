import assert from "node:assert/strict";
import test from "node:test";
import {
  computeModelBackoffMs,
  isRetryableModelError,
  ModelFailoverSuppressedError,
  runWithModelFailover,
} from "../src/model-failover.js";

test("classifies transient provider and transport failures as retryable", () => {
  assert.equal(isRetryableModelError({ status: 429 }), true);
  assert.equal(isRetryableModelError({ response: { status: 503 } }), true);
  assert.equal(isRetryableModelError({ code: "ETIMEDOUT" }), true);
  assert.equal(isRetryableModelError(new Error("upstream model overloaded")), true);
});

test("does not retry deterministic request or authentication failures", () => {
  assert.equal(isRetryableModelError({ statusCode: 400 }), false);
  assert.equal(isRetryableModelError({ statusCode: 401 }), false);
  assert.equal(isRetryableModelError(new Error("maximum context length exceeded")), false);
  assert.equal(isRetryableModelError(new Error("invalid API key")), false);
});

test("retries MiniMax before falling back in configured order", async () => {
  const attempts: string[] = [];
  const result = await runWithModelFailover(
    {
      models: ["MiniMax-M3", "Kimi-K3", "GLM-5.2", "Kimi-K2.7-Code"],
      primaryAttempts: 2,
      fallbackAttempts: 1,
      backoffBaseMs: 0,
      backoffMaxMs: 0,
    },
    async ({ model }) => {
      attempts.push(model);
      if (model !== "GLM-5.2") throw Object.assign(new Error("overloaded"), { status: 503 });
      return "ok";
    },
  );

  assert.deepEqual(attempts, ["MiniMax-M3", "MiniMax-M3", "Kimi-K3", "GLM-5.2"]);
  assert.equal(result.value, "ok");
  assert.equal(result.model, "GLM-5.2");
  assert.equal(result.totalAttempts, 4);
});

test("stops immediately for non-retryable failures", async () => {
  const attempts: string[] = [];
  await assert.rejects(
    runWithModelFailover(
      {
        models: ["MiniMax-M3", "Kimi-K3"],
        primaryAttempts: 2,
        fallbackAttempts: 1,
        backoffBaseMs: 0,
        backoffMaxMs: 0,
      },
      async ({ model }) => {
        attempts.push(model);
        throw Object.assign(new Error("bad request"), { status: 400 });
      },
    ),
    /bad request/,
  );
  assert.deepEqual(attempts, ["MiniMax-M3"]);
});

test("suppresses failover after a streaming response has become visible", () => {
  const error = new ModelFailoverSuppressedError(
    "stream already visible",
    Object.assign(new Error("upstream timeout"), { status: 504 }),
  );
  assert.equal(isRetryableModelError(error), false);
});

test("uses capped exponential backoff with bounded jitter", () => {
  assert.equal(computeModelBackoffMs(1, 500, 8_000, () => 0), 500);
  assert.equal(computeModelBackoffMs(3, 500, 8_000, () => 0), 2_000);
  assert.equal(computeModelBackoffMs(3, 500, 8_000, () => 1), 2_500);
  assert.equal(computeModelBackoffMs(10, 500, 8_000, () => 1), 8_000);
});
