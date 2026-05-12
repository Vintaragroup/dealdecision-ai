-- scripts/intelligence/health-check.sql
--
-- Quick health check: counts and most-recent activity per intelligence table.
-- Run this to confirm Stage 5 is writing data to all 4 tables.
--
-- Usage:
--   psql $DATABASE_URL -f health-check.sql

\echo '──────────────────────────────────────────────────────'
\echo 'INTELLIGENCE LAYER — HEALTH CHECK'
\echo '──────────────────────────────────────────────────────'
\echo ''
\echo 'Row counts and most recent activity:'
\echo ''

SELECT 'deal_decision_memory'     AS table_name,
       COUNT(*)                   AS total_rows,
       MAX(updated_at)            AS most_recent
FROM public.deal_decision_memory

UNION ALL

SELECT 'deal_evaluation_flags',
       COUNT(*),
       MAX(created_at)
FROM public.deal_evaluation_flags

UNION ALL

SELECT 'deal_confidence_assessments',
       COUNT(*),
       MAX(created_at)
FROM public.deal_confidence_assessments

UNION ALL

SELECT 'deal_challenge_pass_results',
       COUNT(*),
       MAX(created_at)
FROM public.deal_challenge_pass_results;

\echo ''
\echo 'Verdict distribution (decision memory):'
\echo ''

SELECT
  verdict,
  COUNT(*) AS count,
  ROUND(AVG(ors_score))     AS avg_ors,
  ROUND(AVG(dci_score))     AS avg_dci,
  ROUND(AVG(evidence_count))AS avg_evidence
FROM public.deal_decision_memory
GROUP BY verdict
ORDER BY count DESC;

\echo ''
\echo 'Confidence band distribution:'
\echo ''

SELECT
  overall_confidence_band,
  COUNT(*) AS count,
  ROUND(AVG(overall_confidence_score)) AS avg_score
FROM public.deal_confidence_assessments
GROUP BY overall_confidence_band
ORDER BY avg_score DESC;

\echo ''
\echo 'Flag severity distribution (all time):'
\echo ''

SELECT
  severity,
  COUNT(*) AS count
FROM public.deal_evaluation_flags
GROUP BY severity
ORDER BY
  CASE severity
    WHEN 'critical' THEN 1
    WHEN 'error'    THEN 2
    WHEN 'warn'     THEN 3
    WHEN 'info'     THEN 4
    ELSE 5
  END;
