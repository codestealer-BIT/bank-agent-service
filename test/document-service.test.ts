import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import {
  DocumentAttachmentError,
  extractDocumentText,
  isSupportedDocumentName,
} from "../src/document-service.js";

async function zippedBase64(files: Record<string, string>): Promise<string> {
  const zip = new JSZip();
  for (const [name, contents] of Object.entries(files)) zip.file(name, contents);
  return (await zip.generateAsync({ type: "nodebuffer" })).toString("base64");
}

test("extracts DOCX paragraphs", async () => {
  const data = await zippedBase64({
    "word/document.xml":
      '<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>服务器采购计划</w:t></w:r></w:p><w:p><w:r><w:t>共 128 台</w:t></w:r></w:p></w:body></w:document>',
  });
  const result = await extractDocumentText({
    name: "plan.docx",
    mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    data,
  });
  assert.equal(result.format, "DOCX");
  assert.match(result.text, /服务器采购计划/);
  assert.match(result.text, /128 台/);
});

test("extracts PPTX slides in slide order", async () => {
  const data = await zippedBase64({
    "ppt/slides/slide2.xml": '<p:sld xmlns:a="a" xmlns:p="p"><a:p><a:r><a:t>第二页风险</a:t></a:r></a:p></p:sld>',
    "ppt/slides/slide1.xml": '<p:sld xmlns:a="a" xmlns:p="p"><a:p><a:r><a:t>第一页摘要</a:t></a:r></a:p></p:sld>',
  });
  const result = await extractDocumentText({
    name: "report.pptx",
    mediaType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    data,
  });
  assert.ok(result.text.indexOf("第一页摘要") < result.text.indexOf("第二页风险"));
});

test("extracts XLSX shared strings and numeric values", async () => {
  const data = await zippedBase64({
    "xl/sharedStrings.xml": '<sst><si><t>主机名</t></si><si><t>CPU</t></si><si><t>cc-db-01</t></si></sst>',
    "xl/worksheets/sheet1.xml":
      '<worksheet><sheetData><row><c t="s"><v>0</v></c><c t="s"><v>1</v></c></row><row><c t="s"><v>2</v></c><c><v>92</v></c></row></sheetData></worksheet>',
  });
  const result = await extractDocumentText({
    name: "assets.xlsx",
    mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    data,
  });
  assert.match(result.text, /主机名\tCPU/);
  assert.match(result.text, /cc-db-01\t92/);
});

test("extracts HTML without scripts", async () => {
  const result = await extractDocumentText({
    name: "status.html",
    mediaType: "text/html",
    data: Buffer.from("<h1>运行正常</h1><script>secret()</script><p>无告警</p>").toString("base64"),
  });
  assert.match(result.text, /运行正常/);
  assert.match(result.text, /无告警/);
  assert.doesNotMatch(result.text, /secret/);
});

test("exposes the supported modern document set and rejects legacy binary DOC", async () => {
  assert.equal(isSupportedDocumentName("report.docx"), true);
  assert.equal(isSupportedDocumentName("report.epub"), true);
  assert.equal(isSupportedDocumentName("legacy.doc"), false);
  await assert.rejects(
    extractDocumentText({
      name: "legacy.doc",
      mediaType: "application/msword",
      data: Buffer.from("legacy").toString("base64"),
    }),
    DocumentAttachmentError,
  );
});
