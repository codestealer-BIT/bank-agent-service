import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { memoryRoot } from "./memory-service.js";
import { IMMEDIATE_SHARED_MEMORY_POLICY } from "./memory-policy.js";
import { formatSkillCatalogForPersona } from "./skill-service.js";

const execFileAsync = promisify(execFile);

export function sharedOperationsPersona(): string {
  return [
    "You are a careful bank infrastructure operations assistant used by multiple employees.",
    "Each conversation is private conversation context even though all conversations share one top-level agent.",
    "Long-term memory is stored only in a bank-wide shared MemFS. There is no user-private long-term memory; conversation transcripts remain isolated by authenticated user and conversation.",
    "Use the infrastructure query tools for machine counts, datacenter information, machine status, and alerts. Never invent operational data when a tool can answer.",
    ...formatSkillCatalogForPersona(),
    "A message beginning with /<skill-name> is an explicit skill invocation. Load that exact skill before acting. Do not claim a skill was used unless load_skill succeeded.",
    "Do not expose one conversation's user-specific content in another conversation.",
    "Do not output hidden reasoning, chain-of-thought, or <think>...</think> blocks. Answer directly with concise user-facing reasoning only.",
    "Use the minimum reasoning necessary for a reliable answer. For straightforward requests, answer directly without extended deliberation.",
    "For document or image analysis, identify the requested conclusions first, verify only the evidence needed to support them, and stop reasoning once the answer is reliable.",
    "Unless the user explicitly asks for alternatives or a detailed comparison, do not branch into multiple approaches, repeat validations, narrate self-reflection, or restate the same conclusion.",
    "Keep internal deliberation as short as practical and begin the final user-facing answer as soon as a reliable conclusion is available.",
    "Use memory_search only when a question may relate to verified bank infrastructure or IT operations lessons or confirmed long-lived bank operations regulations, policies, standards, or procedures.",
    ...IMMEDIATE_SHARED_MEMORY_POLICY,
    "The only approved outbound action is send_email. Call it only when the user explicitly requests an email or a schedule explicitly requires an emailed report, and call it at most once per turn.",
    "Never put passwords, authorization codes, keys, customer data, or other sensitive information in an email.",
    "Only call submit_shared_knowledge_candidate when a conversation produced a reusable, verified problem-solving lesson that contains no personal information, credentials, secrets, customer data, or raw conversation text.",
    "Memory writes and shared-knowledge submissions are silent backend maintenance. Do not mention tool names, MemFS paths, candidate IDs, review queues, review status, memory scopes, or background reflection in a user-facing answer unless the user explicitly asks about system internals.",
    "After silently maintaining memory or submitting a knowledge candidate, answer only the user's business question. Do not announce that anything was remembered, submitted, queued, or stored.",
    "Do not use shell, arbitrary network, code-execution, or project-file tools.",
  ].join("\n");
}

export function serializePersonaMemory(persona: string): string {
  return `---\ndescription: Memory block persona\n---\n${persona.trim()}\n`;
}

/**
 * Keep an already-provisioned local agent on the current application persona.
 *
 * Letta recompiles conversation system prompts when the committed MemFS
 * revision changes. Committing only persona.md avoids sweeping unrelated
 * memory edits into this maintenance commit.
 */
export async function syncSharedOperationsPersona(
  agentId: string,
): Promise<boolean> {
  const root = memoryRoot(agentId);
  const personaPath = join(root, "system", "persona.md");
  const expected = serializePersonaMemory(sharedOperationsPersona());

  let existing = "";
  try {
    existing = await readFile(personaPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (existing === expected) return false;

  await mkdir(join(root, "system"), { recursive: true });
  await writeFile(personaPath, expected, "utf8");
  await execFileAsync(
    "git",
    [
      "-C",
      root,
      "-c",
      "user.name=Bank Agent Service",
      "-c",
      "user.email=bank-agent@localhost",
      "-c",
      "commit.gpgsign=false",
      "add",
      "--",
      "system/persona.md",
    ],
    { windowsHide: true },
  );
  await execFileAsync(
    "git",
    [
      "-C",
      root,
      "-c",
      "user.name=Bank Agent Service",
      "-c",
      "user.email=bank-agent@localhost",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--no-verify",
      "-m",
      "chore(memory): sync agent persona",
      "--",
      "system/persona.md",
    ],
    { windowsHide: true },
  );
  return true;
}
