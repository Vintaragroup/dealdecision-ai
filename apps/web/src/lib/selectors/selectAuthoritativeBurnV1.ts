export type AuthoritativeBurnSelectionV1 = {
  value: {
    monthly_usd: number;
    display: string;
    sources?: any[];
  } | null;
  source: 'report.structured_summary.kpis.burn_rate' | 'missing';
};

function reportLooksReady(report: unknown): boolean {
  if (!report || typeof report !== 'object') return false;
  const r: any = report as any;
  const structured = r?.structured_summary;
  const readyFlag = typeof r?.ready === 'boolean' ? (r.ready as boolean) : null;
  if (readyFlag === false) return false;
  if (readyFlag === true) return true;
  return Boolean(structured && typeof structured === 'object');
}

function unwrapEnvelope(reportOrEnvelope: unknown): any {
  const r: any = reportOrEnvelope as any;
  return r?.report && typeof r.report === 'object' ? (r.report as any) : r;
}

const parseMoney = (raw: string): number | null => {
  const s = String(raw ?? '').trim();
  if (!s) return null;

  // Match $100k, $100K/mo, 100k, 100,000 etc.
  const m = s.match(/\$?\s*([\d,.]+)\s*([kKmMbB])?/);
  if (!m?.[1]) return null;
  const base = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(base)) return null;
  const mult = (() => {
    const suf = (m[2] ?? '').toLowerCase();
    if (suf === 'k') return 1e3;
    if (suf === 'm') return 1e6;
    if (suf === 'b') return 1e9;
    return 1;
  })();
  return base * mult;
};

const formatMoneyCompact = (amount: number): string => {
  const v = typeof amount === 'number' && Number.isFinite(amount) ? amount : NaN;
  if (!Number.isFinite(v)) return '—';
  if (v >= 1e9) {
    const x = v / 1e9;
    const s = Number.isInteger(x) ? x.toFixed(0) : x.toFixed(x >= 10 ? 0 : 1);
    return `$${s}B`;
  }
  if (v >= 1e6) {
    const x = v / 1e6;
    const s = Number.isInteger(x) ? x.toFixed(0) : x.toFixed(x >= 10 ? 0 : 1);
    return `$${s}M`;
  }
  if (v >= 1e3) {
    const x = v / 1e3;
    const s = Number.isInteger(x) ? x.toFixed(0) : x.toFixed(x >= 10 ? 0 : 1);
    return `$${s}K`;
  }
  return `$${Math.round(v).toLocaleString()}`;
};

const asFiniteNumber = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
};

export function selectAuthoritativeBurnV1(reportOrEnvelope?: unknown | null): AuthoritativeBurnSelectionV1 {
  const report = unwrapEnvelope(reportOrEnvelope);

  if (!reportLooksReady(report)) {
    return { value: null, source: 'missing' };
  }

  const structured = (report as any)?.structured_summary;
  const kpis = structured && typeof structured === 'object' ? (structured as any).kpis : null;

  const burn = kpis?.burn_rate ?? kpis?.monthly_burn_rate ?? kpis?.burn ?? null;
  if (!burn || typeof burn !== 'object') {
    return { value: null, source: 'missing' };
  }

  const numeric =
    asFiniteNumber((burn as any)?.value?.monthly_usd) ??
    asFiniteNumber((burn as any)?.value?.amount) ??
    asFiniteNumber((burn as any)?.value_json?.amount?.amount) ??
    asFiniteNumber((burn as any)?.value?.amount?.amount) ??
    asFiniteNumber((burn as any)?.value?.number) ??
    asFiniteNumber((burn as any)?.value);

  const fromRaw = (() => {
    const raw = typeof (burn as any)?.value?.raw === 'string' ? (burn as any).value.raw : (typeof (burn as any)?.value === 'string' ? (burn as any).value : null);
    if (!raw) return null;
    return parseMoney(raw);
  })();

  const monthly_usd = numeric ?? fromRaw;
  if (monthly_usd == null) {
    return { value: null, source: 'report.structured_summary.kpis.burn_rate' };
  }

  const display = `${formatMoneyCompact(monthly_usd)}/mo`;
  const sources = Array.isArray((burn as any)?.sources) ? ((burn as any).sources as any[]) : undefined;
  return {
    value: { monthly_usd, display, sources },
    source: 'report.structured_summary.kpis.burn_rate',
  };
}
