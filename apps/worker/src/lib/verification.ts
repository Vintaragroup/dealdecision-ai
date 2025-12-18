/**
 * Document verification pipeline
 * Checks OCR quality, text coherence, data completeness after extraction
 */

import type { DocumentAnalysis, ExtractedContent } from "./processors";

export interface VerificationResult {
  verified_at: string;
  overall_score: number; // 0-1
  quality_checks: {
    ocr_confidence: {
      avg: number;
      min: number;
      max: number;
      status: "pass" | "warn" | "fail";
      details?: string;
    };
    text_coherence: {
      score: number;
      status: "pass" | "warn" | "fail";
      details?: string;
    };
    data_completeness: {
      score: number;
      status: "pass" | "warn" | "fail";
      details?: string;
    };
    extraction_success: boolean;
  };
  warnings: string[];
  recommendations: string[];
}

/**
 * Extract OCR confidence metrics from content
 */
function analyzeOCRConfidence(content: ExtractedContent | null, contentType: string): {
  avg: number;
  min: number;
  max: number;
  totalWords: number;
} {
  if (!content) return { avg: 0, min: 0, max: 0, totalWords: 0 };

  const confidences: number[] = [];

  switch (contentType) {
    case "pdf": {
      const pdf = content as any;
      if (pdf.pages && Array.isArray(pdf.pages)) {
        for (const page of pdf.pages) {
          if (page.words && Array.isArray(page.words)) {
            for (const word of page.words) {
              if (typeof word.conf === "number") {
                confidences.push(word.conf);
              }
            }
          }
        }
      }
      break;
    }
    // Other types may not have OCR confidence if not image-based
  }

  if (confidences.length === 0) {
    return { avg: 100, min: 100, max: 100, totalWords: 0 }; // Native text
  }

  const avg = confidences.reduce((a, b) => a + b, 0) / confidences.length;
  const min = Math.min(...confidences);
  const max = Math.max(...confidences);

  return { avg, min, max, totalWords: confidences.length };
}

/**
 * Check text coherence - does the extracted text make sense?
 */
function analyzeTextCoherence(fullText: string | undefined): {
  score: number;
  issues: string[];
} {
  const issues: string[] = [];
  let score = 1.0;

  if (!fullText || fullText.length === 0) {
    return { score: 0, issues: ["No text extracted"] };
  }

  // Check for excessive special characters indicating OCR errors
  const specialCharRatio = (fullText.match(/[^a-zA-Z0-9\s\.\,\-\:\;\'\"\(\)]/g) || []).length / fullText.length;
  if (specialCharRatio > 0.15) {
    score -= 0.3;
    issues.push(`High special character ratio (${(specialCharRatio * 100).toFixed(1)}%) - possible OCR errors`);
  }

  // Check average word length (OCR errors often produce weird word lengths)
  const words = fullText.split(/\s+/).filter(w => w.length > 0);
  if (words.length > 0) {
    const avgWordLength = words.reduce((a, w) => a + w.length, 0) / words.length;
    if (avgWordLength < 2 || avgWordLength > 15) {
      score -= 0.2;
      issues.push(`Unusual average word length (${avgWordLength.toFixed(1)} chars) - text may be garbled`);
    }
  }

  // Check for common OCR error patterns
  if (/[0O]l{2,}/.test(fullText) || /[l1|]{3,}/.test(fullText)) {
    score -= 0.2;
    issues.push("Detected common OCR confusion patterns (0/O/l/1)");
  }

  // Minimum text length
  if (fullText.length < 50) {
    score -= 0.2;
    issues.push("Very short extracted text - may indicate extraction failure");
  }

  return { score: Math.max(0, score), issues };
}

/**
 * Check data completeness - was enough structured data extracted?
 */
function analyzeDataCompleteness(
  analysis: DocumentAnalysis,
  pageCount: number
): {
  score: number;
  details: Record<string, any>;
  issues: string[];
} {
  const details: Record<string, any> = {};
  const issues: string[] = [];
  let score = 0;

  // Metrics extraction
  const metricsCount = analysis.structuredData.keyMetrics?.length ?? 0;
  details.metricsCount = metricsCount;
  if (metricsCount >= 3) {
    score += 0.3;
  } else if (metricsCount >= 1) {
    score += 0.15;
    issues.push(`Few metrics extracted (${metricsCount}) - document may need review`);
  } else {
    issues.push("No metrics extracted - document may not contain quantitative data");
  }

  // Headings/sections extraction
  const headingsCount = analysis.structuredData.mainHeadings?.length ?? 0;
  details.headingsCount = headingsCount;
  if (headingsCount >= 5) {
    score += 0.3;
  } else if (headingsCount >= 2) {
    score += 0.15;
    issues.push(`Few sections identified (${headingsCount}) - structure may not have been captured`);
  } else {
    issues.push("Minimal document structure identified");
  }

  // Text summary length
  const summaryLen = analysis.structuredData.textSummary?.length ?? 0;
  details.summaryLength = summaryLen;
  if (summaryLen >= 300) {
    score += 0.4;
  } else if (summaryLen >= 100) {
    score += 0.2;
  } else if (summaryLen > 0) {
    score += 0.1;
    issues.push("Brief summary only - may indicate partial extraction");
  } else {
    issues.push("No summary text extracted");
  }

  // Page coverage expectation
  if (pageCount > 0) {
    // Rough heuristic: expect at least 1-2 headings per page and some metrics
    const expectedHeadings = Math.max(2, Math.floor(pageCount / 3));
    if (headingsCount < expectedHeadings) {
      issues.push(`Expected ~${expectedHeadings} sections for ${pageCount} pages, found ${headingsCount}`);
    }
  }

  return { score: Math.min(1, score), details, issues };
}

/**
 * Run complete verification on extracted document
 */
export function verifyDocumentExtraction(params: {
  analysis: DocumentAnalysis;
  fullText: string | undefined;
  pageCount: number;
  extractionMetadata: any;
}): VerificationResult {
  const { analysis, fullText, pageCount, extractionMetadata } = params;

  const warnings: string[] = [];
  const recommendations: string[] = [];

  // OCR Confidence check
  const ocrAnalysis = analyzeOCRConfidence(analysis.content, analysis.contentType);
  const ocrStatus = analysis.contentType === "pdf" && ocrAnalysis.totalWords > 0
    ? ocrAnalysis.avg >= 90
      ? "pass"
      : ocrAnalysis.avg >= 75
      ? "warn"
      : "fail"
    : "pass"; // Non-PDF or native text doesn't use OCR

  if (ocrStatus === "warn") {
    warnings.push(`OCR confidence below ideal (${ocrAnalysis.avg.toFixed(1)}%) - some words may be misread`);
  } else if (ocrStatus === "fail") {
    warnings.push(`OCR confidence very low (${ocrAnalysis.avg.toFixed(1)}%) - high error rate likely`);
    recommendations.push("Consider re-scanning document at higher resolution");
  }

  // Text coherence check
  const coherenceAnalysis = analyzeTextCoherence(fullText);
  const coherenceStatus = coherenceAnalysis.score >= 0.8 ? "pass" : coherenceAnalysis.score >= 0.5 ? "warn" : "fail";
  warnings.push(...coherenceAnalysis.issues);

  if (coherenceStatus === "fail") {
    recommendations.push("Document text appears heavily corrupted - manual review recommended");
  }

  // Data completeness check
  const completenessAnalysis = analyzeDataCompleteness(analysis, pageCount);
  const completenessStatus = completenessAnalysis.score >= 0.8 ? "pass" : completenessAnalysis.score >= 0.5 ? "warn" : "fail";
  warnings.push(...completenessAnalysis.issues);

  if (completenessStatus === "warn" || completenessStatus === "fail") {
    recommendations.push("Extracted data may be incomplete - verify against source document");
  }

  // Overall score
  const weights = { ocr: 0.25, coherence: 0.35, completeness: 0.4 };
  const ocrScore = ocrStatus === "pass" ? 1 : ocrStatus === "warn" ? 0.7 : 0.4;
  const overallScore =
    ocrScore * weights.ocr +
    coherenceAnalysis.score * weights.coherence +
    completenessAnalysis.score * weights.completeness;

  // Final recommendations
  if (overallScore >= 0.8) {
    recommendations.push("Document extraction quality is good - ready for analysis");
  } else if (overallScore >= 0.6) {
    recommendations.push("Document quality acceptable - review extracted data before analysis");
  } else {
    recommendations.push("Document extraction quality is poor - manual review required");
  }

  return {
    verified_at: new Date().toISOString(),
    overall_score: overallScore,
    quality_checks: {
      ocr_confidence: {
        avg: ocrAnalysis.avg,
        min: ocrAnalysis.min,
        max: ocrAnalysis.max,
        status: ocrStatus,
        details: ocrAnalysis.totalWords > 0 ? `${ocrAnalysis.totalWords} words analyzed` : "Native text (no OCR)",
      },
      text_coherence: {
        score: coherenceAnalysis.score,
        status: coherenceStatus,
        details: `${fullText?.length ?? 0} characters, ${(fullText?.split(/\s+/).length ?? 0)} words`,
      },
      data_completeness: {
        score: completenessAnalysis.score,
        status: completenessStatus,
        details: completenessAnalysis.details,
      },
      extraction_success: analysis.metadata.extractionSuccess,
    },
    warnings,
    recommendations,
  };
}
