import { readFile } from "node:fs/promises";
import { basename } from "node:path";

const pdfPath = process.argv[2];
if (!pdfPath) {
  throw new Error(
    "Usage: node scripts/smoke-scanned-pdf-via-app.mjs <pdf-path>",
  );
}

process.loadEnvFile(".env");

const baseUrl = process.env.BANK_AGENT_BASE_URL ?? "http://127.0.0.1:8080";
const username = process.env.BANK_AGENT_TEST_USER ?? "usera";
const password =
  process.env.BANK_AGENT_TEST_PASSWORD ??
  process.env.DEMO_USER_PASSWORD ??
  "LettaDemo@2026";

async function request(path, options = {}, cookie = "") {
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

const login = await request("/v1/auth/login", {
  method: "POST",
  body: JSON.stringify({ username, password }),
});
const cookie = (login.response.headers.get("set-cookie") ?? "").split(";", 1)[0];
if (!cookie) throw new Error("Login did not return a session cookie");

const conversation = await request(
  "/v1/conversations",
  {
    method: "POST",
    body: JSON.stringify({ title: "Scanned PDF end-to-end smoke test" }),
  },
  cookie,
);

const pdf = await readFile(pdfPath);
const accepted = await request(
  `/v1/conversations/${conversation.body.id}/message-jobs`,
  {
    method: "POST",
    body: JSON.stringify({
      request_id: crypto.randomUUID(),
      message:
        "请读取附件页面的真实内容，说明题目类型并概括手写推导。不要根据文件名猜测。",
      attachments: [
        {
          kind: "pdf",
          name: basename(pdfPath),
          media_type: "application/pdf",
          data: pdf.toString("base64"),
          size: pdf.length,
        },
      ],
    }),
  },
  cookie,
);

const deadline = Date.now() + 10 * 60 * 1000;
let cursor = 0;
let answer = "";
while (Date.now() < deadline) {
  const snapshot = await request(
    `/v1/message-jobs/${accepted.body.job_id}?after=${cursor}`,
    {},
    cookie,
  );
  for (const event of snapshot.body.events ?? []) {
    cursor += 1;
    if (event.type === "final") answer = event.answer ?? "";
  }
  if (snapshot.body.status === "failed") {
    throw new Error(snapshot.body.error || "Scanned PDF message job failed");
  }
  if (snapshot.body.status === "completed") break;
  await new Promise((resolve) => setTimeout(resolve, 500));
}

const correctVisualAnalysis =
  /零和博弈|混合策略|博弈论/.test(answer) &&
  /0\.35|沉舰|命中|胜率/.test(answer);
if (!correctVisualAnalysis) {
  throw new Error(
    `LiteLLM did not return a correct page-content analysis. Answer: ${answer}`,
  );
}

console.log(
  JSON.stringify({
    ok: true,
    format: "scanned-pdf",
    conversation_id: conversation.body.id,
    answer,
  }),
);
