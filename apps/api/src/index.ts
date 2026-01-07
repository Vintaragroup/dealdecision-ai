import fastify from "fastify";
import { registerCors } from "./plugins/cors";
import { registerUploadsStatic } from "./plugins/uploads-static";
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
import { initializeLLM } from "./lib/llm";
import { getPool } from "./lib/db";
import "./lib/queue";
import dotenv from "dotenv";

dotenv.config();

// Initialize LLM module
initializeLLM();

const app = fastify({
  logger: true,
  bodyLimit: 50 * 1024 * 1024, // 50MB limit for request body
});

const port = Number(process.env.API_PORT) || 9000;
const host = "0.0.0.0";

async function bootstrap() {
  await registerCors(app);
  await registerUploadsStatic(app);
  const pool = getPool();
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
