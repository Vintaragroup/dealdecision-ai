export type CapitalLogicProfileV1 = {
  confidence: "low" | "medium" | "high";
  raise: {
    present: boolean;
    amount?: number;
    sources?: Array<{ document_id?: string; page_index?: number; page?: number; source_path?: string }>;
  };
  use_of_funds: {
    present: boolean;
    sources?: Array<{ document_id?: string; page_index?: number; page?: number; source_path?: string }>;
  };
  milestones: {
    present: boolean;
    sources?: Array<{ document_id?: string; page_index?: number; page?: number; source_path?: string }>;
  };
  coherence: {
    has_raise_and_use_of_funds: boolean;
    has_raise_and_milestones: boolean;
    has_use_of_funds_and_milestones: boolean;
    appears_coherent: boolean; // strict: true only if all 3 are true
  };
  notes?: string[];
};

type EvidenceRefLike = { document_id?: string; page_index?: number; page?: number; source_path?: string };

const asNonEmptyString = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null;

const toEvidenceRefFromSource = (s: any): EvidenceRefLike => ({
  document_id: asNonEmptyString(s?.source_document_id ?? s?.document_id ?? s?.documentId ?? null) ?? undefined,
  page_index: typeof s?.page_index === 'number' ? s.page_index : typeof s?.pageIndex === 'number' ? s.pageIndex : undefined,
  page: typeof s?.page === 'number' ? s.page : undefined,
  source_path: asNonEmptyString(s?.source_path ?? s?.sourcePath ?? null) ?? undefined,
});

const extractSourcesArray = (sources: unknown): EvidenceRefLike[] | undefined => {
  if (!Array.isArray(sources)) return undefined;
  const out = sources.map((s) => toEvidenceRefFromSource(s)).filter((r) => r.document_id || r.page_index != null || r.page != null || r.source_path);
  return out.length > 0 ? out : undefined;
};

const evidenceFromPromotedFact = (pf: any): EvidenceRefLike[] | undefined => {
  if (!pf || typeof pf !== 'object') return undefined;
  const cj = pf.content_json && typeof pf.content_json === 'object' ? pf.content_json : null;
  const prov = cj && typeof (cj as any).provenance === 'object' ? (cj as any).provenance : null;
  const ref: EvidenceRefLike = {
    document_id: asNonEmptyString(prov?.source_document_id ?? pf.source_document_id ?? pf?.meta?.document_id ?? null) ?? undefined,
    page_index: typeof prov?.page_index === 'number' ? prov.page_index : (typeof pf?.meta?.page_index === 'number' ? pf.meta.page_index : undefined),
    page: typeof prov?.page === 'number' ? prov.page : undefined,
    source_path: asNonEmptyString(prov?.source_path ?? pf.source_path ?? null) ?? undefined,
  };
  if (ref.document_id || ref.page_index != null || ref.page != null || ref.source_path) return [ref];
  return undefined;
};

const promotedFactTypeOf = (pf: any): string => {
  const root = asNonEmptyString(pf?.fact_type);
  if (root) return root;
  const nested = asNonEmptyString(pf?.content_json?.fact_type);
  return nested ?? '';
};

const isUseOfFundsFactType = (ft: string): boolean => {
  const s = ft.toLowerCase();
  return /use[_\s-]?of[_\s-]?(funds|proceeds)/.test(s) || s.includes('use_of_funds') || s.includes('use_of_proceeds');
};

const isMilestonesFactType = (ft: string): boolean => {
  const s = ft.toLowerCase();
  if (s.includes('milestone')) return true;
  if (s.includes('milestones')) return true;
  if (s.includes('timeline')) return true;
  if (s.includes('roadmap')) return true;
  return false;
};

export function inferCapitalLogicProfileV1(input: {
  structured_summary: any;
  promoted_facts?: any[] | null;
}): CapitalLogicProfileV1 {
  const structured = input.structured_summary ?? null;
  const promoted = Array.isArray(input.promoted_facts) ? input.promoted_facts : [];

  // A) raise.present (strict)
  const raiseAmount = structured?.raise?.value_json?.amount?.amount;
  const raiseAmountNum = typeof raiseAmount === 'number' && Number.isFinite(raiseAmount) ? raiseAmount : undefined;
  const raiseSources = extractSourcesArray(structured?.raise?.sources);
  const raisePresent = raiseAmountNum != null;

  // B) use_of_funds.present
  const ssUseOfFundsSources = extractSourcesArray(structured?.use_of_funds?.sources ?? structured?.useOfFunds?.sources);
  const ssUseOfFundsPresent = !!(structured?.use_of_funds || structured?.useOfFunds);
  const pfUseOfFunds = promoted.find((pf) => isUseOfFundsFactType(promotedFactTypeOf(pf))) ?? null;
  const useOfFundsPresent = ssUseOfFundsPresent || !!pfUseOfFunds;
  const useOfFundsSources = ssUseOfFundsSources ?? (pfUseOfFunds ? evidenceFromPromotedFact(pfUseOfFunds) : undefined);

  // C) milestones.present
  const ssMilestoneSources = extractSourcesArray(structured?.milestones?.sources ?? structured?.milestone?.sources ?? structured?.unlock?.sources);
  const ssMilestonesPresent = !!(structured?.milestones || structured?.milestone || structured?.unlock);
  const pfMilestones = promoted.find((pf) => isMilestonesFactType(promotedFactTypeOf(pf))) ?? null;
  const milestonesPresent = ssMilestonesPresent || !!pfMilestones;
  const milestonesSources = ssMilestoneSources ?? (pfMilestones ? evidenceFromPromotedFact(pfMilestones) : undefined);

  // D) coherence
  const has_raise_and_use_of_funds = raisePresent && useOfFundsPresent;
  const has_raise_and_milestones = raisePresent && milestonesPresent;
  const has_use_of_funds_and_milestones = useOfFundsPresent && milestonesPresent;
  const appears_coherent = has_raise_and_use_of_funds && has_raise_and_milestones && has_use_of_funds_and_milestones;

  // E) confidence
  const confidence: CapitalLogicProfileV1['confidence'] = appears_coherent
    ? 'high'
    : (raisePresent && (useOfFundsPresent || milestonesPresent))
      ? 'medium'
      : 'low';

  const notes: string[] = [];
  if (!raisePresent) notes.push('raise_amount_missing');
  if (notes.length === 0) {
    return {
      confidence,
      raise: { present: raisePresent, amount: raiseAmountNum, sources: raiseSources },
      use_of_funds: { present: useOfFundsPresent, sources: useOfFundsSources },
      milestones: { present: milestonesPresent, sources: milestonesSources },
      coherence: {
        has_raise_and_use_of_funds,
        has_raise_and_milestones,
        has_use_of_funds_and_milestones,
        appears_coherent,
      },
    };
  }

  return {
    confidence,
    raise: { present: raisePresent, amount: raiseAmountNum, sources: raiseSources },
    use_of_funds: { present: useOfFundsPresent, sources: useOfFundsSources },
    milestones: { present: milestonesPresent, sources: milestonesSources },
    coherence: {
      has_raise_and_use_of_funds,
      has_raise_and_milestones,
      has_use_of_funds_and_milestones,
      appears_coherent,
    },
    notes,
  };
}
