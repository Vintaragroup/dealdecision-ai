/**
 * extraction/xlsx/sheet-classifier.ts
 *
 * Raw-sheet-level classifier for XLSX workbooks.
 *
 * This is a LOWER-LEVEL utility than financial-layout-classifier-v1.ts.
 * That file operates on full DPU pages (after extraction); this file operates
 * on the raw sheet metadata available when you first open a workbook:
 *   - Sheet/tab name
 *   - Header row values
 *   - First few row label values (col A)
 *
 * Design rules:
 *   - Pure functions only — no DB, no LLM, no side effects.
 *   - Prefer "unknown" over invention when signals are insufficient.
 *   - SheetKind is the typed output vocabulary; LayoutType (layout-classifier)
 *     is the routing vocabulary. They share values but serve different layers.
 *
 * SheetKind taxonomy:
 *   income_statement  — P&L, pro forma, financial overview
 *   cash_flow         — cash flow statement (operating/investing/financing)
 *   balance_sheet     — assets, liabilities, equity
 *   forecast_model    — forward-looking multi-period revenue/expense model
 *   scenario_model    — model with named scenario columns (Base/Bull/Bear etc.)
 *   cap_table         — equity ownership, share classes, dilution
 *   unit_economics    — SaaS KPIs, CAC, LTV, churn, MRR cohorts
 *   metrics_dashboard — multi-metric summary / KPI dashboard
 *   unknown           — insufficient signal to classify
 */

// ─── Public types ─────────────────────────────────────────────────────────────

export type SheetKind =
  | "income_statement"
  | "cash_flow"
  | "balance_sheet"
  | "forecast_model"
  | "scenario_model"
  | "cap_table"
  | "unit_economics"
  | "metrics_dashboard"
  | "unknown";

export interface ClassifySheetInput {
  /** Tab / worksheet name (e.g. "Income Statement", "Sheet1", "Pro Forma"). */
  name: string;
  /**
   * Column header row values (the first row that looks like period/category
   * headers, e.g. ["", "2024", "2025E", "2026E"]).
   */
  column_headers: string[];
  /**
   * Row label values from col A (first ~20 rows are sufficient).
   * e.g. ["Revenue", "COGS", "Gross Profit", "Operating Expenses", ...]
   */
  row_labels: string[];
}

export interface ClassifySheetResult {
  kind: SheetKind;
  confidence: "high" | "medium" | "low";
  /** Named signals that matched. Useful for debugging. */
  matched_signals: string[];
}

// ─── Signal banks ─────────────────────────────────────────────────────────────

const NAME_INCOME = /income\s*stmt|income\s+statement|p\s*[&]\s*l\b|profit\s+[&and]+\s+loss|financials?\s+overview|pnl\b/i;
const NAME_PRO_FORMA = /pro[- ]?forma|pro forma|proforma/i;
const NAME_CASH_FLOW = /cash\s+flow|cf\s+statement|cashflow/i;
const NAME_BALANCE = /balance\s+sheet|bs\b|assets?\s+[&and]+\s+liab/i;
const NAME_CAP_TABLE = /cap\s+table|capitalization|equity\s+schedule|ownership|share\s+(class|schedule)/i;
const NAME_UNIT_ECON = /unit\s+econ|saas\s+kpi|kpi\s+dashboard|cohort|cac\s+ltv|ltv\s+cac|retention|churn/i;
const NAME_SCENARIO = /scenario|base\s+case|bull\s+bear|upside\s*downside|sensitivity/i;
const NAME_FORECAST = /forecast|projection|budget|plan\b|model\b|three[- ]year|5[- ]year|18[- ]month/i;
const NAME_DASHBOARD = /dashboard|summary|overview|metrics\s+summary|kpi\s+summary/i;

// Header column signals
const HDR_SCENARIO_COL = /\b(base(\s+case)?|upside|downside|bull(\s+case)?|bear(\s+case)?|scenario\s*[A-Z]?|case\s*[1-3]?)\b/i;
const HDR_FORECAST_COL = /\b(\d{4}[Ee]?|fy\d{2,4}[Ee]?|h1|h2|q[1-4]\s+\d{4})\b/i;
const HDR_PERIOD_COL   = /\b(20\d{2}|fy\s*20\d{2}|q[1-4]\s+20\d{2}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i;

// Row label signals
const ROW_REVENUE    = /\b(total\s+)?rev(enue|enues)?\b/i;
const ROW_COGS       = /\bcogs\b|cost\s+of\s+(goods|revenue|sales)/i;
const ROW_GROSS      = /gross\s+profit/i;
const ROW_EBITDA     = /\bebitda\b|net\s+(income|loss|profit)/i;
const ROW_OPEX       = /opex|operating\s+(expense|expenses|cost)/i;
const ROW_BURN       = /\bburn(\s+rate)?\b|monthly\s+burn/i;
const ROW_CASH       = /\bcash\b|ending\s+cash|beginning\s+cash|cash\s+balance/i;
const ROW_ASSETS     = /\btotal\s+assets\b|\bcurrent\s+assets\b/i;
const ROW_LIAB       = /\btotal\s+(liabilities|liabs)\b|\baccounts\s+payable\b/i;
const ROW_EQUITY     = /\b(stockholders'?|shareholders'?|total)\s+equity\b/i;
const ROW_CAP_ENTRY  = /\b(common|preferred|series\s+[a-z]|option\s+pool|founder|employee|shares)\b/i;
const ROW_ARR        = /\barr\b|\bannual\s+recurring/i;
const ROW_MRR        = /\bmrr\b|\bmonthly\s+recurring/i;
const ROW_CHN        = /\bchurn\b|\bretention\b|\bnrr\b|\bnet\s+revenue\s+retention\b/i;
const ROW_CAC_LTV    = /\bcac\b|\bltv\b|\bltv\s*[:/]\s*cac\b|\bcac\s*[:/]\s*ltv\b/i;
const ROW_INVEST_ACT = /\binvesting\s+activit|\bfinancing\s+activit|\boperating\s+activit/i;
const ROW_CASH_FLOW_ITEMS = /\b(operating|investing|financing)\s+(cash|activit|flows?)\b|net\s+cash|\bcapex\b|capital\s+expenditure|free\s+cash\s+flow/i;

// ─── Scenario column detection ────────────────────────────────────────────────

/**
 * Returns true if the column headers contain multiple scenario labels
 * (e.g. ["Base", "Upside", "Downside"] or ["Bear Case", "Bull Case"]).
 */
export function hasScenarioColumns(column_headers: string[]): boolean {
  const matches = column_headers.filter((h) => HDR_SCENARIO_COL.test(h));
  return matches.length >= 2;
}

/**
 * Extract the distinct scenario labels from a set of column headers.
 * Returns empty array when none are detected.
 *
 * Examples:
 *   ["", "2025", "Base", "Upside", "Downside"] → ["Base", "Upside", "Downside"]
 *   ["2023", "2024", "2025E"] → []
 */
export function extractScenarioLabels(column_headers: string[]): string[] {
  return column_headers
    .map((h) => h.trim())
    .filter((h) => h.length > 0 && HDR_SCENARIO_COL.test(h));
}

/**
 * Returns true when the column headers contain projected-period markers
 * (e.g. "2025E", "FY2026E", "H1 2027").
 * Used to distinguish a forecast model from a historical income statement.
 */
export function hasForecastColumns(column_headers: string[]): boolean {
  return column_headers.some((h) => /\d{4}e\b/i.test(h) || /\bfy\d{2,4}e\b/i.test(h));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Classify a worksheet from its name, column headers, and row labels.
 *
 * Priority order:
 *   1. scenario_model — must be detected first (overrides income_statement)
 *   2. cap_table
 *   3. balance_sheet
 *   4. cash_flow
 *   5. unit_economics
 *   6. income_statement
 *   7. forecast_model  (pro forma / projected income statement)
 *   8. metrics_dashboard
 *   9. unknown
 */
export function classifySheet(input: ClassifySheetInput): ClassifySheetResult {
  const { name, column_headers, row_labels } = input;
  const matched: string[] = [];

  const testName = (re: RegExp, signal: string): boolean => {
    if (re.test(name)) { matched.push(signal); return true; }
    return false;
  };
  const testHeaders = (re: RegExp, signal: string): boolean => {
    for (const h of column_headers) {
      if (re.test(h)) { matched.push(signal); return true; }
    }
    return false;
  };
  const testLabels = (re: RegExp, signal: string): boolean => {
    for (const l of row_labels) {
      if (re.test(l)) { matched.push(signal); return true; }
    }
    return false;
  };
  const countLabelMatches = (regs: RegExp[]): number =>
    regs.reduce((n, re) => n + (row_labels.some((l) => re.test(l)) ? 1 : 0), 0);

  // ── 1. Scenario model ───────────────────────────────────────────────────
  const scenarioHit = testName(NAME_SCENARIO, "name:scenario") ||
    (hasScenarioColumns(column_headers) && matched.push("headers:scenario_cols") && true);
  if (scenarioHit) {
    return { kind: "scenario_model", confidence: matched.length >= 2 ? "high" : "medium", matched_signals: matched };
  }

  // ── 2. Cap table ────────────────────────────────────────────────────────
  const capNameHit = testName(NAME_CAP_TABLE, "name:cap_table");
  const capRowHits = countLabelMatches([ROW_CAP_ENTRY]);
  if (capNameHit || capRowHits >= 2) {
    if (!capNameHit) matched.push("rows:cap_entries");
    return { kind: "cap_table", confidence: capNameHit ? "high" : "medium", matched_signals: matched };
  }

  // ── 3. Balance sheet ────────────────────────────────────────────────────
  const bsNameHit = testName(NAME_BALANCE, "name:balance_sheet");
  const bsRowHits = countLabelMatches([ROW_ASSETS, ROW_LIAB, ROW_EQUITY]);
  if (bsNameHit || bsRowHits >= 2) {
    if (!bsNameHit) matched.push(`rows:${bsRowHits}_balance_sheet_rows`);
    return { kind: "balance_sheet", confidence: bsNameHit || bsRowHits >= 2 ? "high" : "medium", matched_signals: matched };
  }

  // ── 4. Cash flow ────────────────────────────────────────────────────────
  const cfNameHit = testName(NAME_CASH_FLOW, "name:cash_flow");
  const cfRowHit  = testLabels(ROW_INVEST_ACT, "rows:investing_activities") ||
    testLabels(ROW_CASH_FLOW_ITEMS, "rows:cash_flow_items");
  if (cfNameHit || cfRowHit) {
    return { kind: "cash_flow", confidence: cfNameHit ? "high" : "medium", matched_signals: matched };
  }

  // ── 5. Unit economics ───────────────────────────────────────────────────
  const ueNameHit = testName(NAME_UNIT_ECON, "name:unit_economics");
  const ueRowHits = countLabelMatches([ROW_ARR, ROW_MRR, ROW_CHN, ROW_CAC_LTV]);
  if (ueNameHit || ueRowHits >= 2) {
    if (!ueNameHit) matched.push(`rows:${ueRowHits}_unit_economics_rows`);
    return { kind: "unit_economics", confidence: ueNameHit || ueRowHits >= 3 ? "high" : "medium", matched_signals: matched };
  }

  // ── 6/7. Income statement vs forecast model ─────────────────────────────
  const incomeNameHit  = testName(NAME_INCOME,    "name:income_statement");
  const proFormaNameHit = testName(NAME_PRO_FORMA, "name:pro_forma");
  const forecastNameHit = testName(NAME_FORECAST,  "name:forecast");
  const incomeRowHits  = countLabelMatches([ROW_REVENUE, ROW_COGS, ROW_GROSS, ROW_EBITDA, ROW_OPEX]);
  const hasForecastCols = hasForecastColumns(column_headers) && (matched.push("headers:forecast_period_cols"), true);

  if (incomeRowHits >= 2 || incomeNameHit || proFormaNameHit || forecastNameHit) {
    if (!incomeNameHit && !proFormaNameHit && !forecastNameHit) matched.push(`rows:${incomeRowHits}_income_rows`);
    // Classify as forecast_model when the name or columns signal forward-looking data
    if (proFormaNameHit || hasForecastCols || forecastNameHit) {
      return { kind: "forecast_model", confidence: (proFormaNameHit || forecastNameHit) ? "high" : "medium", matched_signals: matched };
    }
    return { kind: "income_statement", confidence: incomeNameHit || incomeRowHits >= 3 ? "high" : "medium", matched_signals: matched };
  }

  // ── 8. Metrics dashboard ────────────────────────────────────────────────
  const dashNameHit = testName(NAME_DASHBOARD, "name:dashboard");
  const dashRowHits = countLabelMatches([ROW_ARR, ROW_BURN, ROW_CASH]);
  if (dashNameHit || dashRowHits >= 2) {
    if (!dashNameHit) matched.push(`rows:${dashRowHits}_dashboard_rows`);
    return { kind: "metrics_dashboard", confidence: dashNameHit ? "high" : "medium", matched_signals: matched };
  }

  // ── 9. Unknown ──────────────────────────────────────────────────────────
  return { kind: "unknown", confidence: "low", matched_signals: [] };
}
