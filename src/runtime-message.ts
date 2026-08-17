const beijingTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "long",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function composeTimeContext(): string {
  const now = new Date();
  return [
    "<CURRENT_TIME_CONTEXT>",
    `当前北京时间: ${beijingTimeFormatter.format(now)} (UTC+8).`,
    `当前 UTC 时间: ${now.toISOString()}.`,
    "除非用户明确要求其他时区，所有面向用户的当前时间、日期、今天、明天、昨天和排程解释都按北京时间回答。",
    "</CURRENT_TIME_CONTEXT>",
  ].join("\n");
}

export function composeRuntimeText(
  userMessage: string,
  memoryContext: string,
): string {
  const sections = [composeTimeContext()];
  if (memoryContext) {
    sections.push(
      [
        "<LONG_TERM_MEMORY_CONTEXT>",
        memoryContext,
        "</LONG_TERM_MEMORY_CONTEXT>",
        "",
        "Use the memory context only when it is relevant. Do not reveal memory paths unless the user asks how memory was used.",
      ].join("\n"),
    );
  }
  sections.push(userMessage);
  return sections.join("\n\n");
}
