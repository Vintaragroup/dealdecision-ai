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
import { registerUnderstandingRoutes } from "./routes/understanding";
import { registerExportPdfRoutes } from "./routes/export-pdf";
import { initializeLLM } from "./lib/llm";
import { getPool } from "./lib/db";
import { applyPendingMigrations, getMigrationStatus } from "./lib/migrations";
import "./lib/queue";
import { getConnection } from "./lib/queue";
import dotenv from "dotenv";
import { createHash } from "crypto";
import { assertProductionStorageContract } from "./lib/storage-contract";

dotenv.config();

function assertRequiredEnvVars() {
  if (process.env.NODE_ENV === "test") return;

  const required = ["DATABASE_URL", "REDIS_URL"] as const;
  const missing = required.filter((key) => {
    const value = process.env[key];
    return value == null || String(value).trim() === "";
  });

  if (missing.length > 0) {
    throw new Error(
      `Missing required env vars: ${missing.join(", ")}. ` +
        `For local development, set host tooling in .env.local and docker compose containers in .env.docker.local.`
    );
  }
}

// Initialize LLM module
initializeLLM();

const app = fastify({
  logger: true,
  bodyLimit: 50 * 1024 * 1024, // 50MB limit for request body
});

const port = Number(process.env.PORT ?? process.env.API_PORT) || 9000;
const host = "0.0.0.0";

async function pingRedisOrThrow(appLogger: Pick<typeof app.log, "info" | "warn" | "error">) {
  if (process.env.NODE_ENV === "test") return;
  const conn = getConnection();

  const timeoutMs = 3000;
  const timeout = new Promise<never>((_, reject) => {
    const t = setTimeout(() => {
      clearTimeout(t);
      reject(new Error(`redis_ping_timeout_${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    const pong = await Promise.race([conn.ping(), timeout]);
    if (pong !== "PONG") {
      throw new Error(`redis_ping_unexpected:${String(pong)}`);
    }
    appLogger.info({ event: "redis_ping_ok" }, "Redis ping OK");
  } catch (err) {
    appLogger.error({ event: "redis_ping_failed", err }, "Redis unavailable; queue operations will fail");
    throw new Error(
      "Redis is unavailable. Check REDIS_URL and ensure Redis is running (for local: pnpm local:up)."
    );
  }
}

async function bootstrap() {
  await registerCors(app);
  await registerClerkAuth(app);
  await registerUploadsStatic(app);
  await pingRedisOrThrow(app.log);
  const pool = getPool();

  // Startup verification: DB fingerprint + basic schema presence check.
  // Do NOT log DATABASE_URL or credentials.
  try {
    const { rows } = await pool.query(
      `SELECT current_database() as db, current_user as db_user, version() as version, inet_server_addr() as host, inet_server_port() as port`
    );
    const row = (rows?.[0] ?? {}) as any;
    const fingerprintSource = JSON.stringify({
      db: row.db ?? null,
      db_user: row.db_user ?? null,
      host: row.host ?? null,
      port: row.port ?? null,
      version: typeof row.version === "string" ? row.version.slice(0, 80) : null,
    });
    const dbFingerprint = createHash("sha256").update(fingerprintSource, "utf8").digest("hex").slice(0, 16);
    app.log.info({
      event: "db_fingerprint",
      service: "api",
      db: row.db ?? null,
      host: row.host ?? null,
      port: row.port ?? null,
      fingerprint: dbFingerprint,
    });
  } catch (err) {
    app.log.warn({ event: "db_fingerprint_failed", service: "api", err }, "Failed to fingerprint DB");
  }

  try {
    const requiredTables = ["deals", "documents", "jobs", "document_files", "document_file_blobs", "visual_assets", "visual_extractions"];
    const missing: string[] = [];
    for (const t of requiredTables) {
      const res = await pool.query<{ oid: string | null }>("SELECT to_regclass($1) as oid", [t]);
      if (res.rows?.[0]?.oid == null) missing.push(t);
    }
    if (missing.length === 0) {
      app.log.info({ event: "schema_check_ok", service: "api", required_tables: requiredTables.length });
    } else {
      app.log.warn({ event: "schema_check_failed", service: "api", missing_tables: missing }, "Database schema missing required tables");
    }
  } catch (err) {
    app.log.warn({ event: "schema_check_failed", service: "api", err }, "Failed checking schema");
  }

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
  await registerUnderstandingRoutes(app, pool);
  await registerExportPdfRoutes(app, pool);
}

async function start() {
  try {
    assertRequiredEnvVars();

    const storage = assertProductionStorageContract(process.env);
    app.log.info(
      {
        event: "storage_backend",
        service: "api",
        driver: storage.storage_driver,
        r2_bucket: storage.r2_bucket,
        r2_endpoint: storage.r2_endpoint,
      },
      "Storage backend"
    );

    await bootstrap();
    await app.listen({ port, host });
    app.log.info(`API listening on http://${host}:${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
