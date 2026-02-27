/**
 * financial-layout-classifier-v1.ts
 *
 * Deterministic router that classifies each XLSX DPU sheet/page into a layout
 * type, preventing parser sprawl and enabling parser routing by layout rather
 * than ad-hoc sheet-name checks scattered across individual parsers.
 *
 * Phase-I taxonomy (conservative — aligned to currently supported parsers):
 *   income_statement  → financial-statement-parser (excel_range rows_preview)
 *   use_of_funds      → use-of-funds-parser-v1 (excel_range)
 *                       OR use-of-funds-timeseries-v1 (excel_sheet monthly plan)
 *   budget_model      → implied-capital-allocation-v1 (excel_sheet payroll/costs)
 *   cap_table         → stub; not yet implemented
 *   cash_flow         → stub; future
 *   balance_sheet     → stub; future
 *   other / unknown   → no routing
 *
 * Output contract
 * ───────────────
 * FinancialLayoutClassificationV1 (per-page):
 *   - doc_id, page_index, page_type
 *   - layout: LayoutType
 *   - confidence: "high" | "medium" | "low"
 *   - matched_signals: string[]   (lexical + structural cues)
 *   - parse_prerequisites: string[]  (parser notes)
 *   - notes: string[]
 *
 * DocumentLayoutSummaryV1 (per-document):
 *   - doc_id, page_count
 *   - layout_map: FinancialLayoutClassificationV1[]
 *   - dominant_layout: LayoutType | null
 *
 * DealLayoutClassificationV1 (aggregate for a deal):
 *   - deal_id
 *   - documents: DocumentLayoutSummaryV1[]
 *   - has_income_statement: boolean
 *   - has_use_of_funds: boolean
 *   - has_budget_model: boolean
 *   - has_cap_table: boolean
 *   - layout_coverage_pct: number
 */

// ─── Public types ──────────────────────────────────────────────────────────────

export type LayoutType =
	| "income_statement"
	| "use_of_funds"
	| "budget_model"
	| "cap_table"
	| "cash_flow"
	| "balance_sheet"
	| "saas_kpis"
	| "bank_transactions"
	| "other"
	| "unknown";

export interface FinancialLayoutClassificationV1 {
	doc_id:              string;
	page_index:          number;
	page_type:           string;       // "excel_range" | "excel_sheet" | ...
	sheet_title:         string | null;
	layout:              LayoutType;
	confidence:          "high" | "medium" | "low";
	matched_signals:     string[];
	parse_prerequisites: string[];
	notes:               string[];
}

export interface DocumentLayoutSummaryV1 {
	doc_id:          string;
	page_count:      number;
	layout_map:      FinancialLayoutClassificationV1[];
	dominant_layout: LayoutType | null;
}

export interface DealLayoutClassificationV1 {
	schema_version:       "financial_layout_classifier_v1";
	deal_id:              string;
	documents:            DocumentLayoutSummaryV1[];
	has_income_statement: boolean;
	has_use_of_funds:     boolean;
	has_budget_model:     boolean;
	has_cap_table:        boolean;
	has_cash_flow:        boolean;
	has_balance_sheet:    boolean;
	has_saas_kpis:        boolean;
	has_bank_txns:        boolean;
	classified_pages:     number;
	total_xl_pages:       number;
	layout_coverage_pct:  number;
}

// ─── Classification input ─────────────────────────────────────────────────────

export interface ClassifierPageInput {
	document_id: string;
	page_index:  number;
	payload:     unknown;
}

// ─── Internal signal definitions ──────────────────────────────────────────────

interface LayoutRule {
	layout:     LayoutType;
	/** Signals must be tested against sheet title OR page_text first lines. */
	titleRegs:  RegExp[];
	/** Content signals — tested against page_text or rows_preview labels. */
	contentRegs: RegExp[];
	/** Structural guard — applies only to specific page_type values. */
	pageTypes:  Array<"excel_range" | "excel_sheet">;
	/**
	 * Minimum number of title OR content signals that must match
	 * to reach "high" confidence.
	 */
	highThreshold:   number;
	mediumThreshold: number;
}

const LAYOUT_RULES: LayoutRule[] = [
	// ── Income Statement ─────────────────────────────────────────────────────
	{
		layout: "income_statement",
		titleRegs: [
			/income\s+statement/i,
			/pro[- ]?forma/i,
			/profit\s+[&and]+\s+loss/i,
			/p\s*[&]\s*l\b/i,
			/financials?\s+overview/i,
		],
		contentRegs: [
			/total\s+rev(enues?)?/i,
			/total\s+exp(enses?)?/i,
			/gross\s+profit/i,
			/net\s+(income|loss|profit)/i,
			/\bearr\b/i,
			/\bmrr\b/i,
			/operating\s+(expenses?|cost)/i,
		],
		pageTypes: ["excel_range"],
		highThreshold:   2,
		mediumThreshold: 1,
	},

	// ── Use of Funds — explicit table (excel_range) ──────────────────────────
	{
		layout: "use_of_funds",
		titleRegs: [
			/use\s+of\s+(the\s+)?funds?/i,
			/allocation\s+of\s+(the\s+)?funds?/i,
			/fund\s+allocation/i,
			/use\s+of\s+proceeds/i,
		],
		contentRegs: [
			/allocation/i,
			/proceeds?/i,
			/engineering|product\s+dev/i,
			/sales\s*(and|&)?\s*marketing/i,
			/operations?/i,
			/g\s*(&|and)\s*a/i,
		],
		pageTypes: ["excel_range"],
		highThreshold:   1,
		mediumThreshold: 1,
	},

	// ── Use of Funds — monthly timeseries spend plan (excel_sheet) ───────────
	{
		layout: "use_of_funds",
		titleRegs: [
			/use\s+of\s+(the\s+)?funds?/i,
			/allocation\s+of\s+(the\s+)?funds?/i,
			/fund\s+allocation/i,
			/use\s+of\s+proceeds/i,
			/valuation.*alloc/i,
		],
		contentRegs: [
			/month\s+\d+/i,                   // "Month 1", "Month 12"
			/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
			/year\s+\d+\s+total/i,            // "Year 1 Total"
			/expenses?\s+(fixed|variable)/i,
			/\bsales\s+\d/i,                  // "Sales 1", "Sales 2"
		],
		pageTypes: ["excel_sheet"],
		highThreshold:   2,
		mediumThreshold: 1,
	},

	// ── Budget Model (implied allocation from employee/payroll costs) ─────────
	{
		layout: "budget_model",
		titleRegs: [
			/budget|payroll|employee\s+costs?|staff\s+costs?|operational\s+costs?/i,
			/cost\s+model/i,
			/headcount/i,
		],
		contentRegs: [
			/salary|salaries/i,
			/headcount|employees?|staff/i,
			/payroll/i,
			/base\s+salary/i,
			/fully\s+loaded/i,
			/annual\s+cost/i,
		],
		pageTypes: ["excel_sheet"],
		highThreshold:   2,
		mediumThreshold: 1,
	},

	// ── Cap Table ────────────────────────────────────────────────────────────
	{
		layout: "cap_table",
		titleRegs: [
			/cap(ital(ization)?)?\s+table/i,
			/cap\s+table/i,
			/capitalization/i,
			/ownership\s+schedule/i,
			/equity\s+schedule/i,
		],
		contentRegs: [
			/shares?\s+(outstanding|issued|authorized)/i,
			/ownership\s+%/i,
			/fully\s+diluted/i,
			/common\s+stock/i,
			/preferred\s+stock/i,
			/option\s+pool/i,
			/\bsafe\b/i,
			/convertible\s+note/i,
			// Phase L additions: dilution / raise-terms signals
			/pre[-\s]money/i,
			/post[-\s]money/i,
			/valuation\s+cap/i,
			/\bdiscount\s+%/i,
			/post[-\s]money\s+shares/i,
		],
		pageTypes: ["excel_range", "excel_sheet"],
		highThreshold:   2,
		mediumThreshold: 1,
	},

	// ── Cash Flow ────────────────────────────────────────────────────────────
	{
		layout: "cash_flow",
		titleRegs: [
			/cash\s+flow/i,
			/cashflow/i,
			/cash\s+position/i,
		],
		contentRegs: [
			/net\s+cash/i,
			/operating\s+activities/i,
			/investing\s+activities/i,
			/financing\s+activities/i,
			/burn\s+rate/i,
			/runway/i,
		],
		pageTypes: ["excel_range", "excel_sheet"],
		highThreshold:   2,
		mediumThreshold: 1,
	},

	// ── Balance Sheet ────────────────────────────────────────────────────────
	{
		layout: "balance_sheet",
		titleRegs: [
			/balance\s+sheet/i,
			/statement\s+of\s+financial\s+position/i,
		],
		contentRegs: [
			/total\s+assets?/i,
			/total\s+liabilities?/i,
			/stockholders?\s+equity|shareholders?\s+equity/i,
			/current\s+assets?/i,
			/current\s+liabilities?/i,
			/accounts?\s+receivable/i,
			/accounts?\s+payable/i,
		],
		pageTypes: ["excel_range", "excel_sheet"],
		highThreshold:   2,
		mediumThreshold: 1,
	},

	// ── SaaS KPIs ────────────────────────────────────────────────────────────
	{
		layout: "saas_kpis",
		titleRegs: [
			/saas\s+(?:kpis?|metrics?|dashboard)/i,
			/kpi\s+(?:summary|dashboard|overview)/i,
			/[Kk]ey\s+[Mm]etrics?/i,
			/[Ss]ubscription\s+[Mm]etrics?/i,
			/[Gg]rowth\s+[Mm]etrics?/i,
		],
		contentRegs: [
			/\bMRR\b/i,
			/\bARR\b/i,
			/\bchurn(?:\s+rate)?\b/i,
			/\bretention(?:\s+rate)?\b/i,
			/\bCAC\b/i,
			/\bLTV\b|customer\s+lifetime\s+value/i,
			/\bARPU\b|average\s+revenue\s+per\s+user/i,
			/\bcohort/i,
		],
		pageTypes: ["excel_range", "excel_sheet"],
		highThreshold:   2,
		mediumThreshold: 1,
	},

	// ── Bank Transactions ────────────────────────────────────────────────────
	{
		layout: "bank_transactions",
		titleRegs: [
			/bank\s+(?:statement|transactions?|export|activity)/i,
			/transaction\s+(?:history|log|export|detail)/i,
			/account\s+(?:statement|activity|transactions?)/i,
		],
		contentRegs: [
			/\bdebit\b/i,
			/\bcredit\b/i,
			/running\s+balance|account\s+balance/i,
			/\bACH\b|\bwire\b|\bpayroll\b/i,
			/\bmerchant\b|\bdescription\b/i,
			/transaction\s+(?:date|type|id)/i,
		],
		pageTypes: ["excel_range", "excel_sheet"],
		highThreshold:   3,
		mediumThreshold: 2,
	},
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractSheetTitle(p: Record<string, unknown>): string | null {
	if (typeof p["sheet_name"] === "string") return p["sheet_name"];
	if (typeof p["page_title"] === "string") return p["page_title"];
	const pt = typeof p["page_text"] === "string" ? p["page_text"] : "";
	const m = pt.match(/^Sheet:\s*(.+)/im);
	return m ? m[1]!.trim() : null;
}

function extractTextSample(p: Record<string, unknown>): string {
	// excel_range: use rows_preview labels
	if (p["page_type"] === "excel_range") {
		const structured = (p["structured"] ?? {}) as Record<string, unknown>;
		const rowsPreview = Array.isArray(structured["rows_preview"])
			? (structured["rows_preview"] as Array<Record<string, unknown>>)
			: [];
		return rowsPreview
			.map((r) => String(r["col_A"] ?? r["label"] ?? ""))
			.filter(Boolean)
			.slice(0, 20)
			.join("\n");
	}
	// excel_sheet: use first 60 lines of page_text
	if (typeof p["page_text"] === "string") {
		return p["page_text"].split("\n").slice(0, 60).join("\n");
	}
	return "";
}

function scoreRule(
	rule: LayoutRule,
	pageType: string,
	title: string | null,
	textSample: string
): { matchCount: number; signals: string[] } {
	if (!rule.pageTypes.includes(pageType as "excel_range" | "excel_sheet")) {
		return { matchCount: 0, signals: [] };
	}

	const signals: string[] = [];
	let matchCount = 0;

	// Test title signals
	if (title) {
		for (const re of rule.titleRegs) {
			if (re.test(title)) {
				signals.push(`title:${re.source.slice(0, 40)}`);
				matchCount++;
				break; // count each category once from title
			}
		}
	}

	// Test content signals
	for (const re of rule.contentRegs) {
		if (re.test(textSample)) {
			signals.push(`content:${re.source.slice(0, 40)}`);
			matchCount++;
		}
	}

	return { matchCount, signals };
}

// ─── Per-page classifier ──────────────────────────────────────────────────────

export function classifyPage(input: ClassifierPageInput): FinancialLayoutClassificationV1 {
	const p = input.payload as Record<string, unknown> | null;
	if (!p) {
		return {
			doc_id:              input.document_id,
			page_index:          input.page_index,
			page_type:           "unknown",
			sheet_title:         null,
			layout:              "unknown",
			confidence:          "low",
			matched_signals:     [],
			parse_prerequisites: [],
			notes:               ["null payload"],
		};
	}

	const pageType   = typeof p["page_type"] === "string" ? p["page_type"] : "unknown";
	const sheetTitle = extractSheetTitle(p);
	const textSample = extractTextSample(p);

	// Non-Excel page types → skip
	if (!["excel_range", "excel_sheet"].includes(pageType)) {
		return {
			doc_id:              input.document_id,
			page_index:          input.page_index,
			page_type:           pageType,
			sheet_title:         sheetTitle,
			layout:              "other",
			confidence:          "high",
			matched_signals:     [],
			parse_prerequisites: [],
			notes:               [`page_type=${pageType} is not excel_range/excel_sheet`],
		};
	}

	// Score all rules
	type ScoredRule = {
		rule: LayoutRule;
		matchCount: number;
		signals: string[];
	};
	const scored: ScoredRule[] = LAYOUT_RULES.map((rule) => {
		const { matchCount, signals } = scoreRule(rule, pageType, sheetTitle, textSample);
		return { rule, matchCount, signals };
	});

	// Sort by matchCount descending; ties broken by rule order (earlier = higher priority)
	scored.sort((a, b) => b.matchCount - a.matchCount);

	const best = scored[0]!;

	// No signals at all → unknown
	if (best.matchCount === 0) {
		return {
			doc_id:              input.document_id,
			page_index:          input.page_index,
			page_type:           pageType,
			sheet_title:         sheetTitle,
			layout:              "unknown",
			confidence:          "low",
			matched_signals:     [],
			parse_prerequisites: [],
			notes:               ["no layout signals matched"],
		};
	}

	const layout     = best.rule.layout;
	const confidence: "high" | "medium" | "low" =
		best.matchCount >= best.rule.highThreshold   ? "high"   :
		best.matchCount >= best.rule.mediumThreshold ? "medium" :
		"low";

	// Build prerequisites
	const prereqs: string[] = [];
	if (layout === "income_statement")  prereqs.push("requires excel_range with rows_preview");
	if (layout === "use_of_funds") {
		if (pageType === "excel_sheet") prereqs.push("requires monthly header row (Month N / named months)");
		else prereqs.push("requires excel_range with rows_preview");
	}
	if (layout === "budget_model")      prereqs.push("requires excel_sheet with structured_native_v1 sheets");
	if (layout === "cap_table")         prereqs.push("requires excel_range with rows_preview (shares/pct columns)");
	if (layout === "cash_flow")         prereqs.push("requires excel_range with rows_preview");
	if (layout === "balance_sheet")     prereqs.push("requires excel_range with rows_preview");
	if (layout === "saas_kpis")         prereqs.push("requires excel_range with rows_preview (MRR/ARR/churn rows)");
	if (layout === "bank_transactions") prereqs.push("requires excel_range with debit/credit/balance columns");

	const notes: string[] = [];
	if (confidence === "low") notes.push("low confidence — single weak signal");
	if (best.matchCount < best.rule.mediumThreshold) notes.push("below medium threshold — classified as unknown");

	return {
		doc_id:              input.document_id,
		page_index:          input.page_index,
		page_type:           pageType,
		sheet_title:         sheetTitle,
		layout,
		confidence,
		matched_signals:     best.signals,
		parse_prerequisites: prereqs,
		notes,
	};
}

// ─── Document-level summarizer ────────────────────────────────────────────────

export function buildDocumentLayoutSummary(
	docId:  string,
	pages:  FinancialLayoutClassificationV1[]
): DocumentLayoutSummaryV1 {
	// Count layout occurrences across pages
	const layoutCounts = new Map<LayoutType, number>();
	for (const p of pages) {
		if (p.layout === "unknown" || p.layout === "other") continue;
		layoutCounts.set(p.layout, (layoutCounts.get(p.layout) ?? 0) + 1);
	}
	let dominant: LayoutType | null = null;
	let domCount = 0;
	for (const [lt, cnt] of layoutCounts.entries()) {
		if (cnt > domCount) {
			dominant = lt;
			domCount = cnt;
		}
	}
	return { doc_id: docId, page_count: pages.length, layout_map: pages, dominant_layout: dominant };
}

// ─── Deal-level classifier (main entry point) ─────────────────────────────────

export function classifyDealLayouts(
	dealId: string,
	pages:  ClassifierPageInput[]
): DealLayoutClassificationV1 {
	// Group by document
	const byDoc = new Map<string, ClassifierPageInput[]>();
	for (const p of pages) {
		const grp = byDoc.get(p.document_id) ?? [];
		grp.push(p);
		byDoc.set(p.document_id, grp);
	}

	const documents: DocumentLayoutSummaryV1[] = [];
	let classifiedCount = 0;
	let totalXlCount    = 0;

	for (const [docId, docPages] of byDoc.entries()) {
		const xlPages = docPages.filter((p) => {
			const pt = (p.payload as Record<string, unknown> | null)?.["page_type"] as string | undefined;
			return pt === "excel_range" || pt === "excel_sheet";
		});
		totalXlCount += xlPages.length;

		const classified = xlPages.map((p) => classifyPage(p));
		classifiedCount += classified.filter(
			(c) => c.layout !== "unknown" && c.layout !== "other"
		).length;

		documents.push(buildDocumentLayoutSummary(docId, classified));
	}

	const allLayouts = documents.flatMap((d) => d.layout_map.map((l) => l.layout));

	return {
		schema_version:       "financial_layout_classifier_v1",
		deal_id:              dealId,
		documents,
		has_income_statement: allLayouts.includes("income_statement"),
		has_use_of_funds:     allLayouts.includes("use_of_funds"),
		has_budget_model:     allLayouts.includes("budget_model"),
		has_cap_table:        allLayouts.includes("cap_table"),
		has_cash_flow:        allLayouts.includes("cash_flow"),
		has_balance_sheet:    allLayouts.includes("balance_sheet"),
		has_saas_kpis:        allLayouts.includes("saas_kpis"),
		has_bank_txns:        allLayouts.includes("bank_transactions"),
		classified_pages:     classifiedCount,
		total_xl_pages:       totalXlCount,
		layout_coverage_pct:  totalXlCount > 0
			? Math.round((classifiedCount / totalXlCount) * 100)
			: 0,
	};
}
