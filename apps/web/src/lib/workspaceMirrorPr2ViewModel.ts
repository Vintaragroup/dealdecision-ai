export type WorkspaceMirrorFactQuality = 'promoted' | 'fallback' | 'unknown';

export type WorkspaceMirrorFactField = {
  value: string | null;
  quality: WorkspaceMirrorFactQuality;
  sources?: unknown;
  evidence_ids?: string[];
  evidence_basis?: 'direct_snippet' | 'no_evidence' | string;
};

export type WorkspaceMirrorOverviewVM =
  | {
      missing: true;
      source: null;
      one_liner: null;
      paragraphs: [];
      strengths: [];
      risks: [];
      open_questions: [];
      facts: {
        product_solution: WorkspaceMirrorFactField;
        market_icp: WorkspaceMirrorFactField;
        business_model: WorkspaceMirrorFactField;
        raise: WorkspaceMirrorFactField;
      };
      traction_signals: [];
      key_risks_detected: [];
      sources: null;
    }
  | {
      missing: false;
      source: 'llm_overview_v1' | 'phase1';
      one_liner: string | null;
      paragraphs: string[];
      strengths: string[];
      risks: string[];
      open_questions: string[];
      facts: {
        product_solution: WorkspaceMirrorFactField;
        market_icp: WorkspaceMirrorFactField;
        business_model: WorkspaceMirrorFactField;
        raise: WorkspaceMirrorFactField;
      };
      traction_signals: string[];
      key_risks_detected: string[];
      sources: unknown;
    };

const collapseWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const asNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const s = collapseWhitespace(value);
  return s.length > 0 ? s : null;
};

const asStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of value) {
    const s = asNonEmptyString(v);
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
};

const asEvidenceIdArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of value) {
    if (typeof v !== 'string') continue;
    const s = v.trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out.slice(0, 25);
};

const safeJsonParseObject = (value: unknown): Record<string, any> | null => {
  if (!value) return null;
  if (typeof value === 'object') return value as any;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? (parsed as any) : null;
  } catch {
    return null;
  }
};

const isLikelyBoilerplateOrJunk = (value: string): boolean => {
  const s = collapseWhitespace(value);
  if (!s) return true;

  const lower = s.toLowerCase();
  if (lower.includes('all rights reserved')) return true;
  if (lower.includes('copyright')) return true;
  if (lower.includes('confidential')) return true;
  if (s.includes('©')) return true;

  // Very link-heavy / footer-ish strings should not be treated as extracted facts.
  const urlHits = (s.match(/https?:\/\//g) ?? []).length;
  if (urlHits >= 1 && s.length < 120) return true;

  // Basic OCR junk heuristic: too many symbols / replacement chars.
  if (/[\uFFFD�]/.test(s)) return true;
  const noSpace = s.replace(/\s+/g, '');
  if (noSpace.length >= 24) {
    const letters = (noSpace.match(/[A-Za-z]/g) ?? []).length;
    const symbols = (noSpace.match(/[^A-Za-z0-9]/g) ?? []).length;
    const letterRatio = letters / noSpace.length;
    const symbolRatio = symbols / noSpace.length;
    if (letterRatio < 0.35) return true;
    if (symbolRatio > 0.55) return true;
  }

  return false;
};

const cleanFactStringOrNull = (value: unknown): string | null => {
  const s = asNonEmptyString(value);
  if (!s) return null;
  if (isLikelyBoilerplateOrJunk(s)) return null;
  return s;
};

const asNoteString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  return s.length > 0 ? s : null;
};

const noteMatchesToken = (note: string, token: string): boolean => {
  const n = note.toLowerCase();
  const t = token.toLowerCase();
  if (!n || !t) return false;
  if (n.includes(t)) return true;
  // Be tolerant to notes that use spaces rather than underscores.
  const spaced = t.replace(/_/g, ' ');
  return spaced !== t ? n.includes(spaced) : false;
};

const classifyFactQuality = (fieldKey: string, sources: unknown): WorkspaceMirrorFactQuality => {
  if (!Array.isArray(sources) || sources.length === 0) return 'unknown';
  const fallbackToken = `fallback_${fieldKey}`;
  const promotedToken = `promoted_${fieldKey}`;

  for (const s of sources) {
    if (!s || typeof s !== 'object') continue;
    const note = asNoteString((s as any).note);
    if (!note) continue;
    if (noteMatchesToken(note, fallbackToken)) return 'fallback';
  }

  for (const s of sources) {
    if (!s || typeof s !== 'object') continue;
    const note = asNoteString((s as any).note);
    if (!note) continue;
    if (noteMatchesToken(note, promotedToken)) return 'promoted';
  }

  return 'unknown';
};

const sourcesForFactField = (fieldKey: string, sources: unknown): unknown => {
  if (!Array.isArray(sources) || sources.length === 0) return undefined;
  const tokens = [`fallback_${fieldKey}`, `promoted_${fieldKey}`];
  const matched = sources.filter((s) => {
    if (!s || typeof s !== 'object') return false;
    const note = asNoteString((s as any).note);
    if (!note) return false;
    return tokens.some((t) => noteMatchesToken(note, t));
  });
  return matched.length > 0 ? matched : undefined;
};

const emptyVM: WorkspaceMirrorOverviewVM = {
  missing: true,
  source: null,
  one_liner: null,
  paragraphs: [],
  strengths: [],
  risks: [],
  open_questions: [],
  facts: {
    product_solution: { value: null, quality: 'unknown' },
    market_icp: { value: null, quality: 'unknown' },
    business_model: { value: null, quality: 'unknown' },
    raise: { value: null, quality: 'unknown' },
  },
  traction_signals: [],
  key_risks_detected: [],
  sources: null,
};

export function buildWorkspaceMirrorOverviewVM(overview: any): WorkspaceMirrorOverviewVM {
  const ov = (overview && typeof overview === 'object' && 'overview' in overview)
    ? (overview as any).overview
    : overview;

  if (!ov || typeof ov !== 'object') return emptyVM;

  const overviewJson = safeJsonParseObject((ov as any).overview_json) ?? null;
  if (!overviewJson || typeof overviewJson !== 'object') return emptyVM;

  const displayFactsV1 = (overviewJson as any).display_facts_v1;
  const displayFactsV1Obj = displayFactsV1 && typeof displayFactsV1 === 'object' ? (displayFactsV1 as any) : null;
  const displayFactsEvidenceFor = (key: 'product_solution' | 'market_icp' | 'business_model' | 'raise'):
    | { evidence_ids: string[]; evidence_basis?: string }
    | null => {
    if (!displayFactsV1Obj) return null;
    const field = displayFactsV1Obj[key];
    if (!field || typeof field !== 'object') return null;
    const evidence_ids = asEvidenceIdArray((field as any).evidence_ids);
    const evidence_basis = typeof (field as any).evidence_basis === 'string' ? (field as any).evidence_basis : undefined;
    return { evidence_ids, evidence_basis };
  };

  // Prefer llm_overview_v1 if future persisted payloads include it.
  const llmOverview = (overviewJson as any).llm_overview_v1;
  if (llmOverview && typeof llmOverview === 'object') {
    const dealSummary = (llmOverview as any).deal_summary;

    const hero = cleanFactStringOrNull((dealSummary as any)?.hero);
    const mid = cleanFactStringOrNull((dealSummary as any)?.mid);
    const longRaw = (dealSummary as any)?.long;
    const paragraphs = typeof longRaw === 'string'
      ? longRaw
          .replace(/\r\n/g, '\n')
          .split(/\n{2,}/g)
          .map((p) => cleanFactStringOrNull(p))
          .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
      : [];

    return {
      missing: false,
      source: 'llm_overview_v1',
      one_liner: hero ?? mid ?? null,
      paragraphs,
      strengths: asStringArray((llmOverview as any).strengths_overlay),
      risks: asStringArray((llmOverview as any).concerns_overlay),
      open_questions: [],
      facts: {
        product_solution: { value: null, quality: 'unknown' },
        market_icp: { value: null, quality: 'unknown' },
        business_model: { value: null, quality: 'unknown' },
        raise: { value: null, quality: 'unknown' },
      },
      traction_signals: [],
      key_risks_detected: asStringArray((llmOverview as any).coverage_gaps_overlay),
      sources: (llmOverview as any).sources ?? null,
    };
  }

  const phase1 = (overviewJson as any).phase1;
  if (!phase1 || typeof phase1 !== 'object') return emptyVM;

  const dealSummaryV2 = (phase1 as any).deal_summary_v2;
  const summary = dealSummaryV2 && typeof dealSummaryV2 === 'object' ? (dealSummaryV2 as any).summary : null;

  const dealOverviewV2 = (phase1 as any).deal_overview_v2;
  const dealOverviewSources = dealOverviewV2 && typeof dealOverviewV2 === 'object' ? ((dealOverviewV2 as any).sources ?? null) : null;

  const summaryTextFallback = cleanFactStringOrNull((ov as any).summary_text);

  return {
    missing: false,
    source: 'phase1',
    one_liner: cleanFactStringOrNull(summary && typeof summary === 'object' ? (summary as any).one_liner : null) ?? summaryTextFallback,
    paragraphs: asStringArray(summary && typeof summary === 'object' ? (summary as any).paragraphs : null),
    strengths: asStringArray(dealSummaryV2 && typeof dealSummaryV2 === 'object' ? (dealSummaryV2 as any).strengths : null),
    risks: asStringArray(dealSummaryV2 && typeof dealSummaryV2 === 'object' ? (dealSummaryV2 as any).risks : null),
    open_questions: asStringArray(dealSummaryV2 && typeof dealSummaryV2 === 'object' ? (dealSummaryV2 as any).open_questions : null),
    facts: {
      product_solution: {
        value: cleanFactStringOrNull(dealOverviewV2 && typeof dealOverviewV2 === 'object' ? (dealOverviewV2 as any).product_solution : null),
        quality: classifyFactQuality('product_solution', dealOverviewSources),
        sources: sourcesForFactField('product_solution', dealOverviewSources),
        ...(displayFactsEvidenceFor('product_solution') ?? {}),
      },
      market_icp: {
        value: cleanFactStringOrNull(dealOverviewV2 && typeof dealOverviewV2 === 'object' ? (dealOverviewV2 as any).market_icp : null),
        quality: classifyFactQuality('market_icp', dealOverviewSources),
        sources: sourcesForFactField('market_icp', dealOverviewSources),
        ...(displayFactsEvidenceFor('market_icp') ?? {}),
      },
      business_model: {
        value: cleanFactStringOrNull(dealOverviewV2 && typeof dealOverviewV2 === 'object' ? (dealOverviewV2 as any).business_model : null),
        quality: classifyFactQuality('business_model', dealOverviewSources),
        sources: sourcesForFactField('business_model', dealOverviewSources),
        ...(displayFactsEvidenceFor('business_model') ?? {}),
      },
      raise: {
        value: cleanFactStringOrNull(dealOverviewV2 && typeof dealOverviewV2 === 'object' ? (dealOverviewV2 as any).raise : null),
        quality: classifyFactQuality('raise', dealOverviewSources),
        sources: sourcesForFactField('raise', dealOverviewSources),
        ...(displayFactsEvidenceFor('raise') ?? {}),
      },
    },
    traction_signals: asStringArray(dealOverviewV2 && typeof dealOverviewV2 === 'object' ? (dealOverviewV2 as any).traction_signals : null),
    key_risks_detected: asStringArray(dealOverviewV2 && typeof dealOverviewV2 === 'object' ? (dealOverviewV2 as any).key_risks_detected : null),
    sources: dealOverviewV2 && typeof dealOverviewV2 === 'object' ? ((dealOverviewV2 as any).sources ?? null) : null,
  };
}
