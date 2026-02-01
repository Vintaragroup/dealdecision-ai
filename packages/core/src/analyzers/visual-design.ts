/**
 * Visual Design Scorer v1.0.0
 * 
 * Proxy heuristics for design quality
 * Until layout extraction is available
 * 
 * Based on: DIO Schema v1.0.0, HRM-DD SOP
 */

import { BaseAnalyzer, AnalyzerMetadata, ValidationResult } from "./base";
import type { DebugScoringTrace, VisualDesignInput, VisualDesignResult } from "../types/dio";
import { buildRulesFromBaseAndDeltas } from "./debug-scoring";

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

    const debugEnabled = Boolean((input as any).debug_scoring);

    if (
      !input.page_count || input.page_count < 1 ||
      !input.file_size_bytes || input.file_size_bytes < 1 ||
      !input.total_text_chars || input.total_text_chars < 1
    ) {
      const debug_scoring: DebugScoringTrace | undefined = debugEnabled
        ? {
            inputs_used: ["page_count", "file_size_bytes", "total_text_chars"],
            rules: [{ rule_id: "excluded", description: "Excluded: missing proxy inputs", delta: 0, running_total: 0 }],
            exclusion_reason: "insufficient_data: missing page_count/file_size_bytes/total_text_chars",
            input_summary: {
              completeness: {
                score: 0,
                notes: ["missing page_count/file_size_bytes/total_text_chars"],
              },
              signals_count: 0,
            },
            signals: [],
            penalties: [],
            bonuses: [],
            final: { score: null, formula: "N/A (insufficient input)" },
          }
        : undefined;

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
        ...(debugEnabled ? { debug_scoring } : {}),
      };
    }

    try {
      const start = Date.now();

      const headings = Array.isArray(input.headings) ? input.headings : [];
      const headingsCount = headings.filter((h) => typeof h === "string" && h.trim().length > 0).length;

      const primary_doc_type = (input as any).primary_doc_type as string | undefined;
      const totalPages = typeof input.page_count === "number" && input.page_count > 0 ? input.page_count : 0;
      const headingDensity = totalPages > 0 ? headingsCount / totalPages : 0;

      const text_items_count = typeof (input as any).text_items_count === "number" ? ((input as any).text_items_count as number) : undefined;
      const textItemsLow = (typeof text_items_count === "number" && text_items_count >= 0)
        ? text_items_count < 80
        : input.total_text_chars < 500;

      const textSummary = typeof (input as any).text_summary === "string" && (input as any).text_summary.trim().length > 0
        ? String((input as any).text_summary)
        : headings.join(" ");
      const symbolRatio = (() => {
        const s = textSummary;
        const chars = s.replace(/\s+/g, "");
        if (chars.length === 0) return 0;
        const symbols = (chars.match(/[^a-z0-9]/gi) || []).length;
        return symbols / chars.length;
      })();
      const ocrNoisy = symbolRatio > 0.35;

      const headingReliability: "reliable" | "unknown" =
        headingDensity < 0.25 && (textItemsLow || ocrNoisy) ? "unknown" : "reliable";
      const formattingWeightMultiplier = headingReliability === "unknown" ? 0.2 : 1;

      // Calculate proxy signals
      const page_count_signal = this.evaluatePageCount(input.page_count, primary_doc_type);
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
        formatting_signal,
        { formattingWeightMultiplier }
      );

      const debug_scoring: DebugScoringTrace | undefined = debugEnabled
        ? (() => {
            const weights = {
              page_count: 0.3,
              image_ratio: 0.4,
              formatting: 0.3 * formattingWeightMultiplier,
            };

            const weightsSum = weights.page_count + weights.image_ratio + weights.formatting;
            const normalized = {
              page_count: weights.page_count / weightsSum,
              image_ratio: weights.image_ratio / weightsSum,
              formatting: weights.formatting / weightsSum,
            };

            const signals = [
              { key: "page_count", value: input.page_count },
              { key: "file_size_bytes", value: input.file_size_bytes },
              { key: "total_text_chars", value: input.total_text_chars },
              { key: "primary_doc_type", value: primary_doc_type || "unknown" },
              { key: "headings_count", value: headingsCount },
              { key: "heading_density", value: Math.round(headingDensity * 1000) / 1000 },
              { key: "symbol_ratio", value: Math.round(symbolRatio * 1000) / 1000 },
              { key: "heading_reliability", value: headingReliability },
              { key: "formatting_weight_multiplier", value: formattingWeightMultiplier },
              { key: "page_count_signal_score", value: Math.round(page_count_signal.score * 1000) / 1000, weight: normalized.page_count },
              { key: "image_ratio_signal_score", value: Math.round(image_ratio_signal.score * 1000) / 1000, weight: normalized.image_ratio },
              { key: "formatting_signal_score", value: Math.round(formatting_signal.score * 1000) / 1000, weight: normalized.formatting },
            ];

            const bonuses = [
              page_count_signal.appropriate ? { key: "page_count_appropriate", points: 0, note: page_count_signal.reason } : null,
              image_ratio_signal.balanced ? { key: "image_to_text_balanced", points: 0, note: image_ratio_signal.reason } : null,
              formatting_signal.consistent ? { key: "formatting_consistent", points: 0, note: formatting_signal.reason } : null,
            ].filter(Boolean) as any[];

            const penalties = [
              !page_count_signal.appropriate ? { key: "page_count_issue", points: 0, note: page_count_signal.reason } : null,
              !image_ratio_signal.balanced ? { key: "image_to_text_issue", points: 0, note: image_ratio_signal.reason } : null,
              !formatting_signal.consistent ? {
                key: "formatting_issue",
                points: 0,
                note: formattingWeightMultiplier < 1
                  ? `${formatting_signal.reason} (heading reliability ${headingReliability}; formatting weight x${formattingWeightMultiplier})`
                  : formatting_signal.reason,
              } : null,
            ].filter(Boolean) as any[];

            // Deterministic rule breakdown: each weighted proxy component contribution.
            const componentBonuses = [
              {
                key: "page_count_component",
                points: normalized.page_count * page_count_signal.score * 100,
                note: `w=${normalized.page_count.toFixed(3)} score=${page_count_signal.score.toFixed(3)}`,
              },
              {
                key: "image_ratio_component",
                points: normalized.image_ratio * image_ratio_signal.score * 100,
                note: `w=${normalized.image_ratio.toFixed(3)} score=${image_ratio_signal.score.toFixed(3)}`,
              },
              {
                key: "formatting_component",
                points: normalized.formatting * formatting_signal.score * 100,
                note: `w=${normalized.formatting.toFixed(3)} score=${formatting_signal.score.toFixed(3)}`,
              },
            ];

            const rules = buildRulesFromBaseAndDeltas({
              base: 0,
              base_rule_id: "weighted_avg_base",
              base_description: "Weighted proxy components sum",
              bonuses: componentBonuses.map((b) => ({
                rule_id: `component:${b.key}`,
                description: b.note ? `${b.key}: ${b.note}` : b.key,
                points: b.points,
              })),
              final_score: design_score,
              clamp_range: { min: 0, max: 100 },
            });

            return {
              inputs_used: [
                "page_count",
                "file_size_bytes",
                "total_text_chars",
                ...(Array.isArray(input.headings) ? ["headings[]"] : []),
                ...((input as any).primary_doc_type ? ["primary_doc_type"] : []),
                ...((input as any).text_summary ? ["text_summary"] : []),
              ],
              rules,
              exclusion_reason: null,
              input_summary: {
                completeness: {
                  score: 1,
                  notes: ["proxy inputs present"],
                },
                signals_count: signals.length + bonuses.length + penalties.length,
              },
              signals,
              penalties,
              bonuses,
              final: {
                score: design_score,
                formula: formattingWeightMultiplier < 1
                  ? "score = round(weighted_avg(page_count,image_ratio,formatting; formatting weight reduced) * 100)"
                  : "score = round((0.3*page_count + 0.4*image_ratio + 0.3*formatting) * 100)",
              },
            };
          })()
        : undefined;

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
        ...(debugEnabled ? { debug_scoring } : {}),
      };
    } catch {
      const debug_scoring: DebugScoringTrace | undefined = debugEnabled
        ? {
            inputs_used: [
              ...(typeof input.page_count === "number" ? ["page_count"] : []),
              ...(typeof input.file_size_bytes === "number" ? ["file_size_bytes"] : []),
              ...(typeof input.total_text_chars === "number" ? ["total_text_chars"] : []),
              ...(Array.isArray((input as any).headings) ? ["headings[]"] : []),
            ],
            rules: [{ rule_id: "excluded", description: "Excluded: exception during analysis", delta: 0, running_total: 0 }],
            exclusion_reason: "extraction_failed: exception during analysis",
            input_summary: {
              completeness: { score: 1, notes: ["exception during analysis"] },
              signals_count: 0,
            },
            signals: [],
            penalties: [],
            bonuses: [],
            final: { score: null, formula: "N/A (extraction_failed)" },
          }
        : undefined;

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
        ...(debugEnabled ? { debug_scoring } : {}),
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
  private evaluatePageCountWithDocType(page_count: number, primary_doc_type?: string): {
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
      const docType = primary_doc_type || "unknown";
      const applyTooLongPenalty = docType === "pitch_deck" && page_count >= 18;
      if (applyTooLongPenalty) {
        return {
          appropriate: false,
          score: Math.max(0, 1 - ((page_count - max) / max) * 0.5),
          reason: `${page_count} pages is too long (maximum ${max} recommended)`
        };
      }

      // Treat as within tolerance: do not apply the "too long" penalty unless pitch_deck && >= 18.
      const softScore = docType === "pitch_deck" ? 0.85 : 0.9;
      const reason = docType === "pitch_deck"
        ? `${page_count} pages is slightly above pitch deck max (${max}); penalty suppressed until >= 18 pages`
        : `${page_count} pages above pitch deck max (${max}); not penalized for primary_doc_type=${docType}`;
      return {
        appropriate: true,
        score: softScore,
        reason,
      };
    }
  }

  private evaluatePageCount(page_count: number, primary_doc_type?: string): {
    appropriate: boolean;
    score: number;
    reason: string;
  } {
    return this.evaluatePageCountWithDocType(page_count, primary_doc_type);
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
    const headingsCount = headings.filter((h) => typeof h === "string" && h.trim().length > 0).length;
    const heading_coverage = headingsCount / page_count;
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
    formatting_signal: { score: number },
    opts?: { formattingWeightMultiplier?: number }
  ): number {
    // Weighted average
    const formattingWeightMultiplier = typeof opts?.formattingWeightMultiplier === "number" ? opts.formattingWeightMultiplier : 1;
    const weights = {
      page_count: 0.3,
      image_ratio: 0.4,
      formatting: 0.3 * formattingWeightMultiplier,
    };

    const denom = weights.page_count + weights.image_ratio + weights.formatting;
    const safeDenom = denom > 0 ? denom : 1;

    const weighted_score =
      page_count_signal.score * weights.page_count +
      image_ratio_signal.score * weights.image_ratio +
      formatting_signal.score * weights.formatting;

    return Math.round((weighted_score / safeDenom) * 100);
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
