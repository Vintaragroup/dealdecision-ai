-- scripts/intelligence/inspect-deal.sql
--
-- All intelligence layer artifacts for a single deal.
-- Usage:
--   psql $DATABASE_URL -v deal_id="'<uuid>'" -f inspect-deal.sql
--
-- Example:
--   psql $DATABASE_URL -v deal_id="'af2edc64-0000-0000-0000-000000000000'" -f inspect-deal.sql

\echo '──────────────────────────────────────────────────────'
\echo 'INTELLIGENCE LAYER — DEAL INSPECTION'
\echo '──────────────────────────────────────────────────────'
\echo ''
\echo '1. Decision Memory'
\echo ''

SELECT
  id,
  upstream_fingerprint,
  verdict,
  ors_score, dci_score, fhc_score, urss_score,
  arr,
  burn_rate,
  runway_months,
  evidence_count,
  financial_completeness_pct,
  updated_at
FROM public.deal_decision_memory
WHERE deal_id = :deal_id
ORDER BY updated_at DESC;

\echo ''
\echo '2. Evaluation Flags'
\echo ''

SELECT
  intelligence_run_id,
  severity,
  flag_type,
  source_stage,
  impacted_score,
  description,
  resolution_status,
  created_at
FROM public.deal_evaluation_flags
WHERE deal_id = :deal_id
ORDER BY
  CASE severity
    WHEN 'critical' THEN 1
    WHEN 'error'    THEN 2
    WHEN 'warn'     THEN 3
    WHEN 'info'     THEN 4
    ELSE 5
  END,
  created_at DESC;

\echo ''
\echo '3. Confidence Assessments'
\echo ''

SELECT
  intelligence_run_id,
  overall_confidence_score,
  overall_confidence_band,
  jsonb_array_length(penalties_applied) AS penalty_count,
  jsonb_array_length(conclusions)       AS conclusion_count,
  left(rationale, 120)                  AS rationale_preview,
  created_at
FROM public.deal_confidence_assessments
WHERE deal_id = :deal_id
ORDER BY created_at DESC;

\echo ''
\echo '4. Challenge-Pass Results'
\echo ''

SELECT
  intelligence_run_id,
  verdict_resistance_score,
  verdict_resistance_label,
  flag_count_critical,
  flag_count_error,
  flag_count_warn,
  jsonb_array_length(overconfident_claims) AS overconfident_count,
  jsonb_array_length(missing_evidence)     AS missing_evidence_count,
  jsonb_array_length(diligence_gaps)       AS diligence_gaps_count,
  left(opposing_case_summary, 120)         AS case_preview,
  created_at
FROM public.deal_challenge_pass_results
WHERE deal_id = :deal_id
ORDER BY created_at DESC;
