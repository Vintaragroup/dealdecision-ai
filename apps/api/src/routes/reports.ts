/**
 * Report Routes
 * 
 * Endpoints for generating and retrieving deal analysis reports
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import { DIOStorageImpl, compileDIOToReport } from '@dealdecision/core';

interface ReportParams {
  deal_id: string;
}

export async function registerReportRoutes(
  app: FastifyInstance,
  pool: Pool
) {
  
  /**
   * GET /api/v1/deals/:deal_id/report
   * Get compiled report from latest DIO
   * 
   * Returns ReportDTO with structured sections, scores, and evidence
   */
  app.get<{ Params: ReportParams }>(
    "/api/v1/deals/:deal_id/report",
    async (request: FastifyRequest<{ Params: ReportParams }>, reply: FastifyReply) => {
      const startTs = Date.now();
      try {
        const { deal_id } = request.params;
        request.log.info({ msg: "deal.report.start", deal_id, start_ts: new Date(startTs).toISOString() });
        
        // Get latest DIO from storage
        const storage = new DIOStorageImpl(process.env.DATABASE_URL || '');
        const dio = await storage.getLatestDIO(deal_id);
        
        if (!dio) {
          return reply.status(404).send({
            error: `No DIO found for deal ${deal_id}. Run analysis first.`
          });
        }
        
        // Compile DIO into ReportDTO
        const report = compileDIOToReport(dio);
        
        const endTs = Date.now();
        request.log.info({
          msg: "deal.report.done",
          deal_id,
          start_ts: new Date(startTs).toISOString(),
          end_ts: new Date(endTs).toISOString(),
          duration_ms: endTs - startTs,
        });

        return reply.status(200).send(report);
        
      } catch (error) {
        app.log.error(error, 'Failed to generate report');
        return reply.status(500).send({
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  );
  
  /**
   * GET /api/v1/deals/:deal_id/report/:version
   * Get compiled report from specific DIO version
   */
  app.get<{ Params: ReportParams & { version: string } }>(
    "/api/v1/deals/:deal_id/report/:version",
    async (request: FastifyRequest<{ Params: ReportParams & { version: string } }>, reply: FastifyReply) => {
      const startTs = Date.now();
      try {
        const { deal_id, version } = request.params;
        request.log.info({ msg: "deal.report.version.start", deal_id, version, start_ts: new Date(startTs).toISOString() });
        const versionNum = parseInt(version);
        
        if (isNaN(versionNum) || versionNum < 1) {
          return reply.status(400).send({
            error: 'Invalid version number'
          });
        }
        
        // Get specific DIO version
        const storage = new DIOStorageImpl(process.env.DATABASE_URL || '');
        const dio = await storage.getDIOVersion(deal_id, versionNum);
        
        if (!dio) {
          return reply.status(404).send({
            error: `No DIO found for deal ${deal_id} version ${version}`
          });
        }
        
        // Compile DIO into ReportDTO
        const report = compileDIOToReport(dio);
        
        const endTs = Date.now();
        request.log.info({
          msg: "deal.report.version.done",
          deal_id,
          version: versionNum,
          start_ts: new Date(startTs).toISOString(),
          end_ts: new Date(endTs).toISOString(),
          duration_ms: endTs - startTs,
        });

        return reply.status(200).send(report);
        
      } catch (error) {
        app.log.error(error, 'Failed to generate versioned report');
        return reply.status(500).send({
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  );
}
