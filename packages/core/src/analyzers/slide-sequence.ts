/**
 * Slide Sequence Analyzer v1.0.0
 * 
 * Pattern matching against 25 funded pitch decks
 * Deterministic scoring based on heading structure
 * 
 * Based on: DIO Schema v1.0.0, HRM-DD SOP
 */

import { BaseAnalyzer, AnalyzerMetadata, ValidationResult } from "./base";
import type { DebugScoringTrace, SlideSequenceInput, SlideSequenceResult } from "../types/dio";
import { buildRulesFromBaseAndDeltas } from "./debug-scoring";

// ============================================================================
// Ideal Patterns (from 25 funded decks analysis)
// ============================================================================

/**
 * Story Arc patterns that correlate with funding success
 */
const IDEAL_PATTERNS = {
  problem_first: {
    name: "Problem-First (Y Combinator)",
    sequence: [
      "problem",
      "solution",
      "market",
      "product",
      "traction",
      "team",
      "business model",
      "competition",
      "financials",
      "ask"
    ],
    weight: 1.0,
    description: "Start with problem, build to ask"
  },
  
  traction_first: {
    name: "Traction-First (Growth Story)",
    sequence: [
      "traction",
      "problem",
      "solution",
      "market",
      "product",
      "team",
      "business model",
      "financials",
      "ask"
    ],
    weight: 0.9,
    description: "Lead with proof, then explain why"
  },
  
  vision_first: {
    name: "Vision-First (Moonshot)",
    sequence: [
      "vision",
      "problem",
      "market",
      "solution",
      "product",
      "team",
      "traction",
      "business model",
      "financials",
      "ask"
    ],
    weight: 0.85,
    description: "Big vision, then validation"
  }
};

/**
 * Slide classification keywords
 */
const SLIDE_KEYWORDS = {
  problem: ["problem", "pain", "challenge", "issue", "opportunity"],
  solution: ["solution", "approach", "how it works", "our solution"],
  market: ["market", "market size", "tam", "sam", "som", "opportunity"],
  product: ["product", "platform", "technology", "demo", "features"],
  traction: ["traction", "growth", "metrics", "results", "validation", "customers"],
  team: ["team", "founders", "about us", "who we are"],
  "business model": ["business model", "revenue", "pricing", "monetization", "go-to-market"],
  competition: ["competition", "competitive", "landscape", "alternatives", "why us"],
  financials: ["financials", "forecast", "projections", "budget", "use of funds"],
  ask: ["ask", "investment", "raise", "funding", "next steps"],
  vision: ["vision", "mission", "why now", "future"],
};

// ============================================================================
// Analyzer Implementation
// ============================================================================

export class SlideSequenceAnalyzer extends BaseAnalyzer<SlideSequenceInput, SlideSequenceResult> {
  readonly metadata: AnalyzerMetadata = {
    name: "slide_sequence_analyzer",
    version: "1.0.0",
    released_at: "2024-12-18",
    changelog: "Initial release - pattern matching against 25 funded decks"
  };

  /**
   * Analyze slide sequence
   * DETERMINISTIC - no LLM, no external calls
   */
  async analyze(input: SlideSequenceInput): Promise<SlideSequenceResult> {
    const executed_at = new Date().toISOString();

    const debugEnabled = Boolean((input as any).debug_scoring);

    const headings = input.headings;
    if (!Array.isArray(headings) || headings.length === 0 || headings.every((h) => !h || h.trim() === "")) {
      const debug_scoring: DebugScoringTrace | undefined = debugEnabled
        ? {
            inputs_used: [],
            rules: [{ rule_id: "excluded", description: "Excluded: missing headings", delta: 0, running_total: 0 }],
            exclusion_reason: "insufficient_data: missing headings",
            input_summary: {
              completeness: { score: 0, notes: ["missing headings"] },
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

        score: null,
        pattern_match: "None",
        sequence_detected: [],
        expected_sequence: [],
        deviations: [],
        evidence_ids: input.evidence_ids || [],
        ...(debugEnabled ? { debug_scoring } : {}),
      };
    }

    try {
      const start = Date.now();

      const slides = Array.isArray((input as any).slides) ? (input as any).slides : undefined;
      const useBodyFallback = this.shouldUseBodyFallback(headings, slides);

      const slideBodies = useBodyFallback
        ? this.extractSlideBodies(headings, slides)
        : undefined;

      // Classify each heading
      const classified_slides = this.classifySlides(headings, slideBodies);

      const headingsCount = headings.filter((h) => typeof h === "string" && h.trim() !== "").length;
      const recognizedSequence = classified_slides
        .filter((s) => s.category !== "unknown")
        .map((s) => s.category);
      const recognized_ratio = headingsCount > 0 ? recognizedSequence.length / headingsCount : 0;

      // Low-signal gate: not enough real slide labels to score reliably.
      if (headingsCount < 6 || recognized_ratio < 0.35 || recognizedSequence.length < 6) {
        const notes = [
          `low_signal: headingsCount=${headingsCount}, recognized_ratio=${recognized_ratio.toFixed(3)}, sequence_len=${recognizedSequence.length}`,
        ];

        const debug_scoring: DebugScoringTrace | undefined = debugEnabled
          ? {
              inputs_used: ["headings[]"],
              rules: [{ rule_id: "excluded", description: "Excluded: low_signal gate", delta: 0, running_total: 0 }],
              exclusion_reason: "insufficient_data: low_signal gate",
              input_summary: {
                completeness: { score: 0.5, notes },
                signals_count: 1,
              },
              signals: [
                { key: "headings_count", value: headingsCount },
                { key: "recognized_ratio", value: Math.round(recognized_ratio * 1000) / 1000 },
                { key: "recognized_sequence_len", value: recognizedSequence.length },
              ],
              penalties: [],
              bonuses: [],
              final: { score: null, formula: "N/A (low_signal gate)" },
            }
          : undefined;

        return {
          analyzer_version: this.metadata.version,
          executed_at,

          status: "insufficient_data",
          coverage: 0,
          confidence: 0.3,

          score: null,
          notes,
          pattern_match: "None",
          sequence_detected: recognizedSequence,
          expected_sequence: [],
          deviations: [],
          evidence_ids: input.evidence_ids || [],
          ...(debugEnabled ? { debug_scoring } : {}),
        };
      }

      // Find best matching pattern
      const pattern_match = this.findBestPattern(classified_slides);

      // Calculate deviations
      const deviations = this.findDeviations(classified_slides, pattern_match);

      // Calculate overall score (0-100)
      const score = this.calculateScore(pattern_match, deviations, classified_slides);

      const debug_scoring: DebugScoringTrace | undefined = debugEnabled
        ? (() => {
            const critical_slides = ["problem", "solution", "market", "team"];
            const hasCritical = critical_slides.filter((c) => classified_slides.some((s) => s.category === c)).length;
            const unknownCount = classified_slides.filter((s) => s.category === "unknown").length;
            const unknownRatio = classified_slides.length > 0 ? unknownCount / classified_slides.length : 1;

            const base = pattern_match.confidence * pattern_match.weight * 80;
            const completeness_bonus = (hasCritical / critical_slides.length) * 10;
            const clarity_bonus = (1 - unknownRatio) * 10;

            let penalty = 0;
            for (const dev of deviations) {
              const sev = (dev as any)?.severity;
              if (sev === "high") penalty += 10;
              else if (sev === "medium") penalty += 5;
              else penalty += 2;
            }

            const raw = base + completeness_bonus + clarity_bonus - penalty;

            const signals = [
              { key: "headings_count", value: headings.length },
              { key: "use_body_fallback", value: useBodyFallback },
              { key: "pattern_confidence", value: pattern_match.confidence },
              { key: "pattern_weight", value: pattern_match.weight },
              { key: "unknown_ratio", value: Math.round(unknownRatio * 1000) / 1000 },
            ];

            const bonuses: Array<{ key: string; points: number; note?: string }> = [
              { key: "completeness_bonus", points: Math.round(completeness_bonus * 10) / 10 },
              { key: "clarity_bonus", points: Math.round(clarity_bonus * 10) / 10 },
            ];

            const penalties: Array<{ key: string; points: number; note?: string }> = penalty > 0
              ? [{ key: "deviation_penalty", points: -Math.round(penalty * 10) / 10, note: `${deviations.length} deviation(s)` }]
              : [];

            const completenessNotes: string[] = [];
            if (headings.length > 0) completenessNotes.push("headings present");
            completenessNotes.push(`${hasCritical}/${critical_slides.length} critical slide types present`);

            const signals_count = signals.length + bonuses.length + penalties.length;

            const rules = buildRulesFromBaseAndDeltas({
              base: 50,
              base_rule_id: "neutral_base",
              base_description: "Neutral baseline (deterministic)",
              bonuses: bonuses.map((b) => ({
                rule_id: `bonus:${b.key}`,
                description: b.note ? `${b.key}: ${b.note}` : b.key,
                points: typeof (b as any).points === "number" ? (b as any).points : 0,
              })),
              penalties: penalties.map((p) => ({
                rule_id: `penalty:${p.key}`,
                description: p.note ? `${p.key}: ${p.note}` : p.key,
                points: typeof (p as any).points === "number" ? (p as any).points : 0,
              })),
              final_score: score,
              clamp_range: { min: 0, max: 100 },
            });

            return {
              inputs_used: [
                "headings[]",
                ...(useBodyFallback ? ["slides[].text (fallback)"] : []),
              ],
              rules,
              exclusion_reason: null,
              input_summary: {
                completeness: {
                  score: 1,
                  notes: completenessNotes,
                },
                signals_count,
              },
              signals,
              penalties,
              bonuses,
              final: {
                score,
                formula: "score = round(clamp(base + completeness_bonus + clarity_bonus - deviation_penalty))",
              },
            };
          })()
        : undefined;

      return {
        analyzer_version: this.metadata.version,
        executed_at,

        status: "ok",
        coverage: 0.8,
        confidence: 0.75,

        score,
        pattern_match: pattern_match.name,
        sequence_detected: classified_slides.map(s => s.category),
        expected_sequence: pattern_match.ideal_sequence,
        deviations,
        evidence_ids: input.evidence_ids || [],
        ...(debugEnabled ? { debug_scoring } : {}),
      };
    } catch {
      const debug_scoring: DebugScoringTrace | undefined = debugEnabled
        ? {
            inputs_used: ["headings[]"],
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

        score: null,
        pattern_match: "None",
        sequence_detected: [],
        expected_sequence: [],
        deviations: [],
        evidence_ids: input.evidence_ids || [],
        ...(debugEnabled ? { debug_scoring } : {}),
      };
    }
  }

  /**
   * Validate input
   */
  validateInput(input: SlideSequenceInput): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!input.headings || !Array.isArray(input.headings)) {
      errors.push("headings must be an array");
    } else {
      if (input.headings.length < 5) {
        warnings.push("Less than 5 slides - may be incomplete deck");
      }
      if (input.headings.length > 20) {
        warnings.push("More than 20 slides - may be too detailed");
      }
      if (input.headings.some((h: string) => !h || h.trim() === "")) {
        errors.push("Some headings are empty");
      }
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
   * Classify each slide by matching keywords
   */
  private classifySlides(headings: string[], slideBodies?: string[]): Array<{
    original: string;
    category: string;
    confidence: number;
    index: number;
  }> {
    return headings.map((heading, index) => {
      const body = Array.isArray(slideBodies) && typeof slideBodies[index] === "string" ? slideBodies[index] : "";
      const normalized = `${heading} ${body}`.toLowerCase().trim();
      
      // Find best matching category
      let best_category = "unknown";
      let best_score = 0;

      for (const [category, keywords] of Object.entries(SLIDE_KEYWORDS)) {
        let score = 0;
        for (const keyword of keywords) {
          if (!keyword) continue;
          if (!normalized.includes(keyword)) continue;

          // Prefer stronger signals: exact/leading occurrences beat generic substrings.
          // This is deterministic and helps avoid tie-bias from category iteration order.
          const leading = normalized.startsWith(keyword);
          const labelLike = normalized.includes(`${keyword}:`);
          score += leading || labelLike ? 2 : 1;
        }
        if (score > best_score) {
          best_score = score;
          best_category = category;
        }
      }

      // Confidence based on keyword matches
      const confidence = best_score > 0 ? Math.min(best_score / 2, 1.0) : 0;

      return {
        original: heading,
        category: best_category,
        confidence,
        index
      };
    });
  }

  private shouldUseBodyFallback(headings: string[], slides?: any[]): boolean {
    if (!Array.isArray(headings) || headings.length === 0) return false;
    if (!Array.isArray(slides) || slides.length === 0) return false;

    // If the headings look low quality, fall back to slide text.
    // Deterministic heuristics:
    // - too many very short headings
    // - high non-alphanumeric ratio
    // - high repetition/boilerplate

    const cleaned = headings.map((h) => (typeof h === "string" ? h.trim() : "")).filter(Boolean);
    if (cleaned.length === 0) return true;

    const shortCount = cleaned.filter((h) => h.replace(/\s+/g, "").length < 4).length;
    const shortRatio = shortCount / cleaned.length;

    const nonAlphaRatios = cleaned.map((h) => {
      const s = h;
      const non = (s.match(/[^a-z0-9\s]/gi) || []).length;
      return s.length > 0 ? non / s.length : 1;
    });
    const avgNonAlpha = nonAlphaRatios.reduce((a, b) => a + b, 0) / nonAlphaRatios.length;

    const normalized = cleaned.map((h) => h.toLowerCase().replace(/\s+/g, " ").trim());
    const freq = new Map<string, number>();
    for (const n of normalized) freq.set(n, (freq.get(n) || 0) + 1);
    const maxFreq = Math.max(...Array.from(freq.values()));
    const repetitionRatio = maxFreq / normalized.length;

    const boilerplateTokens = ["slide", "page", "confidential", "company", "presentation", "deck"];
    const boilerplateCount = normalized.filter((h) => boilerplateTokens.some((t) => h === t || h.startsWith(t + " "))).length;
    const boilerplateRatio = boilerplateCount / normalized.length;

    return shortRatio >= 0.5 || avgNonAlpha >= 0.35 || repetitionRatio >= 0.5 || boilerplateRatio >= 0.4;
  }

  private extractSlideBodies(headings: string[], slides?: any[]): string[] {
    const out: string[] = [];
    for (let i = 0; i < headings.length; i++) {
      const s = Array.isArray(slides) ? slides[i] : undefined;
      const text = typeof s?.text === "string" ? s.text : "";
      out.push(text.slice(0, 300));
    }
    return out;
  }

  /**
   * Find best matching pattern
   */
  private findBestPattern(classified_slides: Array<{ category: string; index: number }>) {
    const slide_sequence = classified_slides
      .filter(s => s.category !== "unknown")
      .map(s => s.category);

    let best_pattern = {
      name: "None",
      confidence: 0,
      weight: 0,
      matched_slides: 0,
      ideal_sequence: [] as string[]
    };

    // Try each pattern
    for (const [key, pattern] of Object.entries(IDEAL_PATTERNS)) {
      const match_score = this.calculatePatternMatch(slide_sequence, pattern.sequence);
      
      if (match_score > best_pattern.confidence) {
        best_pattern = {
          name: pattern.name,
          confidence: match_score,
          weight: pattern.weight,
          matched_slides: this.countMatches(slide_sequence, pattern.sequence),
          ideal_sequence: pattern.sequence
        };
      }
    }

    return best_pattern;
  }

  /**
   * Calculate pattern match score
   * Uses Longest Common Subsequence (LCS) algorithm
   */
  private calculatePatternMatch(actual: string[], ideal: string[]): number {
    if (actual.length === 0 || ideal.length === 0) return 0;

    // LCS dynamic programming
    const m = actual.length;
    const n = ideal.length;
    const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (actual[i - 1] === ideal[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }

    const lcs_length = dp[m][n];
    
    // Score: (matches / ideal_length) * (matches / actual_length)
    // This penalizes both missing slides and extra slides
    const recall = lcs_length / ideal.length;
    const precision = lcs_length / actual.length;
    
    return 2 * (precision * recall) / (precision + recall + 0.0001); // F1 score
  }

  /**
   * Count matching slides
   */
  private countMatches(actual: string[], ideal: string[]): number {
    let count = 0;
    const ideal_set = new Set(ideal);
    for (const slide of actual) {
      if (ideal_set.has(slide)) count++;
    }
    return count;
  }

  /**
   * Find deviations from ideal pattern
   */
  private findDeviations(
    classified_slides: Array<{ category: string; original: string; index: number }>,
    pattern: { ideal_sequence: string[] }
  ): Array<{ position: number; expected: string; actual: string; severity: "critical" | "moderate" | "minor" }> {
    const deviations: Array<{ position: number; expected: string; actual: string; severity: "critical" | "moderate" | "minor" }> = [];
    
    const slide_categories = classified_slides.map(s => s.category);
    const ideal = pattern.ideal_sequence;

    // Check for missing critical slides
    const critical_slides = ["problem", "solution", "market", "team"];
    for (const critical of critical_slides) {
      if (!slide_categories.includes(critical)) {
        deviations.push({
          position: 0,
          expected: critical,
          actual: "missing",
          severity: "critical"
        });
      }
    }

    // Check for duplicate categories
    const category_counts = new Map<string, number>();
    for (const cat of slide_categories) {
      if (cat !== "unknown") {
        category_counts.set(cat, (category_counts.get(cat) || 0) + 1);
      }
    }
    for (const [cat, count] of category_counts) {
      if (count > 1) {
        const firstIndex = slide_categories.indexOf(cat);
        deviations.push({
          position: firstIndex,
          expected: `single ${cat}`,
          actual: `${count} ${cat} slides`,
          severity: "moderate"
        });
      }
    }

    // Check order deviations
    const important_pairs = [
      ["problem", "solution"],
      ["market", "product"],
      ["traction", "team"]
    ];

    for (const [first, second] of important_pairs) {
      const first_idx = slide_categories.indexOf(first);
      const second_idx = slide_categories.indexOf(second);
      
      if (first_idx !== -1 && second_idx !== -1 && first_idx > second_idx) {
        deviations.push({
          position: first_idx,
          expected: `${first} before ${second}`,
          actual: `${second} at ${second_idx}, ${first} at ${first_idx}`,
          severity: "minor"
        });
      }
    }

    // Check for too many unknown slides
    const unknown_count = classified_slides.filter(s => s.category === "unknown").length;
    const unknown_ratio = unknown_count / classified_slides.length;
    if (unknown_ratio > 0.3) {
      deviations.push({
        position: 0,
        expected: "recognizable slide types",
        actual: `${Math.round(unknown_ratio * 100)}% unknown slides`,
        severity: "moderate"
      });
    }

    return deviations;
  }

  /**
   * Calculate overall score (0-100)
   */
  private calculateScore(
    pattern: { confidence: number; weight: number },
    deviations: Array<{ severity: string; position?: number; expected?: string; actual?: string }>,
    classified_slides: Array<{ category: string }>
  ): number {
    // Base score from pattern match (0-80 points)
    let score = pattern.confidence * pattern.weight * 80;

    // Completeness bonus (0-10 points)
    const critical_slides = ["problem", "solution", "market", "team"];
    const has_critical = critical_slides.filter(c => 
      classified_slides.some(s => s.category === c)
    ).length;
    const completeness_bonus = (has_critical / critical_slides.length) * 10;
    score += completeness_bonus;

    // Clarity bonus (0-10 points)
    const unknown_ratio = classified_slides.filter(s => s.category === "unknown").length / classified_slides.length;
    const clarity_bonus = (1 - unknown_ratio) * 10;
    score += clarity_bonus;

    // Deduct points for deviations
    let penalty = 0;
    for (const dev of deviations) {
      // Only penalize "missing at position 0" (critical slides missing) when we have
      // high-confidence signal and enough recognized slide labels.
      if (
        dev.position === 0 &&
        dev.actual === "missing" &&
        (pattern.confidence < 0.6 || classified_slides.filter((s) => s.category !== "unknown").length < 6)
      ) {
        continue;
      }
      if (dev.severity === "high") penalty += 10;
      else if (dev.severity === "medium") penalty += 5;
      else penalty += 2;
    }
    score -= penalty;

    // Clamp to 0-100
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  /**
   * Generate actionable insights
   */
  private generateInsights(
    pattern: { name: string; confidence: number },
    deviations: Array<{ type: string; description: string; severity: string }>,
    classified_slides: Array<{ category: string; original: string }>
  ): string[] {
    const insights: string[] = [];

    // Pattern insight
    if (pattern.confidence > 0.7) {
      insights.push(`Strong match to ${pattern.name} pattern (${Math.round(pattern.confidence * 100)}% confidence)`);
    } else if (pattern.confidence > 0.4) {
      insights.push(`Partial match to ${pattern.name} pattern - consider refining sequence`);
    } else {
      insights.push(`No strong pattern match - deck structure may need reorganization`);
    }

    // Critical deviation insights
    const high_severity = deviations.filter(d => d.severity === "high");
    if (high_severity.length > 0) {
      insights.push(`Critical issues: ${high_severity.map(d => d.description).join("; ")}`);
    }

    // Positive insights
    const has_all_critical = ["problem", "solution", "market", "team"].every(c =>
      classified_slides.some(s => s.category === c)
    );
    if (has_all_critical) {
      insights.push("All critical slides present (problem, solution, market, team)");
    }

    // Deck length insight
    const slide_count = classified_slides.length;
    if (slide_count >= 10 && slide_count <= 15) {
      insights.push("Optimal deck length (10-15 slides)");
    } else if (slide_count < 10) {
      insights.push("Deck may be too short - consider adding detail");
    } else if (slide_count > 15) {
      insights.push("Deck may be too long - consider condensing");
    }

    return insights;
  }
}

// Export singleton instance
export const slideSequenceAnalyzer = new SlideSequenceAnalyzer();
