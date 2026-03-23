/**
 * Simple DIO to ReportDTO compiler
 * Works with actual DIO schema v1.0.0
 */

import type { DealIntelligenceObject } from '../types/dio.js';
import { buildScoreExplanationFromDIO, type ScoreExplanation } from './score-explanation.js';
import { buildDeterministicDealSummaryV1FromStructuredSummary, type DeterministicDealSummaryV1 } from './deal-summary-v1-deterministic.js';
import { buildTopSectionV1FromScoreExplanation, type TopSectionV1 } from './topsection-v1-deterministic.js';
import { inferFundingStageModelV1, type FundingStageModelV1 } from '../models/funding-stage-model.js';
import { inferFinancialCoverageProfileV1, type FinancialCoverageProfileV1 } from '../models/financial-coverage-profile.js';
import type { FinancialFactV1 } from '../financial-facts/financial-fact-v1.js';
import {
  selectAuthoritativeFact,
  filterCorruptedFacts,
  isCorruptedFact,
  isProjectedFact,
} from '../financial-facts/select-authoritative-fact.js';
import { inferCapitalLogicProfileV1, type CapitalLogicProfileV1 } from '../models/capital-logic-profile.js';
import { inferStageExpectationsProfileV1, type StageExpectationsProfileV1 } from '../models/stage-expectations-profile.js';
import { inferBusinessModelSignalProfileV1, type BusinessModelSignalProfileV1 } from '../models/business-model-signal-profile.js';
import { inferMarketAccessibilitySignalProfileV1, type MarketAccessibilitySignalProfileV1 } from '../models/market-accessibility-signal-profile.js';
import { inferTractionSignalProfileV1, type TractionSignalProfileV1 } from '../models/traction-signal-profile.js';
import { inferTeamSignalProfileV1, type TeamSignalProfileV1 } from '../models/team-signal-profile.js';
import { buildStageWeightedScoreInputsV1 } from '../scoring/stage-weighted-score-inputs-v1.js';
import { scoreStageWeightedV1 } from '../scoring/dimension-scorer-v1.js';
import {
  buildFinancialBreakdownV1,
  buildUnderwritingReadinessV1,
  type FinancialBreakdownV1,
  type UnderwritingReadinessV1,
} from '../models/financial-breakdown-v1.js';
import type { FinancialIntegrityV1 } from '../types/financial-integrity-v1.js';

// Import ReportDTO types directly from contracts
type ReportDTO = {
  dealId: string;
  generatedAt: string;
  version: number;
  overallScore: number;

  // Additive deterministic artifact (v1)
  funding_stage_v1?: FundingStageModelV1;
  financial_coverage_v1?: FinancialCoverageProfileV1;
  financial_breakdown_v1?: FinancialBreakdownV1;
  underwriting_readiness_v1?: UnderwritingReadinessV1;
  capital_logic_v1?: CapitalLogicProfileV1;
  stage_expectations_v1?: StageExpectationsProfileV1;
  business_model_signal_v1?: BusinessModelSignalProfileV1;
  market_accessibility_signal_v1?: MarketAccessibilitySignalProfileV1;
  traction_signal_v1?: TractionSignalProfileV1;
  team_signal_v1?: TeamSignalProfileV1;
  /** Financial integrity cross-source analysis (completeness, discrepancy, anomalies). null = analyzer did not run or DIO predates this field. */
  financial_integrity_v1?: FinancialIntegrityV1 | null;
  structured_summary?: {
    raise: {
      value: string | null;
      confidence: number;
      sources: Array<Record<string, any>>;
      label?: string | null;
      round_label?: string | null;
      value_json?: {
        amount?: { amount: number | null; currency?: string | null };
      };
    };
    business_model: { value: string | null; confidence: number; sources: Array<Record<string, any>>; label?: string | null };
    revenue: {
      value: { amount: number | null; currency: string | null; period: string | null; raw: string | null } | null;
      confidence: number;
      sources: Array<Record<string, any>>;
      label?: string | null;
      selection_reason?: string | null;
      candidates?: Array<{
        selected?: boolean;
        score?: number;
        scope?: string | null;
        subtype?: string | null;
        year?: number | null;
        value_raw?: string | null;
        amount?: number | null;
        currency?: string | null;
        confidence?: number | null;
        sources?: Array<Record<string, any>>;
      }>;
    };

    marketing_metrics?: {
      attributed_revenue?: {
        value_raw: string | null;
        channel: string | null;
        confidence: number;
        sources: Array<Record<string, any>>;
      };
    };
    customers: {
      value: { count: number | null; kind: string | null; raw: string | null } | null;
      confidence: number;
      sources: Array<Record<string, any>>;
      label?: string | null;
    };
    growth: {
      value: { percent: number | null; year: number | null; raw: string | null } | null;
      confidence: number;
      sources: Array<Record<string, any>>;
      label?: string | null;
    };
    issues: string[];
    strengths: string[];
    recommendations: string[];

    // Deterministic KPI-locked synthesis from structured_summary.
    // API may override/augment this with node-derived citations.
    deal_summary_v1?: DeterministicDealSummaryV1;
    // TopSection V1: score-driver summary (never company description, never governed overlay).
    // See packages/core/src/reports/topsection-v1-deterministic.ts for the design contract.
    topsection_v1?: TopSectionV1;
  };

  grade: 'Excellent' | 'Good' | 'Fair' | 'Needs Improvement' | 'Insufficient Information';
  recommendation: 'strong_yes' | 'yes' | 'consider' | 'pass';
  categories: Array<Record<string, any>>;
  redFlags: Array<{ severity: 'high' | 'medium' | 'low'; message: string; action: string }>;
  greenFlags: string[];

  sections: ReportSection[];
  completeness: number;
  metadata?: Record<string, any>;
};

type ReportSection = {
  id: string;
  title: string;
  content: string;
  evidence_ids?: string[];
  metrics?: Array<{
    label: string;
    value: number;
    evidence_ids?: string[];
  }>;
};

type DIO = DealIntelligenceObject;
type PromotedFactInput = {
  fact_type: string;
  confidence?: number;
  extracted_at?: string;
  source_path?: string;
  source_document_id?: string | null;
  evidence_id?: string;
  content_json?: any;
  meta?: any;
};

type StructuredField<T> = { value: T | null; confidence: number; sources: Array<Record<string, any>>; label?: string | null };

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

const confidenceBandToNumber = (band: unknown): number => {
  if (band === 'high') return 0.85;
  if (band === 'med') return 0.65;
  if (band === 'low') return 0.45;
  return 0.5;
};

const emptyField = <T,>(value: T | null = null): StructuredField<T> => ({ value, confidence: 0, sources: [], label: null });

const asNonEmptyString = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null;

const parseScaledNumber = (raw: string): number | null => {
  const s = raw.trim();
  if (!s) return null;
  const m = s.match(/(-?\d+(?:[\d,]*\d)?(?:\.\d+)?)(\s*[kKmMbB])?\b/);
  if (!m) return null;
  const base = Number(String(m[1]).replace(/,/g, ''));
  if (!Number.isFinite(base)) return null;
  const suffix = (m[2] || '').trim().toLowerCase();
  const mult = suffix === 'k' ? 1e3 : suffix === 'm' ? 1e6 : suffix === 'b' ? 1e9 : 1;
  return base * mult;
};

const parseMoneyLike = (v: unknown): { amount: number | null; currency: string | null; raw: string | null } => {
  if (typeof v === 'number' && Number.isFinite(v)) return { amount: v, currency: null, raw: null };
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return { amount: null, currency: null, raw: null };
  const currency = s.includes('$') ? 'USD' : null;
  const amount = parseScaledNumber(s.replace(/[^0-9kKmMbB,\.\-]/g, ''));
  return { amount, currency, raw: s };
};

const normalizeMetricKey = (s: string): string => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');

const formatUsdShort = (amount: number | null | undefined): string | null => {
  const v = typeof amount === 'number' && Number.isFinite(amount) ? amount : null;
  if (v == null || v <= 0) return null;
  if (v >= 1e9) {
    const x = v / 1e9;
    const s = Number.isInteger(x) ? x.toFixed(0) : x.toFixed(x >= 10 ? 0 : 1);
    return `$${s}B`;
  }
  if (v >= 1e6) {
    const x = v / 1e6;
    const s = Number.isInteger(x) ? x.toFixed(0) : x.toFixed(x >= 10 ? 0 : 1);
    return `$${s}MM`;
  }
  if (v >= 1e3) {
    const x = v / 1e3;
    const s = Number.isInteger(x) ? x.toFixed(0) : x.toFixed(x >= 10 ? 0 : 1);
    return `$${s}K`;
  }
  return `$${Math.round(v)}`;
};

const revenueDisplayFromStructuredSummary = (structured: any): string | null => {
  const value = structured?.revenue?.value;
  if (!value || typeof value !== 'object') return null;
  const raw = asNonEmptyString((value as any).raw);
  if (raw) return raw;
  const formatted = formatUsdShort((value as any).amount);
  return formatted;
};

const promotedFactTypeOf = (f: any): string => {
  const root = f?.fact_type;
  if (typeof root === 'string' && root.trim()) return root.trim();
  const nested = f?.content_json?.fact_type;
  return typeof nested === 'string' ? nested.trim() : '';
};

const promotedFactValueJson = (f: any): any => {
  const cj = f?.content_json;
  if (cj && typeof cj === 'object') {
    return (cj as any)?.value_json ?? (cj as any)?.valueJson ?? null;
  }
  return null;
};

const revenueDisplayFromPromotedFacts = (promotedFacts?: PromotedFactInput[]): string | null => {
  const facts = Array.isArray(promotedFacts) ? promotedFacts : [];
  const candidates = facts
    .filter((f) => promotedFactTypeOf(f) === 'revenue_v1')
    .filter((f) => {
      const vj = promotedFactValueJson(f) ?? {};
      const subtype = String((vj as any)?.subtype ?? '').toLowerCase();
      const scope = String((vj as any)?.scope ?? (f as any)?.content_json?.provenance?.scope ?? '').toLowerCase();
      if (subtype === 'attributed') return false;
      if (scope === 'channel_attributed') return false;
      return true;
    })
    .sort((a, b) => (Number(b.confidence ?? 0) - Number(a.confidence ?? 0)));

  for (const f of candidates) {
    const vj = promotedFactValueJson(f) ?? {};
    const display = asNonEmptyString((vj as any)?.display ?? (vj as any)?.raw);
    if (display) return display;
  }
  return null;
};

const applyRevenueOverrideToMetricBenchmarkContent = (content: string, revenueDisplay: string | null): string => {
  if (!revenueDisplay) return content;

  // Ensure revenue is not reported as missing if canonical/provided revenue exists.
  // Handles both real newlines and literal "\\n" sequences.
  const re = /•\s*revenue\s*:\s*([^)]*?)\s+vs\s+([^)]*?)\s+\(Missing\)/gi;
  return content.replace(re, (_m, _currentValue, benchmarkValue) => {
    const bench = typeof benchmarkValue === 'string' && benchmarkValue.trim() ? benchmarkValue.trim() : '0';
    return `• revenue: ${revenueDisplay} vs ${bench} (Adequate)`;
  });
};

const shouldCollapseRaiseDisplay = (display: string): boolean => {
  const s = display.toLowerCase();
  // If detailed term sheet semantics are present, keep the full display.
  if (s.includes('safe') || s.includes('cap') || s.includes('discount') || s.includes('interest') || s.includes('%')) return false;
  // Collapse when it's essentially a raise amount + valuation phrasing.
  if (s.includes('valuation') || s.includes('@') || s.includes('post-money') || s.includes('pre-money') || /\braise\b/.test(s)) return true;
  return false;
};

function buildStructuredSummary(
  dio: DIO,
  scoreExplanation: any,
  promotedFacts?: PromotedFactInput[]
): NonNullable<ReportDTO['structured_summary']> {
  const structured: NonNullable<ReportDTO['structured_summary']> = {
    raise: emptyField<string>(),
    business_model: emptyField<string>(),
    revenue: emptyField<{ amount: number | null; currency: string | null; period: string | null; raw: string | null }>(),
    customers: emptyField<{ count: number | null; kind: string | null; raw: string | null }>(),
    growth: emptyField<{ percent: number | null; year: number | null; raw: string | null }>(),
    marketing_metrics: {},
    issues: [],
    strengths: [],
    recommendations: [],
  };

  // Priority 0: deterministic promoted facts from document_page_understanding -> evidence_items.
  const promoted = Array.isArray(promotedFacts) ? promotedFacts : [];
  const factTypeOf = (f: PromotedFactInput): string => {
    const root = (f as any)?.fact_type;
    if (typeof root === 'string' && root.trim()) return root.trim();
    const nested = (f as any)?.content_json?.fact_type;
    return typeof nested === 'string' ? nested.trim() : '';
  };
  const getPromotedValueJson = (f: PromotedFactInput): any => {
    const cj = (f as any)?.content_json;
    if (cj && typeof cj === 'object') {
      return (cj as any)?.value_json ?? (cj as any)?.valueJson ?? null;
    }
    return null;
  };

  const attachNoteSnippet = (sources: Array<Record<string, any>>, noteSnippet: unknown): Array<Record<string, any>> => {
    const note_snippet = asNonEmptyString(noteSnippet);
    if (!note_snippet) return sources;
    return sources.map((s) => ({ ...s, note_snippet }));
  };
  const promotedSourcesFor = (f: PromotedFactInput): Array<Record<string, any>> => {
    const prov = ((f as any)?.content_json && typeof (f as any).content_json === 'object')
      ? (f as any).content_json.provenance
      : null;
    const pageIndex = typeof prov?.page_index === 'number' && Number.isFinite(prov.page_index)
      ? prov.page_index
      : (typeof (f as any)?.meta?.page_index === 'number' && Number.isFinite((f as any).meta.page_index) ? (f as any).meta.page_index : null);

    const primaryFromArray = Array.isArray(prov?.primary_sources) ? prov.primary_sources : [];
    const supportingFromArray = Array.isArray(prov?.supporting_sources) ? prov.supporting_sources : [];

    const mk = (docId: unknown, pi: unknown): string => `${String(docId ?? '')}:${String(pi ?? '')}`;
    const out: Array<Record<string, any>> = [];
    const base = {
      kind: 'promoted_fact',
      fact_type: factTypeOf(f) || f.fact_type,
      evidence_id: (f as any)?.evidence_id ?? null,
      extracted_at: f.extracted_at ?? null,
    };

    // Primary: prefer explicit primary_sources[0], else provenance root, else meta.
    const primary0 = primaryFromArray[0] ?? null;
    const primaryDoc =
      (typeof primary0?.source_document_id === 'string' && primary0.source_document_id.trim() ? primary0.source_document_id.trim() : null) ??
      (typeof prov?.source_document_id === 'string' && prov.source_document_id.trim() ? prov.source_document_id.trim() : null) ??
      (typeof f.source_document_id === 'string' && f.source_document_id.trim() ? f.source_document_id.trim() : null) ??
      (typeof (f as any)?.meta?.document_id === 'string' && (f as any).meta.document_id.trim() ? (f as any).meta.document_id.trim() : null);
    const primaryPi =
      (typeof primary0?.page_index === 'number' && Number.isFinite(primary0.page_index) ? primary0.page_index : null) ??
      (typeof prov?.page_index === 'number' && Number.isFinite(prov.page_index) ? prov.page_index : null) ??
      pageIndex;

    out.push({
      ...base,
      evidence_role: 'primary',
      source_path: primaryDoc != null && primaryPi != null ? `doc:${primaryDoc}:page:${primaryPi + 1}` : (f.source_path ?? null),
      source_document_id: primaryDoc,
      page_index: primaryPi,
      page: primaryPi != null ? primaryPi + 1 : null,
      slide_number: typeof primary0?.slide_number === 'number' && Number.isFinite(primary0.slide_number)
        ? primary0.slide_number
        : (typeof prov?.slide_number === 'number' && Number.isFinite(prov.slide_number) ? prov.slide_number : null),
      segment_key: typeof primary0?.segment_key === 'string'
        ? primary0.segment_key
        : (typeof prov?.segment_key === 'string' ? prov.segment_key : null),
      segment_reason: (primary0 && typeof primary0 === 'object' && (primary0 as any).segment_reason)
        ? (primary0 as any).segment_reason
        : (prov && typeof prov === 'object' && (prov as any).segment_reason)
          ? (prov as any).segment_reason
          : ((f as any)?.meta && typeof (f as any).meta === 'object' ? (f as any).meta.segment_reason ?? null : null),
      slide_title: typeof primary0?.slide_title === 'string'
        ? primary0.slide_title
        : (typeof prov?.slide_title === 'string' ? prov.slide_title : null),
    });

    const supportingLegacy = Array.isArray(prov?.supporting) ? prov.supporting : [];
    const supporting = supportingFromArray.length > 0 ? supportingFromArray : supportingLegacy;
    for (const s of supporting) {
      const sPi = typeof s?.page_index === 'number' && Number.isFinite(s.page_index) ? s.page_index : null;
      const sDoc = typeof s?.source_document_id === 'string' && s.source_document_id.trim() ? s.source_document_id.trim() : null;
      if (sDoc == null || sPi == null) continue;
      out.push({
        ...base,
        evidence_role: 'supporting',
        supporting: true,
        source_path: `doc:${sDoc}:page:${sPi + 1}`,
        source_document_id: sDoc,
        page_index: sPi,
        page: sPi + 1,
        slide_number: typeof s?.slide_number === 'number' && Number.isFinite(s.slide_number) ? s.slide_number : null,
        segment_key: typeof s?.segment_key === 'string' ? s.segment_key : null,
        segment_reason: (s && typeof s === 'object' && (s as any).segment_reason) ? (s as any).segment_reason : null,
        slide_title: typeof s?.slide_title === 'string' ? s.slide_title : null,
      });
    }

    const seen = new Set<string>();
    return out.filter((x) => {
      const k = mk(x.source_document_id, x.page_index);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };

  const inferRaiseRoundLabel = (raw: string): string | null => {
    const s = raw.toLowerCase();
    if (/\bpre[-\s]?seed\b/i.test(s)) return 'Pre-Seed';
    if (/\bseed\+\b/i.test(s)) return 'Seed+';
    if (/\bseed\b/i.test(s)) return 'Seed';
    if (/\bseries\s*-?\s*a\b/i.test(s) || /\bseries_a\b/i.test(s)) return 'Series A';
    if (/\bgrowth\b/i.test(s) || /\bseries\s*[b-z]\b/i.test(s)) return 'Growth';
    return null;
  };

  const normalizeRaiseFromTextOrAmount = (
    raw: string | null | undefined,
    amountHint?: number | null
  ): { value: string; amount: number | null; currency: string | null; round_label: string | null } | null => {
    const text = asNonEmptyString(raw);
    const parsed = text ? parseMoneyLike(text) : { amount: null, currency: null, raw: null };
    const amount = (typeof amountHint === 'number' && Number.isFinite(amountHint))
      ? amountHint
      : (typeof parsed.amount === 'number' && Number.isFinite(parsed.amount) ? parsed.amount : null);
    if (amount == null && !text) return null;

    const currency = amount != null ? (asNonEmptyString(parsed.currency) ?? 'USD') : null;

    // Non-negotiable: if we have an amount, the display must be amount-only.
    const value = amount != null ? (formatUsdShort(amount) ?? (text ?? String(amount))) : (text as string);
    const round_label = text ? inferRaiseRoundLabel(text) : null;
    return { value, amount, currency, round_label };
  };

  const promotedRaise = promoted.find((f) => factTypeOf(f) === 'raise_terms_v1');
  if (promotedRaise) {
    const vj = getPromotedValueJson(promotedRaise) ?? {};
    const display = asNonEmptyString(vj?.display) ?? asNonEmptyString((vj as any)?.raw_text);
    const amountRaw = (vj as any)?.amount?.amount;
    const valuationRaw = (vj as any)?.valuation?.amount;
    const amount = typeof amountRaw === 'number' && Number.isFinite(amountRaw) ? amountRaw : null;
    const valuation = typeof valuationRaw === 'number' && Number.isFinite(valuationRaw) ? valuationRaw : null;

    const normalized = normalizeRaiseFromTextOrAmount(display, amount);
    if (normalized?.value) {
      const sources = promotedSourcesFor(promotedRaise);
      const noteFromValueJson = asNonEmptyString((vj as any)?.note_snippet);
      const valuationNote = valuation != null ? `on ${formatUsdShort(valuation) ?? '$' + String(valuation)} valuation` : null;
      const note = noteFromValueJson ?? valuationNote;
      structured.raise = {
        value: normalized.value,
        value_json: { amount: { amount: normalized.amount, currency: normalized.currency } },
        round_label: normalized.round_label,
        confidence: clamp01(typeof promotedRaise.confidence === 'number' ? promotedRaise.confidence : 0.7),
        sources: note ? sources.map((s) => ({ ...s, note })) : sources,
      };
    }
  }

  const promotedModel = (() => {
    const models = promoted.filter((f) => factTypeOf(f) === 'business_model_v1');
    if (models.length === 0) return null;

    const score = (f: any): number => {
      const st = typeof f?.source_type === 'string' ? f.source_type : '';
      const conf = typeof f?.confidence === 'number' && Number.isFinite(f.confidence) ? f.confidence : 0;
      const bonus = st === 'business_model_fact' ? 0.25 : 0;
      return conf + bonus;
    };

    return (
      models
        .slice()
        .sort((a: any, b: any) => score(b) - score(a) || String(b?.extracted_at ?? '').localeCompare(String(a?.extracted_at ?? '')))[0] ?? null
    );
  })();
  if (promotedModel) {
    const vj = getPromotedValueJson(promotedModel) ?? {};
    const display = asNonEmptyString(vj?.display) ?? asNonEmptyString(vj?.model);
    const sourcesAll = promotedSourcesFor(promotedModel);
    const primaries = sourcesAll.filter((s) => (s as any)?.evidence_role === 'primary' && (s as any)?.source_document_id && (s as any)?.page_index != null);
    const supportings = sourcesAll.filter((s) => (s as any)?.evidence_role === 'supporting' && (s as any)?.source_document_id && (s as any)?.page_index != null);

    // Canonical restriction: exactly 1 primary + 0–3 supporting. No primary => null/0/[] (no inference).
    if (display && primaries.length === 1) {
      structured.business_model = {
        value: display,
        confidence: clamp01(typeof promotedModel.confidence === 'number' ? promotedModel.confidence : 0.7),
        sources: [primaries[0], ...supportings.slice(0, 3)],
      };
    } else {
      structured.business_model = { value: null, confidence: 0, sources: [], label: null };
    }
  }

  // Growth: percent preferred over forecast outlook.
  const promotedGrowthPercent = (() => {
    const facts = promoted.filter((f) => factTypeOf(f) === 'growth_v1');
    if (facts.length === 0) return null;

    const disallowedSeg = new Set(['team', 'advisors', 'about', 'story']);
    const score = (f: any): number => {
      const prov = f?.content_json?.provenance;
      const title = String(prov?.slide_title ?? '').toLowerCase();
      const seg = String(prov?.segment_key ?? '').trim().toLowerCase();
      const vj = getPromotedValueJson(f) ?? {};
      const note = String((vj as any)?.note_snippet ?? '').toLowerCase();
      let s = 0;
      if (seg && disallowedSeg.has(seg)) s -= 100;
      if (title.includes('growth forecast')) s += 10;
      else if (title.includes('financial')) s += 7;
      else if (title.includes('performance')) s += 6;
      else if (title.includes('growth')) s += 5;
      else if (title.includes('forecast')) s += 4;
      if (note.includes('yoy') || note.includes('y/y') || note.includes('year over year')) s += 2;
      if (note.includes('growth') || note.includes('increase') || note.includes('returning')) s += 1;
      const conf = typeof f?.confidence === 'number' && Number.isFinite(f.confidence) ? f.confidence : 0;
      s += conf;
      return s;
    };

    return (
      facts
        .slice()
        .sort((a: any, b: any) => score(b) - score(a) || String(b?.extracted_at ?? '').localeCompare(String(a?.extracted_at ?? '')))[0] ?? null
    );
  })();
  if (promotedGrowthPercent) {
    const vj = getPromotedValueJson(promotedGrowthPercent) ?? {};
    const raw = asNonEmptyString((vj as any)?.display) ?? asNonEmptyString((vj as any)?.raw);
    const pctRaw = (vj as any)?.percent;
    const percent = typeof pctRaw === 'number' && Number.isFinite(pctRaw) ? pctRaw : null;
    if (raw || percent != null) {
      const sources = attachNoteSnippet(promotedSourcesFor(promotedGrowthPercent), (vj as any)?.note_snippet);
      structured.growth = {
        value: { percent, year: null, raw: raw ?? null },
        confidence: clamp01(typeof promotedGrowthPercent.confidence === 'number' ? promotedGrowthPercent.confidence : 0.6),
        sources,
        label: null,
      };
    }
  }

  if (!structured.growth.value) {
    const promotedGrowthOutlook = promoted.find((f) => factTypeOf(f) === 'growth_outlook_v1');
    if (promotedGrowthOutlook) {
      const vj = getPromotedValueJson(promotedGrowthOutlook) ?? {};
      const raw = asNonEmptyString((vj as any)?.display) ?? asNonEmptyString((vj as any)?.raw);
      const yearRaw = (vj as any)?.year;
      const year = typeof yearRaw === 'number' && Number.isFinite(yearRaw) ? yearRaw : null;
      if (raw) {
        const sources = attachNoteSnippet(promotedSourcesFor(promotedGrowthOutlook), (vj as any)?.note_snippet);
        structured.growth = {
          value: { percent: null, year, raw },
          confidence: clamp01(typeof promotedGrowthOutlook.confidence === 'number' ? promotedGrowthOutlook.confidence : 0.58),
          sources,
          label: 'Forecast',
        };
      }
    }
  }

  const phase1 = (dio as any)?.dio?.phase1;
  const overview = phase1?.deal_overview_v2;
  const exec = phase1?.executive_summary_v1;

  const arbitrationV1 = phase1?.business_model_arbitration_v1;
  const arbitratedModel = asNonEmptyString(arbitrationV1?.business_model);
  if (arbitratedModel) {
    const evidence = Array.isArray(arbitrationV1?.evidence) ? arbitrationV1.evidence : [];
    const sources = evidence.map((e: any) => ({
      kind: 'phase1.business_model_arbitration_v1',
      model: typeof e?.model === 'string' ? e.model : null,
      rule_kind: typeof e?.kind === 'string' ? e.kind : null,
      weight: typeof e?.weight === 'number' && Number.isFinite(e.weight) ? e.weight : null,
      detail: typeof e?.detail === 'string' ? e.detail : null,
      source: typeof e?.source === 'string' ? e.source : null,
    }));
    const confRaw = (arbitrationV1 as any)?.confidence;
    const conf = typeof confRaw === 'number' && Number.isFinite(confRaw) ? clamp01(confRaw) : 0.7;
    structured.business_model = { value: arbitratedModel, confidence: conf, sources, label: 'Arbitrated' };
  }

  const hasPrimaryCitation = (sources: Array<Record<string, any>>): boolean => {
    if (!Array.isArray(sources) || sources.length === 0) return false;
    return sources.some((s: any) => {
      if (!s || typeof s !== 'object') return false;
      const doc = typeof s.document_id === 'string' && s.document_id.trim()
        ? s.document_id.trim()
        : (typeof s.source_document_id === 'string' && s.source_document_id.trim() ? s.source_document_id.trim() : null);
      const page = typeof s.page === 'number' && Number.isFinite(s.page)
        ? s.page
        : (typeof s.page_index === 'number' && Number.isFinite(s.page_index) ? s.page_index + 1 : null);
      return !!doc && page != null;
    });
  };

  const isSpecificBusinessModelString = (raw: string): boolean => {
    const s = raw.trim();
    if (!s) return false;
    const lowered = s.toLowerCase();

    // Reject single-token generic labels (common leakage: "Licensing").
    const tokenCount = lowered.split(/\s+|\//g).filter(Boolean).length;
    if (tokenCount < 2) return false;

    // Require some money-flow / go-to-market model keyword.
    return /\b(dtc|direct\s*-?to\s*-?consumer|wholesale|retail|marketplace|subscription|recurring|saas|commission|take\s*-?rate|transaction|fee|pricing|usage\s*-?based|consumption|licens(e|ing)|royalt(y|ies)|ads?|services?)\b/i.test(s);
  };

  const overviewSources = Array.isArray(overview?.sources)
    ? overview.sources.map((s: any) => ({ kind: 'phase1.deal_overview_v2', ...s }))
    : [];
  const execEvidence = Array.isArray(exec?.evidence)
    ? exec.evidence.map((e: any) => ({ kind: 'phase1.executive_summary_v1', ...e }))
    : [];

  const overviewRaise = asNonEmptyString(overview?.raise);
  if (overviewRaise && !structured.raise.value) {
    const normalized = normalizeRaiseFromTextOrAmount(overviewRaise);
    structured.raise = {
      value: normalized?.value ?? overviewRaise,
      value_json: normalized ? { amount: { amount: normalized.amount, currency: normalized.currency } } : undefined,
      round_label: normalized?.round_label ?? null,
      confidence: 0.9,
      sources: overviewSources,
    };
  }
  const overviewModel = asNonEmptyString(overview?.business_model);
  if (overviewModel && !structured.business_model.value && hasPrimaryCitation(overviewSources)) {
    structured.business_model = { value: overviewModel, confidence: 0.9, sources: overviewSources };
  }

  if (!structured.raise.value) {
    const execRaise = asNonEmptyString(exec?.raise);
    if (execRaise) {
      const band = (exec as any)?.confidence?.sections?.raise ?? (exec as any)?.confidence?.overall;
      const normalized = normalizeRaiseFromTextOrAmount(execRaise);
      structured.raise = {
        value: normalized?.value ?? execRaise,
        value_json: normalized ? { amount: { amount: normalized.amount, currency: normalized.currency } } : undefined,
        round_label: normalized?.round_label ?? null,
        confidence: confidenceBandToNumber(band),
        sources: execEvidence,
      };
    }
  }
  if (!structured.business_model.value) {
    const execModel = asNonEmptyString(exec?.business_model);
    if (execModel && hasPrimaryCitation(execEvidence)) {
      const band = (exec as any)?.confidence?.sections?.business_model ?? (exec as any)?.confidence?.overall;
      structured.business_model = { value: execModel, confidence: confidenceBandToNumber(band), sources: execEvidence };
    }
  }

  // Priority: document-level extracted metrics from immutable inputs.
  type MetricHit = {
    document_id: string;
    key: string;
    value: unknown;
    unit: string | null;
    page: number | string;
    confidence: number;
  };
  const allMetrics: MetricHit[] = [];
  for (const doc of Array.isArray(dio.inputs?.documents) ? dio.inputs.documents : []) {
    const docId = (doc as any)?.document_id;
    if (typeof docId !== 'string') continue;
    const metrics = Array.isArray((doc as any).metrics) ? (doc as any).metrics : [];
    for (const m of metrics) {
      const key = typeof m?.key === 'string' ? m.key : '';
      if (!key) continue;
      const conf = typeof m?.confidence === 'number' && Number.isFinite(m.confidence) ? clamp01(m.confidence) : 0;
      allMetrics.push({
        document_id: docId,
        key,
        value: m?.value,
        unit: typeof m?.unit === 'string' ? m.unit : null,
        page: m?.page,
        confidence: conf,
      });
    }
  }

  const pickMetric = (predicate: (k: string) => boolean): MetricHit | null => {
    let best: MetricHit | null = null;
    for (const m of allMetrics) {
      const nk = normalizeMetricKey(m.key);
      if (!predicate(nk)) continue;
      if (!best || m.confidence > best.confidence) best = m;
    }
    return best;
  };

  const revenueMetric = pickMetric((k) => {
    const kn = normalizeMetricKey(k);
    const isMarketingAttributed =
      kn.includes('attributed') ||
      kn.includes('email') ||
      kn.includes('sms') ||
      kn.includes('campaign') ||
      kn.includes('paid media') ||
      kn.includes('roas') ||
      kn.includes('cac') ||
      kn.includes('conversion') ||
      kn.includes('marketing');
    if (isMarketingAttributed) return false;
    return kn.includes('arr') || kn.includes('mrr') || kn.includes('revenue') || kn.includes('sales') || kn.includes('gmv');
  });
  if (revenueMetric) {
    const keyNorm = normalizeMetricKey(revenueMetric.key);
    const period = keyNorm.includes('arr') ? 'ARR' : keyNorm.includes('mrr') ? 'MRR' : null;
    const money = parseMoneyLike(revenueMetric.value);
    structured.revenue = {
      value: { amount: money.amount, currency: money.currency ?? revenueMetric.unit ?? null, period, raw: money.raw },
      confidence: revenueMetric.confidence,
      sources: [
        {
          kind: 'input_metric',
          document_id: revenueMetric.document_id,
          page: revenueMetric.page,
          metric_key: revenueMetric.key,
          unit: revenueMetric.unit,
          confidence: revenueMetric.confidence,
        },
      ],
      selection_reason: 'input_metric_preferred',
      candidates: [
        {
          selected: true,
          score: revenueMetric.confidence,
          scope: 'input_metric',
          subtype: period ? String(period).toLowerCase() : null,
          year: null,
          value_raw: money.raw,
          amount: money.amount,
          currency: money.currency ?? revenueMetric.unit ?? null,
          confidence: revenueMetric.confidence,
          sources: [
            {
              kind: 'input_metric',
              document_id: revenueMetric.document_id,
              page: revenueMetric.page,
              metric_key: revenueMetric.key,
              unit: revenueMetric.unit,
              confidence: revenueMetric.confidence,
            },
          ],
        },
      ],
    };
  } else {
    const promotedRevenueTrace = (() => {
      // GOVERNANCE: canonical revenue (structured_summary.revenue / kpis.revenue) must represent
      // company-level revenue only. Marketing-attributed / channel-attributed revenue is allowed
      // elsewhere (marketing_metrics, performance KPIs, evidence), but it must NEVER compete for
      // canonical revenue selection.
      const isCanonicalRevenueEligible = (f: PromotedFactInput): boolean => {
        const ft = factTypeOf(f);
        if (ft === 'marketing_attributed_revenue_v1') return false;

        const vj = getPromotedValueJson(f) ?? {};
        const subtype = String((vj as any)?.subtype ?? '').toLowerCase();
        const scope = String((vj as any)?.scope ?? (f as any)?.content_json?.provenance?.scope ?? '').toLowerCase();

        // Hard exclusions
        if (scope === 'channel_attributed') return false;
        if (subtype === 'attributed') return false;

        // Forecast revenue is treated as growth/outlook, not canonical revenue.
        if (subtype === 'forecast') return false;

        return true;
      };

      const revenueFacts = promoted
        .filter((f) => factTypeOf(f) === 'revenue_v1')
        .filter((f) => isCanonicalRevenueEligible(f));
      if (revenueFacts.length === 0) return null;

      const disallowedSeg = new Set(['team', 'advisors', 'equipment']);
      const isOpportunityStyle = (t: string): boolean => {
        const s = t.toLowerCase();
        if (s.includes('opportunity')) return true;
        if (s.includes('annual opportunity')) return true;
        if (s.includes('within driving distance')) return true;
        if (s.includes('could be')) return true;
        if (s.includes('potential')) return true;
        if (s.includes('per year in retail revenue')) return true;
        if (s.includes('potential revenue')) return true;
        return false;
      };

      const currentYear = new Date().getFullYear();

      const getSubtype = (f: any): string | null => {
        const vj = getPromotedValueJson(f) ?? {};
        const s = asNonEmptyString((vj as any)?.subtype);
        return s ? s.toLowerCase() : null;
      };

      const getScope = (f: any): string | null => {
        const prov = f?.content_json?.provenance;
        const vj = getPromotedValueJson(f) ?? {};
        const v = asNonEmptyString((vj as any)?.scope);
        if (v) return v;
        const p = asNonEmptyString((prov as any)?.scope);
        return p ?? null;
      };

      const inferredScope = (f: any): 'company_financials_table' | 'company_total' | 'channel_attributed' => {
        const vj = getPromotedValueJson(f) ?? {};
        const subtype = String((vj as any)?.subtype ?? '').toLowerCase();
        const scopeRaw = String(getScope(f) ?? '').trim().toLowerCase();
        if (scopeRaw === 'company_financials_table') return 'company_financials_table';
        if (scopeRaw === 'channel_attributed') return 'channel_attributed';
        if (scopeRaw === 'company_total') return 'company_total';
        // Back-compat: if subtype explicitly says attributed, treat as channel-attributed.
        if (subtype === 'attributed') return 'channel_attributed';
        return 'company_total';
      };

      const buildCandidate = (f: any, scoreValue: number, selected: boolean): any => {
        const vj = getPromotedValueJson(f) ?? {};
        const display = asNonEmptyString((vj as any)?.display) ?? asNonEmptyString((vj as any)?.raw);
        const amountRaw = (vj as any)?.amount?.amount;
        const amount = typeof amountRaw === 'number' && Number.isFinite(amountRaw) ? amountRaw : null;
        const yearRaw = (vj as any)?.year;
        const year = typeof yearRaw === 'number' && Number.isFinite(yearRaw) ? yearRaw : null;
        const scope = asNonEmptyString((vj as any)?.scope) ?? asNonEmptyString((f as any)?.content_json?.provenance?.scope);
        const subtype = asNonEmptyString((vj as any)?.subtype);
        const sources = attachNoteSnippet(promotedSourcesFor(f), (vj as any)?.note_snippet);
        const conf = clamp01(typeof f?.confidence === 'number' ? f.confidence : 0.62);
        return {
          selected,
          score: scoreValue,
          scope: scope ?? inferredScope(f),
          subtype: subtype ?? getSubtype(f),
          year,
          value_raw: display,
          amount,
          currency: 'USD',
          confidence: conf,
          sources,
        };
      };

      const score = (f: any): number => {
        const prov = f?.content_json?.provenance;
        const title = String(prov?.slide_title ?? '').toLowerCase();
        const seg = String(prov?.segment_key ?? '').trim().toLowerCase();
        const vj = getPromotedValueJson(f) ?? {};
        const raw = String((vj as any)?.display ?? (vj as any)?.raw ?? '').toLowerCase();
        const note = String((vj as any)?.note_snippet ?? '').toLowerCase();
        const subtype = String((vj as any)?.subtype ?? '').toLowerCase();
        const scope = inferredScope(f);
        const yearRaw = (vj as any)?.year;
        const year = typeof yearRaw === 'number' && Number.isFinite(yearRaw) ? yearRaw : null;
        const titleIsFinancialOrPerformance = title.includes('financial') || title.includes('performance');

        // Exclude opportunity-style revenue.
        if (subtype === 'opportunity' || isOpportunityStyle(raw) || isOpportunityStyle(note)) return -1000;

        // Exclude irrelevant segments unless explicitly financial/performance.
        if (seg && disallowedSeg.has(seg) && !titleIsFinancialOrPerformance) return -500;

        let s = 0;
        if (scope === 'company_financials_table') s += 50;
        if (scope === 'company_total') s += 10;
        if (scope === 'channel_attributed') s -= 10;

        // Forecast revenue should never outrank completed-year revenue or attributed revenue.
        if (subtype === 'forecast') s -= 20;

        if (typeof year === 'number') {
          // Prefer recent completed years.
          if (year <= currentYear - 2) s += 10;
          s += Math.max(0, Math.min(6, year - (currentYear - 10)) * 0.2);
        }
        if (title.includes('business performance')) s += 12;
        if (title.includes('financial')) s += 10;
        if (title.includes('performance')) s += 9;
        if (title.includes('equipment')) s -= 15;
        if (seg === 'equipment') s -= 20;
        if (raw.includes('attributed') || note.includes('attributed')) s += 2;
        if (raw.includes('revenue') || note.includes('revenue')) s += 2;
        const conf = typeof f?.confidence === 'number' && Number.isFinite(f.confidence) ? f.confidence : 0;
        s += conf;
        return s;
      };

      const scored = revenueFacts
        .map((f: any) => ({ f, score: score(f) }))
        .filter((x: any) => typeof x.score === 'number' && Number.isFinite(x.score) && x.score >= -100);

      const sortedAll = scored
        .slice()
        .sort(
          (a: any, b: any) =>
            b.score - a.score ||
            String(b?.f?.extracted_at ?? '').localeCompare(String(a?.f?.extracted_at ?? ''))
        );

      const pickBest = (
        predicate: (f: any) => boolean,
        selection_reason: string
      ): { fact: PromotedFactInput; selection_reason: string } | null => {
        const hits = revenueFacts.filter((f: any) => predicate(f));
        if (hits.length === 0) return null;
        const sorted = hits
          .slice()
          .sort(
            (a: any, b: any) =>
              score(b) - score(a) ||
              String(b?.extracted_at ?? '').localeCompare(String(a?.extracted_at ?? ''))
          );
        const best = sorted[0];
        return score(best) < -100 ? null : { fact: best, selection_reason };
      };

      const pickBestFinancialTableAnnual = (): { fact: PromotedFactInput; selection_reason: string } | null => {
        const hits = revenueFacts.filter(
          (f: any) => inferredScope(f) === 'company_financials_table' && getSubtype(f) === 'annual'
        );
        if (hits.length === 0) return null;
        const sorted = hits
          .slice()
          .sort((a: any, b: any) => {
            const aYearRaw = (getPromotedValueJson(a) ?? {})?.year;
            const bYearRaw = (getPromotedValueJson(b) ?? {})?.year;
            const aYear = typeof aYearRaw === 'number' && Number.isFinite(aYearRaw) ? aYearRaw : null;
            const bYear = typeof bYearRaw === 'number' && Number.isFinite(bYearRaw) ? bYearRaw : null;
            if (aYear != null && bYear != null && aYear !== bYear) return bYear - aYear;
            return score(b) - score(a) || String(b?.extracted_at ?? '').localeCompare(String(a?.extracted_at ?? ''));
          });
        const best = sorted[0];
        return score(best) < -100 ? null : { fact: best, selection_reason: 'financial_table_preferred' };
      };

      // Canonical revenue preference order when no document input metrics exist.
      // 1) company_financials_table annual revenue (completed-year table row)
      // 2) company_total annual revenue (non-attributed)
      // Note: forecast revenue is intentionally excluded from canonical revenue.
      const picked = (
        pickBestFinancialTableAnnual() ??
        pickBest((f) => inferredScope(f) === 'company_total' && getSubtype(f) === 'annual', 'company_total_preferred') ??
        null
      );

      const chosen = picked ? picked.fact : null;
      const selection_reason = picked ? picked.selection_reason : null;

      const candidates = sortedAll
        .slice(0, 12)
        .map((x: any) => buildCandidate(x.f, x.score, chosen != null && x.f === chosen));

      // If we chose something excluded from sortedAll (shouldn't happen), still emit it as selected.
      if (chosen && !candidates.some((c: any) => c && c.selected)) {
        try {
          const sc = score(chosen);
          candidates.unshift(buildCandidate(chosen, sc, true));
        } catch {
          // ignore
        }
      }

      return { chosen, selection_reason, candidates };
    })();

    if (promotedRevenueTrace && promotedRevenueTrace.chosen) {
      const promotedRevenue = promotedRevenueTrace.chosen;
      const vj = getPromotedValueJson(promotedRevenue) ?? {};
      const display = asNonEmptyString((vj as any)?.display) ?? asNonEmptyString((vj as any)?.raw);
      const subtype = asNonEmptyString((vj as any)?.subtype);
      const scope = asNonEmptyString((vj as any)?.scope) ?? asNonEmptyString((promotedRevenue as any)?.content_json?.provenance?.scope);
      const yearRaw = (vj as any)?.year;
      const year = typeof yearRaw === 'number' && Number.isFinite(yearRaw) ? yearRaw : null;
      const amountRaw = (vj as any)?.amount?.amount;
      const amount = typeof amountRaw === 'number' && Number.isFinite(amountRaw) ? amountRaw : null;
      const sources = attachNoteSnippet(promotedSourcesFor(promotedRevenue), (vj as any)?.note_snippet);

      const label = (() => {
        const scopeNorm = String(scope ?? '').trim().toLowerCase();
        if (scopeNorm === 'channel_attributed' || subtype === 'attributed') return 'Attributed';
        if (scopeNorm === 'company_financials_table' && typeof year === 'number') return String(year);
        return null;
      })();

      structured.revenue = {
        value: { amount, currency: 'USD', period: null, raw: display },
        confidence: clamp01(typeof promotedRevenue.confidence === 'number' ? promotedRevenue.confidence : 0.62),
        sources,
        label,
        selection_reason: promotedRevenueTrace.selection_reason,
        candidates: Array.isArray(promotedRevenueTrace.candidates) ? promotedRevenueTrace.candidates : [],
      };
    } else {
    const fhRevenue = (dio as any)?.analyzer_results?.financial_health?.metrics?.revenue;
    if (typeof fhRevenue === 'number' && Number.isFinite(fhRevenue)) {
      structured.revenue = {
        value: { amount: fhRevenue, currency: null, period: 'annual', raw: null },
        confidence: clamp01((dio as any)?.analyzer_results?.financial_health?.confidence ?? 0.5),
        sources: [{ kind: 'financial_health.metrics', metric_key: 'revenue' }],
        selection_reason: 'financial_health_fallback',
        candidates: [
          {
            selected: true,
            score: clamp01((dio as any)?.analyzer_results?.financial_health?.confidence ?? 0.5),
            scope: 'financial_health',
            subtype: 'annual',
            year: null,
            value_raw: null,
            amount: fhRevenue,
            currency: null,
            confidence: clamp01((dio as any)?.analyzer_results?.financial_health?.confidence ?? 0.5),
            sources: [{ kind: 'financial_health.metrics', metric_key: 'revenue' }],
          },
        ],
      };
    }
    }
  }

  // Marketing-attributed revenue (must never be treated as canonical company revenue).
  // Surface it under structured_summary.marketing_metrics for inspection/debug/UI.
  {
    const attributedFacts = promoted.filter((f) => factTypeOf(f) === 'marketing_attributed_revenue_v1');
    if (attributedFacts.length > 0) {
      const best = attributedFacts
        .slice()
        .sort(
          (a: any, b: any) =>
            (typeof b?.confidence === 'number' ? b.confidence : 0) - (typeof a?.confidence === 'number' ? a.confidence : 0) ||
            String(b?.extracted_at ?? '').localeCompare(String(a?.extracted_at ?? ''))
        )[0];

      const vj = getPromotedValueJson(best) ?? {};
      const value_raw = asNonEmptyString((vj as any)?.display) ?? asNonEmptyString((vj as any)?.raw);
      const channel = asNonEmptyString((vj as any)?.channel) ?? asNonEmptyString((best as any)?.content_json?.provenance?.channel);
      const sources = attachNoteSnippet(promotedSourcesFor(best), (vj as any)?.note_snippet);

      structured.marketing_metrics = structured.marketing_metrics ?? {};
      structured.marketing_metrics.attributed_revenue = {
        value_raw,
        channel: channel ?? null,
        confidence: clamp01(typeof best?.confidence === 'number' ? best.confidence : 0.62),
        sources,
      };
    }
  }

  const customerMetric = pickMetric((k) =>
    k.includes('customer') || k === 'customers' || k.includes('users') || k.includes('subscriber') || k.includes('accounts')
  );
  if (customerMetric) {
    const raw = typeof customerMetric.value === 'string' ? customerMetric.value.trim() : null;
    const count = typeof customerMetric.value === 'number'
      ? customerMetric.value
      : raw
        ? parseScaledNumber(raw)
        : null;
    const kind = normalizeMetricKey(customerMetric.key).includes('user')
      ? 'users'
      : normalizeMetricKey(customerMetric.key).includes('subscriber')
        ? 'subscribers'
        : 'customers';
    structured.customers = {
      value: { count: typeof count === 'number' && Number.isFinite(count) ? count : null, kind, raw },
      confidence: customerMetric.confidence,
      sources: [
        {
          kind: 'input_metric',
          document_id: customerMetric.document_id,
          page: customerMetric.page,
          metric_key: customerMetric.key,
          unit: customerMetric.unit,
          confidence: customerMetric.confidence,
        },
      ],
    };
  } else {
    const promotedCustomers = (() => {
      const facts = promoted.filter((f) => factTypeOf(f) === 'customers_v1');
      if (facts.length === 0) return null;

      const disallowedSeg = new Set(['team', 'advisors']);
      const score = (f: any): number => {
        const prov = f?.content_json?.provenance;
        const title = String(prov?.slide_title ?? '').toLowerCase();
        const seg = String(prov?.segment_key ?? '').trim().toLowerCase();
        const vj = getPromotedValueJson(f) ?? {};
        const subtype = String((vj as any)?.subtype ?? '').toLowerCase();
        const note = String((vj as any)?.note_snippet ?? '').toLowerCase();
        const raw = String((vj as any)?.display ?? (vj as any)?.raw ?? '').toLowerCase();
        const conf = typeof f?.confidence === 'number' && Number.isFinite(f.confidence) ? f.confidence : 0;
        const sourcesAll = promotedSourcesFor(f);
        const primary = sourcesAll.find((s) => (s as any)?.evidence_role === 'primary') ?? null;
        const allowTeamWholesale = subtype === 'wholesale_accounts' && conf >= 0.55 && (primary as any)?.evidence_role === 'primary';
        if (seg && disallowedSeg.has(seg) && !allowTeamWholesale) return -500;
        let s = 0;
        if (title.includes('customers') || title.includes('traction') || title.includes('partners')) s += 3;
        if (raw.includes('serving') && raw.includes('retailer')) s += 4;
        if (note.includes('=') && note.includes('serving') && note.includes('retailer')) s += 3;
        if (seg && disallowedSeg.has(seg) && allowTeamWholesale) s -= 10;
        s += conf;
        return s;
      };

      const bestBySubtype = (subtype: string): PromotedFactInput | null => {
        const hits = facts.filter((f) => {
          const vj = getPromotedValueJson(f) ?? {};
          return asNonEmptyString((vj as any)?.subtype) === subtype;
        });
        if (hits.length === 0) return null;
        const sorted = hits.slice().sort((a: any, b: any) => score(b) - score(a) || String(b?.extracted_at ?? '').localeCompare(String(a?.extracted_at ?? '')));
        const best = sorted[0];
        return score(best) < -100 ? null : best;
      };

      return bestBySubtype('active') ?? bestBySubtype('wholesale_accounts') ?? (
        facts.slice().sort((a: any, b: any) => score(b) - score(a) || String(b?.extracted_at ?? '').localeCompare(String(a?.extracted_at ?? '')))[0] ?? null
      );
    })();
    if (promotedCustomers) {
      const vj = getPromotedValueJson(promotedCustomers) ?? {};
      const subtype = asNonEmptyString((vj as any)?.subtype);
      const display = asNonEmptyString((vj as any)?.display) ?? asNonEmptyString((vj as any)?.raw);
      const countRaw = (vj as any)?.count;
      const count = typeof countRaw === 'number' && Number.isFinite(countRaw) ? countRaw : null;
      const sources = attachNoteSnippet(promotedSourcesFor(promotedCustomers), (vj as any)?.note_snippet);
      structured.customers = {
        value: { count, kind: 'customers', raw: display },
        confidence: clamp01(typeof promotedCustomers.confidence === 'number' ? promotedCustomers.confidence : 0.62),
        sources,
        label: subtype && subtype !== 'active' ? (subtype === 'wholesale_accounts' ? 'Wholesale' : null) : null,
      };
    }
  }

  // Last-resort fallback: context strings from score explanation if present.
  const scoreExplanationAny = scoreExplanation ?? (dio as any)?.score_explanation;
  if (!structured.raise.value) {
    const raise = asNonEmptyString(scoreExplanationAny?.context?.raise);
    if (raise) {
      const normalized = normalizeRaiseFromTextOrAmount(raise);
      structured.raise = {
        value: normalized?.value ?? raise,
        value_json: normalized ? { amount: { amount: normalized.amount, currency: normalized.currency } } : undefined,
        round_label: normalized?.round_label ?? null,
        confidence: 0.55,
        sources: [{ kind: 'score_explanation.context', field: 'raise' }],
      };
    }
  }
  if (!structured.business_model.value) {
    const businessModel = asNonEmptyString(scoreExplanationAny?.context?.business_model);
    if (businessModel && isSpecificBusinessModelString(businessModel)) {
      structured.business_model = {
        value: businessModel,
        confidence: 0.55,
        sources: [{ kind: 'score_explanation.context', field: 'business_model' }],
      };
    }
  }

  // Deterministic summary derived from the structured KPIs.
  // Always present for persistence; may be refined by API-side node summaries.
  try {
    (structured as any).deal_summary_v1 = buildDeterministicDealSummaryV1FromStructuredSummary({
      structured_summary: structured,
    });
  } catch {
    // Best-effort: never fail report compilation.
  }

  // TopSection V1: score-driver summary (why is the score X?).
  // Separation contract: this is NEVER a company description.
  // Overview tab uses governed overlay; TopSection uses this deterministic field.
  try {
    if (scoreExplanation) {
      (structured as any).topsection_v1 = buildTopSectionV1FromScoreExplanation(
        scoreExplanation as ScoreExplanation,
      );
    }
  } catch {
    // Best-effort: never fail report compilation.
  }

  return structured;
}

function formatWhyThisScore(debug_scoring: any): string {
  if (!debug_scoring || !Array.isArray(debug_scoring.rules) || debug_scoring.rules.length === 0) return "";

  const inputs = Array.isArray(debug_scoring.inputs_used) ? debug_scoring.inputs_used.filter((x: any) => typeof x === "string") : [];
  const exclusion = typeof debug_scoring.exclusion_reason === "string" ? debug_scoring.exclusion_reason : null;

  const maxRules = 15;
  const rules = debug_scoring.rules.slice(0, maxRules);
  const ruleLines = rules
    .map((r: any) => {
      const id = typeof r?.rule_id === "string" ? r.rule_id : "rule";
      const desc = typeof r?.description === "string" ? r.description : "";
      const delta = typeof r?.delta === "number" ? r.delta : 0;
      const running = typeof r?.running_total === "number" ? r.running_total : 0;
      return `• ${id}: ${desc} (Δ ${delta}, total ${running})`;
    })
    .join("\n");

  const truncated = debug_scoring.rules.length > maxRules
    ? `\n• … (${debug_scoring.rules.length - maxRules} more rules omitted)`
    : "";

  const inputsLine = inputs.length > 0 ? `Inputs used: ${inputs.join(", ")}` : "Inputs used: (not provided)";
  const exclusionLine = exclusion ? `Exclusion reason: ${exclusion}` : "";
  const header = "\n\nWhy this score?\n";
  const body = `${inputsLine}${exclusionLine ? `\n${exclusionLine}` : ""}\nRules:\n${ruleLines}${truncated}`;
  return header + body;
}

/**
 * Compile DIO into ReportDTO for frontend display
 */
export function compileDIOToReport(dio: DIO): ReportDTO {
  const results = dio.analyzer_results;

  const existingExplanation = (dio as any).score_explanation;
  const scoreExplanation = existingExplanation ?? buildScoreExplanationFromDIO(dio);
  const persistedOverall = (dio as any).overall_score;

  // Back-compat safety: older persisted DIOs can carry an older score_explanation.
  // Ensure understanding_v1 always meets minimum completeness invariants (>=3 open items)
  // without requiring re-analysis.
  try {
    const se: any = scoreExplanation as any;
    const u: any = se?.understanding_v1;
    if (u && typeof u === 'object') {
      const list: any[] = Array.isArray(u.diligence_open_items) ? u.diligence_open_items : [];
      const normalized = list
        .filter((i) => i && typeof i === 'object')
        .map((i) => ({
          text: typeof (i as any).text === 'string' ? (i as any).text : '',
          evidence_ids: Array.isArray((i as any).evidence_ids) ? (i as any).evidence_ids : [],
          component_keys: Array.isArray((i as any).component_keys) ? (i as any).component_keys : [],
        }))
        .filter((i) => typeof i.text === 'string' && i.text.trim().length > 0);

      const existing = new Set(normalized.map((i) => i.text.trim()));
      const fallbacks: string[] = [
        'Confirm revenue (ARR/MRR or annual) and the period it covers.',
        'Provide unit economics (gross margin or contribution margin, CAC/LTV, payback) and retention/churn if applicable.',
        'Share burn, runway, and current cash balance (and whether financials are cash vs accrual).',
      ];

      while (normalized.length < 3) {
        const next = fallbacks.find((t) => !existing.has(t)) ?? null;
        if (!next) break;
        normalized.push({ text: next, evidence_ids: [], component_keys: ['system'] });
        existing.add(next);
      }

      u.diligence_open_items = normalized;
    }
  } catch {
    // ignore
  }
  
  const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const isOk = (status: unknown): status is 'ok' => status === 'ok';

  // Calculate overall score (status-aware + null-aware)
  const scores: number[] = [];

  if (isOk(results.slide_sequence?.status) && isFiniteNumber(results.slide_sequence?.score)) {
    scores.push(results.slide_sequence.score);
  }
  if (isOk(results.metric_benchmark?.status) && isFiniteNumber(results.metric_benchmark?.overall_score)) {
    scores.push(results.metric_benchmark.overall_score);
  }
  if (isOk(results.visual_design?.status) && isFiniteNumber(results.visual_design?.design_score)) {
    scores.push(results.visual_design.design_score);
  }
  if (isOk(results.narrative_arc?.status) && isFiniteNumber(results.narrative_arc?.pacing_score)) {
    scores.push(results.narrative_arc.pacing_score);
  }
  if (isOk(results.financial_health?.status) && isFiniteNumber(results.financial_health?.health_score)) {
    scores.push(results.financial_health.health_score);
  }
  if (isOk(results.risk_assessment?.status) && isFiniteNumber(results.risk_assessment?.overall_risk_score)) {
    // Invert risk score (lower risk = higher investment score)
    // If the analyzer ran but detected no explicit risks, treat it as neutral baseline (50).
    const ra = results.risk_assessment;
    const riskScore = results.risk_assessment.overall_risk_score;
    const noSignalRisk = riskScore === 0 && ra.total_risks === 0;
    scores.push(noSignalRisk ? 50 : (100 - riskScore));
  }

  const overallScoreComputed: number | null = scores.length > 0
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : null;

  const explanationOverall = (scoreExplanation as any)?.totals?.overall_score;

  const computeOverallFromExplanation = (se: any): number | null => {
    if (!se || typeof se !== 'object') return null;
    const weights = se?.aggregation?.weights && typeof se.aggregation.weights === 'object' ? se.aggregation.weights : null;
    const components = se?.components && typeof se.components === 'object' ? se.components : null;
    if (!components) return null;

    const keys = Object.keys(components);
    if (keys.length === 0) return null;

    const pairs: Array<{ key: string; w: number; eff: number }> = [];
    for (const key of keys) {
      const comp = components[key];
      if (!comp || typeof comp !== 'object') continue;
      const used = typeof comp.used_score === 'number' && Number.isFinite(comp.used_score) ? comp.used_score : null;
      const penalty = typeof comp.penalty === 'number' && Number.isFinite(comp.penalty) ? comp.penalty : 0;
      if (used == null) continue;
      const eff = Math.max(0, Math.min(100, used - penalty));
      const wRaw = weights && typeof weights[key] === 'number' && Number.isFinite(weights[key]) ? weights[key] : null;
      pairs.push({ key, w: wRaw ?? 1, eff });
    }

    if (pairs.length === 0) return null;
    const totalW = pairs.reduce((s, p) => s + p.w, 0);
    if (!(totalW > 0)) {
      const avg = pairs.reduce((s, p) => s + p.eff, 0) / pairs.length;
      return Math.round(avg);
    }
    const weighted = pairs.reduce((s, p) => s + (p.w / totalW) * p.eff, 0);
    return Math.round(weighted);
  };

  const explanationFallback = computeOverallFromExplanation(scoreExplanation);
  const overallScoreNullable: number | null = (typeof persistedOverall === 'number' && Number.isFinite(persistedOverall))
    ? persistedOverall
    : (typeof explanationOverall === 'number' && Number.isFinite(explanationOverall))
      ? explanationOverall
      : (typeof explanationFallback === 'number' && Number.isFinite(explanationFallback))
        ? explanationFallback
        : overallScoreComputed;

  const scoreAvailable = typeof overallScoreNullable === 'number' && Number.isFinite(overallScoreNullable);
  const overallScoreFinal = scoreAvailable ? Math.round(overallScoreNullable) : 0;

  const includedCount = scoreExplanation && (scoreExplanation as any).components
    ? Object.values((scoreExplanation as any).components)
      .filter((c: any) => c && typeof c === 'object' && c.status === 'ok')
      .length
    : scores.length;

  let grade: ReportDTO['grade'] = scoreAvailable ? scoreToGrade(overallScoreFinal) : 'Needs Improvement';
  if (includedCount < 3) {
    grade = 'Insufficient Information';
  }
  const recommendation = scoreAvailable ? scoreToRecommendation(overallScoreFinal) : 'pass';
  
  // Extract category scores
  const categories = [];
  
  // Presentation Quality
  if (results.slide_sequence || results.visual_design) {
    const slideScore = results.slide_sequence?.score ?? null;
    const visualScore = results.visual_design?.design_score ?? null;
    const available = [slideScore, visualScore].filter((v): v is number => typeof v === 'number');
    if (available.length > 0) {
      const avgScore = Math.round(available.reduce((a, b) => a + b, 0) / available.length);
      categories.push({
        name: 'Presentation Quality',
        score: avgScore,
        maxScore: 100,
        color: '#3b82f6',
        issues: results.visual_design?.weaknesses || [],
        strengths: results.visual_design?.strengths || [],
        recommendations: []
      });
    }
  }
  
  // Business Metrics
  if (results.metric_benchmark?.overall_score != null) {
    categories.push({
      name: 'Business Metrics',
      score: Math.round(results.metric_benchmark.overall_score),
      maxScore: 100,
      color: '#8b5cf6',
      issues: [],
      strengths: [],
      recommendations: []
    });
  }
  
  // Narrative Quality
  if (results.narrative_arc?.pacing_score != null) {
    categories.push({
      name: 'Narrative & Story',
      score: Math.round(results.narrative_arc.pacing_score),
      maxScore: 100,
      color: '#f59e0b',
      issues: [],
      strengths: [`Story archetype: ${results.narrative_arc.archetype}`],
      recommendations: []
    });
  }
  
  // Financial Health
  if (results.financial_health?.health_score != null) {
    const risks = results.financial_health.risks || [];
    categories.push({
      name: 'Financial Health',
      score: Math.round(results.financial_health.health_score),
      maxScore: 100,
      color: '#10b981',
      issues: risks.map(r => r.description),
      strengths: results.financial_health.runway_months 
        ? [`Runway: ${results.financial_health.runway_months} months`]
        : [],
      recommendations: []
    });
  }
  
  // Risk Assessment
  if (results.risk_assessment?.overall_risk_score != null) {
    const allRisks = [
      ...(results.risk_assessment.risks_by_category?.market || []),
      ...(results.risk_assessment.risks_by_category?.team || []),
      ...(results.risk_assessment.risks_by_category?.financial || []),
      ...(results.risk_assessment.risks_by_category?.execution || []),
    ];
    
    const investmentScore = 100 - results.risk_assessment.overall_risk_score;
    
    categories.push({
      name: 'Risk Assessment',
      score: Math.round(investmentScore),
      maxScore: 100,
      color: '#ef4444',
      issues: allRisks.map(r => `[${r.severity}] ${r.description}`),
      strengths: [],
      recommendations: allRisks.filter(r => r.mitigation).map(r => r.mitigation!)
    });
  }
  
  // Identify red flags
  const redFlags: Array<{ severity: 'high' | 'medium' | 'low'; message: string; action: string }> = [];
  if (results.risk_assessment) {
    const allRisks = [
      ...(results.risk_assessment.risks_by_category?.market || []),
      ...(results.risk_assessment.risks_by_category?.team || []),
      ...(results.risk_assessment.risks_by_category?.financial || []),
      ...(results.risk_assessment.risks_by_category?.execution || []),
    ];
    
    for (const risk of allRisks) {
      const severity: 'high' | 'medium' | 'low' = 
        risk.severity === 'critical' || risk.severity === 'high' ? 'high' :
        risk.severity === 'medium' ? 'medium' : 'low';
      
      redFlags.push({
        severity,
        message: risk.description,
        action: risk.mitigation || 'Monitor closely'
      });
    }
  }
  
  // Identify green flags (strengths)
  const greenFlags: string[] = [];
  if (results.visual_design?.strengths) {
    greenFlags.push(...results.visual_design.strengths);
  }
  if (results.metric_benchmark) {
    const strong = results.metric_benchmark.metrics_analyzed.filter(m => m.rating === 'Strong');
    if (strong.length > 0) {
      greenFlags.push(`${strong.length} strong business metrics`);
    }
  }
  
  // Build report sections
  const sections: ReportSection[] = [];

  const structuredSummary = buildStructuredSummary(dio, scoreExplanation, undefined);
  const canonicalRevenueDisplay = revenueDisplayFromStructuredSummary(structuredSummary);

  const fundingStage = inferFundingStageModelV1({
    funding_round_label: null,
    company_phase_label: (dio as any)?.dio?.phase_inference_v1?.company_phase ?? null,
    raise_amount: parseMoneyLike(structuredSummary?.raise?.value ?? null).amount ?? null,
    raise_sources: Array.isArray(structuredSummary?.raise?.sources)
      ? structuredSummary.raise.sources.map((s: any) => ({
          document_id: s?.source_document_id ?? s?.document_id ?? undefined,
          page_index: typeof s?.page_index === 'number' ? s.page_index : undefined,
          page: typeof s?.page === 'number' ? s.page : undefined,
          source_path: s?.source_path ?? undefined,
        }))
      : null,
  });
  
  // Executive Summary
  const overallScoreText = scoreAvailable ? `${overallScoreFinal}/100 (${grade})` : 'N/A (insufficient data)';
  sections.push({
    id: 'executive-summary',
    title: 'Executive Summary',
    content: `Overall Score: ${overallScoreText}\\n\\nRecommendation: ${recommendation.replace('_', ' ').toUpperCase()}\\n\\nBased on analysis of ${scores.length} evaluation dimensions.`,
    evidence_ids: []
  });
  
  // Detailed sections for each analyzer
  if (results.slide_sequence) {
    const deviations = results.slide_sequence.deviations || [];
    const seqScoreText = results.slide_sequence.score == null ? 'N/A' : `${results.slide_sequence.score}/100`;
    sections.push({
      id: 'slide-sequence',
      title: 'Presentation Structure',
      content: `Score: ${seqScoreText}\n\nPattern: ${results.slide_sequence.pattern_match}\n\n` +
        (deviations.length > 0 
          ? `Deviations:\\n${deviations.map(d => `• ${d.actual} at position ${d.position} (expected: ${d.expected})`).join('\\n')}`
          : 'Follows expected structure') +
        formatWhyThisScore((results.slide_sequence as any).debug_scoring),
      evidence_ids: results.slide_sequence.evidence_ids,
      metrics: results.slide_sequence.score == null
        ? undefined
        : [{ label: 'Sequence Score', value: results.slide_sequence.score, evidence_ids: results.slide_sequence.evidence_ids }]
    });
  }

  if (results.metric_benchmark) {
    const mb = results.metric_benchmark;
    const mbScoreText = mb.overall_score == null ? 'N/A' : `${mb.overall_score}/100`;
    const analyzed = Array.isArray(mb.metrics_analyzed) ? mb.metrics_analyzed : [];
    const rawContent =
      `Score: ${mbScoreText}\n\n` +
      (analyzed.length > 0
        ? `Metrics Analyzed:\\n${analyzed
            .slice(0, 8)
            .map((m: any) => `• ${m.metric}: ${m.value} vs ${m.benchmark_value} (${m.rating})`)
            .join('\\n')}`
        : 'No metrics analyzed') +
      formatWhyThisScore((mb as any).debug_scoring);
    sections.push({
      id: 'metric-benchmark',
      title: 'Business Metrics',
      content: applyRevenueOverrideToMetricBenchmarkContent(rawContent, canonicalRevenueDisplay),
      evidence_ids: mb.evidence_ids,
      metrics: mb.overall_score == null
        ? undefined
        : [{ label: 'Metrics Score', value: mb.overall_score, evidence_ids: mb.evidence_ids }]
    });
  }

  if (results.visual_design) {
    const vd = results.visual_design;
    const vdScoreText = vd.design_score == null ? 'N/A' : `${vd.design_score}/100`;
    sections.push({
      id: 'visual-design',
      title: 'Visual Design',
      content: `Score: ${vdScoreText}\n\n` +
        (Array.isArray(vd.strengths) && vd.strengths.length > 0 ? `Strengths:\\n${vd.strengths.slice(0, 6).map((s: string) => `• ${s}`).join('\\n')}\\n\\n` : '') +
        (Array.isArray(vd.weaknesses) && vd.weaknesses.length > 0 ? `Weaknesses:\\n${vd.weaknesses.slice(0, 6).map((s: string) => `• ${s}`).join('\\n')}` : '') +
        formatWhyThisScore((vd as any).debug_scoring),
      evidence_ids: vd.evidence_ids,
      metrics: vd.design_score == null
        ? undefined
        : [{ label: 'Design Score', value: vd.design_score, evidence_ids: vd.evidence_ids }]
    });
  }

  if (results.narrative_arc) {
    const na = results.narrative_arc;
    const pacingText = na.pacing_score == null ? 'N/A' : `${na.pacing_score}/100`;
    sections.push({
      id: 'narrative-arc',
      title: 'Narrative & Story',
      content: `Pacing Score: ${pacingText}\n\nArchetype: ${na.archetype} (${Math.round((na.archetype_confidence ?? 0) * 100)}% confidence)\n\n` +
        (Array.isArray(na.emotional_beats) && na.emotional_beats.length > 0
          ? `Emotional Beats:\\n${na.emotional_beats.slice(0, 8).map((b: any) => `• ${b.section}: ${b.emotion} (${Math.round((b.strength ?? 0) * 100)}%)`).join('\\n')}`
          : 'No emotional beats detected') +
        formatWhyThisScore((na as any).debug_scoring),
      evidence_ids: na.evidence_ids,
      metrics: na.pacing_score == null
        ? undefined
        : [{ label: 'Pacing Score', value: na.pacing_score, evidence_ids: na.evidence_ids }]
    });
  }
  
  if (results.financial_health) {
    const fh = results.financial_health;
    const healthScoreText = fh.health_score == null ? 'N/A' : `${fh.health_score}/100`;
    sections.push({
      id: 'financial-health',
      title: 'Financial Health',
      content: `Health Score: ${healthScoreText}\n\n` +
        (fh.runway_months ? `Runway: ${fh.runway_months} months\\n` : '') +
        (fh.burn_multiple ? `Burn Multiple: ${fh.burn_multiple.toFixed(2)}x\\n` : '') +
        (fh.risks.length > 0 
          ? `\\nRisks:\\n${fh.risks.map(r => `• [${r.severity}] ${r.description}`).join('\\n')}`
          : '') +
        formatWhyThisScore((fh as any).debug_scoring),
      evidence_ids: fh.evidence_ids,
      metrics: fh.health_score == null
        ? undefined
        : [{ label: 'Health Score', value: fh.health_score, evidence_ids: fh.evidence_ids }]
    });
  }
  
  if (results.risk_assessment) {
    const ra = results.risk_assessment;
    const allRisks = [
      ...ra.risks_by_category.market,
      ...ra.risks_by_category.team,
      ...ra.risks_by_category.financial,
      ...ra.risks_by_category.execution,
    ];
    const riskScoreText = ra.overall_risk_score == null ? 'N/A' : `${ra.overall_risk_score}/100`;
    
    sections.push({
      id: 'risk-assessment',
      title: 'Risk Assessment',
      content: `Risk Score: ${riskScoreText}\n` +
        `Total Risks: ${ra.total_risks} (Critical: ${ra.critical_count}, High: ${ra.high_count})\\n\\n` +
        `Risks by Category:\\n` +
        `• Market: ${ra.risks_by_category.market.length}\\n` +
        `• Team: ${ra.risks_by_category.team.length}\\n` +
        `• Financial: ${ra.risks_by_category.financial.length}\\n` +
        `• Execution: ${ra.risks_by_category.execution.length}\\n\\n` +
        `Top Risks:\\n${allRisks.slice(0, 5).map(r => `• [${r.severity}] ${r.description}`).join('\\n')}` +
        formatWhyThisScore((ra as any).debug_scoring),
      evidence_ids: ra.evidence_ids,
      metrics: ra.overall_risk_score == null
        ? undefined
        : [{ label: 'Risk Score', value: ra.overall_risk_score, evidence_ids: ra.evidence_ids }]
    });
  }
  
  // Recommendation
  sections.push({
    id: 'recommendation',
    title: 'Investment Recommendation',
    content: `Recommendation: ${recommendation.replace('_', ' ').toUpperCase()}\\n\\n` +
      `Overall Score: ${scoreAvailable ? `${overallScoreFinal}/100` : 'N/A'}\\n` +
      `Grade: ${grade}\\n\\n` +
      (greenFlags.length > 0 ? `Strengths:\\n${greenFlags.map(f => `• ${f}`).join('\\n')}\\n\\n` : '') +
      (redFlags.length > 0 ? `Concerns:\\n${redFlags.slice(0, 3).map(f => `• ${f.message}`).join('\\n')}` : ''),
    evidence_ids: []
  });
  
  const financialCoverage = inferFinancialCoverageProfileV1({
    structured_summary: structuredSummary,
    promoted_facts: null,
    documents: Array.isArray((dio as any)?.inputs?.documents)
      ? (dio as any).inputs.documents.map((d: any) => ({
          document_id: d?.document_id,
          kind: d?.kind,
          mime_type: d?.mime_type,
          filename: d?.filename,
        }))
      : null,
  });

  const capitalLogic = inferCapitalLogicProfileV1({
    structured_summary: structuredSummary,
    promoted_facts: null,
  });

  const businessModelSignal = inferBusinessModelSignalProfileV1({
    structured_summary: structuredSummary,
    promoted_facts: null,
  });

  const marketAccessibilitySignal = inferMarketAccessibilitySignalProfileV1({
    structured_summary: structuredSummary,
    promoted_facts: null,
  });

  const tractionSignal = inferTractionSignalProfileV1({
    financial_coverage_v1: financialCoverage,
    structured_summary: structuredSummary,
    promoted_facts: null,
  });

  const teamSignal = inferTeamSignalProfileV1({
    structured_summary: structuredSummary,
    promoted_facts: null,
  });

  const stageExpectations = inferStageExpectationsProfileV1({
    funding_stage_v1: fundingStage,
    financial_coverage_v1: financialCoverage,
    capital_logic_v1: capitalLogic,
  });

  const stageWeighted = scoreStageWeightedV1(
    buildStageWeightedScoreInputsV1({
      funding_stage_v1: fundingStage,
      financial_coverage_v1: financialCoverage,
      capital_logic_v1: capitalLogic,
      stage_expectations_v1: stageExpectations,
      business_model_signal_v1: businessModelSignal,
      market_accessibility_signal_v1: marketAccessibilitySignal,
      traction_signal_v1: tractionSignal,
      team_signal_v1: teamSignal,
      structured_summary: structuredSummary,
    }),
  );

  const scoreExplanationAugmented = scoreExplanation && typeof scoreExplanation === 'object'
    ? ({
        ...(scoreExplanation as any),
        stage_weighted_v1: stageWeighted,
      } as any)
    : scoreExplanation;

  return {
    dealId: dio.deal_id,
    generatedAt: new Date().toISOString(),
    version: dio.analysis_version,

    overallScore: overallScoreFinal,
    funding_stage_v1: fundingStage,
    financial_coverage_v1: financialCoverage,
    capital_logic_v1: capitalLogic,
    stage_expectations_v1: stageExpectations,
    business_model_signal_v1: businessModelSignal,
    market_accessibility_signal_v1: marketAccessibilitySignal,
    traction_signal_v1: tractionSignal,
    team_signal_v1: teamSignal,
    structured_summary: structuredSummary,
    grade,
    recommendation,
    
    categories,
    redFlags,
    greenFlags,
    
    sections,
    
    completeness: calculateCompleteness(dio),
    metadata: {
      analysisCount: scores.length,
      evidenceCount: dio.inputs.evidence.length,
      documentCount: dio.inputs.documents.length,
      scoreAvailable,
      scoreConfidence: scoreExplanation?.totals?.confidence_score,
      score_explanation: scoreExplanationAugmented,
    }
  };
}

/**
 * Inject XLSX-derived revenue facts into structured_summary.revenue.
 *
 * Uses selectAuthoritativeFact to choose the single best fact, ensuring
 * year-header corruption and projected overrides are rejected before
 * the value is written into the structured summary.
 *
 * All other xlsx revenue candidates are preserved in the candidates list for
 * audit trails. Deck-derived candidates keep their existing selected=false state.
 */
function injectXlsxRevenueIntoStructuredSummary(structuredSummary: any, financialFacts: FinancialFactV1[]): void {
  const REVENUE_KEYS = ['revenue', 'arr', 'mrr'];

  // Strip corrupted facts before any consideration.
  const cleanFacts = filterCorruptedFacts(financialFacts);

  // Collect all xlsx-sourced revenue facts with valid positive currency values.
  const xlsxRevenue = cleanFacts.filter(
    (f) =>
      REVENUE_KEYS.includes(f.metric_key) &&
      f.source_kind === 'xlsx' &&
      f.unit === 'currency' &&
      f.value > 0
  );
  if (xlsxRevenue.length === 0) return;

  const confidenceNum = (c: FinancialFactV1['confidence']): number =>
    c === 'high' ? 0.85 : c === 'medium' ? 0.65 : 0.45;

  // Authoritative selection: prefer realized over projected, then by rank.
  const best = selectAuthoritativeFact(REVENUE_KEYS, xlsxRevenue, { requireNonProjected: true })
    ?? selectAuthoritativeFact(REVENUE_KEYS, xlsxRevenue);

  if (!best) return;
  const bestConf = confidenceNum(best.confidence);

  const buildXlsxCandidate = (f: FinancialFactV1, selected: boolean) => {
    const yearMatch = f.period_label.match(/\b(20\d{2})\b/);
    return {
      selected,
      score: confidenceNum(f.confidence),
      scope: 'company_financials_table',
      subtype: isProjectedFact(f) ? 'forecast' : 'annual',
      year: yearMatch ? Number(yearMatch[1]) : null,
      value_raw: formatUsdShort(f.value),
      amount: f.value,
      currency: f.currency ?? 'USD',
      confidence: confidenceNum(f.confidence),
      sources: [{ kind: 'xlsx', document_id: f.document_id, metric_key: f.metric_key, period_label: f.period_label }],
    };
  };

  // Mark the authoritative selection; all other xlsx candidates are shown as alternatives.
  const xlsxCandidates = xlsxRevenue.map((f) => buildXlsxCandidate(f, f === best));

  const currentRevenue = structuredSummary?.revenue;
  const currentConf = typeof currentRevenue?.confidence === 'number' ? currentRevenue.confidence : 0;

  if (!currentRevenue || currentRevenue.value == null || bestConf >= currentConf) {
    // XLSX fact wins: use it as the primary selection, keep existing deck candidates for audit.
    structuredSummary.revenue = {
      value: {
        amount: best.value,
        currency: best.currency ?? 'USD',
        period: best.period_label ?? null,
        raw: formatUsdShort(best.value),
      },
      confidence: bestConf,
      sources: [{ kind: 'xlsx', document_id: best.document_id, metric_key: best.metric_key, period_label: best.period_label }],
      label: best.period_label ?? null,
      selection_reason: 'xlsx_financial_fact',
      candidates: [
        ...xlsxCandidates,
        ...(Array.isArray(currentRevenue?.candidates) ? currentRevenue.candidates.map((c: any) => ({ ...c, selected: false })) : []),
      ],
    };
  } else {
    // Deck fact wins on confidence: preserve deck selection but append xlsx candidates.
    if (!structuredSummary.revenue) return;
    const existing = Array.isArray(structuredSummary.revenue.candidates)
      ? structuredSummary.revenue.candidates
      : [];
    structuredSummary.revenue.candidates = [...existing, ...xlsxCandidates.map((c) => ({ ...c, selected: false }))];
  }
}

export function compileDIOToReportWithPromotedFacts(dio: DIO, opts?: { promotedFacts?: PromotedFactInput[]; financialFacts?: FinancialFactV1[] | null }): ReportDTO {
	const scoreExplanation = buildScoreExplanationFromDIO(dio as any);
	const base = compileDIOToReport(dio);
  const structuredSummary = buildStructuredSummary(dio, scoreExplanation, opts?.promotedFacts ?? undefined);

  // Inject XLSX-derived revenue facts before revenue display string is computed.
  if (opts?.financialFacts && opts.financialFacts.length > 0) {
    injectXlsxRevenueIntoStructuredSummary(structuredSummary, opts.financialFacts);
  }

  const revenueDisplay = revenueDisplayFromStructuredSummary(structuredSummary) ?? revenueDisplayFromPromotedFacts(opts?.promotedFacts);
  const sections = revenueDisplay
    ? base.sections.map((s) => (s.id === 'metric-benchmark' ? { ...s, content: applyRevenueOverrideToMetricBenchmarkContent(s.content, revenueDisplay) } : s))
    : base.sections;

  const fundingStage = inferFundingStageModelV1({
    funding_round_label: null,
    company_phase_label: (dio as any)?.dio?.phase_inference_v1?.company_phase ?? null,
    raise_amount: parseMoneyLike(structuredSummary?.raise?.value ?? null).amount ?? null,
    raise_sources: Array.isArray(structuredSummary?.raise?.sources)
      ? structuredSummary.raise.sources.map((s: any) => ({
          document_id: s?.source_document_id ?? s?.document_id ?? undefined,
          page_index: typeof s?.page_index === 'number' ? s.page_index : undefined,
          page: typeof s?.page === 'number' ? s.page : undefined,
          source_path: s?.source_path ?? undefined,
        }))
      : null,
  });

  const financialCoverage = inferFinancialCoverageProfileV1({
    structured_summary: structuredSummary,
    promoted_facts: Array.isArray(opts?.promotedFacts) ? opts!.promotedFacts : null,
    financial_facts: Array.isArray(opts?.financialFacts) ? opts!.financialFacts as FinancialFactV1[] : null,
    documents: Array.isArray((dio as any)?.inputs?.documents)
      ? (dio as any).inputs.documents.map((d: any) => ({
          document_id: d?.document_id,
          kind: d?.kind,
          mime_type: d?.mime_type,
          filename: d?.filename,
        }))
      : null,
  });

  const financialBreakdown = buildFinancialBreakdownV1({
    financial_facts: Array.isArray(opts?.financialFacts) ? (opts!.financialFacts as FinancialFactV1[]) : [],
    financial_coverage_v1: financialCoverage,
    structured_summary: structuredSummary,
    documents: Array.isArray((dio as any)?.inputs?.documents)
      ? (dio as any).inputs.documents.map((d: any) => ({
          document_id: d?.document_id,
          kind: d?.kind,
          filename: d?.filename,
        }))
      : null,
  });

  const underwritingReadiness = buildUnderwritingReadinessV1({
    financial_breakdown_v1: financialBreakdown,
    financial_coverage_v1: financialCoverage,
  });

  const capitalLogic = inferCapitalLogicProfileV1({
    structured_summary: structuredSummary,
    promoted_facts: Array.isArray(opts?.promotedFacts) ? opts!.promotedFacts : null,
  });

  const businessModelSignal = inferBusinessModelSignalProfileV1({
    structured_summary: structuredSummary,
    promoted_facts: Array.isArray(opts?.promotedFacts) ? opts!.promotedFacts : null,
  });

  const marketAccessibilitySignal = inferMarketAccessibilitySignalProfileV1({
    structured_summary: structuredSummary,
    promoted_facts: Array.isArray(opts?.promotedFacts) ? opts!.promotedFacts : null,
  });

  const tractionSignal = inferTractionSignalProfileV1({
    financial_coverage_v1: financialCoverage,
    structured_summary: structuredSummary,
    promoted_facts: Array.isArray(opts?.promotedFacts) ? opts!.promotedFacts : null,
  });

  const teamSignal = inferTeamSignalProfileV1({
    structured_summary: structuredSummary,
    promoted_facts: Array.isArray(opts?.promotedFacts) ? opts!.promotedFacts : null,
  });

  const stageExpectations = inferStageExpectationsProfileV1({
    funding_stage_v1: fundingStage,
    financial_coverage_v1: financialCoverage,
    capital_logic_v1: capitalLogic,
  });

  const stageWeighted = scoreStageWeightedV1(
    buildStageWeightedScoreInputsV1({
      funding_stage_v1: fundingStage,
      financial_coverage_v1: financialCoverage,
      capital_logic_v1: capitalLogic,
      stage_expectations_v1: stageExpectations,
      business_model_signal_v1: businessModelSignal,
      market_accessibility_signal_v1: marketAccessibilitySignal,
      traction_signal_v1: tractionSignal,
      team_signal_v1: teamSignal,
      structured_summary: structuredSummary,
    }),
  );

  const existingExplanation: any = (base as any)?.metadata?.score_explanation;
  const scoreExplanationAugmented = existingExplanation && typeof existingExplanation === 'object'
    ? { ...existingExplanation, stage_weighted_v1: stageWeighted }
    : existingExplanation;

  // Pass through financial integrity result from DIO (fail-open: never fail report compilation).
  let financialIntegrityV1: FinancialIntegrityV1 | null = null;
  try {
    financialIntegrityV1 = (dio as any)?.dio?.financial_integrity_v1 ?? null;
  } catch {
    // Best-effort: never fail report compilation.
  }

	return {
		...base,
    funding_stage_v1: fundingStage,
    financial_coverage_v1: financialCoverage,
    financial_breakdown_v1: financialBreakdown,
    underwriting_readiness_v1: underwritingReadiness,
    capital_logic_v1: capitalLogic,
    stage_expectations_v1: stageExpectations,
    business_model_signal_v1: businessModelSignal,
    market_accessibility_signal_v1: marketAccessibilitySignal,
    traction_signal_v1: tractionSignal,
    team_signal_v1: teamSignal,
    structured_summary: structuredSummary,
    sections,
    financial_integrity_v1: financialIntegrityV1,

		metadata: {
			...(base as any).metadata,
			score_explanation: scoreExplanationAugmented,
		},
	};
}

/**
 * Helper functions
 */

function scoreToGrade(score: number): 'Excellent' | 'Good' | 'Fair' | 'Needs Improvement' {
  if (score >= 85) return 'Excellent';
  if (score >= 70) return 'Good';
  if (score >= 55) return 'Fair';
  return 'Needs Improvement';
}

function scoreToRecommendation(score: number): 'strong_yes' | 'yes' | 'consider' | 'pass' {
  if (score >= 85) return 'strong_yes';
  if (score >= 70) return 'yes';
  if (score >= 55) return 'consider';
  return 'pass';
}

function calculateCompleteness(dio: DIO): number {
  const results = dio.analyzer_results;
  let fieldsPresent = 0;
  const totalFields = 6;
  
  if (results.slide_sequence) fieldsPresent++;
  if (results.metric_benchmark) fieldsPresent++;
  if (results.visual_design) fieldsPresent++;
  if (results.narrative_arc) fieldsPresent++;
  if (results.financial_health) fieldsPresent++;
  if (results.risk_assessment) fieldsPresent++;
  
  return Math.round((fieldsPresent / totalFields) * 100);
}
