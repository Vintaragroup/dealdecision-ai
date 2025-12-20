/**
 * Narrative Arc Detector v1.0.0
 * 
 * Classify story archetype and analyze pacing
 * Detect emotional beats in pitch narrative
 * 
 * Based on: DIO Schema v1.0.0, HRM-DD SOP
 */

import { BaseAnalyzer, AnalyzerMetadata, ValidationResult } from "./base";
import type { NarrativeArcInput, NarrativeArcResult } from "../types/dio";

// ============================================================================
// Story Archetypes
// ============================================================================

const STORY_ARCHETYPES = {
  hero_journey: {
    name: "Hero's Journey",
    pattern: ["problem", "vision", "solution", "traction", "ask"],
    emotional_arc: ["challenge", "hope", "action", "proof", "opportunity"],
    description: "Classic founder story - problem → vision → execution"
  },
  
  data_driven: {
    name: "Data-Driven",
    pattern: ["traction", "market", "product", "team", "financials"],
    emotional_arc: ["proof", "opportunity", "capability", "credibility", "logic"],
    description: "Lead with numbers - traction → market validation"
  },
  
  vision_first: {
    name: "Vision-First",
    pattern: ["vision", "market", "problem", "solution", "team"],
    emotional_arc: ["inspiration", "opportunity", "urgency", "innovation", "trust"],
    description: "Big idea story - vision → market opportunity"
  },
  
  problem_solution: {
    name: "Problem-Solution",
    pattern: ["problem", "solution", "product", "market", "traction"],
    emotional_arc: ["pain", "relief", "demonstration", "validation", "proof"],
    description: "Classic pitch - problem → solution → validation"
  }
};

// ============================================================================
// Emotional Beat Keywords
// ============================================================================

const EMOTIONAL_KEYWORDS = {
  challenge: ["problem", "pain", "struggle", "challenge", "difficult", "broken"],
  hope: ["vision", "imagine", "future", "opportunity", "potential"],
  urgency: ["now", "critical", "essential", "must", "timing", "window"],
  proof: ["traction", "growth", "customers", "revenue", "validated", "proven"],
  innovation: ["breakthrough", "unique", "first", "revolutionary", "new approach"],
  trust: ["team", "experience", "expertise", "track record", "credentials"],
  logic: ["data", "analysis", "metrics", "numbers", "evidence"],
  opportunity: ["market", "addressable", "growing", "massive", "untapped"],
};

// ============================================================================
// Analyzer Implementation
// ============================================================================

export class NarrativeArcDetector extends BaseAnalyzer<NarrativeArcInput, NarrativeArcResult> {
  readonly metadata: AnalyzerMetadata = {
    name: "narrative_arc_detector",
    version: "1.0.0",
    released_at: "2024-12-18",
    changelog: "Initial release - story archetype classification and pacing analysis"
  };

  /**
   * Analyze narrative arc
   * DETERMINISTIC - pattern matching only
   */
  async analyze(input: NarrativeArcInput): Promise<NarrativeArcResult> {
    const start = Date.now();

    // Extract categories and content from slides
    const slide_categories = input.slides.map(s => this.categorizeSlideBasedOnHeading(s.heading));
    const slide_text_lengths = input.slides.map(s => s.text.length);
    const slide_content = input.slides.map(s => s.text);

    // Detect archetype
    const archetype = this.detectArchetype(slide_categories);

    // Analyze pacing
    const pacing_score = this.analyzePacing(slide_categories, slide_text_lengths);

    // Detect emotional beats
    const emotional_beats = this.detectEmotionalBeats(slide_content);

    // Convert emotional beats to match schema
    const schema_beats = emotional_beats.map(beat => ({
      section: `Slide ${beat.slide_index + 1}`,
      emotion: this.mapBeatToEmotion(beat.beat),
      strength: beat.intensity,
    }));

    return {
      analyzer_version: this.metadata.version,
      executed_at: new Date().toISOString(),
      archetype: archetype.name,
      archetype_confidence: archetype.confidence,
      pacing_score,
      emotional_beats: schema_beats,
      evidence_ids: input.evidence_ids || [],
    };
  }

  /**
   * Validate input
   */
  validateInput(input: NarrativeArcInput): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!input.slides || !Array.isArray(input.slides)) {
      errors.push("slides must be an array");
    } else if (input.slides.length === 0) {
      warnings.push("No slides provided");
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
   * Detect story archetype
   */
  private detectArchetype(slide_categories: string[]): {
    name: string;
    confidence: number;
    match_strength: number;
  } {
    let best_match = {
      name: "Unknown",
      confidence: 0,
      match_strength: 0
    };

    for (const [key, archetype] of Object.entries(STORY_ARCHETYPES)) {
      const match_strength = this.calculatePatternMatch(
        slide_categories,
        archetype.pattern
      );

      if (match_strength > best_match.match_strength) {
        best_match = {
          name: archetype.name,
          confidence: Math.min(match_strength, 1.0),
          match_strength
        };
      }
    }

    return best_match;
  }

  /**
   * Calculate pattern match (LCS-based)
   */
  private calculatePatternMatch(actual: string[], pattern: string[]): number {
    // Longest Common Subsequence
    const m = actual.length;
    const n = pattern.length;
    const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (actual[i - 1] === pattern[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }

    const lcs_length = dp[m][n];
    return lcs_length / pattern.length; // Recall
  }

  /**
   * Analyze pacing (text distribution across slides)
   */
  private analyzePacing(
    slide_categories: string[],
    slide_text_lengths: number[]
  ): number {
    if (!slide_text_lengths || slide_text_lengths.length === 0) {
      return 50; // Neutral score
    }

    // Good pacing: relatively even distribution with crescendo at key moments
    const avg_length = slide_text_lengths.reduce((a, b) => a + b, 0) / slide_text_lengths.length;
    
    // Calculate variance
    const variance = slide_text_lengths.reduce((sum, len) => {
      return sum + Math.pow(len - avg_length, 2);
    }, 0) / slide_text_lengths.length;
    
    const std_dev = Math.sqrt(variance);
    const coefficient_of_variation = std_dev / avg_length;

    // Good pacing: CV between 0.3 and 0.6
    let pacing_score = 100;
    if (coefficient_of_variation < 0.3) {
      pacing_score = 70; // Too uniform - may be boring
    } else if (coefficient_of_variation > 0.6) {
      pacing_score = 60; // Too variable - may be chaotic
    }

    // Bonus for crescendo at "ask" slide
    const ask_index = slide_categories.indexOf("ask");
    if (ask_index !== -1 && ask_index > 0) {
      const ask_length = slide_text_lengths[ask_index];
      const prev_avg = slide_text_lengths.slice(0, ask_index).reduce((a, b) => a + b, 0) / ask_index;
      
      if (ask_length < prev_avg) {
        pacing_score += 10; // Concise ask is good
      }
    }

    return Math.min(100, Math.round(pacing_score));
  }

  /**
   * Detect emotional beats
   */
  private detectEmotionalBeats(slide_content: string[]): Array<{
    slide_index: number;
    beat: string;
    intensity: number;
  }> {
    const beats: Array<{ slide_index: number; beat: string; intensity: number }> = [];

    for (let i = 0; i < slide_content.length; i++) {
      const content = slide_content[i].toLowerCase();
      
      for (const [beat, keywords] of Object.entries(EMOTIONAL_KEYWORDS)) {
        let intensity = 0;
        for (const keyword of keywords) {
          if (content.includes(keyword)) {
            intensity += 1;
          }
        }
        
        if (intensity > 0) {
          beats.push({
            slide_index: i,
            beat,
            intensity: Math.min(intensity / keywords.length, 1.0)
          });
        }
      }
    }

    return beats;
  }

  /**
   * Generate insights
   */
  private generateInsights(
    archetype: { name: string; confidence: number },
    pacing_score: number,
    emotional_beats: Array<{ beat: string }>
  ): string[] {
    const insights: string[] = [];

    // Archetype insight
    if (archetype.confidence > 0.7) {
      insights.push(`Strong ${archetype.name} narrative structure`);
    } else if (archetype.confidence > 0.4) {
      insights.push(`Partial ${archetype.name} structure - consider strengthening`);
    } else {
      insights.push("Narrative structure unclear - consider reorganizing for clarity");
    }

    // Pacing insight
    if (pacing_score >= 80) {
      insights.push("Excellent pacing - good balance of detail across slides");
    } else if (pacing_score >= 60) {
      insights.push("Acceptable pacing - some slides may need balancing");
    } else {
      insights.push("Pacing issues - text distribution may be uneven");
    }

    // Emotional beats insight
    const unique_beats = new Set(emotional_beats.map(b => b.beat));
    if (unique_beats.size >= 5) {
      insights.push(`Rich emotional arc with ${unique_beats.size} distinct beats`);
    } else if (unique_beats.size >= 3) {
      insights.push(`Moderate emotional variety (${unique_beats.size} beats detected)`);
    } else {
      insights.push("Limited emotional range - consider adding more compelling elements");
    }

    return insights;
  }

  /**
   * Map beat type to emotion enum
   */
  private mapBeatToEmotion(beat: string): "urgency" | "hope" | "credibility" | "excitement" {
    // Map internal beat types to schema emotion types
    if (beat === "challenge" || beat === "pain") return "urgency";
    if (beat === "hope" || beat === "opportunity") return "hope";
    if (beat === "trust" || beat === "logic") return "credibility";
    if (beat === "proof" || beat === "innovation") return "excitement";
    
    // Default
    return "hope";
  }

  /**
   * Categorize slide based on heading
   */
  private categorizeSlideBasedOnHeading(heading: string): string {
    const lower = heading.toLowerCase();
    
    if (lower.includes("problem") || lower.includes("pain") || lower.includes("challenge")) {
      return "problem";
    }
    if (lower.includes("solution") || lower.includes("approach")) {
      return "solution";
    }
    if (lower.includes("product") || lower.includes("demo") || lower.includes("how it works")) {
      return "product";
    }
    if (lower.includes("market") || lower.includes("opportunity") || lower.includes("tam")) {
      return "market";
    }
    if (lower.includes("traction") || lower.includes("growth") || lower.includes("metrics")) {
      return "traction";
    }
    if (lower.includes("team") || lower.includes("about us")) {
      return "team";
    }
    if (lower.includes("vision") || lower.includes("mission") || lower.includes("future")) {
      return "vision";
    }
    if (lower.includes("financials") || lower.includes("revenue") || lower.includes("projections")) {
      return "financials";
    }
    if (lower.includes("ask") || lower.includes("investment") || lower.includes("use of funds")) {
      return "ask";
    }
    
    return "other";
  }
}

// Export singleton instance
export const narrativeArcDetector = new NarrativeArcDetector();
