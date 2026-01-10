# Scoring and Evidence Traceability

This document describes how DealDecisionAI represents deals, scoring outputs,
evidence traceability, and Phase B (visual) diagnostics.

## Definitions

- **Deal**: The canonical investment opportunity record. A deal is the unit the
  API/UI typically routes around (e.g., deal list, deal detail).
- **DIO (Deal Intelligence Object)**: The analysis aggregate for a deal. It
  stores analyzer outputs across phases/versions/runs and is treated as the
  “analysis snapshot” the UI renders.
- **Evidence**: A traceable reference supporting a claim or score. Evidence ties
  back to a specific document (and optionally a page), plus a snippet/value.
- **Document**: An uploaded source item (pitch deck, PDF, spreadsheet, etc.)
  with extracted text, derived artifacts, and metadata.
- **Visual Asset**: A derived visual item (page image, embedded image,
  chart/table render, etc.) that can be analyzed by Phase B.
- **Phase B Run**: A visual analysis execution pass (often chart/table
  detection + feature extraction) that yields per-asset outputs and diagnostics.
  Runs may be partial and are expected to be fail-open.

## Phase 1 scoring outputs

### What Phase 1 produces

Phase 1 is responsible for producing structured “first pass” outputs that can
be rendered without requiring follow-on phases.

Common Phase 1 artifacts in the DIO include:

- **Executive summary (v1/v2)**: Human-readable summary plus structured
  subfields.
- **Coverage / completeness**: Section-level coverage signals
  (present/partial/missing) used to communicate what’s supported.
- **Claims**: A set of extracted claims, each optionally linked to evidence.
- **Business archetype (v1)**: Deterministic archetype classification
  (e.g., `saas`, `consumer_product`) derived from available text.
- **Deal overview (v2)** and other Phase 1 report slices.

### What is / isn’t implemented (practical expectations)

- Implemented: deterministic scoring/coverage slices that can be persisted and
  rendered; top-level summary fields for quick UI display.
- Implemented: evidence IDs referenced from claims and/or evidence tables when
  available.
- Not guaranteed: perfect coverage completeness for all sections on every
  ingest; Phase 1 should prefer returning partial outputs over failing.
- Not guaranteed: stable or meaningful “percentages” for scoring subcomponents
  unless the upstream schema explicitly defines them; avoid UI logic that
  depends on fragile intermediate percentages.

## Evidence traceability rules

### Core rules

- Evidence should be traceable back to a **document** (and ideally a page).
- Claims may contain **inline evidence** (objects) and/or **evidence IDs**.
- Traceability is treated as a **linking problem**: the UI/API should be able
  to resolve evidence references into human-friendly citations (document title,
  page, snippet).

### Trace mode semantics

“Trace mode” is the expectation that any surfaced score/claim can be explained with:

1. The originating **rule/heuristic/analyzer** (what produced it)
2. The **inputs used** (documents/claims/evidence IDs)
3. The **evidence links** (citations)

Practical behavior:

- If evidence IDs exist, downstream layers should attempt to resolve them. If
  they cannot, the system should **fail open** and return the best available
  partial view (with warnings) rather than hard error.
- When evidence exists but is not linked (or linking is incomplete), the UI
  should display the score/claim but mark it as **weak/partial** and surface
  “missing trace” warnings.

## Phase B diagnostics (visual pipeline)

### Database join reality

Phase B (visuals) is commonly stored and queried through a join chain that is anchored on **documents**.

Operationally, the visuals lane should assume:

- Visual assets and visual extractions relate to a **document_id** (and sometimes page).
- A deal’s visuals are discovered by: **deal → documents → visual_assets → visual_extractions (and links)**.

This is an intentional “DB reality” detail: if you try to join visuals directly to deal IDs, you may miss data depending on schema/version.

### Feature schema expectations

Phase B outputs often include per-asset “features” payloads (e.g., chart/table
detection, structural attributes, extracted values).

Expectations:

- Features are stored as flexible JSON (schema may evolve).
- Consumers should treat unknown keys as forward-compatible.
- Consumers should focus on stable fields: `kind/type`, `confidence`,
  references back to the asset/document/page, and any extracted text/value.

### Fail-open philosophy

Phase B is designed to be resilient:

- Missing tables, missing joins, or missing per-asset outputs should not break read APIs.
- Endpoints should return whatever is available (deal + docs + warnings) when
  the visual lane cannot be fully computed.

## API exposure expectations and UI mapping

### API expectations

- Deal list / deal detail should provide enough Phase 1 fields to render:
  - Summary
  - Coverage/unknowns
  - A small “top claims” slice
  - Optional evidence traces when present
- When evidence is large, APIs should provide:
  - IDs + counts + samples rather than full blobs
  - A separate path to resolve evidence IDs into full citation objects

### UI mapping expectations

- UI should treat Phase 1 outputs as the primary “always available” story.
- UI should treat Phase B as an additive lane:
  - render charts/tables when present
  - show diagnostics/warnings when absent

## Quick operational checklist

Use this checklist when something “looks wrong” in scoring/trace:

- Confirm a deal has documents (deal → documents).
- Confirm DIO exists and has Phase 1 slices (summary/coverage/claims).
- Confirm claims have evidence IDs or inline evidence.
- If trace is missing:
  - check if evidence rows exist
  - check if IDs referenced by claims exist in the evidence table
- If visuals are missing:
  - verify the join path via documents (see Phase B diagnostics)

## Roadmap (near-term)

- Expand deterministic fallbacks for archetype and other Phase 1
  classifications when only partial artifacts exist.
- Improve trace coverage audit outputs so mismatches are easier to interpret.
- Stabilize and document Phase B feature keys that the UI can depend on.
- Provide a single “resolve evidence IDs” API for UI convenience.
