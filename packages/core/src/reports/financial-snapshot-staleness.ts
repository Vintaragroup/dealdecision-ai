/**
 * financial-snapshot-staleness.ts
 *
 * Pure deterministic function for detecting when a compiled financial report
 * snapshot (financial_breakdown_v1, underwriting_readiness_v1) is stale
 * relative to the financial_facts_v1 data that exists in the database.
 *
 * Stale means: facts were extracted AFTER the report was compiled, so the
 * compiled breakdown did not have access to those facts.
 *
 * Rule: stale = max(financial_facts_v1.created_at) > ingestion_reports.created_at
 *
 * No DB access — callers supply the timestamps. Never throws.
 */

export type FinancialSnapshotStalenessResult = {
  /** True when financial facts are newer than the compiled report snapshot. */
  stale: boolean;
  /** ISO timestamp of the newest financial fact, or null when no facts exist. */
  max_fact_ts: string | null;
  /** ISO timestamp of the compiled report (ingestion_reports.created_at). */
  report_ts: string;
};

/**
 * Determines whether the compiled financial snapshot is stale.
 *
 * @param maxFactCreatedAt - The max created_at of financial_facts_v1 for the deal,
 *   or null when no facts exist.
 * @param reportCreatedAt - The created_at of the ingestion_reports row (compile time).
 */
export function detectFinancialSnapshotStaleness(input: {
  maxFactCreatedAt: Date | null;
  reportCreatedAt: Date;
}): FinancialSnapshotStalenessResult {
  const { maxFactCreatedAt, reportCreatedAt } = input;
  const report_ts = reportCreatedAt.toISOString();

  if (!maxFactCreatedAt) {
    return { stale: false, max_fact_ts: null, report_ts };
  }

  return {
    stale: maxFactCreatedAt > reportCreatedAt,
    max_fact_ts: maxFactCreatedAt.toISOString(),
    report_ts,
  };
}
