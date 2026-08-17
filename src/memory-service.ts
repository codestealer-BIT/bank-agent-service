import { createHash } from "node:crypto";
import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { config } from "./config.js";
import { pool } from "./database.js";
import { embedTexts, vectorSql } from "./embedding-service.js";
import { containsSensitiveKnowledge, normalizeTags } from "./knowledge-policy.js";
import { isBankOperationsMemoryCategory } from "./memory-policy.js";

export type MemoryScope = "shared";

export type MemorySnippet = {
  path: string;
  content: string;
  score: number;
  scope: MemoryScope;
};

export function memoryRoot(agentId: string): string {
  return join(config.LETTA_LOCAL_BACKEND_DIR, "memfs", agentId, "memory");
}

function ensureInside(root: string, target: string): void {
  const normalizedRoot = resolve(root);
  const normalizedTarget = resolve(target);
  if (
    normalizedTarget !== normalizedRoot &&
    !normalizedTarget.startsWith(`${normalizedRoot}${sep}`)
  ) {
    throw new Error("Memory path escaped root");
  }
}

function memoryFile(agentId: string): string {
  const root = memoryRoot(agentId);
  const path = join(root, "shared", "knowledge.md");
  ensureInside(root, path);
  return path;
}

async function ensureMarkdownFile(path: string, description: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  try {
    await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await writeFile(path, `---\ndescription: ${description}\n---\n\n`, "utf8");
  }
}

async function listMarkdownFiles(root: string, current = root): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(current, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const files: string[] = [];
  for (const entry of entries) {
    const absolute = join(current, entry.name);
    ensureInside(root, absolute);
    if (entry.isDirectory() && entry.name !== ".git") {
      files.push(...(await listMarkdownFiles(root, absolute)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(relative(root, absolute).replaceAll("\\", "/"));
    }
  }
  return files.sort();
}

type MemoryChunk = {
  path: string;
  chunkIndex: number;
  content: string;
  contentHash: string;
};

const indexSyncedAt = new Map<string, number>();
const indexSyncs = new Map<string, Promise<void>>();
const INDEX_SYNC_TTL_MS = 30_000;

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "").trim();
}

export function chunkMemoryDocument(
  content: string,
  maxChars = config.RAG_CHUNK_CHARS,
  overlapChars = config.RAG_CHUNK_OVERLAP_CHARS,
): string[] {
  const body = stripFrontmatter(content.replace(/\r\n?/g, "\n"));
  if (!body) return [];
  const overlap = Math.min(overlapChars, Math.max(0, maxChars - 1));
  const logicalBlocks = body
    .split(/\n{2,}|\n(?=- \d{4}-\d{2}-\d{2}T)/)
    .map((block) => block.trim())
    .filter(Boolean);
  const isMemoryLedger = logicalBlocks.some((block) =>
    /^- \d{4}-\d{2}-\d{2}T/.test(block),
  );
  const chunks: string[] = [];
  let current = "";

  const flush = () => {
    const normalized = current.trim();
    if (normalized) chunks.push(normalized);
    current = "";
  };

  for (const block of logicalBlocks) {
    if (isMemoryLedger) flush();
    if (block.length > maxChars) {
      flush();
      const step = Math.max(1, maxChars - overlap);
      for (let start = 0; start < block.length; start += step) {
        chunks.push(block.slice(start, start + maxChars).trim());
        if (start + maxChars >= block.length) break;
      }
      continue;
    }
    if (isMemoryLedger) {
      chunks.push(block);
      continue;
    }
    const candidate = current ? `${current}\n\n${block}` : block;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    const previousTail = current.slice(Math.max(0, current.length - overlap));
    flush();
    current = previousTail ? `${previousTail}\n\n${block}` : block;
    if (current.length > maxChars) {
      current = current.slice(current.length - maxChars);
    }
  }
  flush();
  return chunks.filter(Boolean);
}

async function desiredChunks(agentId: string): Promise<MemoryChunk[]> {
  const root = memoryRoot(agentId);
  const paths = (await listMarkdownFiles(root)).filter((path) =>
    path.startsWith("shared/"),
  );
  const chunks: MemoryChunk[] = [];
  for (const path of paths) {
    const absolute = join(root, path);
    ensureInside(root, absolute);
    const content = await readFile(absolute, "utf8");
    chunkMemoryDocument(content).forEach((chunk, chunkIndex) => {
      chunks.push({
        path,
        chunkIndex,
        content: chunk,
        contentHash: hashContent(chunk),
      });
    });
  }
  return chunks;
}

async function synchronizeMemoryIndex(agentId: string): Promise<void> {
  const chunks = await desiredChunks(agentId);
  const existing = await pool.query<{
    id: string;
    path: string;
    chunk_index: number;
    content_hash: string;
    embedding_model: string;
  }>(
    `SELECT id, path, chunk_index, content_hash, embedding_model
       FROM memory_chunks
      WHERE agent_id = $1`,
    [agentId],
  );
  const existingByKey = new Map(
    existing.rows.map((row) => [`${row.path}:${row.chunk_index}`, row]),
  );
  const changed = chunks.filter((chunk) => {
    const row = existingByKey.get(`${chunk.path}:${chunk.chunkIndex}`);
    return (
      !row ||
      row.content_hash !== chunk.contentHash ||
      row.embedding_model !== config.RAG_EMBEDDING_MODEL
    );
  });

  const vectors = await embedTexts(changed.map((chunk) => chunk.content));
  for (let index = 0; index < changed.length; index += 1) {
    const chunk = changed[index];
    await pool.query(
      `INSERT INTO memory_chunks(
         agent_id, path, chunk_index, content, content_hash,
         embedding_model, embedding, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::vector, now())
       ON CONFLICT (agent_id, path, chunk_index)
       DO UPDATE SET
         content = EXCLUDED.content,
         content_hash = EXCLUDED.content_hash,
         embedding_model = EXCLUDED.embedding_model,
         embedding = EXCLUDED.embedding,
         updated_at = now()`,
      [
        agentId,
        chunk.path,
        chunk.chunkIndex,
        chunk.content,
        chunk.contentHash,
        config.RAG_EMBEDDING_MODEL,
        vectorSql(vectors[index]),
      ],
    );
  }

  const desiredKeys = new Set(
    chunks.map((chunk) => `${chunk.path}:${chunk.chunkIndex}`),
  );
  const staleIds = existing.rows
    .filter((row) => !desiredKeys.has(`${row.path}:${row.chunk_index}`))
    .map((row) => row.id);
  if (staleIds.length) {
    await pool.query("DELETE FROM memory_chunks WHERE id = ANY($1::uuid[])", [
      staleIds,
    ]);
  }
  indexSyncedAt.set(agentId, Date.now());
}

async function ensureMemoryIndex(agentId: string, force = false): Promise<void> {
  if (
    !force &&
    Date.now() - (indexSyncedAt.get(agentId) ?? 0) < INDEX_SYNC_TTL_MS
  ) {
    return;
  }
  const active = indexSyncs.get(agentId);
  if (active) return active;
  const sync = synchronizeMemoryIndex(agentId).finally(() => {
    indexSyncs.delete(agentId);
  });
  indexSyncs.set(agentId, sync);
  return sync;
}

export async function saveMemory(input: {
  agentId: string;
  content: string;
  category?: string;
  tags?: string[];
}): Promise<{ saved: boolean; path?: string; reason?: string }> {
  const content = input.content.trim();
  if (!content) return { saved: false, reason: "Empty memory content." };
  if (containsSensitiveKnowledge(content)) {
    return { saved: false, reason: "Sensitive content is not stored in memory." };
  }
  if (!isBankOperationsMemoryCategory(input.category)) {
    return {
      saved: false,
      reason:
        "Memory category must be bank_operations_lesson or bank_operations_policy.",
    };
  }

  const path = memoryFile(input.agentId);
  await ensureMarkdownFile(
    path,
    "Verified reusable bank infrastructure and IT operations lessons, plus confirmed long-lived bank operations regulations, policies, standards, and procedures shared across authenticated users.",
  );

  const existing = await readFile(path, "utf8");
  if (existing.toLowerCase().includes(content.toLowerCase())) {
    return {
      saved: false,
      path: relative(memoryRoot(input.agentId), path).replaceAll("\\", "/"),
      reason: "Memory already exists.",
    };
  }

  const tags = normalizeTags(input.tags);
  const category = input.category;
  const tagSuffix = tags.length ? ` [${tags.join(", ")}]` : "";
  const line = `- ${new Date().toISOString()} (${category})${tagSuffix}: ${content}\n`;
  await appendFile(path, `\n${line}`, "utf8");
  // Markdown remains the durable source of truth. The next retrieval rebuilds
  // changed chunks before searching, so a slow or warming embedding service
  // never delays the user-facing turn that decided to save this memory.
  indexSyncedAt.delete(input.agentId);
  return {
    saved: true,
    path: relative(memoryRoot(input.agentId), path).replaceAll("\\", "/"),
  };
}

export async function searchMemory(input: {
  agentId: string;
  query: string;
  limit?: number;
}): Promise<MemorySnippet[]> {
  const query = input.query.trim();
  if (!query) return [];
  await ensureMemoryIndex(input.agentId);
  const [queryVector] = await embedTexts([query]);
  const vector = vectorSql(queryVector);
  const result = await pool.query<{
    path: string;
    content: string;
    score: string | number;
  }>(
    `SELECT path, content, 1 - (embedding <=> $1::vector) AS score
       FROM memory_chunks
      WHERE agent_id = $2
        AND embedding_model = $3
        AND 1 - (embedding <=> $1::vector) >= $4
      ORDER BY embedding <=> $1::vector
      LIMIT $5`,
    [
      vector,
      input.agentId,
      config.RAG_EMBEDDING_MODEL,
      config.RAG_MIN_SIMILARITY,
      input.limit ?? 12,
    ],
  );
  return result.rows.map((row) => ({
    path: row.path,
    content: row.content,
    score: Number(row.score),
    scope: "shared" as const,
  }));
}

export async function readSharedMemory(
  agentId: string,
): Promise<Array<{ path: string; content: string }>> {
  const root = memoryRoot(agentId);
  const paths = (await listMarkdownFiles(root)).filter((path) =>
    path.startsWith("shared/"),
  );
  return Promise.all(
    paths.map(async (path) => ({
      path,
      content: await readFile(join(root, path), "utf8"),
    })),
  );
}

export function formatMemoryContext(snippets: MemorySnippet[]): string {
  if (!snippets.length) return "";
  return snippets
    .map(
      (snippet, index) =>
        `Evidence version ${index + 1}:\n${snippet.content
          .replace(
            /^-\s+\d{4}-\d{2}-\d{2}T\S+\s+\([^\n)]*\)(?:\s+\[[^\n\]]*\])?:\s*/gm,
            "",
          )
          .trim()}`,
    )
    .join("\n\n");
}
