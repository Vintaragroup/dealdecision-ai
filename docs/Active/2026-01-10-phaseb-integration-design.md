# Discovery — Phase B → Analyzer Remediation & Integration Design (No Code)

Date: 2026-01-10

Scope: Design-level remediation points to incorporate Phase B visual extraction outputs into deal evaluation, scoring, and evidence with minimal scope expansion. This document is grounded in the Phase B audit and cites current wiring points.

---

## 1) Final Ground Truth (From Audit)

**Facts (what Phase B currently produces)**

- Persists per-visual outputs into visual lane tables:
  - `visual_assets` rows (asset bbox/type/quality flags)
  - `visual_extractions` rows (OCR text/blocks + `structured_json`)
  - `evidence_links` rows (generic link + snippet + `ref` JSON)
  - Evidence: [infra/migrations/2026-01-05-001-add-visual-extraction-lane.sql](infra/migrations/2026-01-05-001-add-visual-extraction-lane.sql#L24-L173) and [apps/worker/src/lib/visual-extraction.ts](apps/worker/src/lib/visual-extraction.ts#L470-L569)
- Computes and persists Phase B summary features (`phase_b_features`) as “features_only” runs in `deal_phase_b_runs` during `analyze_deal`.
  - Evidence: [apps/worker/src/index.ts](apps/worker/src/index.ts#L1555-L1671) and [infra/migrations/2026-01-08-001-add-deal-phase-b-runs.sql](infra/migrations/2026-01-08-001-add-deal-phase-b-runs.sql#L1-L20)
- Exposes Phase B runs via the deal API payload (`phase_b.latest_run`, `phase_b.history` and also under `phase1.*`).
  - Evidence: [apps/api/src/routes/deals.ts](apps/api/src/routes/deals.ts#L3350-L3607) and [apps/api/src/routes/deals.ts](apps/api/src/routes/deals.ts#L1586-L1712)
- Exposes per-document Phase B outputs via `GET /api/v1/deals/:deal_id/documents/:document_id/visual-assets`, including latest extraction and evidence-link counts.
  - Evidence: [apps/api/src/routes/documents.ts](apps/api/src/routes/documents.ts#L248-L460)

**Facts (what Phase B does not produce)**

- Does not write any rows into the Phase 1 `evidence` table from the visual pipeline.
  - Evidence: `persistVisionResponse(...)` inserts `evidence_links` only: [apps/worker/src/lib/visual-extraction.ts](apps/worker/src/lib/visual-extraction.ts#L438-L513)
- Does not produce `evidence_id` values that are consumed by `score_breakdown_v1` / `phase1_score_evidence` (those are built from Phase 1 claim evidence IDs + `evidence` rows).
  - Evidence: breakdown evidence IDs derived from claims: [apps/api/src/routes/deals.ts](apps/api/src/routes/deals.ts#L680-L790) and evidence fetch reads `evidence` table only: [apps/api/src/routes/deals.ts](apps/api/src/routes/deals.ts#L1006-L1075)

**Facts (what the analyzer/scoring currently consumes)**

- `analyze_deal` consumes Phase B only as aggregated counts (via `fetchPhaseBVisualsFromDb`) and persists `phase_b_features` as a run.
  - Evidence: [apps/worker/src/index.ts](apps/worker/src/index.ts#L1555-L1671) and [apps/worker/src/lib/phaseb/extract.ts](apps/worker/src/lib/phaseb/extract.ts#L40-L155)
- Scoring evidence (`phase1_score_evidence`) and `score_breakdown_v1` are constructed from Phase 1 DIO claims/coverage/accountability and `evidence` rows.
  - Evidence: `buildScoreBreakdownV1(...)`: [apps/api/src/routes/deals.ts](apps/api/src/routes/deals.ts#L589-L1010); evidence payload build: [apps/api/src/routes/deals.ts](apps/api/src/routes/deals.ts#L3570-L3665)

**Facts (what is explicitly ignored)**

- `score_breakdown_v1` / `score_trace_audit_v1` do not read `visual_assets`, `visual_extractions.structured_json`, or `evidence_links`.
  - Evidence: scoring/trace code path is entirely claim/evidence-id-based: [apps/api/src/routes/deals.ts](apps/api/src/routes/deals.ts#L589-L1075)
- The Evidence UI panel uses `score_breakdown_v1` evidence ID arrays and `phase1_score_evidence` (backed by `evidence`), not visual lane references.
  - Evidence: [apps/web/src/components/evidence/EvidencePanel.tsx](apps/web/src/components/evidence/EvidencePanel.tsx#L255-L420)

---

## 2) Intent vs Accident Classification

This classifies each gap as **Intentional**, **Accidental**, or **Legacy Drift**, with citations.

### Gap A — Phase B is “features-only” inside `analyze_deal` (diagnostic summaries)

- Classification: **Intentional**
- Why: The code comment explicitly labels the Phase B persistence in `analyze_deal` as “diagnostic-only persistence (fail-open)”, and the persisted run status is set to `features_only`.
- Where:
  - Phase B block in analysis job: [apps/worker/src/index.ts](apps/worker/src/index.ts#L1555-L1671)
  - Feature extraction function: [apps/worker/src/lib/phaseb/extract.ts](apps/worker/src/lib/phaseb/extract.ts#L157-L282)

### Gap B — Visual lane evidence is stored in `evidence_links`, not `evidence`

- Classification: **Intentional** (for the visual lane itself)
- Why: The visual lane migration defines a distinct table `evidence_links` with a docstring describing it as “Generic evidence pointers … for traceability and analyst mode” and does not mention integration with Phase 1 scoring.
- Where:
  - Schema intent: [infra/migrations/2026-01-05-001-add-visual-extraction-lane.sql](infra/migrations/2026-01-05-001-add-visual-extraction-lane.sql#L118-L173)
  - Write path: [apps/worker/src/lib/visual-extraction.ts](apps/worker/src/lib/visual-extraction.ts#L438-L513)

### Gap C — Scoring/evidence pipeline ignores `evidence_links` and visual JSON

- Classification: **Legacy Drift**
- Why: The Phase B lane (migrations dated 2026-01-05 / 2026-01-08) introduces new storage surfaces (`evidence_links`, `deal_phase_b_runs`) while the scoring/evidence builder continues to rely solely on Phase 1 claim evidence IDs + the `evidence` table. There is no bridging logic between the two lifecycles.
- Where:
  - Phase B lane introduced: [infra/migrations/2026-01-05-001-add-visual-extraction-lane.sql](infra/migrations/2026-01-05-001-add-visual-extraction-lane.sql#L1-L173) and [infra/migrations/2026-01-08-001-add-deal-phase-b-runs.sql](infra/migrations/2026-01-08-001-add-deal-phase-b-runs.sql#L1-L20)
  - Score breakdown + trace audit derive evidence linkage from claim evidence IDs: [apps/api/src/routes/deals.ts](apps/api/src/routes/deals.ts#L680-L905)
  - Evidence fetch is from `evidence` only: [apps/api/src/routes/deals.ts](apps/api/src/routes/deals.ts#L1006-L1075)

### Gap D — Phase B coverage depends on page images and has PDF-only fallback

- Classification: **Intentional** (documented behavior), with an **Accidental** outcome for non-PDF parity
- Why:
  - Intentional: The `extract_visuals` worker is explicitly built around page image URIs and a PDF-only recovery path.
  - Accidental outcome: Non-PDF documents (pptx/docx/xlsx/images) have no evidenced fallback rendering path in `extract_visuals`, so Phase B success depends on whether rendered pages already exist.
- Where:
  - Page image requirement + per-doc skip: [apps/worker/src/index.ts](apps/worker/src/index.ts#L1158-L1319)
  - PDF-only fallback gating: [apps/worker/src/index.ts](apps/worker/src/index.ts#L1201-L1224)

---

## 3) Visual Data Semantics Assessment (Strict)

This classifies what visuals *can* provide, and what is available today via existing pipelines. Where a specific semantic (e.g., “cap table detected”) is mentioned, it is treated as **not confirmed** unless a downstream schema contract or key is evidenced in the audit.

### Financial tables (revenue, burn, CAC/LTV tables)

- Already implicitly used via text: **Sometimes**, when Phase 1 extraction/OCR captures those numbers into `full_text` or canonical metrics.
  - Evidence: Phase 1 doc pipeline uses `full_text` and canonical extraction for analyzers: [apps/worker/src/index.ts](apps/worker/src/index.ts#L1476-L1548)
- Partially available in Phase B JSON: **Yes** as `visual_extractions.structured_json` and OCR text, but not consumed downstream.
  - Evidence: schema column: [infra/migrations/2026-01-05-001-add-visual-extraction-lane.sql](infra/migrations/2026-01-05-001-add-visual-extraction-lane.sql#L72-L117); write path: [apps/worker/src/lib/visual-extraction.ts](apps/worker/src/lib/visual-extraction.ts#L420-L477)
- Completely unavailable today: **No** (it exists in storage, but is unused by scoring).

### Charts (traction graphs, revenue over time)

- Already implicitly used via text: **Sometimes**, when surrounding slide text or OCR’d annotations are present in Phase 1 text.
  - Evidence: Phase 1 analyzers receive `full_text` when present: [apps/worker/src/index.ts](apps/worker/src/index.ts#L1521-L1548)
- Partially available in Phase B JSON: **Yes** as stored `structured_json` and `evidence_links` refs, but unused for claims/scoring.
  - Evidence: storage + ref keys written: [apps/worker/src/lib/visual-extraction.ts](apps/worker/src/lib/visual-extraction.ts#L513-L548)
- Completely unavailable today: **No** (exists but not integrated).

### Unit economics (CAC/LTV, gross margin bridges)

- Already implicitly used via text: **Sometimes**, if included in canonical metrics or text extraction.
  - Evidence: analyzers get `canonical.financials.canonical_metrics`: [apps/worker/src/index.ts](apps/worker/src/index.ts#L1492-L1520)
- Partially available in Phase B JSON: **Unknown as a semantic** (the system stores generic `structured_json`, but no downstream schema contract defines unit economics keys).
  - Evidence: generic JSON store only: [infra/migrations/2026-01-05-001-add-visual-extraction-lane.sql](infra/migrations/2026-01-05-001-add-visual-extraction-lane.sql#L72-L117)
- Completely unavailable today: **Yes for scoring/evidence** (no consumption path).

### Org charts

- Already implicitly used via text: **Sometimes** (names/titles may appear as text).
- Partially available in Phase B JSON: **Potentially** (Phase B stores generic OCR + `structured_json`, but no org-chart-specific schema contract is evidenced).
  - Evidence: generic JSON store exists: [infra/migrations/2026-01-05-001-add-visual-extraction-lane.sql](infra/migrations/2026-01-05-001-add-visual-extraction-lane.sql#L72-L117)
- Completely unavailable today: **Yes for scoring/evidence** (no consumption path).

### Cap tables

- Already implicitly used via text: **Sometimes** (if Phase 1 extraction captures it as text).
- Partially available in Phase B JSON: **Potentially** (Phase B stores generic OCR + `structured_json`, but no cap-table-specific schema contract is evidenced).
  - Evidence: generic JSON store exists: [infra/migrations/2026-01-05-001-add-visual-extraction-lane.sql](infra/migrations/2026-01-05-001-add-visual-extraction-lane.sql#L72-L117)
- Completely unavailable today: **Yes for scoring/evidence** (no consumption path).

---

## 4) Minimal Analyzer Touchpoints

These are the smallest viable integration “hooks” (design only) where Phase B outputs could influence analysis, without re-architecting.

### Touchpoint 1 — Evidence materialization boundary (Phase B → Phase 1 evidence model)

- File/function: `persistVisionResponse(...)` in [apps/worker/src/lib/visual-extraction.ts](apps/worker/src/lib/visual-extraction.ts#L470-L569)
- Input expected: Vision response assets (OCR text + `structured_json`) already available at persistence time.
- Output effect (minimum viable): produce score-visible evidence by aligning visual evidence lifecycle with the existing `evidence` table lifecycle.
- Why minimum: This leverages existing downstream plumbing (`getEvidenceByIds` → `phase1_score_evidence` → `EvidencePanel`) without changing score breakdown semantics.
  - Existing evidence consumer path: [apps/api/src/routes/deals.ts](apps/api/src/routes/deals.ts#L3570-L3665) and [apps/web/src/components/evidence/EvidencePanel.tsx](apps/web/src/components/evidence/EvidencePanel.tsx#L255-L420)

### Touchpoint 2 — Score evidence assembly boundary (deal GET)

- File/function: deal GET handler constructs evidence payload via `collectEvidenceIdsFromClaims(...)` and `getEvidenceByIds(...)` in [apps/api/src/routes/deals.ts](apps/api/src/routes/deals.ts#L1006-L1075) and [apps/api/src/routes/deals.ts](apps/api/src/routes/deals.ts#L3570-L3665)
- Input expected: evidence IDs to fetch + a row fetcher.
- Output effect (minimum viable): include additional evidence IDs representing Phase B-derived evidence in the existing evidence payload.
- Why minimum: The API is already the convergence point that produces the canonical evidence payload used by UI and trace audit.

### Touchpoint 3 — Trace audit coverage computation boundary

- File/function: `buildScoreBreakdownV1(...)` computes `evidence_count_total`, `evidence_count_linked`, `trace_audit_v1`, mismatch flags in [apps/api/src/routes/deals.ts](apps/api/src/routes/deals.ts#L820-L1005)
- Input expected: section-level evidence ID sets.
- Output effect (minimum viable): increase trace coverage for sections where evidence exists but was previously invisible (visual-only evidence).
- Why minimum: It improves “measurable incorporation” (trace coverage/mismatch) without changing the core scoring model.

### Touchpoint 4 — Phase B eligibility + diagnostics boundary

- File/function: `registerWorker("extract_visuals", ...)` in [apps/worker/src/index.ts](apps/worker/src/index.ts#L1048-L1370)
- Input expected: deal documents + page image URIs.
- Output effect (minimum viable): prevent silent partial skips from being invisible by defining a single eligibility rule and emitting structured diagnostics consistently.
- Why minimum: This improves correctness/observability for multi-doc/multi-type without changing analyzers.

---

## 5) Evidence System Compatibility Check

### Can Phase B outputs be converted into `evidence` rows?

- Structural compatibility: **Yes**, because Phase B already has:
  - `document_id`, `page_index`, `snippet` (OCR text), and structured JSON per asset.
  - Evidence: `evidence_links` insert includes doc/page/snippet/ref: [apps/worker/src/lib/visual-extraction.ts](apps/worker/src/lib/visual-extraction.ts#L438-L513)

### Can Phase B outputs be linked to existing claims?

- Lifecycle mismatch today: **Not directly**, because claim evidence linkage is based on `evidence_id` values that refer to rows in `evidence`, and Phase B produces `evidence_links.id` (separate table).
  - Evidence: evidence IDs extracted from claims: [apps/api/src/routes/deals.ts](apps/api/src/routes/deals.ts#L977-L1005) and evidence fetch is `evidence`-only: [apps/api/src/routes/deals.ts](apps/api/src/routes/deals.ts#L1006-L1075)

### Can Phase B outputs be surfaced in `score_breakdown_v1`?

- Not as-is: **No**, because `score_breakdown_v1` only counts/records evidence IDs derived from claims and evidence samples; it does not read `evidence_links`.
  - Evidence: [apps/api/src/routes/deals.ts](apps/api/src/routes/deals.ts#L680-L905)

### What mismatch prevents compatibility (fact)

- **Schema + lifecycle mismatch**:
  - Schema: score evidence fetch and payload are built from `evidence` rows; Phase B produces `evidence_links` rows.
  - Lifecycle: claim objects carry evidence IDs referencing `evidence`, not `evidence_links`.
  - Evidence: `evidence_links` schema: [infra/migrations/2026-01-05-001-add-visual-extraction-lane.sql](infra/migrations/2026-01-05-001-add-visual-extraction-lane.sql#L118-L173) and evidence fetch path: [apps/api/src/routes/deals.ts](apps/api/src/routes/deals.ts#L1006-L1075)

---

## 6) Multi-Document & File-Type Normalization Strategy (Rules Only)

### Single normalization rule (multi-document inclusion)

- Rule: **All Phase 1 “eligible” documents must be considered eligible inputs for Phase B metrics and evidence, and Phase B must explicitly record per-document eligibility outcomes (processed vs skipped + reason).**
- Grounding:
  - Phase 1 eligibility filter exists: [apps/worker/src/index.ts](apps/worker/src/index.ts#L1436-L1450)
  - Phase B processes a list of documents but can skip per-doc when images missing: [apps/worker/src/index.ts](apps/worker/src/index.ts#L1158-L1319)

### Single normalization rule (file-type eligibility)

- Rule: **Eligibility for Phase B is “has resolvable page images”; if not resolvable, the system must not silently skip—record a typed reason and include it in Phase B run features/diagnostics.**
- How it avoids the observed issues:
  - Avoids silent skips: skipped docs become explicit run outputs.
  - Avoids first-document bias: all eligible docs are evaluated with the same rule.
  - Avoids PDF-only dependency: PDF-only fallback becomes an optimization, not a dependency; the primary rule is based on page image resolvability and explicit reporting.
- Grounding:
  - Current PDF-only fallback: [apps/worker/src/index.ts](apps/worker/src/index.ts#L1201-L1224)
  - Current “fail only if none processed” behavior: [apps/worker/src/index.ts](apps/worker/src/index.ts#L1320-L1370)

---

## 7) Risk Matrix If Left Unfixed (Confirmed Gaps Only)

| Gap | Impact on Score | Impact on Trust | Likelihood | Severity |
|----|------------------|----------------|-----------|----------|
| Visual lane evidence (`evidence_links`) not consumed by scoring/evidence (`evidence`) | Visual-only facts cannot raise trace coverage or support claims | High: users see “visuals exist” but score trace ignores them | High | P0 |
| Phase B treated as “features_only” diagnostics | No measurable scoring impact from visuals | Medium: Phase B metrics look “detached” | High | P1 |
| Page-image dependency + PDF-only fallback | Non-PDF visual extraction may be incomplete or absent | High: inconsistent coverage by file type | High | P1 |
| Partial skips only fail when zero docs processed | Some docs may be ignored without user awareness | High: undermines multi-doc correctness | Medium | P1 |

Evidence grounding for these gaps:
- Evidence vs evidence_links split: [apps/worker/src/lib/visual-extraction.ts](apps/worker/src/lib/visual-extraction.ts#L438-L513) and [apps/api/src/routes/deals.ts](apps/api/src/routes/deals.ts#L1006-L1075)
- “features_only” persistence: [apps/worker/src/index.ts](apps/worker/src/index.ts#L1555-L1671)
- Page images + PDF-only fallback: [apps/worker/src/index.ts](apps/worker/src/index.ts#L1158-L1319)
- Fail only if none processed: [apps/worker/src/index.ts](apps/worker/src/index.ts#L1320-L1370)

---

## 8) Acceptance Criteria for “Phase B Integrated” (Testable Without UI Changes)

These criteria are designed to be verifiable via API responses and DB state.

### Evidence incorporation

- A deal with Phase B visuals persisted produces at least one score-visible evidence entry associated with a document/page (verifiable via deal GET evidence payload / evidence fetch path).
  - Convergence point today: evidence payload is built in deal GET: [apps/api/src/routes/deals.ts](apps/api/src/routes/deals.ts#L3570-L3665)

### Trace audit measurability

- After Phase B integration, `score_breakdown_v1.trace_audit_v1.sections_with_trace` increases when visuals exist but Phase 1 claims had insufficient linked evidence.
  - Trace audit computation location: [apps/api/src/routes/deals.ts](apps/api/src/routes/deals.ts#L905-L974)

### Multi-document consistency

- When a deal has N eligible documents (Phase 1 filter), Phase B reporting includes an explicit processed/skipped outcome for each eligible document (no silent partial skips).
  - Phase 1 eligibility definition: [apps/worker/src/index.ts](apps/worker/src/index.ts#L1436-L1450)
  - Current Phase B per-doc skip behavior: [apps/worker/src/index.ts](apps/worker/src/index.ts#L1158-L1319)

### File-type parity (observability)

- For non-PDF documents, Phase B runs must explicitly report “missing page images” (or equivalent typed reason) rather than only failing when all docs are skipped.
  - Current failure threshold: [apps/worker/src/index.ts](apps/worker/src/index.ts#L1320-L1370)

### No regression on existing Phase 1 evidence flow

- Existing Phase 1 claim evidence resolution continues to function: deal GET still produces `phase1_score_evidence` from `evidence` rows referenced by claims.
  - Existing construction path: [apps/api/src/routes/deals.ts](apps/api/src/routes/deals.ts#L3570-L3665)

---

## Recommendations (Minimal, Component-Level)

These are minimal remediation points, not implementations.

- Align Phase B evidence lifecycle with the existing `evidence` lifecycle at one of the two convergence points:
  - Phase B persistence boundary (worker) or
  - Deal GET evidence assembly boundary (API)
  - Grounding: current split is at [apps/worker/src/lib/visual-extraction.ts](apps/worker/src/lib/visual-extraction.ts#L438-L513) vs [apps/api/src/routes/deals.ts](apps/api/src/routes/deals.ts#L1006-L1075)
- Make Phase B multi-doc outcomes measurable by recording per-document processed/skipped reasons in the persisted Phase B run payload.
  - Grounding: current behavior only errors if zero docs processed: [apps/worker/src/index.ts](apps/worker/src/index.ts#L1320-L1370)
