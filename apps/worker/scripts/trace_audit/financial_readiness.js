/* eslint-disable no-console */

// Audit-only script: reads existing trace outputs + (optional) DB-backed evidence
// to assess whether financial signals exist, were extracted, materialized as evidence,
// and whether the Financial Health analyzer had sufficient prerequisites.
//
// Hard constraints: deterministic only; no scoring logic changes; no mutations.

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const { Client } = require("pg");

async function fileExists(p) {
	try {
		await fsp.access(p);
		return true;
	} catch {
		return false;
	}
}

async function findRepoRoot(startDir) {
	let dir = startDir;
	for (let i = 0; i < 20; i++) {
		const marker = path.join(dir, "pnpm-workspace.yaml");
		if (await fileExists(marker)) return dir;
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	throw new Error(`Could not locate repo root from ${startDir}`);
}

async function readJson(p) {
	const raw = await fsp.readFile(p, "utf8");
	return JSON.parse(raw);
}

function asArray(v) {
	return Array.isArray(v) ? v : [];
}

function norm(s) {
	return String(s || "")
		.toLowerCase()
		.replace(/\s+/g, " ")
		.trim();
}

const FINANCE_TERMS = [
	"cash",
	"burn",
	"runway",
	"revenue",
	"arr",
	"mrr",
	"expenses",
	"projections",
	"use of funds",
	"allocation of funds",
	"financials",
];

function includesFinanceTerms(text) {
	const t = norm(text);
	if (!t) return false;
	return FINANCE_TERMS.some((term) => t.includes(term));
}

function parseMoneyToNumberUSD(input) {
	// Deterministic best-effort parser. Returns a number in USD units.
	// Examples: "$5M" => 5000000, "2.5 million" => 2500000
	const s = norm(input);
	if (!s) return null;

	// Find first numeric token.
	const m = s.match(/\$?\s*(\d+(?:\.\d+)?)(?:\s*,\s*\d{3})*(?:\s*(k|m|mm|b|bn|thousand|million|billion))?/i);
	if (!m) return null;
	const num = Number(m[1]);
	if (!Number.isFinite(num)) return null;
	const unit = norm(m[2]);
	let mult = 1;
	if (unit === "k" || unit === "thousand") mult = 1e3;
	if (unit === "m" || unit === "mm" || unit === "million") mult = 1e6;
	if (unit === "b" || unit === "bn" || unit === "billion") mult = 1e9;
	return num * mult;
}

function parseMonths(input) {
	const s = norm(input);
	if (!s) return null;
	// Prefer explicit months.
	const m = s.match(/(\d+(?:\.\d+)?)\s*(months?|mos?)\b/);
	if (m) {
		const v = Number(m[1]);
		return Number.isFinite(v) ? v : null;
	}
	// Convert years to months when explicitly stated.
	const y = s.match(/(\d+(?:\.\d+)?)\s*(years?|yrs?)\b/);
	if (y) {
		const v = Number(y[1]);
		return Number.isFinite(v) ? v * 12 : null;
	}
	return null;
}

const SIGNALS = {
	cash_balance: {
		id: "cash_balance",
		label: "cash_balance",
		matchStructured: (key, value, context) => {
			const k = norm(key);
			const v = norm(value);
			const c = norm(context);
			return (
				k.includes("cash") ||
				k.includes("cash balance") ||
				k.includes("cash on hand") ||
				v.includes("cash") ||
				c.includes("cash")
			);
		},
		matchEvidenceText: (text) => {
			const t = norm(text);
			return t.includes("cash") && (t.includes("balance") || t.includes("on hand") || t.startsWith("cash"));
		},
	},
	burn_rate: {
		id: "burn_rate",
		label: "burn_rate",
		matchStructured: (key, value, context) => {
			const k = norm(key);
			const v = norm(value);
			const c = norm(context);
			return k.includes("burn") || k.includes("burn rate") || v.includes("burn") || c.includes("burn");
		},
		matchEvidenceText: (text) => {
			const t = norm(text);
			return t.includes("burn") && (t.includes("rate") || t.includes("monthly") || t.includes("per month"));
		},
	},
	runway_months: {
		id: "runway_months",
		label: "runway_months",
		matchStructured: (key, value, context) => {
			const k = norm(key);
			const v = norm(value);
			const c = norm(context);
			return k.includes("runway") || v.includes("runway") || c.includes("runway") || parseMonths(value) != null;
		},
		matchEvidenceText: (text) => {
			const t = norm(text);
			return t.includes("runway") || /\b(\d+(?:\.\d+)?)\s*(months?|mos?)\b/.test(t);
		},
	},
	revenue: {
		id: "revenue",
		label: "revenue",
		matchStructured: (key, value, context) => {
			const k = norm(key);
			const v = norm(value);
			const c = norm(context);
			return k.includes("revenue") || v.includes("revenue") || c.includes("revenue");
		},
		matchEvidenceText: (text) => {
			const t = norm(text);
			return t.includes("revenue");
		},
	},
	arr_mrr: {
		id: "arr_mrr",
		label: "arr_mrr",
		matchStructured: (key, value, context) => {
			const k = norm(key);
			const v = norm(value);
			const c = norm(context);
			return k.includes("arr") || k.includes("mrr") || v.includes("arr") || v.includes("mrr") || c.includes("arr") || c.includes("mrr");
		},
		matchEvidenceText: (text) => {
			const t = norm(text);
			return /\b(arr|mrr)\b/.test(t);
		},
	},
	projections: {
		id: "projections",
		label: "projections",
		matchStructured: (key, value, context) => {
			const k = norm(key);
			const v = norm(value);
			const c = norm(context);
			return (
				k.includes("projection") ||
				k.includes("forecast") ||
				v.includes("projection") ||
				v.includes("forecast") ||
				c.includes("projection") ||
				c.includes("forecast")
			);
		},
		matchEvidenceText: (text) => {
			const t = norm(text);
			return t.includes("projection") || t.includes("forecast") || t.includes("projections");
		},
	},
};

function classifyHasFinancialDocuments(doc, structured) {
	const contentType = norm(doc?.type || doc?.contentType);
	if (contentType === "excel" || contentType === "financials") return true;

	const title = norm(doc?.title || doc?.name || doc?.original_name || doc?.filename);
	if (includesFinanceTerms(title)) return true;

	const textSummary = norm(structured?.textSummary || structured?.text_summary || structured?.summary || structured?.text); // best-effort
	if (includesFinanceTerms(textSummary)) return true;

	const headings = asArray(structured?.mainHeadings);
	if (headings.some((h) => includesFinanceTerms(h))) return true;

	const keyMetrics = asArray(structured?.keyMetrics);
	for (const m of keyMetrics) {
		const k = norm(m?.key);
		const v = norm(m?.value);
		if (includesFinanceTerms(k) || includesFinanceTerms(v)) return true;
	}

	return false;
}

function extractFinancialHealthInputsFromOrchestrator(orchestratorPayload) {
	// `07_orchestrator_inputs.json` payload schema: { payload: [{ analyzer, input, insufficient_input, skip_reason }...] }
	const items = asArray(orchestratorPayload?.payload);
	const fh = items.find((i) => i?.analyzer === "financialHealth");
	const input = fh?.input && typeof fh.input === "object" ? fh.input : null;
	const extracted = input && Array.isArray(input.extracted_metrics) ? input.extracted_metrics : [];

	const extractedMetricNames = extracted
		.map((m) => (typeof m?.name === "string" ? m.name : null))
		.filter(Boolean)
		.map((s) => String(s));

	return {
		present: Boolean(fh),
		insufficient_input: Boolean(fh?.insufficient_input),
		skip_reason: typeof fh?.skip_reason === "string" ? fh.skip_reason : null,
		input_keys: input
			? Object.keys(input)
				.filter((k) => k !== "debug_scoring")
				.sort()
			: [],
		extracted_metrics_count: extracted.length,
		extracted_metric_names: extractedMetricNames.sort(),
	};
}

function computeFinancialHealthPrerequisitesFromOrchestrator({ orchestratorFh }) {
	// Mirrors FinancialHealthCalculator's decision points:
	// - insufficient_data when: no usable financial signals present
	// - health_score requires runway, computed from either:
	//   a) extracted runway metric name present (runway/runway_months)
	//   b) cash_balance present AND (burn_rate present OR expenses present as burn proxy)
	if (!orchestratorFh?.present) {
		return {
			core_signals_present: false,
			runway_computable: false,
			missing_prerequisites: ["financialHealth orchestrator input missing"],
		};
	}

	const inputKeys = new Set(orchestratorFh.input_keys || []);
	const names = (orchestratorFh.extracted_metric_names || []).map((n) => norm(n));

	const hasKey = (k) => inputKeys.has(k);
	const hasAnyName = (needles) => needles.some((n) => names.includes(norm(n)));

	const hasRevenue = hasKey("revenue") || hasAnyName(["revenue", "arr", "mrr"]);
	const hasExpenses = hasKey("expenses") || hasAnyName(["expenses", "opex", "operating_spend"]);
	const hasCash = hasKey("cash_balance") || hasAnyName(["cash_balance", "cash", "cash_on_hand"]);
	const hasBurn = hasKey("burn_rate") || hasAnyName(["burn_rate", "monthly_burn", "burn"]);
	const hasGrowth = hasKey("growth_rate") || hasAnyName(["growth_rate", "mom_growth"]);
	const hasRunway = hasKey("runway_months") || hasAnyName(["runway_months", "runway"]);

	const coreSignalsPresent = Boolean(hasRevenue || hasExpenses || hasCash || hasBurn || hasGrowth || hasRunway);
	const runwayComputable = Boolean(hasRunway || (hasCash && (hasBurn || hasExpenses)));

	const missing = [];
	if (!coreSignalsPresent) {
		missing.push(
			`no_financial_signals (input_keys=${JSON.stringify(orchestratorFh.input_keys || [])}; extracted_metric_names=${JSON.stringify(
				orchestratorFh.extracted_metric_names || []
			)})`
		);
	} else if (!runwayComputable) {
		missing.push("missing_runway (need cash_balance + burn_rate/expenses, or extracted runway metric name)");
	}

	return {
		core_signals_present: coreSignalsPresent,
		runway_computable: runwayComputable,
		missing_prerequisites: missing,
	};
}

function extractSignalsFromStructured({ documentsStructured }) {
	// documentsStructured: [{id, structured_data, type, title, ...}]
	const extracted = {
		cash_balance: false,
		burn_rate: false,
		runway_months: false,
		revenue: false,
		arr_mrr: false,
		projections: false,
	};

	const sources = {
		cash_balance: { document_ids: [], structured_paths: [] },
		burn_rate: { document_ids: [], structured_paths: [] },
		runway_months: { document_ids: [], structured_paths: [] },
		revenue: { document_ids: [], structured_paths: [] },
		arr_mrr: { document_ids: [], structured_paths: [] },
		projections: { document_ids: [], structured_paths: [] },
	};

	function mark(signal, docId, structuredPath) {
		if (!extracted[signal]) extracted[signal] = true;
		if (!sources[signal].document_ids.includes(docId)) sources[signal].document_ids.push(docId);
		sources[signal].structured_paths.push(structuredPath);
	}

	for (const doc of documentsStructured) {
		const docId = String(doc?.id || "");
		const structured = doc?.structured_data;
		if (!docId || !structured || typeof structured !== "object") continue;

		const keyMetrics = asArray(structured?.keyMetrics);
		for (let i = 0; i < keyMetrics.length; i++) {
			const m = keyMetrics[i];
			const key = m?.key;
			const value = m?.value;
			const context = m?.source;
			for (const sig of Object.keys(SIGNALS)) {
				if (SIGNALS[sig].matchStructured(key, value, context)) {
					mark(sig, docId, `structured_data.keyMetrics[${i}]`);
				}
			}
		}

		const headings = asArray(structured?.mainHeadings);
		for (let i = 0; i < headings.length; i++) {
			const h = headings[i];
			if (typeof h !== "string") continue;
			// Projections & use-of-funds terms are often headings.
			if (SIGNALS.projections.matchEvidenceText(h)) {
				mark("projections", docId, `structured_data.mainHeadings[${i}]`);
			}
			if (SIGNALS.runway_months.matchEvidenceText(h)) {
				mark("runway_months", docId, `structured_data.mainHeadings[${i}]`);
			}
		}

		const summary = typeof structured?.textSummary === "string" ? structured.textSummary : "";
		if (summary) {
			for (const sig of Object.keys(SIGNALS)) {
				if (SIGNALS[sig].matchEvidenceText(summary)) {
					mark(sig, docId, `structured_data.textSummary`);
				}
			}
		}
	}

	// Deduplicate/normalize
	for (const sig of Object.keys(sources)) {
		sources[sig].document_ids.sort();
	}

	return { extracted_financial_signals: extracted, extraction_sources: sources };
}

function materializeEvidenceSignals({ evidenceRows }) {
	const bySignal = {};
	for (const sig of Object.keys(SIGNALS)) {
		bySignal[sig] = { signal: sig, evidence_ids: [], sources: [] };
	}

	for (const row of evidenceRows) {
		const id = String(row?.id || "");
		const source = row?.source;
		const text = String(row?.text || "");
		for (const sig of Object.keys(SIGNALS)) {
			if (SIGNALS[sig].matchEvidenceText(text)) {
				if (id && !bySignal[sig].evidence_ids.includes(id)) bySignal[sig].evidence_ids.push(id);
				if (source && !bySignal[sig].sources.includes(source)) bySignal[sig].sources.push(source);
			}
		}
	}

	for (const sig of Object.keys(bySignal)) {
		bySignal[sig].evidence_ids.sort();
		bySignal[sig].sources.sort();
	}

	return Object.values(bySignal);
}

function extractAnalyzerFinancialHealthFromUi(uiPayload) {
	// Source of truth for analyzer result is the report metadata.
	const comp = uiPayload?.payload?.report?.metadata?.score_explanation?.components?.financial_health;
	const status = typeof comp?.status === "string" ? comp.status : null;
	// The UI currently stores financial health section as a text block; it may be N/A.
	const section = asArray(uiPayload?.payload?.report?.sections).find((s) => s?.id === "financial-health");
	const preview = section?.content?.preview;

	let healthScore = null;
	if (typeof preview === "string") {
		const m = preview.match(/Health Score:\s*(\d+(?:\.\d+)?)/i);
		if (m) {
			const v = Number(m[1]);
			healthScore = Number.isFinite(v) ? v : null;
		}
	}

	return {
		status: status === "ok" || status === "insufficient_data" ? status : "insufficient_data",
		health_score: healthScore,
		raw_component: comp ?? null,
		section_preview: typeof preview === "string" ? preview : null,
	};
}

function computeFinancialHealthPrerequisites({ extractedSignals, extractionSources, evidenceBySignal }) {
	const missing = [];

	const hasRunway = Boolean(extractedSignals.runway_months) || Boolean(evidenceBySignal.runway_months?.evidence_ids?.length);
	const hasCash = Boolean(extractedSignals.cash_balance) || Boolean(evidenceBySignal.cash_balance?.evidence_ids?.length);
	const hasBurn = Boolean(extractedSignals.burn_rate) || Boolean(evidenceBySignal.burn_rate?.evidence_ids?.length);

	if (!hasRunway && !(hasCash && hasBurn)) {
		if (!hasRunway) {
			missing.push(
				`runway_months missing (no structured match or evidence match; structured paths: ${JSON.stringify(
					extractionSources.runway_months?.structured_paths || []
				)})`
			);
		}
		if (!hasCash) {
			missing.push(
				`cash_balance missing (no structured match or evidence match; structured paths: ${JSON.stringify(
					extractionSources.cash_balance?.structured_paths || []
				)})`
			);
		}
		if (!hasBurn) {
			missing.push(
				`burn_rate missing (no structured match or evidence match; structured paths: ${JSON.stringify(
					extractionSources.burn_rate?.structured_paths || []
				)})`
			);
		}
	}

	return {
		missing_prerequisites: missing,
		// We do not attempt to compute runway in this audit because existing analyzers
		// are the canonical place for derived values; we only validate prerequisites.
		runway_months: null,
	};
}

async function connectDbIfPossible() {
	const connectionString = process.env.DATABASE_URL;
	if (!connectionString) return null;
	const client = new Client({ connectionString });
	await client.connect();
	return client;
}

async function fetchEvidenceRowsFromDb(client, dealId) {
	const { rows } = await client.query(
		`SELECT id, deal_id, document_id, source, kind, text
		   FROM evidence
		  WHERE deal_id = $1
		  ORDER BY created_at ASC`,
		[dealId]
	);
	return rows;
}

function buildExplanationBlock({ dealName, hasFinancialDocs, extractedSignals, evidenceGap, analyzerStatus, missingPrereqs }) {
	const signals = [];
	for (const [k, v] of Object.entries(extractedSignals)) {
		if (v) signals.push(k);
	}
	const signalsText = signals.length ? signals.join(", ") : "none";

	const parts = [];
	parts.push(`Deal: ${dealName}`);
	parts.push(`Financial documents present (heuristic): ${hasFinancialDocs ? "yes" : "no"}.`);
	parts.push(`Extracted financial signals: ${signalsText}.`);
	parts.push(`Evidence materialization gap: ${evidenceGap ? "yes" : "no"}.`);
	parts.push(
		`Financial Health analyzer status: ${analyzerStatus}. ${missingPrereqs.length ? `Missing prerequisites: ${missingPrereqs.join("; ")}.` : "Prerequisites satisfied."}`
	);

	return parts.join(" ");
}

async function main() {
	const repoRoot = await findRepoRoot(__dirname);
	const traceRoot = path.join(repoRoot, "docs", "trace");

	const dealDirs = (await fsp.readdir(traceRoot, { withFileTypes: true }))
		.filter((d) => d.isDirectory())
		.map((d) => d.name)
		.filter((n) => /^[0-9a-f-]{36}$/i.test(n))
		.sort();

	if (dealDirs.length === 0) throw new Error(`No deal trace folders found under ${traceRoot}`);

	const dbClient = await connectDbIfPossible().catch((err) => {
		console.warn(`[financial_readiness] DB disabled: ${err instanceof Error ? err.message : String(err)}`);
		return null;
	});

	const rollup = [];

	for (const dealId of dealDirs) {
		const latestPath = path.join(traceRoot, dealId, "latest.json");
		if (!(await fileExists(latestPath))) continue;
		const latest = await readJson(latestPath);
		const runId = latest.run_id;
		const runDir = path.join(traceRoot, dealId, runId);

		const uiPath = path.join(runDir, "10_ui_payloads.json");
		const structuredPath = path.join(runDir, "02_documents_structured.json");
		const evidencePath = path.join(runDir, "03_evidence_rows.json");
		if (!(await fileExists(uiPath)) || !(await fileExists(structuredPath)) || !(await fileExists(evidencePath))) continue;

		const ui = await readJson(uiPath);
		const dealName = ui?.payload?.deal?.name || dealId;
		const documents = asArray(ui?.payload?.documents?.documents);
		const documentsStructured = asArray((await readJson(structuredPath))?.payload);

		// Trace evidence rows are often empty; prefer DB if available.
		const traceEvidenceRows = asArray((await readJson(evidencePath))?.payload);
		const dbEvidenceRows = dbClient ? await fetchEvidenceRowsFromDb(dbClient, dealId).catch(() => null) : null;
		const evidenceRows = Array.isArray(dbEvidenceRows) && dbEvidenceRows.length > 0 ? dbEvidenceRows : traceEvidenceRows;

		// Input-level presence audit
		let hasFinancialDocs = false;
		for (const doc of documents) {
			const docId = String(doc?.id || "");
			const structured = documentsStructured.find((d) => String(d?.id || "") === docId)?.structured_data;
			if (classifyHasFinancialDocuments(doc, structured)) {
				hasFinancialDocs = true;
				break;
			}
		}

		// JSON-level extraction coverage
		const { extracted_financial_signals, extraction_sources } = extractSignalsFromStructured({ documentsStructured });

		// Evidence materialization audit
		const evidenceSignals = materializeEvidenceSignals({ evidenceRows });
		const evidenceBySignal = Object.fromEntries(evidenceSignals.map((e) => [e.signal, e]));
		let evidenceGap = false;
		for (const sig of Object.keys(extracted_financial_signals)) {
			if (extracted_financial_signals[sig] && (evidenceBySignal[sig]?.evidence_ids?.length || 0) === 0) {
				evidenceGap = true;
				break;
			}
		}

		// Analyzer consumption audit (Financial Health)
		const analyzer = extractAnalyzerFinancialHealthFromUi(ui);
		const orchestratorInputs = await readJson(path.join(runDir, "07_orchestrator_inputs.json")).catch(() => null);
		const analyzerResults = await readJson(path.join(runDir, "08_analyzer_results.json")).catch(() => null);
		const orchestratorFh = extractFinancialHealthInputsFromOrchestrator(orchestratorInputs);
		const prereq = computeFinancialHealthPrerequisitesFromOrchestrator({ orchestratorFh });

		const financial_health_audit = {
			status: analyzer.status,
			health_score: analyzer.health_score,
			orchestrator_input: orchestratorFh,
			analyzer_result: analyzerResults?.payload?.financial_health ?? null,
			core_signals_present: prereq.core_signals_present,
			runway_computable: prereq.runway_computable,
			missing_prerequisites: prereq.missing_prerequisites,
		};

		const explanation = buildExplanationBlock({
			dealName,
			hasFinancialDocs,
			extractedSignals: extracted_financial_signals,
			evidenceGap,
			analyzerStatus: analyzer.status,
			missingPrereqs: prereq.missing_prerequisites,
		});

		const outJson = {
			deal_id: dealId,
			run_id: runId,
			deal_name: dealName,
			has_financial_documents: hasFinancialDocs,
			extracted_financial_signals,
			extraction_sources,
			evidence_financial_metrics: evidenceSignals,
			evidence_gap: evidenceGap,
			financial_health_audit,
			explanation,
			inputs: {
				trace_run_dir: runDir,
				evidence_source: Array.isArray(dbEvidenceRows) && dbEvidenceRows.length > 0 ? "db" : "trace",
			},
		};

		const mdLines = [];
		mdLines.push(`# Financial Readiness`);
		mdLines.push("");
		mdLines.push(`Deal: ${dealName} (${dealId})`);
		mdLines.push(`Run: ${runId}`);
		mdLines.push("");
		mdLines.push(`## Summary`);
		mdLines.push(`- has_financial_documents: ${hasFinancialDocs}`);
		mdLines.push(`- evidence_gap: ${evidenceGap}`);
		mdLines.push(`- financial_health.status: ${financial_health_audit.status}`);
		if (financial_health_audit.missing_prerequisites.length) {
			mdLines.push(`- missing_prerequisites: ${financial_health_audit.missing_prerequisites.join(" | ")}`);
		}
		mdLines.push("");
		mdLines.push(`## Deterministic Explanation`);
		mdLines.push(explanation);
		mdLines.push("");
		mdLines.push(`## Extracted Signals`);
		for (const [sig, ok] of Object.entries(extracted_financial_signals)) {
			mdLines.push(`- ${sig}: ${ok}`);
			if (ok) {
				mdLines.push(`  - documents: ${extraction_sources[sig].document_ids.join(", ") || "(none)"}`);
				mdLines.push(`  - structured_paths: ${extraction_sources[sig].structured_paths.join(", ") || "(none)"}`);
			}
		}
		mdLines.push("");
		mdLines.push(`## Evidence Metrics (by signal)`);
		for (const e of evidenceSignals) {
			const ids = e.evidence_ids.length ? e.evidence_ids.join(", ") : "(none)";
			const src = e.sources.length ? e.sources.join(", ") : "(none)";
			mdLines.push(`- ${e.signal}: evidence_ids=${ids} sources=${src}`);
		}
		mdLines.push("");
		mdLines.push(`## Analyzer View (trace report metadata)`);
		mdLines.push(`- component.status: ${analyzer.raw_component?.status ?? "(missing)"}`);
		mdLines.push(`- component.coverage: ${analyzer.raw_component?.coverage ?? "(missing)"}`);
		mdLines.push(`- orchestrator.financialHealth.present: ${financial_health_audit.orchestrator_input.present}`);
		mdLines.push(`- orchestrator.financialHealth.insufficient_input: ${financial_health_audit.orchestrator_input.insufficient_input}`);
		mdLines.push(`- orchestrator.financialHealth.extracted_metrics_count: ${financial_health_audit.orchestrator_input.extracted_metrics_count}`);
		mdLines.push(
			`- orchestrator.financialHealth.extracted_metric_names: ${
				financial_health_audit.orchestrator_input.extracted_metric_names.length
					? financial_health_audit.orchestrator_input.extracted_metric_names.join(", ")
					: "(none)"
			}`
		);
		mdLines.push(`- financialHealth.core_signals_present: ${financial_health_audit.core_signals_present}`);
		mdLines.push(`- financialHealth.runway_computable: ${financial_health_audit.runway_computable}`);
		mdLines.push(`- section_preview: ${analyzer.section_preview ? analyzer.section_preview.replace(/\n/g, "\\n") : "(missing)"}`);

		await fsp.writeFile(path.join(runDir, "FINANCIAL_READINESS.json"), JSON.stringify(outJson, null, 2));
		await fsp.writeFile(path.join(runDir, "FINANCIAL_READINESS.md"), mdLines.join("\n"));

		rollup.push({
			deal_id: dealId,
			deal_name: dealName,
			run_id: runId,
			has_financial_documents: hasFinancialDocs,
			evidence_gap: evidenceGap,
			financial_health_status: financial_health_audit.status,
			extracted_financial_signals,
		});

		console.log(`[financial_readiness] wrote ${path.join(runDir, "FINANCIAL_READINESS.json")}`);
	}

	if (dbClient) await dbClient.end();

	// Also write an audit rollup file under docs/trace_audit for convenience.
	const auditDir = path.join(repoRoot, "docs", "trace_audit");
	await fsp.mkdir(auditDir, { recursive: true });
	await fsp.writeFile(path.join(auditDir, "FINANCIAL_READINESS_ROLLUP.json"), JSON.stringify({ generated_at: new Date().toISOString(), rollup }, null, 2));

	console.log(`[financial_readiness] wrote ${path.join(auditDir, "FINANCIAL_READINESS_ROLLUP.json")}`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
