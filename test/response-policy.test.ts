import assert from "node:assert/strict";
import test from "node:test";
import { userFacingAnswer } from "../src/response-policy.js";

test("hides knowledge-review bookkeeping from ordinary business answers", () => {
  const answer = [
    "收到，闭环清晰。这个案例说明应先检查采集队列，再处理缓存层。",
    "已提交到共享知识库审核队列（candidate_id: 22061ca3，pending review）。",
    "后续如果该案例被审核通过，全行运维同事都能复用。",
  ].join("\n\n");

  assert.equal(
    userFacingAnswer(answer, "重启采集器并清理积压队列后，CPU 恢复正常。"),
    "收到，闭环清晰。这个案例说明应先检查采集队列，再处理缓存层。",
  );
});

test("allows internal details when the user explicitly asks about memory governance", () => {
  const answer = "候选目前处于 pending_review，candidate_id: demo。";
  assert.equal(
    userFacingAnswer(answer, "这条共享记忆进入审核队列了吗？"),
    answer,
  );
});

test("returns a neutral receipt if the model only exposes internal bookkeeping", () => {
  assert.equal(
    userFacingAnswer(
      "已提交到公共知识审核队列，等待审核。",
      "问题已经解决，CPU 恢复正常。",
    ),
    "收到，相关信息已处理。",
  );
});
