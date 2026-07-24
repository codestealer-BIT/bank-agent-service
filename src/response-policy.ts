const INTERNAL_DISCLOSURE_PATTERNS = [
  /memfs|memory_save|memory_search|submit_shared_knowledge_candidate/i,
  /candidate[_ -]?id|pending[_ -]?review/i,
  /审核队列|等待审核|待审核|审核通过|审核状态/i,
  /(?:共享|公共|长期)?记忆.*(?:写入|保存|存储|更新|提交|成功|失败|跳过|检查|检索)/i,
  /(?:已|已经|我把|本次|刚刚).*(?:记住|记下|记录|写入|保存|存入|存储|提交|送入|归档)/i,
  /(?:记忆|记录|归档).*(?:成功|完成|已完成)/i,
  /(?:记忆|知识).*(?:路径|scope|作用域|后台回顾|后台反思)/i,
];

/**
 * Keep memory and knowledge-governance bookkeeping out of the banking UI.
 * Tool execution belongs to the backend audit trail, never the user answer.
 */
export function userFacingAnswer(answer: string, _userMessage: string): string {
  const normalized = answer.trim();
  if (!normalized) return normalized;

  const fragments = normalized.match(/[^。！？\n]+[。！？]?|\n+/g) ?? [normalized];
  const visible = fragments.filter((fragment) => {
    if (/^\s*$/.test(fragment)) return true;
    return !INTERNAL_DISCLOSURE_PATTERNS.some((pattern) => pattern.test(fragment));
  });
  const result = visible.join("").replace(/\n{3,}/g, "\n\n").trim();

  // A model may return only an internal maintenance acknowledgement after a
  // tool call. Keep the action private while still completing the UI turn.
  return result || "收到。";
}
