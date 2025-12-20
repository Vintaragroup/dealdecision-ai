/**
 * Visual Design Scorer v1.0.0
 * 
 * Proxy heuristics for design quality
 * Until layout extraction is available
 * 
 * Based on: DIO Schema v1.0.0, HRM-DD SOP
 */

import { BaseAnalyzer, AnalyzerMetadata, ValidationResult } from "./base";
import type { VisualDesignInput, VisualDesignResult } from "../types/dio";

// ============================================================================
// Design Quality Heuristics
// ============================================================================

const DESIGN_HEURISTICS = {
  // Ideal page count for pitch deck
  ideal_page_count: { min: 10, ideal: 12, max: 15 },
  
  // Average file size per page (rough proxy for images vs text)
  // Well-designed decks with proper images: 200-500 KB per page
  avg_file_size_per_page_kb: { min: 150, ideal: 350, max: 600 },
  
  // Heading consistency (should have clear structure)
  min_headings_ratio: 0.7, // At least 70% of slides should have headings
  
  // Text density (chars per page)
  text_density: { min: 200, ideal: 400, max: 800 },
};

// ============================================================================
// Analyzer Implementation
// ============================================================================

export class VisualDesignScorer extends BaseAnalyzer<VisualDesignInput, VisualDesignResult> {
  readonly metadata: AnalyzerMetadata = {
    name: "visual_design_scorer",
    version: "1.0.0",
    released_at: "2024-12-18",
    changelog: "Initial release - proxy heuristics (page count, file size, structure)"
  };

  /**
   * Analyze visual design
   * DETERMINISTIC - uses proxy heuristics only
   * 
   * NOTE: This is v1.0.0 using proxies until layout extraction is available
   */
  async analyze(input: VisualDesignInput): Promise<VisualDesignResult> {
    const executed_at = new Date().toISOString();

    if (
      !input.page_count || input.page_count < 1 ||
      !input.file_size_bytes || input.file_size_bytes < 1 ||
      !input.total_text_chars || input.total_text_chars < 1
    ) {
      return {
        analyzer_version: this.metadata.version,
        executed_at,

        status: "insufficient_data",
        coverage: 0,
        confidence: 0.3,

        design_score: null,
        proxy_signals: {
          page_count_appropriate: false,
          image_to_text_ratio_balanced: false,
          consistent_formatting: false,
        },
        strengths: [],
        weaknesses: [],
        evidence_ids: input.evidence_ids || [],
        note: "Using proxy heuristics - full visual analysis requires layout extraction",
      };
    }

    try {
      const start = Date.now();

      const headings = Array.isArray(input.headings) ? input.headings : [];

      // Calculate proxy signals
      const page_count_signal = this.evaluatePageCount(input.page_count);
      const image_ratio_signal = this.evaluateImageToTextRatio(
        input.file_size_bytes,
        input.page_count,
        input.total_text_chars
      );
      const formatting_signal = this.evaluateFormatConsistency(
        headings,
        input.page_count
      );

      // Calculate overall design score
      const design_score = this.calculateDesignScore(
        page_count_signal,
        image_ratio_signal,
        formatting_signal
      );

      // Generate insights
      const insights = this.generateInsights(
        page_count_signal,
        image_ratio_signal,
        formatting_signal,
        input
      );

      // Extract strengths and weaknesses from insights
      const strengths: string[] = [];
      const weaknesses: string[] = [];
      
      for (const insight of insights) {
        if (insight.includes('good') || insight.includes('appropriate') || insight.includes('balanced')) {
          strengths.push(insight);
        } else {
          weaknesses.push(insight);
        }
      }

      return {
        analyzer_version: this.metadata.version,
        executed_at,

        status: "ok",
        coverage: 0.8,
        confidence: 0.75,

        design_score,
        proxy_signals: {
          page_count_appropriate: page_count_signal.appropriate,
          image_to_text_ratio_balanced: image_ratio_signal.balanced,
          consistent_formatting: formatting_signal.consistent,
        },
        strengths,
        weaknesses,
        evidence_ids: input.evidence_ids || [],
        note: "Using proxy heuristics - full visual analysis requires layout extraction",
      };
    } catch {
      return {
        analyzer_version: this.metadata.version,
        executed_at,

        status: "extraction_failed",
        coverage: 0,
        confidence: 0.2,

        design_score: null,
        proxy_signals: {
          page_count_appropriate: false,
          image_to_text_ratio_balanced: false,
          consistent_formatting: false,
        },
        strengths: [],
        weaknesses: [],
        evidence_ids: input.evidence_ids || [],
        note: "Using proxy heuristics - full visual analysis requires layout extraction",
      };
    }
  }

  /**
   * Validate input
   */
  validateInput(input: VisualDesignInput): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!input.page_count || input.page_count < 1) {
      errors.push("page_count must be positive");
    }

    if (!input.file_size_bytes || input.file_size_bytes < 1) {
      errors.push("file_size_bytes must be positive");
    }

    if (!input.total_text_chars || input.total_text_chars < 1) {
      errors.push("total_text_chars must be positive");
    }

    if (!input.headings || !Array.isArray(input.headings)) {
      warnings.push("headings array not provided - cannot assess formatting consistency");
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Evaluate page count appropriateness
   */
  private evaluatePageCount(page_count: number): {
    appropriate: boolean;
    score: number;
    reason: string;
  } {
    const { min, ideal, max } = DESIGN_HEURISTICS.ideal_page_count;

    if (page_count >= min && page_count <= max) {
      const distance_from_ideal = Math.abs(page_count - ideal);
      const score = 1 - (distance_from_ideal / (max - min));
      return {
        appropriate: true,
        score,
        reason: `${page_count} pages is within ideal range (${min}-${max})`
      };
    } else if (page_count < min) {
      return {
        appropriate: false,
        score: page_count / min * 0.5,
        reason: `${page_count} pages is too short (minimum ${min} recommended)`
      };
    } else {
      return {
        appropriate: false,
        score: Math.max(0, 1 - ((page_count - max) / max) * 0.5),
        reason: `${page_count} pages is too long (maximum ${max} recommended)`
      };
    }
  }

  /**
   * Evaluate image-to-text ratio (proxy via file size)
   */
  private evaluateImageToTextRatio(
    file_size_bytes: number,
    page_count: number,
    total_text_chars: number
  ): {
    balanced: boolean;
    score: number;
    reason: string;
  } {
    const avg_size_per_page_kb = (file_size_bytes / 1024) / page_count;
    const { min, ideal, max } = DESIGN_HEURISTICS.avg_file_size_per_page_kb;

    // Check if average size per page is in good range
    if (avg_size_per_page_kb >= min && avg_size_per_page_kb <= max) {
      const distance_from_ideal = Math.abs(avg_size_per_page_kb - ideal);
      const score = 1 - (distance_from_ideal / (max - min));
      return {
        balanced: true,
        score,
        reason: `Good balance of images and text (~${Math.round(avg_size_per_page_kb)} KB/page)`
      };
    } else if (avg_size_per_page_kb < min) {
      return {
        balanced: false,
        score: avg_size_per_page_kb / min * 0.6,
        reason: `Too text-heavy - consider adding more visuals (~${Math.round(avg_size_per_page_kb)} KB/page)`
      };
    } else {
      return {
        balanced: false,
        score: Math.max(0, 1 - ((avg_size_per_page_kb - max) / max) * 0.5),
        reason: `File size high - images may need optimization (~${Math.round(avg_size_per_page_kb)} KB/page)`
      };
    }
  }

  /**
   * Evaluate formatting consistency (via headings)
   */
  private evaluateFormatConsistency(
    headings: string[],
    page_count: number
  ): {
    consistent: boolean;
    score: number;
    reason: string;
    heading_coverage: number;
  } {
    const heading_coverage = headings.length / page_count;
    const { min_headings_ratio } = DESIGN_HEURISTICS;

    if (heading_coverage >= min_headings_ratio) {
      return {
        consistent: true,
        score: Math.min(1, heading_coverage),
        reason: `${Math.round(heading_coverage * 100)}% of slides have clear headings`,
        heading_coverage
      };
    } else {
      return {
        consistent: false,
        score: heading_coverage / min_headings_ratio * 0.6,
        reason: `Only ${Math.round(heading_coverage * 100)}% of slides have headings (${Math.round(min_headings_ratio * 100)}% recommended)`,
        heading_coverage
      };
    }
  }

  /**
   * Calculate overall design score (0-100)
   */
  private calculateDesignScore(
    page_count_signal: { score: number },
    image_ratio_signal: { score: number },
    formatting_signal: { score: number }
  ): number {
    // Weighted average
    const weights = {
      page_count: 0.3,
      image_ratio: 0.4,
      formatting: 0.3
    };

    const weighted_score =
      page_count_signal.score * weights.page_count +
      image_ratio_signal.score * weights.image_ratio +
      formatting_signal.score * weights.formatting;

    return Math.round(weighted_score * 100);
  }

  /**
   * Generate insights
   */
  private generateInsights(
    page_count_signal: { appropriate: boolean; reason: string },
    image_ratio_signal: { balanced: boolean; reason: string },
    formatting_signal: { consistent: boolean; reason: string },
    input: VisualDesignInput
  ): string[] {
    const insights: string[] = [];

    // Positive insights
    if (page_count_signal.appropriate) {
      insights.push(page_count_signal.reason);
    }
    if (image_ratio_signal.balanced) {
      insights.push(image_ratio_signal.reason);
    }
    if (formatting_signal.consistent) {
      insights.push(formatting_signal.reason);
    }

    // Improvement suggestions
    if (!page_count_signal.appropriate) {
      insights.push(`⚠ ${page_count_signal.reason}`);
    }
    if (!image_ratio_signal.balanced) {
      insights.push(`⚠ ${image_ratio_signal.reason}`);
    }
    if (!formatting_signal.consistent) {
      insights.push(`⚠ ${formatting_signal.reason}`);
    }

    // Overall assessment
    const all_good = page_count_signal.appropriate && 
                     image_ratio_signal.balanced && 
                     formatting_signal.consistent;
    
    if (all_good) {
      insights.push("✓ Deck structure appears well-designed");
    } else {
      insights.push("Consider improving visual design - details above");
    }

    return insights;
  }
}

// Export singleton instance
export const visualDesignScorer = new VisualDesignScorer();
