export type DeckType = 'pitch' | 'compliance' | 'rollup' | 'platform' | 'unknown';

type NodeLike = {
  slide_title?: string | null;
  segment_key?: string | null;
};

function norm(s: unknown): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function countHits(text: string, needles: string[]): number {
  let c = 0;
  for (const n of needles) {
    if (!n) continue;
    if (text.includes(n)) c += 1;
  }
  return c;
}

function segKey(s: unknown): string {
  const t = norm(s);
  if (!t) return '';
  // Normalize common variants.
  if (t === 'gtm') return 'go_to_market';
  if (t === 'market_size') return 'market';
  return t;
}

export function detectDeckType(nodes: NodeLike[]): DeckType {
  const xs = Array.isArray(nodes) ? nodes : [];
  if (xs.length === 0) return 'unknown';

  const titles = xs.map((n) => norm(n?.slide_title)).filter(Boolean);
  const allTitles = titles.join(' \n ');

  const segCounts = new Map<string, number>();
  for (const n of xs) {
    const k = segKey(n?.segment_key);
    if (!k) continue;
    segCounts.set(k, (segCounts.get(k) ?? 0) + 1);
  }

  const totalSeg = Array.from(segCounts.values()).reduce((a, b) => a + b, 0) || 1;
  const share = (k: string): number => (segCounts.get(k) ?? 0) / totalSeg;

  const complianceKeywords = [
    'compliance',
    'regulatory',
    'policy',
    'audit',
    'controls',
    'governance',
    'soc 2',
    'sox',
    'hipaa',
    'gdpr',
    'risk management',
    'risk register',
    'security',
    'privacy',
  ];

  const rollupKeywords = [
    'roll-up',
    'roll up',
    'rollup',
    'acquisition',
    'acquisitions',
    'm&a',
    'consolidation',
    'buy and build',
    'portfolio',
    'holdco',
    'hold co',
    'platform acquisition',
  ];

  const platformKeywords = ['platform', 'ecosystem', 'network', 'marketplace', 'operating system'];

  const pitchKeywords = ['problem', 'solution', 'product', 'market', 'traction', 'go-to-market', 'go to market', 'team', 'raise'];

  const complianceScore =
    countHits(allTitles, complianceKeywords) * 4 +
    Math.round((share('operations') + share('legal') + share('risks')) * 100) +
    Math.round(share('market') * 10);

  const rollupScore =
    countHits(allTitles, rollupKeywords) * 4 +
    Math.round((share('financials') + share('operations')) * 60) +
    Math.round(share('product') * 10);

  const platformScore =
    countHits(allTitles, platformKeywords) * 4 +
    Math.round((share('product') + share('go_to_market')) * 60) +
    Math.round(share('market') * 15);

  const pitchScore =
    countHits(allTitles, pitchKeywords) * 2 +
    Math.round((share('product') + share('market') + share('traction') + share('go_to_market')) * 80);

  const scored: Array<{ t: DeckType; score: number; tie: number }> = [
    { t: 'compliance', score: complianceScore, tie: 4 },
    { t: 'rollup', score: rollupScore, tie: 3 },
    { t: 'platform', score: platformScore, tie: 2 },
    { t: 'pitch', score: pitchScore, tie: 1 },
  ];

  scored.sort((a, b) => b.score - a.score || b.tie - a.tie);
  const best = scored[0];

  // Require some minimum signal so we don't over-classify sparse node sets.
  if (!best || best.score < 12) return 'unknown';

  // If the winner barely beats the runner-up, treat as unknown.
  const runner = scored[1];
  if (runner && best.score - runner.score <= 2) return 'unknown';

  return best.t;
}
