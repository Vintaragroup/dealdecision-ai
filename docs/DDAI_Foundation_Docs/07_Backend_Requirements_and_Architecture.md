# DealDecision AI — Backend Requirements & Architecture

This document defines the backend foundation needed to support the DealDecision AI frontend dashboard, the DIO-first diligence engine, the Evidence Service, and the dual-scope copilot experience.

---

## 1. Goals

### Primary goals
- Produce deterministic, auditable due diligence outputs (DIO versions) and render them into a TSX-ready Report DTO.
- Prevent hallucinated citations by making **Evidence IDs** mandatory for any claim/citation.
- Support two conversational scopes:
  - **Workspace Copilot** (planning/research)
  - **Deal Copilot** (evidence-bound debate over a DIO)
- Be cost-effective now and scalable later via queues/workers.

### Non-goals (v1)
- Autonomous learning / weight updates from outcomes
- Founder-facing mode (future scope, should not block backend v1)
- Fully automated investment execution

---

## 2. Architectural Principles (non-negotiables)

1. **DIO is the source of truth**  
   UI renders DIO snapshots; chat reads DIO or triggers a new HRM cycle.

2. **Evidence-first**  
   No citation unless the backend has fetched + stored + scored the source and issued an `evidence_id`.

3. **Deterministic outputs**  
   The Report DTO is compiled from DIO, not generated freeform.

4. **Async for heavy work**  
   Ingestion, parsing, extraction, scoring, embedding, and HRM analysis are background jobs.

5. **Auditability by design**  
   Immutable versioning of:
   - DIO versions
   - Evidence objects (hashed)
   - Job runs and parameters

---

## 3. Recommended Backend Stack

### API
- Node.js + TypeScript + Fastify (modular monolith)

### Data
- Postgres (managed: Supabase/Neon/RDS)
- pgvector in Postgres for embedding search (optional v1 but recommended)

### Object storage
- S3-compatible (Cloudflare R2 / AWS S3): store raw uploads + normalized text extracts

### Queue / workers
- Redis + BullMQ (Upstash Redis recommended)

### Auth
- Supabase Auth (or JWT verification compatible with your existing auth approach)

### Deployment
- Start with two services:
  - `api` (Fastify)
  - `worker` (BullMQ processors)
- Scale by adding more `worker` replicas; split into services later if needed.

---

## 4. Core Backend Components

### 4.1 API Gateway (Fastify)
Responsibilities:
- Auth verification
- Request validation
- REST endpoints for deals/documents/chat/jobs/DIO/evidence
- Rate limiting
- Idempotency keys for mutations (uploads, analyze triggers)

### 4.2 Evidence Service
Responsibilities:
- Execute search via configured providers (Tavily / Google Search API)
- Fetch and normalize content (HTML/PDF)
- Store raw and normalized content
- Canonicalize URLs
- Compute hashes / dedupe
- Score quality + relevance + recency
- Produce Evidence objects that can be attached to deals
- Provide citations as excerpt + offsets

### 4.3 Ingestion & Parsing
Responsibilities:
- Accept uploads (PDF/DOCX/XLSX/CSV/PNG)
- Extract text and structural blocks
- Chunk into document units with stable IDs (hash-based)
- Generate embeddings for chunks (optional in v1; can be deferred)

### 4.4 HRM Analysis Engine (state machine)
Responsibilities:
- Build/update DIO from extracted facts
- Run heuristic scoring models (section scores, risk severity)
- Detect missing fields and contradictions
- Enforce stop conditions
- Emit new immutable DIO version

### 4.5 Report Compiler (deterministic)
Responsibilities:
- Convert a DIO version into a TSX-ready Report DTO
- Enforce “no claims without evidence_id” at compile time
- Provide stable section structure expected by the UI

### 4.6 Conversation Router
Responsibilities:
- Workspace chat: planning/research/task proposals (no citations unless evidence fetched)
- Deal chat: evidence-bound debate; reads DIO and returns citations by evidence_id only
- Translate “do deeper DD” requests into `analyze` job triggers (targeted mode)

---

## 5. Data Model (minimum tables)

> Naming is illustrative. Use migrations and strict constraints.

### 5.1 Users
- `users(id, email, role, created_at)`

### 5.2 Deals
- `deals(id, name, company, stage, priority, owner_id, created_at, updated_at, deleted_at)`

### 5.3 Documents
- `documents(id, deal_id, filename, mime_type, storage_key, status, uploaded_by, created_at, updated_at)`
- `document_versions(id, document_id, version, storage_key, extracted_text_key, hash, created_at)`

### 5.4 Evidence
- `evidence(id, canonical_url, original_url, title, publisher, published_at, retrieved_at, content_hash, quality_score, relevance_score, status)`
- `evidence_blobs(id, evidence_id, storage_key_raw, storage_key_text, bytes, created_at)`
- `deal_evidence(deal_id, evidence_id, attached_at, attached_by)`

### 5.5 Claims & Citations (optional but recommended)
- `claims(id, deal_id, dio_version_id, claim_type, text, confidence, created_at)`
- `claim_evidence(claim_id, evidence_id, excerpt, start_offset, end_offset)`

### 5.6 DIO Versions (immutable)
- `dio_versions(id, deal_id, version, status, overall_score, created_at, created_by, parent_version_id)`
- `dio_payloads(dio_version_id, jsonb_payload)` (or store JSONB directly on `dio_versions`)

### 5.7 Jobs
- `jobs(id, deal_id, type, status, progress_pct, message, params_jsonb, result_jsonb, created_at, started_at, finished_at, error_jsonb)`

### 5.8 Chat Logs (two scopes)
- `chat_threads(id, scope, deal_id?, created_at)`
- `chat_messages(id, thread_id, role, content, created_at, metadata_jsonb)`
- Deal chat messages should store `dio_version_id` context.

---

## 6. API Requirements (MVP)

### 6.1 Deals
- `POST /api/v1/deals`
- `GET /api/v1/deals`
- `GET /api/v1/deals/:deal_id`
- `PUT /api/v1/deals/:deal_id`
- `DELETE /api/v1/deals/:deal_id` (soft delete)

### 6.2 Documents
- `POST /api/v1/deals/:deal_id/documents` (multipart upload)
- `GET /api/v1/deals/:deal_id/documents`
- `GET /api/v1/documents/:document_id`
- `GET /api/v1/documents/:document_id/download` (signed URL)
- `DELETE /api/v1/documents/:document_id`

### 6.3 Jobs
- `GET /api/v1/jobs/:job_id`

### 6.4 Analysis
- `POST /api/v1/deals/:deal_id/analyze`
  - `{ mode: "full"|"targeted", targets?: string[], options?: {...} }`

### 6.5 DIO + Report
- `GET /api/v1/deals/:deal_id/dio` (latest)
- `GET /api/v1/deals/:deal_id/dio/:dio_version_id`
- `GET /api/v1/deals/:deal_id/report/tsx` (Report DTO)

### 6.6 Evidence
- `POST /api/v1/evidence/search`
- `POST /api/v1/evidence/fetch`
- `GET /api/v1/evidence/:evidence_id`
- `POST /api/v1/deals/:deal_id/evidence/attach` (attach evidence to deal)

### 6.7 Chat
- `POST /api/v1/chat/workspace`
- `POST /api/v1/chat/deal`

### 6.8 Events (recommended)
- `GET /api/v1/events?deal_id=...` (SSE)
  - emits: `job.updated`, `document.updated`, `dio.created`

---

## 7. Job Pipeline (recommended flows)

### 7.1 Document ingestion
1. Upload document → create `documents` + `jobs(ingest)`
2. Worker:
   - store blob to object storage
   - extract text
   - chunk + hash blocks
   - update document status

### 7.2 Evidence fetch & scoring
1. Candidate URL → `jobs(evidence_fetch)`
2. Worker:
   - fetch content, canonicalize, hash
   - normalize to text
   - score quality/relevance
   - store evidence record

### 7.3 HRM analysis cycle
1. `POST /analyze` → `jobs(analyze)`
2. Worker:
   - read extracted docs + attached evidence
   - update structured facts
   - compute section scores & risks
   - detect contradictions
   - determine stop conditions
   - write new immutable DIO version

### 7.4 Report compile
- In API request:
  - compile Report DTO from DIO deterministically
  - no background job required unless expensive

---

## 8. Security & Trust Controls

### 8.1 SSRF protection (evidence fetch)
- Block private IP ranges and metadata endpoints
- Enforce allowlist/blocklist for domains
- Validate URL scheme (`http`, `https`)
- Hard timeouts and size limits

### 8.2 Data integrity
- DIO versions are immutable (no updates; new version only)
- Evidence objects immutable after finalized (append-only corrections allowed via new record/version)
- Strict foreign keys for claim→evidence mapping

### 8.3 Rate limiting & budgets
- Per-user and per-deal budgets for:
  - searches/day
  - evidence fetches/day
  - analysis runs/day
  - LLM tokens/day

### 8.4 LLM constraints
- LLM cannot produce citations unless backend supplies evidence IDs
- Any narrative block must reference DIO fields and/or evidence excerpts

---

## 9. Observability (required for confidence + cost control)

- Structured logs with `request_id`, `deal_id`, `job_id`
- Metrics:
  - jobs processed, failure rate, latency
  - evidence fetch success rate
  - token usage per chat + per analysis
  - cost per deal per week
- Tracing for job pipelines
- Admin view for stuck jobs

---

## 10. MVP Implementation Plan (practical)

### Phase 1: Contract + persistence
- Implement DB schema + migrations
- Implement deals/documents endpoints
- Implement jobs table + polling endpoint

### Phase 2: Evidence service
- search + fetch + scoring
- attach evidence to deal

### Phase 3: DIO + report compiler
- DIO schema + versioning
- TSX Report DTO endpoint

### Phase 4: HRM engine
- baseline heuristics
- stop conditions
- targeted re-analysis

### Phase 5: Chat router
- workspace chat (planning)
- deal chat (DIO-aware)
- action proposals → analyze triggers

### Phase 6: SSE events + hardening
- SSE events
- SSRF protections
- rate limiting & budgets

---

## Appendix A — DIO & Report DTO Contracts
Create a shared TypeScript package:
- `@dealdecision/contracts`
  - `DIO.ts`
  - `ReportDTO.ts`
  - `DocumentTypes.ts`
  - `DealTypes.ts`

This prevents drift between UI and backend.

---

If you want, I can produce next:
- OpenAPI YAML for all endpoints
- Database migration SQL
- A repo folder structure for `api/worker/core/contracts`
