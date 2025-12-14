# DealDecision AI — Frontend ↔ Backend Integration Requirements (UI Contract)

This document reviews the uploaded Dashboard UI foundation (Vite + React + TS) and specifies the backend contracts needed to connect it safely to the DealDecision AI “DIO-first” architecture.

---

## 1) UI review — alignment to our system understanding

### ✅ Workspace-level copilot exists
- `src/components/ChatAssistant.tsx` is a floating assistant intended for **workspace/global** usage (currently simulated responses).
- It already supports role-based quick actions (Investor vs Founder).

**Alignment:** Matches “workspace copilot for planning/research” (no deal binding by default).

### ✅ Deal-scoped copilot exists
- `src/components/workspace/AIDealAssistant.tsx` is a right-side panel assistant that is explicitly **deal-scoped** (`dealId`, `dealData` props).
- It is intended for debate, explanation, and deeper DD requests (currently simulated).

**Alignment:** Matches “deal-level evidence-bound debate partner over a computed diligence artifact.”

### ✅ Deal list + deal workspace patterns exist
- `src/components/pages/DealsList.tsx` includes list/grid, filters, stages, priority, lastUpdated, completeness, etc. (currently mock data).
- `src/components/pages/DealWorkspace.tsx` and related components suggest a single “deal cockpit” experience.

**Alignment:** Matches a DIO-centered workflow with summaries, sections, and progress indicators.

### ✅ Document ingestion UI exists
- `src/components/documents/DocumentUpload.tsx` supports drag/drop, multiple file types, optional “AI extraction” (currently simulated).
- `src/types/documents.ts` defines a typed document model.

**Alignment:** Matches Evidence Service + ingestion pipeline, but needs real upload + processing status.

### ✅ Report view exists
- `src/components/pages/DueDiligenceReport.tsx` and related report sections/components exist.
- Your separate `DueDiligenceReport.tsx` report template expects structured inputs.

**Alignment:** Matches “report compiler = deterministic DIO → TSX DTO.”

### 🟨 Some UI modules are future-phase
The UI includes:
- Templates & exports
- Team/collaboration
- Gamification widgets
- AI Studio / generator components

These can be feature-flagged behind backend readiness.

---

## 2) Backend contract principles (non-negotiables)

1. **DIO is the source of truth**  
   UI renders DIO snapshots (versioned). Conversation reads from DIO or triggers a new analysis job.

2. **Evidence IDs only**  
   Any citations displayed in UI must be `evidence_id` objects stored in Evidence Service; no raw URLs invented by LLM.

3. **Async processing**  
   Upload → ingest → extract → score → analyze must run as jobs with status endpoints (or events).

4. **Two chat scopes**  
   - Workspace chat: not bound to a deal by default  
   - Deal chat: always bound to a `deal_id` and DIO version context

---

## 3) API endpoints required (MVP-friendly)

> Base path examples use `/api/v1`. Adjust to your preference.

### 3.1 Auth / Session
If using Supabase Auth, the UI can hold JWTs; backend validates `Authorization: Bearer <token>`.

- `GET /api/v1/me` → current user profile + roles

### 3.2 Deals
These drive `DealsList`, `NewDealModal`, and `DealWorkspace`.

- `POST /api/v1/deals`
  - body: `{ name, company, type, stage, investmentAmount, description }`
  - returns: `{ deal_id }`

- `GET /api/v1/deals?search=&stage=&priority=&sort=`
  - returns: list items with:
    `{ deal_id, name, stage, score, last_updated, documents_count, completeness, funding_target, trend, priority, views, owner }`

- `GET /api/v1/deals/:deal_id`
  - returns full deal meta + current DIO pointer:
    `{ deal, dio: { current_version_id, status, overall_score, section_scores... } }`

- `PUT /api/v1/deals/:deal_id` (update deal meta)
- `DELETE /api/v1/deals/:deal_id` (soft-delete recommended)

### 3.3 Documents (Upload + library)
The UI currently simulates upload and extraction. Replace with:

- `POST /api/v1/deals/:deal_id/documents` (multipart/form-data)
  - fields: `file`, `doc_type?`, `category?`, `notes?`
  - returns: `{ document_id, upload_id, job_id }`

- `GET /api/v1/deals/:deal_id/documents`
  - returns: list of documents with server-truth status:
    `{ document_id, name, type, status, score?, file_size, pages?, uploaded_by, last_modified, version }`

- `GET /api/v1/documents/:document_id` (metadata)
- `GET /api/v1/documents/:document_id/download` (signed URL)
- `DELETE /api/v1/documents/:document_id`

### 3.4 Jobs (ingest / extract / analyze)
This is how the UI gets progress bars and avoids blocking.

- `POST /api/v1/deals/:deal_id/analyze`
  - body: `{ mode: "full"|"targeted", targets?: ["market","financials",...], options?: { budget_tokens?, budget_searches? } }`
  - returns: `{ job_id }`

- `GET /api/v1/jobs/:job_id`
  - returns: `{ job_id, type, status: "queued"|"running"|"complete"|"error", progress_pct?, message?, started_at?, finished_at?, result?: { dio_version_id } }`

### 3.5 DIO (Deal Intelligence Object)
The report and debate features depend on DIO.

- `GET /api/v1/deals/:deal_id/dio`
  - returns latest: `{ dio_version_id, created_at, status, ...DIO }`

- `GET /api/v1/deals/:deal_id/dio/:dio_version_id`
  - returns specific version (immutable)

- `GET /api/v1/deals/:deal_id/report/tsx`
  - returns **TSX-ready DTO** (or JSON props) compiled deterministically from DIO

### 3.6 Evidence Service (for citations + research)
Minimum endpoints (internal or public-to-UI depending on design):

- `POST /api/v1/evidence/search`
  - body: `{ query, recency_days?, domain_allowlist?, domain_blocklist?, limit? }`
  - returns: `{ candidates: [{ url, title, snippet }] }` (no “citations” yet)

- `POST /api/v1/evidence/fetch`
  - body: `{ url }`
  - returns: `{ evidence_id }`

- `GET /api/v1/evidence/:evidence_id`
  - returns: `{ evidence_id, canonical_url, title, publisher, published_at?, retrieved_at, excerpt, quality_score, relevance_score }`

> In deal context, evidence objects should additionally link to `deal_id` or be “attachable” to a deal.

### 3.7 Chat (workspace + deal)
Two endpoints; both return **messages + optional action proposals**.

- `POST /api/v1/chat/workspace`
  - body: `{ message, context?: { tab?, filters?, selected_deal_ids? } }`
  - returns: `{ reply, suggested_actions?: [...], citations?: [] }`
  - **Rule:** citations empty unless evidence objects exist and are returned by ID.

- `POST /api/v1/chat/deal`
  - body: `{ deal_id, dio_version_id?, message }`
  - returns: `{ reply, citations?: [{ evidence_id, excerpt }], suggested_actions?: [{ type, payload }] }`
  - **Rule:** only cite evidence IDs attached to the deal.

### 3.8 Events (recommended)
To make the UI feel “alive” (uploads, analysis progress), add one:

Option A (simple): Poll `GET /jobs/:job_id`  
Option B (better): Server-Sent Events

- `GET /api/v1/events?deal_id=...`
  - emits: `job.updated`, `document.updated`, `dio.created`

---

## 4) Required data-model alignment (UI ↔ backend)

### 4.1 DealsList fields
Backend must provide:
- `stage` enum: currently UI expects `'idea' | 'progress' | 'ready' | 'pitched'`
- `priority` enum: `'high' | 'medium' | 'low'`
- `trend` enum: `'up' | 'down' | 'stable'`
- `completeness` percentage
- `documents_count`
- `last_updated` human-friendly or ISO + UI formats it

> Recommendation: backend returns ISO dates; frontend formats “2 hours ago”.

### 4.2 Document model
UI has `DocumentType` and `DocumentStatus` in `src/types/documents.ts`. Keep those enums in backend contract.

### 4.3 Report DTO
Backend must return a stable DTO mapping to your TSX report components:
- `dealName`, `generatedDate`, `overallScore`, `sectionScores[]`
- sections: executive summary, recommendation, risks, market, team, business, financials, checklist
- each bullet can have: `text`, `evidence_ids[]`, `confidence`

---

## 5) Security / trust requirements

- All mutation endpoints require auth.
- Evidence fetch must sanitize URLs, block private IPs, and enforce allowlist rules (SSRF hardening).
- Evidence and DIO versions must be immutable once finalized.
- LLM outputs are never stored as “facts” unless bound to evidence IDs and accepted by HRM.

---

## 6) Implementation notes for your current UI code

### Replace simulated chat responses
- `ChatAssistant.tsx` and `AIDealAssistant.tsx` should call the chat endpoints and render returned messages/citations.
- Add “action chips” rendering from `suggested_actions`.

### Replace simulated upload/extraction
- `DocumentUpload.tsx` should:
  1) upload to `POST /deals/:deal_id/documents`
  2) subscribe to job status via polling or SSE
  3) update UI status from backend truth

### Replace mock deals
- `DealsList.tsx` should load from `GET /deals` and support filtering/sorting server-side.

---

## 7) MVP cut (recommended)
To connect UI to backend quickly, implement in this order:

1. Auth + `GET /me`
2. Deals CRUD (`POST/GET/GET:id`)
3. Document upload + list + job status
4. Analyze job → produces DIO version
5. Report DTO endpoint
6. Deal chat endpoint (reads DIO)
7. Workspace chat endpoint (planning/research, no citations by default)
8. SSE events (optional)

---

If you want, I can also generate:
- a typed OpenAPI spec (YAML) for these endpoints
- TypeScript client types for the UI (shared package)
- DB schema tables for Deals / Documents / Evidence / Jobs / DIO versions
