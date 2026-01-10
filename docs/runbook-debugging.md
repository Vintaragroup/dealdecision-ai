# Runbook: Debugging (Worker, API, Visuals, Trace)

This runbook is a practical checklist for the most common operational failure modes.

## Jobs stuck queued

Symptoms:

- Orchestration/API accepts a job but it never progresses.
- Queue depth grows while worker logs are quiet.

Checklist:

1. **Redis URL mismatch**
   - Confirm API and worker point to the same Redis instance.
   - Compare environment variables used by each process (common issues: different `.env`, different shell session, docker vs local).

2. **Worker not running**
   - Confirm the worker process is actually up (and not exiting on boot).
   - Run the worker in foreground and watch for connection errors.

3. **Wrong worker role / orchestration worker missing**
   - Some deployments have multiple worker entrypoints (e.g., an orchestration worker vs specialized workers).
   - Confirm the expected worker that consumes the queue is enabled and subscribed to the right queue name.

4. **Queue name mismatch**
   - If queue names are configurable, confirm both sides use the same key/prefix.

5. **DB connectivity**
   - A worker can be “running” but failing every job on DB connection; ensure DB env vars are correct and migrations applied.

## No visuals but pages exist

Symptoms:

- You can see document pages / rendered images exist on disk.
- API/UI shows no visuals, or visuals lane returns warnings.

Checklist:

1. **Confirm join path via documents**
   - Visual assets and extractions typically join through `documents`.
   - Validate the chain: deal → documents → visual_assets → visual_extractions.

2. **Phase B latest run missing**
   - If Phase B is represented as “latest run” + history, confirm the latest run exists.
   - If there is history but no latest, treat it as partial and check why latest was not written.

3. **Tables missing (fail-open behavior)**
   - Many endpoints intentionally return deal+docs and warnings if visual tables are not present.
   - Confirm migrations have created the expected tables.

4. **OCR dependency hints**
   - Some visual extraction relies on OCR or text extraction for tables/charts.
   - If images are present but OCR is missing/disabled, outputs can be empty.
   - Check worker logs for OCR/tooling warnings.

5. **Document type mismatch**
   - If extraction logic depends on document type (pdf/pitch_deck/powerpoint), confirm the stored type matches the extractor’s expectations.

## Partial coverage / mismatch (trace IDs missing)

Symptoms:

- Score breakdown reports “supported” but trace coverage is low.
- Sections show mismatch flags.
- UI cannot resolve evidence IDs into citations.

Checklist:

1. **Evidence IDs referenced but not present**
   - Claims may reference evidence IDs that were never persisted.
   - Verify evidence table contains those IDs.

2. **Evidence exists but not linked to section**
   - Evidence rows can exist but be missing `section_key` / linkage, depending on schema.
   - Confirm the linkage column(s) exist and are populated.

3. **Document metadata missing**
   - Evidence can reference a document ID; if document title/page_count is missing, UI citations look broken.
   - Verify documents table contains title/page_count (when available).

4. **Fail-open semantics**
   - The system should return partial results with warnings.
   - Treat mismatch as a diagnostic: it indicates linking gaps, not necessarily “no evidence anywhere”.

## Local development (api/web/worker) without affecting docker

Goal: run local services while docker is running, without collisions.

Checklist:

1. **Ports**
   - Common conflicts: API port, web dev server port, Postgres port, Redis port.
   - If docker is using a port, run local on an alternate port via env/config.

2. **Run services individually**
   - API only: run the API dev command from `apps/api`.
   - Worker only: run the worker dev command from `apps/worker`.
   - Web only: run the web dev command from `apps/web`.

3. **Environment isolation**
   - Ensure local processes use a local `.env` (or a dedicated `.env.local`) so you don’t point at production resources.

4. **DB/Redis selection**
   - Decide whether local services connect to docker DB/Redis or local ones.
   - Keep it consistent across API + worker so queues and persistence align.

5. **Debug quick checks**
   - API health endpoint responds.
   - Worker logs show it connected to Redis and is polling.
   - A test job enqueues and is consumed.
