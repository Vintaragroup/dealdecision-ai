# DealDecisionAI

DealDecisionAI is an internal investment analysis system designed to ingest company materials, extract structured and unstructured signals, and produce evidence-backed deal evaluations.  
The system prioritizes traceability, determinism, and auditability over black-box scoring.

This repository contains the core analysis engine, worker pipelines, and supporting UI used to evaluate investment opportunities.

---

## System Intent

DealDecisionAI is built around a few non-negotiable principles:

- **Evidence-first analysis**  
  All scores, recommendations, and claims must be traceable to underlying evidence or explicitly marked as missing or inferred.

- **Fail-open by design**  
  Partial data, missing documents, or incomplete extraction should never block analysis. The system returns the best possible result with diagnostics instead of failing hard.

- **Backend-authoritative decisions**  
  Scores, coverage, mismatch flags, and trace audits are computed server-side. The UI renders results but does not infer or recompute them.

- **Deterministic before generative**  
  Heuristics and rules drive analysis. Language models are used for synthesis and summarization, not primary decision-making.

---

## High-Level Architecture

At a conceptual level, the system consists of four major components:

- **API**  
  Serves deal data, analysis outputs, evidence resolution, and diagnostics. Acts as the source of truth for scoring and trace audits.

- **Worker**  
  Executes ingestion, extraction, and analysis jobs asynchronously. This includes Phase 1 (textual analysis) and Phase B (visual analysis).

- **Web UI**  
  Renders deal workspaces, evidence panels, score breakdowns, and trace diagnostics. The UI reflects backend state without re-deriving logic.

- **Data Stores**  
  Persist documents, extracted text, visual assets, evidence records, and analysis runs. Visuals and evidence are typically joined through documents.

This repository intentionally omits deployment, infrastructure, and environment-specific details.

---

## Analysis Phases (Conceptual)

### Phase 1 — Core Analysis

Phase 1 performs the initial deal evaluation using extracted text and structured artifacts.

Typical outputs include:

- Executive summaries (structured + narrative)
- Coverage and completeness signals
- Claims with linked evidence (when available)
- Business archetype classification
- Deterministic score and recommendation

Phase 1 results are always available and form the baseline for the deal workspace.

### Phase B — Visual Analysis (Additive)

Phase B processes visual artifacts derived from documents (e.g., page images, charts, tables).

Key characteristics:

- Visuals are discovered via the document → visual_asset join path
- Extracted outputs are stored as flexible JSON
- Phase B is **diagnostic and additive**, not required for a valid deal evaluation
- Missing visuals or partial extraction must not invalidate Phase 1 results

---

## Scoring & Evidence Contract

The system enforces a strict separation between **scoring**, **evidence**, and **presentation**:

- Scores and recommendations originate from backend analyzers
- Each score section may be supported, weak, or missing
- Evidence IDs reference persisted evidence rows linked to documents
- Synthetic or placeholder IDs are never counted as real evidence
- Trace audits summarize coverage, mismatches, and gaps using backend metadata only

The UI must not infer:

- score changes
- mismatch status
- evidence sufficiency

For details, see:

- `docs/Active/scoring-and-evidence.md`

---

## Documentation Governance

Documentation in this repository is intentionally curated.

### Tiers

- **docs/Active/**  
  Canonical, human-readable documents that reflect the current system behavior and invariants.

- **docs/Archive/**  
  Historical or superseded documents retained for reference. Archived files are explicitly renamed with `.ARCHIVED.md` to prevent accidental reuse.

- **docs/Quarantine/**  
  Unclassified, legacy, or incoming documents pending review. Files in this tier are not considered authoritative.

Most documentation is intentionally ignored by Git to prevent drift and sprawl. Only curated text documents are tracked.

---

## What This Repository Does *Not* Contain

This repository intentionally excludes:

- Installation instructions
- Environment configuration
- Deployment or infrastructure guides
- Secrets or credentials
- Production operational playbooks

Those details are handled separately and are not part of the codebase contract.

---

## Curated References

- **Scoring & Evidence Model**  
  `docs/Active/scoring-and-evidence.md`

- **Debugging Runbook**  
  `docs/Active/runbook-debugging.md`

---

## Design Direction (Non-Binding)

DealDecisionAI is evolving toward a fully traceable, evidence-anchored investment analysis system where every surfaced conclusion can be explained, audited, and challenged.

The intended end state emphasizes:

- **End-to-end traceability**  
  All scores, claims, and recommendations should be explainable through persisted inputs, evidence records, and deterministic rules.

- **Section-level accountability**  
  Investment decisions are decomposed into discrete sections (e.g., market, product, traction, team, terms, risks), each with an explicit support status rather than a single opaque score.

- **Multi-modal analysis as additive signal**  
  Textual, structured, and visual artifacts are treated as complementary inputs. Visual analysis is intended to enrich — not replace — textual analysis.

- **Evidence as a shared primitive**  
  Evidence is modeled independently of analyzers so it can be reused across scoring, reporting, and review workflows.

- **Fail-open analysis with explicit diagnostics**  
  Incomplete or missing data should result in transparent gaps and warnings rather than silent degradation or blocked execution.

This section describes architectural intent, not delivery guarantees.  
Specific implementations may evolve, but these principles are expected to remain stable.

---

## Status

This repository is under active development.  
Interfaces and internal structures may evolve, but the principles documented here are considered stable.