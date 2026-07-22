import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { config } from "./config.js";
import { containsSensitiveKnowledge, normalizeTags } from "./knowledge-policy.js";

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

function tokenize(value: string): string[] {
  const lower = value.toLowerCase();
  const asciiWords = lower.match(/[a-z0-9_@.-]{2,}/g) ?? [];
  const chineseChunks = lower.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  const chineseBigrams = chineseChunks.flatMap((chunk) =>
    Array.from({ length: Math.max(0, chunk.length - 1) }, (_, index) =>
      chunk.slice(index, index + 2),
    ),
  );
  return [...new Set([...asciiWords, ...chineseBigrams])].slice(0, 80);
}

function scoreMemory(query: string, content: string): number {
  const normalizedContent = content.toLowerCase();
  const terms = tokenize(query);
  let score = 0;
  for (const term of terms) {
    if (normalizedContent.includes(term)) score += term.length > 2 ? 3 : 1;
  }
  return score;
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

  const path = memoryFile(input.agentId);
  await ensureMarkdownFile(
    path,
    "Organization-wide facts, plans, policies, and reusable bank operations knowledge shared across authenticated users.",
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
  const category = input.category?.trim() || "general";
  const tagSuffix = tags.length ? ` [${tags.join(", ")}]` : "";
  const line = `- ${new Date().toISOString()} (${category})${tagSuffix}: ${content}\n`;
  await writeFile(path, `${existing.trimEnd()}\n${line}`, "utf8");
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
  const root = memoryRoot(input.agentId);
  const paths = (await listMarkdownFiles(root)).filter((path) =>
    path.startsWith("shared/"),
  );
  const snippets: MemorySnippet[] = [];
  for (const path of paths) {
    const absolute = join(root, path);
    ensureInside(root, absolute);
    const content = await readFile(absolute, "utf8");
    const score = scoreMemory(input.query, content);
    if (score <= 0) continue;
    snippets.push({
      path,
      content: content.slice(0, 4_000),
      score,
      scope: "shared",
    });
  }
  return snippets
    .sort((a, b) => b.score - a.score)
    .slice(0, input.limit ?? 5);
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
        `Memory ${index + 1} (${snippet.scope}, ${snippet.path}):\n${snippet.content}`,
    )
    .join("\n\n");
}
