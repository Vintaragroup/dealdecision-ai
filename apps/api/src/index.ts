import fastify from "fastify";
import { registerCors } from "./plugins/cors";
import { registerUploadsStatic } from "./plugins/uploads-static";
import { registerClerkAuth } from "./plugins/clerk-auth";
import multipart from "@fastify/multipart";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { registerHealthRoutes } from "./routes/health";
import { registerDealRoutes } from "./routes/deals";
import { registerJobRoutes } from "./routes/jobs";
import { registerEventRoutes } from "./routes/events";
import { registerDocumentRoutes } from "./routes/documents";
import { registerOrchestrationRoutes } from "./routes/orchestration";
import { registerReportRoutes } from "./routes/reports";
import { registerDashboardRoutes } from "./routes/dashboard";
import { registerChatRoutes } from "./routes/chat";
import { registerEvidenceRoutes } from "./routes/evidence";
import { registerAnalyticsRoutes } from "./routes/analytics";
import { registerAdminRoutes } from "./routes/admin";
import { registerVisualAssetRoutes } from "./routes/visual-assets";
import { registerNodeAiAnalyzeRoutes } from "./routes/node-ai-analyze";
import { initializeLLM } from "./lib/llm";
import { getPool } from "./lib/db";
import { applyPendingMigrations, getMigrationStatus } from "./lib/migrations";
import "./lib/queue";
import dotenv from "dotenv";

dotenv.config();

// Initialize LLM module
initializeLLM();

const app = fastify({
  logger: true,
  bodyLimit: 50 * 1024 * 1024, // 50MB limit for request body
});

const port = Number(process.env.PORT ?? process.env.API_PORT) || 9000;
const host = "0.0.0.0";

async function bootstrap() {
  await registerCors(app);
  await registerClerkAuth(app);
  await registerUploadsStatic(app);
  const pool = getPool();

  // Schema drift guardrail: log migration status on startup.
  // Optionally apply pending migrations when explicitly enabled.
  try {
    const status = await getMigrationStatus(pool);
    app.log.info({
      event: "db.migrations.status",
      applied: status.applied.length,
      pending: status.pending.length,
      latest_applied: status.latestApplied,
      migrations_dir: status.migrationsDir,
    });

    if (process.env.AUTO_MIGRATE === "1" && status.pending.length > 0) {
      app.log.warn({ event: "db.migrations.auto_apply", pending: status.pending.length }, "AUTO_MIGRATE=1 applying pending migrations");
      const after = await applyPendingMigrations(pool);
      app.log.info({
        event: "db.migrations.applied",
        applied: after.applied.length,
        pending: after.pending.length,
        latest_applied: after.latestApplied,
      });
    } else if (status.pending.length > 0) {
      app.log.warn({
        event: "db.migrations.pending",
        pending: status.pending.length,
        latest_applied: status.latestApplied,
        next_pending: status.pending.slice(0, 5),
      }, "Database has pending migrations (run apps/api db:migrate)");
    }
  } catch (err) {
    app.log.error({ event: "db.migrations.status_error", err }, "Failed reading migration status");
  }

  await app.register(swagger, {
    openapi: {
      info: {
        title: "DealDecision API",
        version: "0.1.0",
        description: "Investment analysis and due diligence API"
      },
      servers: [{ url: `http://${host}:${port}` }],
    },
  });
  await app.register(swaggerUi, {
    routePrefix: "/docs",
    uiConfig: {
      docExpansion: "list",
      deepLinking: true,
    },
    staticCSP: true,
  });
  await app.register(multipart, {
    limits: {
      fileSize: 50 * 1024 * 1024, // 50MB limit
    },
  });
  await registerHealthRoutes(app);
  await registerDealRoutes(app);
  await registerJobRoutes(app);
  await registerEventRoutes(app);
  await registerDocumentRoutes(app);
  await registerOrchestrationRoutes(app, pool);
  await registerReportRoutes(app, pool);
  await registerDashboardRoutes(app);
  await registerChatRoutes(app);
  await registerEvidenceRoutes(app);
  await registerAnalyticsRoutes(app);
  await registerAdminRoutes(app);
  await registerVisualAssetRoutes(app);
  await registerNodeAiAnalyzeRoutes(app);
}

async function start() {
  try {
    await bootstrap();
    await app.listen({ port, host });
    app.log.info(`API listening on http://${host}:${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
