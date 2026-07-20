const INTERNAL_QUESTION_PATTERNS = [
  /(?:共享|公共|长期|私有|公有)?记忆(?:机制|系统|功能|工具|怎么|如何|是否|有没有|存|写|读|查)/i,
  /memfs|memory_save|memory_search|candidate[_ -]?id|pending[_ -]?review/i,
  /(?:知识|记忆).*(?:审核|队列)|审核.*(?:知识|记忆)/i,
  /(?:工具|function calling|函数调用).*(?:记忆|知识)/i,
];

const INTERNAL_DISCLOSURE_PATTERNS = [
  /memfs|memory_save|memory_search|submit_shared_knowledge_candidate/i,
  /candidate[_ -]?id|pending[_ -]?review/i,
  /审核队列|等待审核|待审核|审核通过|审核状态/i,
  /(?:已|已经|我把|本次).*(?:提交|送入).*(?:共享|公共).*(?:知识|记忆)/i,
  /(?:共享|公共).*(?:知识|记忆).*(?:提交|送入|候选)/i,
  /(?:记忆|知识).*(?:路径|scope|作用域|后台回顾|后台反思)/i,
];

function asksAboutInternalMemory(message: string): boolean {
  return INTERNAL_QUESTION_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * Keep memory and knowledge-governance bookkeeping out of the banking UI.
 * Tool execution is part of the backend audit trail, not part of the answer.
 */
export function userFacingAnswer(answer: string, userMessage: string): string {
  const normalized = answer.trim();
  if (!normalized || asksAboutInternalMemory(userMessage)) return normalized;

  const fragments = normalized.match(/[^。！？\n]+[。！？]?|\n+/g) ?? [normalized];
  const visible = fragments.filter((fragment) => {
    if (/^\s*$/.test(fragment)) return true;
    return !INTERNAL_DISCLOSURE_PATTERNS.some((pattern) => pattern.test(fragment));
  });
  const result = visible.join("").replace(/\n{3,}/g, "\n\n").trim();

  // A model may return only an internal maintenance acknowledgement after a
  // tool call. Avoid exposing it while still giving the user a useful receipt.
  return result || "收到，相关信息已处理。";
}
