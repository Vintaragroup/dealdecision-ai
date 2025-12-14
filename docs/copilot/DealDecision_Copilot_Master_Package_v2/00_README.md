# DealDecision AI — Copilot Master Prompt Package (v2, includes Docker dev)

This is the **single** Copilot prompt package to use for building DealDecision AI end-to-end:
- `apps/web` (frontend)
- `apps/api` (Fastify API)
- `apps/worker` (BullMQ workers)
- `packages/contracts` (shared types)
- `packages/core` (HRM + report compiler)

## Key local-dev constraint
- The API must be reachable at **http://localhost:9000** (port 9000), to avoid conflicts with other dockerized projects.

## How to use
1. Open the repo in VS Code.
2. Run prompts **in order** (01 → 15). Do not skip unless the step is already complete.
3. Keep changes PR-sized (small, testable).
4. After each step run:
   - `pnpm -r typecheck`
   - `pnpm dev` (or component-specific dev commands)
   - Or Docker: `docker compose -f infra/docker-compose.yml up --build`

## Non-negotiables
- **DIO is the source of truth.** UI renders DIO versions.
- **Evidence IDs only.** No citations unless stored as `evidence_id`.
- **Chat proposes actions; it does not mutate decisions.**
- **All heavy work is async jobs** (ingest, evidence fetch, analyze).

## Inputs (should exist in /docs)
- `01_System_Foundations.md`
- `06_Frontend_Backend_Integration_Requirements.md`
- `07_Backend_Requirements_and_Architecture.md`
- `08_Frontend_Update_Instructions_for_Copilot.md`
- `04_Rules.mdc`

---

## Prompt sequence
01) Bootstrap + repo scan
02) Monorepo scaffold (pnpm)
03) Contracts package (types-first)
04) API skeleton + health (port 9000)
05) DB minimal schema + migrations
06) Jobs + queues wiring (BullMQ)
07) Deals endpoints
08) Jobs status endpoint
09) Web API client + live mode (VITE_API_BASE_URL=http://localhost:9000)
10) Deal workspace DIO metadata + job center
11) Document upload + ingest pipeline
12) Analyze job → DIO version → ReportDTO endpoint
13) Evidence service minimal + Evidence UI components
14) Chat endpoints + UI wiring (actions + citations-by-ID)
15) Dockerized dev environment (web+api+worker+postgres+redis) with API on localhost:9000

Optional:
- `90_SSE_Events_Optional.md`
- `91_Deployment_Scaffold_Optional.md`
