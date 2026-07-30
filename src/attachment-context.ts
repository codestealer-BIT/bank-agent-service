export type AttachmentExtractionStatus =
  | "extracted"
  | "empty"
  | "visual_only"
  | "metadata_only";

export type AttachmentContextRecord = {
  name: string;
  mediaType: string;
  size?: number;
  kind: "image" | "pdf" | "document" | "text_file" | "file";
  extractionStatus: AttachmentExtractionStatus;
  parser:
    | "pdf-parse"
    | "pdf-text-and-page-renderer"
    | "document-parser"
    | "document-parser-and-embedded-images"
    | "client-text"
    | "model-vision"
    | "none";
  extractedText?: string;
  format?: string;
  pageCount?: number;
  truncated?: boolean;
  details?: string;
};

const MAX_REFLECTION_ATTACHMENT_CHARS = 24_000;

function parseRecords(value: unknown): AttachmentContextRecord[] {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (item): item is AttachmentContextRecord =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as AttachmentContextRecord).name === "string" &&
      typeof (item as AttachmentContextRecord).mediaType === "string",
  );
}

/**
 * Renders persisted attachment extraction results in their original order.
 * The cap protects the reflection prompt while the full parser output remains
 * available in turns.attachment_context.
 */
export function renderAttachmentContextForReflection(value: unknown): string {
  const records = parseRecords(value);
  if (!records.length) return "";

  let remaining = MAX_REFLECTION_ATTACHMENT_CHARS;
  const sections: string[] = [];
  for (const [index, record] of records.entries()) {
    if (remaining <= 0) break;
    const metadata = [
      `Attachment ${index + 1}: ${record.name}`,
      `Media type: ${record.mediaType}`,
      `Extraction status: ${record.extractionStatus}`,
      record.format ? `Format: ${record.format}` : "",
      record.pageCount == null ? "" : `Pages: ${record.pageCount}`,
      record.details ? `Details: ${record.details}` : "",
      record.truncated ? "Parser output was truncated before persistence." : "",
    ].filter(Boolean);
    const header = metadata.join("\n");
    const availableForText = Math.max(0, remaining - header.length - 1);
    const extractedText = (record.extractedText ?? "").slice(0, availableForText);
    const section = extractedText ? `${header}\n${extractedText}` : header;
    sections.push(section);
    remaining -= section.length + 2;
  }

  return ["<ATTACHMENT_CONTEXT>", ...sections, "</ATTACHMENT_CONTEXT>"].join(
    "\n\n",
  );
}
