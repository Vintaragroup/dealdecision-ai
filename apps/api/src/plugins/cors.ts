import type { FastifyInstance } from "fastify";
import cors from "@fastify/cors";

export async function registerCors(app: FastifyInstance) {
  await app.register(cors, {
    // Temporarily allow all origins. With credentials enabled, we must reflect
    // the incoming Origin instead of sending "*".
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Last-Event-ID", "Cache-Control"],
    exposedHeaders: ["Content-Type"],
    // Ensure preflight is answered by the CORS plugin (prevents OPTIONS 404).
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });
}
