const CRITICAL_FIELD_LABELS: Record<string, string> = {
  raise: 'fundraising terms',
  business_model: 'business model',
  revenue: 'revenue',
  customers: 'customer count',
  growth: 'growth metrics',
  raise_cap: 'SAFE valuation cap',
  raise_discount: 'discount rate',
  valuation_post: 'post-money valuation',
};

const CONTRADICTION_LABELS: Record<string, string> = {
  numeric_divergence: 'conflicting numeric claims across source materials',
  semantic_divergence: 'conflicting descriptions across source materials',
  source_divergence: 'source coverage mismatch across materials',
  missing_critical: 'critical supporting information is missing',
};

type RewriteReplacement = string | ((...args: any[]) => string);

const MACHINE_PHRASE_REWRITES: Array<[RegExp, RewriteReplacement]> = [
  [/No explicit TAM KPI evidence found\.?/gi, 'The materials do not provide a clearly supported TAM estimate.'],
  [/Growth metric is missing from structured summary\.?/gi, 'The current materials do not provide a clearly supported growth metric.'],
  [/Customer metric is missing from structured summary\.?/gi, 'The current materials do not provide a clearly supported customer metric.'],
  [/Growth metric is present in structured summary\.?/gi, 'A growth metric is present in the current materials.'],
  [/Customer metric is present in structured summary\.?/gi, 'A customer metric is present in the current materials.'],
  [/Differentiation claims are present in product profile\.?/gi, 'The company presents a differentiation claim, but durability still needs stronger support.'],
  [/Differentiation claims are sparse or absent\.?/gi, 'Differentiation is not yet clearly supported in the current materials.'],
  [/No explicit defensibility note present\.?/gi, 'The current materials do not clearly establish long-term defensibility.'],
  [/AI defensibility evidence is limited\.?/gi, 'Evidence for AI defensibility is currently limited.'],
  [/Projected periods are limited or missing\.?/gi, 'Forward projections are currently limited or missing.'],
  [/Market timing assumptions are partially specified\.?/gi, 'Market timing assumptions are only partially supported.'],
  [/proof_signals\s*=\s*\d+/gi, 'limited hard proof points available'],
  [/promise_signals\s*=\s*\d+/gi, 'open assumptions still require verification'],
  [/Missing critical field:\s*([a-z_]+)/gi, (_m: string, key: string) => `Missing critical input: ${humanizeCriticalFieldName(key)}.`],
];

const moneyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});

const compactFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 2,
});

const cleanSpaces = (value: string): string => value.replace(/\s+/g, ' ').trim();

export function humanizeCriticalFieldName(value: string): string {
  const key = String(value || '').trim().toLowerCase();
  if (!key) return 'supporting input';
  if (CRITICAL_FIELD_LABELS[key]) return CRITICAL_FIELD_LABELS[key];
  return key.replace(/_/g, ' ');
}

export function humanizeContradictionType(value: string): string {
  const key = String(value || '').trim().toLowerCase();
  if (!key) return 'conflicting claims require verification';
  return CONTRADICTION_LABELS[key] ?? key.replace(/_/g, ' ');
}

export function humanizeEvidenceRef(ref: string): string {
  const raw = cleanSpaces(String(ref || ''));
  if (!raw) return 'Source material';

  const dpuPage = raw.match(/:page:(\d+)$/i);
  if (dpuPage) {
    return `Source material, page ${dpuPage[1]}`;
  }

  const pageOnly = raw.match(/\bpage[:\s-]?(\d+)\b/i);
  if (pageOnly) {
    return `Source material, page ${pageOnly[1]}`;
  }

  if (/pitch|deck/i.test(raw)) return 'Pitch deck';
  if (/investor|insight|orchestrator/i.test(raw)) return 'Investor report';
  if (/financial|xlsx|model|spreadsheet/i.test(raw)) return 'Financial package';

  return 'Source material';
}

export function humanizeEvidenceRefs(refs: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const label = humanizeEvidenceRef(ref);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out;
}

function normalizeMalformedMoney(value: string): string {
  const malformed = value.replace(/\$\s*([\d,]+(?:\.\d+)?)\s*([KMB])\b/gi, (_m, nRaw: string, suffix: string) => {
    const n = Number(String(nRaw).replace(/,/g, ''));
    if (!Number.isFinite(n)) return _m;

    // If magnitude suffix is present but base number is very large, treat suffix as likely spurious.
    if (n >= 1000) {
      return `$${compactFormatter.format(n)}`;
    }

    const s = String(suffix || '').toUpperCase();
    if (s === 'K') return moneyFormatter.format(n * 1_000).replace('.00', '');
    if (s === 'M') return moneyFormatter.format(n * 1_000_000).replace('.00', '');
    if (s === 'B') return moneyFormatter.format(n * 1_000_000_000).replace('.00', '');
    return _m;
  });

  return malformed.replace(/\$\$+/g, '$');
}

function normalizePercent(value: string): string {
  return value.replace(/\b(\d+(?:\.\d+)?)%\b/g, (_m, nRaw: string) => {
    const n = Number(nRaw);
    if (!Number.isFinite(n)) return _m;
    if (Number.isInteger(n)) return `${n}%`;
    return `${Number(n.toFixed(2))}%`;
  });
}

export function normalizeDeepDiveText(raw: string): string {
  let out = cleanSpaces(String(raw || ''));
  if (!out) return out;

  for (const [pattern, replacement] of MACHINE_PHRASE_REWRITES) {
    out = out.replace(pattern, replacement as any);
  }

  out = out.replace(/\bmissing_inputs\b/gi, 'missing supporting inputs');
  out = out.replace(/\braise_cap\b/gi, 'SAFE valuation cap');
  out = out.replace(/\braise_discount\b/gi, 'discount rate');
  out = out.replace(/\bvaluation_post\b/gi, 'post-money valuation');
  out = out.replace(/\bvaluation_pre\b/gi, 'pre-money valuation');

  out = normalizeMalformedMoney(out);
  out = normalizePercent(out);

  return cleanSpaces(out);
}

export function humanizeActionTitle(title: string): string {
  const raw = normalizeDeepDiveText(title);
  const backfill = raw.match(/^Backfill\s+([a-z_]+)\s+with evidence-backed data$/i);
  if (backfill) {
    return `Provide evidence-backed ${humanizeCriticalFieldName(backfill[1])}.`;
  }
  return raw;
}

export function humanizeActionRationale(rationale: string): string {
  return normalizeDeepDiveText(rationale)
    .replace(/\bunderwriting_readiness_v1\b/gi, 'underwriting readiness analysis')
    .replace(/\bdeterministic\b/gi, 'current evidence-based');
}
