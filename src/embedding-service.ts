import { config } from "./config.js";

export const BGE_M3_DIMENSIONS = 1_024;
const MAX_EMBEDDING_BATCH = 32;

type EmbeddingResponse = {
  data?: Array<{
    index?: number;
    embedding?: number[];
  }>;
};

export type EmbeddingRequestOptions = {
  baseUrl: string;
  apiKey?: string;
  model: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
};

function endpoint(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, "");
  return normalized.endsWith("/embeddings")
    ? normalized
    : `${normalized}/embeddings`;
}

function validateVector(value: unknown, index: number): number[] {
  if (!Array.isArray(value) || value.length !== BGE_M3_DIMENSIONS) {
    throw new Error(
      `BGE-M3 embedding ${index} returned an invalid dimension (expected ${BGE_M3_DIMENSIONS})`,
    );
  }
  const vector = value.map(Number);
  if (vector.some((item) => !Number.isFinite(item))) {
    throw new Error(`BGE-M3 embedding ${index} contains a non-finite value`);
  }
  return vector;
}

export async function requestEmbeddings(
  texts: string[],
  options: EmbeddingRequestOptions,
): Promise<number[][]> {
  if (!texts.length) return [];
  if (texts.length > MAX_EMBEDDING_BATCH) {
    throw new Error(`Embedding batch exceeds ${MAX_EMBEDDING_BATCH} inputs`);
  }
  if (texts.some((text) => !text.trim())) {
    throw new Error("Embedding input cannot be empty");
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (options.apiKey) headers.authorization = `Bearer ${options.apiKey}`;

  const response = await (options.fetchImpl ?? fetch)(endpoint(options.baseUrl), {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: options.model,
      input: texts,
      encoding_format: "float",
    }),
    signal: AbortSignal.timeout(options.timeoutMs),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(
      `BGE-M3 embedding service returned HTTP ${response.status}: ${detail}`,
    );
  }

  const payload = (await response.json()) as EmbeddingResponse;
  const ordered = [...(payload.data ?? [])].sort(
    (left, right) => (left.index ?? 0) - (right.index ?? 0),
  );
  if (ordered.length !== texts.length) {
    throw new Error(
      `BGE-M3 embedding service returned ${ordered.length} vectors for ${texts.length} inputs`,
    );
  }
  return ordered.map((item, index) => validateVector(item.embedding, index));
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const vectors: number[][] = [];
  for (let offset = 0; offset < texts.length; offset += MAX_EMBEDDING_BATCH) {
    vectors.push(
      ...(await requestEmbeddings(texts.slice(offset, offset + MAX_EMBEDDING_BATCH), {
        baseUrl: config.RAG_EMBEDDING_BASE_URL,
        apiKey: config.RAG_EMBEDDING_API_KEY,
        model: config.RAG_EMBEDDING_MODEL,
        timeoutMs: config.RAG_EMBEDDING_TIMEOUT_MS,
      })),
    );
  }
  return vectors;
}

export function vectorSql(vector: number[]): string {
  if (vector.length !== BGE_M3_DIMENSIONS) {
    throw new Error(`Cannot store a non-${BGE_M3_DIMENSIONS}-dimension vector`);
  }
  return `[${vector.join(",")}]`;
}
