# Deal Understanding Regression Suite

Automated CI gate for the `/api/v1/deals/:dealId/understanding` endpoint.
Validates that the understanding pipeline returns semantically correct, complete, and hallucination-free output for 4 benchmark deals.

---

## Benchmark deals

| Name | Deal ID | Industry |
|------|---------|----------|
| Palm | `5c8c7d6e-c992-4be7-8b10-268eac36f663` | Consumer brand / golf apparel |
| Probility | `42be8b30-2b7d-45e0-ade0-99427a505c59` | AI / sports prediction analytics |
| Verse | `bcd59d33-7887-41cd-80b9-742bc5ba945a` | CPG / non-alcoholic beverages |
| ToxyScreen | `05042123-6c4f-4dcb-9131-a95fce3cd28c` | Medical device / lead detection |

These are live deals (`_synthetic: false`). The suite makes real API calls — a live API URL is required.

---

## Check layers

| Layer | ID | Purpose |
|-------|----|---------|
| L0 | `L0-SPEC` | Ground truth schema coherence (synthetic fixtures only) |
| L1 | `L1-FIDELITY` | Key facts present and semantically accurate |
| L2 | `L2-UNDERSTANDING` | Contextual interpretation correctness |
| L3 | `L3-USEFULNESS` | Investor-relevant signals present |
| L4 | `L4-HALLUCINATION` | Cross-business-type misclassification guards |
| L5 | `L5-COMPLETENESS` | Required fields populated |

**Current check counts** (target: all pass, zero fail):

| Deal | Understanding | Consistency | Hallucination | Completeness | Notes | Total |
|------|:---:|:---:|:---:|:---:|:---:|:---:|
| Palm | 5 | 1 | 3 | 13 | 5 | **27** |
| Probility | 5 | 1 | 3 | 13 | 5 | **27** |
| Verse | 5 | 1 | 3 | 13 | 5 | **27** |
| ToxyScreen | 5 | 1 | 3 | 13 | 4 | **26** |

---

## Required secrets / environment

| Variable | Where set | Purpose |
|----------|-----------|---------|
| `DEAL_UNDERSTANDING_API_BASE_URL` | GitHub Actions secret | Live API base URL (e.g. `https://api.example.com`) |
| `DEAL_UNDERSTANDING_BENCHMARK_AUTH_TOKEN` | GitHub Actions secret (optional) | Bearer token for authenticated requests |

The workflow also accepts `api_base_url` as a `workflow_dispatch` input to override the secret for a single run.

---

## Running locally

```bash
# From repo root — requires .venv with requests (or stdlib urllib)
export DEAL_UNDERSTANDING_API_BASE_URL=https://your-api.example.com

# Run all 4 benchmark deals and print markdown report to stdout
python3 evaluation/deal_understanding/scripts/validate_deal_understanding.py \
  --api "$DEAL_UNDERSTANDING_API_BASE_URL"

# Write markdown report to file + emit JSON summary artifact
python3 evaluation/deal_understanding/scripts/validate_deal_understanding.py \
  --api "$DEAL_UNDERSTANDING_API_BASE_URL" \
  --output /tmp/understanding-report.md \
  --summary-json /tmp/understanding-summary.json

# Run only one deal
python3 evaluation/deal_understanding/scripts/validate_deal_understanding.py \
  --api "$DEAL_UNDERSTANDING_API_BASE_URL" \
  --deal Palm

# Full harness (matches CI exactly)
DEAL_UNDERSTANDING_API_BASE_URL=... pnpm deal-understanding-regression
```

---

## CI workflow

**File:** `.github/workflows/deal-understanding-regression.yml`

**Triggers:**
- Pull requests touching `apps/api/**`, `apps/worker/**`, `packages/core/**`, `evaluation/deal_understanding/**`, or the workflow file itself
- Push to `main`
- Manual `workflow_dispatch` (with optional `api_base_url` override)

**Steps:**
1. Resolve API base URL (secret or `workflow_dispatch` input)
2. Install pnpm + Node + Python
3. **Preflight** — verify all 4 benchmark deals return HTTP 200 + populated `what_company_does`
4. Run regression gate (`pnpm deal-understanding-regression`)
5. Upload artifacts (`artifacts/deal-understanding-regression/**`)

Failures in the preflight step print named deal errors to stderr and exit 1 before the main gate runs, making misconfiguration immediately visible.

---

## Ground truth files

Located in `evaluation/deal_understanding/ground_truth/`:

```
Palm.json
Probility.json
Verse.json
ToxyScreen.json
```

Each file has the shape:
```json
{
  "_synthetic": false,
  "deal_name": "Palm",
  "deal_id": "...",
  "ground_truth": {
    "investor_relevance_notes": [...]
  },
  "validation": {
    "understanding_checks": [...],
    "consistency_checks": [...],
    "hallucination_checks": [...],
    "completeness_checks": [...]
  }
}
```

### Adding or updating checks

1. Edit the relevant `.json` file
2. Update the `pass:` threshold in `scripts/deal-understanding-regression.ts` → `REQUIRED_DEALS`
3. Run locally to confirm all checks pass
4. Open a PR — CI will validate the new thresholds

### Check types

| `check_type` | Fields required | Meaning |
|---|---|---|
| `not_empty` | `field` | Field must be non-null and non-empty string / array |
| `contains_any` | `field`, `expected_terms` | Field text must contain at least one term (case-insensitive) |
| `contains_all` | `field`, `expected_terms` | Field text must contain all terms |
| `must_not_contain` | `field`, `prohibited_patterns` | Field text must not contain any pattern |
| `min_words` | `field`, `min_words` | Field text word count ≥ threshold |
| `semantic_overlap` | `field`, `expected_terms`, `min_overlap_pct` | ≥ N% of expected terms found |
| `no_generic_phrases` | `field`, `prohibited_phrases` | Field must not use boilerplate phrases |

---

## Artifacts

After each CI run, artifacts are uploaded to:
```
artifacts/deal-understanding-regression/{timestamp}/
  validator-report.md          # Full markdown report per deal
  validator-summary.json       # JSON summary (pass/fail counts + failure detail per deal)
  validator.stdout.log
  validator.stderr.log
  regression-summary.json      # Harness-level summary (thresholds + pass/fail)
  understanding-payloads/
    Palm.json                  # Raw API response snapshot
    Probility.json
    Verse.json
    ToxyScreen.json
```

---

## Required-gate readiness checklist

Before promoting this workflow from "enabled, non-required" to a required CI gate, confirm all of the following:

- [ ] `DEAL_UNDERSTANDING_API_BASE_URL` secret is set in the target GitHub environment and points to a stable, always-on API
- [ ] `DEAL_UNDERSTANDING_BENCHMARK_AUTH_TOKEN` is configured if the API requires authentication
- [ ] All 4 benchmark deal IDs exist in the target environment (Palm, Probility, Verse, ToxyScreen)
- [ ] All 4 benchmark deals return a populated `understanding` payload (non-empty `what_company_does`)
- [ ] The preflight step passes cleanly on at least one `workflow_dispatch` run against the target API
- [ ] At least 2–3 full PR or manual runs have passed without flake (check run history before enabling)
- [ ] Artifacts upload successfully on both pass **and** fail runs (verify `if: always()` coverage)
- [ ] The workflow completes within the 20-minute timeout on a cold runner
- [ ] The CI summary step prints `ready_to_make_required: true` at the end of a passing run
