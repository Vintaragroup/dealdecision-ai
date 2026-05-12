/**
 * Stage 2 — Deterministic slot detection + Phase 2 canonical fields + thesis stub.
 *
 * Contains ALL regex patterns, loadInsightSlotInputs, slot evaluators, section
 * builders for financial/UoF/implied-capital, Phase 2 canonical extraction, and
 * the deterministic investor-thesis stub.  No LLM calls here.
 *
 * Extracted verbatim from processor.ts (PR17.6 Lite split).
 */

import type { Pool } from "pg";

import {
	computeEvidenceConfidence,
	buildConfidenceSignals,
	isProjectedScope,
	temporalScopeLabel,
	FACT_PLAUSIBILITY_GUARDS,
} from "@dealdecision/core";
import type { EvidenceConfidenceLevel, FinancialFactV1, FactPlausibilityGuard } from "@dealdecision/core";
import { detectFinancialTables } from "../../../extraction/xlsx/table-detector.js";
import { parseFinancialTable } from "../../../extraction/xlsx/financial-model-interpreter.js";
import { promoteToFinancialFactV1 } from "../../../extraction/xlsx/metric-promoter.js";

import type {
	GateState,
	RenderPackage,
} from "../../../contracts/investor-insights/schemas";
import { normalizeForExtraction, type NormalizationEvent } from "../normalize";
import {
	parseFinancialStatementV1,
	pickBestStatement,
	formatRevenueSeries,
	formatYoY,
	formatCAGR,
	formatGrossMargin,
	type FinancialStatementV1,
} from "../../../lib/financial-statement-parser.js";
import { deriveFinancialFactsV1 } from "../../../lib/financial-facts-v1.js";
import {
	parseUseOfFundsV1,
	pickBestUseOfFunds,
	type UseOfFundsV1,
} from "../../../lib/use-of-funds-parser-v1.js";
import {
	parseImpliedCapitalAllocationV1,
	type ImpliedCapitalAllocationV1,
} from "../../../lib/implied-capital-allocation-v1.js";
import { parseUseOfFundsTimeseriesV1 } from "../../../lib/use-of-funds-timeseries-v1.js";
import {
	parseImpliedCapitalIncomeStatementV1,
	type IncomeStatementAllocationV1,
} from "../../../lib/implied-capital-income-statement-v1.js";
import {
	classifyDealLayouts,
	type DealLayoutClassificationV1,
} from "../../../lib/financial-layout-classifier-v1.js";
import {
	reconcileFinancialsV1,
	type FinancialReconciliationV1,
} from "../../../lib/financial-reconciliation-v1.js";
import {
	parseBalanceSheetV1,
	pickBestBalanceSheet,
	type BalanceSheetV1,
} from "../../../lib/balance-sheet-parser-v1.js";
import {
	parseCashFlowStatementV1,
	pickBestCashFlow,
	type CashFlowStatementV1,
} from "../../../lib/cash-flow-parser-v1.js";
import {
	parseCapTableV1,
	pickBestCapTable,
	type CapTableV1,
} from "../../../lib/cap-table-parser-v1.js";
import {
	parseSaasKpisV1,
	pickBestSaasKpis,
	type SaasKpisV1,
} from "../../../lib/saas-kpis-parser-v1.js";
import {
	parseBankTransactionsV1,
	type BankTransactionsV1,
} from "../../../lib/bank-transactions-parser-v1.js";
import {
	extractDeckFinancialSignalsV1,
	type DeckFinancialSignalsV1,
} from "../../../lib/deck-financial-signals-v1.js";
import type { CrossSourceReconciliationSummary } from "../../../lib/cross-source-reconciliation.js";
import type { FinancialCoverageV1, FinancialConflictV1 } from "@dealdecision/core";
import { getFinancialFactsForDeal } from "../../../lib/db/financial-facts-db.js";
import { isCandidateTaintedByFundAumContext, isCandidateTaintedByVolumeMetric, hasStrongRaiseSignal } from "../resolve-raise-amount.js";
import {
	ARR_TAINT_WINDOW,
	VALUATION_TAINT_WINDOW,
	MRR_TAINT_WINDOW,
	REVENUE_TAINT_WINDOW,
	CUSTOMER_TAINT_WINDOW,
	ARR_MARKET_TAINT_RE,
	ARR_COMPANY_OWNERSHIP_RE,
	VALUATION_COMPETITOR_TAINT_RE,
	VALUATION_COMPANY_OWNERSHIP_RE,
	MRR_MARKET_TAINT_RE,
	MRR_COMPANY_OWNERSHIP_RE,
	REVENUE_MARKET_TAINT_RE,
	REVENUE_COMPANY_OWNERSHIP_RE,
	CUSTOMER_COMPETITOR_TAINT_RE,
	CUSTOMER_COMPANY_OWNERSHIP_RE,
	NumericContextSuppressReason,
} from "../numeric-context-taxonomy.js";
import {
	selectBestNarrativeCandidate,
	rankNarrativeCandidates,
	TOPIC_MIN_THRESHOLD,
	type NarrativeCandidate,
} from "../narrative-evidence-ranking.js";
import { detectNarrativeContradiction } from "../narrative-contradiction-detector.js";
import type { NarrativeContradictionV1, RankedNarrativeBundle } from "../narrative-contradiction-v1.js";

// Re-export deriveFinancialFactsV1 so the orchestrator can import it from here
export { deriveFinancialFactsV1 };

// ─── Product narrative builder ────────────────────────────────────────────────

/**
 * Build a product narrative body from non-financial DPU deck pages.
 *
 * Filters deck pages (excluding heavy financial tables) for pages that
 * contain product/value-proposition keywords. Returns up to ~800 chars of
 * context for the LLM to draw company identity and product description from.
 *
 * Returns null when no suitable pages are found (e.g. XLSX-only deals).
 */
export function buildProductNarrativeBody(inputs: InsightSlotInputs): string | null {
	const PRODUCT_KW_RE =
		/\b(?:product|platform|solution|technology|we\s+(?:help|build|provide|enable|serve|power)|our\s+(?:platform|product|solution|technology|tool|software)|problem|pain\s+point|customers?|users?|clients?|mission|vision|founded|raises?|builds?)\b/i;
	// Detect slides that are primarily forward-looking (projection/forecast/target):
	// these pages should be labeled so the LLM does not treat figures as current actuals.
	const PROJECTION_PAGE_RE =
		/\b(?:forecast(?:ed)?|projection|projected|pro[\s-]?forma|budget(?:ed)?|plan(?:ned)?|expected|estimated|guidance|target(?:\s+revenue)?|2026|2027|2028|fy2[5-9]|fy\s*2[5-9])\b/i;
	// Skip pages that are primarily use-of-funds / capital-raise / hiring language.
	// These pages describe how proceeds are deployed, not the product itself, and
	// can outrank genuine product pages on broad PRODUCT_KW_RE matches.
	const CAPITAL_RAISE_SKIP_RE =
		/\b(?:capital\s+(?:raise|allocation|round)|use\s+of\s+funds?|this\s+(?:round|raise)\s+(?:will|to)\s+(?:enable|fund|support)|strategic\s+hires?\s+to\b)\b/i;
	const MAX_CHARS = 800;
	let dpuCandidates: NarrativeCandidate[] = [];

	for (const page of inputs.dpuPages) {
		const text = page.text ?? "";
		// Skip SPAC / shell-entity financial statement pages — not target-company evidence.
		if (isSpacShellEntityPage(text)) continue;
		// Skip pages that look like financial tables (high density of money tokens)
		const moneyCount = (text.match(/\$[\d,]/g) ?? []).length;
		const totalWords = text.split(/\s+/).filter(Boolean).length;
		if (totalWords > 0 && moneyCount / totalWords >= 0.12) continue;
		if (CAPITAL_RAISE_SKIP_RE.test(text)) continue;
		if (!PRODUCT_KW_RE.test(text)) continue;
		let excerpt = text.slice(0, 500).replace(/\s+/g, " ").trim();
		if (!excerpt || excerpt.length < 30) continue;
		// Label projection slides so the LLM doesn't treat figures as current actuals.
		if (PROJECTION_PAGE_RE.test(text)) {
			excerpt = `[PROJECTED DATA] ${excerpt}`;
		}
		dpuCandidates.push({ text: excerpt, meta: { sourceType: "raw_ocr_page" } });
	}

	// Primary path: use ranked DPU page candidates (requires min score threshold)
	if (dpuCandidates.length > 0) {
		const result = selectBestNarrativeCandidate(dpuCandidates, "product_differentiation", {
			topN: 3,
			maxChars: MAX_CHARS,
		});
		if (result) return result;
	}

	// Fallback: when DPU pages yield no qualifying product narrative (e.g. non-SaaS
	// deals whose OCR text is too garbled or uses domain-specific vocabulary),
	// use evidence snippets directly. They are typically cleaner extractions.
	// Bypass the scoring threshold since these are a last resort.
	const evidenceParts: string[] = [];
	for (const ev of inputs.evidenceSnippets) {
		const text = (ev.claim_text_norm ?? ev.claim_text ?? "").trim();
		if (text.length < 30) continue;
		// Skip money-dense snippets (likely financial rows, not narrative)
		const moneyCount = (text.match(/\$[\d,]/g) ?? []).length;
		const totalWords = text.split(/\s+/).filter(Boolean).length;
		if (totalWords > 0 && moneyCount / totalWords >= 0.12) continue;
		evidenceParts.push(text.slice(0, 300).replace(/\s+/g, " ").trim());
		if (evidenceParts.length >= 5) break;
	}
	if (evidenceParts.length > 0) {
		const joined = evidenceParts.join(" ").slice(0, MAX_CHARS).trim();
		if (joined.length >= 30) return joined;
	}

	return null;
}

// ─── Shared narrative bundle helper (PR36.9) ─────────────────────────────────

/**
 * Rank candidates and run contradiction detection in one pass.
 * Returns the combined selectedText + contradiction data as a RankedNarrativeBundle.
 *
 * This is the Phase 3 replacement for calling selectBestNarrativeCandidate inside
 * bundle section builders — it preserves runner-up data for contradiction routing.
 *
 * @internal — used only by bundle builders in this module.
 */
function selectWithContradiction(
	candidates: NarrativeCandidate[],
	topic: Parameters<typeof detectNarrativeContradiction>[1],
	opts?: { topN?: number; maxChars?: number },
): RankedNarrativeBundle {
	if (candidates.length === 0) return { selectedText: null, contradiction: null };

	const topN = opts?.topN ?? 3;
	const maxChars = opts?.maxChars ?? 1000;
	const threshold = TOPIC_MIN_THRESHOLD[topic];

	const ranked = rankNarrativeCandidates(candidates, topic);
	const qualified = ranked.filter((c) => c.score >= threshold);

	const selectedText =
		qualified.length === 0
			? null
			: qualified
					.slice(0, topN)
					.map((c) => c.text.trim())
					.join("\n\n")
					.slice(0, maxChars);

	// Run contradiction detection when ≥2 qualified candidates exist
	const contradiction =
		qualified.length >= 2 ? detectNarrativeContradiction(ranked, topic) : null;

	return { selectedText, contradiction };
}

// ─── Product narrative bundle builder (PR36.9) ───────────────────────────────

/**
 * Build a product narrative bundle from non-financial DPU deck pages.
 *
 * Like buildProductNarrativeBody but returns structured contradiction data
 * alongside the body text. Callers in stage-3 should use this function to
 * forward contradiction signals to the LLM corpus.
 */
export function buildProductNarrativeBundle(inputs: InsightSlotInputs): RankedNarrativeBundle {
	const PRODUCT_KW_RE =
		/\b(?:product|platform|solution|technology|we\s+(?:help|build|provide|enable|serve|power)|our\s+(?:platform|product|solution|technology|tool|software)|problem|pain\s+point|customers?|users?|clients?|mission|vision|founded|raises?|builds?)\b/i;
	// Skip use-of-funds / capital-raise / hiring slides (same guard as buildProductNarrativeBody).
	const CAPITAL_RAISE_SKIP_RE =
		/\b(?:capital\s+(?:raise|allocation|round)|use\s+of\s+funds?|this\s+(?:round|raise)\s+(?:will|to)\s+(?:enable|fund|support)|strategic\s+hires?\s+to\b)\b/i;
	const MAX_CHARS = 800;
	const candidates: NarrativeCandidate[] = [];

	for (const page of inputs.dpuPages) {
		const text = page.text ?? "";
		// Skip SPAC / shell-entity financial statement pages — not target-company evidence.
		if (isSpacShellEntityPage(text)) continue;
		const moneyCount = (text.match(/\$[\d,]/g) ?? []).length;
		const totalWords = text.split(/\s+/).filter(Boolean).length;
		if (totalWords > 0 && moneyCount / totalWords >= 0.12) continue;
		if (CAPITAL_RAISE_SKIP_RE.test(text)) continue;
		if (!PRODUCT_KW_RE.test(text)) continue;
		const excerpt = text.slice(0, 500).replace(/\s+/g, " ").trim();
		if (!excerpt || excerpt.length < 30) continue;
		candidates.push({ text: excerpt, meta: { sourceType: "raw_ocr_page" } });
	}

	return selectWithContradiction(candidates, "product_differentiation", {
		topN: 3,
		maxChars: MAX_CHARS,
	});
}

// ─── Stage 1: Deterministic Insight Slots ───────────────────────────────────────
/**
 * Stage 1 slot reason codes (NotComputable cases).
 * UPPER_SNAKE_CASE per reason-code format enforcement.
 */
const SLOT_REASON_CODES = {
	NO_RAISE_MENTION: "NO_RAISE_MENTION",
	NO_MARKET_CLAIM_MENTION: "NO_MARKET_CLAIM_MENTION",
	NO_TRACTION_SIGNAL_MENTION: "NO_TRACTION_SIGNAL_MENTION",
	NO_VALUATION_MENTION: "NO_VALUATION_MENTION",
	NO_USE_OF_FUNDS_MENTION: "NO_USE_OF_FUNDS_MENTION",
	STRUCTURED_JSON_UNAVAILABLE: "STRUCTURED_JSON_UNAVAILABLE",
	DPU_LOAD_FAILED: "DPU_LOAD_FAILED",
	/** Slot was promoted from XLSX-derived financial facts (not text patterns). */
	DERIVED_FROM_FINANCIALS: "DERIVED_FROM_FINANCIALS",
	/** Slot was promoted from a parsed Use-of-Funds XLSX section (not text patterns). */
	DERIVED_FROM_USE_OF_FUNDS: "DERIVED_FROM_USE_OF_FUNDS",
	/** Slot was promoted from an operational budget model (implied allocation — not stated raise). */
	DERIVED_FROM_BUDGET_MODEL: "DERIVED_FROM_BUDGET_MODEL",
	/** Slot was promoted from an income-statement expense breakdown (implied allocation — not stated raise). */
	DERIVED_FROM_INCOME_STATEMENT: "DERIVED_FROM_INCOME_STATEMENT",
	/** Phase 2 canonical field derived from SaaS KPI XLSX data. */
	DERIVED_FROM_SAAS_KPI: "DERIVED_FROM_SAAS_KPI",
	/** Phase 2 canonical field derived from balance sheet XLSX data. */
	DERIVED_FROM_BALANCE_SHEET: "DERIVED_FROM_BALANCE_SHEET",
	/** Phase 2 canonical field derived from cash flow XLSX data. */
	DERIVED_FROM_CASH_FLOW: "DERIVED_FROM_CASH_FLOW",
	/** Phase 2 canonical field derived from cap table XLSX data. */
	DERIVED_FROM_CAP_TABLE: "DERIVED_FROM_CAP_TABLE",
} as const;

type SlotReasonCode = (typeof SLOT_REASON_CODES)[keyof typeof SLOT_REASON_CODES];

interface SlotResult {
	computable: boolean;
	value: string | null;
	evidence: string | null;
	reasonCode: SlotReasonCode | null;
}

export interface DpuPage {
	document_id: string;
	page_index: number;
	/** Normalized OCR text — used by all detectors. */
	text: string;
	/** Original OCR output before normalization. */
	text_raw: string;
	/** Number of normalization transform events applied to this page. */
	norm_events_count: number;
}

export interface EvidenceSnippet {
	id: string;
	claim_text: string | null;
	/** Normalized form of claim_text, or null when claim_text was empty/null. */
	claim_text_norm: string | null;
}

interface DpuDiagnostics {
	queryOk: boolean;
	rowCount: number;
	usablePageCount: number;
	sample: string;
	errorMessage?: string;
	errorCode?: string;
}

/**
 * A single traction fact row from deal_facts_v1 (type = 'traction_metric').
 * Loaded by loadInsightSlotInputs for use in traction scoring.
 */
export interface DealTractionFact {
	fact_id: string;
	type: string;
	label: string;
	value: { kind: "money"; value: number; currency?: string }
	       | { kind: "number"; value: number; unit?: string }
	       | { kind: unknown; value?: unknown };
	timeframe: string | null;
	confidence: "high" | "medium" | "low";
}

export interface InsightSlotInputs {
	dpuPages: DpuPage[];
	evidenceSnippets: EvidenceSnippet[];
	/** True when the DPU query itself threw (block-level failure). */
	dpuLoadFailed: boolean;
	/** Derived from G3 gate result. */
	g3Passed: boolean;
	dpuDiag: DpuDiagnostics;
	/** All normalization transform events collected during data load. */
	normEvents: NormalizationEvent[];
	/** Financial statements parsed from XLSX DPU payloads (excel_range pages). */
	financialStatements: FinancialStatementV1[];
	/** Best-selected financial statement across all XLSX documents, or null if none found. */
	bestFinancialStatement: FinancialStatementV1 | null;
	/** Use-of-Funds statements parsed from XLSX DPU payloads. */
	useOfFundsStatements: UseOfFundsV1[];
	/** Best-selected Use-of-Funds statement, or null if none found. */
	bestUseOfFundsStatement: UseOfFundsV1 | null;
	/**
	 * Implied capital allocation derived from Budget/Employee Costs XLSX sheets.
	 * Present only for deals where no explicit Use-of-Funds exists but budget model sheets are available.
	 */
	impliedCapitalAllocation: ImpliedCapitalAllocationV1 | null;
	/**
	 * Implied capital allocation derived from an income-statement expense breakdown.
	 * 3rd-level fallback; only used when both UoF parser and budget model are absent.
	 */
	impliedFromIncomeStatement: IncomeStatementAllocationV1 | null;
	/**
	 * Deterministic financial layout classification for all XLSX pages in this deal.
	 * Used to route parsers and build the financial_layout_classifier_v1 section.
	 */
	financialLayoutClassification: DealLayoutClassificationV1 | null;
	/**
	 * Deterministic cross-check reconciliation of revenue, expense, allocation,
	 * and raise data.  Built after all parsers have run.
	 */
	financialReconciliation: FinancialReconciliationV1 | null;
	// Phase K: new parsed financial document types
	balanceSheet:  BalanceSheetV1 | null;
	cashFlow:      CashFlowStatementV1 | null;
	capTable:      CapTableV1 | null;
	saasKpis:      SaasKpisV1 | null;
	bankTransactions: BankTransactionsV1 | null;
	/**
	 * Deck-derived financial signal mentions extracted from pitch-deck DPU text.
	 * Present for PDF/PPT-only deals; null when no financial mentions found.
	 */
	deckFinancialSignals: DeckFinancialSignalsV1 | null;
	/**
	 * Workbook-intelligence facts: FinancialFactV1 rows derived from the Phase 2
	 * XLSX workbook modules (table-detector → financial-model-interpreter →
	 * metric-promoter). Populated from excel_range and excel_sheet DPU pages.
	 *
	 * These flow into buildFinancialFactRegistryV1 and are merged with facts from
	 * other sources using the existing confidence-based dedup logic.
	 * Temporal scope (historical/current/projected/scenario) is preserved on each fact.
	 */
	workbookFacts: FinancialFactV1[];
	/**
	 * Cross-source reconciliation summary computed in step 8 of
	 * buildFinancialFactRegistryV1 (Phase 3).  Populated by the processor after
	 * the financial fact registry is built; undefined until then.
	 *
	 * Exposes aggregate counts (supported / conflicting / deck_only / workbook_only
	 * / projected_only / unresolved) and per-metric conflict details for use by
	 * downstream section builders and contradiction-alignment logic.
	 */
	crossSourceReconciliation?: CrossSourceReconciliationSummary | null;
	/**
	 * Financial coverage profile computed from the finalised fact registry.
	 * Populated by the processor (Phase 9) after the registry is built.
	 */
	financialCoverage?: FinancialCoverageV1 | null;
	/**
	 * Flat list of metric conflicts detected across financial-fact sources.
	 * Populated by the processor (Phase 9) after the registry is built.
	 */
	financialConflicts?: FinancialConflictV1[];
	/**
	 * Investor-facing risk flags derived from coverage + conflicts.
	 * Populated by the processor (Phase 9) after the registry is built.
	 */
	financialRiskFlags?: string[];
	/**
	 * Structured traction facts loaded from deal_facts_v1 (type='traction_metric').
	 * Used by scoreTractionSignal as a higher-quality alternative to text extraction
	 * when workbook facts are absent or incomplete.
	 */
	dealTractionFacts: DealTractionFact[];
	/**
	 * Titles of documents uploaded for this deal, fetched from the documents table.
	 * Used as the filenames signal in resolveCanonicalIdentity so that stems like
	 * "PD - Verse.pdf" can surface brand candidates without deal-specific hacks.
	 */
	documentTitles: string[];
	/**
	 * Financial Truth Resolution Layer V1 output.
	 * Populated by buildFinancialTruthV1 in the processor after buildFinancialFactRegistryV1 runs.
	 * null/undefined when the FTRL has not run yet (e.g. early gate-fail paths).
	 */
	financialTruth?: import("../../../lib/financial-facts/build-financial-truth-v1.js").FinancialTruthMapV1 | null;
	/**
	 * Raw financial facts loaded from financial_facts_v1 at the start of each run.
	 * Written by populateFinancialFactRegistryV1 (analyze-deal job) via
	 * extract-financial-table-claims.ts — which can surface facts (e.g.
	 * cash_outflow_operating) that the Stage-2 workbook-intelligence path misses.
	 *
	 * Passed to buildFinancialFactRegistryV1 as existingDbFacts so that
	 * reconcileFinancialFactsV1 Rules 4/4b can derive burn_rate and runway_months.
	 * Never written back to DB from this merge (runtime-only, FTRL input only).
	 */
	existingDbFacts: FinancialFactV1[];
}


// ── Slot detection patterns (compile once) ───────────────────────────────────

/**
 * MARKET_CLAIMS: matches both keyword-first and dollar-first forms:
 *   Form A (keyword → $): "TAM $10B", "total addressable market $10B"
 *   Form B ($ → keyword): "$10.5B+ TAM", "$600-900M TAM SAM SOM"
 *   Form C (market size → $): "Market Sizes (USD) $212B"
 *   Form D ($ → market size): "$212B ... Market Sizes (USD)"
 *
 * Amount format: $<digits>[,<digits>][.<digits>][-<range>][K|M|B|T][+]
 * Anchor tokens: TAM, SAM, SOM, "total addressable market", "addressable market",
 *                "market size[s]"
 * Added Forms C+D on 20260225 (detector_gap=7, Carmoola evidence: "$212B Market Sizes").
 */
const MARKET_PATTERN =
	/(?:\bTAM\b|\bSAM\b|\bSOM\b|\btotal\s+addressable\s+market\b|\baddressable\s+market\b)[^$\n]{0,60}?\$[\d,]+(?:\.\d+)?(?:\s*-\s*[\d,]+(?:\.\d+)?)?\s*[BbMmKkTt]?\+?|\$[\d,]+(?:\.\d+)?(?:\s*-\s*[\d,]+(?:\.\d+)?)?\s*[BbMmKkTt]\+?[^$\n]{0,60}?(?:\bTAM\b|\bSAM\b|\bSOM\b|\btotal\s+addressable\s+market\b|\baddressable\s+market\b)|\bmarket\s+size[s]?\b[^$\n]{0,80}?\$[\d,]+(?:\.\d+)?(?:\s*-\s*[\d,]+(?:\.\d+)?)?\s*[BbMmKkTt]?\+?|\$[\d,]+(?:\.\d+)?(?:\s*-\s*[\d,]+(?:\.\d+)?)?\s*[BbMmKkTt]\+?[^$\n]{0,80}?\bmarket\s+size[s]?\b/i;

/**
 * SPAC_SHELL_ENTITY_RE — matches pages that are primarily from a SPAC /
 * blank-check-company financial filing rather than the target operating company.
 *
 * These pages describe the shell vehicle's standalone economics:
 *   • trust-account income ("investments held in the Trust Account")
 *   • warrant/derivative fair-value changes ("change in fair value of derivative liabilities")
 *   • SPAC merger accounting ("initial business combination", "blank check company")
 *
 * Pages matching this pattern must NOT be surfaced as target-company evidence in
 * the narrative corpus, regardless of which other keywords they contain.
 */
const SPAC_SHELL_ENTITY_RE =
	/change in fair value of (?:derivative|warrant|earnout|pipe)\s*liabilities|investments held in (?:the )?Trust Account|initial business combination|blank check company/i;

/** Returns true when page text belongs to a SPAC / shell entity filing, not the target company. */
function isSpacShellEntityPage(text: string): boolean {
	return SPAC_SHELL_ENTITY_RE.test(text);
}

/**
 * TRACTION_SIGNAL: matches "MRR $50K", "ARR $600K",
 * "monthly recurring revenue $50K", "annual recurring revenue $2M".
 */
const TRACTION_PATTERN =
	/(?:\bMRR\b|\bARR\b|\bmonthly\s+recurring\s+revenue\b|\bannual\s+recurring\s+revenue\b)(?:[^$\n]{0,60})?\$[\d,.]+\s*[BMKbmk]?/i;

/**
 * TRACTION_PCT_PATTERN: matches percentage-based traction claims that don't
 * carry a dollar amount. Anchored to recognised traction metric keywords so
 * that non-traction percentages (e.g. "30% allocation", "50% equity stake")
 * are excluded.
 *
 * Keyword-first forms (kw → %):
 *   "demo-to-close 50%", "retention ratio of 60%", "churn rate 5%",
 *   "lift 20–300%", "win rate 40%", "NPS 72"
 * Percent-first forms (% → kw):
 *   "50% demo-to-close", "20% churn", "300% lift"
 *
 * PCT_VALUE: supports plain integers, decimals, and ranges (20–300%, 5-10%).
 */
const _TRACTION_PCT_KW = String.raw`(?:demo[- ]to[- ]close|close\s+rate|conversion\s+rate?|retention(?:\s+(?:ratio|rate))?|churn(?:\s+rate)?|lift|engagement(?:\s+rate)?|activation(?:\s+rate)?|nps\b|net\s+promoter|upsell(?:\s+rate)?|win\s+rate)`;
const _PCT_VALUE = String.raw`\d+(?:\.\d+)?(?:\s*[–\-]\s*\d+(?:\.\d+)?)?\s*%`;
const TRACTION_PCT_PATTERN = new RegExp(
	// keyword → % (up to 60 chars of non-newline between them)
	`\\b${_TRACTION_PCT_KW}\\b[^\\n]{0,60}?${_PCT_VALUE}` +
	// % → keyword (up to 60 chars between them)
	`|${_PCT_VALUE}[^\\n]{0,60}?\\b${_TRACTION_PCT_KW}\\b`,
	"i"
);

/**
 * VALUATION_TERMS: matches "valuation", "post-money", "pre-money", "safe cap", "cap".
 */
const VALUATION_PATTERN = /(valuation|post[- ]money|pre[- ]money|safe cap|cap)\b/i;

/**
 * USE_OF_FUNDS: matches investor-deck phrases that signal a use-of-funds section.
 *
 * Original forms:
 *   "use of funds", "use of proceeds", "allocation of proceeds",
 *   "proceeds will be used"
 *
 * Added (audit-evidence driven — 20260225 coverage baseline, detector_gap=8):
 *   Form U1: "use of capital"          — common slide-header variant (e.g. "Use of Capital")
 *   Form U2: "allocation of funds"     — e.g. "allocation of funds: 40% marketing, 30% R&D"
 *   Form U3: "capital allocation"      — repeated pattern in Palm / Palm3 decks:
 *                                         "CAPITAL ALLOCATION", "Capital Allocation Detail"
 *   Form U4: "funds will be (used|deployed|allocated)" — conservative verb-phrase form
 *
 * Conservative anchoring: all new forms are compound keyword phrases unlikely to appear
 * in non-use-of-funds contexts (e.g. "capital allocation" on an investor pitch always
 * refers to deployment of raise proceeds, not cap-structure or equity).
 */
const USE_OF_FUNDS_PATTERN =
	/(?:use\s+of\s+(?:funds|proceeds|capital)|allocation\s+of\s+(?:funds|proceeds)|proceeds\s+will\s+be\s+used|capital\s+allocation|funds\s+will\s+be\s+(?:used|deployed|allocated))\b/i;

/**
 * Segment a raw label-text string (text that follows the last `%` on an allocation slide)
 * into individual category-label tokens by splitting at capital-letter word boundaries.
 * Strips standalone numbers (page numbers) and the word "Ask".
 *
 * Example input:  "People / Hiring Go-to-Market Product / Engineering Contingency 15 Ask"
 * Example output: ["People / Hiring", "Go-to-Market", "Product / Engineering", "Contingency"]
 */
function segmentAllocationLabels(text: string): string[] {
	const cleaned = text
		.replace(/\b\d{1,4}\b\s*/g, "")   // remove standalone numbers (page numbers etc.)
		.replace(/\bask\b\s*/gi, "")       // remove "Ask" (slide heading echoed at bottom)
		.replace(/\s{2,}/g, " ")             // collapse internal whitespace
		.trim();
	if (!cleaned) return [];
	return cleaned
		.split(/(?<=[a-z&])\s+(?=[A-Z])/) // split before caps that follow lowercase
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

/**
 * Detect an "allocation slide" that presents percentage splits without the
 * standard "Use of Funds" header — e.g. DealDecisionAI deck page 14:
 *   "The Ask  $2M Pre-Seed  ...  40%  30%  20%  10%  People / Hiring  Go-to-Market
 *    Product / Engineering  Contingency"
 *
 * Detection criteria:
 *   1. Page must match ASK_SLIDE_HEADING_RE (explicit ask / raising / deal-terms heading).
 *   2. Page must contain 3–6 percentage values that sum to 80–120%.
 *   3. At least 2 category-label segments must appear after the last percentage.
 *
 * Returns a compact bucket summary string:
 *   "Use of funds (deck): People / Hiring 40%, Go-to-Market 30%, ..."
 */
function detectAskSlideAllocation(
	pages: DpuPage[]
): { snippet: string; ref: string } | null {
	for (const page of pages) {
		const text = page.text ?? "";
		if (!ASK_SLIDE_HEADING_RE.test(text)) continue;

		// Collect percentages (5–100%) and track the end-position of the last one.
		const percents: number[] = [];
		let lastPctEnd = -1;
		for (const pm of text.matchAll(/\b(\d{1,3})%/g)) {
			const v = parseInt(pm[1]!, 10);
			if (v >= 5 && v <= 100) {
				percents.push(v);
				lastPctEnd = pm.index! + pm[0].length;
			}
		}
		if (percents.length < 3 || percents.length > 6) continue;
		const sum = percents.reduce((a, b) => a + b, 0);
		if (sum < 80 || sum > 120) continue;

		// Extract label segments from the text AFTER the last percentage token.
		const afterText = text.slice(lastPctEnd, lastPctEnd + 300);
		const labelSegments = segmentAllocationLabels(afterText).slice(0, percents.length);
		if (labelSegments.length < 2) continue;

		// Build compact "Label pct%" bucket string.
		const buckets: string[] = percents.map((pct, i) => {
			const label = labelSegments[i] ?? `Bucket ${i + 1}`;
			return `${label} ${pct}%`;
		});
		const snippet = `Use of funds (deck): ${buckets.join(", ")}`;
		return { snippet: snippet.slice(0, 200), ref: dpuEvidenceRef(page.document_id, page.page_index) };
	}
	return null;
}

// ── Shared currency/money building blocks (used by both Stage 1 slots and Phase 2 canonical) ──

/**
 * Building blocks for currency-aware money fragments.
 *   CURRENCY: "$", "€", "£", or word codes USD / EUR / GBP.
 *   AMOUNT:   digit sequence with optional comma separators and decimal.
 *   SUFFIX:   optional magnitude suffix (K/M/B/T, double-letter MM/BB, or words).
 *   MONEY_FRAGMENT: full currency-amount-suffix token used across all extraction patterns.
 *
 * Examples that MUST match: "$1.5MM", "$6MM", "$800,000", "€5.6M", "EUR 5.6M",
 *                            "£2M", "USD 2.5M", "1.5MM", "$1.5 million"
 */
const CURRENCY       = String.raw`(?:\$|€|£|\bUSD\b|\bEUR\b|\bGBP\b)`;
const AMOUNT         = String.raw`\d{1,3}(?:[,\d]{0,3})*(?:\.\d+)?`;
const SUFFIX         = String.raw`(?:\s*(?:MM|BB|[KMBTkmbt]|thousand|million|billion|trillion)\b)?`;
const MONEY_FRAGMENT = String.raw`${CURRENCY}\s*${AMOUNT}${SUFFIX}`;

/**
 * Wildcard span that refuses to cross another currency token or a newline.
 * Used in patterns that allow free text between a money token and a keyword.
 */
const _NO_CUR = `[^$€£\\n]`;

/**
 * _RAISE_ADVERB: optional quantifier / approximation adverb that may appear
 * between a RAISE_ANCHOR verb and the money amount.
 * Handles real-world OCR output such as "raising approximately $10M" (3ICE),
 * "seeking about $2M", "raise roughly £3M", "offering up to $5M".
 * The trailing `\s*` absorbs any whitespace after the adverb so that
 * MONEY_FRAGMENT begins immediately.
 */
const _RAISE_ADVERB = String.raw`(?:approximately|about|around|roughly|~\s*|over|under|nearly|some|a\s+total\s+of|up\s+to|at\s+least|just\s+over)?\s*`;

/**
 * RAISE_ANCHOR: full list of word anchors signalling a raise context.
 * Used in RAISE_AMOUNT_PATTERN Forms A, B, G, H.
 */
const RAISE_ANCHOR = String.raw`(?:rais(?:e|ing|ed)|seeking|fund(?:ed|ing)?|financ(?:ed|ing)?|invest(?:ment|ing)?|offer(?:ing)?|proceeds|allocation)`;

/**
 * RAISE_AMOUNT_PATTERN: comprehensive raise-detection covering Forms A–H.
 * Used for BOTH Stage 1 raise_terms slot and Phase 2 canonical raise_amount field.
 *
 * Form A: "Raising $2M seed", "raise $5M Series A", "seeking $1M",
 *           "raising approximately $10M" (3ICE — adverb between verb and amount)
 * Form B: "$1.5MM raise", "Equity $1.5MM raise on a $6MM Valuation"
 * Form C: "Capital Raise ... $1.5MM"
 * Form D: "$2M seed round", "$3M bridge raise"
 * Form E: "€5.6M raised to date", "EUR 5.6M funded" (money-first, past-tense)
 * Form F: "raised €5.6M", "has raised USD 2.0M to date", "Total raised: €5.6M" (verb-first)
 * Form G: "Raise: $4M", "Raised: €5.6M", "Seeking: a $2M" (colon + optional article — OCR label)
 * Form H: "Financial Strategy Raise: a $4M" (slide-layout label prefix + raise + money)
 *
 */
const RAISE_AMOUNT_PATTERN = new RegExp(
	// Form A: raise/seek/fund/finance/invest/offer verb/noun optionally followed by an
	// approximation adverb (e.g. "approximately", "about", "roughly") then money.
	// FIX(3ICE): "raising approximately $10M" — _RAISE_ADVERB absorbs the adverb.
	`${RAISE_ANCHOR}\\s+${_RAISE_ADVERB}${MONEY_FRAGMENT}` +
	// Form B: money then raise-word within ~40 chars
	`|${MONEY_FRAGMENT}${_NO_CUR}{0,40}?\\b${RAISE_ANCHOR}\\b` +
	// Form C: label-first — capital raise / round size / ticket size / proceeds / allocation then money
	`|\\b(?:capital\\s+raise|round\\s+size|ticket\\s+size|proceeds|allocation)\\b${_NO_CUR}{0,40}?${MONEY_FRAGMENT}` +
	// Form D: money immediately before a round-type keyword
	`|${MONEY_FRAGMENT}\\s+(?:seed|series\\s+[a-cA-C]|pre[-\\s]seed|bridge)\\s*(?:round|raise|funding)?` +
	// Form E: money first, then past-tense funding phrase within ~60 chars
	`|${MONEY_FRAGMENT}${_NO_CUR}{0,60}?\\b(?:raised(?:\\s+to\\s+date)?|funded|funding\\s+to\\s+date|financed|investment)\\b` +
	// Form F: past-tense funding phrase first, then money within ~60 chars; colon between is allowed
	`|\\b(?:raised(?:\\s+to\\s+date)?|funded|funding\\s+to\\s+date|financed|investment)\\b${_NO_CUR}{0,60}?${MONEY_FRAGMENT}` +
	// Form G: raise-anchor + colon + optional indefinite article + money
	// Matches: "Raise: $4M", "Raised: €5.6M", "Seeking: a $2M seed", "Total raised: €5.6M"
	`|\\b${RAISE_ANCHOR}\\s*:\\s*(?:a\\b\\s*|an\\b\\s*)?${MONEY_FRAGMENT}` +
	// Form H: slide-layout label prefix, then raise keyword (with optional colon/article), then money
	// Matches: "Financial Strategy Raise: a $4M", "Investment Strategy Raise $5M"
	`|\\b(?:financial\\s+strategy|capital\\s+strategy|investment\\s+strategy|funding\\s+strategy)\\b${_NO_CUR}{0,60}?\\braise\\b${_NO_CUR}{0,20}?${MONEY_FRAGMENT}`,
	"i"
);

/**
 * RAISE_RANGE_PATTERN: variant of RAISE_AMOUNT_PATTERN that captures the full
 * low–high range when the deck expresses a range instead of a single figure.
 *
 * Range separator: en-dash (–), hyphen (-), or the word "to".
 *
 * Form R-A: "raising $2M–$4M", "raise $2M to $4M", "seeking $500K-$1M"
 * Form R-B: "$2M–$4M Raise", "$500K-$1M raise" (money-range then anchor)
 * Form R-G: "Raise: $2M–$4M", "Seeking: $500K-$1M"  (colon-label form)
 * Form R-H: "Financial Strategy Raise: $2M–$4M"      (slide-layout prefix)
 *
 * Evaluated BEFORE RAISE_AMOUNT_PATTERN in evalRaiseTermsSlot so the range
 * is preserved rather than only the first figure being captured.
 */
const _RANGE_SEP = String.raw`\s*(?:–|-|to)\s*`;
const RAISE_RANGE_PATTERN = new RegExp(
	// Form R-A: raise-anchor + optional adverb immediately followed by money RANGE
	// e.g. "raising approximately $2M–$4M"
	`${RAISE_ANCHOR}\\s+${_RAISE_ADVERB}${MONEY_FRAGMENT}${_RANGE_SEP}${MONEY_FRAGMENT}` +
	// Form R-B: money RANGE then raise-anchor within ~40 chars (e.g. "$2M–$4M Raise")
	`|${MONEY_FRAGMENT}${_RANGE_SEP}${MONEY_FRAGMENT}${_NO_CUR}{0,40}?\\b${RAISE_ANCHOR}\\b` +
	// Form R-G: raise-anchor + colon + optional article + money RANGE
	`|\\b${RAISE_ANCHOR}\\s*:\\s*(?:a\\b\\s*|an\\b\\s*)?${MONEY_FRAGMENT}${_RANGE_SEP}${MONEY_FRAGMENT}` +
	// Form R-H: slide-layout prefix + raise keyword + money RANGE
	`|\\b(?:financial\\s+strategy|capital\\s+strategy|investment\\s+strategy|funding\\s+strategy)\\b${_NO_CUR}{0,60}?\\braise\\b${_NO_CUR}{0,20}?${MONEY_FRAGMENT}${_RANGE_SEP}${MONEY_FRAGMENT}`,
	"i"
);

// ── Raise context-gating: "Ask slide" priority + TAM/SAM/SOM exclusion ──────

/**
 * ASK_SLIDE_HEADING_RE: detects pages that explicitly announce a fundraise ask.
 *
 * A page matching this regex AND containing a RAISE_AMOUNT_PATTERN money token is a
 * strong/prioritised candidate for raise_amount — it wins over any earlier page in
 * document order that only contains an incidental raise-anchor word near a dollar figure.
 *
 * Patterns covered:
 *   "The Ask", "Our Ask", "Funding Ask", "Investment Ask",
 *   "We Are Raising", "We're Raising", "We Are Seeking",
 *   "What We're Raising", "What We Are Raising",
 *   "The Deal", "Deal Terms", "Raise Terms",
 *   "Pre-Seed Round", "Seed Round" (as a heading — followed by $ or raise verb)
 */
const ASK_SLIDE_HEADING_RE =
	/\b(?:the\s+ask|our\s+ask|funding\s+ask|investment\s+ask|we\s+are\s+(?:raising|seeking)|we'?re\s+(?:raising|seeking)|what\s+we(?:'re|\s+are)\s+(?:raising|seeking)|the\s+deal|deal\s+terms|raise\s+terms|round\s+details|funding\s+terms)\b/i;

/**
 * TAM_MARKET_CONTEXT_RE: the presence of any of these tokens near a raise-pattern match
 * indicates the dollar figure describes a market size, NOT a fundraise amount.
 *
 * Extended to cover:
 *   - plain "market", "industry", "sector", "gap", "opportunit*"
 *   - "total revenues?" and "revenue size"  — e.g. "total revenue of $11B"
 *
 * NOTE: this regex is now applied to BOTH money-first AND certain verb-first matches
 * (specifically "invest*" starters — see isRaiseMatchTainted below).
 */
const TAM_MARKET_CONTEXT_RE =
	// Note: plain "market" uses (?<!-)market(?!\w) — a negative lookbehind for hyphen
	// so that "go-to-market" (preceded by '-') does NOT trigger a taint.
	// Only uncompounded uses like "Tax Software Market $11B" will match.
	/\b(?:TAM|SAM|SOM|total\s+addressable\s+market|serviceable\s+addressable\s+market|serviceable\s+obtainable\s+market|addressable\s+market|market\s+size|market\s+opportunity|market\s+cap(?:italization)?|industry|sector|gap|opportunit|total\s+revenues?|revenue\s+size)\b|(?<!-)market(?!\w)/i;

/** Characters to inspect on each side of a raise-pattern match for TAM/SAM/SOM context. */
const TAM_TAINT_WINDOW = 200;

/**
 * STRONG_RAISE_VERB_PREFIX_RE: anchors that are *unambiguously* a fundraise context.
 * Only these are exempt from the market-taint check when they appear verb-first.
 *
 * NOT included: "invest*" — "investment opportunity $11B" is a market claim.
 * NOT included: "allocation", "proceeds" — ambiguous (could be use-of-funds).
 */
const STRONG_RAISE_VERB_PREFIX_RE = /^(?:rais|seek|fund(?:ed|ing)?|financ|offer(?:ing)?)/i;

/**
 * Returns true when the portion of `text` within TAM_TAINT_WINDOW characters of the
 * matched span contains a TAM/SAM/SOM / market-size keyword.
 * Used to reject raise-anchor matches that are actually market-sizing sentences.
 *
 * FIX (raise_amount pollution): The old code unconditionally skipped the taint check
 * for ALL verb-first matches ("if first char is a letter, return false").  This allowed
 * "investment opportunity of $11B Tax Software Market" to pass through because the
 * match starts with "investment" (a letter).  We now only exempt genuine fundraise
 * verb starters (rais.../seek.../fund.../financ.../offer...).  "invest..." is NOT exempt because
 * it is also used in market-context phrases ("investment opportunity", "investment gap").
 */
function isRaiseMatchTainted(text: string, matchIndex: number, matchLength: number): boolean {
	// Genuine fundraise-verb-first forms (e.g. "raising $2M", "seeking $500K",
	// "funding round of $3M") are reliable raise indicators — skip taint check.
	const matchStart = text.slice(matchIndex, matchIndex + 8);
	if (STRONG_RAISE_VERB_PREFIX_RE.test(matchStart)) return false;
	// All other matches — including money-first ("$8B investment") AND ambiguous
	// verb-first starters ("investment $11B", "allocation $5B") — check TAM context.
	const start = Math.max(0, matchIndex - TAM_TAINT_WINDOW);
	const end   = Math.min(text.length, matchIndex + matchLength + TAM_TAINT_WINDOW);
	return TAM_MARKET_CONTEXT_RE.test(text.slice(start, end));
}

/**
 * Priority-ordered, context-gated page scanner for raise amount patterns.
 *
 * Pass 1 — Ask slide priority:
 *   If any page has ASK_SLIDE_HEADING_RE AND a non-TAM-tainted RAISE match, return
 *   the first such page. This ensures "The Ask — $2M Pre-Seed" wins over earlier pages.
 *
 * Pass 2 — Clean (non-TAM) match:
 *   Return the first page where the pattern matches and the match is not TAM-tainted.
 *   This filters out TAM/SAM/SOM slides whose dollar figures incidentally fire
 *   raise-anchor words like "investment" or "allocation".
 *
 * Pass 3 — Fallback (original behaviour):
 *   Return the first page where the pattern matches at all (preserves existing
 *   behaviour for decks that genuinely embed only raise context inside market slides).
 */
function detectRaiseInPages(
	pages: DpuPage[],
	pattern: RegExp
): { snippet: string; ref: string } | null {
	// Pass 1: Ask-slide priority
	for (const page of pages) {
		const text = page.text ?? "";
		if (!ASK_SLIDE_HEADING_RE.test(text)) continue;
		const m = pattern.exec(text);
		if (m && !isRaiseMatchTainted(text, m.index, m[0].length)) {
			return { snippet: m[0].slice(0, 80), ref: dpuEvidenceRef(page.document_id, page.page_index) };
		}
	}
	// Pass 2: First non-TAM-tainted match (any page)
	for (const page of pages) {
		const text = page.text ?? "";
		const m = pattern.exec(text);
		if (m && !isRaiseMatchTainted(text, m.index, m[0].length)) {
			return { snippet: m[0].slice(0, 80), ref: dpuEvidenceRef(page.document_id, page.page_index) };
		}
	}
	// No clean match found — all matches were TAM/SAM/SOM-tainted or absent.
	// Return null rather than falling back to a tainted match.
	return null;
}

/**
 * Gated variant of detectInTextSources for raise patterns.
 * Uses detectRaiseInPages for DPU pages; unfiltered for evidence snippets
 * (snippets are already short contextual clips unlikely to contain TAM context).
 */
function detectRaiseInTextSources(
	pattern: RegExp,
	dpuPages: DpuPage[],
	evidenceSnippets: EvidenceSnippet[]
): { snippet: string; ref: string } | null {
	const dpuHit = detectRaiseInPages(dpuPages, pattern);
	if (dpuHit) return dpuHit;
	for (const ev of evidenceSnippets) {
		const text = ev.claim_text_norm ?? ev.claim_text ?? "";
		const m = pattern.exec(text);
		if (m) {
			const prefix = ev.id.replace(/-/g, "").slice(0, 8);
			return { snippet: m[0].slice(0, 80), ref: `evidence:item:${prefix}` };
		}
	}
	return null;
}

/**
 * Variant of detectAllMatchesForConflict for raise amounts.
 * Excludes matches that are TAM/SAM/SOM-tainted so that cross-page conflict
 * detection works against genuine raise figures only.
 */
function detectRaiseAllMatchesForConflict(
	pages: DpuPage[],
	pattern: RegExp
): Array<{ snippet: string; ref: string; normalized: string }> {
	return pages.flatMap((page) => {
		const text = page.text ?? "";
		const m = pattern.exec(text);
		if (!m) return [];
		if (isRaiseMatchTainted(text, m.index, m[0].length)) return [];
		// PR27: skip pages containing fund-management / AUM language so that
		// "$100M Alternatives Fund" pages are never treated as raise candidates
		// in conflict detection (mirrors the PR24/PR26 guard in resolve-raise-amount
		// and deal-fusion).
		if (isCandidateTaintedByFundAumContext(text)) return [];
		// PR36.5: skip pages containing operational volume / throughput language
		// (cars financed, GMV, loan originations, etc.) so that Carmoola-class
		// volume figures are never treated as raise candidates in conflict detection.
		if (isCandidateTaintedByVolumeMetric(text) && !hasStrongRaiseSignal(text)) return [];
		const snippet = m[0].slice(0, 80);
		return [{
			snippet,
			ref: dpuEvidenceRef(page.document_id, page.page_index),
			normalized: normalizeAmountForConflict(snippet),
		}];
	});
}

// ── Market-sizing triad extractor ─────────────────────────────────────────────

// ── ARR context guard ─────────────────────────────────────────────────────────

/**
 * Returns true when the context window around an ARR match contains market/segment
 * language indicating the ARR figure describes an external market rather than the
 * company's own metric.
 *
 * Company-ownership override: if ARR_COMPANY_OWNERSHIP_RE fires in the window,
 * the match is never tainted regardless of market keywords present.
 *
 * True-positive examples (tainted → suppressed):
 *   "The $200M ARR market segment"          → "market segment" near ARR
 *   "ARR market size: $1.5B"               → "market size" near ARR
 *   "industry ARR pool of $300M"           → "industry" near ARR
 *
 * True-negative examples (not tainted → kept):
 *   "Our ARR is $200M"                     → COMPANY_OWNERSHIP override fires
 *   "ARR reached $10M in Q3"              → no market language in window
 *   "$3M ARR growing 200% YoY"            → traction slide
 */
function isArrMatchTainted(text: string, matchIndex: number, matchLength: number): boolean {
	const start  = Math.max(0, matchIndex - ARR_TAINT_WINDOW);
	const end    = Math.min(text.length, matchIndex + matchLength + ARR_TAINT_WINDOW);
	const window = text.slice(start, end);
	// Company ownership override — skip further taint check
	if (ARR_COMPANY_OWNERSHIP_RE.test(window)) return false;
	return ARR_MARKET_TAINT_RE.test(window);
}

/**
 * Context-gated detect function for arr_value.
 * Skips ARR matches whose context window contains market/industry language.
 * Falls back to unfiltered evidence snippets (already short clips).
 */
function detectArrInTextSources(
	pattern: RegExp,
	dpuPages: DpuPage[],
	evidenceSnippets: EvidenceSnippet[]
): { snippet: string; ref: string } | null {
	for (const page of dpuPages) {
		const text = page.text ?? "";
		const m = pattern.exec(text);
		if (m && !isArrMatchTainted(text, m.index, m[0].length)) {
			return { snippet: m[0].slice(0, 80), ref: dpuEvidenceRef(page.document_id, page.page_index) };
		}
	}
	// Evidence snippets are short contextual clips — use unfiltered (less likely to contain market language)
	for (const ev of evidenceSnippets) {
		const text = ev.claim_text_norm ?? ev.claim_text ?? "";
		const m = pattern.exec(text);
		if (m) {
			const prefix = ev.id.replace(/-/g, "").slice(0, 8);
			return { snippet: m[0].slice(0, 80), ref: `evidence:item:${prefix}` };
		}
	}
	return null;
}

// ── Valuation competitor context guard ────────────────────────────────────────

/**
 * Returns true when the context window around a valuation match contains signals
 * that the valuation belongs to a competitor or external entity rather than the
 * company presenting the deck.
 *
 * Form A (post-money explicit prefix) is never tainted — it unambiguously refers
 * to the company's own transaction valuation.
 *
 * Company-ownership override: if VALUATION_COMPANY_OWNERSHIP_RE fires in the window,
 * the match is never tainted.
 *
 * True-positive examples (tainted → suppressed):
 *   "Our competitor has a $8B valuation"   → "competitor" near valuation
 *   "industry leader valued at $8B"       → "industry leader"
 *   "comparable companies at $8B val"     → "comparable"
 *   "publicly traded comps at $8B"        → "publicly traded"
 *
 * True-negative examples (not tainted → kept):
 *   "post-money valuation $10M"           → form A, never tainted
 *   "we are valued at $10M"              → COMPANY_OWNERSHIP override
 *   "$6MM Valuation — our SAFE cap"       → "our" in window
 */
function isValuationMatchTainted(text: string, matchIndex: number, matchLength: number): boolean {
	const matchText = text.slice(matchIndex, matchIndex + matchLength);
	// Form A: explicit post-money prefix — never tainted (unambiguous company transaction)
	if (/^post[-\s]money/i.test(matchText)) return false;
	const start  = Math.max(0, matchIndex - VALUATION_TAINT_WINDOW);
	const end    = Math.min(text.length, matchIndex + matchLength + VALUATION_TAINT_WINDOW);
	const window = text.slice(start, end);
	// Company ownership override
	if (VALUATION_COMPANY_OWNERSHIP_RE.test(window)) return false;
	return VALUATION_COMPETITOR_TAINT_RE.test(window);
}

/**
 * Context-gated detect function for valuation_post.
 * Skips valuation matches whose context window contains competitor/external signals.
 *
 * NOTE: Evidence snippets are intentionally NOT used as a fallback here. Short clips
 * lack the surrounding context (e.g., a "Competitive Landscape" slide heading) needed
 * to verify ownership. A missed valuation is safer than surfacing a competitor's figure.
 */
function detectValuationPostInTextSources(
	pattern: RegExp,
	dpuPages: DpuPage[],
	_evidenceSnippets: EvidenceSnippet[]
): { snippet: string; ref: string } | null {
	for (const page of dpuPages) {
		const text = page.text ?? "";
		const m = pattern.exec(text);
		if (m && !isValuationMatchTainted(text, m.index, m[0].length)) {
			return { snippet: m[0].slice(0, 80), ref: dpuEvidenceRef(page.document_id, page.page_index) };
		}
	}
	// Evidence snippets intentionally not used — see doc comment above.
	return null;
}

/**
 * Detects a line containing all three market-sizing labels TAM, SAM, SOM.
 * Handles both orderings (TAM→SAM→SOM and SOM→SAM→TAM).
 */
const MARKET_SIZING_TRIAD_RE =
	/\bTAM\b[^\n]{0,80}\bSAM\b[^\n]{0,80}\bSOM\b|\bSOM\b[^\n]{0,80}\bSAM\b[^\n]{0,80}\bTAM\b/i;

/**
 * Broad money pattern for market-sizing extraction.
 * Captures single values ($10.5B+), ranges ($600-900M), and OCR-artifact ranges
 * ($3.5°-4B where ° is a misread dash — captures $3.5 at minimum).
 * Global flag required for matchAll / exec-loop use.
 */
const BROAD_MONEY_VALUE_RE =
	/[\$€£]\s*[\d,.]+(?:\s*[\-\u2013\u2014]\s*[\d,.]+)?\s*[BbMmKkTt]?\+?/g;

/**
 * Extract TAM, SAM, SOM canonical values from a DPU page where the three labels
 * appear together (e.g. in a slide column layout).
 *
 * Handles the pitch-deck OCR layout where money values appear BEFORE labels:
 *   "$10.5B+  $3.5°-4B  $600-900M  TAM  SAM  SOM"
 * and the standard label-first layout:
 *   "TAM $10.5B  SAM $3.5B  SOM $600-900M"
 *
 * Positional pairing: 1st money ↔ TAM, 2nd money ↔ SAM, 3rd money ↔ SOM.
 * This aligns with standard pitch deck column ordering (largest → smallest).
 */
function detectMarketSizingTriad(
	pages: DpuPage[]
): { tam: string | null; sam: string | null; som: string | null; ref: string } | null {
	for (const page of pages) {
		const text = page.text ?? "";
		const triadMatch = MARKET_SIZING_TRIAD_RE.exec(text);
		if (!triadMatch) continue;

		// Expand context: up to 400 chars before the triad match to capture
		// preceding money values, plus the match itself plus a short buffer.
		const ctxStart = Math.max(0, triadMatch.index - 400);
		const ctxEnd   = Math.min(text.length, triadMatch.index + triadMatch[0].length + 80);
		const context  = text.slice(ctxStart, ctxEnd);

		// Extract all money values in left-to-right order.
		BROAD_MONEY_VALUE_RE.lastIndex = 0;
		const moneyValues: string[] = [];
		let mv: RegExpExecArray | null;
		while ((mv = BROAD_MONEY_VALUE_RE.exec(context)) !== null) {
			// Normalise: strip trailing + (means "more than") and collapse whitespace.
			moneyValues.push(mv[0].replace(/\+$/, "").replace(/\s+/g, "").trim());
		}

		if (moneyValues.length < 3) continue;

		return {
			tam: moneyValues[0] ?? null,
			sam: moneyValues[1] ?? null,
			som: moneyValues[2] ?? null,
			ref: dpuEvidenceRef(page.document_id, page.page_index),
		};
	}
	return null;
}

// ── MRR context guard ─────────────────────────────────────────────────────────

/**
 * Returns true when the context window around an MRR match contains market/segment
 * language indicating the MRR figure describes an external market rather than the
 * company's own metric.
 *
 * Company-ownership override: if MRR_COMPANY_OWNERSHIP_RE fires in the window,
 * the match is never tainted regardless of market keywords present.
 *
 * True-positive examples (tainted → suppressed):
 *   "total MRR market of $500M"              → "market" near MRR
 *   "industry MRR pool: $2B"                 → "industry" near MRR
 *   "MRR market opportunity: $300M"           → "market opportunity"
 *
 * True-negative examples (not tainted → kept):
 *   "our MRR is $200K"                       → COMPANY_OWNERSHIP override fires
 *   "MRR reached $50K in Q3"                 → traction slide
 *   "current MRR: $120K"                     → no market language in window
 */
function isMrrMatchTainted(text: string, matchIndex: number, matchLength: number): boolean {
	const start  = Math.max(0, matchIndex - MRR_TAINT_WINDOW);
	const end    = Math.min(text.length, matchIndex + matchLength + MRR_TAINT_WINDOW);
	const window = text.slice(start, end);
	if (MRR_COMPANY_OWNERSHIP_RE.test(window)) return false;
	return MRR_MARKET_TAINT_RE.test(window);
}

/**
 * Context-gated detect function for mrr_value.
 * Skips MRR matches whose context window contains market/industry language.
 * Falls back to unfiltered evidence snippets (already short clips).
 */
function detectMrrInTextSources(
	pattern: RegExp,
	dpuPages: DpuPage[],
	evidenceSnippets: EvidenceSnippet[]
): { snippet: string; ref: string } | null {
	for (const page of dpuPages) {
		const text = page.text ?? "";
		const m = pattern.exec(text);
		if (m && !isMrrMatchTainted(text, m.index, m[0].length)) {
			return { snippet: m[0].slice(0, 80), ref: dpuEvidenceRef(page.document_id, page.page_index) };
		}
	}
	// Evidence snippets are short contextual clips — use unfiltered
	for (const ev of evidenceSnippets) {
		const text = ev.claim_text_norm ?? ev.claim_text ?? "";
		const m = pattern.exec(text);
		if (m) {
			const prefix = ev.id.replace(/-/g, "").slice(0, 8);
			return { snippet: m[0].slice(0, 80), ref: `evidence:item:${prefix}` };
		}
	}
	return null;
}

// ── Revenue context guard ─────────────────────────────────────────────────────

/**
 * Returns true when the context window around a revenue match contains market/
 * sector language indicating the revenue figure describes an external market or
 * competitor rather than the company's own revenue.
 *
 * Company-ownership override: if REVENUE_COMPANY_OWNERSHIP_RE fires in the window,
 * the match is never tainted regardless of market keywords present.
 *
 * True-positive examples (tainted → suppressed):
 *   "market revenue opportunity: $5B"        → "market revenue"
 *   "industry revenue pool of $2B"           → "industry revenue"
 *   "competitor revenue: $8B"                → "competitor" near revenue
 *
 * True-negative examples (not tainted → kept):
 *   "our revenue is $500K"                   → COMPANY_OWNERSHIP override fires
 *   "revenue reached $1M in 2024"            → traction slide
 *   "annual revenue: $800K"                  → no market language in window
 */
function isRevenueMatchTainted(text: string, matchIndex: number, matchLength: number): boolean {
	const start  = Math.max(0, matchIndex - REVENUE_TAINT_WINDOW);
	const end    = Math.min(text.length, matchIndex + matchLength + REVENUE_TAINT_WINDOW);
	const window = text.slice(start, end);
	if (REVENUE_COMPANY_OWNERSHIP_RE.test(window)) return false;
	return REVENUE_MARKET_TAINT_RE.test(window);
}

/**
 * Context-gated detect function for revenue_value.
 * Skips revenue matches whose context window contains market/competitor language.
 * Falls back to unfiltered evidence snippets.
 */
function detectRevenueInTextSources(
	pattern: RegExp,
	dpuPages: DpuPage[],
	evidenceSnippets: EvidenceSnippet[]
): { snippet: string; ref: string } | null {
	for (const page of dpuPages) {
		const text = page.text ?? "";
		const m = pattern.exec(text);
		if (m && !isRevenueMatchTainted(text, m.index, m[0].length)) {
			return { snippet: m[0].slice(0, 80), ref: dpuEvidenceRef(page.document_id, page.page_index) };
		}
	}
	// Evidence snippets are short contextual clips — use unfiltered
	for (const ev of evidenceSnippets) {
		const text = ev.claim_text_norm ?? ev.claim_text ?? "";
		const m = pattern.exec(text);
		if (m) {
			const prefix = ev.id.replace(/-/g, "").slice(0, 8);
			return { snippet: m[0].slice(0, 80), ref: `evidence:item:${prefix}` };
		}
	}
	return null;
}

// ── Customer count context guard ──────────────────────────────────────────────

/**
 * Returns true when the context window around a customer count match contains
 * signals that the count belongs to a competitor or is an industry benchmark
 * rather than the company's own customer base.
 *
 * Company-ownership override: if CUSTOMER_COMPANY_OWNERSHIP_RE fires in the window,
 * the match is never tainted.
 *
 * True-positive examples (tainted → suppressed):
 *   "competitors serve 10,000 customers"     → "competitor" near count
 *   "industry average of 500 customers"      → "industry average"
 *   "market leader with 1M customers"        → "market leader"
 *
 * True-negative examples (not tainted → kept):
 *   "we have 120 customers"                  → COMPANY_OWNERSHIP override fires
 *   "our customer base: 450"                 → company metric
 *   "currently serving 200 clients"          → active company context
 */
function isCustomerCountTainted(text: string, matchIndex: number, matchLength: number): boolean {
	const start  = Math.max(0, matchIndex - CUSTOMER_TAINT_WINDOW);
	const end    = Math.min(text.length, matchIndex + matchLength + CUSTOMER_TAINT_WINDOW);
	const window = text.slice(start, end);
	if (CUSTOMER_COMPANY_OWNERSHIP_RE.test(window)) return false;
	return CUSTOMER_COMPETITOR_TAINT_RE.test(window);
}

/**
 * Context-gated detect function for customer_count.
 * Skips customer count matches whose context window contains competitor/benchmark signals.
 * Falls back to unfiltered evidence snippets.
 */
function detectCustomerCountInTextSources(
	pattern: RegExp,
	dpuPages: DpuPage[],
	evidenceSnippets: EvidenceSnippet[]
): { snippet: string; ref: string } | null {
	for (const page of dpuPages) {
		const text = page.text ?? "";
		const m = pattern.exec(text);
		if (m && !isCustomerCountTainted(text, m.index, m[0].length)) {
			return { snippet: m[0].slice(0, 80), ref: dpuEvidenceRef(page.document_id, page.page_index) };
		}
	}
	// Evidence snippets are short contextual clips — use unfiltered
	for (const ev of evidenceSnippets) {
		const text = ev.claim_text_norm ?? ev.claim_text ?? "";
		const m = pattern.exec(text);
		if (m) {
			const prefix = ev.id.replace(/-/g, "").slice(0, 8);
			return { snippet: m[0].slice(0, 80), ref: `evidence:item:${prefix}` };
		}
	}
	return null;
}

// ── Data loader ───────────────────────────────────────────────────────────────

/**
 * Extract the best available text from a raw DPU payload object.
 * Prefers payload.page_text over payload.normalized_text.
 * Returns null if neither is present or non-empty.
 */
function extractDpuText(payload: unknown): string | null {
	if (payload === null || typeof payload !== "object") return null;
	const p = payload as Record<string, unknown>;
	const text = typeof p["page_text"] === "string" ? p["page_text"]
		: typeof p["normalized_text"] === "string" ? p["normalized_text"]
		: null;
	return text && text.trim().length > 0 ? text : null;
}

/**
 * Deduplicate workbook facts by (metric_key, period_label, source_kind).
 *
 * Multiple XLSX rows (e.g. "Sales 1" $8K vs "Sales 4" $0) can produce
 * conflicting FinancialFactV1 entries for the same period because `makeFactId`
 * in metric-promoter includes `value_raw` in the hash, giving each row a
 * distinct fact_id.  Without this dedup, both facts accumulate in the DB.
 *
 * Resolution order per group:
 *  1. Non-zero value beats zero value.
 *  2. Higher absolute value wins.
 *  3. Lexicographically smaller fact_id (deterministic tiebreaker).
 */
function deduplicateWorkbookFacts(facts: FinancialFactV1[]): FinancialFactV1[] {
	const best = new Map<string, FinancialFactV1>();
	for (const f of facts) {
		const key = `${f.metric_key}:${f.period_label}:${f.source_kind}`;
		const existing = best.get(key);
		if (!existing) {
			best.set(key, f);
			continue;
		}
		const existingIsZero = existing.value === 0;
		const incomingIsZero = f.value === 0;
		if (existingIsZero && !incomingIsZero) {
			best.set(key, f); // non-zero beats zero
		} else if (!existingIsZero && incomingIsZero) {
			// keep existing non-zero
		} else if (Math.abs(f.value) > Math.abs(existing.value)) {
			best.set(key, f); // higher absolute value wins
		} else if (Math.abs(f.value) === Math.abs(existing.value) && f.fact_id < existing.fact_id) {
			best.set(key, f); // deterministic tiebreaker
		}
	}
	return Array.from(best.values());
}

/**
 * Load DPU page texts and evidence snippets for Stage 1 slot extraction.
 * Best-effort: DPU load failure sets dpuLoadFailed=true; all slots become NotComputable.

 */
async function loadInsightSlotInputs(
	pool: Pool,
	dealId: string,
	gateState: GateState
): Promise<InsightSlotInputs> {
	const g3Passed = gateState.results.find((r) => r.gate === "G3")?.passed === true;
	let dpuPages: DpuPage[] = [];
	let evidenceSnippets: EvidenceSnippet[] = [];
	let dpuLoadFailed = false;
	const dpuDiag: DpuDiagnostics = { queryOk: false, rowCount: 0, usablePageCount: 0, sample: "n/a" };
	const allNormEvents: NormalizationEvent[] = [];
	let financialStatements: FinancialStatementV1[] = [];
	let useOfFundsStatements: UseOfFundsV1[] = [];
	let impliedCapitalAllocation: ImpliedCapitalAllocationV1 | null = null;
	let impliedFromIncomeStatement: IncomeStatementAllocationV1 | null = null;
	let financialLayoutClassification: DealLayoutClassificationV1 | null = null;
	let financialReconciliation: FinancialReconciliationV1 | null = null;
	let deckFinancialSignals: DeckFinancialSignalsV1 | null = null;
	// Phase K: new financial document type accumulators
	const balanceSheets:    BalanceSheetV1[] = [];
	const cashFlows:        CashFlowStatementV1[] = [];
	const capTables:        CapTableV1[] = [];
	const saasKpisAll:      SaasKpisV1[] = [];
	let   bankTransactions: BankTransactionsV1 | null = null;
	// Phase 2 workbook intelligence accumulator
	const workbookFacts:    FinancialFactV1[] = [];
	// deal_facts_v1 traction metrics — loaded non-fatally after main try/catch
	let dealTractionFacts:  DealTractionFact[] = [];
	// Existing DB facts (financial_facts_v1) — loaded non-fatally as FTRL secondary input
	let existingDbFacts:    FinancialFactV1[] = [];

	try {
		const { rows } = await pool.query<{ document_id: string; page_index: number; payload: unknown }>(
			`SELECT document_id,
			        page_index,
			        payload
			   FROM public.document_page_understanding
			  WHERE deal_id = $1
			  ORDER BY document_id ASC, page_index ASC
			  LIMIT 500`,
			[dealId]
		);
		dpuDiag.queryOk = true;
		dpuDiag.rowCount = rows.length;
		dpuPages = rows
			.map((r) => {
				const raw = extractDpuText(r.payload);
				if (!raw) return null;
				const norm = normalizeForExtraction(raw);
				allNormEvents.push(...norm.events);
				return {
					document_id: r.document_id,
					page_index: r.page_index,
					text: norm.text,
					text_raw: raw,
					norm_events_count: norm.events.length,
				};
			})
			.filter((p): p is DpuPage => p !== null);
		dpuDiag.usablePageCount = dpuPages.length;
		if (dpuPages.length > 0) {
			const first = dpuPages[0]!;
			dpuDiag.sample = `${first.page_index}: ${first.text.slice(0, 120)}`;
		}
		// Extract deck financial signals from pitch-deck text pages.
		deckFinancialSignals = extractDeckFinancialSignalsV1(dpuPages);
		// Parse financial statements and use-of-funds from excel_range DPU pages.
		for (const r of rows) {
			const p = r.payload as Record<string, unknown> | null;
			if (!p || p["page_type"] !== "excel_range") continue;
			const pageRef = `dpu:doc:${r.document_id.replace(/-/g, "").slice(0, 8)}:page:${r.page_index}`;
			const stmt = parseFinancialStatementV1(r.payload, { documentId: r.document_id, pageRef });
			if (stmt) financialStatements.push(stmt);
			const uof = parseUseOfFundsV1(r.payload, { documentId: r.document_id, pageRef });
			if (uof) useOfFundsStatements.push(uof);
			const incomeStmt = parseImpliedCapitalIncomeStatementV1(r.payload, { documentId: r.document_id, pageRef });
			if (incomeStmt && impliedFromIncomeStatement === null) impliedFromIncomeStatement = incomeStmt;
			// Phase K: new financial document parsers
			const bs = parseBalanceSheetV1(r.payload, { documentId: r.document_id, pageRef });
			if (bs) balanceSheets.push(bs);
			const cf = parseCashFlowStatementV1(r.payload, { documentId: r.document_id, pageRef });
			if (cf) cashFlows.push(cf);
			const ct = parseCapTableV1(r.payload, { documentId: r.document_id, pageRef });
			if (ct) capTables.push(ct);
			const kpi = parseSaasKpisV1(r.payload, { documentId: r.document_id, pageRef });
			if (kpi) saasKpisAll.push(kpi);
			const btxn = parseBankTransactionsV1(r.payload, { documentId: r.document_id, pageRef });
			if (btxn && bankTransactions === null) bankTransactions = btxn;
			// Phase 2 workbook intelligence: detect tables → interpret → promote
			try {
				const wbPayload = { ...((r.payload as Record<string, unknown>) ?? {}), page_type: "excel_range" };
				const tables = detectFinancialTables(wbPayload);
				for (const table of tables) {
					const metrics = parseFinancialTable(table, {
						deal_id: dealId,
						document_id: r.document_id,
						page_index: r.page_index,
						slide_title: table.sheet_name,
					});
					const promoted = promoteToFinancialFactV1(metrics, {
						deal_id: dealId,
						document_id: r.document_id,
						sheet_name: table.sheet_name,
					});
					workbookFacts.push(...promoted);
				}
			} catch {
				// Workbook intelligence failures are non-fatal; existing parsers are unaffected.
			}
		}

		// Parse implied capital allocation from excel_sheet DPU pages (structured_native_v1 fallback).
		// Group rows by document_id and run the parser per document; keep the best result.
		const docGroups = new Map<string, typeof rows>();
		for (const r of rows) {
			const grp = docGroups.get(r.document_id) ?? [];
			grp.push(r);
			docGroups.set(r.document_id, grp);
		}
		// Parse timeseries Use-of-Funds from excel_sheet pages (e.g. WebMax monthly spend plan).
		for (const r of rows) {
			const p = r.payload as Record<string, unknown> | null;
			if (!p || p["page_type"] !== "excel_sheet") continue;
			const pageRef = `dpu:doc:${r.document_id.replace(/-/g, "").slice(0, 8)}:page:${r.page_index}`;
			const tsUof = parseUseOfFundsTimeseriesV1(r.payload, { documentId: r.document_id, pageRef });
			if (tsUof) useOfFundsStatements.push(tsUof);
			// Phase 2 workbook intelligence for excel_sheet pages
			try {
				const tables = detectFinancialTables(r.payload);
				for (const table of tables) {
					const metrics = parseFinancialTable(table, {
						deal_id: dealId,
						document_id: r.document_id,
						page_index: r.page_index,
						slide_title: table.sheet_name,
					});
					const promoted = promoteToFinancialFactV1(metrics, {
						deal_id: dealId,
						document_id: r.document_id,
						sheet_name: table.sheet_name,
					});
					workbookFacts.push(...promoted);
				}
			} catch {
				// Workbook intelligence failures are non-fatal.
			}
		}

		// Classify XLSX layouts for the entire deal (all pages, all documents).
		financialLayoutClassification = classifyDealLayouts(
			dealId,
			rows.map((r) => ({ document_id: r.document_id, page_index: r.page_index, payload: r.payload }))
		);

		for (const [docId, docRows] of docGroups.entries()) {
			const candidate = parseImpliedCapitalAllocationV1(
				docRows.map((r) => ({
					document_id: r.document_id,
					page_index: r.page_index,
					payload: r.payload,
				})),
				{ documentId: docId }
			);
			if (
				candidate !== null &&
				(impliedCapitalAllocation === null ||
					candidate.diagnostics.parse_quality >
						impliedCapitalAllocation.diagnostics.parse_quality)
			) {
				impliedCapitalAllocation = candidate;
			}
		}
	} catch (err) {
		dpuLoadFailed = true;
		dpuDiag.queryOk = false;
		dpuDiag.errorMessage = (err instanceof Error ? err.message : String(err)).slice(0, 300);
		dpuDiag.errorCode = (err as Record<string, unknown>)["code"] as string | undefined;
		console.error(
			JSON.stringify({
				event: "INVESTOR_INSIGHTS_DPU_QUERY_FAILED",
				deal_id: dealId,
				err_code: dpuDiag.errorCode ?? null,
				err_message: dpuDiag.errorMessage ?? null,
			})
		);
	}

	await pool
		.query<{ id: string; claim_text: string | null }>(
			`SELECT evidence_id AS id, content_text AS claim_text FROM public.evidence_items WHERE deal_id = $1::uuid ORDER BY evidence_id ASC LIMIT 50`,
			// ORDER BY evidence_id ASC ensures deterministic evidence selection across re-runs
			[dealId]
		)
		.then(({ rows }) => {
			evidenceSnippets = rows.map((row) => {
				if (!row.claim_text) return { ...row, claim_text_norm: null };
				const norm = normalizeForExtraction(row.claim_text);
				allNormEvents.push(...norm.events);
				return { ...row, claim_text_norm: norm.text };
			});
		})
		.catch(() => {
			// Evidence snippets are supplemental; failure is non-fatal.
		});

	await pool
		.query<{ fact_id: string; type: string; label: string; value: unknown; timeframe: string | null; confidence: string }>(
			`SELECT fact_id, type, label, value, timeframe, confidence
			   FROM public.deal_facts_v1
			  WHERE deal_id = $1
			    AND type = 'traction_metric'
			  ORDER BY confidence DESC, fact_id ASC
			  LIMIT 100`,
			[dealId]
		)
		.then(({ rows }) => {
			dealTractionFacts = rows.map((r) => ({
				fact_id: r.fact_id,
				type: r.type,
				label: r.label,
				value: r.value as DealTractionFact["value"],
				timeframe: r.timeframe,
				confidence:
					r.confidence === "high" || r.confidence === "medium" || r.confidence === "low"
						? r.confidence
						: "low",
			}));
		})
		.catch(() => {
			// deal_facts_v1 traction facts are supplemental; failure is non-fatal.
		});

	// Fetch document titles for the canonical-identity resolver (Fix A).
	// Non-fatal: if the query fails, documentTitles stays empty and the filename
	// signal is simply absent from the resolver run.
	let documentTitles: string[] = [];
	await pool
		.query<{ title: string }>(
			`SELECT title
			   FROM public.documents
			  WHERE deal_id = $1
			    AND deleted_at IS NULL
			    AND title IS NOT NULL
			  ORDER BY uploaded_at ASC
			  LIMIT 50`,
			[dealId]
		)
		.then(({ rows }) => {
			documentTitles = rows.map((r) => r.title).filter((t) => t.length > 0);
		})
		.catch(() => {
			// Document titles are supplemental; failure is non-fatal.
		});

	// Load existing financial_facts_v1 rows as a secondary FTRL input.
	// These were written by populateFinancialFactRegistryV1 (analyze-deal job) via
	// extract-financial-table-claims.ts, which surfaces facts (e.g.
	// cash_outflow_operating) that the Stage-2 workbook path misses.
	// Used in buildFinancialFactRegistryV1 Section 7b. Non-fatal.
	await getFinancialFactsForDeal(pool, dealId, { limit: 500 })
		.then((facts) => { existingDbFacts = facts; })
		.catch(() => {
			// Existing DB facts are a supplemental FTRL input; failure is non-fatal.
		});

	const _bestStmt = pickBestStatement(financialStatements);
	const _bestUof  = pickBestUseOfFunds(useOfFundsStatements);
	const _bestBs   = pickBestBalanceSheet(balanceSheets);
	const _bestCf   = pickBestCashFlow(cashFlows);
	const _bestCt   = pickBestCapTable(capTables);
	const _bestKpi  = pickBestSaasKpis(saasKpisAll);
	financialReconciliation = reconcileFinancialsV1({
		dealId,
		financialStatement:        _bestStmt,
		useOfFunds:                _bestUof,
		impliedCapitalAllocation,
		incomeStatementAllocation: impliedFromIncomeStatement,
		balanceSheet:              _bestBs,
		cashFlow:                  _bestCf,
		capTable:                  _bestCt,
		saasKpis:                  _bestKpi,
	});

	return {
		dpuPages,
		evidenceSnippets,
		dpuLoadFailed,
		g3Passed,
		dpuDiag,
		normEvents: allNormEvents,
		financialStatements,
		bestFinancialStatement: _bestStmt,
		useOfFundsStatements,
		bestUseOfFundsStatement: _bestUof,
		impliedCapitalAllocation,
		impliedFromIncomeStatement,
		financialLayoutClassification,
		financialReconciliation,
		balanceSheet:     _bestBs,
		cashFlow:         _bestCf,
		capTable:         _bestCt,
		saasKpis:         _bestKpi,
		bankTransactions,
		deckFinancialSignals,
		workbookFacts: deduplicateWorkbookFacts(workbookFacts),
		dealTractionFacts,
		documentTitles,
		existingDbFacts,
	};
}


// ── Slot detectors ───────────────────────────────────────────────────────────

/**
 * Build a stable 8-hex-char evidence ref prefix from a DPU document UUID.
 * Strips hyphens first so the prefix is always drawn from hex digits only.
 */
function dpuEvidenceRef(documentId: string, pageIndex: number): string {
	const prefix = documentId.replace(/-/g, "").slice(0, 8);
	return `dpu:doc:${prefix}:page:${pageIndex}`;
}

function detectInPages(pages: DpuPage[], pattern: RegExp): { snippet: string; ref: string } | null {
	for (const page of pages) {
		const m = pattern.exec(page.text ?? "");
		if (m) {
			return {
				snippet: m[0].slice(0, 80),
				ref: dpuEvidenceRef(page.document_id, page.page_index),
			};
		}
	}
	return null;
}

/**
 * Try DPU pages first; fall back to evidence_items claim_text when DPU yields nothing.
 * Evidence ref format: `evidence:item:<8hex>` (UUID without hyphens, first 8 chars).
 */
function detectInTextSources(
	pattern: RegExp,
	dpuPages: DpuPage[],
	evidenceSnippets: EvidenceSnippet[]
): { snippet: string; ref: string } | null {
	const dpuHit = detectInPages(dpuPages, pattern);
	if (dpuHit) return dpuHit;
	for (const ev of evidenceSnippets) {
		const text = ev.claim_text_norm ?? ev.claim_text ?? "";
		const m = pattern.exec(text);
		if (m) {
			const prefix = ev.id.replace(/-/g, "").slice(0, 8);
			return { snippet: m[0].slice(0, 80), ref: `evidence:item:${prefix}` };
		}
	}
	return null;
}

function evalRaiseTermsSlot(inputs: InsightSlotInputs): SlotResult {
	if (inputs.dpuLoadFailed) {
		return { computable: false, value: null, evidence: null, reasonCode: SLOT_REASON_CODES.DPU_LOAD_FAILED };
	}
	// Try RAISE_RANGE_PATTERN first so that "$2M–$4M" ranges are preserved in the
	// output value rather than being truncated to only the first figure.
	// Fall back to RAISE_AMOUNT_PATTERN (Forms A–H) for single-figure raises.
	// Both share the same building blocks as Phase 2 canonical raise_amount.
	// Use the context-gated variant to exclude TAM/SAM/SOM market-size matches
	// and to prioritise explicit "Ask slide" pages over earlier incidental matches.
	const rangeHit = detectRaiseInTextSources(RAISE_RANGE_PATTERN, inputs.dpuPages, inputs.evidenceSnippets);
	if (rangeHit) {
		return { computable: true, value: rangeHit.snippet, evidence: rangeHit.ref, reasonCode: null };
	}
	const hit = detectRaiseInTextSources(RAISE_AMOUNT_PATTERN, inputs.dpuPages, inputs.evidenceSnippets);
	if (hit) {
		return { computable: true, value: hit.snippet, evidence: hit.ref, reasonCode: null };
	}
	return { computable: false, value: null, evidence: null, reasonCode: SLOT_REASON_CODES.NO_RAISE_MENTION };
}

function evalMarketClaimsSlot(inputs: InsightSlotInputs): SlotResult {
	if (inputs.dpuLoadFailed) {
		return { computable: false, value: null, evidence: null, reasonCode: SLOT_REASON_CODES.DPU_LOAD_FAILED };
	}
	const hit = detectInTextSources(MARKET_PATTERN, inputs.dpuPages, inputs.evidenceSnippets);
	if (hit) {
		return { computable: true, value: hit.snippet, evidence: hit.ref, reasonCode: null };
	}
	return { computable: false, value: null, evidence: null, reasonCode: SLOT_REASON_CODES.NO_MARKET_CLAIM_MENTION };
}

/**
 * Canonical→slot bridge: promote traction_signal to Computable using XLSX-derived
 * financial data when text-pattern detectors find nothing.
 *
 * Priority order:
 *   1. Revenue amount (derived.revenue_latest + first period label)
 *   2. YoY growth rate (derived.revenue_yoy_growth_pct + period range label)
 *
 * Projection leakage guard (Phase 1):
 *   When the first period's temporal_scope is "projected" or "scenario", the
 *   value is explicitly labeled with a scope qualifier (e.g., "(projected)").
 *   This prevents projected revenue from being silently treated as current
 *   company performance by downstream LLM stages.
 *
 * Returns null when the statement is absent or contains no promotable data.
 */
function promoteFromFinancials(statement: FinancialStatementV1 | null): SlotResult | null {
	if (!statement) return null;
	const ref = statement.source.page_ref;
	const periods = statement.periods;
	const rev = statement.derived?.revenue_latest;
	const yoy = statement.derived?.revenue_yoy_growth_pct;

	// Resolve temporal scope for the first period (most-recent, used for revenue_latest)
	const firstPeriodScope = statement.period_scopes?.[0] ?? "unknown";
	const firstPeriodQualifier = isProjectedScope(firstPeriodScope)
		? " " + temporalScopeLabel(firstPeriodScope)
		: "";

	// Option 1: revenue amount with period label — most informative
	if (typeof rev === "number" && rev > 0 && periods.length > 0) {
		const period = periods[0]!;
		const formatted = "$" + Math.round(rev).toLocaleString("en-US");
		const value = `Revenue detected: ${formatted}${firstPeriodQualifier} (${period}, XLSX)`;
		return { computable: true, value, evidence: ref, reasonCode: SLOT_REASON_CODES.DERIVED_FROM_FINANCIALS };
	}

	// Option 2: YoY growth rate when revenue_latest not available
	if (typeof yoy === "number" && periods.length >= 2) {
		const value = `Revenue growth detected: ${yoy.toFixed(1)}% (${periods[0]}->${periods[1]}, XLSX)`;
		return { computable: true, value, evidence: ref, reasonCode: SLOT_REASON_CODES.DERIVED_FROM_FINANCIALS };
	}

	return null;
}

/**
 * Canonical→slot bridge: promote use_of_funds to Computable using XLSX-parsed
 * Use-of-Funds data when text-pattern detectors find nothing.
 *
 * Emits a compact bucket summary, e.g.:
 *   "Use of funds: Product 40%, Sales 30%, G&A 20%, Other 10% (XLSX)"
 *
 * Guardrails:
 *   - Requires ≥2 buckets OR a total_amount line to accept (avoids singleton false positives)
 *   - Returns null when the statement is absent or too sparse
 */
function promoteFromUseOfFunds(uof: UseOfFundsV1 | null): SlotResult | null {
	if (!uof) return null;
	// Require at least 2 buckets OR a total amount as a quality guardrail
	if (uof.buckets.length < 2 && uof.total_amount === null) return null;

	const ref = uof.source.page_ref;
	const bucketSummary = uof.buckets
		.map((b) => {
			const parts: string[] = [b.category];
			if (b.percent !== null) parts.push(`${b.percent}%`);
			else if (b.amount !== null) parts.push(`$${b.amount.toLocaleString("en-US")}`);
			return parts.join(" ");
		})
		.join(", ");
	const totalHint = uof.total_amount !== null
		? ` / total $${uof.total_amount.toLocaleString("en-US")}`
		: "";
	const value = `Use of funds: ${bucketSummary}${totalHint} (XLSX)`;
	return { computable: true, value, evidence: ref, reasonCode: SLOT_REASON_CODES.DERIVED_FROM_USE_OF_FUNDS };
}

/**
 * Canonical→slot bridge: promote use_of_funds to Computable using an implied
 * capital allocation derived from operational budget model XLSX sheets.
 *
 * This is the last-resort bridge — used only when both text detection AND the
 * explicit Use-of-Funds parser yield nothing.  The output is explicitly labeled
 * as IMPLIED and never confused with a stated raise allocation.
 *
 * Guardrails:
 *   - Requires parse_quality ≥ 0.5 AND ≥ 2 buckets
 *   - Returns null when implied allocation is absent or too low quality
 */
function promoteFromBudgetModel(ica: ImpliedCapitalAllocationV1 | null): SlotResult | null {
	if (!ica) return null;
	if (ica.diagnostics.parse_quality < 0.5) return null;
	if (ica.buckets.length < 2) return null;

	const ref = ica.source.page_refs[0] ?? `dpu:doc:${ica.source.document_id.replace(/-/g, "").slice(0, 8)}:implied`;
	const topBuckets = ica.buckets.slice(0, 5);
	const bucketSummary = topBuckets
		.map((b) => {
			const parts: string[] = [b.category];
			if (b.pct_of_total !== null) parts.push(`${b.pct_of_total}%`);
			else if (b.annual_cost_usd !== null) parts.push(`$${b.annual_cost_usd.toLocaleString("en-US")}`);
			return parts.join(" ");
		})
		.join(", ");
	const totalHint = ica.total_annual_cost_usd !== null
		? ` / total $${ica.total_annual_cost_usd.toLocaleString("en-US")}`
		: "";
	const value = `[IMPLIED] Budget allocation (${ica.period_label}): ${bucketSummary}${totalHint} — derived from budget model, not stated raise allocation`;
	return { computable: true, value, evidence: ref, reasonCode: SLOT_REASON_CODES.DERIVED_FROM_BUDGET_MODEL };
}

/**
 * Canonical→slot bridge: promote use_of_funds to Computable using expense buckets
 * derived from an income statement.
 *
 * This is the 3rd-level last resort — used only when text detection, explicit UoF
 * parser, AND budget model all yield nothing.  Output is explicitly labeled IMPLIED.
 *
 * Guardrails:
 *   - Requires ≥2 buckets and total > 0
 *   - Returns null when allocation is absent or buckets too few
 */
function promoteFromIncomeStatement(
	isa: IncomeStatementAllocationV1 | null
): SlotResult | null {
	if (!isa) return null;
	if (isa.buckets.length < 2 || isa.total_annual_amount <= 0) return null;

	const ref = isa.source.page_ref;
	const topBuckets = isa.buckets.slice(0, 5);
	const bucketSummary = topBuckets
		.map((b) => `${b.category} ${b.pct_of_total}%`)
		.join(", ");
	const totalHint = ` / total $${isa.total_annual_amount.toLocaleString("en-US")}`;
	const value = `[IMPLIED] Expense allocation (${isa.period_label}): ${bucketSummary}${totalHint} — derived from income statement, not stated raise allocation`;
	return { computable: true, value, evidence: ref, reasonCode: SLOT_REASON_CODES.DERIVED_FROM_INCOME_STATEMENT };
}

function evalTractionSignalSlot(inputs: InsightSlotInputs): SlotResult {
	if (inputs.dpuLoadFailed) {
		return { computable: false, value: null, evidence: null, reasonCode: SLOT_REASON_CODES.DPU_LOAD_FAILED };
	}
	// TRACTION_PCT_PATTERN covers percentage-based traction claims (demo-to-close,
	// retention ratio, lift, churn rate, etc.) that carry no dollar amount.
	// Evaluated first so that %-based signals are not missed when MRR/ARR is absent.
	const pctHit = detectInTextSources(TRACTION_PCT_PATTERN, inputs.dpuPages, inputs.evidenceSnippets);
	if (pctHit) {
		return { computable: true, value: pctHit.snippet, evidence: pctHit.ref, reasonCode: null };
	}
	// Fall back to MRR/ARR dollar-amount traction signal.
	const hit = detectInTextSources(TRACTION_PATTERN, inputs.dpuPages, inputs.evidenceSnippets);
	if (hit) {
		return { computable: true, value: hit.snippet, evidence: hit.ref, reasonCode: null };
	}
	// Canonical→slot bridge: promote from XLSX financial facts when text patterns find nothing.
	const promoted = promoteFromFinancials(inputs.bestFinancialStatement);
	if (promoted) return promoted;

	return { computable: false, value: null, evidence: null, reasonCode: SLOT_REASON_CODES.NO_TRACTION_SIGNAL_MENTION };
}

function evalValuationTermsSlot(inputs: InsightSlotInputs): SlotResult {
	if (inputs.dpuLoadFailed) {
		return { computable: false, value: null, evidence: null, reasonCode: SLOT_REASON_CODES.DPU_LOAD_FAILED };
	}
	const hit = detectInTextSources(VALUATION_PATTERN, inputs.dpuPages, inputs.evidenceSnippets);
	if (hit) {
		return { computable: true, value: hit.snippet, evidence: hit.ref, reasonCode: null };
	}
	return { computable: false, value: null, evidence: null, reasonCode: SLOT_REASON_CODES.NO_VALUATION_MENTION };
}

function evalUseOfFundsSlot(inputs: InsightSlotInputs): SlotResult {
	if (inputs.dpuLoadFailed) {
		return { computable: false, value: null, evidence: null, reasonCode: SLOT_REASON_CODES.DPU_LOAD_FAILED };
	}
	const hit = detectInTextSources(USE_OF_FUNDS_PATTERN, inputs.dpuPages, inputs.evidenceSnippets);
	if (hit) {
		return { computable: true, value: hit.snippet, evidence: hit.ref, reasonCode: null };
	}
	// Ask-slide allocation detector: handles decks where the Use-of-Funds breakdown
	// is presented as a percentage table on the "The Ask" / raise slide rather than
	// with a standard "Use of Funds" header phrase.
	const askAllocation = detectAskSlideAllocation(inputs.dpuPages);
	if (askAllocation) {
		return { computable: true, value: askAllocation.snippet, evidence: askAllocation.ref, reasonCode: null };
	}
	// Canonical→slot bridge: promote from XLSX-parsed Use-of-Funds when text detectors find nothing.
	const promoted = promoteFromUseOfFunds(inputs.bestUseOfFundsStatement);
	if (promoted) return promoted;

	// Last-resort bridge: promote from implied capital allocation (operational budget model).
	// Only used when both text detection and explicit UoF parser yield nothing.
	const promotedFromBudget = promoteFromBudgetModel(inputs.impliedCapitalAllocation);
	if (promotedFromBudget) return promotedFromBudget;

	// 3rd-level last resort: promote from income-statement expense breakdown.
	const promotedFromIncomeStmt = promoteFromIncomeStatement(inputs.impliedFromIncomeStatement);
	if (promotedFromIncomeStmt) return promotedFromIncomeStmt;

	return { computable: false, value: null, evidence: null, reasonCode: SLOT_REASON_CODES.NO_USE_OF_FUNDS_MENTION };
}

/**
 * Format a single slot result as a pipe-delimited output line.
 *
 * The value snippet is sanitized before embedding:
 * - Pipe characters are replaced with "/" so the line format `name: state | value="..." | ...`
 *   is never broken by a `|` that appears inside the matched text (e.g. Excel cell separators).
 * - Double-quote characters inside the snippet are replaced with single quotes so the
 *   surrounding `value="..."` delimiters remain unambiguous.
 */
function formatSlotLine(name: string, result: SlotResult): string {
	if (result.computable && result.value !== null && result.evidence !== null) {
		const safeValue = result.value.replace(/\|/g, "/").replace(/"/g, "'");
		// Emit the reason code when set (e.g. DERIVED_FROM_FINANCIALS); fall back to "none".
		const reason = result.reasonCode ?? "none";
		return `${name}: Computable | value="${safeValue}" | evidence=${result.evidence} | reason=${reason}`;
	}
	return `${name}: NotComputable | value=none | evidence=none | reason=${result.reasonCode ?? "UNKNOWN"}`;
}

/**
 * Build the insight_slots section from pre-loaded DPU pages + evidence snippets.
 * All slot evaluations are deterministic (regex-only); no LLM calls.
 */
function buildInsightSlotsSection(inputs: InsightSlotInputs): RenderPackage["sections"][number] {
	const slots: Array<{ name: string; result: SlotResult }> = [
		{ name: "raise_terms", result: evalRaiseTermsSlot(inputs) },
		{ name: "market_claims", result: evalMarketClaimsSlot(inputs) },
		{ name: "traction_signal", result: evalTractionSignalSlot(inputs) },
		{ name: "valuation_terms", result: evalValuationTermsSlot(inputs) },
		{ name: "use_of_funds", result: evalUseOfFundsSlot(inputs) },
	];

	const lines = slots.map(({ name, result }) => formatSlotLine(name, result));

	return {
		key: "insight_slots",
		title: "Deterministic Insight Slots",
		kind: "message",
		body: lines.join("\n"),
		fallback: "Insight slot extraction unavailable.",
	};
}

/**
 * Build the DPU diagnostics debug section. Returns null in production or when DPU loaded fine.
 * Shown when query failed (dpuLoadFailed) or when query succeeded but yielded 0 usable pages.
 */
function buildDpuDiagnosticsSection(
	dealId: string,
	diag: DpuDiagnostics
): RenderPackage["sections"][number] | null {
	if (process.env["NODE_ENV"] === "production") return null;
	if (diag.queryOk && diag.usablePageCount > 0) return null;
	const lines = [
		"dev_only: true",
		"table: document_page_understanding",
		`deal_id: ${dealId}`,
		`query_ok: ${diag.queryOk}`,
		`row_count: ${diag.rowCount}`,
		`usable_pages: ${diag.usablePageCount}`,
		`sample: ${diag.sample}`,
		`error_code: ${diag.errorCode ?? "none"}`,
		`error: ${diag.errorMessage ?? "none"}`,
	];
	return {
		key: "debug.dpu_diagnostics",
		title: "Debug \u2014 DPU Diagnostics",
		kind: "message",
		body: lines.join("\n"),
		fallback: "DPU diagnostics unavailable.",
	};
}

/**
 * Build a dev-only signal visibility section showing which pages contain the
 * strongest money and keyword signals for manual debugging of low-DPU-coverage deals.
 * Returns null in production (NODE_ENV === 'production').
 */
function buildSignalVisibilitySection(
	inputs: InsightSlotInputs
): RenderPackage["sections"][number] | null {
	if (process.env["NODE_ENV"] === "production") return null;
	if (inputs.dpuPages.length === 0) return null;

	const MONEY_SIGNAL_RE = /[$€£%]|(?:[KMBT])\b/gi;
	const KEYWORD_RE = /\b(?:raise|raising|raised|valuation|post-money|pre-money|post money|pre money|TAM|SAM|SOM|ARR|MRR|revenue|use of funds|proceeds)\b/gi;

	function scoreAndTop(pages: DpuPage[], re: RegExp): Array<{ page: DpuPage; score: number }> {
		return pages
			.map((page) => {
				const text = page.text ?? "";
				const matches = text.match(new RegExp(re.source, re.flags)) ?? [];
				return { page, score: matches.length };
			})
			.filter((entry) => entry.score > 0)
			.sort((a, b) => b.score - a.score)
			.slice(0, 10);
	}

	const moneyTop = scoreAndTop(inputs.dpuPages, MONEY_SIGNAL_RE);
	const keywordTop = scoreAndTop(inputs.dpuPages, KEYWORD_RE);

	function formatEntry(entry: { page: DpuPage; score: number }): string {
		const ref = dpuEvidenceRef(entry.page.document_id, entry.page.page_index);
		const preview = (entry.page.text ?? "").slice(0, 120).replace(/\r?\n/g, " ");
		return `page=${entry.page.page_index} | ref=${ref} | score=${entry.score} | preview=${preview}`;
	}

	const lines: string[] = ["(dev-only) Omitted in production.", `dpu_page_count: ${inputs.dpuPages.length}`, "--- top money-signal pages ---"];
	if (moneyTop.length === 0) {
		lines.push("none");
	} else {
		lines.push(...moneyTop.map(formatEntry));
	}
	lines.push("--- top keyword pages ---");
	if (keywordTop.length === 0) {
		lines.push("none");
	} else {
		lines.push(...keywordTop.map(formatEntry));
	}

	return {
		key: "debug.signal_visibility",
		title: "Debug \u2014 Signal Visibility",
		kind: "message",
		body: lines.join("\n"),
		fallback: "Signal visibility data unavailable.",
	};
}

/**
 * Dev-only section summarising OCR normalization events collected during data load.
 * Omitted in production and when no transformations occurred.
 */
function buildNormalizationSummarySection(
	inputs: InsightSlotInputs
): RenderPackage["sections"][number] | null {
	if (process.env["NODE_ENV"] === "production") return null;
	if (inputs.normEvents.length === 0) return null;

	const byRule = new Map<string, number>();
	for (const ev of inputs.normEvents) {
		byRule.set(ev.rule, (byRule.get(ev.rule) ?? 0) + 1);
	}
	const ruleLines = Array.from(byRule.entries())
		.sort((a, b) => b[1] - a[1])
		.map(([rule, count]) => `  ${rule}: ${count}`);

	// Sample up to 5 events for quick inspection.
	const samples = inputs.normEvents.slice(0, 5).map(
		(ev) => `  [${ev.rule}] "${ev.before}" \u2192 "${ev.after}" | ctx: \u2026${ev.context.slice(0, 60)}\u2026`
	);

	const lines: string[] = [
		"(dev-only) Omitted in production.",
		`total_events: ${inputs.normEvents.length}`,
		"--- events by rule ---",
		...ruleLines,
		"--- samples (first 5) ---",
		...samples,
	];

	return {
		key: "debug.normalization_summary",
		title: "Debug \u2014 OCR Normalization Summary",
		kind: "message",
		body: lines.join("\n"),
		fallback: "Normalization summary unavailable.",
	};
}

/**
 * Debug section showing the highest-impact pages where normalization occurred.
 * Sorted by event count descending, capped at 20 entries.
 * Uses DpuPage.text_raw and DpuPage.text (already computed during loadInsightSlotInputs).
 * Re-runs normalizeForExtraction on text_raw to recover per-page rule list (pure/deterministic).
 *
 * How to verify:
 *   1. curl -X POST http://localhost:9001/api/v1/deals/<id>/investor-insights/generate
 *   2. curl http://localhost:9001/api/v1/deals/<id>/investor-insights | \
 *        jq -r '.render_package.sections[] | select(.key=="debug.normalization_diff") | .body'
 */
function buildNormalizationDiffSection(
	inputs: InsightSlotInputs
): RenderPackage["sections"][number] | null {
	if (process.env["NODE_ENV"] === "production") return null;

	const affectedPages = inputs.dpuPages.filter((p) => p.norm_events_count > 0);
	if (affectedPages.length === 0) return null;

	// Sort high-impact pages first, cap at 20 to keep body readable.
	const top20 = [...affectedPages]
		.sort((a, b) => b.norm_events_count - a.norm_events_count)
		.slice(0, 20);

	// Truncate a preview string, replacing pipe chars so the | delimiter stays unambiguous.
	const preview = (s: string, len = 120) =>
		s.replace(/\|/g, "/").replace(/\s+/g, " ").trim().slice(0, len);

	const entryLines = top20.map((page) => {
		const docPrefix = page.document_id.replace(/-/g, "").slice(0, 8);
		const ref = `dpu:doc:${docPrefix}:page:${page.page_index}`;
		// Re-run pure normalization to recover which rules fired on this exact page.
		const { events } = normalizeForExtraction(page.text_raw);
		const rules = [...new Set(events.map((e) => e.rule))].join(",") || "none";
		const raw = preview(page.text_raw);
		const norm = preview(page.text);
		return `page=${page.page_index} | ref=${ref} | events=${page.norm_events_count} | rules=${rules} | raw=${raw} | norm=${norm}`;
	});

	const lines: string[] = [
		"(dev-only) Omitted in production.",
		`total_events: ${inputs.normEvents.length}`,
		`affected_pages: ${affectedPages.length}`,
		...entryLines,
	];

	return {
		key: "debug.normalization_diff",
		title: "Debug \u2014 OCR Normalization Diff",
		kind: "message",
		body: lines.join("\n"),
		fallback: "Normalization diff unavailable.",
	};
}

/**
 * Build the financial_statement_v1 section from a parsed FinancialStatementV1.
 * Emits structured revenue series, derived growth metrics, and source diagnostics.
 *
 * Phase 1 addition: when period_scopes are available, the periods line annotates
 * each year with its temporal scope (e.g., "2024[historical], 2025[current],
 * 2026[projected]") so that downstream LLM stages have explicit temporal context
 * and cannot silently treat projected figures as current actuals.
 */
function buildFinancialStatementSection(stmt: FinancialStatementV1): RenderPackage["sections"][number] {
	// Build annotated periods string when scope data is available
	const periodsAnnotated = stmt.periods.map((p, i) => {
		const scope = stmt.period_scopes?.[i];
		return scope && scope !== "unknown" ? `${p}[${scope}]` : p;
	}).join(", ");

	const lines: string[] = [
		`schema_version: ${stmt.schema_version}`,
		`source: ${stmt.source.page_ref}`,
		`periods: ${periodsAnnotated}`,
	];
	if (stmt.revenue) lines.push(`revenue: ${formatRevenueSeries(stmt.revenue, stmt.periods)}`);
	if (stmt.gross_profit) lines.push(`gross_profit: ${formatRevenueSeries(stmt.gross_profit, stmt.periods)}`);
	if (stmt.total_expenses) lines.push(`total_expenses: ${formatRevenueSeries(stmt.total_expenses, stmt.periods)}`);
	if (stmt.derived?.revenue_latest !== undefined) {
		lines.push(`revenue_latest: $${stmt.derived.revenue_latest.toLocaleString("en-US")}`);
	}
	if (stmt.derived?.revenue_yoy_growth_pct != null) {
		lines.push(`revenue_yoy_growth: ${formatYoY(stmt.derived.revenue_yoy_growth_pct, stmt.periods)}`);
	}
	if (stmt.derived?.revenue_cagr_pct != null) {
		lines.push(`revenue_cagr: ${formatCAGR(stmt.derived.revenue_cagr_pct, stmt.periods)}`);
	}
	if (stmt.derived?.gross_margin_latest_pct != null) {
		lines.push(`gross_margin: ${formatGrossMargin(stmt.derived.gross_margin_latest_pct, stmt.periods)}`);
	}
	if (stmt.diagnostics?.matched_rows.length) {
		lines.push(`matched_rows: ${stmt.diagnostics.matched_rows.join(", ")}`);
	}
	if (stmt.diagnostics?.parse_warnings.length) {
		lines.push(`parse_warnings: ${stmt.diagnostics.parse_warnings.join("; ")}`);
	}
	return {
		key: "financial_statement_v1",
		title: "Financial Statement (XLSX)",
		kind: "message",
		body: lines.join("\n"),
		fallback: "Financial statement data unavailable.",
	};
}

/**
 * Build the financial_health_metrics_v1 section from derived fields of a
 * FinancialStatementV1.  Returns null when there are no derived metrics to
 * surface (e.g. sparse revenue data).
 */
function buildFinancialHealthMetricsSection(
	stmt: FinancialStatementV1
): RenderPackage["sections"][number] | null {
	const d = stmt.derived;
	if (!d) return null;

	const lines: string[] = [
		`schema_version: financial_health_metrics_v1`,
		`source: ${stmt.source.page_ref}`,
		`periods: ${stmt.periods.join(", ")}`,
	];

	if (d.revenue_latest != null) {
		// Phase 1: label projected revenue_latest explicitly so LLM cannot
		// silently treat it as current actuals.
		const firstScope = stmt.period_scopes?.[0] ?? "unknown";
		const scopeTag = isProjectedScope(firstScope) ? ` ${temporalScopeLabel(firstScope)}` : "";
		lines.push(`revenue_latest: $${d.revenue_latest.toLocaleString("en-US")}${scopeTag}`);
	}
	if (d.revenue_yoy_growth_pct != null) {
		lines.push(`revenue_yoy_growth_pct: ${d.revenue_yoy_growth_pct.toFixed(1)}%`);
	}
	if (d.revenue_cagr_pct != null) {
		lines.push(`revenue_cagr_pct: ${d.revenue_cagr_pct.toFixed(1)}%`);
	}
	if (d.gross_margin_latest_pct != null) {
		lines.push(`gross_margin_pct: ${d.gross_margin_latest_pct.toFixed(1)}%`);
	}

	// Cost-efficiency ratio: revenue / total_expenses for the first period.
	const firstPeriod = stmt.periods[0];
	if (firstPeriod && stmt.revenue && stmt.total_expenses) {
		const rev = stmt.revenue[firstPeriod] ?? 0;
		const exp = stmt.total_expenses[firstPeriod] ?? 0;
		if (rev > 0 && exp > 0) {
			lines.push(`cost_efficiency_ratio: ${(rev / exp).toFixed(2)}`);
		}
	}

	// If nothing beyond the header was added there's nothing useful to show.
	if (lines.length <= 3) return null;

	return {
		key: "financial_health_metrics_v1",
		title: "Financial Health Metrics (Derived)",
		kind: "message",
		body: lines.join("\n"),
		fallback: "Financial health metrics unavailable.",
	};
}

/**
 * Build the financial_layout_classifier_v1 section from deal-wide layout
 * classification results produced by `classifyDealLayouts()`.
 */
function buildFinancialLayoutClassifierSection(
	classification: DealLayoutClassificationV1
): RenderPackage["sections"][number] {
	const lines: string[] = [
		`schema_version: ${classification.schema_version}`,
		`total_xl_pages: ${classification.total_xl_pages}`,
		`classified_pages: ${classification.classified_pages}`,
		`layout_coverage_pct: ${classification.layout_coverage_pct.toFixed(1)}%`,
		`has_income_statement: ${classification.has_income_statement}`,
		`has_use_of_funds: ${classification.has_use_of_funds}`,
		`has_budget_model: ${classification.has_budget_model}`,
		`has_cap_table: ${classification.has_cap_table}`,
		`has_cash_flow: ${classification.has_cash_flow}`,
		`has_balance_sheet: ${classification.has_balance_sheet}`,
		`has_saas_kpis: ${classification.has_saas_kpis}`,
		`has_bank_txns: ${classification.has_bank_txns}`,
	];

	for (const doc of classification.documents) {
		lines.push(`doc: ${doc.doc_id} | dominant_layout: ${doc.dominant_layout} | pages: ${doc.page_count}`);
		for (const page of doc.layout_map) {
			lines.push(
				`  page[${page.page_index}] layout=${page.layout} confidence=${page.confidence}` +
					(page.sheet_title ? ` sheet="${page.sheet_title}"` : "") +
					(page.matched_signals.length ? ` signals=[${page.matched_signals.join(", ")}]` : "")
			);
		}
	}

	return {
		key: "financial_layout_classifier_v1",
		title: "Financial Layout Classification",
		kind: "message",
		body: lines.join("\n"),
		fallback: "Financial layout classification unavailable.",
	};
}

/**
 * Build the financial_reconciliation_v1 section from the deterministic
 * cross-check results produced by `reconcileFinancialsV1()`.
 */
function buildFinancialReconciliationSection(
	rec: FinancialReconciliationV1
): RenderPackage["sections"][number] {
	const STATUS_ICONS: Record<string, string> = {
		PASS: "✓",
		WARN: "⚠",
		FAIL: "✗",
		SKIP: "-",
	};
	const lines: string[] = [
		`schema_version: ${rec.schema_version}`,
		`confidence_score: ${rec.confidence_score.toFixed(2)}`,
		`data_sources: ${rec.data_sources_used.join(", ") || "none"}`,
	];
	for (const [flagKey, flag] of Object.entries(rec.flags)) {
		const icon = STATUS_ICONS[flag.status] ?? "?";
		lines.push(`${icon} ${flagKey}: ${flag.status} — ${flag.reason}`);
		if (flag.evidence_refs.length) {
			lines.push(`  evidence: ${flag.evidence_refs.join(", ")}`);
		}
		const numericVals = Object.entries(flag.values)
			.filter(([, v]) => v != null)
			.map(([k, v]) => `${k}=${typeof v === "number" ? v.toFixed(2) : v}`)
			.join(", ");
		if (numericVals) lines.push(`  values: ${numericVals}`);
	}
	return {
		key: "financial_reconciliation_v1",
		title: "Financial Reconciliation (Deterministic)",
		kind: "message",
		body: lines.join("\n"),
		fallback: "Financial reconciliation unavailable.",
	};
}

/**
 * Build the use_of_funds_v1 section from a parsed UseOfFundsV1.
 */
function buildUseOfFundsV1Section(uof: UseOfFundsV1): RenderPackage["sections"][number] {
	const lines: string[] = [
		`schema_version: ${uof.schema_version}`,
		`source: ${uof.source.page_ref}`,
		`buckets: ${uof.buckets.length}`,
	];
	for (const b of uof.buckets) {
		const parts: string[] = [b.category];
		if (b.amount !== null) parts.push(`$${b.amount.toLocaleString("en-US")}`);
		if (b.percent !== null) parts.push(`${b.percent}%`);
		lines.push(`  bucket: ${parts.join(" | ")}`);
	}
	if (uof.total_amount !== null) lines.push(`total_amount: $${uof.total_amount.toLocaleString("en-US")}`);
	if (uof.total_percent !== null) lines.push(`total_percent: ${uof.total_percent}%`);
	if (uof.diagnostics.parse_warnings.length) {
		lines.push(`parse_warnings: ${uof.diagnostics.parse_warnings.join("; ")}`);
	}
	return {
		key: "use_of_funds_v1",
		title: "Use of Funds (XLSX)",
		kind: "message",
		body: lines.join("\n"),
		fallback: "Use of funds data unavailable.",
	};
}

/**
 * Format an ImpliedCapitalAllocationV1 as natural-language text for the
 * governed-summary corpus (LLM input).  Uses explicit human-readable prose
 * so the LLM can include "implied" / "budget model" language in its output.
 * This is SEPARATE from buildImpliedCapitalAllocationSection which renders the
 * technical UI section.
 */
function formatImpliedCapitalForCorpus(ica: ImpliedCapitalAllocationV1): string {
	const lines: string[] = [
		`[IMPLIED from operational budget model — not an explicit raise allocation]`,
		`Inferred operational budget allocations (${ica.period_label}, derived from ${ica.diagnostics.sheets_used.join(" + ")} sheets):`,
	];
	for (const b of ica.buckets) {
		const costPart = b.annual_cost_usd !== null
			? `$${b.annual_cost_usd.toLocaleString("en-US")}/yr`
			: "n/a";
		const pctPart = b.pct_of_total !== null ? ` (${b.pct_of_total}%)` : "";
		lines.push(`- ${b.category}: ${costPart}${pctPart}`);
	}
	if (ica.total_annual_cost_usd !== null) {
		lines.push(
			`Total implied annual operational cost: $${ica.total_annual_cost_usd.toLocaleString("en-US")} [implied budget, not stated raise amount]`
		);
	}
	return lines.join("\n");
}

/**
 * Build the implied_capital_allocation_v1 section from an ImpliedCapitalAllocationV1.
 * Always labeled as IMPLIED — this is an estimation from budget/payroll data,
 * NOT a stated raise allocation.
 */
function buildImpliedCapitalAllocationSection(
	ica: ImpliedCapitalAllocationV1
): RenderPackage["sections"][number] {
	const lines: string[] = [
		`schema_version: ${ica.schema_version}`,
		`basis: ${ica.basis}`,
		`basis_note: ${ica.basis_note}`,
		`period: ${ica.period_label}`,
		`parse_quality: ${ica.diagnostics.parse_quality}`,
		`sheets_used: ${ica.diagnostics.sheets_used.join(", ")}`,
		`buckets: ${ica.buckets.length}`,
	];
	for (const b of ica.buckets) {
		const parts: string[] = [b.category];
		if (b.annual_cost_usd !== null) parts.push(`$${b.annual_cost_usd.toLocaleString("en-US")}/yr`);
		if (b.pct_of_total !== null) parts.push(`${b.pct_of_total}%`);
		parts.push(`[${b.source}]`);
		lines.push(`  bucket: ${parts.join(" | ")}`);
	}
	if (ica.total_annual_cost_usd !== null) {
		lines.push(`total_annual_cost: $${ica.total_annual_cost_usd.toLocaleString("en-US")}`);
	}
	if (ica.diagnostics.notes.length) {
		lines.push(`notes: ${ica.diagnostics.notes.join("; ")}`);
	}
	return {
		key: "implied_capital_allocation_v1",
		title: "Implied Capital Allocation (Budget Model) [IMPLIED]",
		kind: "message",
		body: lines.join("\n"),
		fallback: "Implied capital allocation data unavailable.",
	};
}

/**
 * Asynchronously build the governed_summary_v1 section using a cache-first
 * strategy.  If the deterministic input corpus is unchanged (same fingerprint)
 * and the previous record validated cleanly, the LLM is NOT called — the cached
 * summary is reused.  Returns null (silently) when the LLM is unavailable, the
 * API key is missing, or numeric-parity validation fails.
 *
 * Returns both the UI section and the GovernedSummaryRecord so the record can
 * be persisted in report_payload.governed_summary_v1.
 *
 * Phase J invariant: governed summary must resolve via resolveGovernedSummaryWithCache.
 * This is the ONLY place in the entire codebase that generates a GovernedSummaryRecord.
 * All three entrypoints (API /generate, API /regenerate, overlay_complete auto-trigger)
 * ultimately invoke this function through generateInvestorInsightsProcessor.
 */

function buildDeckFinancialSignalsSection(
	signals: DeckFinancialSignalsV1
): RenderPackage["sections"][number] {
	const lines: string[] = [
		`schema_version: ${signals.schema_version}`,
		`pages_scanned: ${signals.pages_scanned}`,
		`has_revenue: ${signals.has_revenue}`,
		`has_burn: ${signals.has_burn}`,
		`has_runway: ${signals.has_runway}`,
		`has_pricing: ${signals.has_pricing}`,
		`has_arr_mrr: ${signals.has_arr_mrr}`,
		`has_unit_economics: ${signals.has_unit_economics}`,
	];
	const addMentions = (label: string, mentions: DeckFinancialSignalsV1["revenue_mentions"]) => {
		if (mentions.length === 0) return;
		lines.push(`${label}_count: ${mentions.length}`);
		for (const m of mentions.slice(0, 4)) {
			lines.push(`  ${label}: ${m.text} | doc:${m.doc_id.slice(0, 8)} | page:${m.page_index}`);
		}
	};
	addMentions("revenue", signals.revenue_mentions);
	addMentions("arr_mrr", signals.arr_mrr_mentions);
	addMentions("burn", signals.burn_mentions);
	addMentions("runway", signals.runway_mentions);
	addMentions("margin", signals.margin_mentions);
	addMentions("pricing", signals.pricing_mentions);
	addMentions("unit_econ", signals.unit_econ_mentions);

	return {
		key: "deck_financial_signals_v1",
		title: "Deck Financial Signals (PDF/PPT)",
		kind: "message",
		body: lines.join("\n"),
		fallback: "No financial signals detected in deck text.",
	};
}

/**
 * Return the insight_slots section plus optional DPU diagnostics, signal visibility,
 * and normalization summary sections.
 */
function buildInsightSlotsSections(
	dealId: string,
	inputs: InsightSlotInputs
): Array<RenderPackage["sections"][number]> {
	const slotsSection = buildInsightSlotsSection(inputs);
	const diagSection = buildDpuDiagnosticsSection(dealId, inputs.dpuDiag);
	const signalSection = buildSignalVisibilitySection(inputs);
	const normSection = buildNormalizationSummarySection(inputs);
	const normDiffSection = buildNormalizationDiffSection(inputs);
	const sections: Array<RenderPackage["sections"][number]> = [slotsSection];
	if (diagSection) sections.push(diagSection);
	if (signalSection) sections.push(signalSection);
	if (normSection) sections.push(normSection);
	if (normDiffSection) sections.push(normDiffSection);
	if (inputs.bestFinancialStatement) {
		sections.push(buildFinancialStatementSection(inputs.bestFinancialStatement));
	}
	if (inputs.bestUseOfFundsStatement) {
		sections.push(buildUseOfFundsV1Section(inputs.bestUseOfFundsStatement));
	}
	if (inputs.impliedCapitalAllocation) {
		sections.push(buildImpliedCapitalAllocationSection(inputs.impliedCapitalAllocation));
	}
	if (inputs.bestFinancialStatement) {
		const hmSection = buildFinancialHealthMetricsSection(inputs.bestFinancialStatement);
		if (hmSection) sections.push(hmSection);
	}
	if (inputs.financialLayoutClassification) {
		sections.push(buildFinancialLayoutClassifierSection(inputs.financialLayoutClassification));
	}
	if (inputs.financialReconciliation) {
		sections.push(buildFinancialReconciliationSection(inputs.financialReconciliation));
	}
	if (inputs.deckFinancialSignals) {
		sections.push(buildDeckFinancialSignalsSection(inputs.deckFinancialSignals));
	}
	return sections;
}


// ─── Stage 2: Canonical Fields + Conflicts + Completeness ────────────────────

/**
 * Phase 2 reason codes for canonical sub-field extractors.
 * All UPPER_SNAKE_CASE per reason-code format enforcement.
 */
const P2_REASON = {
	NO_RAISE_AMOUNT_MENTION: "NO_RAISE_AMOUNT_MENTION",
	NO_RAISE_ROUND_MENTION: "NO_RAISE_ROUND_MENTION",
	NO_RAISE_INSTRUMENT_MENTION: "NO_RAISE_INSTRUMENT_MENTION",
	NO_RAISE_CAP_MENTION: "NO_RAISE_CAP_MENTION",
	NO_RAISE_DISCOUNT_MENTION: "NO_RAISE_DISCOUNT_MENTION",
	NO_NOTE_INTEREST_RATE_MENTION: "NO_NOTE_INTEREST_RATE_MENTION",
	NO_NOTE_MATURITY_MENTION: "NO_NOTE_MATURITY_MENTION",
	NO_VALUATION_PRE_MENTION: "NO_VALUATION_PRE_MENTION",
	NO_VALUATION_POST_MENTION: "NO_VALUATION_POST_MENTION",
	NO_VALUATION_SAFE_CAP_MENTION: "NO_VALUATION_SAFE_CAP_MENTION",
	NO_USE_OF_FUNDS_BUCKETS_MENTION: "NO_USE_OF_FUNDS_BUCKETS_MENTION",
	NO_TAM_VALUE_MENTION: "NO_TAM_VALUE_MENTION",
	NO_SAM_VALUE_MENTION: "NO_SAM_VALUE_MENTION",
	NO_SOM_VALUE_MENTION: "NO_SOM_VALUE_MENTION",
	NO_MRR_VALUE_MENTION: "NO_MRR_VALUE_MENTION",
	NO_ARR_VALUE_MENTION: "NO_ARR_VALUE_MENTION",
	NO_REVENUE_VALUE_MENTION: "NO_REVENUE_VALUE_MENTION",
	NO_GROWTH_RATE_MENTION: "NO_GROWTH_RATE_MENTION",
	NO_CUSTOMER_COUNT_MENTION: "NO_CUSTOMER_COUNT_MENTION",
	// Context-guard suppression reason codes (numeric-context-taxonomy phase)
	ARR_MARKET_CONTEXT_TAINT: NumericContextSuppressReason.ARR_MARKET_CONTEXT_TAINT,
	VALUATION_COMPETITOR_CONTEXT_TAINT: NumericContextSuppressReason.VALUATION_COMPETITOR_CONTEXT_TAINT,
	/** Canonical field rejected by page-level plausibility guard. */
	PLAUSIBILITY_GUARD_REJECTED: "PLAUSIBILITY_GUARD_REJECTED",
} as const;

// ── Phase 2 sub-field patterns (compile once) ────────────────────────────────
// NOTE: CURRENCY, AMOUNT, SUFFIX, MONEY_FRAGMENT, _NO_CUR, RAISE_ANCHOR, and
// RAISE_AMOUNT_PATTERN are defined in the "Shared building blocks" section above
// (before the data loader) so they are available to both Stage 1 and Phase 2.

/** raise_round: seed, series A/B/C, pre-seed, bridge, angel */
const RAISE_ROUND_PATTERN = /\b(seed|series\s+[a-cA-C]|pre[-\s]seed|bridge|angel)\b/i;

/**
 * raise_instrument: SAFE, convertible note, priced round, equity (round), common/preferred stock.
 * "Equity" alone is treated as Computable (Palm deck format: "Capital Raise. Equity").
 */
const RAISE_INSTRUMENT_PATTERN =
	/\b(SAFE|convertible\s+note|priced\s+round|equity(?:\s+round)?|common(?:\s+(?:stock|equity|shares?))?|preferred(?:\s+(?:stock|equity|shares?))?)\b/i;

/** raise_cap: "cap $X", "valuation cap $X", "SAFE cap $X", "cap of $X" — with optional SAFE/note proximity context */
const RAISE_CAP_PATTERN =
	/(?:(?:SAFE|convertible\s+note)[^.]{0,200}?)?(?:valuation\s+)?cap\s+(?:of\s+)?\$[\d,.]+\s*[BMKbmk]?|\bSAFE\s+cap\s+\$[\d,.]+\s*[BMKbmk]?/i;

/** raise_discount: "X% discount" — requires explicit "discount" word */
const RAISE_DISCOUNT_PATTERN = /\b(\d+)%\s+discount\b/i;

/**
 * note_interest_rate: interest rate on a convertible note / SAFE.
 * Matches patterns like "6% interest", "interest rate of 8%", "6% p.a.", "5% per annum"
 * anchored within a SAFE / convertible-note context (up to 150 chars preceding).
 */
const NOTE_INTEREST_RATE_PATTERN =
	/\b(\d+(?:\.\d+)?)\s*%\s*(?:interest(?:\s+rate)?|p\.a\.|per\s+annum)\b|interest\s+rate\s+of\s+(\d+(?:\.\d+)?)\s*%/i;

/**
 * note_maturity: maturity date or term of a convertible note.
 * Matches: "matures in 24 months", "maturity date: Dec 2025", "2-year term",
 * "18-month maturity", "maturity of 24 months".
 * Uses \bmatur (not \bmaturi) to cover both "matures" and "maturity".
 */
const NOTE_MATURITY_PATTERN =
	/\bmatur(?:ity|es?|e[ds]|ing)\s+(?:date\s+)?(?:of\s+|in\s+|:\s*)?(?:\d+\s+months?|[A-Za-z]+\s+\d{4}|\d{4})|\b\d+[-\s](?:month|year)\s+(?:term|maturity|note)\b|\bmaturity\s+(?:date\s+)?(?:of\s+)?\d+\s+months?\b/i;

/** valuation_pre: pre-money valuation with dollar figure */
const VALUATION_PRE_PATTERN =
	/pre[-\s]money\s+(?:valuation\s+)?(?:of\s+|is\s+|at\s+)?\$[\d,.]+\s*[BMKbmk]?/i;

/**
 * valuation_post: post-money valuation with dollar figure, or bare "$XMM Valuation".
 * Form A: "post-money valuation $10M", "post-money $10M"
 * Form B: "$6MM Valuation", "$6MM post-money valuation" (money then "valuation" within ~30 chars)
 * Form C: "valuation $6MM" (valuation keyword then money within ~20 chars)
 */
const VALUATION_POST_PATTERN = new RegExp(
	// Form A: explicit post-money prefix (classic)
	`post[-\\s]money\\s+(?:valuation\\s+)?(?:of\\s+|is\\s+|at\\s+)?${MONEY_FRAGMENT}` +
	// Form B: money then "valuation" keyword within ~30 chars
	`|${MONEY_FRAGMENT}${_NO_CUR}{0,30}?\\bvaluation\\b` +
	// Form C: "valuation" keyword then money within ~20 chars
	`|\\bvaluation\\b${_NO_CUR}{0,20}?${MONEY_FRAGMENT}`,
	"i"
);

/** valuation_safe_cap: standalone "safe cap $X" — does not require raise context */
const VALUATION_SAFE_CAP_PATTERN =
	/safe\s+cap\s+(?:of\s+|is\s+|at\s+)?\$[\d,.]+\s*[BMKbmk]?/i;

/**
 * use_of_funds_buckets: captures use-of-funds section headers plus trailing context.
 * Conservative: requires the header phrase, then grabs up to 200 chars of allocation text.
 */
const USE_OF_FUNDS_BUCKET_PATTERN =
	/(?:use\s+of\s+(?:funds|proceeds)|allocation\s+of\s+proceeds|proceeds\s+will\s+be\s+used)\b[^.]{0,200}/i;

/** tam_value: TAM with explicit dollar amount (Form A + B) */
const TAM_VALUE_PATTERN =
	/(?:\bTAM\b[^$\n]{0,60}?\$[\d,.]+\s*[BbMmKkTt]?|\$[\d,.]+\s*[BbMmKkTt]\+?[^$\n]{0,60}?\bTAM\b)/i;

/** sam_value: SAM with explicit dollar amount */
const SAM_VALUE_PATTERN =
	/(?:\bSAM\b[^$\n]{0,60}?\$[\d,.]+\s*[BbMmKkTt]?|\$[\d,.]+\s*[BbMmKkTt]\+?[^$\n]{0,60}?\bSAM\b)/i;

/** som_value: SOM with explicit dollar amount */
const SOM_VALUE_PATTERN =
	/(?:\bSOM\b[^$\n]{0,60}?\$[\d,.]+\s*[BbMmKkTt]?|\$[\d,.]+\s*[BbMmKkTt]\+?[^$\n]{0,60}?\bSOM\b)/i;

/** mrr_value: MRR keyword with dollar figure within 40 chars */
const MRR_VALUE_PATTERN = /\bMRR\b[^$\n]{0,40}?\$[\d,.]+\s*[BMKbmk]?/i;

/** arr_value: ARR keyword with dollar figure within 40 chars */
const ARR_VALUE_PATTERN = /\bARR\b[^$\n]{0,40}?\$[\d,.]+\s*[BMKbmk]?/i;

/**
 * revenue_value: explicit annual/quarterly/total revenue — conservative to prevent
 * false positives against raise amounts.
 */
// Updated to match plural "revenues" and allow pipe-separated columns from XLSX DPU
const REVENUE_VALUE_PATTERN =
	/(?:annual\s+revenues?|quarterly\s+revenues?|total\s+revenues?|gross\s+revenues?)[^$\n]{0,50}?\$[\d,.]+\s*[BMKbmk]?/i;

/** growth_rate: "growing X%", "X% MoM/YoY/month over month" */
const GROWTH_RATE_PATTERN =
	/(?:growing|growth(?:\s+rate)?(?:\s+of)?)\s+\d+%|\b\d+%\s+(?:month\s+over\s+month|MoM\b|YoY\b|year\s+over\s+year|annually)/i;

/** customer_count: explicit count followed by customers/users/clients.
 * Negative lookbehind (?<![\$\d,]) prevents matching mid-dollar-amount digits
 * (e.g. "1,582,164" inside "$1,582,164 Client HQ MRR") as a customer count. */
const CUSTOMER_COUNT_PATTERN = /(?<![\$\d,])\b(\d[\d,]+)\s+(?:customers?|active\s+users?|clients?)\b/i;

// ── Phase 2 types ────────────────────────────────────────────────────────────

interface CanonicalField {
	category: string;
	field: string;
	computability: "Computable" | "NotComputable";
	value: string | null;
	evidenceRef: string | null;
	reasonCode: string | null;
	/** Explicit source classification: "xlsx" for XLSX-derived, "deck" for PDF/text, "derived" for computed. */
	source?: "xlsx" | "deck" | "derived" | null;
	/** Evidence confidence level — computed by evidence-confidence-evaluator after extraction (PR36.6). */
	confidence?: EvidenceConfidenceLevel;
	/**
	 * When a context guard (ARR market taint, valuation competitor taint, etc.)
	 * suppresses a match, the raw tainted value is stored here for audit purposes.
	 * Never surfaced in canonicalFieldsBody — only available in the conflicts/withheld body.
	 */
	suppressedValue?: string;
	/**
	 * Number of distinct evidence sources that agree on this field's value.
	 * Computed during the corroboration pass (after field extraction, before confidence eval).
	 * When ≥ 2, buildConfidenceSignals emits evidence_count=2 → VERIFIED tier.
	 */
	corroboration_count?: number;
	/**
	 * Set to true by applyTruthGatesV1 when the financial truth layer has determined
	 * that this field's value should not receive full scoring credit.
	 * The value is still surfaced for display — only scoring is blocked.
	 *
	 * Blocked when:
	 *   - FinancialTruthRecord.state === "CONFLICT"      (sources disagree)
	 *   - FinancialTruthRecord.state === "INSUFFICIENT"  (not enough data)
	 *   - FinancialTruthRecord.projected_only_dataset === true  (not current traction)
	 */
	truth_gate_blocked?: boolean;
	/** Machine-readable reason code explaining why truth_gate_blocked is true. */
	truth_gate_reason?: string;
}

interface ConflictEntry {
	field: string;
	valueA: string;
	evidenceA: string;
	/** Source type tag for valueA: which pipeline produced it. */
	sourceTypeA: "deck" | "xlsx";
	valueB: string;
	evidenceB: string;
	/** Source type tag for valueB. */
	sourceTypeB: "deck" | "xlsx";
	/** Human-readable reason explaining why this is a conflict. */
	conflictReason: string;
}

type CompletenessStatus = "Present" | "Missing" | "Conflicting";

interface CompletenessRow {
	category: string;
	status: CompletenessStatus;
}

interface Phase2Result {
	fields: CanonicalField[];
	conflicts: ConflictEntry[];
	completeness: CompletenessRow[];
}

/**
 * Structured inputs for the deterministic investor thesis stub (Phase 3.0).
 * Derived entirely from canonical fields + completeness — no LLM required.
 */
export interface ThesisInputsV1 {
	raise_amount: string | null;
	raise_round: string | null;
	raise_instrument: string | null;
	raise_cap: string | null;
	raise_discount: string | null;
	note_interest_rate: string | null;
	note_maturity: string | null;
	valuation_pre: string | null;
	valuation_post: string | null;
	tam_value: string | null;
	mrr_value: string | null;
	arr_value: string | null;
	revenue_value: string | null;
	/** Fraction of canonical fields that are Computable (0–1). */
	coverage_ratio: number;
	/** True when at least one cross-page field conflict was detected. */
	conflicts_present: boolean;
	/** Per-category completeness rows from Phase 2. */
	completeness: CompletenessRow[];
}

// ── Phase 2 helpers ──────────────────────────────────────────────────────────

/**
 * Normalize a currency+amount token for conflict deduplication.
 * Handles $, €, £, and word codes USD/EUR/GBP.
 * "$2M" / "$2m" → "$2m"; "$1.5MM" / "$1.5M" → "$1.5m" (no false conflict);
 * "€5.6M" / "EUR 5.6M" → "€5.6m"; "$1.5 million" → "$1.5m".
 */
function normalizeAmountForConflict(s: string): string {
	const m = /(?:[€£$]|EUR|USD|GBP)\s*[\d,]+(?:\.\d+)?(?:\s*(?:MM|BB|[BMKbmkTt]|million|billion|thousand|trillion))?/i.exec(s);
	if (!m) return s.trim().toLowerCase().slice(0, 30);
	return m[0]
		.replace(/\s/g, "")
		.toLowerCase()
		// Normalize word currency codes to their symbol equivalents
		.replace(/^eur/, "€")
		.replace(/^usd/, "\$")
		.replace(/^gbp/, "£")
		// Collapse double-letter magnitude suffixes to single (mm→m, bb→b)
		.replace(/mm$/, "m")
		.replace(/bb$/, "b")
		// Collapse word magnitude suffixes to single letter
		.replace(/million$/, "m")
		.replace(/billion$/, "b")
		.replace(/thousand$/, "k")
		.replace(/trillion$/, "t");
}

/**
 * Compiled form of MONEY_FRAGMENT for use in value-extraction helpers.
 * Captures the first currency+amount+suffix token from a snippet.
 */
const MONEY_RE = new RegExp(MONEY_FRAGMENT, "i");

/**
 * Extract the first clean money token from a matched snippet.
 * "€5.6M raised to date" → "€5.6M"
 * "Equity $1.5MM raise on a $6MM Valuation" → "$1.5MM"
 * "USD 2.0M funded" → "USD 2.0M"
 * Returns null when no currency token is found.
 */
function extractFirstMoney(snippet: string): string | null {
	const m = MONEY_RE.exec(snippet);
	if (!m) return null;
	return m[0].replace(/\s+/g, " ").trim();
}

/** Field names where the value should be a clean money token. */
const AMOUNT_FIELDS = new Set([
	"raise_amount", "raise_cap",
	"valuation_post", "valuation_pre", "valuation_safe_cap",
	"tam_value", "sam_value", "som_value",
	"mrr_value", "arr_value", "revenue_value",
]);

/**
 * Return a clean, presentation-safe value string for a canonical field.
 * - Amount fields: first matched money token only (e.g. "€5.6M", "$1.5MM")
 * - growth_rate: first percentage token (e.g. "20%", "15% MoM")
 * - customer_count: first numeric count token (e.g. "1,200")
 * - All others: trimmed snippet with collapsed whitespace
 *
 * Always strips surrounding quotes and collapses internal whitespace.
 */
function cleanCanonicalValue(field: string, snippet: string): string {
	const base = snippet.replace(/^["']+|["']+$/g, "").replace(/\s+/g, " ").trim();
	if (AMOUNT_FIELDS.has(field)) {
		return extractFirstMoney(base) ?? base;
	}
	if (field === "growth_rate") {
		const m = /\b\d+(?:\.\d+)?%(?:\s*(?:YoY|MoM|month[-\s]over[-\s]month|year[-\s]over[-\s]year|annually))?/i.exec(base);
		return m ? m[0].trim() : base;
	}
	if (field === "customer_count") {
		const m = /\b(\d[\d,]*)\+?(?:\s*(?:customers?|active\s+users?|clients?))?\b/.exec(base);
		return m ? m[0].trim() : base;
	}
	return base;
}

/**
 * Collect ALL first-match results across all pages for conflict detection.
 * Unlike detectInPages (stops at first match), this scans every page.
 */
function detectAllMatchesForConflict(
	pages: DpuPage[],
	pattern: RegExp
): Array<{ snippet: string; ref: string; normalized: string }> {
	return pages.flatMap((page) => {
		const m = pattern.exec(page.text ?? "");
		if (!m) return [];
		const snippet = m[0].slice(0, 80);
		return [{
			snippet,
			ref: dpuEvidenceRef(page.document_id, page.page_index),
			normalized: normalizeAmountForConflict(snippet),
		}];
	});
}

/**
 * Find a conflict: two distinct normalized dollar amounts on different evidence refs.
 * Same page cannot conflict with itself.
 */
function findConflictInMatches(
	fieldName: string,
	matches: Array<{ snippet: string; ref: string; normalized: string }>
): ConflictEntry | null {
	if (matches.length < 2) return null;
	const seen = new Map<string, { snippet: string; ref: string }>();
	for (const m of matches) {
		if (!seen.has(m.normalized)) {
			seen.set(m.normalized, { snippet: m.snippet, ref: m.ref });
		}
	}
	if (seen.size < 2) return null;
	const entries = [...seen.values()];
	const a = entries[0]!;
	const b = entries[1]!;
	if (a.ref === b.ref) return null; // same page — not a cross-page conflict
	return {
		field: fieldName,
		valueA: a.snippet, evidenceA: a.ref, sourceTypeA: "deck",
		valueB: b.snippet, evidenceB: b.ref, sourceTypeB: "deck",
		conflictReason: "Two distinct values found in different deck pages",
	};
}

/**
 * Look up the full normalized page text for a given DPU evidence reference.
 * Returns null when the ref belongs to an evidence snippet rather than a DPU page.
 */
function findPageTextForRef(pages: DpuPage[], ref: string): string | null {
	for (const page of pages) {
		if (dpuEvidenceRef(page.document_id, page.page_index) === ref) {
			return page.text ?? "";
		}
	}
	return null;
}

/**
 * Evaluate a single canonical sub-field via first-match detection (DPU → evidence fallback).
 *
 * When `taintedReasonCode` is provided and `detectFn` returns null, this function
 * performs a secondary check with the unfiltered `detectInTextSources`. If that
 * unfiltered check finds a match (meaning the pattern fires but `detectFn` rejected
 * it as context-tainted), the returned field uses `taintedReasonCode` and records
 * the tainted snippet in `suppressedValue` for the audit trail — it is still
 * NotComputable (value=null) so it never reaches the governed narrative corpus.
 *
 * When `plausibilityGuard` is provided, it is applied to the full source page text
 * after a match is found. If the guard rejects the page, the field is returned as
 * NotComputable with reason=PLAUSIBILITY_GUARD_REJECTED and the suppressed value.
 */
function evalCanonicalField(
	category: string,
	field: string,
	pages: DpuPage[],
	evidenceSnippets: EvidenceSnippet[],
	pattern: RegExp,
	reasonCode: string,
	dpuLoadFailed: boolean,
	detectFn: (p: RegExp, pages: DpuPage[], ev: EvidenceSnippet[]) => { snippet: string; ref: string } | null = detectInTextSources,
	taintedReasonCode?: string,
	plausibilityGuard?: FactPlausibilityGuard
): CanonicalField {
	if (dpuLoadFailed) {
		return { category, field, computability: "NotComputable", value: null, evidenceRef: null, reasonCode: SLOT_REASON_CODES.DPU_LOAD_FAILED };
	}

	// When a plausibility guard is provided, scan pages directly with guard-aware iteration
	// so that a guard-rejected page does NOT silently win over a correct later page.
	if (plausibilityGuard) {
		// Try each DPU page in order, applying the guard; accept the first passing page.
		for (const page of pages) {
			const text = page.text ?? "";
			const m = pattern.exec(text);
			if (!m) continue;
			// Apply the per-field detect function's taint logic by checking if the
			// preferred detect function also finds a hit on this page.  We call
			// detectFn with this single page to honour any existing taint guards.
			const singlePageHit = detectFn(pattern, [page], []);
			if (!singlePageHit) continue; // taint-rejected by existing detector
			const pageText = text;
			const guardResult = plausibilityGuard(field, pageText, singlePageHit.snippet);
			if (!guardResult.allowed) {
				// Record first rejected hit for audit trail then keep trying
				// (only the LAST suppressed value will be stored if all pages fail)
				continue;
			}
			return { category, field, computability: "Computable", value: cleanCanonicalValue(field, singlePageHit.snippet), evidenceRef: singlePageHit.ref, reasonCode: null };
		}
		// No DPU page passed the guard — try evidence snippets with guard
		for (const ev of evidenceSnippets) {
			const text = ev.claim_text_norm ?? ev.claim_text ?? "";
			const m = pattern.exec(text);
			if (!m) continue;
			const prefix = ev.id.replace(/-/g, "").slice(0, 8);
			const ref = `evidence:item:${prefix}`;
			const snippet = m[0].slice(0, 80);
			const guardResult = plausibilityGuard(field, text, snippet);
			if (!guardResult.allowed) continue;
			return { category, field, computability: "Computable", value: cleanCanonicalValue(field, snippet), evidenceRef: ref, reasonCode: null };
		}
		// All candidates guard-rejected — emit suppressed result from first DPU hit (if any)
		const firstHit = detectFn(pattern, pages, evidenceSnippets);
		if (firstHit) {
			return {
				category, field,
				computability: "NotComputable",
				value: null,
				evidenceRef: null,
				reasonCode: P2_REASON.PLAUSIBILITY_GUARD_REJECTED,
				suppressedValue: cleanCanonicalValue(field, firstHit.snippet),
			};
		}
		// No match at all with guard — fall through to taint check below
	} else {
	const hit = detectFn(pattern, pages, evidenceSnippets);
	if (hit) {
		return { category, field, computability: "Computable", value: cleanCanonicalValue(field, hit.snippet), evidenceRef: hit.ref, reasonCode: null };
	}
	}
	// When a taint code is supplied, check whether the raw unfiltered pattern fires.
	// If it does, the clean detectFn rejected a tainted match → emit the taint code with audit value.
	if (taintedReasonCode) {
		const rawHit = detectInTextSources(pattern, pages, evidenceSnippets);
		if (rawHit) {
			return {
				category, field,
				computability: "NotComputable",
				value: null,
				evidenceRef: null,
				reasonCode: taintedReasonCode,
				suppressedValue: cleanCanonicalValue(field, rawHit.snippet),
			};
		}
	}
	return { category, field, computability: "NotComputable", value: null, evidenceRef: null, reasonCode };
}

// ── Corroboration counter ─────────────────────────────────────────────────────

/**
 * Patterns used for corroboration counting (deck-sourced traction fields).
 * Maps canonical field names to their extraction patterns so the corroboration
 * pass can count how many DPU pages produce the same normalised value.
 */
const CORROBORATION_PATTERNS: Readonly<Record<string, RegExp>> = {
	raise_amount:  RAISE_AMOUNT_PATTERN,
	valuation_post: VALUATION_POST_PATTERN,
	valuation_pre:  VALUATION_PRE_PATTERN,
	arr_value:     ARR_VALUE_PATTERN,
	mrr_value:     MRR_VALUE_PATTERN,
	revenue_value: REVENUE_VALUE_PATTERN,
	customer_count: CUSTOMER_COUNT_PATTERN,
	growth_rate:   GROWTH_RATE_PATTERN,
};

/**
 * Count how many distinct DPU pages produce the same normalised value as `targetNorm`.
 * Used to set `corroboration_count` on deck-sourced CanonicalFields.
 *
 * Only pages whose match normalises to `targetNorm` are counted.
 * Returns 0 when `pages` is empty or no match is found.
 */
function countCorroboratedPages(
	pages: DpuPage[],
	pattern: RegExp,
	targetNorm: string
): number {
	const seenRefs = new Set<string>();
	for (const page of pages) {
		const m = pattern.exec(page.text ?? "");
		if (!m) continue;
		const norm = normalizeAmountForConflict(m[0].slice(0, 80));
		if (norm !== targetNorm) continue;
		seenRefs.add(dpuEvidenceRef(page.document_id, page.page_index));
	}
	return seenRefs.size;
}

/**
 * Enrich deck-sourced Computable canonical fields with a corroboration_count.
 *
 * For each field in CORROBORATION_PATTERNS that is Computable and deck-sourced,
 * count the distinct DPU pages that agree on the same normalised value.
 * XLSX-sourced fields are already authoritative — they skip corroboration.
 */
function enrichCorroboration(fields: CanonicalField[], pages: DpuPage[]): void {
	for (const field of fields) {
		if (field.computability !== "Computable") continue;
		if (field.source === "xlsx") continue;
		if (!field.value) continue;
		const pattern = CORROBORATION_PATTERNS[field.field];
		if (!pattern) continue;
		const targetNorm = normalizeAmountForConflict(field.value);
		field.corroboration_count = countCorroboratedPages(pages, pattern, targetNorm);
	}
}

// ─── Phase 2 Fix #4: Truth-state gate ────────────────────────────────────────

/**
 * Maps canonical traction field names to their keys in the FinancialTruthMapV1.
 * Only fields listed here are ever truth-gated; all other fields pass through.
 */
const TRUTH_GATED_FIELDS: Record<string, string> = {
	arr_value:     "arr",
	mrr_value:     "mrr",
	revenue_value: "revenue",
} as const;

/**
 * Apply financial truth-layer gates to all canonical traction fields.
 *
 * For each field in TRUTH_GATED_FIELDS that is present and Computable, checks the
 * corresponding FinancialTruthRecord.  When the truth state would reduce confidence
 * in the value, sets `truth_gate_blocked = true` and `truth_gate_reason` to a
 * machine-readable code.  The value itself is NOT removed — it remains visible in
 * the UI but is excluded from market-score computation by computeMarketScoreRaw.
 *
 * Gate conditions:
 *   - state === "CONFLICT"            → sources disagree; no resolved single truth
 *   - state === "INSUFFICIENT"        → fewer than the minimum reliable sources
 *   - projected_only_dataset === true → all facts are forward-looking projections
 *
 * Permissive default: when financialTruth is absent or the metric has no record,
 * no gate is applied (field scores normally).
 *
 * Exported for unit tests.
 */
export function applyTruthGatesV1(
	fields: CanonicalField[],
	financialTruth: import("../../../lib/financial-facts/build-financial-truth-v1.js").FinancialTruthMapV1 | null | undefined,
): void {
	if (!financialTruth) return;
	for (const field of fields) {
		if (field.computability !== "Computable") continue;
		const metricKey = TRUTH_GATED_FIELDS[field.field];
		if (!metricKey) continue;
		const record = financialTruth[metricKey];
		if (!record) continue;
		if (record.state === "CONFLICT") {
			field.truth_gate_blocked = true;
			field.truth_gate_reason = `TRUTH_CONFLICT:${metricKey.toUpperCase()}`;
		} else if (record.state === "INSUFFICIENT") {
			field.truth_gate_blocked = true;
			field.truth_gate_reason = `TRUTH_INSUFFICIENT:${metricKey.toUpperCase()}`;
		} else if (record.projected_only_dataset === true) {
			field.truth_gate_blocked = true;
			field.truth_gate_reason = `TRUTH_PROJECTED_ONLY:${metricKey.toUpperCase()}`;
		}
		// CONFIRMED → no gate; field scores normally.
	}
}

/**
 * Extract all Phase 2 canonical fields, detect conflicts, and compute per-category completeness.
 * No extra DB calls — reuses the same InsightSlotInputs fetched in Stage 1.
 */
function extractPhase2Result(inputs: InsightSlotInputs): Phase2Result {
	const { dpuPages, evidenceSnippets, dpuLoadFailed } = inputs;
	const fields: CanonicalField[] = [];
	const conflicts: ConflictEntry[] = [];

	// ── Raise Terms ────────────────────────────────────────────────────────────
	// Conflict detection: scan ALL pages to find distinct raise amounts.
	// Use the context-gated variant to exclude TAM/SAM/SOM market-size matches.
	const raiseAmountMatches = dpuLoadFailed
		? []
		: detectRaiseAllMatchesForConflict(dpuPages, RAISE_AMOUNT_PATTERN);
	const raiseAmountConflict = findConflictInMatches("raise_amount", raiseAmountMatches);
	if (raiseAmountConflict) conflicts.push(raiseAmountConflict);

	fields.push(evalCanonicalField("raise_terms", "raise_amount", dpuPages, evidenceSnippets, RAISE_AMOUNT_PATTERN, P2_REASON.NO_RAISE_AMOUNT_MENTION, dpuLoadFailed, detectRaiseInTextSources, undefined, FACT_PLAUSIBILITY_GUARDS.raise_amount));
	fields.push(evalCanonicalField("raise_terms", "raise_round", dpuPages, evidenceSnippets, RAISE_ROUND_PATTERN, P2_REASON.NO_RAISE_ROUND_MENTION, dpuLoadFailed));
	fields.push(evalCanonicalField("raise_terms", "raise_instrument", dpuPages, evidenceSnippets, RAISE_INSTRUMENT_PATTERN, P2_REASON.NO_RAISE_INSTRUMENT_MENTION, dpuLoadFailed));
	fields.push(evalCanonicalField("raise_terms", "raise_cap", dpuPages, evidenceSnippets, RAISE_CAP_PATTERN, P2_REASON.NO_RAISE_CAP_MENTION, dpuLoadFailed));
	fields.push(evalCanonicalField("raise_terms", "raise_discount", dpuPages, evidenceSnippets, RAISE_DISCOUNT_PATTERN, P2_REASON.NO_RAISE_DISCOUNT_MENTION, dpuLoadFailed));
	fields.push(evalCanonicalField("raise_terms", "note_interest_rate", dpuPages, evidenceSnippets, NOTE_INTEREST_RATE_PATTERN, P2_REASON.NO_NOTE_INTEREST_RATE_MENTION, dpuLoadFailed));
	fields.push(evalCanonicalField("raise_terms", "note_maturity", dpuPages, evidenceSnippets, NOTE_MATURITY_PATTERN, P2_REASON.NO_NOTE_MATURITY_MENTION, dpuLoadFailed));

	// ── Valuation Terms ────────────────────────────────────────────────────────
	fields.push(evalCanonicalField("valuation_terms", "valuation_pre", dpuPages, evidenceSnippets, VALUATION_PRE_PATTERN, P2_REASON.NO_VALUATION_PRE_MENTION, dpuLoadFailed));
	fields.push(evalCanonicalField("valuation_terms", "valuation_post", dpuPages, evidenceSnippets, VALUATION_POST_PATTERN, P2_REASON.NO_VALUATION_POST_MENTION, dpuLoadFailed, detectValuationPostInTextSources, P2_REASON.VALUATION_COMPETITOR_CONTEXT_TAINT));
	fields.push(evalCanonicalField("valuation_terms", "valuation_safe_cap", dpuPages, evidenceSnippets, VALUATION_SAFE_CAP_PATTERN, P2_REASON.NO_VALUATION_SAFE_CAP_MENTION, dpuLoadFailed));

	// ── Use of Funds ───────────────────────────────────────────────────────────
	// use_of_funds_buckets handled below (with XLSX override)

	// ── Market Claims ──────────────────────────────────────────────────────────
	// Prefer the triad extractor (handles pitch-deck layouts where all three values
	// appear on the same line before their labels). Fall back to individual patterns.
	{
		const triad = dpuLoadFailed ? null : detectMarketSizingTriad(dpuPages);
		if (triad) {
			fields.push(triad.tam
				? { category: "market_claims", field: "tam_value", computability: "Computable", value: triad.tam, evidenceRef: triad.ref, reasonCode: null }
				: { category: "market_claims", field: "tam_value", computability: "NotComputable", value: null, evidenceRef: null, reasonCode: P2_REASON.NO_TAM_VALUE_MENTION }
			);
			fields.push(triad.sam
				? { category: "market_claims", field: "sam_value", computability: "Computable", value: triad.sam, evidenceRef: triad.ref, reasonCode: null }
				: { category: "market_claims", field: "sam_value", computability: "NotComputable", value: null, evidenceRef: null, reasonCode: P2_REASON.NO_SAM_VALUE_MENTION }
			);
			fields.push(triad.som
				? { category: "market_claims", field: "som_value", computability: "Computable", value: triad.som, evidenceRef: triad.ref, reasonCode: null }
				: { category: "market_claims", field: "som_value", computability: "NotComputable", value: null, evidenceRef: null, reasonCode: P2_REASON.NO_SOM_VALUE_MENTION }
			);
		} else {
			fields.push(evalCanonicalField("market_claims", "tam_value", dpuPages, evidenceSnippets, TAM_VALUE_PATTERN, P2_REASON.NO_TAM_VALUE_MENTION, dpuLoadFailed));
			fields.push(evalCanonicalField("market_claims", "sam_value", dpuPages, evidenceSnippets, SAM_VALUE_PATTERN, P2_REASON.NO_SAM_VALUE_MENTION, dpuLoadFailed));
			fields.push(evalCanonicalField("market_claims", "som_value", dpuPages, evidenceSnippets, SOM_VALUE_PATTERN, P2_REASON.NO_SOM_VALUE_MENTION, dpuLoadFailed));
		}
	}

	// ── Traction Signal ────────────────────────────────────────────────────────
	// mrr_value: prefer XLSX saas_kpis; fall back to text pattern.
	{
		const textResult = evalCanonicalField("traction_signal", "mrr_value", dpuPages, evidenceSnippets, MRR_VALUE_PATTERN, P2_REASON.NO_MRR_VALUE_MENTION, dpuLoadFailed, detectMrrInTextSources, NumericContextSuppressReason.MRR_MARKET_CONTEXT_TAINT);
		const kpi = inputs.saasKpis;
		if (kpi?.derived?.mrr_latest != null) {
			const xlsxValue = `$${kpi.derived.mrr_latest.toLocaleString("en-US")} MRR (${kpi.periods[0] ?? "latest"}, XLSX)`;
			if (textResult.computability === "Computable" && textResult.value) {
				conflicts.push({
					field: "mrr_value",
					valueA: xlsxValue, evidenceA: kpi.source.page_ref, sourceTypeA: "xlsx",
					valueB: textResult.value, evidenceB: textResult.evidenceRef ?? "unknown", sourceTypeB: "deck",
					conflictReason: "XLSX SaaS KPI sheet and deck text disagree on MRR; XLSX preferred",
				});
			}
			fields.push({ category: "traction_signal", field: "mrr_value", computability: "Computable", value: xlsxValue, evidenceRef: kpi.source.page_ref, reasonCode: SLOT_REASON_CODES.DERIVED_FROM_SAAS_KPI, source: "xlsx" });
		} else {
			fields.push(textResult);
		}
	}
	// arr_value: prefer XLSX saas_kpis (derived ARR or ARR from MRR×12); fall back to text pattern.
	{
		const textResult = evalCanonicalField("traction_signal", "arr_value", dpuPages, evidenceSnippets, ARR_VALUE_PATTERN, P2_REASON.NO_ARR_VALUE_MENTION, dpuLoadFailed, detectArrInTextSources, P2_REASON.ARR_MARKET_CONTEXT_TAINT, FACT_PLAUSIBILITY_GUARDS.arr_value);
		const kpi = inputs.saasKpis;
		const arrVal = kpi?.derived?.arr_latest ?? null;
		if (arrVal != null && kpi) {
			const label = kpi.derived?.arr_from_mrr === true ? "ARR (×12 from MRR, XLSX)" : `ARR (${kpi.periods[0] ?? "latest"}, XLSX)`;
			const xlsxValue = `$${arrVal.toLocaleString("en-US")} ${label}`;
			if (textResult.computability === "Computable" && textResult.value) {
				conflicts.push({
					field: "arr_value",
					valueA: xlsxValue, evidenceA: kpi.source.page_ref, sourceTypeA: "xlsx",
					valueB: textResult.value, evidenceB: textResult.evidenceRef ?? "unknown", sourceTypeB: "deck",
					conflictReason: "XLSX SaaS KPI sheet and deck text disagree on ARR; XLSX preferred",
				});
			}
			fields.push({ category: "traction_signal", field: "arr_value", computability: "Computable", value: xlsxValue, evidenceRef: kpi.source.page_ref, reasonCode: SLOT_REASON_CODES.DERIVED_FROM_SAAS_KPI, source: "xlsx" });
		} else {
			fields.push(textResult);
		}
	}

	// revenue_value: prefer XLSX financial statement; fall back to text pattern.
	// Rule: XLSX is authoritative for revenue when available (structured data > OCR text).
	{
		const textResult = evalCanonicalField("traction_signal", "revenue_value", dpuPages, evidenceSnippets, REVENUE_VALUE_PATTERN, P2_REASON.NO_REVENUE_VALUE_MENTION, dpuLoadFailed, detectRevenueInTextSources, NumericContextSuppressReason.REVENUE_MARKET_CONTEXT_TAINT, FACT_PLAUSIBILITY_GUARDS.revenue_value);
		const fs = inputs.bestFinancialStatement;
		if (fs?.derived?.revenue_latest !== undefined) {
			const xlsxValue = `$${fs.derived.revenue_latest.toLocaleString("en-US")} (${fs.periods[0] ?? "latest"} revenue from XLSX)`;
			// If text also found a revenue value and it differs from XLSX, emit a cross-source conflict.
			if (textResult.computability === "Computable" && textResult.value) {
				conflicts.push({
					field: "revenue_value",
					valueA: xlsxValue, evidenceA: fs.source.page_ref, sourceTypeA: "xlsx",
					valueB: textResult.value, evidenceB: textResult.evidenceRef ?? "unknown", sourceTypeB: "deck",
					conflictReason: "XLSX structured data and deck text disagree on revenue; XLSX preferred",
				});
			}
			// XLSX preferred: always use XLSX value when available.
			fields.push({
				category: "traction_signal",
				field: "revenue_value",
				computability: "Computable",
				value: xlsxValue,
				evidenceRef: fs.source.page_ref,
				reasonCode: SLOT_REASON_CODES.DERIVED_FROM_FINANCIALS,
				source: "xlsx",
			});
		} else {
			fields.push(textResult);
		}
	}

	// growth_rate: prefer XLSX-derived YoY; fall back to text pattern.
	// Rule: XLSX is authoritative for growth metrics when available.
	{
		const textResult = evalCanonicalField("traction_signal", "growth_rate", dpuPages, evidenceSnippets, GROWTH_RATE_PATTERN, P2_REASON.NO_GROWTH_RATE_MENTION, dpuLoadFailed);
		const fs = inputs.bestFinancialStatement;
		if (fs?.derived?.revenue_yoy_growth_pct != null) {
			const periods = fs.periods;
			const yoyLabel = periods.length >= 2 ? `${periods[0]} → ${periods[1]}` : (periods[0] ?? "YoY");
			const xlsxValue = `${fs.derived.revenue_yoy_growth_pct.toFixed(1)}% revenue growth (${yoyLabel}, XLSX)`;
			fields.push({
				category: "traction_signal",
				field: "growth_rate",
				computability: "Computable",
				value: xlsxValue,
				evidenceRef: fs.source.page_ref,
				reasonCode: SLOT_REASON_CODES.DERIVED_FROM_FINANCIALS,
				source: "xlsx",
			});
		} else {
			fields.push(textResult);
		}
	}

	fields.push(evalCanonicalField("traction_signal", "customer_count", dpuPages, evidenceSnippets, CUSTOMER_COUNT_PATTERN, P2_REASON.NO_CUSTOMER_COUNT_MENTION, dpuLoadFailed, detectCustomerCountInTextSources, undefined, FACT_PLAUSIBILITY_GUARDS.customer_count));

	// ── Use of Funds (XLSX structured → text → ask-slide → ICA cascade) ────────
	// Priority: (1) XLSX UoF parser (most reliable structured data),
	//           (2) USE_OF_FUNDS_BUCKET_PATTERN text match (deck text),
	//           (3) Ask-slide allocation detector,
	//           (4) Implied capital allocation (budget model).
	// Structured XLSX data is preferred over OCR text pattern matches.
	{
		const textResult = evalCanonicalField("use_of_funds", "use_of_funds_buckets", dpuPages, evidenceSnippets, USE_OF_FUNDS_BUCKET_PATTERN, P2_REASON.NO_USE_OF_FUNDS_BUCKETS_MENTION, dpuLoadFailed);
		// 1st: XLSX UoF statement (highest confidence when available)
		const uof = inputs.bestUseOfFundsStatement;
		if (uof && uof.buckets.length > 0) {
			const bucketSummary = uof.buckets
				.map((b) => {
					const parts: string[] = [b.category];
					if (b.amount !== null) parts.push(`$${b.amount.toLocaleString("en-US")}`);
					if (b.percent !== null) parts.push(`${b.percent}%`);
					return parts.join(" ");
				})
				.join(", ");
			if (textResult.computability === "Computable" && textResult.value) {
				// Emit a conflict when text also found UoF data
				conflicts.push({
					field: "use_of_funds_buckets",
					valueA: bucketSummary, evidenceA: uof.source.page_ref, sourceTypeA: "xlsx",
					valueB: textResult.value, evidenceB: textResult.evidenceRef ?? "unknown", sourceTypeB: "deck",
					conflictReason: "XLSX structured UoF and deck text disagree on use-of-funds buckets; XLSX preferred",
				});
			}
			fields.push({
				category: "use_of_funds",
				field: "use_of_funds_buckets",
				computability: "Computable",
				value: bucketSummary,
				evidenceRef: uof.source.page_ref,
				reasonCode: SLOT_REASON_CODES.DERIVED_FROM_USE_OF_FUNDS,
				source: "xlsx",
			});
		} else if (textResult.computability === "Computable") {
			// 2nd: text pattern hit on deck pages
			fields.push(textResult);
		} else {
			// Ask-slide fallback: allocation table on the Ask/raise slide.
			const askHit = !dpuLoadFailed ? detectAskSlideAllocation(dpuPages) : null;
			if (askHit) {
				fields.push({
					category: "use_of_funds",
					field: "use_of_funds_buckets",
					computability: "Computable",
					value: askHit.snippet,
					evidenceRef: askHit.ref,
					reasonCode: null,
				});
			} else {
				// 4th fallback: implied capital allocation (budget-model derived from excel_sheet pages).
				const ica = inputs.impliedCapitalAllocation;
				const icaBuckets = ica?.buckets.filter((b) => b.annual_cost_usd != null && b.annual_cost_usd > 0) ?? [];
				if (ica && icaBuckets.length > 0 && ica.source.page_refs.length > 0) {
					const bucketSummary = icaBuckets
						.map((b) => {
							const parts: string[] = [b.category];
							if (b.annual_cost_usd != null) parts.push(`$${b.annual_cost_usd.toLocaleString("en-US")}`);
							if (b.pct_of_total != null) parts.push(`${(b.pct_of_total * 100).toFixed(1)}%`);
							return parts.join(" ");
						})
						.join(", ");
					fields.push({
						category: "use_of_funds",
						field: "use_of_funds_buckets",
						computability: "Computable",
						value: `${bucketSummary} (IMPLIED from budget model)`,
						evidenceRef: ica.source.page_refs[0]!,
						reasonCode: SLOT_REASON_CODES.DERIVED_FROM_BUDGET_MODEL,
						source: "xlsx",
					});
				} else {
					fields.push(textResult);
				}
			}
		}
	}

	// ── Financial Health (Phase K — balance sheet + cash flow + bank txns) ────
	{
		const bs  = inputs.balanceSheet;
		const cf  = inputs.cashFlow;
		const btx = inputs.bankTransactions;

		// cash_balance: balance sheet > cash flow ending cash > bank ending balance
		const cfEndingCash = cf?.ending_cash?.[cf?.periods?.[0] ?? ""] ?? null;
		const cashLatest = bs?.derived?.cash_latest ?? cfEndingCash ?? btx?.ending_balance ?? null;
		if (cashLatest != null) {
			const src = bs ? bs.source.page_ref : cf ? cf.source.page_ref : btx!.source.page_ref;
			fields.push({ category: "financial_health", field: "cash_balance", computability: "Computable", value: `$${cashLatest.toLocaleString("en-US")} (XLSX)`, evidenceRef: src, reasonCode: SLOT_REASON_CODES.DERIVED_FROM_BALANCE_SHEET, source: "xlsx" });
		} else {
			fields.push({ category: "financial_health", field: "cash_balance", computability: "NotComputable", value: null, evidenceRef: null, reasonCode: "NO_CASH_BALANCE_DATA" });
		}

		// debt_outstanding: from balance sheet
		const debtLatest = bs?.derived?.debt_latest ?? null;
		if (debtLatest != null) {
			fields.push({ category: "financial_health", field: "debt_outstanding", computability: "Computable", value: `$${debtLatest.toLocaleString("en-US")} (XLSX)`, evidenceRef: bs!.source.page_ref, reasonCode: SLOT_REASON_CODES.DERIVED_FROM_BALANCE_SHEET, source: "xlsx" });
		} else {
			fields.push({ category: "financial_health", field: "debt_outstanding", computability: "NotComputable", value: null, evidenceRef: null, reasonCode: "NO_DEBT_DATA" });
		}

		// net_cash_burn_monthly: cash flow ops > bank transactions
		const burnMonthly = cf?.derived?.monthly_burn_from_ops ?? btx?.derived?.monthly_burn ?? null;
		const burnSrc     = cf ? cf.source.page_ref : btx ? btx.source.page_ref : null;
		if (burnMonthly != null && burnSrc) {
			fields.push({ category: "financial_health", field: "net_cash_burn_monthly", computability: "Computable", value: `$${burnMonthly.toLocaleString("en-US")}/mo (XLSX)`, evidenceRef: burnSrc, reasonCode: SLOT_REASON_CODES.DERIVED_FROM_CASH_FLOW, source: "xlsx" });
		} else {
			fields.push({ category: "financial_health", field: "net_cash_burn_monthly", computability: "NotComputable", value: null, evidenceRef: null, reasonCode: "NO_BURN_DATA" });
		}

		// runway_months: derived when both cash and burn available
		const runwayMonths = cf?.derived?.runway_months ?? null;
		if (runwayMonths != null) {
			fields.push({ category: "financial_health", field: "runway_months", computability: "Computable", value: `${runwayMonths.toFixed(1)} months (XLSX)`, evidenceRef: cf!.source.page_ref, reasonCode: SLOT_REASON_CODES.DERIVED_FROM_CASH_FLOW, source: "xlsx" });
		} else if (cashLatest != null && burnMonthly != null && burnMonthly > 0) {
			const computed = cashLatest / burnMonthly;
			const src2 = burnSrc ?? (bs ? bs.source.page_ref : null);
			fields.push({ category: "financial_health", field: "runway_months", computability: "Computable", value: `${computed.toFixed(1)} months (computed: cash ÷ burn)`, evidenceRef: src2 ?? "unknown", reasonCode: SLOT_REASON_CODES.DERIVED_FROM_CASH_FLOW, source: "xlsx" });
		} else {
			fields.push({ category: "financial_health", field: "runway_months", computability: "NotComputable", value: null, evidenceRef: null, reasonCode: "NO_RUNWAY_DATA" });
		}
	}

	// ── SaaS Metrics (Phase K — saas_kpis sheet) ──────────────────────────────
	{
		const kpi    = inputs.saasKpis;
		const latest = kpi?.periods?.[0] ?? null;

		// Period-keyed records — use first period or "P0" key
		const churnPct     = typeof latest === "string" && latest ? (kpi?.churn_pct?.[latest] ?? kpi?.churn_pct?.["P0"] ?? null) : (kpi?.churn_pct?.["P0"] ?? null);
		const retentionPct = typeof latest === "string" && latest ? (kpi?.retention_pct?.[latest] ?? kpi?.retention_pct?.["P0"] ?? null) : (kpi?.retention_pct?.["P0"] ?? null);
		const cacVal       = typeof latest === "string" && latest ? (kpi?.cac?.[latest] ?? kpi?.cac?.["P0"] ?? null) : (kpi?.cac?.["P0"] ?? null);
		const ltvVal       = typeof latest === "string" && latest ? (kpi?.ltv?.[latest] ?? kpi?.ltv?.["P0"] ?? null) : (kpi?.ltv?.["P0"] ?? null);

		if (churnPct != null && kpi) {
			fields.push({ category: "saas_metrics", field: "churn_pct", computability: "Computable", value: `${churnPct.toFixed(2)}% (${latest ?? "latest"}, XLSX)`, evidenceRef: kpi.source.page_ref, reasonCode: SLOT_REASON_CODES.DERIVED_FROM_SAAS_KPI, source: "xlsx" });
		} else {
			fields.push({ category: "saas_metrics", field: "churn_pct", computability: "NotComputable", value: null, evidenceRef: null, reasonCode: "NO_CHURN_PCT_DATA" });
		}

		if (retentionPct != null && kpi) {
			fields.push({ category: "saas_metrics", field: "retention_pct", computability: "Computable", value: `${retentionPct.toFixed(2)}% (${latest ?? "latest"}, XLSX)`, evidenceRef: kpi.source.page_ref, reasonCode: SLOT_REASON_CODES.DERIVED_FROM_SAAS_KPI, source: "xlsx" });
		} else {
			fields.push({ category: "saas_metrics", field: "retention_pct", computability: "NotComputable", value: null, evidenceRef: null, reasonCode: "NO_RETENTION_PCT_DATA" });
		}

		if (cacVal != null && kpi) {
			fields.push({ category: "saas_metrics", field: "cac", computability: "Computable", value: `$${cacVal.toLocaleString("en-US")} CAC (${latest ?? "latest"}, XLSX)`, evidenceRef: kpi.source.page_ref, reasonCode: SLOT_REASON_CODES.DERIVED_FROM_SAAS_KPI, source: "xlsx" });
		} else {
			fields.push({ category: "saas_metrics", field: "cac", computability: "NotComputable", value: null, evidenceRef: null, reasonCode: "NO_CAC_DATA" });
		}

		if (ltvVal != null && kpi) {
			fields.push({ category: "saas_metrics", field: "ltv", computability: "Computable", value: `$${ltvVal.toLocaleString("en-US")} LTV (${latest ?? "latest"}, XLSX)`, evidenceRef: kpi.source.page_ref, reasonCode: SLOT_REASON_CODES.DERIVED_FROM_SAAS_KPI, source: "xlsx" });
		} else {
			fields.push({ category: "saas_metrics", field: "ltv", computability: "NotComputable", value: null, evidenceRef: null, reasonCode: "NO_LTV_DATA" });
		}
	}

	// ── Cap Table (Phase K) ───────────────────────────────────────────────────
	{
		const ct = inputs.capTable;
		const optionPool = ct?.option_pool_pct ?? null;
		if (optionPool != null && ct) {
			fields.push({ category: "cap_table", field: "option_pool_pct", computability: "Computable", value: `${optionPool.toFixed(2)}% (XLSX)`, evidenceRef: ct.source.page_ref, reasonCode: SLOT_REASON_CODES.DERIVED_FROM_CAP_TABLE, source: "xlsx" });
		} else {
			fields.push({ category: "cap_table", field: "option_pool_pct", computability: "NotComputable", value: null, evidenceRef: null, reasonCode: "NO_OPTION_POOL_DATA" });
		}

		if (ct && ct.stakeholders.length > 0) {
			const ownershipSummary = ct.stakeholders
				.filter((s) => s.row_type !== "total")
				.slice(0, 6)
				.map((s) => `${s.name}${s.pct != null ? ` ${s.pct.toFixed(1)}%` : ""}`)
				.join(", ");
			fields.push({ category: "cap_table", field: "ownership_summary", computability: "Computable", value: ownershipSummary, evidenceRef: ct.source.page_ref, reasonCode: SLOT_REASON_CODES.DERIVED_FROM_CAP_TABLE, source: "xlsx" });
		} else {
			fields.push({ category: "cap_table", field: "ownership_summary", computability: "NotComputable", value: null, evidenceRef: null, reasonCode: "NO_CAP_TABLE_DATA" });
		}
	}

	// ── Completeness ───────────────────────────────────────────────────────────
	const COMPLETENESS_CATEGORIES = [
		"raise_terms",
		"valuation_terms",
		"use_of_funds",
		"market_claims",
		"traction_signal",
	] as const;
	const completeness: CompletenessRow[] = COMPLETENESS_CATEGORIES.map((cat) => {
		const catFields = fields.filter((f) => f.category === cat);
		const hasConflict = conflicts.some((c) => catFields.some((f) => f.field === c.field));
		if (hasConflict) return { category: cat, status: "Conflicting" };
		const hasComputable = catFields.some((f) => f.computability === "Computable");
		return { category: cat, status: hasComputable ? "Present" : "Missing" };
	});

	// ── Corroboration pass: count agreeing pages before confidence evaluation ──
	// Only applies to deck-sourced fields in CORROBORATION_PATTERNS.
	// XLSX fields are already authoritative; they skip this step.
	enrichCorroboration(fields, dpuPages);

	// ── PR36.6: Annotate each canonical field with its evidence confidence level ──
	for (const field of fields) {
		const hasConflict = conflicts.some((c) => c.field === field.field);
		field.confidence = computeEvidenceConfidence(
			buildConfidenceSignals({
				computability: field.computability,
				evidenceRef: field.evidenceRef,
				source: field.source,
				reasonCode: field.reasonCode,
				hasConflict,
				corroborationCount: field.corroboration_count ?? 0,
			}),
		).level;
	}

	// ── Phase 2 Fix #4: Truth-state gate — block scoring credit when financial
	// truth layer reports CONFLICT, INSUFFICIENT, or projected_only for traction fields.
	applyTruthGatesV1(fields, inputs.financialTruth);

	return { fields, conflicts, completeness };
}


// ── Phase 2 section builders ──────────────────────────────────────────────────

function formatCanonicalFieldLine(f: CanonicalField): string {
	if (f.computability === "Computable" && f.value !== null && f.evidenceRef !== null) {
		const src = f.source ?? "deck";
		const conf = f.confidence ?? "UNKNOWN";
		const truthGatePart = f.truth_gate_blocked
			? ` | truth_gate=blocked | truth_gate_reason=${f.truth_gate_reason ?? "UNKNOWN"}`
			: "";
		return `category=${f.category} | field=${f.field} | computability=Computable | value="${f.value}" | evidence=${f.evidenceRef} | reason=${f.reasonCode ?? "none"} | source=${src} | confidence=${conf}${truthGatePart}`;
	}
	const conf = f.confidence ?? "UNKNOWN";
	const suppressedPart = f.suppressedValue ? ` | suppressed_value="${f.suppressedValue}"` : "";
	return `category=${f.category} | field=${f.field} | computability=NotComputable | value=none | evidence=none | reason=${f.reasonCode ?? "UNKNOWN"} | source=unknown | confidence=${conf}${suppressedPart}`;
}

function formatConflictLine(c: ConflictEntry): string {
	return `field=${c.field} | value_a="${c.valueA}" | evidence_a=${c.evidenceA} | source_a=${c.sourceTypeA} | value_b="${c.valueB}" | evidence_b=${c.evidenceB} | source_b=${c.sourceTypeB} | reason=${c.conflictReason}`;
}

function buildCanonicalFieldsSection(
	result: Phase2Result
): RenderPackage["sections"][number] {
	const body = result.fields.map(formatCanonicalFieldLine).join("\n");
	return {
		key: "canonical_fields",
		title: "Canonical Fields",
		kind: "message",
		body,
		fallback: "Canonical field extraction unavailable.",
	};
}

function buildConflictsSectionP2(
	result: Phase2Result
): RenderPackage["sections"][number] | null {
	if (result.conflicts.length === 0) return null;
	const body = result.conflicts.map(formatConflictLine).join("\n");
	return {
		key: "conflicts",
		title: "Conflicting Field Values",
		kind: "message",
		body,
		fallback: "No conflicts detected.",
	};
}

function buildCompletenessSummarySection(
	result: Phase2Result
): RenderPackage["sections"][number] {
	const body = result.completeness.map((row) => `${row.category}: ${row.status}`).join("\n");
	return {
		key: "completeness_summary",
		title: "Completeness Summary",
		kind: "message",
		body,
		fallback: "Completeness summary unavailable.",
	};
}

/**
 * Build all Phase 2 sections: canonical_fields, optional conflicts, completeness_summary.
 * Returns 2–3 sections. Reuses pre-fetched InsightSlotInputs — no additional DB calls.
 */
function buildPhase2Sections(
	inputs: InsightSlotInputs
): Array<RenderPackage["sections"][number]> {
	const result = extractPhase2Result(inputs);
	const sections: Array<RenderPackage["sections"][number]> = [];
	sections.push(buildCanonicalFieldsSection(result));
	const conflictsSection = buildConflictsSectionP2(result);
	if (conflictsSection) sections.push(conflictsSection);
	sections.push(buildCompletenessSummarySection(result));
	return sections;
}


// ─── Phase 3.0: Deterministic Investor Thesis Stub ───────────────────────────

/**
 * Map Phase 2 canonical fields and completeness into ThesisInputsV1.
 * Calls extractPhase2Result — pure/cheap (no DB).
 */
function buildThesisInputs(inputs: InsightSlotInputs): ThesisInputsV1 {
	const result = extractPhase2Result(inputs);
	const get = (field: string): string | null =>
		result.fields.find((f) => f.field === field)?.value ?? null;

	const computable = result.fields.filter((f) => f.computability === "Computable").length;
	const total = result.fields.length;
	const coverage_ratio = total > 0 ? computable / total : 0;

	return {
		raise_amount: get("raise_amount"),
		raise_round: get("raise_round"),
		raise_instrument: get("raise_instrument"),
		raise_cap: get("raise_cap"),
		raise_discount: get("raise_discount"),
		note_interest_rate: get("note_interest_rate"),
		note_maturity: get("note_maturity"),
		valuation_pre: get("valuation_pre"),
		valuation_post: get("valuation_post"),
		tam_value: get("tam_value"),
		mrr_value: get("mrr_value"),
		arr_value: get("arr_value"),
		revenue_value: get("revenue_value"),
		coverage_ratio,
		conflicts_present: result.conflicts.length > 0,
		completeness: result.completeness,
	};
}

/**
 * Determine confidence cap based on coverage, conflicts, and missing-category count.
 *
 * Rules (evaluated in order):
 *   1. coverage_ratio < 0.5             → Low
 *   2. ≥3 categories Missing            → Low
 *   3. conflicts_present OR ≥2 Missing  → Moderate ("max" cap: cannot be High)
 *   4. else                             → High
 */
export function computeConfidenceCap(t: ThesisInputsV1): "High" | "Moderate" | "Low" {
	if (t.coverage_ratio < 0.5) return "Low";
	const missingCount = t.completeness.filter((c) => c.status === "Missing").length;
	if (missingCount >= 3) return "Low";
	if (t.conflicts_present || missingCount >= 2) return "Moderate";
	return "High";
}

/** Deterministic open question for each Missing completeness category. */
const THESIS_OPEN_QUESTIONS: Record<string, string> = {
	raise_terms:    "What is the target raise amount, round type, and instrument?",
	valuation_terms: "What is the pre/post-money valuation or SAFE cap?",
	use_of_funds:   "How will the proceeds be allocated across the business?",
	market_claims:  "What is the total addressable market (TAM) and target segment size?",
	traction_signal: "What are the current revenue or MRR/ARR metrics and customer count?",
};

/**
 * Build the investor_thesis section — a deterministic stub derived from Phase 2 data.
 * Present in deterministic_only packages only; no LLM required.
 */
export function buildInvestorThesisStubSection(
	thesisInputs: ThesisInputsV1
): RenderPackage["sections"][number] {
	const cap = computeConfidenceCap(thesisInputs);

	const disclosureLines = thesisInputs.completeness.map(
		(c) => `  ${c.category}: ${c.status}`
	);

	const missingCategories = thesisInputs.completeness
		.filter((c) => c.status === "Missing")
		.map((c) => c.category);

	const openQuestionLines = missingCategories.map(
		(cat) => `  - ${THESIS_OPEN_QUESTIONS[cat] ?? `No data available for ${cat}.`}`
	);

	const lines: string[] = [
		`Confidence Cap: ${cap}`,
		"Disclosure Summary:",
		...disclosureLines,
	];

	if (openQuestionLines.length > 0) {
		lines.push("Open Questions:");
		lines.push(...openQuestionLines);
	}

	return {
		key: "investor_thesis",
		title: "Investor Thesis (Deterministic Stub)",
		kind: "message",
		body: lines.join("\n"),
		fallback: "Investor thesis stub unavailable.",
	};
}

// ─── G3 diagnostic section (dev/staging only) ───────────────────────────────


// ─── Product signal bundle builder (PR34.3) ──────────────────────────────────

/**
 * Regular expressions that indicate product-oriented content:
 * capabilities, automation/AI claims, integrations, workflow descriptions,
 * competitive differentiation language, and platform architecture signals.
 */
const PRODUCT_SIGNAL_RE =
	/\b(?:automat(?:es?|ion|ing)|AI[-\s]?powered|machine\s+learning|ML\b|workflow[s]?|integrat(?:es?|ion|ing)\s+with|plug[-\s]?in|API\b|sdk\b|no[-\s]?code|low[-\s]?code|compet(?:itor|itive|ition)|differentiat(?:es?|ion|ing)|proprietary|patented?|moat\b|unique(?:ly)?|unlike|versus\s|compared\s+to|built\s+(?:on|for|around)|platform\b|capability|capabilities|feature[s]?\b|dashboard[s]?\b|real[-\s]?time\b|enterprise[-\s]grade|self[-\s]?serve|end[-\s]?to[-\s]?end|white[-\s]?label|embedded\b|native[ly]?\b)\b/i;

/**
 * Build a Product & Differentiation signal bundle body from DPU deck pages.
 *
 * Scans pages for product capability language, automation/AI claims,
 * workflow integration signals, competitive positioning, and differentiation
 * claims. Returns up to ~1000 chars of context or null when unavailable.
 */
function buildProductSignalsBundleSection(inputs: InsightSlotInputs): {
	key: string;
	title: string;
	kind: string;
	body: string | null;
	fallback: string;
	contradiction: NarrativeContradictionV1 | null;
} {
	const MAX_CHARS = 1000;
	const candidates: NarrativeCandidate[] = [];

	for (const page of inputs.dpuPages) {
		// Fix: use page.text directly — extractDpuText() expected `page_text`/`normalized_text`
		// field names which DpuPage does not have, causing it to always return null (PR36.8).
		const text = page.text;
		if (!text || text.length < 20) continue;
		if (!PRODUCT_SIGNAL_RE.test(text)) continue;
		const excerpt = text.trim().slice(0, 300);
		candidates.push({ text: excerpt, meta: { sourceType: "raw_ocr_page" } });
	}

	const bundle = selectWithContradiction(candidates, "product_differentiation", {
		topN: 3,
		maxChars: MAX_CHARS,
	});

	return {
		key: "product_signals_bundle_v1",
		title: "Product & Differentiation Signals",
		kind: "message",
		body: bundle.selectedText,
		fallback: "No product signals extracted.",
		contradiction: bundle.contradiction,
	};
}

// ─── GTM signal bundle builder (PR34.3) ───────────────────────────────────────

/**
 * Keywords indicating go-to-market, pricing, customer segment, or distribution content.
 */
const GTM_SIGNAL_RE =
	/\b(?:pricing\b|price[sd]?\b|tier[s]?\b|subscription[s]?\b|per\s+(?:seat|user|month|year)|annually\b|enterprise\s+plan|starter\s+plan|freemium\b|free\s+trial|pilot\b|target(?:ed)?\s+(?:customer|buyer|segment|market|audience|user)|ideal\s+customer|ICP\b|SMB\b|mid[-\s]?market|enterprise\s+(?:customer|client|buyer)|go[-\s]?to[-\s]?market|GTM\b|channel[s]?\b|partner(?:ship)?[s]?\b|distribution\b|resell(?:er|ing)?\b|direct\s+sale[s]?\b|inside\s+sales?\b|outbound\b|inbound\b|demand\s+gen\b|sales\s+(?:team|hire|motion|strategy)|marketing\s+(?:spend|budget|hire)|land\s+and\s+expand|net\s+retention\b|NRR\b|expansion\s+revenue)\b/i;

/**
 * Build a Go-To-Market signal bundle body from DPU deck pages and use-of-funds.
 *
 * Scans pages for pricing structures, target customer/ICP descriptions,
 * subscription tiers, distribution channels, and partnership signals.
 * Also surfaces GTM-relevant use-of-funds allocations (sales, marketing).
 * Returns up to ~1000 chars of context or null when unavailable.
 */
function buildGtmSignalsBundleSection(inputs: InsightSlotInputs): {
	key: string;
	title: string;
	kind: string;
	body: string | null;
	fallback: string;
	contradiction: NarrativeContradictionV1 | null;
} {
	const MAX_CHARS = 1000;
	const candidates: NarrativeCandidate[] = [];

	for (const page of inputs.dpuPages) {
		// Fix: use page.text directly — extractDpuText() expected `page_text`/`normalized_text`
		// field names which DpuPage does not have, causing it to always return null (PR36.8).
		const text = page.text;
		if (!text || text.length < 20) continue;
		if (!GTM_SIGNAL_RE.test(text)) continue;
		const excerpt = text.trim().slice(0, 300);
		candidates.push({ text: excerpt, meta: { sourceType: "raw_ocr_page" } });
	}

	// Supplement with use-of-funds GTM allocation signals — these are structured section
	// data (higher trust tier) and contribute a single richly-formatted candidate.
	const uof = inputs.bestUseOfFundsStatement;
	if (uof) {
		const gtmBuckets = uof.buckets.filter((b) =>
			/sales|marketing|go[-\s]?to[-\s]?market|GTM|business\s+dev|BD\b|channel|partner/i.test(b.category)
		);
		if (gtmBuckets.length > 0) {
			const allocation_lines = gtmBuckets.map((b) => {
				const pct = b.percent != null ? ` (${b.percent}%)` : "";
				const amt = b.amount != null ? ` — $${b.amount.toLocaleString()}` : "";
				return `  ${b.category}${pct}${amt}`;
			});
			candidates.push({
				text: `Use-of-Funds GTM allocations:\n${allocation_lines.join("\n")}`,
				meta: { sourceType: "structured_section" },
			});
		}
	}

	const bundle = selectWithContradiction(candidates, "go_to_market_strategy", {
		topN: 3,
		maxChars: MAX_CHARS,
	});

	return {
		key: "gtm_signals_bundle_v1",
		title: "Go-To-Market Signals",
		kind: "message",
		body: bundle.selectedText,
		fallback: "No GTM signals extracted.",
		contradiction: bundle.contradiction,
	};
}

// ─── Candidate gatherers for remaining narrative topics (PR36.9) ──────────────

/**
 * Gather market_position candidates from DPU pages matching TAM/SAM/SOM or
 * market-size patterns.  Also surfaces any TAM-framed mentions from deck
 * financial signals.
 *
 * @internal — used only by buildFullContradictionBundle.
 */
function gatherMarketPositionCandidates(inputs: InsightSlotInputs): NarrativeCandidate[] {
	const candidates: NarrativeCandidate[] = [];
	for (const page of inputs.dpuPages) {
		const text = page.text;
		if (!text || text.length < 20) continue;
		// Skip SPAC / shell-entity financial statement pages — not target-company evidence.
		if (isSpacShellEntityPage(text)) continue;
		if (!MARKET_PATTERN.test(text)) continue;
		const excerpt = text.trim().slice(0, 300);
		candidates.push({ text: excerpt, meta: { sourceType: "raw_ocr_page" } });
	}
	// Deck financial signal mentions that carry market / TAM framing
	const dfs = inputs.deckFinancialSignals;
	if (dfs) {
		for (const m of dfs.revenue_mentions) {
			if (/\bTAM\b|\bSAM\b|\bSOM\b|\baddressable\s+market\b|\bmarket\s+size\b/i.test(m.text)) {
				candidates.push({ text: m.text, meta: { sourceType: "focused_bundle" } });
			}
		}
	}
	return candidates;
}

/**
 * Gather financial_outlook candidates from DPU pages with explicit ARR/MRR/revenue
 * language and from structured deck financial signals (arr_mrr_mentions, revenue_mentions).
 *
 * @internal — used only by buildFullContradictionBundle.
 */
function gatherFinancialOutlookCandidates(inputs: InsightSlotInputs): NarrativeCandidate[] {
	const FINANCIAL_OUTLOOK_RE =
		/\b(?:ARR\b|MRR\b|annual\s+recurring\s+revenue|monthly\s+recurring\s+revenue|revenue|burn\s+rate|runway|gross\s+margin|net\s+margin|EBITDA)\b/i;
	const candidates: NarrativeCandidate[] = [];
	for (const page of inputs.dpuPages) {
		const text = page.text;
		if (!text || text.length < 20) continue;
		// Skip SPAC / shell-entity financial statement pages — not target-company evidence.
		if (isSpacShellEntityPage(text)) continue;
		if (!FINANCIAL_OUTLOOK_RE.test(text)) continue;
		const excerpt = text.trim().slice(0, 300);
		candidates.push({ text: excerpt, meta: { sourceType: "raw_ocr_page" } });
	}
	// Structured deck financial signals — higher trustworthiness tier
	const dfs = inputs.deckFinancialSignals;
	if (dfs) {
		for (const m of dfs.arr_mrr_mentions) {
			candidates.push({ text: m.text, meta: { sourceType: "focused_bundle" } });
		}
		for (const m of dfs.revenue_mentions) {
			candidates.push({ text: m.text, meta: { sourceType: "focused_bundle" } });
		}
	}
	return candidates;
}

/**
 * Gather capital_and_raise candidates from DPU pages matching raise patterns
 * and from evidence snippets that contain strong raise signals.
 *
 * Applies the same volume-metric taint guard used by resolveRaiseAmount to
 * avoid surfacing GMV/loan-book figures as equity-raise candidates.
 *
 * @internal — used only by buildFullContradictionBundle.
 */
function gatherCapitalRaiseCandidates(inputs: InsightSlotInputs): NarrativeCandidate[] {
	const candidates: NarrativeCandidate[] = [];
	for (const page of inputs.dpuPages) {
		const text = page.text;
		if (!text || text.length < 20) continue;
		// Skip SPAC / shell-entity financial statement pages — not target-company evidence.
		if (isSpacShellEntityPage(text)) continue;
		if (!RAISE_AMOUNT_PATTERN.test(text) && !RAISE_RANGE_PATTERN.test(text)) continue;
		// Skip pages tainted by volume-metric language (GMV, loan-book, financed, etc.)
		if (isCandidateTaintedByVolumeMetric(text)) continue;
		const excerpt = text.trim().slice(0, 300);
		candidates.push({ text: excerpt, meta: { sourceType: "raw_ocr_page" } });
	}
	// Evidence snippets carrying strong raise signal (pre-extracted, canonical tier)
	for (const snippet of inputs.evidenceSnippets) {
		const text = snippet.claim_text ?? snippet.claim_text_norm ?? "";
		if (!text || text.length < 20) continue;
		if (!hasStrongRaiseSignal(text)) continue;
		if (isCandidateTaintedByVolumeMetric(text)) continue;
		candidates.push({ text, meta: { sourceType: "canonical_fact" } });
	}
	return candidates;
}

/**
 * Gather traction candidates from DPU pages matching ARR/MRR or engagement-rate
 * patterns and from structured deck financial signals (arr_mrr_mentions,
 * unit_econ_mentions).
 *
 * @internal — used only by buildFullContradictionBundle.
 */
function gatherTractionCandidates(inputs: InsightSlotInputs): NarrativeCandidate[] {
	const candidates: NarrativeCandidate[] = [];
	for (const page of inputs.dpuPages) {
		const text = page.text;
		if (!text || text.length < 20) continue;
		// Skip SPAC / shell-entity financial statement pages — not target-company evidence.
		if (isSpacShellEntityPage(text)) continue;
		if (!TRACTION_PATTERN.test(text) && !TRACTION_PCT_PATTERN.test(text)) continue;
		const excerpt = text.trim().slice(0, 300);
		candidates.push({ text: excerpt, meta: { sourceType: "raw_ocr_page" } });
	}
	// Deck financial signals carry traction-grade ARR/MRR and unit-econ data
	const dfs = inputs.deckFinancialSignals;
	if (dfs) {
		for (const m of dfs.arr_mrr_mentions) {
			candidates.push({ text: m.text, meta: { sourceType: "focused_bundle" } });
		}
		for (const m of dfs.unit_econ_mentions) {
			candidates.push({ text: m.text, meta: { sourceType: "focused_bundle" } });
		}
	}
	return candidates;
}

/**
 * Gather business_quality candidates from DPU pages mentioning profitability,
 * sustainable recurring-revenue model strength, or founding-team quality signals.
 *
 * @internal — used only by buildFullContradictionBundle.
 */
function gatherBusinessQualityCandidates(inputs: InsightSlotInputs): NarrativeCandidate[] {
	const BUSINESS_QUALITY_RE =
		/\b(?:profitable?|profitability|sustainable\b|recurring\s+(?:revenue|model)|high[-\s](?:margin|NPS|retention|LTV)|strong\s+(?:unit\s+economics?|fundamentals?|retention)|asset.{0,5}light|capital.{0,5}efficient|bootstrap(?:ped|ping)?|growing\s+(?:rapidly|organically|profitably)|founder[s]?\b|founding\s+team|domain\s+expertise)\b/i;
	const candidates: NarrativeCandidate[] = [];
	for (const page of inputs.dpuPages) {
		const text = page.text;
		if (!text || text.length < 20) continue;
		// Skip SPAC / shell-entity financial statement pages — not target-company evidence.
		if (isSpacShellEntityPage(text)) continue;
		if (!BUSINESS_QUALITY_RE.test(text)) continue;
		const excerpt = text.trim().slice(0, 300);
		candidates.push({ text: excerpt, meta: { sourceType: "raw_ocr_page" } });
	}
	return candidates;
}

// ─── Full contradiction bundle builder (PR36.9) ───────────────────────────────

/**
 * Build a complete NarrativeContradictionBundle covering all 7 narrative topics.
 *
 * Runs one selectWithContradiction pass per topic.  Fully deterministic — no I/O.
 *
 * Called by stage-3 LLM builders (replacing the previous inline 2-topic computation)
 * and by the orchestrator to persist the bundle in report_payload.
 *
 * Contradiction is null for a given topic when:
 *  - fewer than 2 qualified candidates exist (score ≥ TOPIC_MIN_THRESHOLD), OR
 *  - candidates are all below the topic minimum-quality gate.
 */
export function buildFullContradictionBundle(
	inputs: InsightSlotInputs,
): import("../narrative-contradiction-v1.js").NarrativeContradictionBundle {
	// product_differentiation: prefer narrative-page candidates over signal-keyword candidates.
	// Fall back to the signals bundle contradiction when the narrative bundle has no conflict.
	const productNarrBundle = buildProductNarrativeBundle(inputs);
	const productSignalsBundle = buildProductSignalsBundleSection(inputs);
	const gtmBundle = buildGtmSignalsBundleSection(inputs);

	const marketBundle = selectWithContradiction(
		gatherMarketPositionCandidates(inputs),
		"market_position",
		{ topN: 3, maxChars: 800 },
	);
	const financialBundle = selectWithContradiction(
		gatherFinancialOutlookCandidates(inputs),
		"financial_outlook",
		{ topN: 3, maxChars: 800 },
	);
	const capitalBundle = selectWithContradiction(
		gatherCapitalRaiseCandidates(inputs),
		"capital_and_raise",
		{ topN: 3, maxChars: 800 },
	);
	const tractionBundle = selectWithContradiction(
		gatherTractionCandidates(inputs),
		"traction",
		{ topN: 3, maxChars: 800 },
	);
	const businessBundle = selectWithContradiction(
		gatherBusinessQualityCandidates(inputs),
		"business_quality",
		{ topN: 3, maxChars: 800 },
	);

	return {
		product_differentiation:
			productNarrBundle.contradiction ?? productSignalsBundle.contradiction ?? null,
		go_to_market_strategy: gtmBundle.contradiction ?? null,
		market_position: marketBundle.contradiction,
		financial_outlook: financialBundle.contradiction,
		capital_and_raise: capitalBundle.contradiction,
		traction: tractionBundle.contradiction,
		business_quality: businessBundle.contradiction,
	};
}

// ── Named exports used by stage-1, stage-3, and the orchestrator ─────────────
export {
	buildInsightSlotsSection,
	buildInsightSlotsSections,
	buildPhase2Sections,
	extractPhase2Result,
	formatCanonicalFieldLine,
	formatConflictLine,
	loadInsightSlotInputs,
	extractDpuText,
	buildFinancialStatementSection,
	buildUseOfFundsV1Section,
	buildFinancialHealthMetricsSection,
	formatImpliedCapitalForCorpus,
	buildFinancialReconciliationSection,
	buildDeckFinancialSignalsSection,
	buildProductSignalsBundleSection,
	buildGtmSignalsBundleSection,
	buildThesisInputs,
	// Context guard functions — exported for unit tests
	isArrMatchTainted,
	detectArrInTextSources,
	isValuationMatchTainted,
	detectValuationPostInTextSources,
	// Fix #4: Truth-state gate — applyTruthGatesV1 is already an `export function` above.
	// Fix 17: workbook fact dedup — exported for unit tests
	deduplicateWorkbookFacts,
};
