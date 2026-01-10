# Discovery Audit — Phase B Visuals & Analyzer Integration (Read-only)

Date: 2026-01-10

Goal: Determine whether extracted visual data (Phase B) is contributing to deal analysis, scoring, and evidence, including multi-document and multi-file-type workflows.

This is a read-only discovery artifact: no implementation, no refactors.

---

## 1) End-to-End Data Flow Mapping (Required)

This traces the full lifecycle of Phase B visual extraction data and explicitly classifies each hop as **read / ignored / summarized-only / used-as-evidence**, plus whether usage is **required / optional / diagnostic-only**.

### 1.1 API job enqueue → `extract_visuals`

- Entry point: `POST /api/v1/deals/:deal_id/extract-visuals` enqueues a single `extract_visuals` job for the deal.
  - Status: **read** (request), **required** (to run Phase B)
  - Evidence: [apps/api/src/routes/deals.ts](apps/api/src/routes/deals.ts#L3724-L3782)

### 1.2 Worker job entrypoint → target document selection

- Entrypoint: `registerWorker("extract_visuals", ...)` resolves target documents from:
  - `document_id` (single), or
  - `document_ids` (explicit list), or
  - `deal_id` → `getDocumentsForDeal(dealId)` → loop all docs
  - Status: **reads** document list, **required**
  - Evidence: [apps/worker/src/index.ts](apps/worker/src/index.ts#L1048-L1082)

### 1.3 Worker gates (Phase B can be skipped/blocked)

- Gate 1: `ENABLE_VISUAL_EXTRACTION=1` required.
  - Status: **required**
  - Evidence: [apps/worker/src/index.ts](apps/worker/src/index.ts#L1096-L1110) and [apps/worker/src/lib/visual-extraction.ts](apps/worker/src/lib/visual-extraction.ts#L94-L123)

- Gate 2: DB tables must exist: `visual_assets`, `visual_extractions`, `evidence_links`.
  - Status: **required**
  - Evidence: [apps/worker/src/index.ts](apps/worker/src/index.ts#L1116-L1131)

### 1.4 Page image resolution (hard dependency)

- For each document, the worker needs page image URIs (either passed explicitly for single-doc jobs, or resolved from artifacts).
  - Status: **required input** for Phase B; without it, document is **skipped**
  - Evidence: [apps/worker/src/index.ts](apps/worker/src/index.ts#L1158-L1176)

- Resolver: `resolvePageImageUris(...)` reads `documents.page_count` + `documents.extraction_metadata`, then searches candidate artifact directories for page images.
  - Status: **reads** metadata, **required**
  - Evidence: [apps/worker/src/lib/visual-extraction.ts](apps/worker/src/lib/visual-extraction.ts#L169-L260)

### 1.5 Fallback rendering (PDF-only)

- If no page images are found, the worker attempts best-effort recovery by loading original bytes and rendering pages **only if the stored original is a PDF**.
  - Status: **optional**, **PDF-only fallback**
  - Evidence: [apps/worker/src/index.ts](apps/worker/src/index.ts#L1178-L1256)

- When fallback rendering succeeds, it patches `documents.extraction_metadata` with rendered-page fields (via `mergeDocumentExtractionMetadata`) and may backfill `documents.page_count`.
  - Status: **writes** metadata to support later page image resolution; **optional**
  - Evidence: [apps/worker/src/index.ts](apps/worker/src/index.ts#L1257-L1317)

### 1.6 Vision call + persistence (visual tables + evidence links)

- For each resolved page URI, worker calls the vision worker and persists the response.
  - Status: **writes persisted outputs**, **required for Phase B data to exist**
  - Evidence: [apps/worker/src/index.ts](apps/worker/src/index.ts#L1249-L1288)

- Persistence function: `persistVisionResponse(...)` writes:
  - `visual_assets` (1 row per detected asset)
  - `visual_extractions` (OCR + `structured_json` per asset)
  - `evidence_links` (generic pointers; includes a snippet and a ref JSON)
  - Status: **writes**; **required** for Phase B storage
  - Evidence: [apps/worker/src/lib/visual-extraction.ts](apps/worker/src/lib/visual-extraction.ts#L470-L569)

### 1.7 Phase B aggregation → features

- Aggregation: `fetchPhaseBVisualsFromDb(pool, dealId)` reads `visual_assets` (+ optional joins to `visual_extractions` and `evidence_links`) and returns counts/ratios.
  - Status: **summarized-only** (counts/ratios), **diagnostic-only**
  - Evidence: [apps/worker/src/lib/phaseb/extract.ts](apps/worker/src/lib/phaseb/extract.ts#L40-L155)

- Feature extraction: `extractPhaseBFeaturesV1(...)` converts those counts into `phase_b_features` (coverage/content_density/structure/flags/notes).
  - Status: **summarized-only**, **diagnostic-only**
  - Evidence: [apps/worker/src/lib/phaseb/extract.ts](apps/worker/src/lib/phaseb/extract.ts#L157-L282)

### 1.8 Phase B “features-only” persistence during `analyze_deal`

- In `analyze_deal`, Phase B runs are persisted as `{ status: "features_only" }` plus `phase_b_features`.
  - Status: **summarized-only**, explicitly labeled “diagnostic-only” in code comments
  - Evidence: [apps/worker/src/index.ts](apps/worker/src/index.ts#L1555-L1671)

- Storage table: `deal_phase_b_runs(phase_b_result, phase_b_features)`.
  - Status: **writes summary JSON**, **optional** (fail-open)
  - Evidence: [infra/migrations/2026-01-08-001-add-deal-phase-b-runs.sql](infra/migrations/2026-01-08-001-add-deal-phase-b-runs.sql#L1-L20)

### 1.9 Phase B in API responses

- Deal GET and list endpoints join `deal_phase_b_runs` and expose:
  - `phase_b.latest_run` and `phase_b.history` (or `phase1.phase_b_latest_run` / `phase1.phase_b_history`)
  - Status: **read + exposed**, **optional** (informational)
  - Evidence: [apps/api/src/routes/deals.ts](apps/api/src/routes/deals.ts#L3350-L3607) and [apps/api/src/routes/deals.ts](apps/api/src/routes/deals.ts#L1586-L1712)

### 1.10 Scoring + `score_breakdown_v1` + `score_trace_audit_v1`

- `score_breakdown_v1` is built from Phase 1 inputs: `coverage`, `accountability_v1`, and `phase1_claims` evidence IDs.
  - Status: **visual data ignored** (no reads of visual tables/JSON/evidence_links here)
  - Evidence: [apps/api/src/routes/deals.ts](apps/api/src/routes/deals.ts#L589-L1010)

- `score_trace_audit_v1` uses evidence linkage counts derived from `evidence_ids` and `evidence_ids_linked` inside the breakdown sections.
  - Status: **visual data ignored**
  - Evidence: [apps/api/src/routes/deals.ts](apps/api/src/routes/deals.ts#L820-L1005)

### 1.11 Evidence tables: `evidence` vs `evidence_links`

- Phase 1 score evidence building (`phase1_score_evidence`) fetches rows from the `evidence` table only.
  - Status: **reads `evidence`**, **ignores `evidence_links`**
  - Evidence: [apps/api/src/routes/deals.ts](apps/api/src/routes/deals.ts#L3570-L3665) and [apps/api/src/routes/deals.ts](apps/api/src/routes/deals.ts#L1006-L1075)

- Phase B creates `evidence_links` entries during visual persistence, not `evidence` rows.
  - Status: **writes `evidence_links`**, **not used in scoring**
  - Evidence: [apps/worker/src/lib/visual-extraction.ts](apps/worker/src/lib/visual-extraction.ts#L438-L513) and [infra/migrations/2026-01-05-001-add-visual-extraction-lane.sql](infra/migrations/2026-01-05-001-add-visual-extraction-lane.sql#L118-L173)

### 1.12 UI consumption

- Deal workspace consumes Phase B runs from the deal payload and renders metrics from `phase_b_features`.
  - Status: **reads summarized-only features**, **optional/diagnostic**
  - Evidence: [apps/web/src/components/pages/DealWorkspace.tsx](apps/web/src/components/pages/DealWorkspace.tsx#L692-L980)

- UI surfaces backend diagnostics when visual extraction is blocked due to missing originals/rendered pages.
  - Status: **reads diagnostics string**; **optional UX support**
  - Evidence: [apps/web/src/components/pages/DealWorkspace.tsx](apps/web/src/components/pages/DealWorkspace.tsx#L1403-L1471)

- Evidence panel uses `score_breakdown_v1` evidence IDs and the `phase1_score_evidence` payload (built from `evidence` rows).
  - Status: **visual data ignored**
  - Evidence: [apps/web/src/components/evidence/EvidencePanel.tsx](apps/web/src/components/evidence/EvidencePanel.tsx#L255-L420)

---

## 2) Visual JSON Inspection

This section identifies where visual extraction output is structured, what schema is expected, what is written, and whether anything downstream parses it.

### 2.1 Visual tables + JSON columns (expected schema)

- `visual_extractions.structured_json` (JSONB): structured extraction payload.
- `visual_extractions.ocr_blocks` (JSONB array): OCR blocks with bbox.
- `visual_assets.bbox` (JSONB): normalized bbox.
- `visual_assets.quality_flags` (JSONB): flags used by Phase B aggregation.
- `evidence_links.ref` (JSONB): reference payload for traceability.
  - Evidence: [infra/migrations/2026-01-05-001-add-visual-extraction-lane.sql](infra/migrations/2026-01-05-001-add-visual-extraction-lane.sql#L24-L173)

### 2.2 Worker response schema (what the worker expects to receive)

- The worker expects a `VisionExtractResponse` with:
  - `assets[]` each containing:
    - `asset_type`, `bbox`, `confidence`, `quality_flags`, `image_uri`, `image_hash`
    - `extraction` containing: `ocr_text`, `ocr_blocks`, `structured_json`, `units`, `labels`, `model_version`, `confidence`
  - Evidence: [apps/worker/src/lib/visual-extraction.ts](apps/worker/src/lib/visual-extraction.ts#L33-L69)

### 2.3 What is actually written (examples of keys)

- `visual_extractions.structured_json`: written as an object (merged on upsert).
  - Evidence: [apps/worker/src/lib/visual-extraction.ts](apps/worker/src/lib/visual-extraction.ts#L420-L477)

- Example key observed in test fixtures: `structured_json: { rows: 1 }`.
  - Evidence: [apps/worker/src/lib/visual-extraction.test.ts](apps/worker/src/lib/visual-extraction.test.ts#L145-L196)

- `evidence_links.ref` keys written by `persistVisionResponse(...)` include:
  - `asset_type`, `bbox`, `image_uri`, `page_image_uri`, `image_hash`, `extractor_version`
  - Evidence: [apps/worker/src/lib/visual-extraction.ts](apps/worker/src/lib/visual-extraction.ts#L513-L548)

### 2.4 Phase B run JSON (`deal_phase_b_runs`)

- `deal_phase_b_runs.phase_b_features` stores computed summary features (coverage/content_density/structure/flags/notes).
  - Evidence: [infra/migrations/2026-01-08-001-add-deal-phase-b-runs.sql](infra/migrations/2026-01-08-001-add-deal-phase-b-runs.sql#L1-L20) and [apps/worker/src/lib/phaseb/extract.ts](apps/worker/src/lib/phaseb/extract.ts#L200-L282)

### 2.5 Downstream parsing

- Downstream code parses Phase B **features** (not raw visual JSON) in the UI.
  - Evidence: [apps/web/src/components/pages/DealWorkspace.tsx](apps/web/src/components/pages/DealWorkspace.tsx#L692-L880)

- Scoring/evidence code paths do not parse `visual_extractions.structured_json` or `evidence_links.ref`.
  - Evidence: [apps/api/src/routes/deals.ts](apps/api/src/routes/deals.ts#L589-L1075)

---

## 3) Multi-Document Coverage Audit

### 3.1 Phase 1 document inclusion (analyze)

- `analyze_deal` loads *all* documents for the deal and filters for eligibility:
  - `status` is `completed` or `ready_for_analysis`
  - `extraction_metadata` is present
  - Status: **reads all docs then filters**; **required**
  - Evidence: [apps/worker/src/index.ts](apps/worker/src/index.ts#L1436-L1450)

- There is no “first document wins” logic in this selection; it maps `eligible.map(...)` to build arrays.
  - Evidence: [apps/worker/src/index.ts](apps/worker/src/index.ts#L1452-L1548)

### 3.2 Phase B document inclusion (visual extraction)

- With `deal_id`, Phase B targets every document returned by `getDocumentsForDeal(dealId)`.
  - Status: **reads all docs then iterates**; **required** for multi-document
  - Evidence: [apps/worker/src/index.ts](apps/worker/src/index.ts#L1064-L1079)

### 3.3 Conditions that cause documents to be skipped

- Phase 1 skip (in `analyze_deal`): any doc failing eligibility filter (status/extraction_metadata) is excluded.
  - Evidence: [apps/worker/src/index.ts](apps/worker/src/index.ts#L1440-L1450)

- Phase B skip (in `extract_visuals`): document is skipped if no page image URIs can be resolved, and PDF-only recovery doesn’t produce them.
  - Evidence: [apps/worker/src/index.ts](apps/worker/src/index.ts#L1158-L1319)

- Phase B can succeed even if some documents were skipped (it tracks `docsSkipped` and continues); only if *zero* docs are processed does the job fail with diagnostics.
  - Evidence: [apps/worker/src/index.ts](apps/worker/src/index.ts#L1320-L1370)

### 3.4 “Silently ignored” documents

- Phase B documents skipped due to missing page images are not surfaced as an error unless *all* documents are skipped.
  - Evidence: [apps/worker/src/index.ts](apps/worker/src/index.ts#L1320-L1370)

---

## 4) File-Type Coverage Matrix

This matrix is limited to what is directly evidenced in code: Phase 1 file dispatch is explicit; Phase B is driven by page image availability and has a PDF-only fallback renderer.

| File Type | Phase 1 Text Extraction | Phase B Visual Extraction | Page Images Required | Fallback Exists |
|----------|--------------------------|---------------------------|----------------------|-----------------|
| PDF      | Yes (dispatch `contentType=pdf`) | Yes (if page images resolvable; otherwise tries PDF-only render) | Yes | Yes (PDF-only render from stored original bytes) |
| PPTX     | Yes (`contentType=powerpoint`) | Conditional (only if page images already exist) | Yes | No (no PPTX render fallback in `extract_visuals`) |
| DOCX     | Yes (`contentType=word`) | Conditional (only if page images already exist) | Yes | No |
| XLS/XLSX | Yes (`contentType=excel`) | Conditional (only if page images already exist) | Yes | No |
| Images   | Yes (`contentType=image` via OCR) | Conditional (requires page image URI; no type-specific fallback in `extract_visuals`) | Yes | No |

Evidence:
- Phase 1 file-type dispatch mapping: [apps/worker/src/lib/processors/index.ts](apps/worker/src/lib/processors/index.ts#L24-L69) and [apps/worker/src/lib/processors/index.ts](apps/worker/src/lib/processors/index.ts#L71-L146)
- Phase B page-image requirement + PDF-only fallback: [apps/worker/src/index.ts](apps/worker/src/index.ts#L1158-L1319)

Hard blockers evidenced:
- Phase B requires page images; without them, documents are skipped (and job fails only if all docs skipped): [apps/worker/src/index.ts](apps/worker/src/index.ts#L1158-L1370)
- Fallback rendering path is explicitly gated to PDFs: [apps/worker/src/index.ts](apps/worker/src/index.ts#L1201-L1224)

---

## 5) Analyzer Usage Verification

### 5.1 Does `analyze_deal` read visual tables / visual JSON / evidence linked to visuals?

- Yes, but **summary-only**: `analyze_deal` calls `fetchPhaseBVisualsFromDb(...)` to aggregate counts from `visual_assets` (+ joins).
  - Status: **reads summarized counts**, **diagnostic-only**
  - Evidence: [apps/worker/src/index.ts](apps/worker/src/index.ts#L1555-L1671) and [apps/worker/src/lib/phaseb/extract.ts](apps/worker/src/lib/phaseb/extract.ts#L40-L155)

- No, for structured visual JSON: there is no code in `analyze_deal` that reads `visual_extractions.structured_json` or `evidence_links.ref` as inputs to Phase 1 claims/scoring.
  - Evidence: [apps/worker/src/index.ts](apps/worker/src/index.ts#L1436-L1671) (Phase B block is limited to summary + insert)

### 5.2 Do visuals affect scoring / coverage completeness / trace audits / mismatch detection?

- Scoring + `score_breakdown_v1` uses Phase 1 `coverage` + `accountability_v1` + Phase 1 claims evidence IDs.
  - Status: **visuals ignored**
  - Evidence: [apps/api/src/routes/deals.ts](apps/api/src/routes/deals.ts#L589-L1010)

- `score_trace_audit_v1` and mismatch flags are derived from evidence linkage counts in `score_breakdown_v1` sections.
  - Status: **visuals ignored**
  - Evidence: [apps/api/src/routes/deals.ts](apps/api/src/routes/deals.ts#L820-L1005)

### 5.3 Are Phase B outputs treated as signals, diagnostics, evidence, or unused data?

- Phase B run outputs are treated as **diagnostic-only signals** (features-only) and are surfaced to the UI as metrics.
  - Evidence: [apps/worker/src/index.ts](apps/worker/src/index.ts#L1555-L1671) and [apps/web/src/components/pages/DealWorkspace.tsx](apps/web/src/components/pages/DealWorkspace.tsx#L692-L880)

---

## 6) Evidence & Trace Integration Check

### 6.1 Can visual extraction produce an `evidence` row?

- No in the Phase B pipeline: `persistVisionResponse(...)` inserts into `evidence_links`, not `evidence`.
  - Evidence: [apps/worker/src/lib/visual-extraction.ts](apps/worker/src/lib/visual-extraction.ts#L438-L513)

### 6.2 Can a visual extraction produce a linked `evidence_id` used in `score_breakdown_v1`?

- No: `score_breakdown_v1` evidence IDs come from Phase 1 claims’ evidence fields and/or evidence-table samples.
  - Evidence: [apps/api/src/routes/deals.ts](apps/api/src/routes/deals.ts#L680-L790)

- The evidence fetch logic for score evidence reads from the `evidence` table only.
  - Evidence: [apps/api/src/routes/deals.ts](apps/api/src/routes/deals.ts#L1006-L1075) and [apps/api/src/routes/deals.ts](apps/api/src/routes/deals.ts#L3570-L3665)

### 6.3 Where the pipeline stops (fact)

- The visual lane persists: `visual_assets` + `visual_extractions` + `evidence_links`.
  - Evidence: [infra/migrations/2026-01-05-001-add-visual-extraction-lane.sql](infra/migrations/2026-01-05-001-add-visual-extraction-lane.sql#L24-L173) and [apps/worker/src/lib/visual-extraction.ts](apps/worker/src/lib/visual-extraction.ts#L470-L569)

- Downstream scoring/evidence does not consume `evidence_links` or raw visual JSON.
  - Evidence: [apps/api/src/routes/deals.ts](apps/api/src/routes/deals.ts#L589-L1075)

### 6.4 Can visuals be marked “USED IN SCORE” / appear in trace audits / influence mismatch flags?

- In the UI, score evidence items are marked `usedInScore: true` because they come from the score evidence payload (which is derived from `evidence` rows).
  - Visual lane data does not enter that payload.
  - Evidence: [apps/web/src/components/evidence/EvidencePanel.tsx](apps/web/src/components/evidence/EvidencePanel.tsx#L371-L420)

- Therefore, Phase B visuals do not appear as score-evidence items and do not influence mismatch flags.
  - Evidence: [apps/api/src/routes/deals.ts](apps/api/src/routes/deals.ts#L820-L905) and [apps/web/src/components/evidence/EvidencePanel.tsx](apps/web/src/components/evidence/EvidencePanel.tsx#L268-L312)

---

## 7) Gaps, Risks, and Recommendations (No Code)

Facts only; no implementation.

### P0 — Correctness

- Gap: Visual lane evidence (`evidence_links`) is not part of the scoring evidence pipeline (`evidence` → `phase1_score_evidence` → `EvidencePanel`).
  - Evidence: [apps/worker/src/lib/visual-extraction.ts](apps/worker/src/lib/visual-extraction.ts#L438-L513) and [apps/api/src/routes/deals.ts](apps/api/src/routes/deals.ts#L3570-L3665)

Risk to scoring accuracy:
- Charts/tables detected in Phase B cannot directly support Phase 1 section trace coverage or mismatch detection.

Minimal integration points (by component, not code):
- Scoring/evidence assembly in API route layer (deal GET) where evidence IDs are collected and `phase1_score_evidence` is built.
- Evidence model layer that currently fetches only `evidence` rows.

### P1 — Completeness

- Gap: Phase B processing is page-image-dependent; non-PDF types have no fallback rendering in the Phase B worker.
  - Evidence: [apps/worker/src/index.ts](apps/worker/src/index.ts#L1178-L1319)

Risk:
- Visual extraction coverage varies by file type based on whether rendered page images exist.

Minimal integration points:
- The Phase B worker’s “page image acquisition” step (source artifacts / rendered pages).

### P2 — Quality / Insight

- Gap: Phase B features are persisted and surfaced, but are treated as diagnostic summaries and not used to drive Phase 1 scoring or evidence linkage.
  - Evidence: [apps/worker/src/index.ts](apps/worker/src/index.ts#L1555-L1671) and [apps/web/src/components/pages/DealWorkspace.tsx](apps/web/src/components/pages/DealWorkspace.tsx#L692-L880)

Risk:
- Phase B becomes a “dashboard metric” rather than an input to investment decision support.

---

## 8) Final Summary (Yes / No)

- Are visual extractions currently used in scoring? **No.**
  - Evidence: `score_breakdown_v1` built from Phase 1 claims/evidence IDs, no visual tables: [apps/api/src/routes/deals.ts](apps/api/src/routes/deals.ts#L589-L1010)

- Are visuals parsed into structured data (downstream)? **Partially.**
  - Visual lane writes `visual_extractions.structured_json`, but downstream scoring does not parse it.
  - Evidence: persistence schema [infra/migrations/2026-01-05-001-add-visual-extraction-lane.sql](infra/migrations/2026-01-05-001-add-visual-extraction-lane.sql#L72-L117) and scoring path [apps/api/src/routes/deals.ts](apps/api/src/routes/deals.ts#L589-L1075)

- Are all documents and file types processed consistently? **No.**
  - Phase 1 eligibility filter can exclude documents.
  - Phase B requires page images and has a PDF-only fallback.
  - Evidence: Phase 1 eligibility [apps/worker/src/index.ts](apps/worker/src/index.ts#L1436-L1450); Phase B page images + fallback [apps/worker/src/index.ts](apps/worker/src/index.ts#L1158-L1319)

- Does Phase B influence investor decisions today (via scoring/evidence)? **No.**
  - It is surfaced as summary metrics in the UI but does not flow into score evidence or trace audits.
  - Evidence: UI reads Phase B metrics [apps/web/src/components/pages/DealWorkspace.tsx](apps/web/src/components/pages/DealWorkspace.tsx#L692-L880); score evidence path [apps/api/src/routes/deals.ts](apps/api/src/routes/deals.ts#L3570-L3665)
