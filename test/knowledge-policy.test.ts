import assert from "node:assert/strict";
import test from "node:test";
import {
  containsSensitiveKnowledge,
  normalizeTags,
} from "../src/knowledge-policy.js";

test("blocks common private and credential-like content", () => {
  assert.equal(containsSensitiveKnowledge("联系人 user@example.com"), true);
  assert.equal(containsSensitiveKnowledge("password=demo-secret"), true);
  assert.equal(containsSensitiveKnowledge("手机号 13800138000"), true);
});

test("accepts reusable operational knowledge without private data", () => {
  assert.equal(
    containsSensitiveKnowledge(
      "CPU 告警由日志采集进程异常重试引起，重启采集器后恢复。",
    ),
    false,
  );
  assert.deepEqual(normalizeTags(["CPU", " cpu ", "日志", "", 3]), [
    "cpu",
    "日志",
  ]);
});
