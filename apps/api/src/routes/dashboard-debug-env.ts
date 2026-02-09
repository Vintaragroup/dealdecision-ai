import type { FastifyInstance } from "fastify";
import { existsSync } from "node:fs";

const envFlagEnabled = (v: unknown): boolean => {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
};

const isRunningInDocker = (): boolean => {
  try {
    return existsSync("/.dockerenv");
  } catch {
    return false;
  }
};

export const isDockerRuntime = (): boolean => isRunningInDocker();

export type DeterministicEnvSource = "missing" | "env_file" | "process.env";

export function detectDeterministicScoreV1EnvSource(): DeterministicEnvSource {
  const raw = process.env.DETERMINISTIC_SCORE_V1_ENABLED;
  const present = typeof raw === "string" && raw.trim().length > 0;
  if (!present) return "missing";
  return isRunningInDocker() ? "env_file" : "process.env";
}

export function parseDatabaseUrlHostPort(databaseUrl: string | undefined): string | null {
  const raw = typeof databaseUrl === "string" ? databaseUrl.trim() : "";
  if (!raw) return null;

  try {
    const u = new URL(raw);
    const host = u.hostname ? String(u.hostname) : "";
    if (!host) return null;
    const port = u.port ? String(u.port) : "";
    return port ? `${host}:${port}` : host;
  } catch {
    return null;
  }
}

export async function registerDashboardDebugEnvRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/dashboard/debug/env", async (_request, reply) => {
    return reply.send({
      DETERMINISTIC_SCORE_V1_ENABLED: envFlagEnabled(process.env.DETERMINISTIC_SCORE_V1_ENABLED),
      NODE_ENV: process.env.NODE_ENV ?? "",
      COMPOSE_PROFILE: process.env.COMPOSE_PROFILE ?? "",
      database_url_host_port: parseDatabaseUrlHostPort(process.env.DATABASE_URL),
    });
  });
}
