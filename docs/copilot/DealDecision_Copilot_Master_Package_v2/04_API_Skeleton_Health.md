# Copilot Prompt 04 — API Skeleton + Health (Port 9000)

Goal: Implement `apps/api` Fastify server with:
- CORS enabled
- basic logging
- `GET /api/v1/health` → `{ ok: true }`
- Listen on **port 9000** by default (configurable via env).

Structure:
- `src/index.ts` boot
- `src/routes/health.ts`
- `src/plugins/cors.ts`
- `src/lib/*` helpers

Constraints:
- Must run without DB.
- Use zod for request validation scaffolding.
