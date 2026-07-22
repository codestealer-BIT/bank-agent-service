declare module "pdf-parse/lib/pdf-parse.js" {
  type PdfParseOptions = {
    max?: number;
  };

  type PdfParseResult = {
    numpages: number;
    numrender: number;
    info: Record<string, unknown>;
    metadata: unknown;
    text: string;
    version: string;
  };

  export default function pdfParse(
    data: Buffer,
    options?: PdfParseOptions,
  ): Promise<PdfParseResult>;
}
