/**
 * DealOrchestrator - Core orchestration engine for DIO analysis
 * 
 * Coordinates all 6 analyzers to produce a complete DealIntelligenceObject
 * 
 * @module orchestration/orchestrator
 */

import { z } from 'zod';
import { randomUUID } from 'crypto';
import type {
  DealIntelligenceObject,
  DIOContext,
  SlideSequenceResult,
  MetricBenchmarkResult,
  VisualDesignResult,
  NarrativeArcResult,
  FinancialHealthResult,
  RiskAssessmentResult,
  AnalyzerResults,
  PlannerState,
  LedgerManifest,
  InvestmentDecision,
  NarrativeSynthesis,
  ExecutionMetadata
} from '../types/dio.js';
import type { BaseAnalyzer } from '../analyzers/base.js';
import type { DIOStorage, DIOStorageResult } from '../services/dio-storage.js';
import { buildDIOContextFromInputData } from './dio-context';

// ==================== Configuration ====================

export const OrchestratorConfigSchema = z.object({
  maxRetries: z.number().min(0).max(5).default(2),
  analyzerTimeout: z.number().min(1000).max(300000).default(60000),
  continueOnError: z.boolean().default(true),
  debug: z.boolean().default(false),
});

export type OrchestratorConfig = z.infer<typeof OrchestratorConfigSchema>;

// ==================== Input/Output ====================

export const OrchestrationInputSchema = z.object({
  deal_id: z.string().uuid(),
  analysis_cycle: z.number().int().min(1).max(3).default(1),
  input_data: z.record(z.unknown()),
  config: OrchestratorConfigSchema.partial().optional(),
});

export type OrchestrationInput = z.infer<typeof OrchestrationInputSchema>;

export const OrchestrationResultSchema = z.object({
  success: z.boolean(),
  dio: z.custom<DealIntelligenceObject>().optional(),
  storage_result: z.custom<DIOStorageResult>().optional(),
  execution: z.object({
    total_duration_ms: z.number(),
    analyzers_run: z.number(),
    analyzers_failed: z.number(),
    retry_count: z.number(),
  }),
  failures: z.array(z.object({
    analyzer: z.string(),
    error: z.string(),
    retry_attempts: z.number(),
  })).optional(),
  error: z.string().optional(),
});

export type OrchestrationResult = z.infer<typeof OrchestrationResultSchema>;

// ==================== Errors ====================

export class OrchestrationError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'OrchestrationError';
  }
}

export class AnalyzerTimeoutError extends Error {
  constructor(analyzerName: string, timeout: number) {
    super(`Analyzer '${analyzerName}' timed out after ${timeout}ms`);
    this.name = 'AnalyzerTimeoutError';
  }
}

// ==================== Analyzer Registry ====================

export interface AnalyzerRegistry {
  slideSequence: BaseAnalyzer<any, SlideSequenceResult>;
  metricBenchmark: BaseAnalyzer<any, MetricBenchmarkResult>;
  visualDesign: BaseAnalyzer<any, VisualDesignResult>;
  narrativeArc: BaseAnalyzer<any, NarrativeArcResult>;
  financialHealth: BaseAnalyzer<any, FinancialHealthResult>;
  riskAssessment: BaseAnalyzer<any, RiskAssessmentResult>;
}

// ==================== Core Orchestrator ====================

export class DealOrchestrator {
  private config: OrchestratorConfig;
  
  constructor(
    private analyzers: AnalyzerRegistry,
    private storage: DIOStorage,
    config?: Partial<OrchestratorConfig>
  ) {
    this.config = OrchestratorConfigSchema.parse(config || {});
  }
  
  /**
   * Run full analysis orchestration
   */
  async analyze(input: OrchestrationInput): Promise<OrchestrationResult> {
    const start_time = Date.now();
    const failures: Array<{ analyzer: string; error: string; retry_attempts: number }> = [];
    let retry_count = 0;

    this.log('Starting orchestration', { deal_id: input.deal_id, cycle: input.analysis_cycle });
    this.log('Input data keys', { keys: Object.keys(input.input_data), documents_count: (input.input_data.documents as any[])?.length || 0 });

    try {
      // Compute lightweight derived context BEFORE analyzers run
      const computed_context = await buildDIOContextFromInputData(input.input_data);
      (input.input_data as any).dio_context = computed_context;
      // Provide a best-effort industry hint for the metric benchmark analyzer
      if (!(input.input_data as any).industry && computed_context.vertical !== 'other') {
        (input.input_data as any).industry = computed_context.vertical;
      }

      // Run all analyzers
      const results = {
        slideSequence: (await this.runAnalyzerWithRetry('slideSequence', input.input_data, failures, retry_count)) as SlideSequenceResult | null,
        metricBenchmark: (await this.runAnalyzerWithRetry('metricBenchmark', input.input_data, failures, retry_count)) as MetricBenchmarkResult | null,
        visualDesign: (await this.runAnalyzerWithRetry('visualDesign', input.input_data, failures, retry_count)) as VisualDesignResult | null,
        narrativeArc: (await this.runAnalyzerWithRetry('narrativeArc', input.input_data, failures, retry_count)) as NarrativeArcResult | null,
        financialHealth: (await this.runAnalyzerWithRetry('financialHealth', input.input_data, failures, retry_count)) as FinancialHealthResult | null,
        riskAssessment: (await this.runAnalyzerWithRetry('riskAssessment', input.input_data, failures, retry_count)) as RiskAssessmentResult | null,
      };

      // Aggregate into DIO
      const dio = this.aggregateDIO(input, results);

      // Store DIO
      const storage_result = await this.storage.saveDIO(dio);

      const total_duration_ms = Date.now() - start_time;
      const analyzers_run = 6;
      const analyzers_failed = failures.length;

      this.log('Orchestration complete', { 
        duration_ms: total_duration_ms,
        analyzers_failed,
        dio_id: dio.dio_id 
      });

      return {
        success: true,
        dio,
        storage_result,
        execution: {
          total_duration_ms,
          analyzers_run,
          analyzers_failed,
          retry_count,
        },
        failures: failures.length > 0 ? failures : undefined,
      };

    } catch (error) {
      const total_duration_ms = Date.now() - start_time;
      this.log('Orchestration failed', { error });

      return {
        success: false,
        execution: {
          total_duration_ms,
          analyzers_run: 0,
          analyzers_failed: 6,
          retry_count,
        },
        failures,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Prepare analyzer-specific input from documents array
   */
  private prepareAnalyzerInput(name: keyof AnalyzerRegistry, input_data: Record<string, unknown>): any {
    const documents = input_data.documents as any[] || [];
    const dio_context = input_data.dio_context as DIOContext | undefined;
    
    if (documents.length === 0) {
      this.log(`No documents available for analyzer: ${name}`);
      return {};
    }

    // Combine all document data
    const allHeadings: string[] = [];
    const allMetrics: Array<{ key: string; value: string; source: string }> = [];
    let combinedText = '';
    let totalPages = 0;
    let totalBytes = 0;
    let totalChars = 0;

    for (const doc of documents) {
      // Extract headings
      if (doc.mainHeadings && Array.isArray(doc.mainHeadings)) {
        allHeadings.push(...doc.mainHeadings);
      }

      // Extract metrics
      if (doc.keyMetrics && Array.isArray(doc.keyMetrics)) {
        allMetrics.push(...doc.keyMetrics);
      }

      // Combine text summaries
      if (doc.textSummary) {
        combinedText += doc.textSummary + '\n\n';
      }

      // Aggregate metadata
      if (doc.totalPages) totalPages += doc.totalPages;
      if (doc.fileSizeBytes) totalBytes += doc.fileSizeBytes;
      if (doc.totalWords) totalChars += doc.totalWords * 5; // Rough estimate
    }

    this.log(`Preparing input for ${name}`, { 
      headings: allHeadings.length, 
      metrics: allMetrics.length,
      textLength: combinedText.length,
      documents: documents.length
    });

    // Prepare analyzer-specific inputs based on their schemas
    switch (name) {
      case 'slideSequence':
        return {
          headings: allHeadings,
        };

      case 'metricBenchmark':
        return {
          text: combinedText || 'No text content available',
          industry: (input_data.industry as string | undefined) || (dio_context?.vertical && dio_context.vertical !== 'other' ? dio_context.vertical : undefined),
        };

      case 'visualDesign':
        return {
          page_count: totalPages > 0 ? totalPages : 1,
          file_size_bytes: totalBytes > 0 ? totalBytes : 1000,
          total_text_chars: totalChars > 0 ? totalChars : combinedText.length,
          headings: allHeadings,
        };

      case 'narrativeArc':
        // Build slides from headings and text
        const slides = allHeadings.map((heading, idx) => ({
          heading,
          text: idx < documents.length && documents[idx].textSummary 
            ? documents[idx].textSummary.substring(0, 500)
            : '',
        }));
        return {
          slides: slides.length > 0 ? slides : [{ heading: 'Document', text: combinedText.substring(0, 500) }],
        };

      case 'financialHealth':
        // Extract financial metrics from keyMetrics
        const financialData: any = {};
        for (const metric of allMetrics) {
          const value = metric.value?.toLowerCase() || '';
          if (value.includes('revenue')) {
            const match = value.match(/\$?([\d,.]+)\s*(m|million|k|thousand)?/i);
            if (match) {
              const num = parseFloat(match[1].replace(/,/g, ''));
              const multiplier = match[2]?.toLowerCase().startsWith('m') ? 1000000 : 
                               match[2]?.toLowerCase().startsWith('k') ? 1000 : 1;
              financialData.revenue = num * multiplier;
            }
          }
          if (value.includes('growth') && value.includes('%')) {
            const match = value.match(/([\d.]+)%/);
            if (match) {
              financialData.growth_rate = parseFloat(match[1]) / 100;
            }
          }
        }
        return financialData;

      case 'riskAssessment':
        return {
          pitch_text: combinedText || 'No content available',
          headings: allHeadings,
          metrics: allMetrics.reduce((acc, m) => {
            const match = m.value?.match(/([\d.]+)/);
            if (match) {
              acc[m.key || 'unknown'] = parseFloat(match[1]);
            }
            return acc;
          }, {} as Record<string, number>),
        };

      default:
        this.log(`Unknown analyzer: ${name}, returning empty input`);
        return {};
    }
  }

  private isInsufficientInput(name: keyof AnalyzerRegistry, analyzer_input: any): boolean {
    switch (name) {
      case 'slideSequence':
        return !Array.isArray(analyzer_input?.headings) || analyzer_input.headings.length === 0;
      case 'metricBenchmark': {
        const text = typeof analyzer_input?.text === 'string' ? analyzer_input.text.trim() : '';
        return text.length === 0 || text === 'No text content available';
      }
      case 'visualDesign': {
        const headingsMissing = !Array.isArray(analyzer_input?.headings) || analyzer_input.headings.length === 0;
        const noText = typeof analyzer_input?.total_text_chars !== 'number' || analyzer_input.total_text_chars <= 0;
        return headingsMissing && noText;
      }
      case 'narrativeArc': {
        const slides = Array.isArray(analyzer_input?.slides) ? analyzer_input.slides : [];
        if (slides.length === 0) return true;
        const hasAnyContent = slides.some((s: any) => typeof s?.text === 'string' && s.text.trim().length > 0);
        return !hasAnyContent;
      }
      case 'financialHealth': {
        const keys = analyzer_input && typeof analyzer_input === 'object' ? Object.keys(analyzer_input) : [];
        return keys.length === 0;
      }
      case 'riskAssessment': {
        const pitch = typeof analyzer_input?.pitch_text === 'string' ? analyzer_input.pitch_text.trim() : '';
        return pitch.length === 0 || pitch === 'No content available';
      }
      default:
        return true;
    }
  }

  /**
   * Run analyzer with retry logic
   */
  private async runAnalyzerWithRetry<T>(
    name: keyof AnalyzerRegistry,
    input_data: Record<string, unknown>,
    failures: Array<{ analyzer: string; error: string; retry_attempts: number }>,
    retry_count: number
  ): Promise<T | null> {
    let attempts = 0;
    const max_retries = this.config.maxRetries;

    while (attempts <= max_retries) {
      try {
        this.log(`Running analyzer: ${name}`, { attempt: attempts + 1 });
        
        const analyzer = this.analyzers[name] as BaseAnalyzer<any, T>;
        const analyzer_input = this.prepareAnalyzerInput(name, input_data);

        // If we don't have enough signal to run this analyzer, return an explicit
        // insufficient_data result without invoking the analyzer.
        if (this.isInsufficientInput(name, analyzer_input)) {
          this.log(`Skipping analyzer due to insufficient input: ${name}`);
          return this.insufficientDataResult(name) as unknown as T;
        }
        
        const promise = analyzer.analyze(analyzer_input);
        const result = await this.withTimeout(promise, this.config.analyzerTimeout, name);
        
        this.log(`Analyzer completed: ${name}`);
        return result;

      } catch (error) {
        attempts++;
        retry_count++;
        
        const error_message = error instanceof Error ? error.message : 'Unknown error';
        this.log(`Analyzer failed: ${name}`, { attempt: attempts, error: error_message });

        if (attempts > max_retries) {
          failures.push({
            analyzer: name,
            error: error_message,
            retry_attempts: attempts - 1,
          });

          if (this.config.continueOnError) {
            this.log(`Continuing despite ${name} failure`);
            return this.extractionFailedResult(name) as unknown as T;
          } else {
            throw new OrchestrationError(`Analyzer ${name} failed after ${attempts} attempts`, error as Error);
          }
        }

        // Exponential backoff
        const delay = Math.min(1000 * Math.pow(2, attempts - 1), 10000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    return null;
  }

  /**
   * Add timeout to promise
   */
  private withTimeout<T>(
    promise: Promise<T>,
    timeout: number,
    analyzerName: string
  ): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new AnalyzerTimeoutError(analyzerName, timeout)), timeout)
      ),
    ]);
  }

  /**
   * Aggregate analyzer results into complete DIO
   */
  private aggregateDIO(
    input: OrchestrationInput,
    results: {
      slideSequence: SlideSequenceResult | null;
      metricBenchmark: MetricBenchmarkResult | null;
      visualDesign: VisualDesignResult | null;
      narrativeArc: NarrativeArcResult | null;
      financialHealth: FinancialHealthResult | null;
      riskAssessment: RiskAssessmentResult | null;
    }
  ): DealIntelligenceObject {
    const now = new Date().toISOString();
    
    // Debug: check what's in input_data
    console.log('[buildDIO] input.input_data keys:', Object.keys(input.input_data));
    console.log('[buildDIO] documents count:', (input.input_data?.documents as any[])?.length || 0);
    
    // Build analyzer results with fallbacks
    const analyzer_results: AnalyzerResults = {
      slide_sequence: results.slideSequence || this.fallbackSlideSequence(),
      metric_benchmark: results.metricBenchmark || this.fallbackMetricBenchmark(),
      visual_design: results.visualDesign || this.fallbackVisualDesign(),
      narrative_arc: results.narrativeArc || this.fallbackNarrativeArc(),
      financial_health: results.financialHealth || this.fallbackFinancialHealth(),
      risk_assessment: results.riskAssessment || this.fallbackRiskAssessment(),
    };
    
    // Build complete DIO
    const dio: DealIntelligenceObject = {
      schema_version: '1.0.0',
      dio_id: randomUUID(),
      deal_id: input.deal_id,
      created_at: now,
      updated_at: now,
      analysis_version: 1,

      dio_context: (input.input_data as any).dio_context || this.fallbackDIOContext(),
      
      inputs: {
        documents: input.input_data?.documents || [],
        evidence: input.input_data?.evidence || [],
        config: {
          analyzer_versions: {
            slide_sequence: '1.0.0',
            metric_benchmark: '1.0.0',
            visual_design: '1.0.0',
            narrative_arc: '1.0.0',
            financial_health: '1.0.0',
            risk_assessment: '1.0.0',
          },
          features: {
            tavily_enabled: false,
            mcp_enabled: false,
            llm_synthesis_enabled: false,
          },
          parameters: {
            max_cycles: 3,
            depth_threshold: 2,
            min_confidence: 0.7,
          },
        },
      },
      
      analyzer_results,
      
      planner_state: this.fallbackPlannerState(input.analysis_cycle),
      fact_table: [],
      ledger_manifest: this.fallbackLedgerManifest(),
      risk_map: [],
      decision: this.fallbackDecision(),
      narrative: this.fallbackNarrative(),
      execution_metadata: this.fallbackExecutionMetadata(),
    };
    
    console.log('[buildDIO] DIO created with inputs.documents length:', dio.inputs.documents.length);
    
    return dio;
  }

  // ==================== Fallback Helpers ====================

  private fallbackSlideSequence(): SlideSequenceResult {
    return {
      analyzer_version: '1.0.0',
      executed_at: new Date().toISOString(),
      status: 'extraction_failed',
      coverage: 0,
      confidence: 0,
      score: null,
      pattern_match: 'unknown',
      sequence_detected: [],
      expected_sequence: [],
      deviations: [],
      evidence_ids: [],
    } as any;
  }

  private fallbackMetricBenchmark(): MetricBenchmarkResult {
    return {
      analyzer_version: '1.0.0',
      executed_at: new Date().toISOString(),
      metrics_analyzed: [],
      status: 'extraction_failed',
      coverage: 0,
      confidence: 0,
      overall_score: null,
      evidence_ids: [],
    } as any;
  }

  private fallbackVisualDesign(): VisualDesignResult {
    return {
      analyzer_version: '1.0.0',
      executed_at: new Date().toISOString(),
      status: 'extraction_failed',
      coverage: 0,
      confidence: 0,
      design_score: null,
      proxy_signals: {
        page_count_appropriate: false,
        image_to_text_ratio_balanced: false,
        consistent_formatting: false,
      },
      strengths: [],
      weaknesses: ['Analysis failed'],
      note: 'Fallback - analysis failed',
      evidence_ids: [],
    } as any;
  }

  private fallbackNarrativeArc(): NarrativeArcResult {
    return {
      analyzer_version: '1.0.0',
      executed_at: new Date().toISOString(),
      archetype: 'unknown',
      archetype_confidence: 0,
      status: 'extraction_failed',
      coverage: 0,
      confidence: 0,
      pacing_score: null,
      emotional_beats: [],
      evidence_ids: [],
    } as any;
  }

  private fallbackFinancialHealth(): FinancialHealthResult {
    return {
      analyzer_version: '1.0.0',
      executed_at: new Date().toISOString(),
      runway_months: null,
      burn_multiple: null,
      status: 'extraction_failed',
      coverage: 0,
      confidence: 0,
      health_score: null,
      metrics: {
        revenue: null,
        expenses: null,
        cash_balance: null,
        burn_rate: null,
        growth_rate: null,
      },
      risks: [],
      evidence_ids: [],
    } as any;
  }

  private insufficientDataResult(name: keyof AnalyzerRegistry): any {
    const now = new Date().toISOString();

    switch (name) {
      case 'slideSequence':
        return {
          analyzer_version: '1.0.0',
          executed_at: now,
          status: 'insufficient_data',
          coverage: 0,
          confidence: 0.3,
          score: null,
          pattern_match: 'unknown',
          sequence_detected: [],
          expected_sequence: [],
          deviations: [],
          evidence_ids: [],
        };
      case 'metricBenchmark':
        return {
          analyzer_version: '1.0.0',
          executed_at: now,
          status: 'insufficient_data',
          coverage: 0,
          confidence: 0.3,
          metrics_analyzed: [],
          overall_score: null,
          evidence_ids: [],
        };
      case 'visualDesign':
        return {
          analyzer_version: '1.0.0',
          executed_at: now,
          status: 'insufficient_data',
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
          note: 'Insufficient data',
          evidence_ids: [],
        };
      case 'narrativeArc':
        return {
          analyzer_version: '1.0.0',
          executed_at: now,
          status: 'insufficient_data',
          coverage: 0,
          confidence: 0.3,
          archetype: 'unknown',
          archetype_confidence: 0,
          pacing_score: null,
          emotional_beats: [],
          evidence_ids: [],
        };
      case 'financialHealth':
        return {
          analyzer_version: '1.0.0',
          executed_at: now,
          status: 'insufficient_data',
          coverage: 0,
          confidence: 0.3,
          runway_months: null,
          burn_multiple: null,
          health_score: null,
          metrics: {
            revenue: null,
            expenses: null,
            cash_balance: null,
            burn_rate: null,
            growth_rate: null,
          },
          risks: [],
          evidence_ids: [],
        };
      case 'riskAssessment':
        return {
          analyzer_version: '1.0.0',
          executed_at: now,
          status: 'insufficient_data',
          coverage: 0,
          confidence: 0.3,
          overall_risk_score: null,
          risks_by_category: {
            market: [],
            team: [],
            financial: [],
            execution: [],
          },
          total_risks: 0,
          critical_count: 0,
          high_count: 0,
          evidence_ids: [],
        };
      default:
        return { status: 'insufficient_data', coverage: 0, confidence: 0.3 };
    }
  }

  private extractionFailedResult(name: keyof AnalyzerRegistry): any {
    const now = new Date().toISOString();
    switch (name) {
      case 'slideSequence':
        return {
          analyzer_version: '1.0.0',
          executed_at: now,
          status: 'extraction_failed',
          score: null,
          pattern_match: 'unknown',
          sequence_detected: [],
          expected_sequence: [],
          deviations: [],
          evidence_ids: [],
        };
      case 'metricBenchmark':
        return {
          analyzer_version: '1.0.0',
          executed_at: now,
          status: 'extraction_failed',
          metrics_analyzed: [],
          overall_score: null,
          evidence_ids: [],
        };
      case 'visualDesign':
        return {
          analyzer_version: '1.0.0',
          executed_at: now,
          status: 'extraction_failed',
          design_score: null,
          proxy_signals: {
            page_count_appropriate: false,
            image_to_text_ratio_balanced: false,
            consistent_formatting: false,
          },
          strengths: [],
          weaknesses: ['Analysis failed'],
          note: 'Extraction failed',
          evidence_ids: [],
        };
      case 'narrativeArc':
        return {
          analyzer_version: '1.0.0',
          executed_at: now,
          status: 'extraction_failed',
          archetype: 'unknown',
          archetype_confidence: 0,
          pacing_score: null,
          emotional_beats: [],
          evidence_ids: [],
        };
      case 'financialHealth':
        return {
          analyzer_version: '1.0.0',
          executed_at: now,
          status: 'extraction_failed',
          runway_months: null,
          burn_multiple: null,
          health_score: null,
          metrics: {
            revenue: null,
            expenses: null,
            cash_balance: null,
            burn_rate: null,
            growth_rate: null,
          },
          risks: [],
          evidence_ids: [],
        };
      case 'riskAssessment':
        return {
          analyzer_version: '1.0.0',
          executed_at: now,
          status: 'extraction_failed',
          overall_risk_score: null,
          risks_by_category: {
            market: [],
            team: [],
            financial: [],
            execution: [],
          },
          total_risks: 0,
          critical_count: 0,
          high_count: 0,
          evidence_ids: [],
        };
      default:
        return { status: 'extraction_failed' };
    }
  }

  private fallbackRiskAssessment(): RiskAssessmentResult {
    return {
      analyzer_version: '1.0.0',
      executed_at: new Date().toISOString(),
      overall_risk_score: 100,
      risks_by_category: {
        market: [],
        team: [],
        financial: [],
        execution: [],
      },
      total_risks: 0,
      critical_count: 0,
      high_count: 0,
      evidence_ids: [],
    };
  }

  private fallbackDIOContext(): DIOContext {
    return {
      primary_doc_type: 'other',
      deal_type: 'other',
      vertical: 'other',
      stage: 'unknown',
      confidence: 0,
    };
  }

  private fallbackPlannerState(cycle: number): PlannerState {
    return {
      cycle,
      goals: [],
      constraints: [],
      hypotheses: [],
      subgoals: [],
      focus: 'initialization',
      stop_reason: null,
    };
  }

  private fallbackLedgerManifest(): LedgerManifest {
    return {
      cycles: 0,
      depth_delta: [],
      subgoals: 0,
      constraints: 0,
      dead_ends: 0,
      paraphrase_invariance: 0,
      calibration: {
        brier: 0,
      },
      total_facts_added: 0,
      total_evidence_cited: 0,
      uncertain_claims: 0,
    };
  }

  private fallbackDecision(): InvestmentDecision {
    return {
      recommendation: 'CONDITIONAL',
      confidence: 0.5,
      tranche_plan: {
        t0_amount: null,
        milestones: [],
      },
      verification_checklist: [],
      key_strengths: [],
      key_weaknesses: [],
      evidence_ids: [],
    };
  }

  private fallbackNarrative(): NarrativeSynthesis {
    const now = new Date().toISOString();
    return {
      llm_version: '1.0.0',
      generated_at: now,
      token_usage: {
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        estimated_cost: 0,
      },
      executive_summary: 'Analysis incomplete',
      coherence_score: null,
    };
  }

  private fallbackExecutionMetadata(): ExecutionMetadata {
    const now = new Date().toISOString();
    return {
      started_at: now,
      completed_at: now,
      duration_ms: 0,
      worker_version: '1.0.0',
      environment: 'development',
      dependencies: {
        mcp_calls: [],
        tavily_searches: [],
        llm_calls: [],
      },
      errors: [],
      warnings: [],
      performance: {
        document_load_ms: 0,
        analyzer_total_ms: 0,
        mcp_total_ms: 0,
        tavily_total_ms: 0,
        llm_total_ms: 0,
      },
    };
  }

  /**
   * Debug logging
   */
  private log(message: string, data?: Record<string, any>): void {
    if (this.config.debug) {
      console.log(`[DealOrchestrator] ${message}`, data || '');
    }
  }
}
