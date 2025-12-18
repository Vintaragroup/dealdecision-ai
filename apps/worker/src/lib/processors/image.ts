import Tesseract from "tesseract.js";

export interface ImageContent {
  metadata: {
    width?: number;
    height?: number;
    format?: string;
  };
  ocrText: string;
  confidence: number;
  summary: {
    totalWords: number;
    mainHeadings: string[];
    keyMetrics: Array<{ value: string; context: string }>;
  };
}

/**
 * Extract text from images using Tesseract OCR
 */
export async function extractImageContent(buffer: Buffer): Promise<ImageContent> {
  try {
    // Convert buffer to base64 data URL for Tesseract
    const base64Data = buffer.toString("base64");
    const dataUrl = `data:image/png;base64,${base64Data}`;

    // Run OCR
    const result = await Tesseract.recognize(dataUrl, "eng", {
      logger: (m) => {
        // Suppress verbose logging
        if (m.status === "recognizing text") {
          // Only log major milestones
          if (Math.round(m.progress * 100) % 25 === 0) {
            console.log(`[image-ocr] Progress: ${Math.round(m.progress * 100)}%`);
          }
        }
      },
    });

    const text = result.data.text || "";
    const confidence = result.data.confidence || 0;

    // Extract basic metrics
    const words = text.split(/\s+/).filter((w) => w.length > 0);
    const mainHeadings: string[] = [];
    const keyMetrics: Array<{ value: string; context: string }> = [];

    // Simple heuristic: lines that are short and capitalized might be headings
    const lines = text.split("\n").filter((l) => l.trim().length > 0);
    for (const line of lines) {
      const trimmed = line.trim();
      // Heuristic: heading if short, starts with capital, and all caps or title case
      if (
        trimmed.length < 60 &&
        trimmed[0] === trimmed[0].toUpperCase() &&
        (trimmed === trimmed.toUpperCase() || /^[A-Z][a-z\s]+$/.test(trimmed))
      ) {
        mainHeadings.push(trimmed);
      }

      // Try to find numeric values (simple pattern)
      const numMatches = trimmed.match(/[\$€£]?\d+[.,]?\d*[%]?|\d+[.,]\d+|\d+%/g);
      if (numMatches) {
        for (const num of numMatches) {
          keyMetrics.push({ value: num, context: trimmed.substring(0, 50) });
        }
      }
    }

    // Clean up duplicates
    const uniqueHeadings = [...new Set(mainHeadings)].slice(0, 10);
    const uniqueMetrics = [
      ...new Map(keyMetrics.map((m) => [m.value, m])).values(),
    ].slice(0, 20);

    return {
      metadata: {
        format: "image/png",
      },
      ocrText: text,
      confidence: confidence / 100, // Normalize to 0-1
      summary: {
        totalWords: words.length,
        mainHeadings: uniqueHeadings,
        keyMetrics: uniqueMetrics,
      },
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    throw new Error(`Image OCR processing failed: ${errMsg}`);
  }
}
