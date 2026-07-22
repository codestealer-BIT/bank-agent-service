import path from "node:path";
import JSZip from "jszip";
import { extractPdfText } from "./pdf-service.js";

const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
const MAX_EXTRACTED_TEXT_CHARS = 60_000;

const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".log", ".csv", ".tsv", ".json", ".jsonl",
  ".yaml", ".yml", ".xml", ".html", ".htm", ".sql", ".py",
  ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".java",
  ".c", ".h", ".cpp", ".hpp", ".go", ".rs", ".sh", ".ps1",
  ".ini", ".conf", ".properties",
]);

export const SUPPORTED_DOCUMENT_EXTENSIONS = new Set([
  ...TEXT_EXTENSIONS,
  ".pdf", ".docx", ".pptx", ".xlsx", ".odt", ".ods", ".odp",
  ".rtf", ".epub",
]);

export class DocumentAttachmentError extends Error {
  readonly statusCode = 400;
}

export type ExtractedDocument = {
  text: string;
  format: string;
  truncated: boolean;
  hasExtractableText: boolean;
  details?: string;
};

function decodeBase64(data: string): Buffer {
  const compact = data.replace(/\s+/g, "");
  if (!compact || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) {
    throw new DocumentAttachmentError("附件不是有效的 Base64 数据");
  }
  const buffer = Buffer.from(compact, "base64");
  if (!buffer.length || buffer.length > MAX_DOCUMENT_BYTES) {
    throw new DocumentAttachmentError("附件为空或超过 20MB 限制");
  }
  return buffer;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, decimal: string) =>
      String.fromCodePoint(Number.parseInt(decimal, 10)),
    )
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, "&");
}

function normalizeText(value: string): string {
  return value
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function xmlToText(xml: string): string {
  return normalizeText(
    decodeEntities(
      xml
        .replace(/<\/?(?:w:p|a:p|text:p|text:h|table:table-row|div|p|h[1-6]|li|tr)\b[^>]*>/gi, "\n")
        .replace(/<(?:w:tab|text:tab)\b[^>]*\/?\s*>/gi, "\t")
        .replace(/<(?:w:br|br)\b[^>]*\/?\s*>/gi, "\n")
        .replace(/<\/?(?:w:tc|a:tc|table:table-cell|td|th)\b[^>]*>/gi, "\t")
        .replace(/<[^>]+>/g, ""),
    ),
  );
}

function htmlToText(html: string): string {
  return xmlToText(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ""),
  );
}

function naturalNumber(name: string): number {
  return Number(name.match(/(\d+)(?!.*\d)/)?.[1] ?? Number.MAX_SAFE_INTEGER);
}

async function readZipText(zip: JSZip, name: string): Promise<string> {
  const entry = zip.file(name);
  return entry ? entry.async("string") : "";
}

function assertReasonableArchive(zip: JSZip): void {
  const entries = Object.values(zip.files);
  if (entries.length > 3_000) {
    throw new DocumentAttachmentError("压缩文档包含过多文件，已拒绝解析");
  }
  let totalUncompressedBytes = 0;
  for (const entry of entries) {
    const uncompressedBytes = Number(
      (entry as unknown as { _data?: { uncompressedSize?: number } })._data
        ?.uncompressedSize ?? 0,
    );
    if (uncompressedBytes > 32 * 1024 * 1024) {
      throw new DocumentAttachmentError("压缩文档中的单个内容项过大，已拒绝解析");
    }
    totalUncompressedBytes += uncompressedBytes;
    if (totalUncompressedBytes > 96 * 1024 * 1024) {
      throw new DocumentAttachmentError("压缩文档解压后过大，已拒绝解析");
    }
  }
}

async function extractDocx(zip: JSZip): Promise<string> {
  const names = Object.keys(zip.files)
    .filter((name) =>
      /^word\/(?:document|footnotes|endnotes|comments|header\d+|footer\d+)\.xml$/i.test(name),
    )
    .sort((a, b) => {
      if (a === "word/document.xml") return -1;
      if (b === "word/document.xml") return 1;
      return a.localeCompare(b);
    });
  const sections = await Promise.all(names.map(async (name) => xmlToText(await readZipText(zip, name))));
  return normalizeText(sections.filter(Boolean).join("\n\n"));
}

async function extractPptx(zip: JSZip): Promise<string> {
  const slideNames = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => naturalNumber(a) - naturalNumber(b));
  const slides = await Promise.all(
    slideNames.map(async (name, index) => {
      const text = xmlToText(await readZipText(zip, name));
      return text ? `[幻灯片 ${index + 1}]\n${text}` : "";
    }),
  );
  return normalizeText(slides.filter(Boolean).join("\n\n"));
}

function cellValue(cellXml: string, sharedStrings: string[]): string {
  const type = cellXml.match(/<c\b[^>]*\bt="([^"]+)"/i)?.[1];
  const inline = cellXml.match(/<is\b[^>]*>([\s\S]*?)<\/is>/i)?.[1];
  if (inline) return xmlToText(inline);
  const raw = decodeEntities(cellXml.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i)?.[1] ?? "").trim();
  if (type === "s") return sharedStrings[Number(raw)] ?? raw;
  if (type === "b") return raw === "1" ? "TRUE" : "FALSE";
  const formula = decodeEntities(cellXml.match(/<f\b[^>]*>([\s\S]*?)<\/f>/i)?.[1] ?? "").trim();
  return formula ? `=${formula}${raw ? ` (${raw})` : ""}` : raw;
}

async function extractXlsx(zip: JSZip): Promise<string> {
  const sharedXml = await readZipText(zip, "xl/sharedStrings.xml");
  const sharedStrings = [...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)].map((match) =>
    xmlToText(match[1]),
  );
  const sheetNames = Object.keys(zip.files)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort((a, b) => naturalNumber(a) - naturalNumber(b));
  const sheets = await Promise.all(
    sheetNames.map(async (name, index) => {
      const xml = await readZipText(zip, name);
      const rows = [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi)].map((rowMatch) =>
        [...rowMatch[1].matchAll(/<c\b[^>]*>[\s\S]*?<\/c>/gi)]
          .map((cell) => cellValue(cell[0], sharedStrings))
          .join("\t")
          .trimEnd(),
      );
      const body = rows.filter((row) => row.trim()).join("\n");
      return body ? `[工作表 ${index + 1}]\n${body}` : "";
    }),
  );
  return normalizeText(sheets.filter(Boolean).join("\n\n"));
}

async function extractOpenDocument(zip: JSZip): Promise<string> {
  return xmlToText(await readZipText(zip, "content.xml"));
}

async function extractEpub(zip: JSZip): Promise<string> {
  const names = Object.keys(zip.files)
    .filter((name) => /\.(?:xhtml|html|htm)$/i.test(name) && !/nav\.(?:xhtml|html)$/i.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const chapters = await Promise.all(
    names.map(async (name) => htmlToText(await readZipText(zip, name))),
  );
  return normalizeText(chapters.filter(Boolean).join("\n\n"));
}

function extractRtf(buffer: Buffer): string {
  const latin = buffer.toString("latin1");
  return normalizeText(
    latin
      .replace(/\{\\(?:pict|fonttbl|colortbl|stylesheet|info)\b[\s\S]*?\}/gi, " ")
      .replace(/\\u(-?\d+)\??/g, (_, value: string) => {
        const code = Number(value);
        return String.fromCharCode(code < 0 ? code + 65_536 : code);
      })
      .replace(/\\'([0-9a-f]{2})/gi, (_, value: string) =>
        Buffer.from([Number.parseInt(value, 16)]).toString("latin1"),
      )
      .replace(/\\(?:par|line)\b/g, "\n")
      .replace(/\\tab\b/g, "\t")
      .replace(/\\[a-z]+-?\d* ?/gi, "")
      .replace(/\\([\\{}])/g, "$1")
      .replace(/[{}]/g, ""),
  );
}

function finalize(text: string, format: string, details?: string): ExtractedDocument {
  const normalized = normalizeText(text);
  return {
    text: normalized.slice(0, MAX_EXTRACTED_TEXT_CHARS),
    format,
    truncated: normalized.length > MAX_EXTRACTED_TEXT_CHARS,
    hasExtractableText: normalized.length > 0,
    details,
  };
}

export function isSupportedDocumentName(name: string): boolean {
  return SUPPORTED_DOCUMENT_EXTENSIONS.has(path.extname(name).toLowerCase());
}

export async function extractDocumentText(input: {
  name: string;
  mediaType: string;
  data: string;
}): Promise<ExtractedDocument> {
  const extension = path.extname(input.name).toLowerCase();
  if (!SUPPORTED_DOCUMENT_EXTENSIONS.has(extension)) {
    throw new DocumentAttachmentError(
      `暂不支持 ${extension || "该"} 文件，请转换为 PDF、DOCX、PPTX、XLSX、ODT、RTF、EPUB 或纯文本格式`,
    );
  }
  if (extension === ".pdf") {
    const pdf = await extractPdfText(input.data);
    return finalize(pdf.text, "PDF", `页数：${pdf.pages}`);
  }

  const buffer = decodeBase64(input.data);
  if (TEXT_EXTENSIONS.has(extension)) {
    const raw = buffer.toString("utf8");
    return finalize(/\.html?$/i.test(extension) ? htmlToText(raw) : raw, extension.slice(1).toUpperCase());
  }
  if (extension === ".rtf") return finalize(extractRtf(buffer), "RTF");

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer, { checkCRC32: true });
  } catch {
    throw new DocumentAttachmentError("文件已损坏、被加密，或不是有效的压缩文档");
  }
  assertReasonableArchive(zip);

  let text = "";
  if (extension === ".docx") text = await extractDocx(zip);
  else if (extension === ".pptx") text = await extractPptx(zip);
  else if (extension === ".xlsx") text = await extractXlsx(zip);
  else if ([".odt", ".ods", ".odp"].includes(extension)) text = await extractOpenDocument(zip);
  else if (extension === ".epub") text = await extractEpub(zip);

  return finalize(text, extension.slice(1).toUpperCase());
}
