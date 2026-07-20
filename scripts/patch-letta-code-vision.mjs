import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const lettaCodeBundle = join(
  root,
  "node_modules",
  "@letta-ai",
  "letta-code",
  "letta.js",
);

const helper = `function isVisionCapableCustomModel(modelId) {
  const normalized = String(modelId ?? "").toLowerCase();
  return normalized.includes("llava") || normalized.includes("vision") || normalized.includes("vl") || normalized.includes("minimax-m3");
}
`;

const originalInputExpression =
  `input: input.modelId.includes("llava") || input.modelId.includes("vision") || input.modelId.includes("vl") ? ["text", "image"] : ["text"],`;
const patchedInputExpression =
  `input: isVisionCapableCustomModel(input.modelId) ? ["text", "image"] : ["text"],`;
const insertionPoint = "function customOpenAICompatibleModel(input) {";

let source = readFileSync(lettaCodeBundle, "utf8");

if (!source.includes(patchedInputExpression)) {
  if (!source.includes(originalInputExpression)) {
    throw new Error(
      "Could not find Letta Code custom OpenAI-compatible vision capability expression. The upstream bundle may have changed.",
    );
  }
  source = source.replace(originalInputExpression, patchedInputExpression);
}

if (!source.includes("function isVisionCapableCustomModel(modelId)")) {
  if (!source.includes(insertionPoint)) {
    throw new Error(
      "Could not find Letta Code customOpenAICompatibleModel insertion point. The upstream bundle may have changed.",
    );
  }
  source = source.replace(insertionPoint, `${helper}${insertionPoint}`);
}

writeFileSync(lettaCodeBundle, source);
console.log(
  "Patched Letta Code local provider capability detection: MiniMax-M3 now accepts image input.",
);
