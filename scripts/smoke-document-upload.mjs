import JSZip from "jszip";

const baseUrl = process.env.BANK_AGENT_BASE_URL ?? "http://127.0.0.1:8080";
const username = process.env.BANK_AGENT_TEST_USER ?? "usera";
const password = process.env.BANK_AGENT_TEST_PASSWORD ?? "LettaDemo@2026";
const marker = `${Date.now()}${Math.floor(Math.random() * 1_000).toString().padStart(3, "0")}`;

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
  if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(body)}`);
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
    body: JSON.stringify({ title: "DOCX localhost smoke test" }),
  },
  cookie,
);

const zip = new JSZip();
zip.file(
  "word/document.xml",
  `<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>This is a local DOCX upload test.</w:t></w:r></w:p><w:p><w:r><w:t>Verification code: ${marker}</w:t></w:r></w:p></w:body></w:document>`,
);
const documentData = await zip.generateAsync({ type: "base64" });
const requestId = crypto.randomUUID();
const accepted = await request(
  `/v1/conversations/${conversation.body.id}/message-jobs`,
  {
    method: "POST",
    body: JSON.stringify({
      request_id: requestId,
      message: "Read the attached DOCX body and return only its exact 16-digit verification code.",
      attachments: [
        {
          kind: "document",
          name: "localhost-smoke.docx",
          media_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          data: documentData,
          size: Buffer.byteLength(documentData, "base64"),
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
    throw new Error(snapshot.body.error || "Document message job failed");
  }
  if (snapshot.body.status === "completed") break;
  await new Promise((resolve) => setTimeout(resolve, 500));
}

if (!answer.includes(marker)) {
  throw new Error(`Model answer did not contain the DOCX marker. Answer: ${answer}`);
}
console.log(JSON.stringify({ ok: true, format: "DOCX", marker, conversation_id: conversation.body.id }));
