# Governed overlay `skipped_reason="no_evidence"` — root cause (deal 61ef36dd-391a-4a4e-b30b-1f5d1f19f91e)

## Executive summary
For this deal, `governed_ui_copy_v1` is skipped with `skipped_reason="no_evidence"` because **`display_facts_v1` cannot create any evidence IDs**.

The producer’s evidence-ID creation path succeeds only if it can:
1) fetch a DPU snippet (`public.document_page_understanding`, `version='page_understanding_v1'`), **and**
2) upsert a row into `public.evidence` using an `id` primary key column.

In the local DB backing this run, `public.evidence` does **not** have an `id` column (it has `evidence_id` instead). That makes `upsertDisplayFactEvidenceBestEffort()` return `null` for every candidate snippet, which makes `allEvidenceIds.size === 0`, which triggers the `no_evidence` cascade:

`display_facts_v1_quality.skipped_reason = "no_evidence"` → `governed_ui_copy_v1_quality.skipped_reason = "no_evidence"`.

## Observed runtime facts (this deal)
### API result
`GET /api/v1/deals/61ef36dd-391a-4a4e-b30b-1f5d1f19f91e/governed-llm-overview` returns:
- `display_facts_v1_quality.skipped_reason = "no_evidence"`
- `governed_ui_copy_v1_quality.skipped_reason = "no_evidence"`

### Sources presented to the overlay producer
`phase1.deal_overview_v2.sources` contains 2 promoted sources, both pointing at DPU pages in the same document:

```json
[
  {
    "note": "promoted raise_terms_v1 (dpu page_index=33)",
    "page_range": [34, 34],
    "document_id": "6af4720f-77fc-476e-acc5-b330c7e2fa2e"
  },
  {
    "note": "promoted business_model_v1 (dpu page_index=29)",
    "page_range": [30, 30],
    "document_id": "6af4720f-77fc-476e-acc5-b330c7e2fa2e"
  }
]
```

## The exact skip predicates (producer code)
### 1) Display facts: skip if no evidence IDs were created
From `apps/worker/src/lib/governed-llm-overlay.ts`:

```ts
  const allEvidenceIds = new Set<string>([
    ...productEvidence.map((e) => e.evidence_id),
    ...marketEvidence.map((e) => e.evidence_id),
    ...modelEvidence.map((e) => e.evidence_id),
    ...raiseEvidence.map((e) => e.evidence_id),
  ]);

  if (allEvidenceIds.size === 0) {
    const noEvidence: DisplayFactFieldV1 = { text: null, evidence_ids: [], evidence_basis: "no_evidence" };
    return {
      display_facts_v1: { ...all fields = noEvidence },
      quality: { ...qualityBase, ok: true, skipped_reason: "no_evidence" },
      deterministic_input,
    };
  }
```

### 2) Governed UI copy: fail-closed if there is no evidence anywhere
From `apps/worker/src/lib/governed-llm-overlay.ts`:

```ts
  const anyEvidence =
    basis.product_solution.evidence_ids.length > 0 ||
    basis.market_icp.evidence_ids.length > 0 ||
    basis.business_model.evidence_ids.length > 0 ||
    basis.raise_terms.evidence_ids.length > 0;

  if (!anyEvidence) {
    return {
      governed_ui_copy_v1: { ...all null/empty },
      quality: { ...qualityBase, ok: true, skipped_reason: "no_evidence" },
      deterministic_input,
    };
  }
```

## Evidence inputs inventory (what the producer expects)
This section enumerates the full input chain required to create at least one `evidence_id`.

### Input A — Sources array
- **Producer reads**: `phase1_deal_overview_v2.sources`
- **Compute location**: in the analysis pipeline that produces/promotes phase1 overview sources (includes “promoted … (dpu page_index=…)”).
- **Shape required by `coerceSourceArray()`**:
  - `document_id: string` (non-empty)
  - `page_range?: [number, number]` (both finite numbers)
  - `note?: string`
- **Non-empty definition**: at least 1 valid source survives coercion and `pickSourcesForField()`.

### Input B — DPU snippet (Document Page Understanding)
- **Producer reads**: `public.document_page_understanding`
- **Lookup key**: `(document_id, page_index, version='page_understanding_v1')`
- **Fields used (in priority order)**:
  1) `payload.normalized_text` (must clamp and be length ≥ 40)
  2) `payload.text_blocks.text_snippet` (length ≥ 30)
  3) `payload.page_text` (length ≥ 30)
  4) `payload.text_blocks.ocr_text` (no explicit minimum length check at the final return)
- **Non-empty definition**: `fetchDpuSnippet()` returns a non-null string.

### Input C — Evidence table write (authoritative evidence IDs)
- **Producer writes**: `public.evidence`
- **Hard gate in code** (`upsertDisplayFactEvidenceBestEffort()`):
  - `public.evidence` table exists
  - required columns exist: `id`, `deal_id`, `source`, `kind`, `text`
- **Non-empty definition**: at least one call returns an `evidence_id` (deterministic UUID) and is included in any field’s evidence list.

### What does *not* count as evidence for this producer
- `public.evidence_items` from `DocumentIntelligenceService.extractSignals()` does **not** satisfy `basis.<field>.evidence_ids`.
- The governed UI copy generator only checks **evidence IDs**, not the presence of sources or text.

## Deal-specific validation: where the chain breaks
### 1) Sources exist (pass)
The deal has 2 valid sources (see above).

### 2) DPU rows exist and have sufficient text (pass)
Direct DB inspection confirms both referenced pages exist in `public.document_page_understanding` for `version='page_understanding_v1'` and have ample text.

Observed payload text lengths (approx):
- `page_index=29`: `normalized_text` ≈ 1351 chars
- `page_index=33`: `normalized_text` ≈ 795 chars

This means `fetchDpuSnippet()` *should* return non-null for both pages.

### 3) Evidence upsert is blocked by schema mismatch (fail)
The producer requires an `id` column on `public.evidence`:

```ts
    const hasId = await hasColumn(pool, "evidence", "id");
    if (!hasId) return null;
```

But the local DB schema shows these columns on `public.evidence`:

```text
evidence_id, deal_id, source, kind, text, excerpt, created_at, document_id, visual_asset_id, confidence
```

There is **no `id` column**, so `upsertDisplayFactEvidenceBestEffort()` returns `null` immediately, even when the DPU snippet is present.

### Net effect
- `buildEvidenceForField()` finds sources and snippets, but cannot persist them → returns empty evidence arrays.
- `allEvidenceIds.size === 0` → `display_facts_v1_quality.skipped_reason = "no_evidence"`.
- `basis.*.evidence_ids` are all empty → `governed_ui_copy_v1_quality.skipped_reason = "no_evidence"`.

## Ranked hypotheses (grounded)
1) **Schema drift (confirmed): `public.evidence` uses `evidence_id` instead of `id`.**
   - This is sufficient to explain the behavior end-to-end.
2) DPU version mismatch or missing rows.
   - Not supported here: both rows exist with `version='page_understanding_v1'`.
3) Snippet too short after clamping/normalization.
   - Not supported here: normalized_text lengths are well above the minimums.

## Fix candidates (not applied; discovery-only)
1) **DB migration**: add/rename to ensure `public.evidence.id` exists (and is the conflict target).
   - Example direction: rename `evidence.evidence_id` → `evidence.id` (or add a new `id` column and backfill).
2) **Producer compatibility tweak**: allow `upsertDisplayFactEvidenceBestEffort()` to accept either `id` or `evidence_id`.
   - This is a code change; include only if the project intentionally supports both schemas.
3) **DB view/compat layer**: create a view exposing an `id` column mapped from `evidence_id`.

---

## Appendix: quick reproduction (local)
Assuming Postgres is exposed on `localhost:55433`:

- Confirm DPU pages exist:
  - query `document_page_understanding` for `document_id='6af4720f-77fc-476e-acc5-b330c7e2fa2e'` and `page_index IN (29,33)`.
- Confirm evidence schema mismatch:
  - query `information_schema.columns` for table `public.evidence` and verify column list does not include `id`.
