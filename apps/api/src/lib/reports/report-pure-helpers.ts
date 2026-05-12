/**
 * report-pure-helpers.ts
 *
 * Pure helper functions extracted from apps/api/src/routes/reports.ts.
 * All functions here are side-effect-free (no DB, no LLM, no env, no mutable module state).
 * Imported back into reports.ts and re-exported where necessary.
 */

import { LlmOverviewV1Schema, LlmOverviewV1CitationSchema } from '@dealdecision/core';

// ─── Primitive utilities ───────────────────────────────────────────────────────

export const asFiniteInt = (v: unknown): number | null => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : null;
  if (n == null) return null;
  const i = Math.trunc(n);
  return Number.isFinite(i) ? i : null;
};

// ─── Overview schema caps ──────────────────────────────────────────────────────

export const OVERVIEW_SCHEMA_MAX = {
  hero_header_chars: 900,
  deal_summary_hero_chars: 400,
  deal_summary_mid_chars: 1400,
  deal_summary_long_chars: 3600,
  investment_overview_chars: 2400,
  bullet_chars: 320,
  strengths_bullets: 6,
  concerns_bullets: 8,
  coverage_gaps_bullets: 12,
  citations: 80,
  quality_flags: 24,
  evidence_id_chars: 96,
  slide_title_chars: 160,
} as const;

// ─── JSON parsing ──────────────────────────────────────────────────────────────

export const parseJsonOnly = (raw: string): unknown => {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) throw new Error('empty_model_output');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('model_output_not_json');
  }
};

// ─── KPI narration normalization ───────────────────────────────────────────────

export const normalizeKpiForNarrationExcerpt = (kpi: any): any => {
  if (!kpi || typeof kpi !== 'object') return kpi;
  const out: any = { ...kpi };

  // Normalize `source` to the shape expected by the guard.
  // Many deterministic extractors store 0-based `page_index`; guard citations use 1-based `page`.
  if (out.source && typeof out.source === 'object') {
    try {
      if ((out.source as any).page == null && typeof (out.source as any).page_index === 'number' && Number.isFinite((out.source as any).page_index)) {
        (out.source as any).page = (out.source as any).page_index + 1;
      }
    } catch {
      // ignore
    }
  }

  if (out.value_raw == null && out.value && typeof out.value === 'object') {
    const raw = (out.value as any).raw;
    if (typeof raw === 'string' && raw.trim()) out.value_raw = raw;
  }

  // Guard expects a single deterministic `source` object (page + optional slide_title).
  if (out.source == null) {
    const sources = Array.isArray(out.sources) ? out.sources : [];
    const best =
      sources.find(
        (s: any) =>
          s &&
          typeof s === 'object' &&
          (typeof (s as any).page === 'number' || typeof (s as any).page_index === 'number')
      ) ?? null;
    if (best) {
      const page =
        typeof (best as any).page === 'number'
          ? (best as any).page
          : (typeof (best as any).page_index === 'number' ? (best as any).page_index + 1 : null);
      if (typeof page === 'number' && Number.isFinite(page)) {
      out.source = {
        page,
        slide_title: typeof (best as any).slide_title === 'string' ? (best as any).slide_title : null,
      };
      }
    }
  }
  return out;
};

export function buildAllowlistedNarrationExcerpt(report: any, opts?: { promoted_facts?: any[] }): any {
  const structured = report?.structured_summary && typeof report.structured_summary === 'object' ? report.structured_summary : null;
  const kpisRaw = structured?.kpis && typeof structured.kpis === 'object' ? structured.kpis : null;

  const kpis = kpisRaw
    ? {
        ...kpisRaw,
        raise: normalizeKpiForNarrationExcerpt((kpisRaw as any).raise),
        revenue: normalizeKpiForNarrationExcerpt((kpisRaw as any).revenue),
        customers: normalizeKpiForNarrationExcerpt((kpisRaw as any).customers),
        growth: normalizeKpiForNarrationExcerpt((kpisRaw as any).growth),
        performance:
          (kpisRaw as any).performance && typeof (kpisRaw as any).performance === 'object'
            ? {
                ...(kpisRaw as any).performance,
                marketing_attributed_revenue_v1: normalizeKpiForNarrationExcerpt(
                  (kpisRaw as any).performance?.marketing_attributed_revenue_v1
                ),
              }
            : undefined,
      }
    : null;

  const citationsSummary = (() => {
    const pages: number[] = [];
    const pushPage = (v: unknown) => {
      const i = asFiniteInt(v);
      if (i == null) return;
      pages.push(i);
    };

    // KPI sources: prefer excerpted kpis.*.source, but fall back to sources[] if present.
    if (kpis && typeof kpis === 'object') {
      const visitKpi = (obj: any) => {
        if (!obj || typeof obj !== 'object') return;
        if (obj.source && typeof obj.source === 'object') {
          pushPage((obj.source as any).page ?? (obj.source as any).page_index);
        }
        const sources = Array.isArray(obj.sources) ? obj.sources : [];
        for (const s of sources) pushPage((s as any)?.page ?? (s as any)?.page_index);
      };
      for (const key of ['raise', 'revenue', 'customers', 'growth']) visitKpi((kpis as any)[key]);
      visitKpi((kpis as any)?.performance?.marketing_attributed_revenue_v1);
    }

    // Deal summary sources (page_index or page).
    const ds = report?.deal_summary;
    const visitLine = (line: any) => {
      const sources = Array.isArray(line?.sources) ? line.sources : [];
      for (const s of sources) pushPage((s as any)?.page ?? (s as any)?.page_index);
    };
    if (ds && typeof ds === 'object') {
      visitLine((ds as any).one_liner);
      visitLine((ds as any).product);
      visitLine((ds as any).market_target);
      visitLine((ds as any).market_context);
      visitLine((ds as any).market);
      const paragraphs = Array.isArray((ds as any).paragraphs) ? (ds as any).paragraphs : [];
      for (const p of paragraphs) visitLine(p);
    }

    const unique = new Set<number>(pages);
    return { total_sources: pages.length, unique_pages: unique.size };
  })();

  const scoreExplanation = report?.metadata?.score_explanation ?? null;
  const understanding = scoreExplanation?.understanding_v1 ?? null;

  // Expand allowlisted grounding surface with deterministic, provenance-linked evidence IDs.
  // This is excerpt-only (overlay use); it must not mutate canonical deterministic report outputs.
  const componentEvidenceIds = (() => {
    const out: Record<string, string[]> = {};
    const comps = scoreExplanation?.components;
    if (!comps || typeof comps !== 'object') return out;
    for (const [k, v] of Object.entries(comps)) {
      if (!v || typeof v !== 'object') continue;
      const ids = Array.isArray((v as any).evidence_ids) ? (v as any).evidence_ids : [];
      const cleaned = ids
        .map((x: any) => (typeof x === 'string' ? x.trim() : ''))
        .filter((x: string) => x.length > 0);
      if (cleaned.length > 0) out[k] = cleaned.slice(0, 80);
    }
    return out;
  })();

  return {
    structured_summary: structured
      ? {
          kpis,
          marketing_metrics: structured?.marketing_metrics ?? null,
        }
      : null,
    deal_summary_v1: report?.deal_summary ?? null,
    // Optional: promoted facts (deterministic; provenance via evidence_id + source_path)
    promoted_facts: Array.isArray(opts?.promoted_facts) ? opts?.promoted_facts : null,
    score_explanation: {
      understanding_v1: understanding,
      component_evidence_ids: componentEvidenceIds,
    },
    citations: citationsSummary,
  };
}

// ─── Overview sanitization ─────────────────────────────────────────────────────

export function sanitizeLlmOverviewV1AfterGuard(overview: any): any {
  if (!overview || typeof overview !== 'object') return overview;

  const clamp = (v: unknown, max: number): unknown => {
    if (typeof v !== 'string') return v;
    const trimmed = v.trim();
    if (trimmed.length <= max) return trimmed;
    return trimmed.slice(0, max).trimEnd();
  };

  const clampBulletArray = (arr: unknown, maxItems: number): unknown => {
    if (!Array.isArray(arr)) return arr;
    return arr
      .slice(0, maxItems)
      .map((v) => clamp(v, OVERVIEW_SCHEMA_MAX.bullet_chars));
  };

  const next: any = { ...overview };

  next.hero_header = clamp(next.hero_header, OVERVIEW_SCHEMA_MAX.hero_header_chars);
  next.investment_analysis_overview = clamp(next.investment_analysis_overview, OVERVIEW_SCHEMA_MAX.investment_overview_chars);

  if (next.deal_summary && typeof next.deal_summary === 'object') {
    next.deal_summary = { ...next.deal_summary };
    next.deal_summary.hero = clamp(next.deal_summary.hero, OVERVIEW_SCHEMA_MAX.deal_summary_hero_chars);
    next.deal_summary.mid = clamp(next.deal_summary.mid, OVERVIEW_SCHEMA_MAX.deal_summary_mid_chars);
    next.deal_summary.long = clamp(next.deal_summary.long, OVERVIEW_SCHEMA_MAX.deal_summary_long_chars);
  }

  next.strengths_overlay = clampBulletArray(next.strengths_overlay, OVERVIEW_SCHEMA_MAX.strengths_bullets);
  next.concerns_overlay = clampBulletArray(next.concerns_overlay, OVERVIEW_SCHEMA_MAX.concerns_bullets);
  next.coverage_gaps_overlay = clampBulletArray(next.coverage_gaps_overlay, OVERVIEW_SCHEMA_MAX.coverage_gaps_bullets);

  if (Array.isArray(next.citations)) {
    next.citations = next.citations.slice(0, OVERVIEW_SCHEMA_MAX.citations).map((c: any) => {
      if (!c || typeof c !== 'object') return c;
      const out: any = { ...c };
      out.slide_title = clamp(out.slide_title, OVERVIEW_SCHEMA_MAX.slide_title_chars);
      out.evidence_id = clamp(out.evidence_id, OVERVIEW_SCHEMA_MAX.evidence_id_chars);
      return out;
    });
  }

  if (Array.isArray(next.quality_flags)) {
    next.quality_flags = next.quality_flags.slice(0, OVERVIEW_SCHEMA_MAX.quality_flags).map((v: any) => clamp(v, 64));
  }

  return next;
}

export const repairInvestmentAnalysisOverviewStructure = (text: string): string => {
  const raw = typeof text === 'string' ? text : '';
  const cleaned = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!cleaned) return cleaned;

  const signalRe = /(^|\n)\s*[•*\-]?\s*Signal\s*:/gim;
  const starts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = signalRe.exec(cleaned)) !== null) {
    const idx = cleaned.indexOf('Signal', m.index);
    starts.push(idx >= 0 ? idx : m.index);
    if (m.index === signalRe.lastIndex) signalRe.lastIndex++;
  }
  const uniqStarts = Array.from(new Set(starts.filter((x) => x >= 0))).sort((a, b) => a - b);
  if (uniqStarts.length === 0) return cleaned;

  const points: string[] = [];
  for (let i = 0; i < uniqStarts.length && points.length < 4; i++) {
    const start = uniqStarts[i];
    const end = i + 1 < uniqStarts.length ? uniqStarts[i + 1] : cleaned.length;
    let chunk = cleaned.slice(start, end).trim();
    if (!chunk) continue;

    const hasImplication = /(^|\n)\s*[•*\-]?\s*Implication\s*:/im.test(chunk);
    const hasUncertainty = /(^|\n)\s*[•*\-]?\s*Uncertainty\s*:/im.test(chunk);
    const hasDecisionTension = /(^|\n)\s*[•*\-]?\s*Decision\s*Tension\s*:/im.test(chunk);
    if (!hasImplication || !hasUncertainty) continue;

    chunk = chunk
      .replace(/(^|\n)\s*[•*\-]?\s*Signal\s*:/gim, '$1• Signal:')
      .replace(/(^|\n)\s*[•*\-]?\s*Implication\s*:/gim, '$1• Implication:')
      .replace(/(^|\n)\s*[•*\-]?\s*Uncertainty\s*:/gim, '$1• Uncertainty:')
      .replace(/(^|\n)\s*[•*\-]?\s*Decision\s*Tension\s*:/gim, '$1• Decision Tension:');

    if (!hasDecisionTension) {
      chunk = `${chunk}\n• Decision Tension: What evidence would most change conviction, and what specific diligence question should be answered next?`;
    }

    points.push(chunk.trim());
  }

  if (points.length >= 2 && points.length <= 4) return points.join('\n\n');
  return cleaned;
};

export function sanitizeOverviewCandidateBeforeGuard(overview: any): any {
  if (!overview || typeof overview !== 'object') return overview;

  const clamp = (v: unknown, max: number): unknown => {
    if (typeof v !== 'string') return v;
    const trimmed = v.trim();
    if (trimmed.length <= max) return trimmed;
    return trimmed.slice(0, max).trimEnd();
  };

  const clampBulletArray = (arr: unknown, maxItems: number): unknown => {
    if (!Array.isArray(arr)) return arr;
    return arr
      .slice(0, maxItems)
      .map((v) => clamp(v, OVERVIEW_SCHEMA_MAX.bullet_chars));
  };

  const next: any = { ...(overview as any) };

  next.hero_header = clamp(next.hero_header, OVERVIEW_SCHEMA_MAX.hero_header_chars);
  if (next.deal_summary && typeof next.deal_summary === 'object') {
    next.deal_summary = { ...next.deal_summary };
    next.deal_summary.hero = clamp(next.deal_summary.hero, OVERVIEW_SCHEMA_MAX.deal_summary_hero_chars);
    next.deal_summary.mid = clamp(next.deal_summary.mid, OVERVIEW_SCHEMA_MAX.deal_summary_mid_chars);
    next.deal_summary.long = clamp(next.deal_summary.long, OVERVIEW_SCHEMA_MAX.deal_summary_long_chars);
  }
  if (typeof next.investment_analysis_overview === 'string') {
    const repaired = repairInvestmentAnalysisOverviewStructure(next.investment_analysis_overview);
    next.investment_analysis_overview = clamp(repaired, OVERVIEW_SCHEMA_MAX.investment_overview_chars);
  } else {
    next.investment_analysis_overview = clamp(next.investment_analysis_overview, OVERVIEW_SCHEMA_MAX.investment_overview_chars);
  }

  next.strengths_overlay = clampBulletArray(next.strengths_overlay, OVERVIEW_SCHEMA_MAX.strengths_bullets);
  next.concerns_overlay = clampBulletArray(next.concerns_overlay, OVERVIEW_SCHEMA_MAX.concerns_bullets);
  next.coverage_gaps_overlay = clampBulletArray(next.coverage_gaps_overlay, OVERVIEW_SCHEMA_MAX.coverage_gaps_bullets);

  if (Array.isArray(next.citations)) {
    const raw = next.citations.slice(0, OVERVIEW_SCHEMA_MAX.citations).map((c: any) => {
      if (!c || typeof c !== 'object') return c;
      const out: any = { ...c };
      out.slide_title = clamp(out.slide_title, OVERVIEW_SCHEMA_MAX.slide_title_chars);
      out.evidence_id = clamp(out.evidence_id, OVERVIEW_SCHEMA_MAX.evidence_id_chars);
      return out;
    });

    // If citations are still schema-invalid (even after truncation), drop them entirely.
    const allCitationsValid = raw.every((c: any) => LlmOverviewV1CitationSchema.safeParse(c).success);
    next.citations = allCitationsValid ? raw : [];
  }

  if (Array.isArray(next.quality_flags)) {
    next.quality_flags = next.quality_flags.slice(0, OVERVIEW_SCHEMA_MAX.quality_flags).map((v: any) => clamp(v, 64));
  }

  return next;
}

export function sanitizeAndValidateOverviewOrDropCitations(overview: any):
  | { ok: true; overview: any; dropped_citations: boolean }
  | { ok: false; overview: any; error: any } {
  const sanitized = sanitizeLlmOverviewV1AfterGuard(overview);

  const first = LlmOverviewV1Schema.safeParse(sanitized);
  if (first.success) return { ok: true as const, overview: first.data, dropped_citations: false };

  const citationsOnly = first.error.issues.every((i) => i?.path?.[0] === 'citations');
  if (!citationsOnly) return { ok: false as const, overview: sanitized, error: first.error.flatten() };

  const dropped = sanitized && typeof sanitized === 'object' ? { ...(sanitized as any), citations: [] } : sanitized;
  const second = LlmOverviewV1Schema.safeParse(dropped);
  if (second.success) return { ok: true as const, overview: second.data, dropped_citations: true };
  return { ok: false as const, overview: dropped, error: second.error.flatten() };
}

// ─── Structured summary helpers ────────────────────────────────────────────────

export function ensureStructuredRevenueSelectionReason(report: any): void {
  try {
    if (!report || typeof report !== 'object') return;
    const structured = (report as any).structured_summary;
    if (!structured || typeof structured !== 'object') return;

    const hasNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

    const revenueExisting = (structured as any).revenue;
    if (!revenueExisting || typeof revenueExisting !== 'object') {
      (structured as any).revenue = {
        value: null,
        confidence: 0,
        sources: [],
        label: null,
        selection_reason: 'not_extracted_yet',
        candidates: [],
      };
      return;
    }

    const revenue = revenueExisting as any;
    const selection = revenue.selection_reason;
    if (hasNonEmptyString(selection)) return;

    // Prefer signals from candidates/sources to keep this deterministic and meaningful.
    const candidates: any[] = Array.isArray(revenue.candidates) ? revenue.candidates : [];
    const selectedCandidate = candidates.find((c) => c && typeof c === 'object' && c.selected === true) ?? null;
    const selectedScope = hasNonEmptyString(selectedCandidate?.scope) ? String(selectedCandidate.scope).trim().toLowerCase() : null;

    const sources: any[] = Array.isArray(revenue.sources) ? revenue.sources : [];
    const sourceKinds = new Set(
      sources
        .map((s) => (s && typeof s === 'object' ? String((s as any).kind ?? '').trim().toLowerCase() : ''))
        .filter(Boolean)
    );

    const hasRevenueValue = (() => {
      const v = revenue.value;
      if (v == null) return false;
      if (typeof v === 'string') return v.trim().length > 0;
      if (typeof v === 'object') {
        const raw = (v as any).raw;
        if (hasNonEmptyString(raw)) return true;
        const amount = (v as any).amount;
        if (typeof amount === 'number' && Number.isFinite(amount)) return true;
      }
      return true;
    })();

    if (sourceKinds.has('input_metric') || selectedScope === 'input_metric') {
      revenue.selection_reason = 'input_metric_preferred';
      return;
    }
    if (sourceKinds.has('financial_health.metrics') || selectedScope === 'financial_health') {
      revenue.selection_reason = 'financial_health_fallback';
      return;
    }
    if (selectedScope === 'company_financials_table') {
      revenue.selection_reason = 'financial_table_preferred';
      return;
    }
    if (selectedScope === 'company_total') {
      revenue.selection_reason = 'company_total_preferred';
      return;
    }

    revenue.selection_reason = hasRevenueValue ? 'unknown_source_defaulted' : 'not_extracted_yet';
  } catch {
    // ignore
  }
}

export function applyStructuredNumericTrustGates(report: any): void {
  try {
    if (!report || typeof report !== 'object') return;
    const structured = (report as any).structured_summary;
    if (!structured || typeof structured !== 'object') return;

    const sourceText = (sources: any[]): string =>
      (Array.isArray(sources) ? sources : [])
        .map((s) => {
          if (!s || typeof s !== 'object') return '';
          return [
            String((s as any).note_snippet ?? ''),
            String((s as any).snippet ?? ''),
            String((s as any).slide_title ?? ''),
          ]
            .join(' ')
            .trim();
        })
        .filter((x) => x.length > 0)
        .join(' ')
        .toLowerCase();

    const sourceKinds = (sources: any[]): Set<string> =>
      new Set(
        (Array.isArray(sources) ? sources : [])
          .map((s) => (s && typeof s === 'object' ? String((s as any).kind ?? '').trim().toLowerCase() : ''))
          .filter(Boolean)
      );

    const isExternalContractLike = (text: string): boolean =>
      /\b(cost\s+to\s+acquire|fully\s+guaranteed|draft\s+picks?|game\s+suspension|contract\s+value|sportsbook|trade)\b/.test(text);

    const isMarketSizingHypothetical = (text: string): boolean =>
      /\b(tam|sam|som|market\s+share|users?|arr|annual\s+recurring\s+revenue)\b/.test(text) &&
      /\?|\b(help\s+me\s+understand|what\s+if|would|could|assum(?:e|ing|ption|ptions)|imply)\b/.test(text);

    const isPackagingLike = (text: string): boolean =>
      /\b\d{2,4}\s*(ml|oz|fl\s*oz|g|kg|lb|lbs)\b/.test(text) ||
      (/\b(cans?|bottles?|packs?)\b/.test(text) && /\b(ml|oz|fl\s*oz)\b/.test(text));

    // Raise trust gate: drop large promoted raises sourced from clearly non-financing contexts.
    try {
      const raise = (structured as any).raise;
      if (raise && typeof raise === 'object') {
        const amountRaw = (raise as any)?.value_json?.amount?.amount;
        const amount = typeof amountRaw === 'number' && Number.isFinite(amountRaw) ? amountRaw : null;
        const sources = Array.isArray((raise as any).sources) ? (raise as any).sources : [];
        const kinds = sourceKinds(sources);
        const text = sourceText(sources);
        const suspiciousContext = isExternalContractLike(text) || isMarketSizingHypothetical(text);
        if (amount != null && amount >= 50_000_000 && kinds.has('promoted_fact') && suspiciousContext) {
          (raise as any).value = null;
          if ((raise as any).value_json && typeof (raise as any).value_json === 'object') {
            (raise as any).value_json = {
              ...(raise as any).value_json,
              amount: {
                amount: null,
                currency: (raise as any).value_json?.amount?.currency ?? 'USD',
              },
            };
          }
          (raise as any).suppressed_reason = 'low_trust_raise_context';
        }
      }
    } catch {
      // ignore
    }

    // Revenue trust gate: suppress weak-source outliers and fall back to safer candidates when present.
    try {
      const revenue = (structured as any).revenue;
      if (revenue && typeof revenue === 'object') {
        const candidates: any[] = Array.isArray((revenue as any).candidates) ? (revenue as any).candidates : [];

        const hasStrongCorroboration = (candidate: any): boolean => {
          const amount = typeof candidate?.amount === 'number' && Number.isFinite(candidate.amount) ? candidate.amount : null;
          if (amount == null || amount <= 0) return false;
          return candidates.some((other) => {
            if (!other || other === candidate) return false;
            const otherAmount = typeof other?.amount === 'number' && Number.isFinite(other.amount) ? other.amount : null;
            if (otherAmount == null || otherAmount <= 0) return false;
            const kinds = sourceKinds(other?.sources ?? []);
            const hasStrongKind = ['xlsx', 'pdf_table', 'pdf_kpi_line', 'input_metric'].some((k) => kinds.has(k));
            if (!hasStrongKind) return false;
            const relDelta = Math.abs(otherAmount - amount) / Math.max(amount, 1);
            return relDelta <= 0.5;
          });
        };

        const isSuspiciousRevenueCandidate = (candidate: any): boolean => {
          const amount = typeof candidate?.amount === 'number' && Number.isFinite(candidate.amount) ? candidate.amount : null;
          if (amount == null || amount < 100_000_000) return false;

          const kinds = sourceKinds(candidate?.sources ?? []);
          const text = sourceText(candidate?.sources ?? []);
          const confidence = typeof candidate?.confidence === 'number' && Number.isFinite(candidate.confidence) ? candidate.confidence : 0;

          if (kinds.has('promoted_fact') && (isExternalContractLike(text) || isMarketSizingHypothetical(text) || isPackagingLike(text))) {
            return true;
          }

          const weakKpi = kinds.has('kpi_tile') || kinds.has('chart_pixel');
          if (weakKpi && confidence <= 0.65 && !hasStrongCorroboration(candidate)) {
            return true;
          }

          return false;
        };

        const selected = candidates.find((c) => c && c.selected === true) ?? null;
        if (selected && isSuspiciousRevenueCandidate(selected)) {
          const fallback = candidates.find((c) => c && c !== selected && !isSuspiciousRevenueCandidate(c)) ?? null;
          if (fallback) {
            const nextAmount = typeof fallback.amount === 'number' && Number.isFinite(fallback.amount) ? fallback.amount : null;
            (revenue as any).value = {
              amount: nextAmount,
              currency: typeof fallback.currency === 'string' && fallback.currency.trim() ? fallback.currency : ((revenue as any)?.value?.currency ?? 'USD'),
              period: (revenue as any)?.value?.period ?? null,
              raw: typeof fallback.value_raw === 'string' && fallback.value_raw.trim() ? fallback.value_raw : null,
            };
            (revenue as any).confidence = typeof fallback.confidence === 'number' && Number.isFinite(fallback.confidence)
              ? fallback.confidence
              : (revenue as any).confidence;
            (revenue as any).sources = Array.isArray(fallback.sources) ? fallback.sources : [];
            (revenue as any).selection_reason = 'trust_gate_fallback';
            (revenue as any).candidates = candidates.map((c) => ({ ...c, selected: c === fallback }));
          } else {
            (revenue as any).value = null;
            (revenue as any).sources = [];
            (revenue as any).selection_reason = 'suppressed_low_trust_revenue';
            (revenue as any).candidates = candidates.map((c) => ({ ...c, selected: false }));
          }
        }
      }
    } catch {
      // ignore
    }
  } catch {
    // ignore
  }
}

export function ensureStructuredSummaryKpis(report: any): void {
  try {
    if (!report || typeof report !== 'object') return;
    const structured = (report as any).structured_summary;
    if (!structured || typeof structured !== 'object') return;

    const existing = (structured as any).kpis;
    const kpis = existing && typeof existing === 'object' ? existing : {};

    // Compatibility mapping: older clients expect structured_summary.kpis.*
    if ((kpis as any).raise == null) (kpis as any).raise = (structured as any).raise ?? null;
    if ((kpis as any).revenue == null) (kpis as any).revenue = (structured as any).revenue ?? null;
    if ((kpis as any).customers == null) (kpis as any).customers = (structured as any).customers ?? null;
    if ((kpis as any).growth == null) (kpis as any).growth = (structured as any).growth ?? null;

    // Ensure revenue selection reason is present (shape-only, deterministic).
    try {
      const kpiRevenue = (kpis as any).revenue;
      const structuredRevenue = (structured as any).revenue;
      if (
        kpiRevenue &&
        typeof kpiRevenue === 'object' &&
        (kpiRevenue as any).selection_reason == null &&
        structuredRevenue &&
        typeof structuredRevenue === 'object' &&
        (structuredRevenue as any).selection_reason != null
      ) {
        (kpiRevenue as any).selection_reason = (structuredRevenue as any).selection_reason;
      }
    } catch {
      // ignore
    }

    if ((kpis as any).business_model == null) {
      (kpis as any).business_model = (structured as any).business_model ?? (structured as any).business_model_summary ?? null;
    }

    // Compatibility: surface marketing attributed revenue under kpis.performance when available.
    const marketingMetrics = (structured as any).marketing_metrics;
    const attributedRevenue =
      marketingMetrics && typeof marketingMetrics === 'object'
        ? ((marketingMetrics as any).attributed_revenue ?? (marketingMetrics as any).marketing_attributed_revenue_v1 ?? null)
        : null;

    if (attributedRevenue) {
      const perfExisting = (kpis as any).performance;
      const perf = perfExisting && typeof perfExisting === 'object' ? perfExisting : {};
      if ((perf as any).marketing_attributed_revenue_v1 == null) {
        (perf as any).marketing_attributed_revenue_v1 = attributedRevenue;
      }
      (kpis as any).performance = perf;
    }

    (structured as any).kpis = kpis;
  } catch {
    // ignore
  }
}

// ─── Decision/grade alignment helpers ─────────────────────────────────────────

type ReportRecommendationV0 = 'strong_yes' | 'yes' | 'consider' | 'pass';
type ReportGradeV0 = 'Excellent' | 'Good' | 'Fair' | 'Needs Improvement' | 'Insufficient Information';

export function mapDecisionV1ToReportRecommendation(decisionKey: unknown): ReportRecommendationV0 | null {
  if (typeof decisionKey !== 'string') return null;
  switch (decisionKey) {
    case 'hard_pass':
      return 'pass';
    case 'consider':
      return 'consider';
    case 'strong_consider':
      return 'consider';
    case 'fund_caution':
      return 'yes';
    case 'fund_track':
      return 'yes';
    case 'fund_confident':
      return 'strong_yes';
    default:
      return null;
  }
}

export function mapDecisionV1ToReportGrade(decisionKey: unknown): ReportGradeV0 | null {
  if (typeof decisionKey !== 'string') return null;
  switch (decisionKey) {
    case 'hard_pass':
      return 'Needs Improvement';
    case 'consider':
      return 'Fair';
    case 'strong_consider':
      return 'Good';
    case 'fund_caution':
      return 'Good';
    case 'fund_track':
      return 'Excellent';
    case 'fund_confident':
      return 'Excellent';
    default:
      return null;
  }
}

export function alignReportFieldsToDecisionV1(args: {
  nextMetadata: any;
  report: any;
}): void {
  try {
    const meta = args.nextMetadata && typeof args.nextMetadata === 'object' ? args.nextMetadata : null;
    const report = args.report && typeof args.report === 'object' ? args.report : null;
    if (!meta || !report) return;

    if (meta.decision_v1_report_alignment_v1 === true) return;

    const decision = meta.decision_v1 && typeof meta.decision_v1 === 'object' ? meta.decision_v1 : null;
    const decisionKey = (decision as any)?.recommendation_key;

    const mappedRec = mapDecisionV1ToReportRecommendation(decisionKey);
    const mappedGrade = mapDecisionV1ToReportGrade(decisionKey);
    if (!mappedRec && !mappedGrade) return;

    const existingRecommendation = typeof report.recommendation === 'string' ? (report.recommendation as string) : null;
    const existingGrade = typeof report.grade === 'string' ? (report.grade as string) : null;

    if (meta.legacy_recommendation_v0 == null && existingRecommendation) meta.legacy_recommendation_v0 = existingRecommendation;
    if (meta.legacy_grade_v0 == null && existingGrade) meta.legacy_grade_v0 = existingGrade;

    if (mappedRec) report.recommendation = mappedRec;
    if (mappedGrade) report.grade = mappedGrade;

    meta.decision_v1_report_alignment_v1 = true;
  } catch {
    // ignore
  }
}

export function titleCaseFromKey(key: string): string {
  return key
    .split('_')
    .filter(Boolean)
    .map((w) => w.slice(0, 1).toUpperCase() + w.slice(1))
    .join(' ');
}

export function decisionV1DisplayLabel(meta: any): string | null {
  const decision = meta?.decision_v1 && typeof meta.decision_v1 === 'object' ? meta.decision_v1 : null;
  const label = typeof decision?.label === 'string' && decision.label.trim() ? decision.label.trim() : null;
  if (label) return label;
  const key = typeof decision?.recommendation_key === 'string' && decision.recommendation_key.trim()
    ? decision.recommendation_key.trim()
    : null;
  return key ? titleCaseFromKey(key) : null;
}

export function alignReportSectionsToDecisionV1(args: {
  nextMetadata: any;
  report: any;
}): void {
  try {
    const meta = args.nextMetadata && typeof args.nextMetadata === 'object' ? args.nextMetadata : null;
    const report = args.report && typeof args.report === 'object' ? args.report : null;
    if (!meta || !report) return;

    if (meta.decision_v1_sections_alignment_v1 === true) return;

    const label = decisionV1DisplayLabel(meta);
    if (!label) return;

    const sectionsRaw: any[] = Array.isArray((report as any).sections) ? (report as any).sections : [];
    if (!sectionsRaw.length) return;

    const shouldRewrite = (title: unknown): boolean => {
      const t = typeof title === 'string' ? title.trim() : '';
      return t === 'Executive Summary' || t === 'Investment Recommendation';
    };

    const nextSections = sectionsRaw.map((section) => {
      if (!section || typeof section !== 'object') return section;
      if (!shouldRewrite((section as any).title)) return section;
      const content = typeof (section as any).content === 'string' ? String((section as any).content) : '';
      if (!content) return section;

      // Sections from the core compiler currently encode newlines as literal "\\n" sequences.
      // Rewrite the "Recommendation:" line regardless of whether content uses real newlines or literal "\\n".
      const nextContent = content.replace(
        /Recommendation:\s*.*?(?=(\n|\\n|$))/g,
        `Recommendation: ${label}`
      );
      if (nextContent === content) return section;
      return { ...(section as any), content: nextContent };
    });

    (report as any).sections = nextSections;

    meta.decision_v1_sections_alignment_v1 = true;
  } catch {
    // ignore
  }
}

// ─── Scoring V2 Phase 1 stub helpers ──────────────────────────────────────────

export function _bqBandFromKey(key: string): string {
  const MAP: Record<string, string> = {
    not_investment_grade: 'Not Investment Grade',
    early_consideration: 'Early Consideration',
    emerging_opportunity: 'Emerging Opportunity',
    strong_opportunity: 'Strong Opportunity',
    fund_grade: 'Fund Grade',
    exceptional: 'Exceptional',
  };
  return MAP[key] ?? key;
}

export function _bqBandKeyFromScoreBandKey(scoreBandKey: string): string {
  // score_band_v2 uses the same 6-key vocabulary as BusinessQualityBandV2.
  const valid = new Set([
    'not_investment_grade', 'early_consideration', 'emerging_opportunity',
    'strong_opportunity', 'fund_grade', 'exceptional',
  ]);
  return valid.has(scoreBandKey) ? scoreBandKey : 'not_investment_grade';
}

export function _eqLabelFromScore(score: number | null): string | null {
  if (score === null) return null;
  if (score >= 65) return 'Strong Evidence';
  if (score >= 40) return 'Adequate Evidence';
  if (score >= 20) return 'Thin Evidence';
  return 'Insufficient Evidence';
}

export function _eqGateFromScore(score: number | null): string {
  if (score === null) return 'blocked';
  if (score >= 65) return 'clear';
  if (score >= 40) return 'caution';
  if (score >= 20) return 'capped';
  return 'blocked';
}

export function _cvLabelFromScore(score: number | null): string | null {
  if (score === null) return null;
  if (score >= 70) return 'Strong Conviction';
  if (score >= 45) return 'Moderate Conviction';
  if (score >= 20) return 'Low Conviction';
  return 'Insufficient Conviction';
}

export function _cvGateFromScore(score: number | null): string {
  if (score === null) return 'clear'; // Phase 1 default: no conviction → no gate penalty
  if (score < 20) return 'hard_pass';
  if (score < 45) return 'capped';
  return 'clear';
}

export function _canonicalVerdictFromDecisionKey(
  recKey: string,
  guardrailTriggered: boolean,
): string {
  if (guardrailTriggered) return 'hard_pass';
  switch (recKey) {
    case 'fund_confident':
    case 'fund_track':
      return 'fund';
    case 'fund_caution':
    case 'strong_consider':
      return 'advance';
    case 'consider_caution':
    case 'consider':
      return 'investigate';
    case 'hard_pass':
      return 'hard_pass';
    default:
      return 'pass';
  }
}

export function _verdictLabel(verdict: string): string {
  const MAP: Record<string, string> = {
    fund: 'Fund', advance: 'Advance', investigate: 'Investigate',
    pass: 'Pass', hard_pass: 'Hard Pass',
  };
  return MAP[verdict] ?? 'Pass';
}
