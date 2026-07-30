import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type SkillSummary = {
  name: string;
  description: string;
  display_name: string;
  short_description: string;
  allow_implicit_invocation: boolean;
};

export type SkillDefinition = SkillSummary & {
  instructions: string;
};

const skillRoot = join(process.cwd(), "skills");

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function yamlValue(source: string, key: string): string | undefined {
  const match = source.match(new RegExp(`^\\s*${key}:\\s*(.+?)\\s*$`, "m"));
  return match ? unquote(match[1]) : undefined;
}

function readSkill(directoryName: string): SkillDefinition | undefined {
  if (!/^[a-z0-9-]+$/.test(directoryName)) return undefined;
  const skillPath = join(skillRoot, directoryName, "SKILL.md");
  if (!existsSync(skillPath)) return undefined;

  const source = readFileSync(skillPath, "utf8");
  const frontmatter = source.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n/);
  if (!frontmatter) return undefined;
  const name = yamlValue(frontmatter[1], "name");
  const description = yamlValue(frontmatter[1], "description");
  if (!name || !description || name !== directoryName) return undefined;

  const interfacePath = join(skillRoot, directoryName, "agents", "openai.yaml");
  const interfaceSource = existsSync(interfacePath)
    ? readFileSync(interfacePath, "utf8")
    : "";

  return {
    name,
    description,
    display_name: yamlValue(interfaceSource, "display_name") ?? name,
    short_description:
      yamlValue(interfaceSource, "short_description") ?? description,
    allow_implicit_invocation:
      yamlValue(interfaceSource, "allow_implicit_invocation") !== "false",
    instructions: source.slice(frontmatter[0].length).trim(),
  };
}

export function listSkills(): SkillSummary[] {
  if (!existsSync(skillRoot)) return [];
  return readdirSync(skillRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readSkill(entry.name))
    .filter((skill): skill is SkillDefinition => Boolean(skill))
    .map(({ instructions: _instructions, ...summary }) => summary)
    .sort((left, right) => left.display_name.localeCompare(right.display_name));
}

export function getSkill(name: string): SkillDefinition | undefined {
  return readSkill(name.trim().toLowerCase());
}

export function formatSkillCatalogForPersona(): string[] {
  const implicitSkills = listSkills().filter(
    (skill) => skill.allow_implicit_invocation,
  );
  if (!implicitSkills.length) return [];
  return [
    "Available skills are listed below. Decide whether a user request semantically matches a skill by its name and description:",
    ...implicitSkills.map(
      (skill) => `- ${skill.name}: ${skill.description}`,
    ),
    "When a request matches a skill, call load_skill with its exact name before acting, then follow the loaded instructions.",
  ];
}

export function parseExplicitSkillInvocation(
  message: string,
): { name: string; prompt: string } | undefined {
  const match = message.trim().match(/^\/([a-z0-9-]+)(?:\s+([\s\S]*))?$/i);
  if (!match) return undefined;
  return {
    name: match[1].toLowerCase(),
    prompt: match[2]?.trim() ?? "",
  };
}

export function composeExplicitSkillRuntimeMessage(message: string): string {
  const invocation = parseExplicitSkillInvocation(message);
  if (!invocation || !getSkill(invocation.name)) return message;
  return [
    `The user explicitly invoked the skill "${invocation.name}".`,
    `Call load_skill with name="${invocation.name}" before acting, follow the loaded instructions, and use its required tools.`,
    `User request: ${invocation.prompt || "Run the skill using the alert information in this message."}`,
  ].join("\n");
}
