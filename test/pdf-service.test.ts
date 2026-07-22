import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { extractPdfText, PdfAttachmentError } from "../src/pdf-service.js";

test("extracts text and page count from a PDF attachment", async () => {
  const fixture = await readFile("node_modules/pdf-parse/test/data/04-valid.pdf");
  const result = await extractPdfText(fixture.toString("base64"));

  assert.equal(result.pages, 5);
  assert.equal(result.hasExtractableText, true);
  assert.match(result.text, /Acute effect of speed exercise/);
});

test("rejects a non-PDF payload even when it is base64 encoded", async () => {
  await assert.rejects(
    extractPdfText(Buffer.from("not a pdf").toString("base64")),
    PdfAttachmentError,
  );
});

