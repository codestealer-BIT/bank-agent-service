import { createCanvas } from "@napi-rs/canvas";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_PDF_PAGES = 100;
const MAX_EXTRACTED_TEXT_CHARS = 60_000;
const MAX_VISUAL_PDF_PAGES = 4;
const MAX_RENDERED_EDGE = 1_200;
const MAX_RENDERED_TOTAL_BYTES = 4 * 1024 * 1024;
const JPEG_QUALITY = 70;

export class PdfAttachmentError extends Error {
  readonly statusCode = 400;
}

export type ExtractedPdf = {
  text: string;
  pages: number;
  truncated: boolean;
  hasExtractableText: boolean;
};

export type RenderedPdfPage = {
  pageNumber: number;
  mediaType: "image/jpeg";
  data: string;
  size: number;
  width: number;
  height: number;
};

export type PreparedPdf = ExtractedPdf & {
  visualPages: RenderedPdfPage[];
  visualPagesTruncated: boolean;
  visualError?: string;
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

async function parsePdfText(buffer: Buffer): Promise<ExtractedPdf> {
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

async function renderPdfPages(
  buffer: Buffer,
): Promise<
  Pick<PreparedPdf, "visualPages" | "visualPagesTruncated" | "visualError">
> {
  let document: Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]> | null =
    null;
  try {
    document = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
    }).promise;

    const pageLimit = Math.min(document.numPages, MAX_VISUAL_PDF_PAGES);
    const visualPages: RenderedPdfPage[] = [];
    let renderedBytes = 0;

    for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(
        2,
        MAX_RENDERED_EDGE /
          Math.max(baseViewport.width, baseViewport.height),
      );
      const viewport = page.getViewport({ scale });
      const width = Math.max(1, Math.ceil(viewport.width));
      const height = Math.max(1, Math.ceil(viewport.height));
      const canvas = createCanvas(width, height);

      await page.render({
        canvasContext: canvas.getContext("2d"),
        viewport,
      } as never).promise;

      const encoded = await canvas.encode("jpeg", JPEG_QUALITY);
      if (
        visualPages.length > 0 &&
        renderedBytes + encoded.length > MAX_RENDERED_TOTAL_BYTES
      ) {
        return {
          visualPages,
          visualPagesTruncated: true,
        };
      }

      renderedBytes += encoded.length;
      visualPages.push({
        pageNumber,
        mediaType: "image/jpeg",
        data: encoded.toString("base64"),
        size: encoded.length,
        width,
        height,
      });
      page.cleanup();
    }

    return {
      visualPages,
      visualPagesTruncated: document.numPages > visualPages.length,
    };
  } catch (error) {
    return {
      visualPages: [],
      visualPagesTruncated: false,
      visualError:
        error instanceof Error ? error.message : "PDF page rendering failed",
    };
  } finally {
    await document?.destroy().catch(() => undefined);
  }
}

export async function extractPdfText(data: string): Promise<ExtractedPdf> {
  return parsePdfText(decodePdf(data));
}

/**
 * Prefer the PDF text layer. Only image-only/scanned PDFs are rendered into
 * page images, because rendered pages become large base64 payloads and can trip
 * LiteLLM/nginx request-size limits.
 */
export async function preparePdfForModel(data: string): Promise<PreparedPdf> {
  const buffer = decodePdf(data);
  const text = await parsePdfText(buffer);
  const visual = text.hasExtractableText
    ? {
        visualPages: [],
        visualPagesTruncated: false,
      }
    : await renderPdfPages(buffer);
  return {
    ...text,
    ...visual,
  };
}
