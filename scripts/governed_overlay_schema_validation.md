# Governed overlay schema validation (discovery-only)

Scope: confirm root cause of `skipped_reason="no_evidence"` for governed overlay generation by validating schema drift between the producer code and `public.evidence`.

Deal under test: `61ef36dd-391a-4a4e-b30b-1f5d1f19f91e`

## 1) Producer code inspection (apps/worker)

### 1.1 `upsertDisplayFactEvidenceBestEffort()` expects `public.evidence.id`

- Function: `upsertDisplayFactEvidenceBestEffort()` in [apps/worker/src/lib/governed-llm-overlay.ts](apps/worker/src/lib/governed-llm-overlay.ts#L895-L1015)
- Hard schema gate:
  - It checks `hasColumn(pool, "evidence", "id")` and returns `null` if missing.
  - See: [apps/worker/src/lib/governed-llm-overlay.ts](apps/worker/src/lib/governed-llm-overlay.ts#L917-L920)

- Insert path:
  - It builds `cols` starting with `"id"` and uses `ON CONFLICT (id)`.
  - See: [apps/worker/src/lib/governed-llm-overlay.ts](apps/worker/src/lib/governed-llm-overlay.ts#L946-L1004)

- RETURNING clause:
  - There is **no SQL `RETURNING`**. The function returns `evidenceId` only if the insert succeeds.
  - See: [apps/worker/src/lib/governed-llm-overlay.ts](apps/worker/src/lib/governed-llm-overlay.ts#L992-L1006)

### 1.2 Failure to find `id` results in `null` evidence IDs

- Breakpoint behavior:
  - If `id` is missing, this line causes an immediate `null` return:
    - `if (!hasId) return null;`
  - See: [apps/worker/src/lib/governed-llm-overlay.ts](apps/worker/src/lib/governed-llm-overlay.ts#L917-L920)

- Downstream:
  - `generateDisplayFactsV1BestEffort()` drops that evidence via `if (!evidence_id) continue;`.
  - See: [apps/worker/src/lib/governed-llm-overlay.ts](apps/worker/src/lib/governed-llm-overlay.ts#L1038-L1049)

### 1.3 `allEvidenceIds` computation and the `no_evidence` skip condition

- `allEvidenceIds` is computed strictly from the `evidence_id` values returned by `buildEvidenceForField()`.
- Exact break condition:

```ts
if (allEvidenceIds.size === 0) {
  ...
  quality: { ...qualityBase, ok: true, skipped_reason: "no_evidence" },
}
```

- See: [apps/worker/src/lib/governed-llm-overlay.ts](apps/worker/src/lib/governed-llm-overlay.ts#L1065-L1096)

### 1.4 Why this cascades to `governed_ui_copy_v1`

- `generateGovernedUiCopyV1BestEffort()` fail-closes if *all* `basis.<field>.evidence_ids` arrays are empty.
- Exact condition:

```ts
const anyEvidence =
  basis.product_solution.evidence_ids.length > 0 ||
  basis.market_icp.evidence_ids.length > 0 ||
  basis.business_model.evidence_ids.length > 0 ||
  basis.raise_terms.evidence_ids.length > 0;

if (!anyEvidence) {
  quality: { ...qualityBase, ok: true, skipped_reason: "no_evidence" }
}
```

- See: [apps/worker/src/lib/governed-llm-overlay.ts](apps/worker/src/lib/governed-llm-overlay.ts#L1351-L1388)

## 2) DB schema expectations (infra/migrations)

### 2.1 Canonical `public.evidence` primary key column is `evidence_id`

- Evidence table creation migration defines:
  - `evidence_id TEXT PRIMARY KEY`
- See: [infra/migrations/2025-12-16-002-add-evidence-table.sql](infra/migrations/2025-12-16-002-add-evidence-table.sql#L1-L19)

### 2.2 Subsequent evidence migrations extend the same table (no rename to `id`)

- Adds optional `document_id`:
  - [infra/migrations/2025-12-16-003-add-document-id-to-evidence.sql](infra/migrations/2025-12-16-003-add-document-id-to-evidence.sql#L1-L11)
- Adds optional `visual_asset_id`:
  - [infra/migrations/2026-01-15-001-add-visual-asset-id-to-evidence.sql](infra/migrations/2026-01-15-001-add-visual-asset-id-to-evidence.sql#L1-L11)
- Adds optional `confidence`:
  - [infra/migrations/2026-01-25-001-add-evidence-confidence.sql](infra/migrations/2026-01-25-001-add-evidence-confidence.sql#L1-L12)

None of these migrations introduce an `id` column for `public.evidence`.

### 2.3 Compatibility logic elsewhere (apps/api)

There is compatibility logic in the API layer that tolerates both `id` and `evidence_id`:
- The resolve endpoint selects `id` if present else `evidence_id`.
- See: [apps/api/src/routes/evidence.ts](apps/api/src/routes/evidence.ts#L103-L121)

This compatibility logic is **not present** in the governed overlay producer’s `upsertDisplayFactEvidenceBestEffort()`.

## 3) Structured validation report

### 3.1 Expected evidence column name (per producer code)
- **Expected PK column**: `id`
- Evidence insert uses: `INSERT INTO evidence (id, ...) ... ON CONFLICT (id)`
- Code reference: [apps/worker/src/lib/governed-llm-overlay.ts](apps/worker/src/lib/governed-llm-overlay.ts#L917-L1004)

### 3.2 Actual evidence column name (per canonical migrations)
- **Canonical PK column**: `evidence_id` (TEXT PRIMARY KEY)
- Migration reference: [infra/migrations/2025-12-16-002-add-evidence-table.sql](infra/migrations/2025-12-16-002-add-evidence-table.sql#L1-L19)

### 3.3 Mismatch? (YES/NO)
- **YES** — producer expects `id`, but migrations define `evidence_id`.

### 3.4 Exact functions/lines responsible
- Gate that fails if `id` is missing:
  - [apps/worker/src/lib/governed-llm-overlay.ts](apps/worker/src/lib/governed-llm-overlay.ts#L917-L920)
- Insert uses `id` + `ON CONFLICT (id)`:
  - [apps/worker/src/lib/governed-llm-overlay.ts](apps/worker/src/lib/governed-llm-overlay.ts#L946-L1004)
- Break condition for `no_evidence`:
  - [apps/worker/src/lib/governed-llm-overlay.ts](apps/worker/src/lib/governed-llm-overlay.ts#L1065-L1096)
- Governed UI copy fail-closed gate:
  - [apps/worker/src/lib/governed-llm-overlay.ts](apps/worker/src/lib/governed-llm-overlay.ts#L1351-L1388)

### 3.5 Is this 100% sufficient to explain empty `governed_ui_copy_v1`? (YES/NO)
- **YES**, assuming:
  - `public.evidence` exists (it does in this environment), and
  - it lacks an `id` column (canonical migrations say so), and
  - the producer is running against that schema.

Why: if the producer cannot insert any evidence rows, it cannot return any evidence IDs, making `allEvidenceIds.size === 0` and forcing `display_facts_v1` to skip with `no_evidence`, which then forces `governed_ui_copy_v1` to skip via the `anyEvidence` gate.

### 3.6 Secondary contributing factors (if any)
- DPU availability/snippet length could also cause `no_evidence` (because snippets are required before attempting evidence upsert), but in this deal’s case DPU rows and ample text exist, so it’s not needed to explain the outcome.
  - Snippet fetch logic: [apps/worker/src/lib/governed-llm-overlay.ts](apps/worker/src/lib/governed-llm-overlay.ts#L875-L899)

## Conclusion
- **Root cause confirmed**: schema drift / contract mismatch between governed overlay producer expecting `public.evidence.id` and the canonical DB schema defining `public.evidence.evidence_id`.
- This mismatch is sufficient to explain why `display_facts_v1` produces empty `evidence_ids` and why `governed_ui_copy_v1` is skipped with `skipped_reason="no_evidence"`.
