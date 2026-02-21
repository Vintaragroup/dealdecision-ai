export type AuthoritativeRunwaySelectionV1 = {
  value: {
    months: number;
    display: string;
    sources?: any[];
  } | null;
  source: 'report.structured_summary.kpis.runway' | 'missing';
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

const asFiniteNumber = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
};

const parseMonths = (raw: string): number | null => {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const m = s.match(/\b(\d{1,3})\b/);
  if (!m?.[1]) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  if (n <= 0) return null;
  return Math.round(n);
};

export function selectAuthoritativeRunwayV1(reportOrEnvelope?: unknown | null): AuthoritativeRunwaySelectionV1 {
  const report = unwrapEnvelope(reportOrEnvelope);

  if (!reportLooksReady(report)) {
    return { value: null, source: 'missing' };
  }

  const structured = (report as any)?.structured_summary;
  const kpis = structured && typeof structured === 'object' ? (structured as any).kpis : null;

  const runway = kpis?.runway_months ?? kpis?.runway ?? kpis?.capital_profile?.runway_months ?? null;
  if (!runway || typeof runway !== 'object') {
    return { value: null, source: 'missing' };
  }

  const numeric =
    asFiniteNumber((runway as any)?.value?.months) ??
    asFiniteNumber((runway as any)?.value?.count) ??
    asFiniteNumber((runway as any)?.value?.number) ??
    asFiniteNumber((runway as any)?.value) ??
    asFiniteNumber((runway as any)?.runway_months);

  const fromRaw = (() => {
    const raw = typeof (runway as any)?.value?.raw === 'string' ? (runway as any).value.raw : (typeof (runway as any)?.value === 'string' ? (runway as any).value : null);
    if (!raw) return null;
    return parseMonths(raw);
  })();

  const months = numeric ?? fromRaw;
  if (months == null) {
    return { value: null, source: 'report.structured_summary.kpis.runway' };
  }

  const display = `${Math.round(months)} mo`;
  const sources = Array.isArray((runway as any)?.sources) ? ((runway as any).sources as any[]) : undefined;
  return {
    value: { months: Math.round(months), display, sources },
    source: 'report.structured_summary.kpis.runway',
  };
}
