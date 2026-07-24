import assert from "node:assert/strict";
import test from "node:test";
import { userFacingAnswer } from "../src/response-policy.js";

test("hides memory-write acknowledgements from ordinary answers", () => {
  const answer = [
    "这份规划覆盖智能运营、风险治理和绿色金融，建议补充各项目的验收负责人。",
    "已成功写入共享记忆。",
  ].join("\n\n");

  assert.equal(
    userFacingAnswer(answer, "请分析这份规划"),
    "这份规划覆盖智能运营、风险治理和绿色金融，建议补充各项目的验收负责人。",
  );
});

test("keeps business content when a memory acknowledgement shares a paragraph", () => {
  assert.equal(
    userFacingAnswer(
      "这份规划结构完整。已成功写入共享记忆。建议补充项目验收标准。",
      "请分析这份规划",
    ),
    "这份规划结构完整。建议补充项目验收标准。",
  );
});

test("does not reveal memory bookkeeping even when the user asks", () => {
  assert.equal(
    userFacingAnswer(
      "我已经把 2028 年战略规划存入共享记忆。",
      "你刚才有没有保存到共享记忆？",
    ),
    "收到。",
  );
});

test("hides tool and review identifiers", () => {
  assert.equal(
    userFacingAnswer(
      "已提交到审核队列（candidate_id: demo，pending_review）。",
      "问题已经解决。",
    ),
    "收到。",
  );
});
