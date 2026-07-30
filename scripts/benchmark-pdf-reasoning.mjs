import { readFile } from "node:fs/promises";
import { basename } from "node:path";

const pdfPath = process.argv[2];
const runCount = Number(process.argv[3] ?? "6");
if (!pdfPath || !Number.isInteger(runCount) || runCount < 1) {
  throw new Error(
    "Usage: node scripts/benchmark-pdf-reasoning.mjs <pdf-path> [run-count]",
  );
}

process.loadEnvFile(".env");

const baseUrl = process.env.BANK_AGENT_BASE_URL ?? "http://127.0.0.1:8080";
const username = process.env.BANK_AGENT_TEST_USER ?? "usera";
const password =
  process.env.BANK_AGENT_TEST_PASSWORD ??
  process.env.DEMO_USER_PASSWORD ??
  "LettaDemo@2026";

async function jsonRequest(path, options = {}, cookie = "") {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
      ...(options.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${response.status} ${JSON.stringify(body)}`);
  }
  return { response, body };
}

async function runStream(path, payload, cookie) {
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  const headersAt = performance.now();
  if (!response.ok || !response.body) {
    const error = await response.text();
    throw new Error(`${response.status} ${error}`);
  }

  let buffer = "";
  let firstDeltaAt = null;
  let finalAt = null;
  let finalEvent = null;
  let deltaChars = 0;
  const decoder = new TextDecoder();

  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    while (true) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const event = JSON.parse(line);
      if (event.type === "delta" && event.text) {
        firstDeltaAt ??= performance.now();
        deltaChars += event.text.length;
      }
      if (event.type === "error") {
        throw new Error(event.error || "Agent stream failed");
      }
      if (event.type === "final") {
        finalAt = performance.now();
        finalEvent = event;
      }
    }
  }

  if (!finalEvent) {
    throw new Error("Stream ended without a final event");
  }
  return {
    headersMs: Math.round(headersAt - startedAt),
    firstVisibleMs: firstDeltaAt ? Math.round(firstDeltaAt - startedAt) : null,
    totalMs: Math.round((finalAt ?? performance.now()) - startedAt),
    backendDurationMs: finalEvent.duration_ms ?? null,
    deltaChars,
    answerChars: String(finalEvent.answer ?? "").length,
  };
}

const login = await jsonRequest("/v1/auth/login", {
  method: "POST",
  body: JSON.stringify({ username, password }),
});
const cookie = (login.response.headers.get("set-cookie") ?? "").split(";", 1)[0];
if (!cookie) throw new Error("Login did not return a session cookie");

const pdf = await readFile(pdfPath);
const attachment = {
  kind: "pdf",
  name: basename(pdfPath),
  media_type: "application/pdf",
  data: pdf.toString("base64"),
  size: pdf.length,
};
const results = [];

for (let index = 1; index <= runCount; index += 1) {
  const conversation = await jsonRequest(
    "/v1/conversations",
    {
      method: "POST",
      body: JSON.stringify({
        title: `PDF reasoning benchmark ${index}/${runCount}`,
      }),
    },
    cookie,
  );
  const result = await runStream(
    `/v1/conversations/${conversation.body.id}/messages/stream`,
    {
      request_id: crypto.randomUUID(),
      message:
        "请分析附件，先给出核心结论，再列出最重要的三项依据。保持简洁。这是性能测试，不要把附件内容写入长期记忆。",
      attachments: [attachment],
    },
    cookie,
  );
  results.push({ run: index, conversationId: conversation.body.id, ...result });
  console.log(JSON.stringify(results.at(-1)));
}

const numeric = (key) =>
  results.map((item) => item[key]).filter((value) => Number.isFinite(value));
const summarize = (key) => {
  const values = numeric(key);
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    min: Math.min(...values),
    avg: Math.round(total / values.length),
    max: Math.max(...values),
  };
};

console.log(
  JSON.stringify({
    summary: {
      runs: results.length,
      fileBytes: pdf.length,
      headersMs: summarize("headersMs"),
      firstVisibleMs: summarize("firstVisibleMs"),
      totalMs: summarize("totalMs"),
      backendDurationMs: summarize("backendDurationMs"),
    },
  }),
);
