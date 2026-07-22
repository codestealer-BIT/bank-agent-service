import pdfParse from "pdf-parse/lib/pdf-parse.js";

const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_PDF_PAGES = 100;
const MAX_EXTRACTED_TEXT_CHARS = 60_000;

export class PdfAttachmentError extends Error {
  readonly statusCode = 400;
}

export type ExtractedPdf = {
  text: string;
  pages: number;
  truncated: boolean;
  hasExtractableText: boolean;
};

function decodePdf(data: string): Buffer {
  const compact = data.replace(/\s+/g, "");
  if (!compact || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) {
    throw new PdfAttachmentError("PDF 附件不是有效的 Base64 数据");
  }

  const buffer = Buffer.from(compact, "base64");
  if (!buffer.length || buffer.length > MAX_PDF_BYTES) {
    throw new PdfAttachmentError("PDF 附件为空或超过 20MB 限制");
  }
  if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new PdfAttachmentError("附件内容不是有效的 PDF 文件");
  }
  return buffer;
}

export async function extractPdfText(data: string): Promise<ExtractedPdf> {
  const buffer = decodePdf(data);
  let parsed: Awaited<ReturnType<typeof pdfParse>>;
  try {
    parsed = await pdfParse(buffer, { max: MAX_PDF_PAGES });
  } catch {
    throw new PdfAttachmentError("PDF 文件损坏、被加密或暂时无法解析");
  }

  const normalized = parsed.text.replace(/\u0000/g, "").trim();
  const truncated = normalized.length > MAX_EXTRACTED_TEXT_CHARS;
  return {
    text: normalized.slice(0, MAX_EXTRACTED_TEXT_CHARS),
    pages: parsed.numpages,
    truncated,
    hasExtractableText: normalized.length > 0,
  };
}
