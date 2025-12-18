import { extractPDFContent, type PDFContent } from "./pdf";
import { extractExcelContent, type ExcelContent } from "./excel";
import { extractPowerPointContent, type PowerPointContent } from "./powerpoint";
import { extractWordContent, type WordContent } from "./word";
import { extractImageContent, type ImageContent } from "./image";

export type ExtractedContent = PDFContent | ExcelContent | PowerPointContent | WordContent | ImageContent;

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
    | "unknown";
  content: ExtractedContent | null;
  metadata: {
    fileSizeBytes: number;
    processingTimeMs: number;
    extractionSuccess: boolean;
    errorMessage?: string;
  };
  structuredData: {
    keyFinancialMetrics?: Record<string, unknown>;
    keyMetrics: Array<{ key: string; value: unknown; source: string }>;
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
  };
  return typeMap[fileType] || "unknown";
}

export async function processDocument(
  buffer: Buffer,
  fileName: string,
  documentId: string,
  dealId: string
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
          extractedContent = await extractPDFContent(buffer, { docId: documentId });
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
