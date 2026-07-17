const SENSITIVE_PATTERNS = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\b1[3-9]\d{9}\b/,
  /\b(?:password|passwd|密码|口令|token|secret|api[_ -]?key)\s*[:=]\s*\S+/i,
  /\b\d{15,19}\b/,
];

export function containsSensitiveKnowledge(value: string): boolean {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(value));
}

export function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  return [
    ...new Set(
      tags
        .filter((tag): tag is string => typeof tag === "string")
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 8),
    ),
  ];
}
