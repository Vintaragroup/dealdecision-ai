export type ArrMrrMetric = "ARR" | "MRR";

export type ArrMrrKpiClaimV1 = {
	claim_id: string;
	metric: ArrMrrMetric;
	value: number;
	label?: string;
	context?: string;
	document_id?: string;
	page?: number;
	confidence?: number;
	// Optional hints (if upstream already knows these)
	scope_hint?: "company" | "use_case" | "unknown";
	timing_hint?: "actual" | "projection" | "unknown";
	total_hint?: boolean;
};

export type ArrMrrRejectedClaimV1 = {
	claim_id: string;
	reason: string;
};

export type ArrMrrKpiResolutionV1 = {
	metric: ArrMrrMetric;
	resolved: boolean;
	value?: number;
	source_claim_id?: string;
	rejected_claims: ArrMrrRejectedClaimV1[];
	conflict_reason?: string;
};

export type ArrMrrKpiReconciliationV1 = {
	version: "kpi_reconciliation_v1";
	generated_at: string;
	results: {
		ARR: ArrMrrKpiResolutionV1;
		MRR: ArrMrrKpiResolutionV1;
	};
};

function normalizeText(s: unknown): string {
	return String(s ?? "").replace(/\s+/g, " ").trim();
}

function detectMetricTypeFromText(s: string): ArrMrrMetric | null {
	const t = s.toLowerCase();
	if (/\barr\b|annual\s+recurring\s+revenue/.test(t)) return "ARR";
	if (/\bmrr\b|monthly\s+recurring\s+revenue/.test(t)) return "MRR";
	return null;
}

function detectTotalHint(label: string, context: string): boolean {
	const t = `${label} ${context}`.toLowerCase();
	return /\btotal\b|\boverall\b|\ball-?up\b|\bcompany-?wide\b/.test(t);
}

function detectScopeHint(label: string, context: string): "company" | "use_case" | "unknown" {
	const t = `${label} ${context}`.toLowerCase();
	if (/\buse\s*case\b|\bper\s+use\s*case\b|\bsegment\b|\bby\s+(product|plan|tier)\b|\bvertical\b/.test(t)) return "use_case";
	if (/\bcompany\b|\boverall\b|\btotal\b|\ball-?up\b|\bconsolidated\b/.test(t)) return "company";
	return "unknown";
}

function detectTimingHint(label: string, context: string): "actual" | "projection" | "unknown" {
	const t = `${label} ${context}`.toLowerCase();
	if (/\bproject(ed|ion)\b|\bforecast\b|\bplan\b|\btarget\b|\bpro\s*forma\b|\b\d{4}e\b/.test(t)) return "projection";
	if (/\bactuals?\b|\bto\s+date\b|\bttm\b|\blas\s+of\b|\bcurrent\b|\btrailing\b/.test(t)) return "actual";
	return "unknown";
}

function stableTieBreakKey(c: ArrMrrKpiClaimV1): string {
	const doc = c.document_id ? String(c.document_id) : "";
	const page = typeof c.page === "number" && Number.isFinite(c.page) ? c.page : 1e9;
	return `${doc}::${page}::${c.claim_id}`;
}

function precedenceVector(c: ArrMrrKpiClaimV1): {
	total: number;
	scope: number;
	timing: number;
	confidence: number;
} {
	const label = normalizeText(c.label);
	const context = normalizeText(c.context);
	const total = c.total_hint === true ? 1 : c.total_hint === false ? 0 : detectTotalHint(label, context) ? 1 : 0;

	const scopeHint = c.scope_hint ?? detectScopeHint(label, context);
	const scope = scopeHint === "company" ? 2 : scopeHint === "use_case" ? 1 : 0;

	const timingHint = c.timing_hint ?? detectTimingHint(label, context);
	const timing = timingHint === "actual" ? 2 : timingHint === "projection" ? 1 : 0;

	const confidence = typeof c.confidence === "number" && Number.isFinite(c.confidence) ? Math.max(0, Math.min(1, c.confidence)) : 0;
	return { total, scope, timing, confidence };
}

function dominates(a: ReturnType<typeof precedenceVector>, b: ReturnType<typeof precedenceVector>): boolean {
	// Lexicographic dominance per spec: Total > scope > timing. Confidence is tie-break only.
	if (a.total !== b.total) return a.total > b.total;
	if (a.scope !== b.scope) return a.scope > b.scope;
	if (a.timing !== b.timing) return a.timing > b.timing;
	if (a.confidence !== b.confidence) return a.confidence > b.confidence;
	return false;
}

function explainRejection(winner: ArrMrrKpiClaimV1, loser: ArrMrrKpiClaimV1): string {
	const w = precedenceVector(winner);
	const l = precedenceVector(loser);
	if (w.total > l.total) return "rejected: winner is Total";
	if (w.scope > l.scope) return "rejected: winner is company-level";
	if (w.timing > l.timing) return "rejected: winner is actuals";
	if (w.confidence > l.confidence) return "rejected: lower confidence";
	return "rejected: lower precedence";
}

function reconcileOneMetric(metric: ArrMrrMetric, claims: ArrMrrKpiClaimV1[]): ArrMrrKpiResolutionV1 {
	const candidates = claims.filter((c) => c.metric === metric);
	if (candidates.length === 0) {
		return {
			metric,
			resolved: false,
			rejected_claims: [],
			conflict_reason: "no_claims",
		};
	}

	// Deterministic ordering: highest precedence vector first, then stable tie-break.
	const ranked = candidates
		.slice()
		.sort((a, b) => {
			const va = precedenceVector(a);
			const vb = precedenceVector(b);
			if (vb.total !== va.total) return vb.total - va.total;
			if (vb.scope !== va.scope) return vb.scope - va.scope;
			if (vb.timing !== va.timing) return vb.timing - va.timing;
			if (vb.confidence !== va.confidence) return vb.confidence - va.confidence;
			return stableTieBreakKey(a).localeCompare(stableTieBreakKey(b));
		});

	const top = ranked[0];
	const topVec = precedenceVector(top);
	const topPeers = ranked.filter((c) => {
		const v = precedenceVector(c);
		return v.total === topVec.total && v.scope === topVec.scope && v.timing === topVec.timing && v.confidence === topVec.confidence;
	});

	const distinctTopValues = Array.from(new Set(topPeers.map((c) => c.value)));
	if (topPeers.length > 1 && distinctTopValues.length > 1) {
		return {
			metric,
			resolved: false,
			rejected_claims: [],
			conflict_reason: `conflict: top_precedence_tie (${topPeers
				.map((c) => `${c.claim_id}=${c.value}`)
				.join(", ")})`,
		};
	}

	// Winner is deterministic; everything else is rejected.
	const rejected: ArrMrrRejectedClaimV1[] = ranked
		.slice(1)
		.map((c) => ({ claim_id: c.claim_id, reason: explainRejection(top, c) }));

	return {
		metric,
		resolved: true,
		value: top.value,
		source_claim_id: top.claim_id,
		rejected_claims: rejected,
	};
}

export function reconcileArrMrrKpisV1(params: {
	generated_at: string;
	claims: ArrMrrKpiClaimV1[];
}): ArrMrrKpiReconciliationV1 {
	// Normalize metric assignment in case upstream passes mixed naming.
	const normalizedClaims: ArrMrrKpiClaimV1[] = params.claims
		.map((c) => {
			const metric = c.metric ?? detectMetricTypeFromText(`${c.label ?? ""} ${c.context ?? ""}`) ?? null;
			if (!metric) return null;
			return { ...c, metric };
		})
		.filter(Boolean) as ArrMrrKpiClaimV1[];

	return {
		version: "kpi_reconciliation_v1",
		generated_at: params.generated_at,
		results: {
			ARR: reconcileOneMetric("ARR", normalizedClaims),
			MRR: reconcileOneMetric("MRR", normalizedClaims),
		},
	};
}
