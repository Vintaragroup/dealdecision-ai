# Manifest Update Policy

This policy governs changes to `evaluation/financial_Audit/results/golden_manifest.json`.

---

## Why this policy exists

The manifest defines what the financial extraction pipeline is *supposed to produce* for each of the 10 golden files. It is the source of truth that the regression evaluator checks against.

If the manifest can be edited freely to match whatever the pipeline currently outputs, it stops being a regression gate and becomes a rubber stamp. This policy prevents that.

---

## Required for every manifest change

1. **Root cause statement** — what code change caused the expected output to change?
2. **Verification** — run the extraction and confirm the new output is correct:
   ```bash
   python3 evaluation/financial_Audit/run_audit.py
   python3 evaluation/financial_Audit/evaluate_regression.py
   ```
3. **Explanation in the PR** — describe why the new expected value is a better assertion than the old one.

---

## Legitimate manifest updates

These are changes that reflect a genuine improvement or expansion:

| Type | Example | Allowed? |
|------|---------|---------|
| New metric family correctly detected | `burn` added to `metric_families_required` for a file that now reliably produces it | ✅ Yes |
| `min_metric_tokens` raised | Extractor now produces more structured output from a previously sparse sheet | ✅ Yes |
| `has_projections` flipped to `true` | Period classifier now correctly identifies `Year N` labels | ✅ Yes |
| `is_real_estate` corrected | A misclassified file is now correctly identified as RE schema | ✅ Yes |
| New file added to the suite | File added with a new manifest entry | ✅ Yes |
| `expected_verdict` elevated from `PASS_WITH_WARNINGS` to `PASS` | A previously incomplete extraction is now fully correct | ✅ Yes |

---

## Not legitimate manifest updates

These are changes that hide regressions or weaken the gate:

| Type | Example | Allowed? |
|------|---------|---------|
| Removing a required family because detection broke | Deleting `revenue` from `metric_families_required` after a period-parser refactor broke extraction | ❌ No — fix the code |
| Lowering `min_metric_tokens` to match a regression | Changing `min_metric_tokens` from 25 to 5 without extraction improvement | ❌ No — fix the code |
| Changing `expected_verdict` from `PASS` to `PASS_WITH_WARNINGS` without justification | Demoting a file's verdict floor to avoid a regression flag | ❌ No — fix the code |
| Changing `must_not_regress_to` from `PASS_WITH_WARNINGS` to `FAIL` | Lowering the floor so a broken extraction doesn't trigger a failure | ❌ No — fix the code |
| Adding entries to `metric_families_forbidden` to suppress unexpected detections | Hiding unexpected RE signal promotion by forbidding a family | ❌ No — fix the schema guard instead |
| Removing `expected_warnings` entries | Removing an expected warning assertion because the warning stopped appearing after a logic change that broke classification | ❌ No — investigate the classification first |

---

## Process for updating the manifest

```
1. Make the code change that improves extraction or classification
2. Run: python3 evaluation/financial_Audit/run_audit.py
3. Run: python3 evaluation/financial_Audit/evaluate_regression.py
4. Inspect the delta in results/regression_check.md
5. If the change is correct, update golden_manifest.json
6. In your PR, include:
   - The file(s) changed in the manifest
   - The root cause of the expected-output change
   - The assertion(s) that were updated
   - Confirmation that evaluate_regression.py exits 0 after the manifest update
```

---

## Manifest versioning

The `_meta.version` field in `golden_manifest.json` is a human-readable version string. Increment it when:

- More than 2 files have their assertions changed in the same PR
- A new category is added
- A structural field (e.g., a new assertion type) is added

Minor single-file corrections do not require a version bump.

---

## Summary

> The manifest is a gate, not a mirror. Do not edit it to make the tests pass. Edit it only when the pipeline genuinely improved.
