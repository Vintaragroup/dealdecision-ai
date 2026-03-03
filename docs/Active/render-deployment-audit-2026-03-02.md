# Render Deployment Audit
**Date:** 2026-03-02  
**Scope:** API · Worker · Vision Worker · Web · Postgres Migrations  
**Source:** Verified against `render.yaml`, Dockerfiles, `apps/*/src`, `services/vision_worker/app`, `infra/migrations`

---

## 1. Executive Summary

The repository has a working `render.yaml` blueprint that launches four Docker services (web, API, worker, vision_worker). However, **significant drift exists between the dev environment (`docker-compose.dev.yml`) and `render.yaml`**:

- **Worker is missing ~12 env vars** that actively control pipeline behaviour (PDF mode, fundability gates, visual evidence, DPI, etc.).
- **API is missing ~7 env vars** including two that are required for Clerk JWT verification to function.
- **`OPENAI_API_KEY` is absent from the worker** in `render.yaml` — LLM analysis will silently skip every deal.
- **`VISUAL_PAGE_IMAGE_DPI` defaults to `200`** in code (not `300`); not set in `render.yaml`.
- **`PGSSLMODE=require`** is needed for the Render managed Postgres TLS requirement but is absent from all services.
- **No `branch:` field in `render.yaml`** — auto-deploy fires on the repository default branch, not a named `production` branch.
- **Migrations run automatically at API startup** via `start.sh` → `pnpm --filter api db:migrate`. The latest migration file is `2026-03-02-003-add-deal-facts-v1.sql` (today). The worker has no migration runner — it depends on the API having run migrations first.
- Python `requirements.txt` uses `>=` version ranges (not pinned); dependency drift risk.

---

## 2. Render Services Inventory

| Service | Render Name | Type | Dockerfile | Build Cmd | Start Cmd | Health Check | Plan |
|---|---|---|---|---|---|---|---|
| Web (frontend) | `dealdecision-web` | web | `apps/web/Dockerfile` | Docker multi-stage build (inside Dockerfile) | Dockerfile CMD: `pnpm preview` | none declared | starter |
| API | `dealdecision-api` | web | `apps/api/Dockerfile` | Docker multi-stage build | `./start.sh` (runs migrate then `node dist/src/index.js`) | `GET /health` | starter |
| Worker | `dealdecision-worker` | worker | `apps/worker/Dockerfile` | Docker multi-stage build | `node dist/src/index.js` | none | starter |
| Vision Worker | `dealdecision-vision-v2` | web | `services/vision_worker/Dockerfile` | Docker build (single stage) | `uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}` | `GET /health` | starter |

### Additional notes

- `dockerContext: .` for web, API, worker (monorepo root). Vision worker uses `dockerContext: services/vision_worker`.
- API `start.sh` runs migrations then starts the server — **migrations are automatic on deploy**.
- Worker exposes no HTTP port; it is a pure background BullMQ consumer.
- Vision worker listens on `PORT` env var (default `8000`). Render injects `PORT` automatically for web services — not set explicitly in `render.yaml` for vision worker.
- **No `branch:` field** in any service in `render.yaml` — Render will deploy from the default repository branch.

---

## 3. Required Render Environment Variables

### 3-A  API Service (`dealdecision-api`)

#### ✅ Already in render.yaml
| Var | Value in render.yaml |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `9000` |
| `DATABASE_URL` | sync: false |
| `REDIS_URL` | sync: false |
| `CLERK_SECRET_KEY` | sync: false |
| `CLERK_PUBLISHABLE_KEY` | sync: false |
| `OPENAI_API_KEY` | sync: false |
| `R2_ACCOUNT_ID` | sync: false |
| `R2_ACCESS_KEY_ID` | sync: false |
| `R2_SECRET_ACCESS_KEY` | sync: false |
| `R2_BUCKET` | sync: false |
| `R2_PUBLIC_BASE_URL` | sync: false |
| `R2_S3_ENDPOINT` | sync: false |

#### ❌ MISSING from render.yaml — REQUIRED / HIGH RISK

| Var | Risk Level | Why | Safe Value |
|---|---|---|---|
| `CLERK_JWKS_URL` | **CRITICAL** | Auth plugin reads this first. Without it (and without `CLERK_JWT_ISSUER`), every request returns HTTP 503. | `https://<your-clerk-frontend-api>/.well-known/jwks.json` |
| `PGSSLMODE` | **HIGH** | Render Postgres requires TLS. Code checks `PGSSLMODE === "require"` to enable SSL. Without it, connection may fail or send cleartext. | `require` |
| `ADMIN_TOKEN` | **HIGH** | Admin routes (`/api/admin/*`, some deal routes) authenticate via `ADMIN_TOKEN`. Not set = no admin access in prod. | random 32-char hex |
| `DETERMINISTIC_SCORE_V1_ENABLED` | **HIGH** | Controls whether the deterministic scoring path runs. In dev it's `"1"`. In prod it defaults to disabled (falsy). Scoring reports will differ from dev. | `1` |
| `VISUAL_PAGE_IMAGE_MAX_PAGES` | MEDIUM | Defaults to `10` in code. Sets the chunk size for page rendering enqueues. Safe default but should be explicit. | `10` |
| `ENABLE_INGEST_RECONCILE` | MEDIUM | In production, reconcile is disabled unless `ENABLE_INGEST_RECONCILE=true`. Stalled ingests won't auto-recover. | `true` |
| `AI_ANALYZE_TOKEN` | MEDIUM | Required to call node AI analyze endpoints. Without it, those routes reject all requests. | random 32-char hex |
| `UPLOAD_DIR` | LOW | Defaults to `/app/uploads` in code. Matches worker volume mount. Explicit is safer. | `/app/uploads` |

#### ⚠️ RECOMMENDED (model overrides)

| Var | Default | Recommendation |
|---|---|---|
| `OPENAI_MODEL_REPORT_NARRATE` | `gpt-4o-mini` | Set to `gpt-4o` if quality matters |
| `OPENAI_MODEL_REPORT_OVERVIEW` | falls back to `OPENAI_MODEL_REPORT_NARRATE` | set explicitly |
| `OPENAI_MODEL_DEAL_TERMS` | `gpt-4o-mini` | |
| `OPENAI_MODEL_FINANCIAL_ANALYSIS` | `gpt-4o-mini` | |
| `OPENAI_MODEL_RISK_VERIFICATION` | `gpt-4o-mini` | |
| `OPENAI_MODEL_VISUAL_ANALYZE` | `gpt-4o-mini` | |

---

### 3-B  Worker Service (`dealdecision-worker`)

#### ✅ Already in render.yaml
| Var | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | sync: false |
| `REDIS_URL` | sync: false |
| `ENABLE_VISUAL_EXTRACTION` | `"1"` |
| `VISUAL_PAGE_IMAGE_PERSIST` | `"1"` |
| `WORKER_CONCURRENCY` | `"1"` |
| `VISION_BASE_URL` | `https://dealdecision-vision-v2.onrender.com` |
| `R2_ACCOUNT_ID` | sync: false |
| `R2_ACCESS_KEY_ID` | sync: false |
| `R2_SECRET_ACCESS_KEY` | sync: false |
| `R2_BUCKET` | sync: false |
| `R2_PUBLIC_BASE_URL` | sync: false |
| `R2_S3_ENDPOINT` | sync: false |

#### ❌ MISSING from render.yaml — REQUIRED / HIGH RISK

| Var | Risk Level | Why | Safe Prod Value |
|---|---|---|---|
| `OPENAI_API_KEY` | **CRITICAL** | Worker calls OpenAI for LLM analysis (phase-B, deal summary, overview v2). Without it, every LLM step skips silently and the deal analysis stubs out. | your OpenAI key |
| `PGSSLMODE` | **HIGH** | Same as API — Render Postgres TLS. | `require` |
| `PDF_EXTRACT_MODE` | **HIGH** | Dev uses `v2_shadow`. Prod defaults to `v1` (legacy path). Dev and prod will produce different analysis content. | `v2_shadow` (safe progressive mode) |
| `PDF_SLIDE_UNDERSTANDING_MODE` | **HIGH** | Dev = `shadow`. Prod defaults to `off`. Slide understanding is silently skipped in prod. | `shadow` |
| `PDF_PAGE_UNDERSTANDING_MODE` | **HIGH** | Dev = `shadow`. Prod defaults to `off`. Per-page understanding is skipped. | `shadow` |
| `DDAI_ENABLE_PHASEB_VISUAL_EVIDENCE` | **HIGH** | Phase B visual evidence entirely disabled unless set to `"1"`. Present in dev, absent in prod `render.yaml`. | `1` |
| `FUNDABILITY_SHADOW_MODE` | **HIGH** | Dev = `1`. Without it, fundability uses legacy path only. | `1` |
| `DETERMINISTIC_SCORE_V1_ENABLED` | **HIGH** | Scoring behaviour differs. Same issue as API. | `1` |
| `VISUAL_PAGE_IMAGE_DPI` | **HIGH** | Code default is `200`. Dev does not override it either. Should be `300` per audit recommendations. | `300` |
| `FUNDABILITY_SOFT_CAPS` | MEDIUM | Dev = `1`. Caps fundability score when enabled. Prod will produce uncapped scores. | `1` |
| `FUNDABILITY_HARD_GATES` | MEDIUM | Dev = `0`. Controls hard pass/fail gate. Safe to leave `0` in prod; must be explicit. | `0` |
| `VISUAL_PAGE_IMAGE_MAX_PAGES` | MEDIUM | Defaults to `10` in code. Limits how many pages are rendered per doc. | `10` |
| `EXTRACT_VISUALS_CONCURRENCY` | LOW | Defaults to `1` in production (code explicitly). Safe to leave unset but explicit is better. | `1` |

#### ⚠️ RECOMMENDED

| Var | Default | Recommendation |
|---|---|---|
| `PDF_V2_OCR_MODE` | `off` | Leave `off` unless vision worker OCR is ready |
| `PDF_V2_TEXT_REGION_ASSETS_MODE` | `off` | Leave `off` unless pipeline is validated |
| `VISUAL_PAGE_IMAGE_FORMAT` | `png` | Leave default |
| `VISUAL_PAGE_IMAGE_MAX_PIXELS` | `6500000` | Leave default |
| `ENABLE_NONPDF_RENDER_PAGES` | `off` in prod (code default) | Explicit: `0` |
| `ENABLE_PY_EXCEL_EXTRACTION` | unset | Set `1` if Excel extraction via vision worker is desired |
| `ENABLE_EXCEL_VISION_EXTRACTION` | unset | Set `1` if Excel vision pipeline is enabled |
| `JOB_HEARTBEAT_INTERVAL_MS` | unset (uses BullMQ default) | Leave unset |
| `UPLOAD_DIR` | `/app/uploads` in code | `/app/uploads` |

---

### 3-C  Vision Worker Service (`dealdecision-vision-v2`)

#### ✅ Already in render.yaml
| Var | Value |
|---|---|
| `LOG_LEVEL` | `INFO` |

#### ❌ MISSING from render.yaml

| Var | Risk Level | Why | Safe Value |
|---|---|---|---|
| `PORT` | LOW | Render injects `PORT` automatically for web services. Vision worker CMD reads `${PORT:-8000}`. Render will inject it, but not explicit in yaml. Confirm Render injects it correctly. | *(Render injects automatically)* |
| `ENABLE_VISION_UNDERSTANDING` | MEDIUM | Defaults to `0` (disabled). If you want CLIP-based visual understanding, set to `1` (requires `requirements-vision.txt` install at build time via build arg — not set in render.yaml). | `0` (keep disabled unless confirmed) |
| `VISION_OCR_ENABLED` | MEDIUM | Controls whether OCR runs on image regions. Defaults to true-ish in code (parsed as none = enable). Make explicit. | `1` |
| `TABLE_TIME_BUDGET_S` | LOW | Defaults `4.0`. Fine. | `4.0` |
| `CHART_TIME_BUDGET_S` | LOW | Defaults `4.0`. Fine. | `4.0` |
| `VISION_DEBUG_LOGS` | LOW | Off by default. | `0` |

**Note:** `ENABLE_VISION_UNDERSTANDING=1` also requires the Docker image to have been built with `--build-arg ENABLE_VISION_UNDERSTANDING=1` to install `requirements-vision.txt` (open_clip + torch). The `render.yaml` has no `dockerBuildArgs` for this, so it cannot be enabled at runtime only.

---

### 3-D  Web Service (`dealdecision-web`)

| Var | Status | Notes |
|---|---|---|
| `VITE_API_BASE_URL` | In render.yaml (sync: false) | **Must also be set as Docker Build Argument** — baked into bundle at build time |
| `VITE_CLERK_PUBLISHABLE_KEY` | In render.yaml (sync: false) | **Must also be set as Docker Build Argument** |
| `VITE_BACKEND_MODE` | `live` (hardcoded in render.yaml) | Correct |
| `NODE_ENV` | `production` | Correct |

**⚠️ Critical Web Gotcha:** `VITE_*` vars are baked at Docker build time via `ARG`/`ENV` in the Dockerfile. Setting them only as runtime env vars in Render UI is **not sufficient**. They must **also** be added under **Service → Settings → Docker Build Arguments** in the Render dashboard, or the bundle will use the empty/localhost defaults.

---

## 4. Required Build / Start Commands

`render.yaml` uses `runtime: docker` for all services. There are **no separate `buildCommand` or `startCommand` fields** — everything is driven by the Dockerfiles and their `CMD` instructions.

| Service | Build Command | Start Command |
|---|---|---|
| `dealdecision-web` | Docker multi-stage (`pnpm install → pnpm run build → pnpm preview`) | `pnpm preview` (Dockerfile CMD) |
| `dealdecision-api` | Docker multi-stage (`pnpm install → tsc → etc.`) | `./start.sh` (runs `pnpm --filter api db:migrate` then `node dist/src/index.js`) |
| `dealdecision-worker` | Docker multi-stage (same pnpm build) | `node dist/src/index.js` (Dockerfile CMD) |
| `dealdecision-vision-v2` | `pip install -r requirements.txt` (inside Dockerfile) | `uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}` |

**No commands assume dev-only scripts.** All commands are production-appropriate.

**Branch configuration:** render.yaml has **no `branch:` field**. Render defaults to the repository's default branch. If you want deploys to trigger from a `production` branch, add `branch: production` to each service block in `render.yaml`.

---

## 5. Required Render Add-ons / Infrastructure

| Add-on | Type | How Used | Status |
|---|---|---|---|
| Postgres | Managed (Render Database) | `DATABASE_URL` env var consumed by API (`pg` pool), Worker (`pg` pool), core orchestration library | **Required — must be provisioned and `DATABASE_URL` set in each service** |
| Redis | Managed (Render Redis) | `REDIS_URL` env var consumed by API (BullMQ producer) and Worker (BullMQ consumer, `ioredis`) | **Required — must be provisioned and `REDIS_URL` set in API and Worker** |
| Cloudflare R2 | External (Cloudflare) | `R2_*` vars for S3-compatible storage of uploaded documents and rendered pages | **Required — all 6 R2 vars must be set** |
| OpenAI API | External | `OPENAI_API_KEY` in API and Worker | **Required for LLM analysis** |
| Clerk | External (auth) | `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `CLERK_JWKS_URL` in API | **Required — CLERK_JWKS_URL must be added** |

**Postgres extensions required:**
- No `CREATE EXTENSION` calls found in migration files from code search. Extensions beyond the Render Postgres defaults are not detectable as required from this repository.
- Render Postgres includes `uuid-ossp` and `pgcrypto` by default on supported plans.

**Redis version:** docker-compose uses `redis:7-alpine` — Render managed Redis 7 is compatible.

---

## 6. Database Migration Status + Actions Required

### Migration tooling

**Not Prisma / Not Drizzle / Not Knex.** This project uses a **custom SQL migration runner** implemented in:
- [apps/api/scripts/migrate.ts](apps/api/scripts/migrate.ts) — CLI entry point (`pnpm --filter api db:migrate`)
- [apps/api/src/lib/migrations.ts](apps/api/src/lib/migrations.ts) — core runner logic
- Raw SQL files in [infra/migrations/](infra/migrations/)

The runner:
1. Creates a `migrations` table if it doesn't exist
2. Scans `infra/migrations/*.sql` in filename-sorted order
3. Applies any files not yet recorded in `migrations`
4. Records each applied file with a timestamp

### Migration source of truth

**`infra/migrations/`** — 54 SQL files, sorted by filename (timestamp-prefixed).

### Latest migration files

```
2026-03-02-001-add-financial-facts-v1.sql
2026-03-02-002-add-page-registry-v1.sql
2026-03-02-003-add-deal-facts-v1.sql    ← LATEST (today)
```

### How migrations are applied in production

**Automatically at API container startup via `apps/api/start.sh`:**

```sh
#!/bin/sh
set -e
echo "[api] startup: running migrations"
pnpm --filter api db:migrate          # ← runs migrate.ts against DATABASE_URL
exec pnpm --filter api start          # ← starts the API server
```

This means:
- Every time `dealdecision-api` deploys (or restarts), migrations run automatically.
- The worker has **no migration runner** — it relies on the API having run them first.
- `migrate.ts` has a post-migration verification: it confirms `investor_insight_reports` table exists. If any older migration is missing, deployment fails fast.

### Is there CI or a deploy step?

**Not detectable from repository.** No CI config (`.github/workflows/`, `.gitlab-ci.yml`, etc.) was found in the examined workspace. Migrations run in-process at API startup.

### Actions required

| # | Action |
|---|---|
| 1 | Confirm `DATABASE_URL` is set in `dealdecision-api` service in Render UI |
| 2 | Confirm `PGSSLMODE=require` is also set (Render Postgres requires TLS) |
| 3 | On first deploy: API startup will automatically apply all 54 pending migrations |
| 4 | On subsequent deploys: only new `.sql` files are applied (idempotent by filename) |
| 5 | Monitor API startup logs for `[api] startup: running migrations` and `Migrations complete. applied=N pending=0` |
| 6 | If a deployment fails at startup, check logs for migration errors before app enters serving state |

**⚠️ Production Risk:** If the API container crashes immediately, migrations may not have completed. The worker will then hit missing-table errors. Always confirm API is healthy before checking worker status.

---

## 7. Production Cutover Checklist

```
[ ] 1.  Confirm repository default branch (or add `branch: production` to render.yaml)
         render.yaml has no `branch:` field — Render deploys from default branch.

[ ] 2.  Add missing env vars to Render dashboard (see Section 9 copy/paste blocks)
         API:    CLERK_JWKS_URL, PGSSLMODE, ADMIN_TOKEN, DETERMINISTIC_SCORE_V1_ENABLED,
                 ENABLE_INGEST_RECONCILE, AI_ANALYZE_TOKEN
         Worker: OPENAI_API_KEY, PGSSLMODE, PDF_EXTRACT_MODE, PDF_SLIDE_UNDERSTANDING_MODE,
                 PDF_PAGE_UNDERSTANDING_MODE, DDAI_ENABLE_PHASEB_VISUAL_EVIDENCE,
                 FUNDABILITY_SHADOW_MODE, FUNDABILITY_SOFT_CAPS, FUNDABILITY_HARD_GATES,
                 DETERMINISTIC_SCORE_V1_ENABLED, VISUAL_PAGE_IMAGE_DPI

[ ] 3.  Confirm Web Docker Build Arguments in Render dashboard
         Service → Settings → Docker Build Arguments:
           VITE_API_BASE_URL=https://<your-api-service>.onrender.com
           VITE_CLERK_PUBLISHABLE_KEY=pk_live_...

[ ] 4.  Provision or confirm Render Postgres is running
         Copy the Internal Database URL → set as DATABASE_URL in API and Worker

[ ] 5.  Provision or confirm Render Redis is running
         Copy the Redis Internal URL → set as REDIS_URL in API and Worker

[ ] 6.  Confirm Cloudflare R2 credentials are set in API and Worker (all 6 R2 vars)

[ ] 7.  Deploy `dealdecision-api`
         - Watch startup logs for: "[api] startup: running migrations"
         - Confirm: "Migrations complete. applied=N pending=0"
         - Confirm: "Verification passed: investor_insight_reports table exists."
         - Confirm health check: GET /health → 200

[ ] 8.  Deploy `dealdecision-worker`
         - No migration run — depends on API having completed migrations
         - Watch logs for Redis connection and queue registration
         - Confirm no "missing OPENAI_API_KEY" warnings

[ ] 9.  Deploy `dealdecision-vision-v2`
         - Confirm health check: GET /health → 200
         - Watch logs for Tesseract import confirmation: "imports_ok"

[ ] 10. Deploy `dealdecision-web`
         - Confirm VITE build args include correct API URL and Clerk key
         - Confirm site loads and API calls reach correct endpoint

[ ] 11. Smoke test — upload a pitch deck (PDF):
         a. Upload document via UI or POST /api/v1/deals/:id/documents
         b. Confirm worker logs: RENDER_COMPLETE event
         c. Confirm worker logs: extract_visuals job processed
         d. Confirm worker logs: OPENAI call succeeds (not "missing_openai_api_key")
         e. Confirm DB: visual_assets table populated
         f. Confirm R2: rendered page images exist at expected keys

[ ] 12. Verify OCR DPI in logs
         Worker logs should show VISUAL_PAGE_IMAGE_DPI=300 if set correctly.

[ ] 13. Confirm DB schema version
         Run: SELECT name, applied_at FROM migrations ORDER BY applied_at DESC LIMIT 5;
         Expect latest: 2026-03-02-003-add-deal-facts-v1.sql
```

---

## 8. Risks / Drift Findings (Top 10 by Severity)

| # | Risk | Severity | Details |
|---|---|---|---|
| 1 | **`OPENAI_API_KEY` missing from Worker in render.yaml** | CRITICAL | Worker performs ALL LLM analysis (deal overview, financial health, fundability scoring). Without the key, every LLM path returns early with `reason: missing_openai_api_key` and deals are silently stub-scored. |
| 2 | **`CLERK_JWKS_URL` (or `CLERK_JWT_ISSUER`) absent from API** | CRITICAL | Auth plugin throws HTTP 503 for every authenticated request if none of `CLERK_JWKS_URL`, `CLERK_JWT_ISSUER`, or `CLERK_JWT_VERIFICATION_KEY` is set. The API effectively becomes completely unusable. |
| 3 | **`PDF_EXTRACT_MODE` not set in Worker** | HIGH | Dev uses `v2_shadow` (enables newer PDF extraction path alongside legacy). Production defaults to `v1` (legacy only). Analysis quality and content will diverge from what was validated in dev. |
| 4 | **`DDAI_ENABLE_PHASEB_VISUAL_EVIDENCE` absent from Worker** | HIGH | Phase B visual evidence materialization is gated on this flag being `"1"`. In prod it is entirely disabled. Core visual evidence enrichment won't run. |
| 5 | **`VISUAL_PAGE_IMAGE_DPI` defaults to 200 in code** | HIGH | `apps/worker/src/lib/rendered-pages.ts`: `parseIntWithDefault(env.VISUAL_PAGE_IMAGE_DPI, 200)`. OCR accuracy degrades significantly at 200 DPI vs 300 DPI. Not set in `render.yaml` for worker. |
| 6 | **`FUNDABILITY_SHADOW_MODE` / `FUNDABILITY_SOFT_CAPS` absent from Worker** | HIGH | In `packages/core`, fundability v1 reads these env vars. Without them, fundability uses the legacy assessment path. Scores will be inconsistent with dev-validated output. |
| 7 | **`PGSSLMODE=require` absent from all services** | HIGH | Render managed Postgres requires TLS. `apps/worker/src/lib/db.ts` checks `process.env.PGSSLMODE === "require"` to enable SSL on the `pg` connection. Without it, SSL may not be negotiated, potentially causing connection rejections. |
| 8 | **No `branch:` in render.yaml** | MEDIUM | All services auto-deploy from the repository default branch. If the default branch is `main` (not `production`), there is no production branch isolation. A merge to `main` immediately triggers production deployment with no staging gate. |
| 9 | **Python `requirements.txt` uses `>=` ranges** | MEDIUM | `fastapi>=0.110.0`, `PyMuPDF>=1.24.10`, etc. A future pip resolution could install a breaking minor version. The Docker layer cache may mask this until a forced rebuild. |
| 10 | **`ENABLE_INGEST_RECONCILE` disabled in production by default** | MEDIUM | `apps/api/src/routes/documents.ts`: `reconcileEnabled = NODE_ENV !== "production" \|\| ENABLE_INGEST_RECONCILE === "true"`. In prod, stalled ingestion jobs (e.g. from worker restarts) will not auto-reconcile. Jobs will stay stuck until manual intervention. |

---

## 9. Final Copy/Paste Env Var Blocks for Render UI

### API – Render Env Vars
```env
# === REQUIRED (set these in Render dashboard) ===
NODE_ENV=production
PORT=9000
DATABASE_URL=<render-postgres-internal-url>
REDIS_URL=<render-redis-internal-url>
PGSSLMODE=require

# Clerk auth (REQUIRED — API returns 503 without one of these)
CLERK_SECRET_KEY=sk_live_...
CLERK_PUBLISHABLE_KEY=pk_live_...
CLERK_JWKS_URL=https://<your-frontend-api>.clerk.accounts.dev/.well-known/jwks.json
# Alternative: CLERK_JWT_ISSUER=https://<your-issuer>.clerk.accounts.dev

# OpenAI
OPENAI_API_KEY=sk-...

# Cloudflare R2 storage
R2_ACCOUNT_ID=<cloudflare-account-id>
R2_ACCESS_KEY_ID=<r2-access-key>
R2_SECRET_ACCESS_KEY=<r2-secret-key>
R2_BUCKET=<bucket-name>
R2_PUBLIC_BASE_URL=https://<public-r2-url>
R2_S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com

# === REQUIRED ADDITIONS (missing from render.yaml today) ===
DETERMINISTIC_SCORE_V1_ENABLED=1
ADMIN_TOKEN=<random-32-char-hex>
AI_ANALYZE_TOKEN=<random-32-char-hex>
ENABLE_INGEST_RECONCILE=true

# === RECOMMENDED ===
UPLOAD_DIR=/app/uploads
VISUAL_PAGE_IMAGE_MAX_PAGES=10

# OpenAI model overrides (optional — defaults to gpt-4o-mini)
# OPENAI_MODEL_REPORT_NARRATE=gpt-4o-mini
# OPENAI_MODEL_REPORT_OVERVIEW=gpt-4o-mini
# OPENAI_MODEL_DEAL_TERMS=gpt-4o-mini
# OPENAI_MODEL_FINANCIAL_ANALYSIS=gpt-4o-mini
# OPENAI_MODEL_RISK_VERIFICATION=gpt-4o-mini
# OPENAI_MODEL_VISUAL_ANALYZE=gpt-4o-mini
```

---

### Worker – Render Env Vars
```env
# === REQUIRED ===
NODE_ENV=production
DATABASE_URL=<render-postgres-internal-url>
REDIS_URL=<render-redis-internal-url>
PGSSLMODE=require

# OpenAI — CRITICAL: missing from render.yaml today
OPENAI_API_KEY=sk-...

# Cloudflare R2 storage
R2_ACCOUNT_ID=<cloudflare-account-id>
R2_ACCESS_KEY_ID=<r2-access-key>
R2_SECRET_ACCESS_KEY=<r2-secret-key>
R2_BUCKET=<bucket-name>
R2_PUBLIC_BASE_URL=https://<public-r2-url>
R2_S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com

# Vision worker endpoint (already in render.yaml — confirm URL is correct)
VISION_BASE_URL=https://dealdecision-vision-v2.onrender.com

# === REQUIRED ADDITIONS (all missing from render.yaml today) ===
# PDF pipeline mode — must match dev-validated behaviour
PDF_EXTRACT_MODE=v2_shadow
PDF_SLIDE_UNDERSTANDING_MODE=shadow
PDF_PAGE_UNDERSTANDING_MODE=shadow

# Phase B visual evidence
DDAI_ENABLE_PHASEB_VISUAL_EVIDENCE=1

# Fundability pipeline gates
FUNDABILITY_SHADOW_MODE=1
FUNDABILITY_SOFT_CAPS=1
FUNDABILITY_HARD_GATES=0

# Scoring
DETERMINISTIC_SCORE_V1_ENABLED=1

# === PERFORMANCE (already partially in render.yaml) ===
ENABLE_VISUAL_EXTRACTION=1
VISUAL_PAGE_IMAGE_PERSIST=1
WORKER_CONCURRENCY=1

# OCR DPI — CRITICAL quality fix (code default is 200, set to 300)
VISUAL_PAGE_IMAGE_DPI=300
VISUAL_PAGE_IMAGE_MAX_PAGES=10
VISUAL_PAGE_IMAGE_FORMAT=png

# === RECOMMENDED ===
UPLOAD_DIR=/app/uploads
EXTRACT_VISUALS_CONCURRENCY=1
ENABLE_NONPDF_RENDER_PAGES=0

# These disable shadow modes for features not yet validated in prod:
PDF_V2_OCR_MODE=off
PDF_V2_TEXT_REGION_ASSETS_MODE=off
```

---

### Vision Worker – Render Env Vars
```env
# === ALREADY IN render.yaml ===
LOG_LEVEL=INFO

# === RECOMMENDED ADDITIONS ===
# PORT is injected automatically by Render for web services — no action needed

# OCR control
VISION_OCR_ENABLED=1

# Time budgets (defaults are fine; explicit is better)
TABLE_TIME_BUDGET_S=4.0
CHART_TIME_BUDGET_S=4.0

# Vision understanding (CLIP/torch) — keep disabled unless built with ENABLE_VISION_UNDERSTANDING=1 build arg
ENABLE_VISION_UNDERSTANDING=0

# Logging
VISION_DEBUG_LOGS=0
```

---

### Web – Render Docker Build Arguments
> These must be set under **Service → Settings → Docker Build Arguments** in the Render dashboard,
> **in addition to** the standard env vars. They are baked into the Vite bundle at build time.

```
VITE_API_BASE_URL=https://dealdecision-api.onrender.com
VITE_CLERK_PUBLISHABLE_KEY=pk_live_...
VITE_BACKEND_MODE=live
```

---

## Appendix: Migration Files Reference

Latest 10 migration files:
```
2026-02-23-001-add-investor-insight-reports.sql
2026-02-23-002-investor-insight-reports-status-check.sql
2026-03-01-001-add-deal-report-exports.sql
2026-03-02-001-add-financial-facts-v1.sql
2026-03-02-002-add-page-registry-v1.sql
2026-03-02-003-add-deal-facts-v1.sql   ← latest as of 2026-03-02
```

Total migration files: 54 (as listed in `infra/migrations/`)

Migration verification query (run after deploy to confirm):
```sql
SELECT name, applied_at
FROM migrations
ORDER BY applied_at DESC
LIMIT 10;
```

Expected latest row: `2026-03-02-003-add-deal-facts-v1.sql`

---

*Context improved by Giga AI — used: render.yaml service definitions, Dockerfile CMD/build stages for all four services, docker-compose.dev.yml env var set, apps/api/src (process.env scan), apps/worker/src (process.env scan), packages/core/src (FUNDABILITY_* + DIO env vars), services/vision_worker/app (os.getenv scan), apps/api/scripts/migrate.ts + src/lib/migrations.ts, infra/migrations file listing.*
