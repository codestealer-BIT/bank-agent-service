import assert from "node:assert/strict";
import test from "node:test";
import { renderAttachmentContextForReflection } from "../src/attachment-context.js";

test("attachment context is rendered in persisted order for reflection", () => {
  const rendered = renderAttachmentContextForReflection([
    {
      name: "first.pdf",
      mediaType: "application/pdf",
      kind: "pdf",
      extractionStatus: "extracted",
      parser: "pdf-parse",
      pageCount: 2,
      extractedText: "first document text",
    },
    {
      name: "second.docx",
      mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      kind: "document",
      extractionStatus: "extracted",
      parser: "document-parser",
      format: "DOCX",
      extractedText: "second document text",
    },
  ]);

  assert.ok(rendered.indexOf("first.pdf") < rendered.indexOf("second.docx"));
  assert.match(rendered, /Pages: 2/);
  assert.match(rendered, /first document text/);
  assert.match(rendered, /second document text/);
});

test("invalid attachment context is ignored", () => {
  assert.equal(renderAttachmentContextForReflection("not-json"), "");
  assert.equal(renderAttachmentContextForReflection(null), "");
});
