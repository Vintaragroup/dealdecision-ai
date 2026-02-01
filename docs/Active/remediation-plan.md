# Analysis Pipeline Remediation Plan
_Status: Draft — Execution-Oriented_
_Last updated: 2026-01-10_

---

## Purpose

This document defines the **concrete remediation plan** for known gaps in the DealDecisionAI analysis pipeline, as established in:

- `docs/Active/analysis-pipeline-reality.md`

This plan is **intentionally execution-focused**:

- Every item maps to a discrete change or ticket.
- No speculative capabilities are described.
- Phase ordering, dependencies, and acceptance criteria are explicit.

This document answers **“what we will change”**, not “what exists today.”

---

## Guiding Principles

1. **Reality-first**
   - No remediation is defined unless a gap is proven in code, schema, or runtime behavior.

2. **Deterministic ingestion**
   - All uploaded documents must eventually be ingested and extracted, even under partial client failure.

3. **Single invariant for visuals**
   - If a document is “supported,” it must produce page-level visual assets discoverable by Phase B.

4. **Phase isolation**
   - Phase 1 and Phase B remain independent passes.
   - Enrichment flows forward only via persisted artifacts.

5. **Fill-only enrichment**
   - Phase B may only fill missing Phase 1 fields, never override extracted truth.

---

## Remediation Overview (Tickets)

| Ticket | Area | Summary | Blocking |
|------|------|--------|----------|
| 0 | Schema | Resolve `documents.id` vs `document_id` ambiguity | Yes |
| 1 | Ingest | Deal-level ingestion reconciliation | No |
| 2 | Upload | Idempotency + duplicate visibility | No |
| 3 | Visuals | Page images for non-PDF docs | No |
| 4 | OCR | Canonical OCR persistence | No |
| 5 | Enrichment | Persist Phase B enrichment bundle | No |
| 6 | Scoring | Phase 1 consumption rules (fill-only) | No |

---

## Ticket 0 — Schema Ambiguity Resolution (Blocking)

### Problem
Database migrations define:

- `documents.document_id TEXT PRIMARY KEY`

Production code assumes:

- `documents.id UUID PRIMARY KEY`

Downstream tables (visual_assets, jobs, evidence links) reference `documents.id`.

### Plan
- Introduce a migration that:
  - Ensures `documents.id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
  - Preserves legacy `document_id` as `legacy_document_id` (TEXT, nullable)
  - Updates all foreign keys to reference `documents.id`

### Acceptance Criteria
- `documents.id` exists and is primary key
- All joins use `documents.id`
- No runtime ambiguity remains

---

## Ticket 1 — Multi-Document Ingest Reconciliation

### Problem
- Each ingest job processes exactly one document.
- Multi-file uploads rely on the client looping correctly.
- Partial client failure leaves documents permanently unextracted.

### Plan
- Add endpoint:
  ```
  POST /api/v1/deals/:deal_id/documents/reconcile-ingest
  ```
- Endpoint behavior:
  - Finds documents with `extraction_metadata IS NULL`
  - Enqueues ingest jobs using stored original bytes

### Acceptance Criteria
- A deal can be made “fully extracted” server-side
- No document remains stuck due to client interruption

---

## Ticket 2 — Upload Idempotency & Visibility

### Problem
- Duplicate uploads are inconsistently handled.
- No deterministic way to detect identical content.

### Plan
- Persist `original_bytes_sha256` in `documents.extraction_metadata`
- Allow duplicates but surface:
  - Same-hash documents
  - Extracted vs unextracted counts per deal

### Acceptance Criteria
- Operators can detect duplicate uploads
- No extraction ambiguity from repeated files

---

## Ticket 3 — Multi-Type Visual Asset Generation

### Problem
- Phase B visuals rely on page images.
- Only PDFs currently generate rendered pages.

### Plan
Extend ingest to generate:

- PPTX → slide images
- DOCX → page images
- XLSX → sheet images (or structured-only fallback)
- Image files → single page image

Naming invariant:
```
uploads/rendered_pages/<documentId>/page_###.png
```

### Acceptance Criteria
- `resolvePageImageUris(...)` works unchanged
- Phase B runs across mixed doc types

---

## Ticket 4 — Canonical OCR Persistence

### Problem
- OCR storage is optional and schema-drift tolerant.
- Silent loss of OCR capability is possible.

### Plan
- Migration:
  - `ADD COLUMN IF NOT EXISTS ocr_text TEXT`
  - `ADD COLUMN IF NOT EXISTS ocr_blocks JSONB`
- Remove “fail-open” OCR absence annotations later.

### Acceptance Criteria
- OCR text is always persisted when available
- Phase B summaries no longer need drift guards

---

## Ticket 5 — Phase B Enrichment Bundle Persistence

### Problem
- Phase B outputs are diagnostic-only.
- Phase 1 cannot consume visual insights.

### Plan
- Persist `enrichment_bundle_v1` inside:
  ```
  deal_phase_b_runs.phase_b_features
  ```
- Bundle includes:

  - signal_type
  - value_json / value_text
  - confidence
  - evidence pointers (document_id, page_index, visual_asset_id)

### Acceptance Criteria
- Enrichment is queryable post-run
- Evidence is traceable to visuals

---

## Ticket 6 — Phase 1 Enrichment Consumption (Fill-Only)

### Problem
- Phase 1 ignores Phase B outputs entirely.

### Plan
- On next analyze run:
  - Phase 1 reads latest enrichment bundle
  - Fills only missing fields:
    - market_icp
    - terms / raise
    - traction metrics
    - pricing hints
- No overrides of extracted text

### Acceptance Criteria
- Coverage improves without changing scoring logic
- Evidence links appear in Phase 1 trace output

---

## Execution Order

1. Ticket 0 (required)
2. Ticket 1
3. Ticket 3
4. Ticket 5
5. Ticket 6
6. Tickets 2 & 4 (can be parallel)

---

## Non-Goals (Explicit)

- No real-time Phase 1 ↔ Phase B feedback loop
- No visual-first scoring changes
- No automatic overrides of extracted text
- No UI redesign in this phase

---

## Next Step

Each ticket above should be broken into:

- A single markdown file under `docs/Active/tickets/`
- With scope, file paths, and Definition of Done

Example ticket paths:

- `docs/Active/tickets/TICKET-1-ingest-reconciliation.md`
- `docs/Active/tickets/TICKET-3-multitype-visuals.md`
- ...
