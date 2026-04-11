import { containsMarketSizingLanguage } from '../classifiers/raise-detector.js';
import type { FinancialFactV1 } from '../financial-facts/financial-fact-v1.js';

export type FinancialCoverageProfileV1 = {
  confidence: 'low' | 'medium' | 'high';
  sources: Array<{
    kind: 'deck' | 'xlsx' | 'other';
    document_id?: string;
    notes?: string;
  }>;
  coverage: {
    historical_revenue_present: boolean;
    forecast_revenue_present: boolean;
    income_statement_present: boolean;
    burn_rate_present: boolean;
    runway_present: boolean;
    unit_economics_present: boolean;
    balance_sheet_present: boolean;
    cash_flow_present: boolean;
  };
  evidence: Partial<Record<keyof FinancialCoverageProfileV1['coverage'], {
    document_id?: string;
    page_index?: number;
    page?: number;
    source_path?: string;
    snippet?: string;
  }>>;
  /**
   * Normalized 0–100 coverage quality score.
   * Derived from coverage flag count (out of 8) weighted by confidence level.
   * confidence_mult: high=1.0, medium=0.85, low=0.65.
   * Used by the report compiler to blend financial data quality into overallScore.
   */
  score?: number;
  notes?: string[];
};

type EvidenceRefLike = {
  document_id?: string;
  page_index?: number;
  page?: number;
  source_path?: string;
  snippet?: string;
};

type DocumentLike = { document_id: string; kind?: string; mime_type?: string; filename?: string };

const asNonEmptyString = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null;

const isXlsxLikeDocument = (doc: DocumentLike): boolean => {
  const filename = (doc.filename ?? '').toLowerCase();
  const kind = (doc.kind ?? '').toLowerCase();
  const mime = (doc.mime_type ?? '').toLowerCase();
  if (kind.includes('xlsx') || kind.includes('spreadsheet') || kind.includes('excel')) return true;
  if (mime.includes('spreadsheet') || mime.includes('excel') || mime.includes('csv')) return true;
  if (filename.endsWith('.xlsx') || filename.endsWith('.xls') || filename.endsWith('.csv')) return true;
  return false;
};

const isMarketSizingText = (text: string): boolean => {
  if (!text.trim()) return false;
  if (containsMarketSizingLanguage(text)) return true;
  return /\b(tam|sam|som|market\s*(size|sizing)|total\s+addressable\s+market|serviceable\s+available\s+market|serviceable\s+obtainable\s+market)\b/i.test(text);
};

const looksLikeFutureYear = (year: number, currentYear: number): boolean => year > currentYear;
const looksLikeHistoricalYear = (year: number, currentYear: number): boolean => year <= currentYear;

const firstEvidenceFromSources = (sources: unknown[]): EvidenceRefLike | null => {
  for (const s of sources) {
    if (!s || typeof s !== 'object') continue;
    const o: any = s;
    const document_id = asNonEmptyString(o.source_document_id ?? o.document_id ?? o.documentId ?? null) ?? undefined;
    const page_index = typeof o.page_index === 'number' ? o.page_index : typeof o.pageIndex === 'number' ? o.pageIndex : undefined;
    const page = typeof o.page === 'number' ? o.page : undefined;
    const source_path = asNonEmptyString(o.source_path ?? o.sourcePath ?? null) ?? undefined;
    const snippet = asNonEmptyString(o.note_snippet ?? o.snippet ?? null) ?? undefined;
    if (document_id || page_index != null || page != null || source_path || snippet) {
      return { document_id, page_index, page, source_path, snippet };
    }
  }
  return null;
};

const firstEvidenceFromPromotedFact = (pf: any, snippet?: string): EvidenceRefLike | null => {
  if (!pf || typeof pf !== 'object') return null;
  const cj = pf.content_json && typeof pf.content_json === 'object' ? pf.content_json : null;
  const prov = cj && typeof cj.provenance === 'object' ? (cj as any).provenance : null;

  const document_id =
    asNonEmptyString(prov?.source_document_id ?? pf.source_document_id ?? (pf.meta?.document_id ?? null)) ?? undefined;
  const page_index = typeof prov?.page_index === 'number'
    ? prov.page_index
    : (typeof pf.meta?.page_index === 'number' ? pf.meta.page_index : undefined);
  const page = typeof prov?.page === 'number' ? prov.page : undefined;
  const source_path = asNonEmptyString(prov?.source_path ?? pf.source_path ?? null) ?? undefined;
  const snippet0 = asNonEmptyString(snippet ?? null) ?? asNonEmptyString((cj as any)?.text ?? (cj as any)?.raw ?? null) ?? undefined;

  if (document_id || page_index != null || page != null || source_path || snippet0) {
    return { document_id, page_index, page, source_path, snippet: snippet0 };
  }
  return null;
};

const flag = (
  out: FinancialCoverageProfileV1,
  key: keyof FinancialCoverageProfileV1['coverage'],
  evidence: EvidenceRefLike | null
): void => {
  out.coverage[key] = true;
  if (evidence && !out.evidence[key]) out.evidence[key] = evidence;
};

export function inferFinancialCoverageProfileV1(input: {
  structured_summary: any;          // use typed path where possible
  promoted_facts?: any[] | null;    // if available in compiler context
  financial_facts?: FinancialFactV1[] | null;  // typed spreadsheet facts from financial_facts_v1
  documents?: Array<{ document_id: string; kind?: string; mime_type?: string; filename?: string }> | null;
  /** RC-001ft: SEC filing hint codes extracted from DIO claim text (e.g. 'sec_filing_s1'). */
  doc_type_hints?: string[] | null;
}): FinancialCoverageProfileV1 {
  const out: FinancialCoverageProfileV1 = {
    confidence: 'low',
    sources: [],
    coverage: {
      historical_revenue_present: false,
      forecast_revenue_present: false,
      income_statement_present: false,
      burn_rate_present: false,
      runway_present: false,
      unit_economics_present: false,
      balance_sheet_present: false,
      cash_flow_present: false,
    },
    evidence: {},
  };

  const currentYear = new Date().getFullYear();

  // A) XLSX detection — from document list and from financial_facts source_kind
  const docs: DocumentLike[] = Array.isArray(input.documents) ? input.documents.filter((d) => d && typeof d.document_id === 'string') as any : [];
  const xlsxDocs = docs.filter(isXlsxLikeDocument);
  if (xlsxDocs.length > 0) {
    for (const d of xlsxDocs) {
      out.sources.push({
        kind: 'xlsx',
        document_id: d.document_id,
        notes: d.filename ? `filename:${d.filename}` : undefined,
      });
    }
  }

  // Also treat xlsx-sourced financial_facts as an XLSX source (so /report with facts
  // but no explicit document metadata still gets correct source attribution).
  const typedFacts: FinancialFactV1[] = Array.isArray(input.financial_facts) ? input.financial_facts : [];
  const xlsxFactDocIds = new Set<string>();
  for (const f of typedFacts) {
    if (f.source_kind === 'xlsx' && f.document_id) xlsxFactDocIds.add(f.document_id);
  }
  const knownSourceDocIds = new Set(out.sources.map((s) => s.document_id).filter(Boolean));
  for (const docId of xlsxFactDocIds) {
    if (!knownSourceDocIds.has(docId)) {
      out.sources.push({ kind: 'xlsx', document_id: docId, notes: 'financial_facts_v1' });
      knownSourceDocIds.add(docId);
    }
  }

  if (out.sources.length === 0) {
    // Per v1 spec: default to deck when no XLSX-like sources found.
    out.sources.push({ kind: 'deck' });
  }

  const promoted = Array.isArray(input.promoted_facts) ? input.promoted_facts : [];

  // B) Historical vs forecast revenue
  const ss = input.structured_summary;
  const revenueCandidates = Array.isArray(ss?.revenue?.candidates) ? ss.revenue.candidates : [];
  for (const c of revenueCandidates) {
    const year = typeof c?.year === 'number' && Number.isFinite(c.year) ? c.year : null;
    const subtype = asNonEmptyString(c?.subtype) ? String(c.subtype).toLowerCase() : '';
    const raw = asNonEmptyString(c?.value_raw ?? c?.raw ?? c?.value ?? null) ?? '';
    const isForecast = subtype === 'forecast' || /\b(forecast|projection|projected|plan)\b/i.test(raw);
    const isMarketSizing = raw ? isMarketSizingText(raw) : false;
    if (isMarketSizing) continue;
    const ev = Array.isArray(c?.sources) ? firstEvidenceFromSources(c.sources) : null;

    if (year != null) {
      if (looksLikeFutureYear(year, currentYear) || isForecast) {
        flag(out, 'forecast_revenue_present', ev);
      } else if (looksLikeHistoricalYear(year, currentYear) && !isForecast) {
        flag(out, 'historical_revenue_present', ev);
      }
      continue;
    }

    // No explicit year: only accept as historical if it is explicitly non-forecast.
    if (raw && !isForecast) {
      flag(out, 'historical_revenue_present', ev);
    }
  }

  const factTypeOf = (pf: any): string => {
    const root = asNonEmptyString(pf?.fact_type);
    if (root) return root;
    const nested = asNonEmptyString(pf?.content_json?.fact_type);
    return nested ?? '';
  };

  for (const pf of promoted) {
    const ft = factTypeOf(pf);
    const cj = pf?.content_json && typeof pf.content_json === 'object' ? pf.content_json : {};
    const text = asNonEmptyString((cj as any)?.text ?? (cj as any)?.raw ?? (cj as any)?.display ?? null) ?? '';
    const scope = asNonEmptyString((cj as any)?.value_json?.scope ?? (cj as any)?.provenance?.scope ?? null);
    const subtype = asNonEmptyString((cj as any)?.value_json?.subtype ?? null);
    const year = typeof (cj as any)?.value_json?.year === 'number' ? (cj as any).value_json.year : null;

    // Revenue facts (exclude market sizing)
    if (ft === 'revenue_v1') {
      if (text && isMarketSizingText(text)) continue;
      if (scope && scope.toLowerCase().includes('market')) continue;
      const isForecast = (subtype && subtype.toLowerCase() === 'forecast') || /\b(forecast|projection|projected|plan)\b/i.test(text);
      const ev = firstEvidenceFromPromotedFact(pf, text);
      if (year != null) {
        if (looksLikeFutureYear(year, currentYear) || isForecast) flag(out, 'forecast_revenue_present', ev);
        else flag(out, 'historical_revenue_present', ev);
      } else if (isForecast) {
        flag(out, 'forecast_revenue_present', ev);
      } else {
        flag(out, 'historical_revenue_present', ev);
      }
      continue;
    }

    // Forecast signals via deterministic text/fact types
    if (ft.includes('forecast') || ft.includes('projection') || /\b(forecast|projection|projected|plan)\b/i.test(text)) {
      // Still block market sizing from being treated as revenue.
      if (text && !isMarketSizingText(text)) {
        flag(out, 'forecast_revenue_present', firstEvidenceFromPromotedFact(pf, text));
      }
    }
  }

  // C) Financial statements presence
  const statementTextHits = (text: string): {
    income: boolean;
    balance: boolean;
    cashFlow: boolean;
  } => {
    const s = text;
    const income = /\b(p&l|p\s*\/?\s*l|income\s+statement|profit\s+and\s+loss|cogs|gross\s+margin|opex|operating\s+expenses|ebitda)\b/i.test(s);
    const balance = /\b(balance\s+sheet|assets|liabilities|shareholders'?\s+equity|equity)\b/i.test(s);
    const cashFlow = /\b(cash\s*flow|cashflow|operating\s+cash\s*flow|free\s+cash\s*flow|\bocf\b|\bfcf\b)\b/i.test(s);
    return { income, balance, cashFlow };
  };

  for (const pf of promoted) {
    const cj = pf?.content_json && typeof pf.content_json === 'object' ? pf.content_json : {};
    const text = asNonEmptyString((cj as any)?.text ?? (cj as any)?.raw ?? (cj as any)?.display ?? null) ?? '';
    if (!text) continue;
    const ev = firstEvidenceFromPromotedFact(pf, text);
    const hit = statementTextHits(text);
    if (hit.income) flag(out, 'income_statement_present', ev);
    if (hit.balance) flag(out, 'balance_sheet_present', ev);
    if (hit.cashFlow) flag(out, 'cash_flow_present', ev);
  }

  // D) Burn/runway
  const burnRegex = /\b(burn\s+rate|monthly\s+burn|cash\s+burn|net\s+burn|burn)\b/i;
  const runwayRegex = /\brunway\b/i;
  const runwayWithMonthsRegex = /\b(runway)\b[^\n]{0,80}\b(\d{1,3})\s*(months|mos|mo)\b/i;

  for (const pf of promoted) {
    const cj = pf?.content_json && typeof pf.content_json === 'object' ? pf.content_json : {};
    const text = asNonEmptyString((cj as any)?.text ?? (cj as any)?.raw ?? (cj as any)?.display ?? null) ?? '';
    if (!text) continue;
    const ev = firstEvidenceFromPromotedFact(pf, text);
    if (burnRegex.test(text)) flag(out, 'burn_rate_present', ev);
    if (runwayWithMonthsRegex.test(text) || (runwayRegex.test(text) && /\d/.test(text))) flag(out, 'runway_present', ev);
  }

  // E) Unit economics
  const unitEconRegex = /\b(CAC|LTV|gross\s+margin\s*%|gross\s+margin|contribution\s+margin|payback\s+period|payback)\b/i;
  for (const pf of promoted) {
    const cj = pf?.content_json && typeof pf.content_json === 'object' ? pf.content_json : {};
    const text = asNonEmptyString((cj as any)?.text ?? (cj as any)?.raw ?? (cj as any)?.display ?? null) ?? '';
    if (!text) continue;
    if (unitEconRegex.test(text)) {
      flag(out, 'unit_economics_present', firstEvidenceFromPromotedFact(pf, text));
    }
  }

  // F) Typed financial_facts coverage — directly map metric_key to coverage flags.
  //    This is the primary signal path for XLSX-sourced financial data because
  //    FinancialFactV1 rows have typed metric_key/value fields, not content_json.text.
  if (typedFacts.length > 0) {
    const REVENUE_KEYS = new Set(['revenue', 'arr', 'mrr']);
    const INCOME_STMT_KEYS = new Set([
      'gross_profit', 'gross_margin', 'ebitda', 'net_income',
      'cogs', 'operating_expense', 'opex',
    ]);
    const UNIT_ECON_KEYS = new Set(['cac', 'ltv', 'arpu', 'gross_margin', 'churn_pct', 'retention_pct']);
    const CASH_FLOW_KEYS = new Set(['cash_flow', 'operating_cash_flow', 'free_cash_flow', 'ocf', 'fcf']);

    const isFactProjected = (f: FinancialFactV1): boolean => {
      if (f.temporal_scope === 'projected' || f.temporal_scope === 'scenario' || f.temporal_scope === 'target') return true;
      // Period label heuristics: if label contains a future year it's a projection.
      const yearMatch = f.period_label.match(/\b(20\d{2})\b/);
      if (yearMatch) {
        const year = Number(yearMatch[1]);
        if (looksLikeFutureYear(year, currentYear)) return true;
      }
      return false;
    };

    const factEvidence = (f: FinancialFactV1): EvidenceRefLike | null => {
      if (!f.document_id && f.page_number == null && !f.source_pointer) return null;
      return {
        document_id: f.document_id,
        page: f.page_number,
        source_path: f.source_pointer,
        snippet: f.excerpt,
      };
    };

    for (const f of typedFacts) {
      const mk = f.metric_key.toLowerCase();
      const ev = factEvidence(f);

      if (REVENUE_KEYS.has(mk)) {
        if (isFactProjected(f)) {
          flag(out, 'forecast_revenue_present', ev);
        } else {
          flag(out, 'historical_revenue_present', ev);
        }
      } else if (INCOME_STMT_KEYS.has(mk)) {
        flag(out, 'income_statement_present', ev);
      } else if (mk === 'burn_rate') {
        flag(out, 'burn_rate_present', ev);
      } else if (mk === 'cash_outflow_operating' || mk === 'cash_outflow') {
        // Cash outflow is the direct spend signal — treat as burn visibility even
        // before burn_rate is formally derived from it.
        flag(out, 'burn_rate_present', ev);
      } else if (mk === 'runway_months') {
        flag(out, 'runway_present', ev);
      } else if (UNIT_ECON_KEYS.has(mk)) {
        flag(out, 'unit_economics_present', ev);
      } else if (CASH_FLOW_KEYS.has(mk)) {
        flag(out, 'cash_flow_present', ev);
      }
    }
  }

  // RC-001ft: If SEC filing hints are present and no XLSX was detected, credit the filing
  // as an authoritative source. SEC filings contain audited financial statements — never
  // penalize them for the absence of a startup-style spreadsheet model.
  const secHints = Array.isArray(input.doc_type_hints) ? input.doc_type_hints : [];
  const secFilingPresent = secHints.some((h) => h === 'sec_filing_s1' || h === 'sec_filing_10k' || h === 'sec_filing_10q');
  if (secFilingPresent && out.sources.every((s) => s.kind !== 'xlsx')) {
    // Replace deck placeholder with authoritative filing source.
    const deckIdx = out.sources.findIndex((s) => s.kind === 'deck');
    if (deckIdx !== -1) out.sources.splice(deckIdx, 1);
    out.sources.push({ kind: 'other', notes: 'sec_filing_authoritative' });
  }

  // Confidence heuristic
  const coverageKeys = Object.keys(out.coverage) as Array<keyof FinancialCoverageProfileV1['coverage']>;
  const trueCount = coverageKeys.reduce((sum, k) => sum + (out.coverage[k] ? 1 : 0), 0);
  const hasXlsx = out.sources.some((s) => s.kind === 'xlsx');
  if (out.coverage.income_statement_present || (trueCount >= 5 && hasXlsx)) out.confidence = 'high';
  else if (trueCount >= 2 && trueCount <= 4) out.confidence = 'medium';
  else out.confidence = 'low';
  // RC-001ft: SEC filings contain audited financials — never score lower than medium.
  if (secFilingPresent && out.confidence === 'low') out.confidence = 'medium';

  // Notes: track whether any evidence explicitly points at XLSX paths or typed facts.
  const usedXlsxPath = (() => {
    const paths: string[] = [];
    for (const k of coverageKeys) {
      const sp = asNonEmptyString(out.evidence[k]?.source_path ?? null);
      if (sp) paths.push(sp.toLowerCase());
    }
    return paths.some((p) => p.endsWith('.xlsx') || p.endsWith('.xls') || p.endsWith('.csv') || p.includes('.xlsx#') || p.includes('.csv#'));
  })();
  const usedXlsxFacts = typedFacts.some((f) => f.source_kind === 'xlsx');
  const notes: string[] = [];
  if (hasXlsx) notes.push('xlsx_present');
  if (usedXlsxPath || usedXlsxFacts) notes.push('xlsx_evidence_used');
  if (secFilingPresent) notes.push('sec_filing_present');
  if (notes.length > 0) out.notes = notes;

  // Compute normalized coverage quality score 0–100 (Fix 15)
  // Weighted by confidence: high=1.0, medium=0.85, low=0.65
  const _COVERAGE_SCORE_KEYS: (keyof FinancialCoverageProfileV1['coverage'])[] = [
    'historical_revenue_present', 'forecast_revenue_present', 'income_statement_present',
    'burn_rate_present', 'runway_present', 'unit_economics_present',
    'balance_sheet_present', 'cash_flow_present',
  ];
  const _trueFlags = _COVERAGE_SCORE_KEYS.filter((k) => out.coverage[k]).length;
  const _CONF_MULT: Record<string, number> = { high: 1.0, medium: 0.85, low: 0.65 };
  out.score = Math.round((_trueFlags / _COVERAGE_SCORE_KEYS.length) * 100 * (_CONF_MULT[out.confidence] ?? 0.65));

  return out;
}
