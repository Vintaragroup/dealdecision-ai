/**
 * Orchestration Routes - Phase 4
 * 
 * REST endpoints for DIO analysis orchestration:
 * - Single-cycle analysis via DealOrchestrator
 * - Multi-cycle pipeline via AnalysisPipeline
 * - DIO storage and retrieval
 * 
 * Based on: Phase 4 orchestration layer
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { Pool } from "pg";
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

// ============================================================================
// Request/Response Types
// ============================================================================

interface AnalyzeRequest {
  deal_id: string;
  analysis_cycle?: number;
  input_data: Record<string, unknown>;
  config?: {
    maxRetries?: number;
    analyzerTimeout?: number;
    continueOnError?: boolean;
  };
}

interface PipelineRequest {
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

interface DIOQueryRequest {
  deal_id?: string;
  version?: number;
  min_confidence?: number;
  created_after?: string;
  created_before?: string;
  limit: number;
  offset: number;
}

// ============================================================================
// Initialize Services
// ============================================================================

function createOrchestrator(pool: Pool): DealOrchestrator {
  // Initialize storage
  const storage = new DIOStorageImpl(process.env.DATABASE_URL || '');
  
  // Initialize analyzers (using Phase 2 implementations)
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

function createPipeline(pool: Pool, orchestrator: DealOrchestrator): AnalysisPipeline {
  const storage = new DIOStorageImpl(process.env.DATABASE_URL || '');
  
  // Initialize services (using mocks for now - replace with real implementations)
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
// Routes
// ============================================================================

export async function registerOrchestrationRoutes(
  app: FastifyInstance,
  pool: Pool
) {
  
  /**
   * POST /api/v1/orchestration/analyze
   * Run single-cycle analysis via DealOrchestrator
   * 
   * Example:
   * ```
   * POST /api/v1/orchestration/analyze
   * {
   *   "deal_id": "deal-001",
   *   "analysis_cycle": 1,
   *   "input_data": {
   *     "slides": [...],
   *     "financials": {...}
   *   }
   * }
   * ```
   */
  app.post<{ Body: AnalyzeRequest }>(
    "/api/v1/orchestration/analyze",
    async (request: FastifyRequest<{ Body: AnalyzeRequest }>, reply: FastifyReply) => {
      try {
        const { deal_id, analysis_cycle = 1, input_data, config } = request.body;
        
        // Validate
        if (!deal_id || !input_data) {
          return reply.status(400).send({
            error: "Missing required fields: deal_id, input_data"
          });
        }
        
        // Create orchestrator
        const orchestrator = createOrchestrator(pool);
        
        // Run analysis
        const result = await orchestrator.analyze({
          deal_id,
          analysis_cycle,
          input_data,
          config,
        });
        
        // Return result
        if (result.success) {
          return reply.status(200).send({
            success: true,
            dio: result.dio,
            storage: result.storage_result,
            execution: result.execution,
            failures: result.failures,
          });
        } else {
          return reply.status(500).send({
            success: false,
            error: result.error,
            execution: result.execution,
            failures: result.failures,
          });
        }
        
      } catch (error) {
        app.log.error(error, 'Orchestration analysis failed');
        return reply.status(500).send({
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  );
  
  /**
   * POST /api/v1/orchestration/pipeline
   * Run full multi-cycle analysis pipeline
   * 
   * Example:
   * ```
   * POST /api/v1/orchestration/pipeline
   * {
   *   "deal_id": "deal-001",
   *   "input_data": { "slides": [...] },
   *   "config": {
   *     "max_cycles": 3,
   *     "collect_evidence": true
   *   }
   * }
   * ```
   */
  app.post<{ Body: PipelineRequest }>(
    "/api/v1/orchestration/pipeline",
    async (request: FastifyRequest<{ Body: PipelineRequest }>, reply: FastifyReply) => {
      try {
        const { deal_id, input_data, config } = request.body;
        
        // Validate
        if (!deal_id || !input_data) {
          return reply.status(400).send({
            error: "Missing required fields: deal_id, input_data"
          });
        }
        
        // Create orchestrator and pipeline
        const orchestrator = createOrchestrator(pool);
        const pipeline = createPipeline(pool, orchestrator);
        
        // Run pipeline
        const result: PipelineResult = await pipeline.run({
          deal_id,
          input_data,
        });
        
        // Return result
        if (result.success) {
          return reply.status(200).send({
            success: true,
            final_dio: result.final_dio,
            state: result.state,
            metrics: result.metrics,
            recommendation: result.state.recommendation,
          });
        } else {
          return reply.status(500).send({
            success: false,
            error: result.error,
            metrics: result.metrics,
          });
        }
        
      } catch (error) {
        app.log.error(error, 'Pipeline execution failed');
        return reply.status(500).send({
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  );
  
  /**
   * GET /api/v1/orchestration/dios/:deal_id
   * Get all DIOs for a deal
   */
  app.get<{ Params: { deal_id: string } }>(
    "/api/v1/orchestration/dios/:deal_id",
    async (request: FastifyRequest<{ Params: { deal_id: string } }>, reply: FastifyReply) => {
      try {
        const { deal_id } = request.params;
        
        const storage = new DIOStorageImpl(process.env.DATABASE_URL || '');
        
        const dios = await storage.getDIOHistory(deal_id);
        
        return reply.status(200).send({
          deal_id,
          count: dios.length,
          dios,
        });
        
      } catch (error) {
        app.log.error(error, 'Failed to get DIO history');
        return reply.status(500).send({
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  );
  
  /**
   * GET /api/v1/orchestration/dios/:deal_id/latest
   * Get latest DIO for a deal
   */
  app.get<{ Params: { deal_id: string } }>(
    "/api/v1/orchestration/dios/:deal_id/latest",
    async (request: FastifyRequest<{ Params: { deal_id: string } }>, reply: FastifyReply) => {
      try {
        const { deal_id } = request.params;
        
        const storage = new DIOStorageImpl(process.env.DATABASE_URL || '');
        
        const dio = await storage.getLatestDIO(deal_id);
        
        if (!dio) {
          return reply.status(404).send({
            error: `No DIO found for deal ${deal_id}`
          });
        }
        
        return reply.status(200).send(dio);
        
      } catch (error) {
        app.log.error(error, 'Failed to get latest DIO');
        return reply.status(500).send({
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  );
  
  /**
   * GET /api/v1/orchestration/dios/:deal_id/versions/:version
   * Get specific DIO version
   */
  app.get<{ Params: { deal_id: string; version: string } }>(
    "/api/v1/orchestration/dios/:deal_id/versions/:version",
    async (request: FastifyRequest<{ Params: { deal_id: string; version: string } }>, reply: FastifyReply) => {
      try {
        const { deal_id, version } = request.params;
        const versionNum = parseInt(version);
        
        if (isNaN(versionNum) || versionNum < 1) {
          return reply.status(400).send({
            error: 'Invalid version number'
          });
        }
        
        const storage = new DIOStorageImpl(process.env.DATABASE_URL || '');
        
        const dio = await storage.getDIOVersion(deal_id, versionNum);
        
        if (!dio) {
          return reply.status(404).send({
            error: `No DIO found for deal ${deal_id} version ${versionNum}`
          });
        }
        
        return reply.status(200).send(dio);
        
      } catch (error) {
        app.log.error(error, 'Failed to get DIO version');
        return reply.status(500).send({
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  );
  
  /**
   * POST /api/v1/orchestration/dios/query
   * Query DIOs with filters
   */
  app.post<{ Body: DIOQueryRequest }>(
    "/api/v1/orchestration/dios/query",
    async (request: FastifyRequest<{ Body: DIOQueryRequest }>, reply: FastifyReply) => {
      try {
        const filters = request.body;
        
        const storage = new DIOStorageImpl(process.env.DATABASE_URL || '');
        
        const dios = await storage.queryDIOs(filters);
        
        return reply.status(200).send({
          count: dios.length,
          filters,
          dios,
        });
        
      } catch (error) {
        app.log.error(error, 'Failed to query DIOs');
        return reply.status(500).send({
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  );
  
  // TODO: Async endpoints disabled - cross-package imports violate TypeScript rootDir
  // Options to re-enable:
  // 1. Move queue helpers to shared package
  // 2. Create worker REST API and call it from here
  // 3. Duplicate queue logic in API package (not recommended)
  
  /*
   * POST /api/v1/orchestration/analyze/async
   * Enqueue single-cycle analysis for background processing
   * Returns job ID for status tracking
   * 
   * Example:
   * ```
   * POST /api/v1/orchestration/analyze/async
   * {
   *   "deal_id": "deal-001",
   *   "analysis_cycle": 1,
   *   "input_data": { "slides": [...] }
   * }
   * ```
   * 
   * Response:
   * ```
   * {
   *   "job_id": "12345",
   *   "status": "queued",
   *   "message": "Analysis job queued"
   * }
   * ```
   */
  /*
  app.post<{ Body: AnalyzeRequest }>(
    "/api/v1/orchestration/analyze/async",
    async (request: FastifyRequest<{ Body: AnalyzeRequest }>, reply: FastifyReply) => {
      try {
        const { deal_id, analysis_cycle = 1, input_data, config } = request.body;
        
        // Validate
        if (!deal_id || !input_data) {
          return reply.status(400).send({
            error: "Missing required fields: deal_id, input_data"
          });
        }
        
        // Import queue helper
        const { enqueueAnalysisJob } = await import('../../../worker/src/jobs/orchestration.js');
        
        // Enqueue job
        const job = await enqueueAnalysisJob({
          deal_id,
          analysis_cycle,
          input_data,
          config,
        });
        
        return reply.status(202).send({
          job_id: job.id,
          status: "queued",
          message: "Analysis job queued for background processing",
          deal_id,
        });
        
      } catch (error) {
        app.log.error(error, 'Failed to enqueue analysis job');
        return reply.status(500).send({
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  );
  */
  
  /*
   * POST /api/v1/orchestration/pipeline/async
   * Enqueue multi-cycle pipeline for background processing
   * Returns job ID for status tracking
   * 
   * Example:
   * ```
   * POST /api/v1/orchestration/pipeline/async
   * {
   *   "deal_id": "deal-001",
   *   "input_data": { "slides": [...] }
   * }
   * ```
   * 
   * Response:
   * ```
   * {
   *   "job_id": "12346",
   *   "status": "queued",
   *   "message": "Pipeline job queued"
   * }
   * ```
   */
  /*
  app.post<{ Body: PipelineRequest }>(
    "/api/v1/orchestration/pipeline/async",
    async (request: FastifyRequest<{ Body: PipelineRequest }>, reply: FastifyReply) => {
      try {
        const { deal_id, input_data, config } = request.body;
        
        // Validate
        if (!deal_id || !input_data) {
          return reply.status(400).send({
            error: "Missing required fields: deal_id, input_data"
          });
        }
        
        // Import queue helper
        const { enqueuePipelineJob } = await import('../../../worker/src/jobs/orchestration.js');
        
        // Enqueue job
        const job = await enqueuePipelineJob({
          deal_id,
          input_data,
          config,
        });
        
        return reply.status(202).send({
          job_id: job.id,
          status: "queued",
          message: "Pipeline job queued for background processing",
          deal_id,
        });
        
      } catch (error) {
        app.log.error(error, 'Failed to enqueue pipeline job');
        return reply.status(500).send({
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  );
  */
  
  /**
   * DELETE /api/v1/orchestration/dios/:deal_id
   * Delete all DIOs for a deal
   */
  app.delete<{ Params: { deal_id: string } }>(
    "/api/v1/orchestration/dios/:deal_id",
    async (request: FastifyRequest<{ Params: { deal_id: string } }>, reply: FastifyReply) => {
      try {
        const { deal_id } = request.params;
        
        const storage = new DIOStorageImpl(process.env.DATABASE_URL || '');
        
        const count = await storage.deleteDIOs(deal_id);
        
        return reply.status(200).send({
          deleted: count,
          deal_id,
        });
        
      } catch (error) {
        app.log.error(error, 'Failed to delete DIOs');
        return reply.status(500).send({
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  );
}

// ============================================================================
// Exports
// ============================================================================

export default registerOrchestrationRoutes;
