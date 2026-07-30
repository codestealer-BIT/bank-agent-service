import { readFile } from "node:fs/promises";
import { preparePdfForModel } from "../src/pdf-service.js";

const pdfPath = process.argv[2];
if (!pdfPath) {
  throw new Error("Usage: node --import tsx scripts/smoke-scanned-pdf.ts <pdf-path>");
}

process.loadEnvFile(".env");

const baseUrl = process.env.LITELLM_BASE_URL;
const apiKey = process.env.LITELLM_API_KEY;
const model = process.env.LITELLM_MODEL ?? "MiniMax-M3";
if (!baseUrl || !apiKey) {
  throw new Error("LITELLM_BASE_URL and LITELLM_API_KEY are required");
}

const pdf = await readFile(pdfPath);
const prepared = await preparePdfForModel(pdf.toString("base64"));
const content = [
  {
    type: "text",
    text: [
      "Read the actual page images from this scanned PDF. ",
      "Identify the document type, then list visible headings, key text, formulas, or figures. ",
      "Do not infer the answer from the filename alone.",
    ].join(""),
  },
  ...prepared.visualPages.map((page) => ({
    type: "image_url",
    image_url: {
      url: `data:${page.mediaType};base64,${page.data}`,
    },
  })),
];

const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`,
  },
  body: JSON.stringify({
    model,
    messages: [{ role: "user", content }],
    max_tokens: 1_200,
  }),
});
const body = await response.text();

console.log(
  JSON.stringify(
    {
      status: response.status,
      pages: prepared.pages,
      extractedTextCharacters: prepared.text.length,
      visualPages: prepared.visualPages.length,
      response: body.slice(0, 12_000),
    },
    null,
    2,
  ),
);

if (!response.ok) {
  process.exitCode = 1;
}
