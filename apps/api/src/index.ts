import fastify from "fastify";
import { registerCors } from "./plugins/cors";
import multipart from "@fastify/multipart";
import { registerHealthRoutes } from "./routes/health";
import { registerDealRoutes } from "./routes/deals";
import { registerJobRoutes } from "./routes/jobs";
import { registerEventRoutes } from "./routes/events";
import { registerDocumentRoutes } from "./routes/documents";
import { registerChatRoutes } from "./routes/chat";
import { registerEvidenceRoutes } from "./routes/evidence";
import "./lib/queue";

const app = fastify({
  logger: true,
});

const port = Number(process.env.API_PORT) || 9000;
const host = "0.0.0.0";

async function bootstrap() {
  await registerCors(app);
  await app.register(multipart);
  await registerHealthRoutes(app);
  await registerDealRoutes(app);
  await registerJobRoutes(app);
  await registerEventRoutes(app);
  await registerDocumentRoutes(app);
  await registerChatRoutes(app);
  await registerEvidenceRoutes(app);
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
