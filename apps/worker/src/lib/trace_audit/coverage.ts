type TraceCoverage = {
	has_documents_structured: boolean;
	has_evidence_rows: boolean;
	has_orchestrator_inputs: boolean;
	has_analyzer_results: boolean;
	has_ui_payloads: boolean;
	documents_count: number;
	evidence_rows_count: number;
};

function unwrapPayload(v: unknown): unknown {
	return (v as any)?.payload ?? v;
}

function countArray(v: unknown): number {
	return Array.isArray(v) ? v.length : 0;
}

export function computeTraceCoverageFromArtifacts(params: {
	documents_structured?: unknown;
	evidence_rows?: unknown;
	orchestrator_inputs?: unknown;
	analyzer_results?: unknown;
	ui_payloads?: unknown;
}): TraceCoverage {
	const docs = unwrapPayload(params.documents_structured);
	const ev = unwrapPayload(params.evidence_rows);
	const oi = unwrapPayload(params.orchestrator_inputs);
	const ar = unwrapPayload(params.analyzer_results);
	const ui = unwrapPayload(params.ui_payloads);

	return {
		has_documents_structured: Array.isArray(docs),
		has_evidence_rows: Array.isArray(ev),
		has_orchestrator_inputs: oi != null,
		has_analyzer_results: ar != null,
		has_ui_payloads: ui != null,
		documents_count: countArray(docs),
		evidence_rows_count: countArray(ev),
	};
}
