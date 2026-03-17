# DealDecisionAI — Clean-Room Evaluation Workflow

This directory contains the tooling to evaluate whether the current system
correctly extracts, classifies, and reconciles uploaded deal documents.

---

## Quick Start

```bash
# 1. Snapshot the current local DB (before any reset)
bash evaluation/scripts/db_snapshot.sh

# 2. Reset the local DB to a clean state
bash evaluation/scripts/db_reset.sh --confirm

# 3. Verify the DB is clean (zero deals)
bash evaluation/scripts/db_verify.sh

# ── Upload benchmark deals through the app ──
#    Visit http://localhost:4174 and upload 4-5 benchmark deals.
#    Wait for analysis to complete (monitor via the UI or worker logs).

# 4. Verify deals are present
bash evaluation/scripts/db_verify.sh

# 5. Generate audit docs for all deals
source .venv/bin/activate
python evaluation/scripts/generate_deal_audit.py --all --benchmark-summary

# 6. Review results
ls evaluation/reports/              # one directory per deal
cat evaluation/reports/benchmark_summary.md
```

---

## Workflow Steps

### Step 1 — Snapshot

```bash
bash evaluation/scripts/db_snapshot.sh
```

- Used before any reset to preserve the current DB state
- Output: `evaluation/db_snapshots/<TIMESTAMP>_snapshot.sql`
- Add `SNAPSHOT_LABEL=my-label` env var for a descriptive filename
- To restore: `docker exec -i dealdecision-dev-postgres-1 psql -U postgres dealdecision < evaluation/db_snapshots/<file>.sql`

### Step 2 — Reset

```bash
bash evaluation/scripts/db_reset.sh --confirm
```

Performs:
1. Auto-snapshot (pre-reset) unless `SKIP_SNAPSHOT=1`
2. Drops all public schema tables via Docker exec
3. Re-runs migrations (`pnpm db:migrate`)
4. Verifies clean state

**Safety guards:** only targets containers with "dev" in the name; requires `--confirm`.

### Step 3 — Verify

```bash
bash evaluation/scripts/db_verify.sh
```

Reports counts for:
- `deals`, `documents`, `jobs`
- `deal_facts_v1`, `financial_facts_v1`
- `governed_llm_overviews`, `ingestion_reports`, `investor_insight_reports`
- Full deal list if any exist

### Step 4 — Upload Benchmark Deals

1. Open `http://localhost:4174` (web dev server)
2. Upload 4–5 benchmark deals with representative source documents
3. Wait for analysis to complete
4. Re-run `db_verify.sh` to confirm deals appear

### Step 5 — Generate Audits

```bash
# Activate Python environment
source .venv/bin/activate

# All deals + benchmark summary
python evaluation/scripts/generate_deal_audit.py --all --benchmark-summary

# Single deal by name
python evaluation/scripts/generate_deal_audit.py --deal-name "WebMax"

# Single deal by ID
python evaluation/scripts/generate_deal_audit.py --deal-id <uuid>

# From a deal list JSON file
python evaluation/scripts/generate_deal_audit.py --deal-ids-file tmp/audit_deals.json
```

---

## Output Structure

```
evaluation/
  db_snapshots/
    <TIMESTAMP>_pre-reset.sql          ← auto-created on reset
    <TIMESTAMP>_snapshot.sql           ← manual snapshots
  reports/
    benchmark_summary.md               ← cross-deal summary
    <deal-slug>/
      deal_audit.md                    ← per-deal audit document
```

---

## Audit Document Sections

Each `deal_audit.md` contains:

| # | Section | Source |
|---|---------|--------|
| 1 | Deal Metadata | `deals` table |
| 2 | Source Artifacts Present | `documents` table |
| 3 | Extracted Deal Facts | `deal_facts_v1` table |
| 4 | Extracted Financial Facts | `financial_facts_v1` table |
| 5 | Fused Facts | `investor_insight_reports.report_payload.fused_facts` |
| 6 | Cross-Document Reconciliation | Derived from facts + fused facts |
| 7 | Contradiction Bundle | `report_payload.narrative_contradiction_bundle` |
| 8 | Structured Summary / Executive Summary | `governed_llm_overviews` + `report_payload.governed_summary_v1` + `render_package` |
| 9 | Evaluation View | Structured table for reviewer fill-in |
| 10 | Key Risks / Suspected Failures | Auto-derived signal flags |
| 11 | Product Profile / Semantic Understanding | `render_package` → `product_profile_v1` (primary) + fallback sources |
| 12 | Scoring Scaffold | Derived from all fact + understanding sources |

Section 11 uses a **multi-source priority chain** to populate 17 semantic slots:

| Priority | Source | Slots | Confidence |
|---|---|---|---|
| 1 | `product_profile_v1` (ProductProfileV1) | All 17 | 1.0 (high) |
| 2 | `governed_summary_v1` executive_summary | `company_description` | 0.4 (low) |
| 3 | `deal_facts_v1` typed rows | `target_customer`, `delivery_model`, `core_features`, `ai_claims_present` | 0.65–0.75 (medium) |
| 4 | Missing | Remaining slots | 0.0 |

Deals where the primary profile is absent but fallback populates ≥1 slot are marked **⟳ (false-zero recovered)** in the benchmark summary.

---

## Schema Quick Reference

```
deals                     — id, name, stage, created_at
documents                 — id, deal_id, title, type, status, verification_status
ingestion_reports         — report_id, deal_id, summary (jsonb)
deal_facts_v1             — fact_id, deal_id, type, label, value (jsonb), confidence
financial_facts_v1        — fact_id, deal_id, metric_key, period_label, value, source_kind, confidence, reconciliation_status
governed_llm_overviews    — id, deal_id, summary_text, claims (jsonb), disclosures (jsonb)
investor_insight_reports  — id, deal_id, status, render_package (jsonb), report_payload (jsonb)
  report_payload keys:
    .fused_facts                       → FusedFact[]
    .financial_facts_v1                → FinancialFactsV1 bridge object
    .governed_summary_v1               → GovernedSummaryRecord
    .narrative_contradiction_bundle    → contradiction bundle per topic
```

---

## DB Connection

Local dev database:

```
URL:  postgresql://postgres:postgres@localhost:55433/dealdecision
Host: localhost
Port: 55433 (mapped from dealdecision-dev-postgres-1 container port 5432)
User: postgres
Pass: postgres
DB:   dealdecision
```

Override with `DATABASE_URL` env var:
```bash
DATABASE_URL=postgresql://... python evaluation/scripts/generate_deal_audit.py --all
```

---

## Requirements

- Docker (postgres container must be running)
- Python 3.9+ with psycopg2 (`pip install psycopg2-binary`)
- Or activate project venv: `source .venv/bin/activate`
- `pnpm` (for `db:migrate` via `pnpm db:migrate`)

Check prerequisites:
```bash
docker inspect dealdecision-dev-postgres-1 --format '{{.State.Status}}'
source .venv/bin/activate && python -c "import psycopg2; print('psycopg2', psycopg2.__version__)"
```

---

## Remaining Manual Steps

After running the tooling:

1. **Open each `deal_audit.md`** in your editor
2. **Review Section 9 (Evaluation View)** — fill in the "Source Document Truth" column by reviewing the original uploaded documents
3. **Compare Section 3 (Deal Facts)** against source doc content
4. **Compare Section 4 (Financial Facts)** against workbook values
5. **Compare Section 5 (Fused Facts)** against what the UI displays
6. **Review Section 7 (Contradiction Bundle)** for accuracy of detected conflicts
7. **Fill in Notes column** in the Evaluation View table
8. **Review `benchmark_summary.md`** for systemic patterns across all deals
