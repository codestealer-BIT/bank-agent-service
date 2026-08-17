export type ModelAttemptContext = {
  model: string;
  modelIndex: number;
  attempt: number;
  maxAttempts: number;
};

export type ModelFailoverOptions = {
  models: readonly string[];
  primaryAttempts: number;
  fallbackAttempts: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
  onFailure?: (context: ModelAttemptContext & {
    error: unknown;
    nextModel: string | null;
    delayMs: number;
  }) => void;
};

export type ModelFailoverResult<T> = {
  value: T;
  model: string;
  totalAttempts: number;
};

const NON_RETRYABLE_STATUS_CODES = new Set([400, 401, 403, 404, 405, 413, 415, 422]);
const RETRYABLE_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const RETRYABLE_ERROR_CODES = new Set([
  "ABORT_ERR",
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETDOWN",
  "ENETUNREACH",
  "ENOTFOUND",
  "EPIPE",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);

const NON_RETRYABLE_PATTERNS = [
  /authentication|unauthori[sz]ed|forbidden|invalid api key|incorrect api key/i,
  /bad request|invalid request|invalid_request/i,
  /context.{0,20}(length|window|limit)|maximum context|too many tokens/i,
  /content policy|safety policy|unsupported (?:media|input|parameter)/i,
  /payload too large|request entity too large/i,
  /(?:status|error|http)[^\n]{0,12}(?:400|401|403|404|405|413|415|422)\b/i,
];

const RETRYABLE_PATTERNS = [
  /rate.?limit|too many requests|quota.*temporar/i,
  /timeout|timed out|deadline exceeded|operation was aborted/i,
  /connection (?:closed|refused|reset)|socket hang up|network error/i,
  /overload|capacity|temporar(?:y|ily)|try again|service unavailable/i,
  /bad gateway|gateway timeout|internal server error/i,
  /upstream|provider.*(?:error|failed|unavailable)/i,
  /agent (?:turn|stream) failed|stream ended without a final result/i,
  /(?:status|error|http)[^\n]{0,12}(?:408|409|425|429|5\d\d)\b/i,
];

export class ModelFailoverSuppressedError extends Error {
  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = "ModelFailoverSuppressedError";
  }
}

function errorChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  const seen = new Set<unknown>();
  let current = error;
  while (current != null && !seen.has(current) && chain.length < 8) {
    chain.push(current);
    seen.add(current);
    if (typeof current !== "object") break;
    current = (current as { cause?: unknown }).cause;
  }
  return chain;
}

function numericStatus(error: unknown): number | null {
  for (const item of errorChain(error)) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as {
      status?: unknown;
      statusCode?: unknown;
      response?: { status?: unknown };
    };
    for (const value of [candidate.status, candidate.statusCode, candidate.response?.status]) {
      if (typeof value === "number") return value;
      if (typeof value === "string" && /^\d{3}$/.test(value)) return Number(value);
    }
  }
  return null;
}

function errorCode(error: unknown): string | null {
  for (const item of errorChain(error)) {
    if (!item || typeof item !== "object") continue;
    const code = (item as { code?: unknown }).code;
    if (typeof code === "string" && code) return code.toUpperCase();
  }
  return null;
}

function errorText(error: unknown): string {
  return errorChain(error)
    .map((item) => {
      if (item instanceof Error) return `${item.name}: ${item.message}`;
      if (typeof item === "string") return item;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export function isRetryableModelError(error: unknown): boolean {
  if (error instanceof ModelFailoverSuppressedError) return false;

  const status = numericStatus(error);
  if (status != null) {
    if (NON_RETRYABLE_STATUS_CODES.has(status)) return false;
    if (RETRYABLE_STATUS_CODES.has(status) || status >= 500) return true;
  }

  const code = errorCode(error);
  if (code && RETRYABLE_ERROR_CODES.has(code)) return true;

  const text = errorText(error);
  if (NON_RETRYABLE_PATTERNS.some((pattern) => pattern.test(text))) return false;
  return RETRYABLE_PATTERNS.some((pattern) => pattern.test(text));
}

export function computeModelBackoffMs(
  failureIndex: number,
  baseMs: number,
  maxMs: number,
  random = Math.random,
): number {
  const exponential = Math.min(maxMs, baseMs * 2 ** Math.max(0, failureIndex - 1));
  const jitter = Math.floor(exponential * 0.25 * random());
  return Math.min(maxMs, exponential + jitter);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runWithModelFailover<T>(
  options: ModelFailoverOptions,
  work: (context: ModelAttemptContext) => Promise<T>,
): Promise<ModelFailoverResult<T>> {
  if (options.models.length === 0) {
    throw new Error("At least one agent model must be configured");
  }

  let failureIndex = 0;
  let totalAttempts = 0;
  let lastError: unknown;

  for (let modelIndex = 0; modelIndex < options.models.length; modelIndex += 1) {
    const model = options.models[modelIndex];
    const maxAttempts = modelIndex === 0
      ? options.primaryAttempts
      : options.fallbackAttempts;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      totalAttempts += 1;
      try {
        return {
          value: await work({ model, modelIndex, attempt, maxAttempts }),
          model,
          totalAttempts,
        };
      } catch (error) {
        lastError = error;
        if (!isRetryableModelError(error)) throw error;

        failureIndex += 1;
        const retrySameModel = attempt < maxAttempts;
        const nextModel = retrySameModel
          ? model
          : options.models[modelIndex + 1] ?? null;
        if (!nextModel) throw error;

        const delayMs = computeModelBackoffMs(
          failureIndex,
          options.backoffBaseMs,
          options.backoffMaxMs,
        );
        options.onFailure?.({
          model,
          modelIndex,
          attempt,
          maxAttempts,
          error,
          nextModel,
          delayMs,
        });
        await sleep(delayMs);
      }
    }
  }

  throw lastError ?? new Error("All configured agent models failed");
}
