import { containsMarketSizingLanguage } from '../classifiers/raise-detector.js';

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
  documents?: Array<{ document_id: string; kind?: string; mime_type?: string; filename?: string }> | null;
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

  // A) XLSX detection
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
  } else {
    // Per v1 spec: default to deck when no XLSX-like documents are present.
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

  // Confidence heuristic
  const coverageKeys = Object.keys(out.coverage) as Array<keyof FinancialCoverageProfileV1['coverage']>;
  const trueCount = coverageKeys.reduce((sum, k) => sum + (out.coverage[k] ? 1 : 0), 0);
  const hasXlsx = out.sources.some((s) => s.kind === 'xlsx');
  if (out.coverage.income_statement_present || (trueCount >= 5 && hasXlsx)) out.confidence = 'high';
  else if (trueCount >= 2 && trueCount <= 4) out.confidence = 'medium';
  else out.confidence = 'low';

  // Notes: track whether any evidence explicitly points at XLSX paths.
  const usedXlsxPath = (() => {
    const paths: string[] = [];
    for (const k of coverageKeys) {
      const sp = asNonEmptyString(out.evidence[k]?.source_path ?? null);
      if (sp) paths.push(sp.toLowerCase());
    }
    return paths.some((p) => p.endsWith('.xlsx') || p.endsWith('.xls') || p.endsWith('.csv') || p.includes('.xlsx#') || p.includes('.csv#'));
  })();
  const notes: string[] = [];
  if (hasXlsx) notes.push('xlsx_present');
  if (usedXlsxPath) notes.push('xlsx_evidence_used');
  if (notes.length > 0) out.notes = notes;

  return out;
}
