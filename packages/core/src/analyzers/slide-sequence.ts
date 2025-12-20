/**
 * Slide Sequence Analyzer v1.0.0
 * 
 * Pattern matching against 25 funded pitch decks
 * Deterministic scoring based on heading structure
 * 
 * Based on: DIO Schema v1.0.0, HRM-DD SOP
 */

import { BaseAnalyzer, AnalyzerMetadata, ValidationResult } from "./base";
import type { SlideSequenceInput, SlideSequenceResult } from "../types/dio";

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
    const start = Date.now();

    // Classify each heading
    const classified_slides = this.classifySlides(input.headings);

    // Find best matching pattern
    const pattern_match = this.findBestPattern(classified_slides);

    // Calculate deviations
    const deviations = this.findDeviations(classified_slides, pattern_match);

    // Calculate overall score (0-100)
    const score = this.calculateScore(pattern_match, deviations, classified_slides);

    return {
      analyzer_version: this.metadata.version,
      executed_at: new Date().toISOString(),

      status: "ok",
      coverage: 0.8,
      confidence: 0.75,  

      score,
      pattern_match: pattern_match.name,
      sequence_detected: classified_slides.map(s => s.category),
      expected_sequence: pattern_match.ideal_sequence,
      deviations,
      evidence_ids: input.evidence_ids || [],
    };
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
  private classifySlides(headings: string[]): Array<{
    original: string;
    category: string;
    confidence: number;
    index: number;
  }> {
    return headings.map((heading, index) => {
      const normalized = heading.toLowerCase().trim();
      
      // Find best matching category
      let best_category = "unknown";
      let best_score = 0;

      for (const [category, keywords] of Object.entries(SLIDE_KEYWORDS)) {
        let score = 0;
        for (const keyword of keywords) {
          if (normalized.includes(keyword)) {
            score += 1;
          }
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
    deviations: Array<{ severity: string }>,
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
