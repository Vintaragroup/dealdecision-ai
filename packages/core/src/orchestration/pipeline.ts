/**
 * Analysis Pipeline - Multi-cycle workflow orchestration
 * 
 * Implements the three-cycle due diligence workflow:
 * - Cycle 1: Broad Scan - Initial assessment and classification
 * - Cycle 2: Deep Dive - Detailed analysis and validation
 * - Cycle 3: Synthesis - Final recommendation and evidence compilation
 * 
 * Features:
 * - Confidence-based stage progression
 * - Evidence collection integration
 * - Gap detection and LLM query generation
 * - Automated progression criteria
 * 
 * @module orchestration/pipeline
 */

import { z } from 'zod';
import type {
  DealIntelligenceObject,
} from '../types/dio.js';
import type { DealOrchestrator, OrchestrationInput, OrchestrationResult } from './orchestrator.js';
import type { EvidenceService, Evidence } from '../services/evidence/service.js';
import type { LLMService } from '../services/llm/service.js';
import type { DIOStorage } from '../services/dio-storage.js';

// ==================== Pipeline Configuration ====================

/**
 * Confidence thresholds for stage progression
 */
export const ConfidenceThresholdsSchema = z.object({
  /** Minimum confidence to progress from Cycle 1 to Cycle 2 */
  cycle1_to_cycle2: z.number().min(0).max(1).default(0.6),
  
  /** Minimum confidence to progress from Cycle 2 to Cycle 3 */
  cycle2_to_cycle3: z.number().min(0).max(1).default(0.75),
  
  /** Minimum confidence for final recommendation */
  final_recommendation: z.number().min(0).max(1).default(0.8),
});

export type ConfidenceThresholds = z.infer<typeof ConfidenceThresholdsSchema>;

/**
 * Pipeline configuration
 */
export const PipelineConfigSchema = z.object({
  /** Max cycles to run (1-3) */
  max_cycles: z.number().int().min(1).max(3).default(3),
  
  /** Confidence thresholds */
  thresholds: ConfidenceThresholdsSchema.default({}),
  
  /** Auto-generate queries for gaps */
  auto_generate_queries: z.boolean().default(true),
  
  /** Collect evidence between cycles */
  collect_evidence: z.boolean().default(true),
  
  /** Max evidence items per cycle */
  max_evidence_per_cycle: z.number().int().min(1).max(100).default(10),
  
  /** Enable debug logging */
  debug: z.boolean().default(false),
});

export type PipelineConfig = z.infer<typeof PipelineConfigSchema>;

// ==================== Pipeline State ====================

/**
 * Pipeline execution state
 */
export const PipelineStateSchema = z.object({
  deal_id: z.string(),
  
  /** Current cycle (1-3) */
  current_cycle: z.number().int().min(1).max(3),
  
  /** All DIOs generated across cycles */
  dios: z.array(z.custom<DealIntelligenceObject>()),
  
  /** Evidence collected */
  evidence: z.array(z.custom<Evidence>()),
  
  /** Generated queries */
  queries: z.array(z.string()),
  
  /** Progression decisions */
  progression: z.array(z.object({
    from_cycle: z.number(),
    to_cycle: z.number(),
    confidence: z.number(),
    decision: z.enum(['PROGRESS', 'STOP', 'RETRY']),
    reason: z.string(),
  })),
  
  /** Final recommendation */
  recommendation: z.object({
    action: z.enum(['INVEST', 'PASS', 'MORE_INFO_NEEDED']),
    confidence: z.number(),
    reasoning: z.string(),
  }).optional(),
});

export type PipelineState = z.infer<typeof PipelineStateSchema>;

// ==================== Pipeline Result ====================

/**
 * Complete pipeline execution result
 */
export const PipelineResultSchema = z.object({
  success: z.boolean(),
  
  /** Final state */
  state: PipelineStateSchema,
  
  /** Final DIO (most recent) */
  final_dio: z.custom<DealIntelligenceObject>().optional(),
  
  /** Execution metrics */
  metrics: z.object({
    total_duration_ms: z.number(),
    cycles_completed: z.number(),
    evidence_collected: z.number(),
    queries_generated: z.number(),
  }),
  
  error: z.string().optional(),
});

export type PipelineResult = z.infer<typeof PipelineResultSchema>;

// ==================== Pipeline Errors ====================

export class PipelineError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'PipelineError';
  }
}

export class InsufficientConfidenceError extends Error {
  constructor(cycle: number, confidence: number, threshold: number) {
    super(`Cycle ${cycle} confidence ${confidence.toFixed(2)} below threshold ${threshold.toFixed(2)}`);
    this.name = 'InsufficientConfidenceError';
  }
}

// ==================== Analysis Pipeline ====================

/**
 * Multi-cycle analysis pipeline orchestrator
 */
export class AnalysisPipeline {
  private config: PipelineConfig;
  
  constructor(
    private orchestrator: DealOrchestrator,
    private evidenceService: EvidenceService,
    private llmService: LLMService,
    private storage: DIOStorage,
    config?: Partial<PipelineConfig>
  ) {
    this.config = PipelineConfigSchema.parse(config || {});
  }
  
  /**
   * Run complete multi-cycle analysis pipeline
   */
  async run(input: Omit<OrchestrationInput, 'analysis_cycle'>): Promise<PipelineResult> {
    const startTime = Date.now();
    
    try {
      // Initialize state
      const state: PipelineState = {
        deal_id: input.deal_id,
        current_cycle: 1,
        dios: [],
        evidence: [],
        queries: [],
        progression: [],
      };
      
      this.log('Starting analysis pipeline', {
        deal_id: input.deal_id,
        max_cycles: this.config.max_cycles,
      });
      
      // Run cycles
      for (let cycle = 1; cycle <= this.config.max_cycles; cycle++) {
        state.current_cycle = cycle;
        
        this.log(`Starting Cycle ${cycle}`, { cycle });
        
        // Run orchestrator for this cycle
        const result = await this.runCycle(input, cycle);
        
        if (!result.success || !result.dio) {
          throw new PipelineError(`Cycle ${cycle} failed: ${result.error}`);
        }
        
        state.dios.push(result.dio);
        
        // Check confidence and decide progression
        const riskScore = result.dio.analyzer_results.risk_assessment.overall_risk_score;
        const confidence = riskScore === null ? 0.3 : Math.max(0, 1 - (riskScore / 100));
        const decision = this.evaluateProgression(cycle, confidence);
        
        state.progression.push(decision);
        
        this.log(`Cycle ${cycle} completed`, {
          confidence,
          decision: decision.decision,
        });
        
        // Stop if we shouldn't progress
        if (decision.decision === 'STOP') {
          this.log('Stopping pipeline - confidence threshold met', { cycle });
          break;
        }
        
        // Collect evidence for next cycle
        if (cycle < this.config.max_cycles && this.config.collect_evidence) {
          const evidence = await this.collectEvidence(result.dio, state);
          state.evidence.push(...evidence);
          
          this.log(`Collected ${evidence.length} evidence items`, { cycle });
        }
        
        // Generate queries for gaps
        if (cycle < this.config.max_cycles && this.config.auto_generate_queries) {
          const queries = await this.generateQueries(result.dio, state);
          state.queries.push(...queries);
          
          this.log(`Generated ${queries.length} queries`, { cycle });
        }
      }
      
      // Generate final recommendation
      const finalDIO = state.dios[state.dios.length - 1];
      state.recommendation = this.generateRecommendation(finalDIO, state);
      
      const duration = Date.now() - startTime;
      
      const finalRisk = finalDIO.analyzer_results.risk_assessment.overall_risk_score;
      const final_confidence = finalRisk === null ? 0.3 : Math.max(0, 1 - (finalRisk / 100));
      
      this.log('Pipeline completed', {
        cycles: state.dios.length,
        final_confidence,
        recommendation: state.recommendation.action,
      });
      
      return {
        success: true,
        state,
        final_dio: finalDIO,
        metrics: {
          total_duration_ms: duration,
          cycles_completed: state.dios.length,
          evidence_collected: state.evidence.length,
          queries_generated: state.queries.length,
        },
      };
      
    } catch (error) {
      const duration = Date.now() - startTime;
      this.log('Pipeline failed', { error });
      
      return {
        success: false,
        state: {
          deal_id: input.deal_id,
          current_cycle: 1,
          dios: [],
          evidence: [],
          queries: [],
          progression: [],
        },
        metrics: {
          total_duration_ms: duration,
          cycles_completed: 0,
          evidence_collected: 0,
          queries_generated: 0,
        },
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  
  /**
   * Run single cycle analysis
   */
  private async runCycle(
    input: Omit<OrchestrationInput, 'analysis_cycle'>,
    cycle: number
  ): Promise<OrchestrationResult> {
    return this.orchestrator.analyze({
      ...input,
      analysis_cycle: cycle,
    });
  }
  
  /**
   * Evaluate whether to progress to next cycle
   */
  private evaluateProgression(
    cycle: number,
    confidence: number
  ): PipelineState['progression'][number] {
    const { thresholds } = this.config;
    
    // Cycle 1 -> Cycle 2
    if (cycle === 1) {
      if (confidence >= thresholds.cycle1_to_cycle2) {
        return {
          from_cycle: 1,
          to_cycle: 2,
          confidence,
          decision: 'PROGRESS',
          reason: `Confidence ${confidence.toFixed(2)} >= threshold ${thresholds.cycle1_to_cycle2}`,
        };
      } else {
        return {
          from_cycle: 1,
          to_cycle: 2,
          confidence,
          decision: 'PROGRESS', // Always do at least 2 cycles
          reason: 'Initial scan complete - proceeding to deep dive',
        };
      }
    }
    
    // Cycle 2 -> Cycle 3
    if (cycle === 2) {
      if (confidence >= thresholds.cycle2_to_cycle3) {
        return {
          from_cycle: 2,
          to_cycle: 3,
          confidence,
          decision: 'PROGRESS',
          reason: `Confidence ${confidence.toFixed(2)} >= threshold ${thresholds.cycle2_to_cycle3}`,
        };
      } else if (confidence >= thresholds.final_recommendation) {
        return {
          from_cycle: 2,
          to_cycle: 3,
          confidence,
          decision: 'STOP',
          reason: `Confidence sufficient for recommendation (${confidence.toFixed(2)})`,
        };
      } else {
        return {
          from_cycle: 2,
          to_cycle: 3,
          confidence,
          decision: 'PROGRESS',
          reason: 'More analysis needed - proceeding to synthesis',
        };
      }
    }
    
    // Cycle 3 (final)
    return {
      from_cycle: 3,
      to_cycle: 3,
      confidence,
      decision: 'STOP',
      reason: 'Final cycle completed',
    };
  }
  
  /**
   * Collect evidence based on DIO gaps
   */
  private async collectEvidence(
    dio: DealIntelligenceObject,
    state: PipelineState
  ): Promise<Evidence[]> {
    const evidence: Evidence[] = [];
    
    try {
      // Identify gaps from flags
      const gaps = this.identifyGaps(dio);
      
      if (gaps.length === 0) {
        return evidence;
      }
      
      // Search for evidence (up to max)
      // TODO: Evidence search not implemented - EvidenceService doesn't have search method
      // const queries = gaps.slice(0, this.config.max_evidence_per_cycle);
      // Would need TavilyConnector integration here
      this.log('Evidence collection skipped - integration pending', { gap_count: gaps.length });

      
    } catch (error) {
      this.log('Evidence collection failed', { error });
    }
    
    return evidence;
  }
  
  /**
   * Generate LLM queries for identified gaps
   */
  private async generateQueries(
    dio: DealIntelligenceObject,
    state: PipelineState
  ): Promise<string[]> {
    const queries: string[] = [];
    
    try {
      // Identify gaps
      const gaps = this.identifyGaps(dio);
      
      if (gaps.length === 0) {
        return queries;
      }
      
      // Convert gaps to queries (simplified - no LLM needed)
      for (const gap of gaps.slice(0, 5)) { // Max 5 queries
        // Direct gap-to-query conversion
        queries.push(gap);
      }
      
    } catch (error) {
      this.log('Query generation failed', { error });
    }
    
    return queries;
  }
  
  /**
   * Identify gaps/questions from DIO flags and missing data
   */
  private identifyGaps(dio: DealIntelligenceObject): string[] {
    const gaps: string[] = [];
    
    // Check for gaps (flags removed from schema)
    // TODO: Add gap detection logic based on analyzer results
    
    // Check for sequence deviations
    if (dio.analyzer_results.slide_sequence.deviations.length > 0) {
      const critical = dio.analyzer_results.slide_sequence.deviations.filter(
        (d: { severity: string }) => d.severity === 'critical'
      );
      if (critical.length > 0) {
        gaps.push(`Critical pitch deck structure issues detected: ${critical.length} deviations`);
      }
    }
    
    // Check financial health gaps
    if (!dio.analyzer_results.financial_health.runway_months) {
      gaps.push('What is the company runway?');
    }
    if (!dio.analyzer_results.financial_health.burn_multiple) {
      gaps.push('What is the monthly burn rate?');
    }
    
    // Check metric gaps
    if (dio.analyzer_results.metric_benchmark.metrics_analyzed.length === 0) {
      gaps.push('What are the key business metrics?');
    }
    
    return gaps;
  }
  
  /**
   * Generate final investment recommendation
   */
  private generateRecommendation(
    dio: DealIntelligenceObject,
    state: PipelineState
  ): NonNullable<PipelineState['recommendation']> {
    // Use risk score as proxy for confidence
    const riskScore = dio.analyzer_results.risk_assessment.overall_risk_score;
    if (riskScore === null) {
      return {
        action: 'MORE_INFO_NEEDED',
        confidence: 0.3,
        reasoning: 'Risk score unavailable - insufficient evidence to finalize recommendation',
      };
    }

    const confidence = Math.max(0, 1 - (riskScore / 100)); // Invert risk to confidence
    
    // Decision logic
    if (confidence >= this.config.thresholds.final_recommendation && riskScore < 50) {
      return {
        action: 'INVEST',
        confidence,
        reasoning: `High confidence (${confidence.toFixed(2)}) and acceptable risk (${riskScore.toFixed(2)})`,
      };
    }
    
    if (confidence < 0.5 || riskScore > 0.8) {
      return {
        action: 'PASS',
        confidence,
        reasoning: `Low confidence (${confidence.toFixed(2)}) or high risk (${riskScore.toFixed(2)})`,
      };
    }
    
    return {
      action: 'MORE_INFO_NEEDED',
      confidence,
      reasoning: `Moderate confidence (${confidence.toFixed(2)}) - need more information`,
    };
  }
  
  /**
   * Debug logging
   */
  private log(message: string, data?: Record<string, any>): void {
    if (this.config.debug) {
      console.log(`[AnalysisPipeline] ${message}`, data || '');
    }
  }
}
