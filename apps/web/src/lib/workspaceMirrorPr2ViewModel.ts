export type WorkspaceMirrorFactQuality = 'promoted' | 'fallback' | 'unknown';

export type WorkspaceMirrorFieldSource = 'governed' | 'deterministic' | 'missing';

export type WorkspaceMirrorEvidenceRef = {
  source_document_id: string;
  page_index: number;
  slide_title?: string | null;
  snippet: string;
};

export type WorkspaceMirrorFactField = {
  value: string | null;
  source: WorkspaceMirrorFieldSource;
  quality: WorkspaceMirrorFactQuality;
  sources?: unknown;
  evidence_ids?: string[];
  evidence_refs?: WorkspaceMirrorEvidenceRef[];
  evidence_basis?: 'direct_snippet' | 'no_evidence' | string;
};

export type WorkspaceMirrorOverviewVM =
  | {
      missing: true;
      source: null;
      one_liner: null;
      field_sources: {
        hero_summary: 'missing';
        product_solution: 'missing';
        market_icp: 'missing';
        business_model: 'missing';
        raise_terms: 'missing';
        strengths: 'missing';
        concerns: 'missing';
        open_questions: 'missing';
        traction: 'missing';
      };
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
      evidence_refs: {
        deal_one_liner: [];
        product_solution: [];
        market_icp: [];
        business_model: [];
        raise_terms: [];
        strengths: [];
        concerns: [];
        open_questions: [];
        traction: [];
      };
      sources: null;
    }
  | {
      missing: false;
      source: 'llm_overview_v1' | 'phase1';
      one_liner: string | null;
      field_sources: {
        hero_summary: WorkspaceMirrorFieldSource;
        product_solution: WorkspaceMirrorFieldSource;
        market_icp: WorkspaceMirrorFieldSource;
        business_model: WorkspaceMirrorFieldSource;
        raise_terms: WorkspaceMirrorFieldSource;
        strengths: WorkspaceMirrorFieldSource;
        concerns: WorkspaceMirrorFieldSource;
        open_questions: WorkspaceMirrorFieldSource;
        traction: WorkspaceMirrorFieldSource;
      };
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
      evidence_refs: {
        deal_one_liner: WorkspaceMirrorEvidenceRef[];
        product_solution: WorkspaceMirrorEvidenceRef[];
        market_icp: WorkspaceMirrorEvidenceRef[];
        business_model: WorkspaceMirrorEvidenceRef[];
        raise_terms: WorkspaceMirrorEvidenceRef[];
        strengths: WorkspaceMirrorEvidenceRef[];
        concerns: WorkspaceMirrorEvidenceRef[];
        open_questions: WorkspaceMirrorEvidenceRef[];
        traction: WorkspaceMirrorEvidenceRef[];
      };
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

const asEvidenceRefArray = (value: unknown): WorkspaceMirrorEvidenceRef[] => {
  if (!Array.isArray(value)) return [];
  const out: WorkspaceMirrorEvidenceRef[] = [];
  const seen = new Set<string>();

  for (const v of value) {
    if (!v || typeof v !== 'object') continue;
    const source_document_id = typeof (v as any).source_document_id === 'string' ? (v as any).source_document_id.trim() : '';
    const snippet = typeof (v as any).snippet === 'string' ? (v as any).snippet.trim() : '';
    const page_index_raw = (v as any).page_index;
    const page_index = typeof page_index_raw === 'number' && Number.isFinite(page_index_raw) ? Math.max(0, Math.floor(page_index_raw)) : null;
    const slide_title = typeof (v as any).slide_title === 'string' ? (v as any).slide_title.trim() : null;

    if (!source_document_id || page_index == null) continue;
    const key = `${source_document_id}::${page_index}::${snippet.slice(0, 64).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({ source_document_id, page_index, snippet, slide_title });
  }

  return out.slice(0, 12);
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
  field_sources: {
    hero_summary: 'missing',
    product_solution: 'missing',
    market_icp: 'missing',
    business_model: 'missing',
    raise_terms: 'missing',
    strengths: 'missing',
    concerns: 'missing',
    open_questions: 'missing',
    traction: 'missing',
  },
  paragraphs: [],
  strengths: [],
  risks: [],
  open_questions: [],
  facts: {
    product_solution: { value: null, source: 'missing', quality: 'unknown' },
    market_icp: { value: null, source: 'missing', quality: 'unknown' },
    business_model: { value: null, source: 'missing', quality: 'unknown' },
    raise: { value: null, source: 'missing', quality: 'unknown' },
  },
  traction_signals: [],
  key_risks_detected: [],
  evidence_refs: {
    deal_one_liner: [],
    product_solution: [],
    market_icp: [],
    business_model: [],
    raise_terms: [],
    strengths: [],
    concerns: [],
    open_questions: [],
    traction: [],
  },
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
    const field = key === 'raise'
      ? (displayFactsV1Obj.raise ?? displayFactsV1Obj.raise_terms)
      : displayFactsV1Obj[key];
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
      field_sources: {
        hero_summary: (hero ?? mid) ? 'governed' : 'missing',
        product_solution: 'missing',
        market_icp: 'missing',
        business_model: 'missing',
        raise_terms: 'missing',
        strengths: Array.isArray((llmOverview as any).strengths_overlay) && asStringArray((llmOverview as any).strengths_overlay).length > 0 ? 'governed' : 'missing',
        concerns: Array.isArray((llmOverview as any).concerns_overlay) && asStringArray((llmOverview as any).concerns_overlay).length > 0 ? 'governed' : 'missing',
        open_questions: 'missing',
        traction: 'missing',
      },
      paragraphs,
      strengths: asStringArray((llmOverview as any).strengths_overlay),
      risks: asStringArray((llmOverview as any).concerns_overlay),
      open_questions: [],
      facts: {
        product_solution: { value: null, source: 'missing', quality: 'unknown' },
        market_icp: { value: null, source: 'missing', quality: 'unknown' },
        business_model: { value: null, source: 'missing', quality: 'unknown' },
        raise: { value: null, source: 'missing', quality: 'unknown' },
      },
      traction_signals: [],
      key_risks_detected: asStringArray((llmOverview as any).coverage_gaps_overlay),
      evidence_refs: {
        deal_one_liner: [],
        product_solution: [],
        market_icp: [],
        business_model: [],
        raise_terms: [],
        strengths: [],
        concerns: [],
        open_questions: [],
        traction: [],
      },
      sources: (llmOverview as any).sources ?? null,
    };
  }

  const phase1 = (overviewJson as any).phase1;
  if (!phase1 || typeof phase1 !== 'object') return emptyVM;

  const governedUiCopy = (phase1 as any).governed_ui_copy_v1;
  const governedUiCopyObj = governedUiCopy && typeof governedUiCopy === 'object' ? (governedUiCopy as any) : null;
  const governedUiCopyOk = governedUiCopyObj && (governedUiCopyObj as any).schema_version === 'governed_ui_copy_v1';
  const governedEvidence = governedUiCopyOk && governedUiCopyObj?.evidence_ids && typeof governedUiCopyObj.evidence_ids === 'object'
    ? (governedUiCopyObj.evidence_ids as any)
    : null;

  const governedEvidenceMap = governedUiCopyOk && governedUiCopyObj?.evidence_map && typeof governedUiCopyObj.evidence_map === 'object'
    ? (governedUiCopyObj.evidence_map as any)
    : null;

  const dealSummaryV2 = (phase1 as any).deal_summary_v2;
  const summary = dealSummaryV2 && typeof dealSummaryV2 === 'object' ? (dealSummaryV2 as any).summary : null;

  const dealOverviewV2 = (phase1 as any).deal_overview_v2;
  const dealOverviewSources = dealOverviewV2 && typeof dealOverviewV2 === 'object' ? ((dealOverviewV2 as any).sources ?? null) : null;

  const summaryTextFallback = cleanFactStringOrNull((ov as any).summary_text);

  const pickString = (governed: unknown, deterministic: unknown): { value: string | null; source: WorkspaceMirrorFieldSource } => {
    const g = cleanFactStringOrNull(governed);
    if (g) return { value: g, source: 'governed' };
    const d = cleanFactStringOrNull(deterministic);
    if (d) return { value: d, source: 'deterministic' };
    return { value: null, source: 'missing' };
  };

  const pickList = (governed: unknown, deterministic: unknown): { value: string[]; source: WorkspaceMirrorFieldSource } => {
    const g = asStringArray(governed);
    if (g.length > 0) return { value: g, source: 'governed' };
    const d = asStringArray(deterministic);
    if (d.length > 0) return { value: d, source: 'deterministic' };
    return { value: [], source: 'missing' };
  };

  const evidence_refs = {
    deal_one_liner: asEvidenceRefArray(governedEvidenceMap?.deal_summary_mid),
    product_solution: asEvidenceRefArray(governedEvidenceMap?.product_solution),
    market_icp: asEvidenceRefArray(governedEvidenceMap?.market_icp),
    business_model: asEvidenceRefArray(governedEvidenceMap?.business_model),
    raise_terms: asEvidenceRefArray(governedEvidenceMap?.raise_terms ?? governedEvidenceMap?.raise),
    strengths: asEvidenceRefArray(governedEvidenceMap?.strengths),
    concerns: asEvidenceRefArray(governedEvidenceMap?.concerns),
    open_questions: asEvidenceRefArray(governedEvidenceMap?.open_questions),
    traction: asEvidenceRefArray(governedEvidenceMap?.traction),
  };

  const heroPicked = pickString(governedUiCopyOk ? governedUiCopyObj?.hero_summary : null, summary && typeof summary === 'object' ? (summary as any).one_liner : null);
  const productPicked = pickString(governedUiCopyOk ? governedUiCopyObj?.product_solution : null, dealOverviewV2 && typeof dealOverviewV2 === 'object' ? (dealOverviewV2 as any).product_solution : null);
  const marketPicked = pickString(governedUiCopyOk ? governedUiCopyObj?.market_icp : null, dealOverviewV2 && typeof dealOverviewV2 === 'object' ? (dealOverviewV2 as any).market_icp : null);
  const modelPicked = pickString(governedUiCopyOk ? governedUiCopyObj?.business_model : null, dealOverviewV2 && typeof dealOverviewV2 === 'object' ? (dealOverviewV2 as any).business_model : null);
  const raisePicked = pickString(governedUiCopyOk ? governedUiCopyObj?.raise_terms : null, dealOverviewV2 && typeof dealOverviewV2 === 'object' ? (dealOverviewV2 as any).raise : null);
  const strengthsPicked = pickList(governedUiCopyOk ? governedUiCopyObj?.strengths : null, dealSummaryV2 && typeof dealSummaryV2 === 'object' ? (dealSummaryV2 as any).strengths : null);
  const concernsPicked = pickList(governedUiCopyOk ? governedUiCopyObj?.concerns : null, dealSummaryV2 && typeof dealSummaryV2 === 'object' ? (dealSummaryV2 as any).risks : null);
  const openQuestionsPicked = pickList(governedUiCopyOk ? governedUiCopyObj?.open_questions : null, dealSummaryV2 && typeof dealSummaryV2 === 'object' ? (dealSummaryV2 as any).open_questions : null);
  const tractionPicked = pickList(governedUiCopyOk ? governedUiCopyObj?.traction : null, dealOverviewV2 && typeof dealOverviewV2 === 'object' ? (dealOverviewV2 as any).traction_signals : null);

  return {
    missing: false,
    source: 'phase1',
    one_liner: heroPicked.value ?? summaryTextFallback,
    field_sources: {
      hero_summary: heroPicked.value ? heroPicked.source : (summaryTextFallback ? 'deterministic' : 'missing'),
      product_solution: productPicked.source,
      market_icp: marketPicked.source,
      business_model: modelPicked.source,
      raise_terms: raisePicked.source,
      strengths: strengthsPicked.source,
      concerns: concernsPicked.source,
      open_questions: openQuestionsPicked.source,
      traction: tractionPicked.source,
    },
    paragraphs: asStringArray(summary && typeof summary === 'object' ? (summary as any).paragraphs : null),
    strengths: strengthsPicked.value,
    risks: concernsPicked.value,
    open_questions: openQuestionsPicked.value,
    facts: {
      product_solution: {
        value: productPicked.value,
        source: productPicked.source,
        quality: classifyFactQuality('product_solution', dealOverviewSources),
        sources: sourcesForFactField('product_solution', dealOverviewSources),
        evidence_ids: governedUiCopyOk ? asEvidenceIdArray(governedEvidence?.product_solution) : (displayFactsEvidenceFor('product_solution')?.evidence_ids ?? undefined),
        evidence_refs: governedUiCopyOk ? evidence_refs.product_solution : undefined,
        evidence_basis: governedUiCopyOk
          ? (asEvidenceIdArray(governedEvidence?.product_solution).length > 0 ? 'direct_snippet' : 'no_evidence')
          : (displayFactsEvidenceFor('product_solution')?.evidence_basis ?? undefined),
      },
      market_icp: {
        value: marketPicked.value,
        source: marketPicked.source,
        quality: classifyFactQuality('market_icp', dealOverviewSources),
        sources: sourcesForFactField('market_icp', dealOverviewSources),
        evidence_ids: governedUiCopyOk ? asEvidenceIdArray(governedEvidence?.market_icp) : (displayFactsEvidenceFor('market_icp')?.evidence_ids ?? undefined),
        evidence_refs: governedUiCopyOk ? evidence_refs.market_icp : undefined,
        evidence_basis: governedUiCopyOk
          ? (asEvidenceIdArray(governedEvidence?.market_icp).length > 0 ? 'direct_snippet' : 'no_evidence')
          : (displayFactsEvidenceFor('market_icp')?.evidence_basis ?? undefined),
      },
      business_model: {
        value: modelPicked.value,
        source: modelPicked.source,
        quality: classifyFactQuality('business_model', dealOverviewSources),
        sources: sourcesForFactField('business_model', dealOverviewSources),
        evidence_ids: governedUiCopyOk ? asEvidenceIdArray(governedEvidence?.business_model) : (displayFactsEvidenceFor('business_model')?.evidence_ids ?? undefined),
        evidence_refs: governedUiCopyOk ? evidence_refs.business_model : undefined,
        evidence_basis: governedUiCopyOk
          ? (asEvidenceIdArray(governedEvidence?.business_model).length > 0 ? 'direct_snippet' : 'no_evidence')
          : (displayFactsEvidenceFor('business_model')?.evidence_basis ?? undefined),
      },
      raise: {
        value: raisePicked.value,
        source: raisePicked.source,
        quality: classifyFactQuality('raise', dealOverviewSources),
        sources: sourcesForFactField('raise', dealOverviewSources),
        evidence_ids: governedUiCopyOk ? asEvidenceIdArray(governedEvidence?.raise_terms ?? governedEvidence?.raise) : (displayFactsEvidenceFor('raise')?.evidence_ids ?? undefined),
        evidence_refs: governedUiCopyOk ? evidence_refs.raise_terms : undefined,
        evidence_basis: governedUiCopyOk
          ? (asEvidenceIdArray(governedEvidence?.raise_terms ?? governedEvidence?.raise).length > 0 ? 'direct_snippet' : 'no_evidence')
          : (displayFactsEvidenceFor('raise')?.evidence_basis ?? undefined),
      },
    },
    traction_signals: tractionPicked.value,
    key_risks_detected: asStringArray(dealOverviewV2 && typeof dealOverviewV2 === 'object' ? (dealOverviewV2 as any).key_risks_detected : null),
    evidence_refs,
    sources: dealOverviewV2 && typeof dealOverviewV2 === 'object' ? ((dealOverviewV2 as any).sources ?? null) : null,
  };
}
