export function composeRuntimeText(
  userMessage: string,
  memoryContext: string,
): string {
  if (!memoryContext) return userMessage;
  return [
    "<LONG_TERM_MEMORY_CONTEXT>",
    memoryContext,
    "</LONG_TERM_MEMORY_CONTEXT>",
    "",
    "Use the memory context only when it is relevant. Do not reveal memory paths unless the user asks how memory was used.",
    "",
    userMessage,
  ].join("\n");
}
