-- scripts/intelligence/recent-runs.sql
--
-- Recent intelligence runs with per-deal summary across all 4 tables.
-- Shows the last N distinct (deal_id, intelligence_run_id) pairs.
--
-- Usage:
--   psql $DATABASE_URL -f recent-runs.sql
--   psql $DATABASE_URL -v limit=20 -f recent-runs.sql

\echo '──────────────────────────────────────────────────────'
\echo 'INTELLIGENCE LAYER — RECENT RUNS'
\echo '──────────────────────────────────────────────────────'
\echo ''

WITH recent_conf AS (
  SELECT
    deal_id,
    intelligence_run_id,
    overall_confidence_score,
    overall_confidence_band,
    created_at
  FROM public.deal_confidence_assessments
  ORDER BY created_at DESC
  LIMIT COALESCE(:limit, 25)
),
mem AS (
  SELECT deal_id, verdict, ors_score, dci_score, fhc_score, urss_score,
         arr, burn_rate, runway_months, evidence_count, updated_at
  FROM public.deal_decision_memory
),
flags_agg AS (
  SELECT
    deal_id,
    intelligence_run_id,
    COUNT(*) FILTER (WHERE severity = 'critical') AS critical_count,
    COUNT(*) FILTER (WHERE severity = 'error')    AS error_count,
    COUNT(*) FILTER (WHERE severity = 'warn')     AS warn_count,
    COUNT(*)                                       AS total_flags
  FROM public.deal_evaluation_flags
  GROUP BY deal_id, intelligence_run_id
),
chal AS (
  SELECT
    deal_id,
    intelligence_run_id,
    verdict_resistance_score,
    verdict_resistance_label
  FROM public.deal_challenge_pass_results
)
SELECT
  rc.created_at                   AS run_at,
  rc.deal_id,
  rc.intelligence_run_id          AS run_id,
  m.verdict,
  m.ors_score, m.dci_score,
  rc.overall_confidence_score     AS conf_score,
  rc.overall_confidence_band      AS conf_band,
  ch.verdict_resistance_score     AS resist_score,
  ch.verdict_resistance_label     AS resist_label,
  fa.critical_count               AS flags_crit,
  fa.error_count                  AS flags_err,
  fa.warn_count                   AS flags_warn,
  m.arr,
  m.burn_rate,
  m.runway_months,
  m.evidence_count
FROM recent_conf rc
LEFT JOIN mem m
  ON m.deal_id = rc.deal_id
LEFT JOIN flags_agg fa
  ON fa.deal_id = rc.deal_id
 AND fa.intelligence_run_id = rc.intelligence_run_id
LEFT JOIN chal ch
  ON ch.deal_id = rc.deal_id
 AND ch.intelligence_run_id = rc.intelligence_run_id
ORDER BY rc.created_at DESC;
