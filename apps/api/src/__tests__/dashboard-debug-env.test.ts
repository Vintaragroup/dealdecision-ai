process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerDashboardRoutes } from "../routes/dashboard";
import { closeQueues } from "../lib/queue";

test.after(async () => {
  await closeQueues();
});

test("GET /api/dashboard/debug/env returns safe env visibility", async () => {
  const prev = {
    DETERMINISTIC_SCORE_V1_ENABLED: process.env.DETERMINISTIC_SCORE_V1_ENABLED,
    NODE_ENV: process.env.NODE_ENV,
    COMPOSE_PROFILE: process.env.COMPOSE_PROFILE,
    DATABASE_URL: process.env.DATABASE_URL,
  };

  process.env.DETERMINISTIC_SCORE_V1_ENABLED = "true";
  process.env.NODE_ENV = "test";
  process.env.COMPOSE_PROFILE = "dev";
  process.env.DATABASE_URL = "postgresql://user:supersecret@db.example:55433/dealdecision?sslmode=disable";

  const app = Fastify();
  const mockPool = { query: async () => ({ rows: [] }) } as any;

  try {
    await registerDashboardRoutes(app, mockPool);

    const res = await app.inject({ method: "GET", url: "/api/dashboard/debug/env" });
    assert.equal(res.statusCode, 200);

    const body = res.json() as any;

    assert.equal(typeof body, "object");
    assert.equal(body.DETERMINISTIC_SCORE_V1_ENABLED, true);
    assert.equal(body.env_source, "process.env");
    assert.equal(body.NODE_ENV, "test");
    assert.equal(body.COMPOSE_PROFILE, "dev");
    assert.equal(body.database_url_host_port, "db.example:55433");

    // Guardrail: do not leak credentials.
    assert.ok(!JSON.stringify(body).includes("supersecret"));
    assert.ok(!JSON.stringify(body).includes("user:"));
  } finally {
    await app.close();

    process.env.DETERMINISTIC_SCORE_V1_ENABLED = prev.DETERMINISTIC_SCORE_V1_ENABLED;
    process.env.NODE_ENV = prev.NODE_ENV;
    process.env.COMPOSE_PROFILE = prev.COMPOSE_PROFILE;
    process.env.DATABASE_URL = prev.DATABASE_URL;
  }
});

test("GET /api/dashboard/debug/env reports missing when unset", async () => {
  const prev = {
    DETERMINISTIC_SCORE_V1_ENABLED: process.env.DETERMINISTIC_SCORE_V1_ENABLED,
  };

  delete process.env.DETERMINISTIC_SCORE_V1_ENABLED;

  const app = Fastify();
  const mockPool = { query: async () => ({ rows: [] }) } as any;

  try {
    await registerDashboardRoutes(app, mockPool);

    const res = await app.inject({ method: "GET", url: "/api/dashboard/debug/env" });
    assert.equal(res.statusCode, 200);

    const body = res.json() as any;
    assert.equal(body.DETERMINISTIC_SCORE_V1_ENABLED, false);
    assert.equal(body.env_source, "missing");
  } finally {
    await app.close();
    process.env.DETERMINISTIC_SCORE_V1_ENABLED = prev.DETERMINISTIC_SCORE_V1_ENABLED;
  }
});
