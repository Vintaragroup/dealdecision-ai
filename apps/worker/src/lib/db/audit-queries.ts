/**
 * audit-queries.ts
 *
 * Single-query-per-deal DB helpers for the Investor Insights audit runner.
 * All queries are read-only SELECT statements.
 *
 * The main query returns three JSON aggregates in one round-trip:
 *   1. documents   — deal's documents (non-deleted, ordered by uploaded_at)
 *   2. dpu_pages   — document_page_understanding rows (ordered by document_id, page_index)
 *   3. report      — most recent investor_insight_reports row
 */

import type { Pool } from "pg";

// ── Row shapes returned by Postgres ──────────────────────────────────────────

export interface AuditDocumentRow {
	id: string;
	title: string;
	type: string;
	mime_type: string | null;
	page_count: number | null;
	status: string;
	uploaded_at: string;
}

export interface AuditDpuRow {
	document_id: string;
	page_index: number;
	/** Raw page_text extracted from payload jsonb field. null when absent. */
	page_text: string | null;
	version: string;
	updated_at: string;
}

export interface AuditReportRow {
	status: string;
	engine_version: string;
	upstream_fingerprint: string;
	render_package: unknown;
	gate_state: unknown;
	updated_at: string;
}

export interface AuditDealQueryResult {
	documents: AuditDocumentRow[] | null;
	dpu_pages: AuditDpuRow[] | null;
	report: AuditReportRow | null;
}

// ── Single-query implementation ───────────────────────────────────────────────

/**
 * AUDIT_QUERY_SQL
 *
 * Returns (documents, dpu_pages, report) in a single round-trip per deal.
 * All sub-queries use stable ORDER BY clauses so results are deterministic.
 */
export const AUDIT_QUERY_SQL = `
WITH docs AS (
  SELECT
    id::text            AS id,
    title,
    type,
    mime_type,
    page_count,
    status,
    uploaded_at::text   AS uploaded_at
  FROM public.documents
  WHERE deal_id = $1::uuid
    AND deleted_at IS NULL
  ORDER BY uploaded_at ASC, id ASC
),
dpu AS (
  SELECT
    document_id::text   AS document_id,
    page_index,
    payload->>'page_text' AS page_text,
    version,
    updated_at::text    AS updated_at
  FROM public.document_page_understanding
  WHERE deal_id = $1::uuid
  ORDER BY document_id ASC, page_index ASC
  LIMIT 1000
),
latest_report AS (
  SELECT
    status,
    engine_version,
    upstream_fingerprint,
    render_package,
    gate_state,
    updated_at::text    AS updated_at
  FROM public.investor_insight_reports
  WHERE deal_id = $1::uuid
  ORDER BY updated_at DESC
  LIMIT 1
)
SELECT
  (SELECT json_agg(docs) FROM docs)                          AS documents,
  (SELECT json_agg(dpu)  FROM dpu)                           AS dpu_pages,
  (SELECT row_to_json(lr) FROM latest_report lr)             AS report;
`;

/**
 * fetchAuditDataForDeal
 *
 * Runs the one-shot audit query for a single deal.
 * Returns null JSON fields when there are no rows (deal not found or no data).
 * Throws if the query itself fails.
 */
export async function fetchAuditDataForDeal(
	pool: Pool,
	dealId: string
): Promise<AuditDealQueryResult> {
	const { rows } = await pool.query<{
		documents: AuditDocumentRow[] | null;
		dpu_pages: AuditDpuRow[] | null;
		report: AuditReportRow | null;
	}>(AUDIT_QUERY_SQL, [dealId]);

	const row = rows[0];
	if (!row) {
		// This should never happen with a well-formed SQL, but be safe.
		return { documents: null, dpu_pages: null, report: null };
	}
	return row;
}
