import { createHash } from "crypto";

export type Phase1ConfidenceBand = "low" | "med" | "high";

export type Phase1RecommendationV1 = "PASS" | "CONSIDER" | "GO";

export type Phase1ExecutiveSummaryEvidenceRefV1 = {
	claim_id: string;
	document_id: string;
	page?: number;
	page_range?: [number, number];
	snippet?: string;
};

export type Phase1ExecutiveSummaryV1 = {
	title: string;
	one_liner: string;
	deal_type: string;
	raise: string;
	business_model: string;
	traction_signals: string[];
	key_risks_detected: string[];
	unknowns: string[];
	confidence: {
		overall: Phase1ConfidenceBand;
		sections?: Record<string, Phase1ConfidenceBand>;
	};
	evidence: Phase1ExecutiveSummaryEvidenceRefV1[];
};

export type Phase1ClaimCategoryV1 =
	| "product"
	| "market"
	| "traction"
	| "terms"
	| "team"
	| "risk"
	| "other";

export type Phase1ClaimEvidenceV1 = {
	document_id: string;
	page?: number;
	page_range?: [number, number];
	snippet: string;
};

export type Phase1ClaimV1 = {
	claim_id: string;
	category: Phase1ClaimCategoryV1;
	text: string;
	evidence: Phase1ClaimEvidenceV1[];
};

export type Phase1CoverageV1 = {
	sections: Record<string, "present" | "partial" | "missing">;
};

export type Phase1DecisionSummaryV1 = {
	score: number; // 0-100
	recommendation: Phase1RecommendationV1;
	reasons: string[];
	blockers: string[];
	next_requests: string[];
	confidence: Phase1ConfidenceBand;
};

export type Phase1DIOV1 = {
	executive_summary_v1: Phase1ExecutiveSummaryV1;
	decision_summary_v1: Phase1DecisionSummaryV1;
	claims: Phase1ClaimV1[];
	coverage: Phase1CoverageV1;
};

export type Phase1GeneratorDealInfo = {
	deal_id: string;
	name?: string | null;
	stage?: string | null;
};

export type Phase1GeneratorInputDocument = {
	document_id: string;
	title?: string | null;
	type?: string | null;
	page_count?: number | null;
	// Common structured extraction keys (best-effort; may vary by extractor)
	full_text?: string;
	fullText?: string;
	summary?: string;
	text_summary?: string;
	mainHeadings?: string[];
	headings?: string[];
	keyMetrics?: any[];
	metrics?: any[];
	pages?: Array<{ page?: number; text?: string }>; // if available
};

function stableId(prefix: string, text: string): string {
	const norm = text.trim().toLowerCase();
	const hash = createHash("sha256").update(norm).digest("hex").slice(0, 12);
	return `${prefix}_${hash}`;
}

function safeString(v: unknown): string {
	return typeof v === "string" ? v : v == null ? "" : String(v);
}

function uniqStrings(values: string[]): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const v of values) {
		const s = v.trim();
		if (!s) continue;
		const key = s.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(s);
	}
	return out;
}

function pickBestText(doc: Phase1GeneratorInputDocument): string {
	const candidates = [
		safeString((doc as any).full_text),
		safeString((doc as any).fullText),
		safeString((doc as any).full_text_raw),
		safeString((doc as any).raw_text),
		safeString((doc as any).combined_text),
		safeString((doc as any).text_summary),
		safeString((doc as any).summary),
		safeString((doc as any).text),
	];
	for (const c of candidates) {
		const s = c.trim();
		if (s.length >= 40) return s;
	}
	for (const c of candidates) {
		const s = c.trim();
		if (s.length > 0) return s;
	}
	return "";
}

function pickSnippetFromDoc(doc: Phase1GeneratorInputDocument, hint?: RegExp): { snippet: string; page?: number } {
	const pages = Array.isArray((doc as any).pages) ? ((doc as any).pages as any[]) : [];
	if (pages.length > 0) {
		for (const p of pages) {
			const text = safeString(p?.text).trim();
			if (!text) continue;
			if (hint && !hint.test(text)) continue;
			return { snippet: text.slice(0, 280), page: typeof p?.page === "number" ? p.page : undefined };
		}
		// fallback first non-empty
		for (const p of pages) {
			const text = safeString(p?.text).trim();
			if (!text) continue;
			return { snippet: text.slice(0, 280), page: typeof p?.page === "number" ? p.page : undefined };
		}
	}

	const text = pickBestText(doc);
	if (text) {
		if (hint) {
			const m = text.match(hint);
			if (m && m.index != null) {
				const start = Math.max(0, m.index - 60);
				return { snippet: text.slice(start, start + 280) };
			}
		}
		return { snippet: text.slice(0, 280) };
	}

	const title = safeString(doc.title).trim();
	return { snippet: title ? `Document: ${title}` : "Document provided" };
}

function detectBusinessModel(text: string): string | null {
	const lower = text.toLowerCase();
	const patterns: Array<{ re: RegExp; label: string }> = [
		{ re: /\bsaas\b|\bsubscription\b|\barr\b|\bmrr\b/i, label: "SaaS / subscription" },
		{ re: /\bmarketplace\b/i, label: "Marketplace" },
		{ re: /\blicens(e|ing)\b/i, label: "Licensing" },
		{ re: /\bservices\b|\bimplementation\b|\bconsulting\b/i, label: "Services" },
		{ re: /\be-?commerce\b|\bdtc\b|\bconsumer\b/i, label: "Consumer / commerce" },
	];
	for (const p of patterns) {
		if (p.re.test(lower)) return p.label;
	}
	return null;
}

function hasAnyExtractedText(docs: Phase1GeneratorInputDocument[]): boolean {
	for (const d of docs) {
		if (pickBestText(d).trim().length >= 20) return true;
		const pages = Array.isArray((d as any).pages) ? ((d as any).pages as any[]) : [];
		if (pages.some((p) => safeString(p?.text).trim().length >= 20)) return true;
	}
	return false;
}

function detectProductSnippet(text: string): string | null {
	const candidates: RegExp[] = [
		/\b(we|our company|the team)\s+(is|are)\s+(building|creating|developing)\b[^\n\r]{0,160}/i,
		/\b(platform|product|solution)\b[^\n\r]{0,160}/i,
		/\b(problem|solution)\b[^\n\r]{0,160}/i,
	];
	for (const re of candidates) {
		const m = text.match(re);
		if (!m) continue;
		const s = m[0].replace(/\s+/g, " ").trim();
		if (s.length >= 30) return s.slice(0, 180);
	}
	return null;
}

function detectMarketSnippet(text: string): string | null {
	const candidates: RegExp[] = [
		/\b(ideal customer|icp|target customer|target market|buyer|persona)\b[^\n\r]{0,160}/i,
		/\b(TAM|SAM|SOM)\b[^\n\r]{0,120}/i,
		/\b(industry|vertical)\b[^\n\r]{0,140}/i,
	];
	for (const re of candidates) {
		const m = text.match(re);
		if (!m) continue;
		const s = m[0].replace(/\s+/g, " ").trim();
		if (s.length >= 25) return s.slice(0, 160);
	}
	return null;
}

function detectTractionMetrics(text: string): string[] {
	const out: string[] = [];
	const patterns: Array<{ re: RegExp; label: (m: RegExpMatchArray) => string }> = [
		{ re: /\bARR\b[^\n\r]{0,40}(\$\s?\d[\d,]*(?:\.\d+)?\s*(?:k|m|mm|million)?)?/i, label: (m) => `ARR mentioned${m[1] ? ` (${m[1].replace(/\s+/g, " ").trim()})` : ""}` },
		{ re: /\bMRR\b[^\n\r]{0,40}(\$\s?\d[\d,]*(?:\.\d+)?\s*(?:k|m|mm|million)?)?/i, label: (m) => `MRR mentioned${m[1] ? ` (${m[1].replace(/\s+/g, " ").trim()})` : ""}` },
		{ re: /\brevenue\b[^\n\r]{0,40}(\$\s?\d[\d,]*(?:\.\d+)?\s*(?:k|m|mm|million)?)?/i, label: (m) => `Revenue mentioned${m[1] ? ` (${m[1].replace(/\s+/g, " ").trim()})` : ""}` },
		{ re: /\b(\d[\d,]*)\s+(customers?|clients?)\b/i, label: (m) => `${m[1].replace(/,/g, "")} customers mentioned` },
		{ re: /\b(\d[\d,]*)\s+(users?)\b/i, label: (m) => `${m[1].replace(/,/g, "")} users mentioned` },
	];
	for (const p of patterns) {
		const m = text.match(p.re);
		if (m) out.push(p.label(m));
	}
	return uniqStrings(out);
}

function coverageStatusFromText(text: string, patterns: RegExp[], fallback?: "present" | "partial" | "missing"): "present" | "partial" | "missing" {
	if (!text.trim()) return fallback ?? "missing";
	for (const re of patterns) {
		if (re.test(text)) return "present";
	}
	return fallback ?? "missing";
}

function clampScore(v: number): number {
	if (!Number.isFinite(v)) return 0;
	return Math.max(0, Math.min(100, Math.round(v)));
}

function buildDecisionSummary(params: {
	coverage: Phase1CoverageV1;
	docs: Phase1GeneratorInputDocument[];
}): Phase1DecisionSummaryV1 {
	const sections = params.coverage.sections;
	const docsPresent = sections.documents === "present";
	if (!docsPresent) {
		const reasons = [
			"No documents available for analysis.",
			"Upload a pitch deck, memo, or financials to enable analysis.",
		];
		const blockers = ["Upload a pitch deck, memo, or financials to enable analysis."];
		const next_requests = ["Upload at least one pitch deck or financial snapshot."];
		return {
			score: 0,
			recommendation: "PASS",
			reasons,
			blockers,
			next_requests,
			confidence: "low",
		};
	}

	// Deterministic rubric: start from 100 and subtract for missing/partial key sections.
	// This ensures score always exists even with missing data.
	const penalties: Array<{ key: string; missing: number; partial: number; reason: string; request: string }> = [
		{
			key: "product_solution",
			missing: 20,
			partial: 10,
			reason: "Product / solution is not clearly described in extracted documents.",
			request: "Add 1 slide or 1 paragraph describing the problem, solution, and why now.",
		},
		{
			key: "market_icp",
			missing: 15,
			partial: 8,
			reason: "Target market / ICP is not clearly described in extracted documents.",
			request: "Add ICP definition (buyer, user, segment) and market sizing (TAM/SAM/SOM or bottom-up).",
		},
		{
			key: "gtm",
			missing: 12,
			partial: 6,
			reason: "Go-to-market approach is not described (channels, pricing, sales motion).",
			request: "Add GTM plan: channels, pricing, sales cycle, and pipeline assumptions.",
		},
		{
			key: "business_model",
			missing: 10,
			partial: 5,
			reason: "Business model is unclear (how the company makes money).",
			request: "Add monetization model (pricing, unit economics, revenue streams).",
		},
		{
			key: "traction",
			missing: 15,
			partial: 8,
			reason: "Traction metrics are not disclosed (revenue/users/customers/growth/retention).",
			request: "Add current KPIs (revenue/ARR/MRR, customers/users, growth, retention/churn).",
		},
		{
			key: "financials",
			missing: 15,
			partial: 8,
			reason: "Financial readiness data is missing (burn, runway, cash, margins).",
			request: "Add burn, runway, cash balance, and margin profile (or a simple P&L).",
		},
		{
			key: "team",
			missing: 10,
			partial: 5,
			reason: "Team / founder background is not clearly presented in extracted documents.",
			request: "Add founder bios (roles, relevant experience, prior outcomes).",
		},
		{
			key: "raise_terms",
			missing: 6,
			partial: 3,
			reason: "Raise amount / terms are not clearly stated.",
			request: "Add raise amount, round type, and expected use of funds.",
		},
	];

	let score = 100;

	type RankedReason = {
		key: string;
		status: "present" | "partial" | "missing";
		penaltyApplied: number;
		reason: string;
		request: string;
	};

	const ranked: RankedReason[] = [];
	for (const p of penalties) {
		const status = (sections[p.key] ?? "missing") as "present" | "partial" | "missing";
		if (status === "missing") {
			score -= p.missing;
			ranked.push({
				key: p.key,
				status,
				penaltyApplied: p.missing,
				reason: p.reason,
				request: p.request,
			});
		} else if (status === "partial") {
			score -= p.partial;
			ranked.push({
				key: p.key,
				status,
				penaltyApplied: p.partial,
				reason: p.reason,
				request: p.request,
			});
		}
	}

	// Rank reasons by impact (missing/partial penalty), descending.
	ranked.sort((a, b) => {
		if (b.penaltyApplied !== a.penaltyApplied) return b.penaltyApplied - a.penaltyApplied;
		if (a.status !== b.status) return a.status === "missing" ? -1 : 1;
		return a.key.localeCompare(b.key);
	});

	// Blockers are a strict subset of reasons (missing + critical only, capped).
	const criticalKeys = new Set(["product_solution", "market_icp", "financials", "team", "raise_terms"]);
	const blockerItems = ranked
		.filter((r) => r.status === "missing" && criticalKeys.has(r.key))
		.slice(0, 5);

	const blockers = uniqStrings(blockerItems.map((b) => b.reason));
	const next_requests = blockerItems.map((b) => b.request).slice(0, blockers.length);

	const reasons: string[] = [];
	// Ensure blockers are included in reasons, then fill up to 10 with the remaining ranked reasons.
	for (const b of blockers) reasons.push(b);
	for (const r of ranked) {
		if (reasons.length >= 10) break;
		if (reasons.some((x) => x.toLowerCase() === r.reason.toLowerCase())) continue;
		reasons.push(r.reason);
	}

	const finalScore = clampScore(score);

	// Recommendation derived deterministically from score thresholds.
	const criticalMissing = ["product_solution", "market_icp", "team", "financials"].filter(
		(k) => (sections[k] ?? "missing") === "missing"
	).length;
	let recommendation: Phase1RecommendationV1;
	if (finalScore >= 75 && criticalMissing <= 1) recommendation = "GO";
	else if (finalScore >= 50) recommendation = "CONSIDER";
	else recommendation = "PASS";

	const confidence: Phase1ConfidenceBand = confidenceFromCoverage(params.coverage);

	return {
		score: finalScore,
		recommendation,
		reasons: uniqStrings(reasons).slice(0, 10),
		blockers: uniqStrings(blockers).slice(0, 10),
		next_requests: next_requests.slice(0, 10),
		confidence,
	};
}

function detectRaise(text: string): string | null {
	// Only extract when present verbatim in text.
	const re = /\b(?:raising|raise|seeking|the ask|funding)\b[^\n\r]{0,80}(\$\s?\d[\d,]*(?:\.\d+)?\s*(?:k|m|b|mm|bn|million|billion)?)|\$\s?\d[\d,]*(?:\.\d+)?\s*(?:k|m|b|mm|bn|million|billion)?\s*(?:seed|series\s+[a-d]|pre-?seed|round)\b/i;
	const m = text.match(re);
	if (!m) return null;
	const s = m[0].trim();
	return s.length > 0 ? s.slice(0, 120) : null;
}

function detectDealTypeFromDocs(docs: Phase1GeneratorInputDocument[]): string | null {
	const types = uniqStrings(
		docs
			.map((d) => safeString(d.type).trim())
			.filter(Boolean)
	);
	if (types.length === 0) return null;
	if (types.some((t) => t === "pitch_deck")) return "startup_raise";
	if (types.some((t) => t === "financials")) return "startup_raise";
	return "other";
}

function detectTractionSignals(text: string): string[] {
	const signals: Array<{ re: RegExp; label: string }> = [
		{ re: /\barr\b/i, label: "ARR mentioned" },
		{ re: /\bmrr\b/i, label: "MRR mentioned" },
		{ re: /\brevenue\b/i, label: "Revenue mentioned" },
		{ re: /\bgrowth\b/i, label: "Growth mentioned" },
		{ re: /\bcustomers?\b/i, label: "Customers mentioned" },
		{ re: /\busers?\b|\bactive users\b|\bmau\b|\bdau\b/i, label: "Users mentioned" },
		{ re: /\bretention\b|\bchurn\b/i, label: "Retention / churn mentioned" },
		{ re: /\bpartnership\b|\bpilot\b|\bcontract\b/i, label: "Pilots / partnerships mentioned" },
	];
	const out: string[] = [];
	for (const s of signals) {
		if (s.re.test(text)) out.push(s.label);
	}
	return uniqStrings(out);
}

function detectRiskSignals(text: string): string[] {
	const signals: Array<{ re: RegExp; label: string }> = [
		{ re: /\bcompetition\b|\bcompetitor\b/i, label: "Competition" },
		{ re: /\bregulatory\b|\bcompliance\b/i, label: "Regulatory / compliance" },
		{ re: /\bchurn\b|\bretention\b/i, label: "Retention risk" },
		{ re: /\bcapital intensive\b|\bcapex\b/i, label: "Capital intensity" },
		{ re: /\bsecurity\b|\bprivacy\b/i, label: "Security / privacy" },
	];
	const out: string[] = [];
	for (const s of signals) {
		if (s.re.test(text)) out.push(s.label);
	}
	return uniqStrings(out);
}

function sectionStatus(value: string, arr?: string[]): "present" | "partial" | "missing" {
	const v = value.trim();
	if (v && v.toLowerCase() !== "unknown") return "present";
	if (Array.isArray(arr) && arr.length > 0) return "partial";
	return "missing";
}

function confidenceFromCoverage(coverage: Phase1CoverageV1): Phase1ConfidenceBand {
	const statuses = Object.values(coverage.sections);
	const present = statuses.filter((s) => s === "present").length;
	const partial = statuses.filter((s) => s === "partial").length;
	if (present >= 5) return "high";
	if (present >= 3 || (present >= 2 && partial >= 2)) return "med";
	return "low";
}

export function generatePhase1DIOV1(params: {
	deal: Phase1GeneratorDealInfo;
	inputDocuments: Phase1GeneratorInputDocument[];
	dio?: unknown;
	maxClaims?: number;
}): Phase1DIOV1 {
	const maxClaims = Math.max(1, Math.min(25, params.maxClaims ?? 10));
	const docs = Array.isArray(params.inputDocuments) ? params.inputDocuments : [];

	const combinedText = docs
		.map((d) => pickBestText(d))
		.filter(Boolean)
		.join("\n\n")
		.slice(0, 60_000);

	const deal_type = detectDealTypeFromDocs(docs) ?? "Unknown";
	const raiseDetected = detectRaise(combinedText);
	const raise = raiseDetected ?? "Unknown";
	const business_model = detectBusinessModel(combinedText) ?? "Unknown";
	const traction_signals = detectTractionSignals(combinedText);
	const key_risks_detected = detectRiskSignals(combinedText);

	const title = params.deal.name?.trim() ? `${params.deal.name} — Executive Summary` : "Executive Summary";
	const anyText = hasAnyExtractedText(docs);

	// Build an understanding-only one-liner from extracted text (deterministic; no invention).
	const primaryDoc = docs.find((d) => safeString(d.type).trim() === "pitch_deck") ?? docs[0];
	const primaryText = primaryDoc ? pickBestText(primaryDoc) : "";
	const productSnippet = primaryText ? detectProductSnippet(primaryText) : null;
	const marketSnippet = primaryText ? detectMarketSnippet(primaryText) : null;
	const tractionMetrics = detectTractionMetrics(combinedText);

	const oneLinerParts: string[] = [];
	if (params.deal.name?.trim()) oneLinerParts.push(`${params.deal.name}:`);
	if (productSnippet) oneLinerParts.push(productSnippet.replace(/\s+/g, " ").trim());
	if (marketSnippet) oneLinerParts.push(marketSnippet.replace(/\s+/g, " ").trim());
	if (business_model !== "Unknown") oneLinerParts.push(`Business model signal: ${business_model}.`);
	if (raiseDetected) oneLinerParts.push(`Raise mentioned: ${raiseDetected}.`);
	if (tractionMetrics.length > 0) oneLinerParts.push(`Traction: ${tractionMetrics.slice(0, 3).join("; ")}.`);
	if (oneLinerParts.length <= 1) {
		// Fallback that is never empty when docs exist.
		if (docs.length > 0) oneLinerParts.push(`Documents present: ${docs.length}.`);
		if (!anyText && docs.length > 0) oneLinerParts.push("Extracted text not available yet.");
	}
	let one_liner = oneLinerParts.join(" ").replace(/\s+/g, " ").trim();
	if (!one_liner && docs.length > 0) one_liner = `Summary pending. Documents present: ${docs.length}.`;
	if (!one_liner) one_liner = "Summary pending.";

	const unknowns: string[] = [];
	if (deal_type === "Unknown") unknowns.push("deal_type");
	if (raise === "Unknown") unknowns.push("raise");
	if (business_model === "Unknown") unknowns.push("business_model");
	if (traction_signals.length === 0 && tractionMetrics.length === 0) unknowns.push("traction_signals");
	if (key_risks_detected.length === 0) unknowns.push("key_risks_detected");
	if (!productSnippet) unknowns.push("product_solution");
	if (!marketSnippet) unknowns.push("market_icp");

	const termsStatus: "present" | "partial" | "missing" = raise === "Unknown" ? "missing" : "present";
	const productStatus: "present" | "partial" | "missing" = productSnippet
		? "present"
		: coverageStatusFromText(combinedText, [/(problem|solution|product|platform|technology)\b/i], "missing");
	const marketStatus: "present" | "partial" | "missing" = marketSnippet
		? "present"
		: coverageStatusFromText(combinedText, [/(market|tam|sam|som|icp|customer segment|buyer|persona)\b/i], "missing");
	const tractionStatus: "present" | "partial" | "missing" = sectionStatus(
		"",
		traction_signals.length > 0 ? traction_signals : tractionMetrics
	);
	const financialsStatus: "present" | "partial" | "missing" = coverageStatusFromText(
		combinedText,
		[/(revenue|arr|mrr|burn|runway|cash|margin|expenses|profit)\b/i],
		docs.some((d) => safeString(d.type).trim() === "financials") ? "partial" : "missing"
	);
	const risksStatus: "present" | "partial" | "missing" = sectionStatus("", key_risks_detected);

	const coverage: Phase1CoverageV1 = {
		sections: {
			deal_type: deal_type === "Unknown" ? "missing" : "present",
			raise_terms: termsStatus,
			terms: termsStatus,
			business_model: business_model === "Unknown" ? "missing" : "present",
			product_solution: productStatus,
			product: productStatus,
			market_icp: marketStatus,
			market: marketStatus,
			gtm: coverageStatusFromText(combinedText, [/(go\s*-?to\s*-?market|\bgtm\b|pricing|sales\s+motion|distribution|channel)\b/i], "missing"),
			team: coverageStatusFromText(combinedText, [/(founder|team|ceo|cto|co-founder|background|experience)\b/i], "missing"),
			traction: tractionStatus,
			financials: financialsStatus,
			risks: risksStatus,
			documents: docs.length > 0 ? "present" : "missing",
		},
	};

	const sectionConfidence: Record<string, Phase1ConfidenceBand> = {
		deal_type: deal_type === "Unknown" ? "low" : "med",
		raise_terms: raise === "Unknown" ? "low" : "med",
		business_model: business_model === "Unknown" ? "low" : "med",
		traction: traction_signals.length > 0 ? "med" : "low",
		risks: key_risks_detected.length > 0 ? "med" : "low",
		product_solution: productSnippet ? "med" : "low",
		market_icp: marketSnippet ? "med" : "low",
		gtm: coverage.sections.gtm === "present" ? "med" : "low",
		team: coverage.sections.team === "present" ? "med" : "low",
		financials: coverage.sections.financials === "present" ? "med" : coverage.sections.financials === "partial" ? "low" : "low",
	};

	const overall = confidenceFromCoverage(coverage);

	const decision_summary_v1 = buildDecisionSummary({ coverage, docs });

	const claims: Phase1ClaimV1[] = [];

	const addClaim = (category: Phase1ClaimCategoryV1, text: string, evidenceFrom: Phase1GeneratorInputDocument, hint?: RegExp) => {
		const t = text.trim();
		if (!t) return;
		const claim_id = stableId(`p1_${category}`, t);
		const ev = pickSnippetFromDoc(evidenceFrom, hint);
		const snippet = ev.snippet.trim() ? ev.snippet.trim() : "Document provided";
		claims.push({
			claim_id,
			category,
			text: t,
			evidence: [
				{
					document_id: evidenceFrom.document_id,
					snippet,
					page: ev.page,
				},
			],
		});
	};

	// Baseline claims (always make at least one claim when docs exist)
	if (docs.length > 0) {
		const first = docs[0];
		addClaim(
			"other",
			`Documents provided for analysis (${docs.length} total).`,
			first
		);
	}

	const docWithRaise = raiseDetected
		? docs.find((d) => pickBestText(d).toLowerCase().includes(raiseDetected.toLowerCase())) ?? docs[0]
		: null;
	if (docWithRaise && raiseDetected) {
		addClaim("terms", `Raise mentioned: ${raiseDetected}`, docWithRaise, /\b(raising|raise|seeking|ask|funding)\b|\$\s?\d/i);
	}

	if (business_model !== "Unknown" && docs.length > 0) {
		addClaim("product", `Business model signal detected: ${business_model}.`, docs[0], /\bsaas\b|\bsubscription\b|\bmarketplace\b|\blicens/i);
	}

	if (traction_signals.length > 0 && docs.length > 0) {
		addClaim("traction", `Traction signals detected: ${traction_signals.join(", ")}.`, docs[0], /\barr\b|\bmrr\b|\brevenue\b|\bgrowth\b|\bcustomer/i);
	}

	if (key_risks_detected.length > 0 && docs.length > 0) {
		addClaim("risk", `Risk signals mentioned: ${key_risks_detected.join(", ")}.`, docs[0], /\brisk\b|\bcompetition\b|\bregulatory\b|\bsecurity\b/i);
	}

	// Additional evidence-backed claims from document types
	for (const d of docs) {
		const t = safeString(d.type).trim();
		if (!t) continue;
		if (t === "pitch_deck") {
			addClaim("product", "Pitch deck provided.", d, /\bproblem\b|\bsolution\b|\bproduct\b/i);
		}
		if (t === "financials") {
			addClaim("traction", "Financials document provided.", d, /\brevenue\b|\bburn\b|\bcash\b|\brunway\b/i);
		}
	}

	const uniqueClaims: Phase1ClaimV1[] = [];
	const seenClaimIds = new Set<string>();
	for (const c of claims) {
		if (seenClaimIds.has(c.claim_id)) continue;
		seenClaimIds.add(c.claim_id);
		uniqueClaims.push(c);
		if (uniqueClaims.length >= maxClaims) break;
	}

	// Executive summary evidence: include claim pointers + snippet if available
	const executiveEvidence: Phase1ExecutiveSummaryEvidenceRefV1[] = uniqueClaims
		.slice(0, 6)
		.map((c) => {
			const ev0 = c.evidence[0];
			return {
				claim_id: c.claim_id,
				document_id: ev0.document_id,
				page: ev0.page,
				page_range: ev0.page_range,
				snippet: ev0.snippet,
			};
		});

	return {
		executive_summary_v1: {
			title,
			one_liner,
			deal_type,
			raise,
			business_model,
			traction_signals,
			key_risks_detected,
			unknowns: uniqStrings(unknowns),
			confidence: {
				overall,
				sections: sectionConfidence,
			},
			evidence: executiveEvidence,
		},
		decision_summary_v1,
		claims: uniqueClaims,
		coverage,
	};
}

export function mergePhase1IntoDIO(dio: any, phase1: Phase1DIOV1): any {
	const base = dio && typeof dio === "object" ? dio : {};
	const dioNode = base.dio && typeof base.dio === "object" ? base.dio : {};
	return {
		...base,
		dio: {
			...dioNode,
			phase1: {
				// overwrite deterministically (Phase 1 contract is always-on)
				executive_summary_v1: phase1.executive_summary_v1,
				decision_summary_v1: phase1.decision_summary_v1,
				claims: phase1.claims,
				coverage: phase1.coverage,
			},
		},
	};
}

export function stripExecutiveSummaryEvidenceForList(input: any): any {
	if (!input || typeof input !== "object") return input;
	const { evidence, ...rest } = input as any;
	return rest;
}
