import type { Pool } from "pg";
import { reconcileArrMrrKpisV1, type ArrMrrKpiClaimV1, type ArrMrrKpiReconciliationV1 } from "@dealdecision/core";

function normalizeText(s: unknown): string {
	return String(s ?? "").replace(/\s+/g, " ").trim();
}

function parseMoneyLoose(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	const s = normalizeText(value);
	if (!s) return null;

	// Prefer the first money-ish number in the string.
	// Handles: "$1.2M", "1.2M", "1,200,000", "50k".
	const m = s.replace(/,/g, "").match(/\$?\s*(-?\d+(?:\.\d+)?)\s*(k|m|b|thousand|million|billion)?\b/i);
	if (!m) return null;
	const base = Number.parseFloat(m[1]);
	if (!Number.isFinite(base)) return null;
	const mag = String(m[2] || "").toLowerCase();
	const mult =
		mag === "k" || mag === "thousand"
			? 1_000
			: mag === "m" || mag === "million"
				? 1_000_000
				: mag === "b" || mag === "billion"
					? 1_000_000_000
					: 1;
	return base * mult;
}

function metricToken(s: string): "ARR" | "MRR" | null {
	const t = s.toLowerCase();
	if (/\barr\b|annual\s+recurring\s+revenue/.test(t)) return "ARR";
	if (/\bmrr\b|monthly\s+recurring\s+revenue/.test(t)) return "MRR";
	return null;
}

function isArrMrrCandidate(label: string, context: string, valueRaw: string): boolean {
	const combined = `${label} ${context} ${valueRaw}`;
	return metricToken(combined) != null;
}

export async function buildPhase1KpiReconciliationV1(params: {
	pool: Pool;
	dealId: string;
	documents: Array<{ document_id: string; type?: string | null }>;
	nowIso: string;
}): Promise<{ reconciliation: ArrMrrKpiReconciliationV1; claims: ArrMrrKpiClaimV1[] }> {
	const pitchDeckDocIds = params.documents
		.filter((d) => (d?.type ?? null) === "pitch_deck")
		.map((d) => String(d.document_id))
		.filter((id) => id && id.trim().length > 0);

	if (pitchDeckDocIds.length === 0) {
		return {
			reconciliation: reconcileArrMrrKpisV1({ generated_at: params.nowIso, claims: [] }),
			claims: [],
		};
	}

	type DpuRow = {
		document_id: string;
		page_index: number;
		payload: any;
	};

	const res = await params.pool.query<DpuRow>(
		`SELECT document_id::text as document_id,
		        page_index,
		        payload
		   FROM document_page_understanding
		  WHERE deal_id = $1::uuid
		    AND version = 'page_understanding_v1'
		    AND document_id = ANY($2::uuid[])
		  ORDER BY document_id ASC, page_index ASC`,
		[params.dealId, pitchDeckDocIds]
	);

	const rows = Array.isArray(res.rows) ? res.rows : [];
	const claims: ArrMrrKpiClaimV1[] = [];

	for (const row of rows) {
		const payload = row?.payload && typeof row.payload === "object" ? row.payload : null;
		const keyMetrics = Array.isArray(payload?.key_metrics) ? (payload.key_metrics as any[]) : [];

		for (let i = 0; i < keyMetrics.length; i++) {
			const km = keyMetrics[i];
			if (!km || typeof km !== "object") continue;

			const label = normalizeText((km as any).label);
			const context = normalizeText((km as any).context);
			const valueRaw = normalizeText((km as any).value);
			if (!valueRaw) continue;
			if (!isArrMrrCandidate(label, context, valueRaw)) continue;

			const value = parseMoneyLoose(valueRaw);
			if (value == null) continue;

			const metric = metricToken(`${label} ${context} ${valueRaw}`);
			if (!metric) continue;

			const conf = typeof (km as any).conf === "number" && Number.isFinite((km as any).conf) ? (km as any).conf : undefined;

			claims.push({
				claim_id: `dpu:${row.document_id}:p${row.page_index}:km${i}`,
				metric,
				value,
				label: label || undefined,
				context: context || undefined,
				document_id: row.document_id,
				page: row.page_index + 1,
				confidence: conf,
			});
		}
	}

	const reconciliation = reconcileArrMrrKpisV1({ generated_at: params.nowIso, claims });
	return { reconciliation, claims };
}
