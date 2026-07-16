import type { CanUseToolResponse } from "@letta-ai/letta-agent-sdk";

export const APPROVAL_RECOVERY_TIMEOUT_MS = 10_000;
export const MAX_APPROVAL_RECOVERY_ATTEMPTS = 2;

const HEADLESS_SAFE_TOOLS = new Set([
  "EnterPlanMode",
  "ExitPlanMode",
  "memory",
  "memory_apply_patch",
]);

export function resolveHeadlessToolApproval(
  toolName: string,
): CanUseToolResponse {
  if (HEADLESS_SAFE_TOOLS.has(toolName)) {
    return { behavior: "allow" };
  }

  return {
    behavior: "deny",
    message:
      toolName === "AskUserQuestion"
        ? "This chat has no interactive tool UI. Ask the question in a normal assistant message instead."
        : `Tool ${toolName} is not available in this banking chat.`,
    interrupt: false,
  };
}

export class ApprovalConflictError extends Error {
  readonly statusCode = 409;
  readonly code = "approval_conflict";
  readonly detail?: string;

  constructor(detail?: string) {
    super(
      "助手会话中有一项遗留审批未能自动恢复，请稍后重试；如果仍然失败，请新建会话。",
    );
    this.name = "ApprovalConflictError";
    this.detail = detail;
  }
}
