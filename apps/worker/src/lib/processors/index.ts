import { extractPDFContent, type PDFContent, type PdfTextProbeCallback } from "./pdf";
import { extractPDFContentV2Primary, extractPDFContentV2Shadow } from "./pdf-v2";
import { applySlideUnderstandingV1Shadow } from "../pdf_v2/slide-understanding-v1";
import { defaultPdfExtractMode, defaultShadowFeatureMode } from "../pipeline-policy";
import { extractExcelContent, type ExcelContent } from "./excel";
import { extractPowerPointContent, type PowerPointContent } from "./powerpoint";
import { extractWordContent, type WordContent } from "./word";
import { extractImageContent, type ImageContent } from "./image";
import { extractCSVContent, type CSVContent } from "./csv";

export type ExtractedContent = PDFContent | ExcelContent | PowerPointContent | WordContent | ImageContent | CSVContent;

export interface DocumentAnalysis {
  documentId: string;
  dealId: string;
  fileType: string;
  fileName: string;
  extractedAt: string;
  contentType:
    | "pdf"
    | "excel"
    | "powerpoint"
    | "word"
    | "image"
    | "csv"
    | "unknown";
  content: ExtractedContent | null;
  metadata: {
    fileSizeBytes: number;
    processingTimeMs: number;
    extractionSuccess: boolean;
    errorMessage?: string;
  };
  structuredData: {
    keyMetrics: Array<{ key: string; value: unknown; source: string }>;
    keyFinancialMetrics?: Record<string, unknown>;
    mainHeadings: string[];
    textSummary: string;
    entities: Array<{ type: string; value: string }>;
  };
}

function detectFileType(fileName: string): string {
  const ext = fileName.toLowerCase().split(".").pop() || "";
  return ext;
}

function getContentType(
  fileType: string
): DocumentAnalysis["contentType"] {
  const typeMap: Record<string, DocumentAnalysis["contentType"]> = {
    pdf: "pdf",
    xlsx: "excel",
    xls: "excel",
    pptx: "powerpoint",
    ppt: "powerpoint",
    docx: "word",
    doc: "word",
    png: "image",
    jpg: "image",
    jpeg: "image",
    gif: "image",
    csv: "csv",
  };
  return typeMap[fileType] || "unknown";
}

export async function processDocument(
  buffer: Buffer,
  fileName: string,
  documentId: string,
  dealId: string,
  hooks: { onPdfTextProbe?: PdfTextProbeCallback } = {}
): Promise<DocumentAnalysis> {
  const startTime = Date.now();
  const fileType = detectFileType(fileName);
  const contentType = getContentType(fileType);
  let extractedContent: ExtractedContent | null = null;
  let extractionSuccess = false;
  let errorMessage: string | undefined;

  try {
    switch (contentType) {
      case "pdf": {
        try {
          // PDF Extraction v2 rollout modes:
          // - v1 (default): only v1 extractor
          // - v2_shadow: run v2 best-effort and persist artifacts, but keep v1 outputs authoritative
          // - v2_primary: (future) use v2 outputs as authoritative
          const mode = String(process.env.PDF_EXTRACT_MODE || defaultPdfExtractMode(process.env))
            .trim()
            .toLowerCase();

          const slideUnderstandingMode = String(
            process.env.PDF_SLIDE_UNDERSTANDING_MODE || defaultShadowFeatureMode(process.env)
          )
            .trim()
            .toLowerCase();

          if (mode === "v2_primary") {
            try {
              const pdfContent = await extractPDFContentV2Primary(buffer, {
                docId: documentId,
                fileName,
              });

              // Slide Understanding v1 (PDF-only). Shadow mode attaches additive artifacts under content.pdf_v2.pages[i].understanding_v1.
              // Must not modify structured_data/full_text in this mode.
              if (slideUnderstandingMode === "shadow") {
                try {
                  applySlideUnderstandingV1Shadow(pdfContent as any);
                } catch {
                  // best-effort; never fail ingestion
                }
              }

              extractedContent = pdfContent;
              extractionSuccess = true;
              break;
            } catch {
              // Safety: never block ingestion; fall back to v1.
              // We'll still attach v2 error artifacts below via shadow block if enabled.
            }
          }

          const v1 = await extractPDFContent(buffer, { docId: documentId, onTextProbe: hooks.onPdfTextProbe });

          if (mode === "v2_shadow") {
            try {
              const v2 = await extractPDFContentV2Shadow(buffer, {
                docId: documentId,
                fileName,
              });
              (v1 as unknown as { pdf_v2?: unknown }).pdf_v2 = v2;
            } catch (err) {
              // Shadow mode must never fail ingestion; attach error for observability.
              (v1 as unknown as { pdf_v2?: unknown }).pdf_v2 = {
                status: "error",
                error: err instanceof Error ? err.message : String(err),
              };
            }
          }

          // Slide Understanding v1 (PDF-only). Shadow mode attaches additive artifacts under content.pdf_v2.pages[i].understanding_v1.
          // Must not modify structured_data/full_text in this mode.
          if (slideUnderstandingMode === "shadow") {
            try {
              applySlideUnderstandingV1Shadow(v1 as any);
            } catch {
              // best-effort; never fail ingestion
            }
          }

          extractedContent = v1;
          extractionSuccess = true;
        } catch (pdfErr) {
          const errMsg = pdfErr instanceof Error ? pdfErr.message : String(pdfErr);
          // If PDF fails due to encoding, try to detect and report specifically
          if (errMsg.includes("UTF") || errMsg.includes("encoding")) {
            throw new Error(`PDF encoding error: ${errMsg}. The file may be corrupted or use an unsupported encoding.`);
          }
          throw pdfErr;
        }
        break;
      }

      case "excel":
        extractedContent = extractExcelContent(buffer);
        extractionSuccess = true;
        break;

      case "powerpoint":
        extractedContent = await extractPowerPointContent(buffer);
        extractionSuccess = true;
        break;

      case "word":
        extractedContent = await extractWordContent(buffer);
        extractionSuccess = true;
        break;

      case "image":
        // Extract text from images using OCR (Tesseract)
        try {
          extractedContent = await extractImageContent(buffer);
          extractionSuccess = true;
        } catch (imgErr) {
          const errMsg = imgErr instanceof Error ? imgErr.message : String(imgErr);
          errorMessage = `Image OCR failed: ${errMsg}`;
          extractionSuccess = false;
        }
        break;

      case "csv":
        extractedContent = extractCSVContent(buffer);
        extractionSuccess = true;
        break;

      default:
        extractionSuccess = false;
        errorMessage = `Unsupported file type: ${fileType}`;
    }
  } catch (err) {
    extractionSuccess = false;
    errorMessage = err instanceof Error ? err.message : "Unknown processing error";
  }

  // Extract structured data from content
  const structuredData = extractStructuredData(
    extractedContent,
    contentType
  );

  return {
    documentId,
    dealId,
    fileType,
    fileName,
    extractedAt: new Date().toISOString(),
    contentType,
    content: extractedContent,
    metadata: {
      fileSizeBytes: buffer.length,
      processingTimeMs: Date.now() - startTime,
      extractionSuccess,
      errorMessage,
    },
    structuredData,
  };
}

function extractStructuredData(
  content: ExtractedContent | null,
  contentType: DocumentAnalysis["contentType"]
): DocumentAnalysis["structuredData"] {
  const baseData: DocumentAnalysis["structuredData"] = {
    keyMetrics: [],
    mainHeadings: [],
    textSummary: "",
    entities: [],
  };

  if (!content) return baseData;

  switch (contentType) {
    case "pdf": {
      const pdf = content as PDFContent;
      baseData.mainHeadings = pdf.summary.mainHeadings;
      baseData.textSummary = pdf.pages
        .slice(0, 3)
        .map((p) => p.text)
        .join(" ")
        .substring(0, 500);
      baseData.keyMetrics = pdf.summary.keyNumbers.map((n) => ({
        key: "numeric_value",
        value: n.value,
        source: n.context,
      }));
      break;
    }

    case "excel": {
      const excel = content as ExcelContent;
      baseData.mainHeadings = excel.metadata.sheetNames;
      baseData.textSummary = `Excel workbook with ${excel.metadata.totalSheets} sheet(s), ${excel.summary.totalRows} total rows`;
      baseData.keyFinancialMetrics = {};
      for (const metric of excel.summary.numericMetrics.slice(0, 10)) {
        baseData.keyFinancialMetrics[`${metric.sheet}_${metric.column}`] = {
          min: metric.min,
          max: metric.max,
          avg: metric.avg,
        };
      }
      baseData.keyMetrics = excel.summary.numericMetrics.map((m) => ({
        key: `${m.sheet}.${m.column}`,
        value: { min: m.min, max: m.max, avg: m.avg },
        source: m.sheet,
      }));
      break;
    }

    case "csv": {
      const csv = content as CSVContent;
      const header = Array.isArray(csv.header) ? csv.header : [];
      const rows = Array.isArray(csv.rows) ? csv.rows : [];

      baseData.mainHeadings = header;
      baseData.textSummary = `CSV with ${rows.length} row(s), ${header.length} column(s)`;

      const lowerHeader = header.map((h) => String(h || "").trim().toLowerCase());
      const metricIdx = lowerHeader.findIndex((h) => h === "metric" || h === "key" || h === "name");
      const valueIdx = lowerHeader.findIndex((h) => h === "value" || h === "amount" || h === "val");

      if (metricIdx >= 0 && valueIdx >= 0) {
        for (const row of rows.slice(0, 50)) {
          const k = String(row?.[metricIdx] ?? "").trim();
          const vRaw = String(row?.[valueIdx] ?? "").trim();
          if (!k) continue;

          const vNum = Number(vRaw.replace(/[$,%\s]/g, ""));
          const value = Number.isFinite(vNum) && vRaw !== "" ? vNum : vRaw;
          baseData.keyMetrics.push({ key: k, value, source: "csv" });
        }
      } else {
        // Fallback: pick up numeric values from the first rows.
        for (const row of rows.slice(0, 20)) {
          for (let i = 0; i < Math.min(row.length, header.length); i++) {
            const h = header[i] || `col_${i}`;
            const raw = String(row[i] ?? "").trim();
            const n = Number(raw.replace(/[$,%\s]/g, ""));
            if (!raw || !Number.isFinite(n)) continue;
            baseData.keyMetrics.push({ key: String(h), value: n, source: "csv" });
            if (baseData.keyMetrics.length >= 25) break;
          }
          if (baseData.keyMetrics.length >= 25) break;
        }
      }
      break;
    }

    case "powerpoint": {
      const ppt = content as PowerPointContent;
      baseData.mainHeadings = ppt.summary.mainTopics;
      baseData.textSummary = ppt.summary.keyMessages.join(" | ");
      baseData.keyMetrics = ppt.slides
        .filter((s) => s.title)
        .map((s) => ({
          key: "slide_title",
          value: s.title || "",
          source: `Slide ${s.slideNumber}`,
        }));
      break;
    }

    case "word": {
      const word = content as WordContent;
      baseData.mainHeadings = word.summary.headings;
      baseData.textSummary = word.summary.totalText.substring(0, 500);
      baseData.keyMetrics = word.summary.headings.map((h) => ({
        key: "section_heading",
        value: h,
        source: "document",
      }));
      break;
    }

    case "image": {
      const image = content as ImageContent;
      baseData.mainHeadings = image.summary.mainHeadings;
      baseData.textSummary = image.ocrText.substring(0, 500);
      baseData.keyMetrics = image.summary.keyMetrics.map((m) => ({
        key: "numeric_value",
        value: m.value,
        source: m.context,
      }));
      break;
    }
  }

  return baseData;
}
