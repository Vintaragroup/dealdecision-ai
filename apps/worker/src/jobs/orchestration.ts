/**
 * Orchestration Job Handlers - Phase 4
 * 
 * Background job handlers for:
 * - Async analysis via DealOrchestrator
 * - Long-running pipeline execution
 * - Progress tracking and status updates
 * 
 * Jobs are queued via BullMQ and processed by worker
 */

import type { Job } from "bullmq";
import {
  DealOrchestrator,
  AnalysisPipeline,
  DIOStorageImpl,
  type OrchestrationInput,
  type OrchestrationResult,
  type PipelineResult,
} from "@dealdecision/core";
import {
  SlideSequenceAnalyzer,
  MetricBenchmarkValidator,
  VisualDesignScorer,
  NarrativeArcDetector,
  FinancialHealthCalculator,
  RiskAssessmentEngine,
} from "@dealdecision/core";
import {
  MockMCPClient,
  MockEvidenceService,
  MockLLMService,
  createDefaultMCPConfig,
} from "@dealdecision/core";
import type { Pool } from "pg";

// ============================================================================
// Job Data Types
// ============================================================================

interface AnalyzeJobData {
  deal_id: string;
  analysis_cycle?: number;
  input_data: Record<string, unknown>;
  config?: {
    maxRetries?: number;
    analyzerTimeout?: number;
    continueOnError?: boolean;
  };
}

interface PipelineJobData {
  deal_id: string;
  input_data: Record<string, unknown>;
  config?: {
    max_cycles?: number;
    thresholds?: {
      cycle1_to_cycle2?: number;
      cycle2_to_cycle3?: number;
      final_recommendation?: number;
    };
    collect_evidence?: boolean;
    auto_generate_queries?: boolean;
  };
}

// ============================================================================
// Service Initialization
// ============================================================================

function createOrchestrator(): DealOrchestrator {
  const storage = new DIOStorageImpl(process.env.DATABASE_URL || '');
  
  const analyzers = {
    slideSequence: new SlideSequenceAnalyzer(),
    metricBenchmark: new MetricBenchmarkValidator(),
    visualDesign: new VisualDesignScorer(),
    narrativeArc: new NarrativeArcDetector(),
    financialHealth: new FinancialHealthCalculator(),
    riskAssessment: new RiskAssessmentEngine(),
  };
  
  return new DealOrchestrator(analyzers, storage, {
    maxRetries: parseInt(process.env.ORCHESTRATOR_MAX_RETRIES || '2'),
    analyzerTimeout: parseInt(process.env.ORCHESTRATOR_TIMEOUT || '60000'),
    continueOnError: process.env.ORCHESTRATOR_CONTINUE_ON_ERROR !== 'false',
    debug: process.env.ORCHESTRATOR_DEBUG === 'true',
  });
}

function createPipeline(orchestrator: DealOrchestrator): AnalysisPipeline {
  const storage = new DIOStorageImpl(process.env.DATABASE_URL || '');
  
  const mcpConfig = createDefaultMCPConfig();
  const mcpClient = new MockMCPClient(mcpConfig);
  const evidenceService = new MockEvidenceService();
  const llmService = new MockLLMService();
  
  return new AnalysisPipeline(
    orchestrator,
    evidenceService,
    llmService,
    storage,
    {
      max_cycles: parseInt(process.env.PIPELINE_MAX_CYCLES || '3'),
      thresholds: {
        cycle1_to_cycle2: parseFloat(process.env.PIPELINE_CYCLE1_THRESHOLD || '0.6'),
        cycle2_to_cycle3: parseFloat(process.env.PIPELINE_CYCLE2_THRESHOLD || '0.75'),
        final_recommendation: parseFloat(process.env.PIPELINE_FINAL_THRESHOLD || '0.8'),
      },
      collect_evidence: process.env.PIPELINE_COLLECT_EVIDENCE !== 'false',
      auto_generate_queries: process.env.PIPELINE_AUTO_QUERIES !== 'false',
      debug: process.env.PIPELINE_DEBUG === 'true',
    }
  );
}

// ============================================================================
// Job Handlers
// ============================================================================

/**
 * Handle single-cycle analysis job
 * 
 * Job type: 'analyze-deal'
 * Queue: 'orchestration'
 * 
 * Example job data:
 * ```
 * {
 *   "deal_id": "deal-001",
 *   "analysis_cycle": 1,
 *   "input_data": { "slides": [...] }
 * }
 * ```
 */
export async function handleAnalyzeJob(job: Job<AnalyzeJobData>): Promise<OrchestrationResult> {
  const { deal_id, analysis_cycle = 1, input_data, config } = job.data;
  
  console.log(`[Job ${job.id}] Starting analysis for deal ${deal_id}, cycle ${analysis_cycle}`);
  
  try {
    // Update progress: 0%
    await job.updateProgress(0);
    
    // Create orchestrator
    const orchestrator = createOrchestrator();
    
    // Update progress: 10%
    await job.updateProgress(10);
    
    // Run analysis
    const result = await orchestrator.analyze({
      deal_id,
      analysis_cycle,
      input_data,
      config,
    });
    
    // Update progress: 90%
    await job.updateProgress(90);
    
    // Log result
    if (result.success) {
      console.log(`[Job ${job.id}] Analysis succeeded`);
      console.log(`  - Version: ${result.storage_result?.version}`);
      console.log(`  - DIO ID: ${result.dio?.dio_id}`);
      console.log(`  - Analyzers run: ${result.execution.analyzers_run}`);
      console.log(`  - Failures: ${result.execution.analyzers_failed}`);
    } else {
      console.error(`[Job ${job.id}] Analysis failed: ${result.error}`);
    }
    
    // Update progress: 100%
    await job.updateProgress(100);
    
    return result;
    
  } catch (error) {
    console.error(`[Job ${job.id}] Error:`, error);
    throw error;
  }
}

/**
 * Handle multi-cycle pipeline job
 * 
 * Job type: 'run-pipeline'
 * Queue: 'orchestration'
 * 
 * Example job data:
 * ```
 * {
 *   "deal_id": "deal-001",
 *   "input_data": { "slides": [...] },
 *   "config": { "max_cycles": 3 }
 * }
 * ```
 */
export async function handlePipelineJob(job: Job<PipelineJobData>): Promise<PipelineResult> {
  const { deal_id, input_data, config } = job.data;
  
  console.log(`[Job ${job.id}] Starting pipeline for deal ${deal_id}`);
  
  try {
    // Update progress: 0%
    await job.updateProgress(0);
    
    // Create orchestrator and pipeline
    const orchestrator = createOrchestrator();
    const pipeline = createPipeline(orchestrator);
    
    // Update progress: 5%
    await job.updateProgress(5);
    
    // Run pipeline with progress tracking
    const result = await pipeline.run({
      deal_id,
      input_data,
    });
    
    // Calculate progress based on cycles completed
    const maxCycles = config?.max_cycles || 3;
    const cyclesCompleted = result.metrics.cycles_completed;
    const progress = Math.min(95, 5 + (cyclesCompleted / maxCycles) * 85);
    await job.updateProgress(progress);
    
    // Log result
    if (result.success) {
      console.log(`[Job ${job.id}] Pipeline succeeded`);
      console.log(`  - Cycles completed: ${result.metrics.cycles_completed}`);
      console.log(`  - Evidence collected: ${result.metrics.evidence_collected}`);
      console.log(`  - Queries generated: ${result.metrics.queries_generated}`);
      console.log(`  - Recommendation: ${result.state.recommendation?.action}`);
      console.log(`  - Final DIO ID: ${result.final_dio?.dio_id}`);
    } else {
      console.error(`[Job ${job.id}] Pipeline failed: ${result.error}`);
    }
    
    // Update progress: 100%
    await job.updateProgress(100);
    
    return result;
    
  } catch (error) {
    console.error(`[Job ${job.id}] Error:`, error);
    throw error;
  }
}

// ============================================================================
// Job Registration (for BullMQ Worker)
// ============================================================================

/**
 * Register job handlers with BullMQ worker
 * 
 * Usage in worker/src/index.ts:
 * ```typescript
 * import { registerOrchestrationJobs } from './jobs/orchestration';
 * 
 * const worker = createWorker('orchestration', async (job) => {
 *   return registerOrchestrationJobs(job);
 * });
 * ```
 */
export async function registerOrchestrationJobs(job: Job): Promise<any> {
  switch (job.name) {
    case 'analyze-deal':
      return handleAnalyzeJob(job as Job<AnalyzeJobData>);
      
    case 'run-pipeline':
      return handlePipelineJob(job as Job<PipelineJobData>);
      
    default:
      throw new Error(`Unknown job type: ${job.name}`);
  }
}

// ============================================================================
// Helper: Enqueue Jobs
// ============================================================================

/**
 * Enqueue analysis job
 * 
 * Usage from API:
 * ```typescript
 * import { enqueueAnalysisJob } from '@worker/jobs/orchestration';
 * 
 * const job = await enqueueAnalysisJob({
 *   deal_id: 'deal-001',
 *   analysis_cycle: 1,
 *   input_data: { slides: [...] }
 * });
 * ```
 */
export async function enqueueAnalysisJob(data: AnalyzeJobData): Promise<Job> {
  const { getQueue } = await import('../lib/queue.js');
  const queue = getQueue('orchestration');
  
  return queue.add('analyze-deal', data, {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: false,
    removeOnFail: false,
  });
}

/**
 * Enqueue pipeline job
 * 
 * Usage from API:
 * ```typescript
 * import { enqueuePipelineJob } from '@worker/jobs/orchestration';
 * 
 * const job = await enqueuePipelineJob({
 *   deal_id: 'deal-001',
 *   input_data: { slides: [...] }
 * });
 * ```
 */
export async function enqueuePipelineJob(data: PipelineJobData): Promise<Job> {
  const { getQueue } = await import('../lib/queue.js');
  const queue = getQueue('orchestration');
  
  return queue.add('run-pipeline', data, {
    attempts: 2, // Pipeline is long-running, fewer retries
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: false,
    removeOnFail: false,
  });
}

// ============================================================================
// Exports
// ============================================================================

export default {
  handleAnalyzeJob,
  handlePipelineJob,
  registerOrchestrationJobs,
  enqueueAnalysisJob,
  enqueuePipelineJob,
};
