import type { PolicyFamily } from './policyUtils';

export type RealEstateSemanticKind = 'asset_facility' | 'submarket_demand' | 'deal_structure';

export type RealEstateSemanticCandidate = {
  value: string | null | undefined;
  source: string;
  lane: 'governed' | 'deterministic' | 'fallback';
};

export type RealEstateSemanticSelection = {
  value: string | null;
  source: string | null;
  lane: 'governed' | 'deterministic' | 'fallback' | 'missing';
  score: number | null;
  rejected: Array<{ source: string; reason: string }>;
};

const STARTUP_LEAK_RE = /\b(arr|mrr|cac|ltv\/cac|payback|burn|runway|customer\s+acquisition|users?\s+growth|d2c|dtc|omnichannel|saas)\b/i;
const GENERIC_BULLET_RE = /\b(protection against final costs|strong management team|scalable platform|large market opportunity|first mover advantage|innovative approach|experienced team)\b/i;
const OPERATOR_MODEL_RE = /\b(patient care|clinical care|therapy model|care pathway|operator model|clinical outcomes?)\b/i;
const DEAL_STRUCTURE_SIGNAL_RE = /\b(preferred\s+equity|capital\s+stack|ltc|construction\s+loan|sponsor\s+equity|lease|nnn|escalation|guarant|hold\s+period|exit\s+cap|investment\s+structure|development\s+investment|debt\s+terms?)\b/i;

const ASSET_SIGNAL_RE = /\b(facility|hospital|irf|inpatient|rehabilitation|build[-\s]?to[-\s]?suit|single[-\s]?tenant|institutional[-\s]?quality|healthcare\s+facility|new\s+build)\b/i;
const SUBMARKET_SIGNAL_RE = /\b(submarket|referral|hospital|medical\s+corridor|competition|under[-\s]?supply|aging\s+population|demand|occupancy|catchment|location)\b/i;
const SUBMARKET_PRIORITY_RE = /\b(albuquerque|hospital|referral|market|demand|competition|corridor|proximity|population|acute\s*care|limited\s+freestanding\s+irf\s+competition)\b/i;
const LEASE_OPERATOR_HEAVY_RE = /\b(lease|nnn|escalation|rent|construction|timeline|operator|management|capital\s+stack|ltc|sponsor\s+equity|debt)\b/i;

const isNonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.trim() !== '—';

const wordCount = (value: string): number => value.trim().split(/\s+/).filter(Boolean).length;

const normalizeForComparison = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function laneBonus(lane: RealEstateSemanticCandidate['lane']): number {
  if (lane === 'governed') return 8;
  if (lane === 'deterministic') return 5;
  return 1;
}

function lanePriority(lane: RealEstateSemanticCandidate['lane']): number {
  if (lane === 'governed') return 3;
  if (lane === 'deterministic') return 2;
  return 1;
}

function semanticSignalScore(kind: RealEstateSemanticKind, text: string): number {
  if (kind === 'asset_facility') return ASSET_SIGNAL_RE.test(text) ? 20 : 0;
  if (kind === 'submarket_demand') {
    let score = SUBMARKET_SIGNAL_RE.test(text) ? 20 : 0;
    if (SUBMARKET_PRIORITY_RE.test(text)) score += 12;
    return score;
  }
  // deal_structure
  return DEAL_STRUCTURE_SIGNAL_RE.test(text) ? 24 : 0;
}

function scoreCandidate(kind: RealEstateSemanticKind, candidate: RealEstateSemanticCandidate): { score: number; rejectReason: string | null } {
  const value = String(candidate.value ?? '').trim();
  if (!value) return { score: -999, rejectReason: 'empty' };

  const hasSubmarketSignal = SUBMARKET_SIGNAL_RE.test(value);
  const isLeaseHeavy = LEASE_OPERATOR_HEAVY_RE.test(value);

  let score = laneBonus(candidate.lane);
  const words = wordCount(value);

  if (words >= 5) score += 6;
  if (words >= 8) score += 4;
  if (words <= 3) score -= 8;

  score += semanticSignalScore(kind, value);

  if (STARTUP_LEAK_RE.test(value)) score -= 18;
  if (GENERIC_BULLET_RE.test(value)) score -= 22;

  if (kind === 'deal_structure' && OPERATOR_MODEL_RE.test(value) && !DEAL_STRUCTURE_SIGNAL_RE.test(value)) {
    score -= 26;
  }

  if (kind !== 'deal_structure' && DEAL_STRUCTURE_SIGNAL_RE.test(value)) {
    // Cross-kind mismatch penalty.
    score -= 4;
  }

  if (kind === 'submarket_demand' && isLeaseHeavy && !hasSubmarketSignal) {
    score -= 30;
    if (score < 16) {
      return { score, rejectReason: 'lease_heavy_mismatch' };
    }
  }

  if (kind === 'submarket_demand' && !hasSubmarketSignal) {
    score -= 8;
  }

  const minScore = kind === 'submarket_demand' ? 16 : 12;

  if (score < minScore) {
    return { score, rejectReason: 'weak_semantic_match' };
  }

  return { score, rejectReason: null };
}

export function selectBestRealEstateSemanticField(
  kind: RealEstateSemanticKind,
  candidates: RealEstateSemanticCandidate[],
  options?: { excludeValues?: string[] },
): RealEstateSemanticSelection {
  const rejected: Array<{ source: string; reason: string }> = [];
  const excluded = new Set(
    (options?.excludeValues ?? [])
      .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      .map((x) => normalizeForComparison(x)),
  );

  const scored = candidates
    .filter((c) => isNonEmpty(c.value))
    .map((c, index) => {
      const normalized = normalizeForComparison(String(c.value ?? ''));
      if (normalized && excluded.has(normalized)) {
        rejected.push({ source: c.source, reason: 'duplicate_value' });
        return { c, index, score: -999, rejectReason: 'duplicate_value' as string | null };
      }
      const scoredCandidate = scoreCandidate(kind, c);
      if (scoredCandidate.rejectReason) {
        rejected.push({ source: c.source, reason: scoredCandidate.rejectReason });
      }
      return { c, index, ...scoredCandidate };
    })
    .filter((x) => x.rejectReason == null)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const laneDelta = lanePriority(b.c.lane) - lanePriority(a.c.lane);
      if (laneDelta !== 0) return laneDelta;
      return a.index - b.index;
    });

  if (scored.length === 0) {
    return {
      value: null,
      source: null,
      lane: 'missing',
      score: null,
      rejected,
    };
  }

  const winner = scored[0];
  return {
    value: String(winner.c.value).trim(),
    source: winner.c.source,
    lane: winner.c.lane,
    score: winner.score,
    rejected,
  };
}

export type PolicyAwareAdvisoryRefinement = {
  asks: string[];
  suppressedStartupAsks: string[];
  injectedRealEstateAsks: string[];
  replacementApplied: boolean;
  source: 'original' | 'real_estate_refined';
};

const REAL_ESTATE_PREFERRED_ASKS = [
  'Confirm year-1 NOI and rent commencement assumptions.',
  'Confirm lease term, escalations, and guaranty details.',
  'Confirm construction budget, contingency, and development timing.',
  'Confirm LTC, DSCR, and debt term assumptions.',
  'Confirm sponsor equity contribution and preferred equity terms.',
  'Confirm exit cap sensitivity and hold period assumptions.',
  'Confirm tenant/operator credit quality and referral support.',
  'Confirm occupancy and pre-lease / commencement risk assumptions.',
  'Confirm underwriting assumptions against market comps.',
];

export function applyPolicyAwareAdvisoryAsks(params: {
  policyFamily: PolicyFamily;
  asks: string[];
}): PolicyAwareAdvisoryRefinement {
  const base = params.asks.filter((x) => typeof x === 'string').map((x) => x.trim()).filter((x) => x.length > 0);
  if (params.policyFamily !== 'real_estate') {
    return {
      asks: base,
      suppressedStartupAsks: [],
      injectedRealEstateAsks: [],
      replacementApplied: false,
      source: 'original',
    };
  }

  const suppressedStartupAsks: string[] = [];
  const retained = base.filter((ask) => {
    if (STARTUP_LEAK_RE.test(ask)) {
      suppressedStartupAsks.push(ask);
      return false;
    }
    return true;
  });

  const retainedText = retained.join(' | ').toLowerCase();
  const injectedRealEstateAsks = REAL_ESTATE_PREFERRED_ASKS.filter((ask) => {
    const probe = ask.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((t) => t.length >= 5);
    return !probe.some((token) => retainedText.includes(token));
  });

  const asks = [...retained, ...injectedRealEstateAsks].slice(0, 12);
  return {
    asks,
    suppressedStartupAsks,
    injectedRealEstateAsks,
    replacementApplied: suppressedStartupAsks.length > 0 || injectedRealEstateAsks.length > 0,
    source: 'real_estate_refined',
  };
}

export function getRealEstateDealStructureFallback(sourceText: string | null | undefined): string {
  const s = String(sourceText ?? '').toLowerCase();
  if (s.includes('preferred equity') || s.includes('preferred_equity')) {
    return 'Preferred equity development investment';
  }
  return 'Real estate structured investment';
}
