import type { DocumentAnalysis } from "./processors";

function uniqBy<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = keyFn(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

function normalizeSpace(s: string): string {
  return (s || "").replace(/\s+/g, " ").trim();
}

function isMostlyNoise(text: string): boolean {
  const t = normalizeSpace(text);
  if (!t) return true;
  if (t.length < 2) return true;

  // High ratio of non-standard characters is often OCR debris.
  const weird = (t.match(/[^a-zA-Z0-9\s\.,\-:;\/'"()\[\]%$]/g) || []).length;
  if (weird / Math.max(1, t.length) > 0.2) return true;

  // Too dense (no spaces) tends to be junk.
  if (t.length >= 25 && !t.includes(" ")) return true;

  // A lot of ALLCAPS runs is often broken OCR.
  const capsRuns = (t.match(/[A-Z]{4,}/g) || []).length;
  if (capsRuns >= 3) return true;

  return false;
}

function scoreContext(ctx: string): number {
  const c = normalizeSpace(ctx);
  if (!c) return 1e9;

  const len = c.length;
  const weird = (c.match(/[^a-zA-Z0-9\s\.,\-:;\/'"()\[\]%$]/g) || []).length;
  const capsRuns = (c.match(/[A-Z]{4,}/g) || []).length;

  // Lower is better.
  return len + weird * 10 + capsRuns * 15;
}

function isNumericLike(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "string") return false;
  const v = value.trim();
  if (!v) return false;
  return /^[-+]?\$?\d{1,3}(?:,\d{3})*(?:\.\d+)?%?$/.test(v);
}

export type RemediationResult = {
  structuredData: DocumentAnalysis["structuredData"];
  changes: {
    headings_removed: number;
    metrics_removed: number;
    metrics_deduped: number;
    summary_rebuilt: boolean;
  };
};

export function remediateStructuredData(params: {
  structuredData: DocumentAnalysis["structuredData"];
  fullText?: string | null;
}): RemediationResult {
  const structuredData = params.structuredData ?? {
    keyMetrics: [],
    mainHeadings: [],
    textSummary: "",
    entities: [],
  };

  const originalHeadings = structuredData.mainHeadings ?? [];
  const cleanedHeadings = uniqBy(
    originalHeadings
      .map(normalizeSpace)
      .filter((h) => h.length >= 3)
      .filter((h) => !isMostlyNoise(h)),
    (h) => h.toLowerCase()
  );

  const originalKeyMetrics = structuredData.keyMetrics ?? [];
  const metricCandidates = originalKeyMetrics
    .filter((m) => m && typeof m === "object")
    .map((m) => m as { key?: string; value?: unknown; source?: string });

  // First: drop obviously broken numeric metrics.
  const filtered = metricCandidates.filter((m) => {
    const source = normalizeSpace(m.source ?? "");
    if (source && isMostlyNoise(source)) return false;

    if ((m.key ?? "") === "numeric_value") {
      return isNumericLike(m.value);
    }

    // For non-numeric metrics (e.g. excel min/max objects), keep.
    return m.value != null;
  });

  // Second: dedupe numeric_value by value, keep best context.
  const bestByValue = new Map<string, { key: string; value: unknown; source: string }>();
  let metricsDeduped = 0;

  for (const m of filtered) {
    const key = (m.key ?? "").toString();
    const source = normalizeSpace((m.source ?? "").toString());

    if (key !== "numeric_value") continue;

    const valueStr = typeof m.value === "string" ? m.value.trim() : String(m.value);
    const valueKey = valueStr.toLowerCase();

    const existing = bestByValue.get(valueKey);
    if (!existing) {
      bestByValue.set(valueKey, { key, value: m.value, source });
      continue;
    }

    metricsDeduped += 1;
    if (scoreContext(source) < scoreContext(existing.source)) {
      bestByValue.set(valueKey, { key, value: m.value, source });
    }
  }

  const nonNumeric = filtered.filter((m) => (m.key ?? "") !== "numeric_value");
  const numericDeduped = Array.from(bestByValue.values());

  const rebuiltSummary = (() => {
    const s = normalizeSpace(structuredData.textSummary ?? "");
    if (s.length >= 60 && !isMostlyNoise(s)) return { text: s, rebuilt: false };

    const ft = normalizeSpace(params.fullText ?? "");
    if (ft.length < 60) return { text: s, rebuilt: false };

    return { text: ft.slice(0, 500), rebuilt: true };
  })();

  const next: DocumentAnalysis["structuredData"] = {
    ...structuredData,
    mainHeadings: cleanedHeadings,
    keyMetrics: [...nonNumeric, ...numericDeduped].map((m) => ({
      key: (m.key ?? "").toString(),
      value: m.value,
      source: normalizeSpace((m.source ?? "").toString()),
    })),
    textSummary: rebuiltSummary.text,
  };

  return {
    structuredData: next,
    changes: {
      headings_removed: originalHeadings.length - cleanedHeadings.length,
      metrics_removed: originalKeyMetrics.length - (nonNumeric.length + numericDeduped.length + metricsDeduped),
      metrics_deduped: metricsDeduped,
      summary_rebuilt: rebuiltSummary.rebuilt,
    },
  };
}
