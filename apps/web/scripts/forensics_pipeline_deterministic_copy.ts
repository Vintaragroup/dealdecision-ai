#!/usr/bin/env node
/*
Pipeline-wide forensics: deterministic copy quality vs evidence + governed overlay.

Run (local):
  tsx apps/web/scripts/forensics_pipeline_deterministic_copy.ts --api-base-url http://localhost:9001

Optional env:
  ADMIN_TOKEN=...   # Bearer token for API

Outputs:
  - artifacts/forensics/pipeline_deterministic_copy.jsonl
  - artifacts/forensics/pipeline_deterministic_copy_report.md
*/

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';

type DealRow = {
  id: string;
  name?: string | null;
  stage?: string | null;
  priority?: string | null;
  trend?: string | null;
  owner?: string | null;
  created_at?: string | null;
  createdAt?: string | null;
  updated_at?: string | null;
  updatedAt?: string | null;
  created_by?: string | null;
  created_by_user_id?: string | null;
  created_by_system?: boolean | null;
};

type SourceRef = {
  source_document_id?: string;
  document_id?: string;
  page_index?: number;
  page?: number;
  slide_title?: string | null;
  snippet?: string | null;
  segment_key?: string | null;
  segment?: string | null;
  section_key?: string | null;
  kind?: string | null;
};

type DealSummaryLine = {
  text?: string | null;
  display_text?: string | null;
  quality?: string | null;
  suppressed_reasons?: string[] | null;
  sources?: SourceRef[];
};

type DealSummaryV1 = {
  ready?: boolean;
  version?: string;
  tiers?: { hero?: string | null; overview?: string | null; deep?: string | null };
  one_liner?: DealSummaryLine | null;
  product?: DealSummaryLine | null;
  market?: DealSummaryLine | null;
  market_target?: DealSummaryLine | null;
  market_context?: DealSummaryLine | null;
  warnings?: unknown;
};

type DeterministicReportEnvelope = {
  ready?: boolean;
  reason?: string | null;
  version?: number;
  artifact?: unknown;
  report?: any;
};

type GovernedOverlayEnvelope = {
  overview?: any;
};

type TextMetrics = {
  value: string | null;
  length: number;
  token_count: number;
  numeric_token_pct: number;
  symbol_char_pct: number;
  repeated_space: boolean;
  markers: string[];
  sentence_like_score: number;
  duplication_score: number;
  separators_score: number;
  basis_guess: 'snippet' | 'slide_title' | 'mixed' | 'unknown' | 'none';
  evidence: {
    has_sources: boolean;
    sources_count: number;
    unique_pages: number;
    avg_slide_title_len: number;
    avg_snippet_len: number;
    segment_key_counts: Record<string, number>;
  };
  class: 'GOOD' | 'OK' | 'GARBAGE' | 'MISSING';
  reasons: string[];
};

type AfterFieldStatus = 'displayable' | 'suppressed' | 'missing' | 'present_but_unrated';

type AfterFieldMetrics = {
  status: AfterFieldStatus;
  display_text: string | null;
  text: string | null;
  quality: string | null;
  suppressed_reasons: string[];
  triggers: string[];
};

type DealForensicsRow = {
  deal: {
    id: string;
    name: string | null;
    stage: string | null;
    created_at: string | null;
    updated_at: string | null;
  };
  excluded_reason?: string | null;
  deterministic: {
    report_ready: boolean;
    report_reason: string | null;
    deal_summary_ready: boolean | null;
    // AFTER uses API semantics (display_text + quality + suppression metadata)
    after_fields: Record<string, AfterFieldMetrics>;
    // Tiers don't currently include suppression semantics; keep heuristic metrics for reference.
    tiers_fields: Record<string, TextMetrics>;
    // BASELINE uses aggressive heuristic classifier on the longest sources[].snippet per field.
    baseline_snippet_fields: Record<string, TextMetrics>;
    structured_summary_keys: string[];
    warnings: unknown;
  };
  governed: {
    present: boolean;
    created_at: string | null;
    llm_phase_mode: string | null;
    summary_text_len: number | null;
    pr2: {
      product_solution: string | null;
      market_icp: string | null;
      business_model: string | null;
      raise: string | null;
      one_liner: string | null;
      paragraphs_len: number | null;
      sources_count: number | null;
    };
  };
};

type AggregateCounts = {
  included: number;
  excluded: number;
  report_ready: number;
  deal_summary_ready: number;
  afterByFieldStatus: Record<string, Record<AfterFieldStatus, number>>;
  baselineByField: Record<string, Record<TextMetrics['class'], number>>;
  topAfterTriggers: Record<string, number>;
  topBaselineTriggers: Record<string, number>;
  baselineBasisCounts: Record<string, number>;
  baselineSegmentKeyCounts: Record<string, number>;
};

const args = process.argv.slice(2);
const getArg = (name: string): string | null => {
  const idx = args.indexOf(name);
  if (idx < 0) return null;
  const v = args[idx + 1];
  return typeof v === 'string' && v.length > 0 ? v : null;
};

const API_BASE_URL = (getArg('--api-base-url') ?? process.env.API_BASE_URL ?? 'http://localhost:9001').replace(/\/$/, '');
const OUT_JSONL = getArg('--out-jsonl') ?? 'artifacts/forensics/pipeline_deterministic_copy.jsonl';
const OUT_MD = getArg('--out-md') ?? 'artifacts/forensics/pipeline_deterministic_copy_report.md';
const CONCURRENCY = Math.max(1, Math.min(12, Number(getArg('--concurrency') ?? process.env.CONCURRENCY ?? '6') || 6));
const LIMIT = Number(getArg('--limit') ?? process.env.LIMIT ?? '0') || 0;

const AUTH_TOKEN = process.env.ADMIN_TOKEN || process.env.VITE_ADMIN_TOKEN || '';

const fetchJson = async <T>(path: string): Promise<T> => {
  const url = `${API_BASE_URL}${path}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      ...(AUTH_TOKEN ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {}),
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GET ${url} -> ${res.status}: ${text.slice(0, 500)}`);
  }
  return (await res.json()) as T;
};

const asNonEmptyString = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s.length > 0 ? s : null;
};

const normWs = (s: string): string => s.replace(/\s+/g, ' ').trim();

const looksLikeMigrationTestDeal = (deal: DealRow): { exclude: boolean; reason: string | null } => {
  const name = (deal.name ?? '').toString();
  const stage = (deal.stage ?? '').toString();

  const lowered = `${name} ${stage}`.toLowerCase();
  const banned = ['migration', 'test', 'seed', 'dummy', 'sample', 'zz_', 'tmp'];
  for (const token of banned) {
    if (lowered.includes(token)) return { exclude: true, reason: `name_or_stage_contains:${token}` };
  }

  // Some internal/non-pipeline stages (best effort; safe if stage is unknown).
  const nonRealStageTokens = ['archived', 'deleted', 'sandbox', 'internal'];
  for (const token of nonRealStageTokens) {
    if (lowered.includes(token)) return { exclude: true, reason: `non_real_stage:${token}` };
  }

  // System markers.
  if (deal.created_by_system === true) return { exclude: true, reason: 'created_by_system' };
  if ((deal.created_by ?? '').toLowerCase().includes('system')) return { exclude: true, reason: 'created_by:system' };

  return { exclude: false, reason: null };
};

const tokenize = (s: string): string[] => normWs(s).split(/\s+/g).filter(Boolean);

const countSymbolChars = (s: string): number => {
  let n = 0;
  for (const ch of s) {
    if (/\s/.test(ch)) continue;
    if (/[a-zA-Z0-9]/.test(ch)) continue;
    n += 1;
  }
  return n;
};

const markersForText = (s: string): string[] => {
  const out: string[] = [];
  const t = s.toLowerCase();
  const add = (key: string, re: RegExp) => {
    if (re.test(t)) out.push(key);
  };

  add('visa_mastercard', /visa\s*\/\s*mastercard|from\s+visa\s*\/\s*mastercard/);
  add('copyright', /copyright|all\s+rights\s+reserved|©/);
  add('boilerplate_disclaimer', /forward[-\s]?looking|confidential|do\s+not\s+distribute/);
  add('url', /https?:\/\/|www\./);
  add('email', /\b\w+@\w+\./);
  add('slide_header', /\bagenda\b|\bcontents\b|\bsummary\b|\bteam\b|\bmarket\b|\btraction\b/);
  add('too_many_pipes', /\|\s*\w+\s*\|\s*\w+/);
  add('table_like', /\b(\d+\s*%|\$\s*\d|€\s*\d)\b.*\b(\d+\s*%|\$\s*\d|€\s*\d)\b/);

  return out;
};

const separatorsScore = (s: string): number => {
  const pipes = (s.match(/\|/g) ?? []).length;
  const colons = (s.match(/:/g) ?? []).length;
  const bullets = (s.match(/[•\u2022\-–—]\s/g) ?? []).length;
  return pipes * 2 + colons + bullets;
};

const duplicationScore = (s: string): number => {
  const toks = tokenize(s.toLowerCase());
  if (toks.length < 12) return 0;

  const grams = new Map<string, number>();
  for (let i = 0; i < toks.length - 2; i++) {
    const g = `${toks[i]} ${toks[i + 1]} ${toks[i + 2]}`;
    grams.set(g, (grams.get(g) ?? 0) + 1);
  }
  let max = 0;
  for (const v of grams.values()) max = Math.max(max, v);
  // Normalize: 1 means all trigrams same; 0 means no repeats.
  const denom = Math.max(1, toks.length - 2);
  return max / denom;
};

const sentenceLikeScore = (s: string): number => {
  const t = s.toLowerCase();
  const hasPunct = /[.!?]/.test(s);
  const hasComma = /,/.test(s);
  const hasVerb = /\b(is|are|was|were|has|have|had|builds|built|sell|sells|selling|provide|provides|enables|helps|allow|offers|serves|targets|delivers)\b/.test(t);
  let score = 0;
  if (hasPunct) score += 0.5;
  if (hasComma) score += 0.1;
  if (hasVerb) score += 0.4;
  return Math.min(1, score);
};

const basisGuess = (value: string | null, sources: SourceRef[] | undefined): TextMetrics['basis_guess'] => {
  if (!value) return 'none';
  const srcs = Array.isArray(sources) ? sources : [];
  if (srcs.length === 0) return 'none';

  const v = normWs(value).toLowerCase();
  let slideMatches = 0;
  let snippetMatches = 0;
  for (const s of srcs) {
    const st = asNonEmptyString(s.slide_title)?.toLowerCase() ?? null;
    const sn = asNonEmptyString(s.snippet)?.toLowerCase() ?? null;
    if (st && (v === normWs(st) || v.includes(normWs(st).slice(0, 50)))) slideMatches += 1;
    if (sn && (v === normWs(sn) || v.includes(normWs(sn).slice(0, 50)))) snippetMatches += 1;
  }
  if (slideMatches > 0 && snippetMatches === 0) return 'slide_title';
  if (snippetMatches > 0 && slideMatches === 0) return 'snippet';
  if (slideMatches > 0 && snippetMatches > 0) return 'mixed';
  return 'unknown';
};

const evidenceMetrics = (sources: SourceRef[] | undefined) => {
  const srcs = Array.isArray(sources) ? sources : [];
  const pages = new Set<string>();
  let slideTitleLenSum = 0;
  let slideTitleLenN = 0;
  let snippetLenSum = 0;
  let snippetLenN = 0;
  const segment_key_counts: Record<string, number> = {};

  for (const s of srcs) {
    const doc = (s.source_document_id ?? s.document_id ?? 'unknown').toString();
    const page = Number.isFinite(s.page_index) ? Number(s.page_index) : Number.isFinite(s.page) ? Number(s.page) : null;
    if (page != null) pages.add(`${doc}#${page}`);

    const st = asNonEmptyString(s.slide_title);
    if (st) {
      slideTitleLenSum += normWs(st).length;
      slideTitleLenN += 1;
    }

    const sn = asNonEmptyString(s.snippet);
    if (sn) {
      snippetLenSum += normWs(sn).length;
      snippetLenN += 1;
    }

    const seg = asNonEmptyString(s.segment_key) ?? asNonEmptyString(s.segment) ?? asNonEmptyString(s.section_key) ?? 'unknown';
    segment_key_counts[seg] = (segment_key_counts[seg] ?? 0) + 1;
  }

  return {
    has_sources: srcs.length > 0,
    sources_count: srcs.length,
    unique_pages: pages.size,
    avg_slide_title_len: slideTitleLenN ? slideTitleLenSum / slideTitleLenN : 0,
    avg_snippet_len: snippetLenN ? snippetLenSum / snippetLenN : 0,
    segment_key_counts,
  };
};

// AFTER-only heuristic classifier (kept with existing thresholds) for fields without API suppression semantics (e.g., tiers.*).
const classifyAfterHeuristicText = (value: string | null, sources: SourceRef[] | undefined): Omit<TextMetrics, 'value' | 'evidence'> & { evidence: TextMetrics['evidence'] } => {
  const s0 = value ? normWs(value) : '';
  const s = s0.length > 0 ? s0 : '';
  const evidence = evidenceMetrics(sources);

  if (!s) {
    return {
      length: 0,
      token_count: 0,
      numeric_token_pct: 0,
      symbol_char_pct: 0,
      repeated_space: false,
      markers: [],
      sentence_like_score: 0,
      duplication_score: 0,
      separators_score: 0,
      basis_guess: evidence.has_sources ? basisGuess(value, sources) : 'none',
      class: 'MISSING',
      reasons: ['empty_or_null'],
      evidence,
    };
  }

  const tokens = tokenize(s);
  const numericTokens = tokens.filter((t) => /\d/.test(t)).length;
  const symbolChars = countSymbolChars(s);
  const symbolCharPct = s.length > 0 ? symbolChars / s.length : 0;
  const markers = markersForText(s);
  const dup = duplicationScore(s);
  const sep = separatorsScore(s);
  const sent = sentenceLikeScore(s);
  const repeatedSpace = / {2,}/.test(value ?? '');
  const basis = basisGuess(s, sources);

  const numericTokenPct = tokens.length > 0 ? numericTokens / tokens.length : 0;

  const reasons: string[] = [];
  let cls: TextMetrics['class'] = 'GOOD';

  if (!evidence.has_sources) reasons.push('no_sources');
  if (basis === 'slide_title') reasons.push('basis_slide_title');
  if (basis === 'snippet') reasons.push('basis_snippet');
  if (basis === 'mixed') reasons.push('basis_mixed');
  if (markers.length) reasons.push(...markers.map((m) => `marker:${m}`));
  if (numericTokenPct >= 0.25) reasons.push('numeric_heavy');
  if (symbolCharPct >= 0.22) reasons.push('symbol_heavy');
  if (sep >= 8) reasons.push('separator_heavy');
  if (dup >= 0.25) reasons.push('duplication');
  if (sent < 0.4) reasons.push('low_sentence_score');

  const looksLikeGarbage =
    markers.includes('visa_mastercard') ||
    markers.includes('copyright') ||
    markers.includes('too_many_pipes') ||
    s.length > 220 ||
    (sep >= 10 && sent < 0.4) ||
    (numericTokenPct >= 0.35 && symbolCharPct >= 0.18) ||
    (basis === 'slide_title' && evidence.avg_slide_title_len >= 90);

  if (looksLikeGarbage) {
    cls = 'GARBAGE';
  } else if (s.length > 140 || sep >= 6 || numericTokenPct >= 0.22 || symbolCharPct >= 0.18) {
    cls = 'OK';
  }

  return {
    length: s.length,
    token_count: tokens.length,
    numeric_token_pct: Number(numericTokenPct.toFixed(3)),
    symbol_char_pct: Number(symbolCharPct.toFixed(3)),
    repeated_space: repeatedSpace,
    markers,
    sentence_like_score: Number(sent.toFixed(3)),
    duplication_score: Number(dup.toFixed(3)),
    separators_score: sep,
    basis_guess: basis,
    class: cls,
    reasons: Array.from(new Set(reasons)),
    evidence,
  };
};

const countLetters = (s: string): number => (s.match(/[A-Za-z]/g) ?? []).length;
const countVowels = (s: string): number => (s.match(/[aeiouAEIOU]/g) ?? []).length;
const countDigits = (s: string): number => (s.match(/[0-9]/g) ?? []).length;

// BASELINE-only classifier (more aggressive) intended to flag OCR soup in snippets.
// Returns `class` plus `reasons[]` which we treat as triggers in the report.
const classifyText = (value: string | null, sources: SourceRef[] | undefined): Omit<TextMetrics, 'value' | 'evidence'> & { evidence: TextMetrics['evidence'] } => {
  const s0 = value ? normWs(value) : '';
  const s = s0.length > 0 ? s0 : '';
  const evidence = evidenceMetrics(sources);

  if (!s) {
    return {
      length: 0,
      token_count: 0,
      numeric_token_pct: 0,
      symbol_char_pct: 0,
      repeated_space: false,
      markers: [],
      sentence_like_score: 0,
      duplication_score: 0,
      separators_score: 0,
      basis_guess: evidence.has_sources ? basisGuess(value, sources) : 'none',
      class: 'MISSING',
      reasons: ['empty_or_null'],
      evidence,
    };
  }

  const tokens = tokenize(s);
  const numericTokens = tokens.filter((t) => /\d/.test(t)).length;
  const symbolChars = countSymbolChars(s);
  const symbolCharPct = s.length > 0 ? symbolChars / s.length : 0;
  const digitChars = countDigits(s);
  const digitCharPct = s.length > 0 ? digitChars / s.length : 0;
  const markers = markersForText(s);
  const dup = duplicationScore(s);
  const sep = separatorsScore(s);
  const sent = sentenceLikeScore(s);
  const repeatedSpace = / {2,}/.test(value ?? '');
  const basis = basisGuess(s, sources);

  const letters = countLetters(s);
  const vowels = countVowels(s);
  const vowelPct = letters > 0 ? vowels / letters : 0;
  const spacePct = s.length > 0 ? (s.match(/\s/g) ?? []).length / s.length : 0;

  const numericTokenPct = tokens.length > 0 ? numericTokens / tokens.length : 0;

  const allCapsTokens = tokens.filter((t) => /^[A-Z0-9][A-Z0-9'&./\-]{2,}$/.test(t)).length;
  const allCapsTokenPct = tokens.length > 0 ? allCapsTokens / tokens.length : 0;
  const punctRuns = /[._\-]{6,}|[.]{4,}|[=]{4,}|[~]{3,}/.test(s);

  const reasons: string[] = [];
  let cls: TextMetrics['class'] = 'GOOD';

  if (!evidence.has_sources) reasons.push('no_sources');
  if (basis === 'slide_title') reasons.push('basis_slide_title');
  if (basis === 'snippet') reasons.push('basis_snippet');
  if (basis === 'mixed') reasons.push('basis_mixed');
  if (markers.length) reasons.push(...markers.map((m) => `marker:${m}`));
  if (numericTokenPct >= 0.22) reasons.push('numeric_heavy');
  if (digitCharPct >= 0.18) reasons.push('digit_char_heavy');
  if (symbolCharPct >= 0.15) reasons.push('symbol_heavy');
  if (sep >= 8) reasons.push('separator_heavy');
  if (dup >= 0.25) reasons.push('duplication');
  if (sent < 0.45) reasons.push('low_sentence_score');
  if (vowelPct < 0.22 && spacePct < 0.08 && s.length >= 80) reasons.push('low_word_likeness');
  if (allCapsTokenPct >= 0.55 && tokens.length >= 10) reasons.push('title_dump');
  if (punctRuns) reasons.push('punctuation_runs');
  if (s.length >= 180) reasons.push('very_long');

  const boilerplateMarker = markers.includes('boilerplate_disclaimer') || markers.includes('copyright') || markers.includes('url') || markers.includes('email');

  const looksLikeGarbage =
    markers.includes('visa_mastercard') ||
    markers.includes('too_many_pipes') ||
    boilerplateMarker ||
    s.length >= 220 ||
    symbolCharPct >= 0.2 ||
    digitCharPct >= 0.22 ||
    (sep >= 10 && sent < 0.5) ||
    (numericTokenPct >= 0.3 && symbolCharPct >= 0.14) ||
    reasons.includes('low_word_likeness') ||
    reasons.includes('title_dump') ||
    reasons.includes('punctuation_runs');

  if (looksLikeGarbage) {
    cls = 'GARBAGE';
  } else if (s.length > 140 || sep >= 6 || numericTokenPct >= 0.2 || symbolCharPct >= 0.14) {
    cls = 'OK';
  }

  return {
    length: s.length,
    token_count: tokens.length,
    numeric_token_pct: Number(numericTokenPct.toFixed(3)),
    symbol_char_pct: Number(symbolCharPct.toFixed(3)),
    repeated_space: repeatedSpace,
    markers,
    sentence_like_score: Number(sent.toFixed(3)),
    duplication_score: Number(dup.toFixed(3)),
    separators_score: sep,
    basis_guess: basis,
    class: cls,
    reasons: Array.from(new Set(reasons)),
    evidence,
  };
};

const pLimit = (concurrency: number) => {
  let active = 0;
  const queue: Array<() => void> = [];

  const next = () => {
    active -= 1;
    const fn = queue.shift();
    if (fn) fn();
  };

  const run = async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= concurrency) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active += 1;
    try {
      return await fn();
    } finally {
      next();
    }
  };

  return run;
};

const extractDealSummaryV1 = (env: DeterministicReportEnvelope): DealSummaryV1 | null => {
  const report = (env as any)?.report ?? (env as any)?.report?.report ?? (env as any)?.artifact?.report ?? null;
  if (!report || typeof report !== 'object') return null;
  const ds = (report as any).deal_summary ?? (report as any).deal_summary_v1 ?? (report as any).structured_summary?.deal_summary_v1 ?? null;
  if (!ds || typeof ds !== 'object') return null;
  return ds as DealSummaryV1;
};

const extractStructuredSummary = (env: DeterministicReportEnvelope): any | null => {
  const report = (env as any)?.report ?? null;
  if (!report || typeof report !== 'object') return null;
  const ss = (report as any).structured_summary;
  return ss && typeof ss === 'object' ? ss : null;
};

const pickDisplayText = (line: any): string | null => {
  if (!line) return null;
  // New deterministic semantics: prefer display_text, fall back to legacy text, then to string line.
  return asNonEmptyString(line.display_text ?? line.text ?? line);
};

const longestSnippet = (sources?: SourceRef[]): string | null => {
  if (!Array.isArray(sources) || sources.length === 0) return null;
  let best: string | null = null;
  for (const s of sources) {
    const sn = asNonEmptyString(s?.snippet ?? null);
    if (!sn) continue;
    if (!best || sn.length > best.length) best = sn;
  }
  return best;
};

const normalizeQuality = (q: unknown): string | null => {
  const s = asNonEmptyString(q ?? null);
  return s ? s.toLowerCase() : null;
};

const computeAfterField = (raw: unknown): AfterFieldMetrics => {
  if (raw == null) {
    return {
      status: 'missing',
      display_text: null,
      text: null,
      quality: null,
      suppressed_reasons: [],
      triggers: ['missing:no_field'],
    };
  }

  // Legacy edge case: field is a string rather than an object.
  if (typeof raw === 'string') {
    const v = asNonEmptyString(raw);
    if (!v) {
      return {
        status: 'missing',
        display_text: null,
        text: null,
        quality: null,
        suppressed_reasons: [],
        triggers: ['missing:empty_string'],
      };
    }
    return {
      status: 'present_but_unrated',
      display_text: v,
      text: v,
      quality: null,
      suppressed_reasons: [],
      triggers: ['present_but_unrated:legacy_string'],
    };
  }

  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      status: 'present_but_unrated',
      display_text: null,
      text: null,
      quality: null,
      suppressed_reasons: [],
      triggers: ['present_but_unrated:unknown_shape'],
    };
  }

  const obj: any = raw;
  const displayText = asNonEmptyString(obj.display_text ?? null);
  const text = asNonEmptyString(obj.text ?? null);
  const quality = normalizeQuality(obj.quality ?? null);
  const suppressedReasons = Array.isArray(obj.suppressed_reasons)
    ? obj.suppressed_reasons.map((x: any) => asNonEmptyString(x)).filter(Boolean)
    : [];

  const triggers: string[] = [];
  if (quality) triggers.push(`quality:${quality}`);
  for (const r of suppressedReasons) triggers.push(`suppressed_reason:${r}`);

  const suppressed = !displayText && (suppressedReasons.length > 0 || quality === 'garbage');
  const missing = !displayText && !text && suppressedReasons.length === 0 && !quality;

  if (suppressed) {
    return {
      status: 'suppressed',
      display_text: null,
      text,
      quality,
      suppressed_reasons: suppressedReasons,
      triggers: triggers.length ? triggers : ['suppressed:unknown'],
    };
  }

  if (missing) {
    return {
      status: 'missing',
      display_text: null,
      text: null,
      quality,
      suppressed_reasons: suppressedReasons,
      triggers: ['missing:empty_no_semantics'],
    };
  }

  if (displayText && (quality === 'good' || quality === 'ok')) {
    return {
      status: 'displayable',
      display_text: displayText,
      text,
      quality,
      suppressed_reasons: suppressedReasons,
      triggers,
    };
  }

  if (displayText && !quality) triggers.push('present_but_unrated:no_quality');
  if (!displayText && text) triggers.push('present_but_unrated:text_only');
  if (!displayText && quality && quality !== 'garbage') triggers.push('present_but_unrated:quality_without_display');
  if (displayText && quality && quality !== 'good' && quality !== 'ok') triggers.push('present_but_unrated:unexpected_quality');

  return {
    status: 'present_but_unrated',
    display_text: displayText,
    text,
    quality,
    suppressed_reasons: suppressedReasons,
    triggers,
  };
};

const pullDeterministicForensics = (env: DeterministicReportEnvelope) => {
  const ds = extractDealSummaryV1(env);
  const ss = extractStructuredSummary(env);
  const structuredKeys = ss && typeof ss === 'object' ? Object.keys(ss) : [];

  const tiersHero = asNonEmptyString((ds as any)?.tiers?.hero ?? (ds as any)?.hero ?? null);
  const tiersOverview = asNonEmptyString((ds as any)?.tiers?.overview ?? (ds as any)?.overview ?? null);
  const tiersDeep = asNonEmptyString((ds as any)?.tiers?.deep ?? (ds as any)?.deep ?? null);

  const oneLinerRaw = (ds as any)?.one_liner;
  const oneLinerText = pickDisplayText(oneLinerRaw);
  const oneLinerSources = Array.isArray((ds as any)?.one_liner?.sources) ? ((ds as any).one_liner.sources as SourceRef[]) : undefined;
  const oneLinerSnippet = longestSnippet(oneLinerSources);

  const productRaw = (ds as any)?.product;
  const productText = pickDisplayText(productRaw);
  const productSources = Array.isArray((ds as any)?.product?.sources) ? ((ds as any).product.sources as SourceRef[]) : undefined;
  const productSnippet = longestSnippet(productSources);

  const marketRaw = (ds as any)?.market;
  const marketText = pickDisplayText(marketRaw);
  const marketSources = Array.isArray((ds as any)?.market?.sources) ? ((ds as any).market.sources as SourceRef[]) : undefined;
  const marketSnippet = longestSnippet(marketSources);

  const marketTargetRaw = (ds as any)?.market_target;
  const marketTargetText = pickDisplayText(marketTargetRaw);
  const marketTargetSources = Array.isArray((ds as any)?.market_target?.sources) ? ((ds as any).market_target.sources as SourceRef[]) : undefined;
  const marketTargetSnippet = longestSnippet(marketTargetSources);

  const marketContextRaw = (ds as any)?.market_context;
  const marketContextText = pickDisplayText(marketContextRaw);
  const marketContextSources = Array.isArray((ds as any)?.market_context?.sources) ? ((ds as any).market_context.sources as SourceRef[]) : undefined;
  const marketContextSnippet = longestSnippet(marketContextSources);

  const warnings = (ds as any)?.warnings ?? (env as any)?.warnings ?? null;

  const tiers_fields: Record<string, TextMetrics> = {
    'tiers.hero': {
      value: tiersHero,
      ...classifyAfterHeuristicText(tiersHero, undefined),
    },
    'tiers.overview': {
      value: tiersOverview,
      ...classifyAfterHeuristicText(tiersOverview, undefined),
    },
    'tiers.deep': {
      value: tiersDeep,
      ...classifyAfterHeuristicText(tiersDeep, undefined),
    },
  };

  const after_fields: Record<string, AfterFieldMetrics> = {
    'one_liner.text': computeAfterField(oneLinerRaw),
    'product.text': computeAfterField(productRaw),
    'market.text': computeAfterField(marketRaw),
    'market_target.text': computeAfterField(marketTargetRaw),
    'market_context.text': computeAfterField(marketContextRaw),
  };

  const baseline_snippet_fields: Record<string, TextMetrics> = {
    'one_liner.text': {
      value: oneLinerSnippet,
      ...classifyText(oneLinerSnippet, oneLinerSources),
    },
    'product.text': {
      value: productSnippet,
      ...classifyText(productSnippet, productSources),
    },
    'market.text': {
      value: marketSnippet,
      ...classifyText(marketSnippet, marketSources),
    },
    'market_target.text': {
      value: marketTargetSnippet,
      ...classifyText(marketTargetSnippet, marketTargetSources),
    },
    'market_context.text': {
      value: marketContextSnippet,
      ...classifyText(marketContextSnippet, marketContextSources),
    },
  };

  return {
    report_ready: Boolean((env as any)?.ready === true),
    report_reason: asNonEmptyString((env as any)?.reason ?? null),
    deal_summary_ready: typeof ds?.ready === 'boolean' ? ds.ready : null,
    after_fields,
    tiers_fields,
    baseline_snippet_fields,
    structured_summary_keys: structuredKeys,
    warnings,
  };
};

const pullGovernedForensics = (env: GovernedOverlayEnvelope) => {
  const ov = (env as any)?.overview ?? null;
  if (!ov || typeof ov !== 'object') {
    return {
      present: false,
      created_at: null,
      llm_phase_mode: null,
      summary_text_len: null,
      pr2: {
        product_solution: null,
        market_icp: null,
        business_model: null,
        raise: null,
        one_liner: null,
        paragraphs_len: null,
        sources_count: null,
      },
    };
  }

  const overviewJson = (ov as any)?.overview_json;
  const phase1 = overviewJson?.phase1;
  const dealOverviewV2 = phase1?.deal_overview_v2;
  const dealSummaryV2 = phase1?.deal_summary_v2;

  const sourcesCount = Array.isArray(dealOverviewV2?.sources) ? dealOverviewV2.sources.length : null;
  const oneLiner = asNonEmptyString(dealSummaryV2?.summary?.one_liner ?? null);
  const paragraphsLen = Array.isArray(dealSummaryV2?.summary?.paragraphs) ? dealSummaryV2.summary.paragraphs.length : null;

  return {
    present: true,
    created_at: asNonEmptyString(ov.created_at ?? null),
    llm_phase_mode: asNonEmptyString(ov.llm_phase_mode ?? null),
    summary_text_len: typeof ov.summary_text === 'string' ? ov.summary_text.length : null,
    pr2: {
      product_solution: asNonEmptyString(dealOverviewV2?.product_solution ?? null),
      market_icp: asNonEmptyString(dealOverviewV2?.market_icp ?? null),
      business_model: asNonEmptyString(dealOverviewV2?.business_model ?? null),
      raise: asNonEmptyString(dealOverviewV2?.raise ?? null),
      one_liner: oneLiner,
      paragraphs_len: paragraphsLen,
      sources_count: sourcesCount,
    },
  };
};

const fmtPct = (n: number, d: number) => {
  if (d <= 0) return '0%';
  return `${((n / d) * 100).toFixed(1)}%`;
};

const initAgg = (): AggregateCounts => ({
  included: 0,
  excluded: 0,
  report_ready: 0,
  deal_summary_ready: 0,
  afterByFieldStatus: {},
  baselineByField: {},
  topAfterTriggers: {},
  topBaselineTriggers: {},
  baselineBasisCounts: {},
  baselineSegmentKeyCounts: {},
});

const bump = (m: Record<string, number>, k: string, n = 1) => {
  m[k] = (m[k] ?? 0) + n;
};

const initClassCounts = (): Record<TextMetrics['class'], number> => ({ GOOD: 0, OK: 0, GARBAGE: 0, MISSING: 0 });

const initStatusCounts = (): Record<AfterFieldStatus, number> => ({
  displayable: 0,
  suppressed: 0,
  missing: 0,
  present_but_unrated: 0,
});

const updateAgg = (agg: AggregateCounts, row: DealForensicsRow) => {
  agg.included += 1;
  if (row.deterministic.report_ready) agg.report_ready += 1;
  if (row.deterministic.deal_summary_ready) agg.deal_summary_ready += 1;

  for (const [fieldKey, af] of Object.entries(row.deterministic.after_fields)) {
    agg.afterByFieldStatus[fieldKey] = agg.afterByFieldStatus[fieldKey] ?? initStatusCounts();
    agg.afterByFieldStatus[fieldKey][af.status] += 1;
    for (const t of af.triggers) bump(agg.topAfterTriggers, `${fieldKey}:${t}`);
  }

  for (const [fieldKey, tm] of Object.entries(row.deterministic.baseline_snippet_fields)) {
    agg.baselineByField[fieldKey] = agg.baselineByField[fieldKey] ?? initClassCounts();
    agg.baselineByField[fieldKey][tm.class] += 1;

    bump(agg.baselineBasisCounts, `${fieldKey}:${tm.basis_guess}`);
    for (const r of tm.reasons) bump(agg.topBaselineTriggers, `${fieldKey}:${r}`);
    for (const [seg, n] of Object.entries(tm.evidence.segment_key_counts)) {
      bump(agg.baselineSegmentKeyCounts, `${fieldKey}:${seg}`, n);
    }
  }
};

const buildReportMd = (agg: AggregateCounts, rows: DealForensicsRow[], excluded: Array<{ id: string; name: string | null; reason: string }>) => {
  const lines: string[] = [];
  lines.push(`# Pipeline deterministic copy forensics`);
  lines.push('');
  lines.push(`API base: ${API_BASE_URL}`);
  lines.push('');
  lines.push(`- Total deals fetched: ${agg.included + agg.excluded}`);
  lines.push(`- Excluded (migration/test heuristics): ${agg.excluded}`);
  lines.push(`- Included (pipeline set): ${agg.included}`);
  lines.push(`- Deterministic report ready: ${agg.report_ready} (${fmtPct(agg.report_ready, agg.included)})`);
  lines.push(`- Deterministic deal_summary_v1 ready: ${agg.deal_summary_ready} (${fmtPct(agg.deal_summary_ready, agg.included)})`);
  lines.push('');

  const keyFields = ['one_liner.text', 'product.text', 'market_target.text', 'market_context.text', 'market.text'] as const;
  const totalKey = agg.included * keyFields.length;
  const pct = (n: number, d: number) => (d <= 0 ? '0.0%' : `${((n / d) * 100).toFixed(1)}%`);

  const baselineDisplayable = keyFields.reduce((acc, k) => acc + ((agg.baselineByField[k]?.GOOD ?? 0) + (agg.baselineByField[k]?.OK ?? 0)), 0);
  const baselineGarbage = keyFields.reduce((acc, k) => acc + (agg.baselineByField[k]?.GARBAGE ?? 0), 0);

  const afterDisplayable = keyFields.reduce((acc, k) => acc + (agg.afterByFieldStatus[k]?.displayable ?? 0), 0);
  const afterSuppressed = keyFields.reduce((acc, k) => acc + (agg.afterByFieldStatus[k]?.suppressed ?? 0), 0);
  const afterMissing = keyFields.reduce((acc, k) => acc + (agg.afterByFieldStatus[k]?.missing ?? 0), 0);

  lines.push('## Before/after summary (baseline snippet vs API semantics)');
  lines.push('');
  lines.push('| Metric | baseline_displayable% | baseline_garbage% | after_displayable% | after_suppressed% | after_missing% |');
  lines.push('|---|---:|---:|---:|---:|---:|');
  lines.push(`| Key fields (n=${totalKey}) | ${pct(baselineDisplayable, totalKey)} | ${pct(baselineGarbage, totalKey)} | ${pct(afterDisplayable, totalKey)} | ${pct(afterSuppressed, totalKey)} | ${pct(afterMissing, totalKey)} |`);
  lines.push('');
  lines.push('Interpretation: suppression is expected and preferred when the baseline evidence snippets look like OCR soup or boilerplate. A healthy system converts baseline garbage into after_suppressed (or after_missing), rather than displaying it.');
  lines.push('');

  lines.push('## After field status distribution (API semantics)');
  lines.push('');
  lines.push('| Field | displayable | suppressed | missing | present_but_unrated |');
  lines.push('|---|---:|---:|---:|---:|');
  for (const fieldKey of keyFields) {
    const c = agg.afterByFieldStatus[fieldKey] ?? initStatusCounts();
    lines.push(`| ${fieldKey} | ${c.displayable} | ${c.suppressed} | ${c.missing} | ${c.present_but_unrated} |`);
  }
  lines.push('');

  lines.push('## Baseline snippet quality distribution (aggressive classifier)');
  lines.push('');
  lines.push('| Field | GOOD | OK | GARBAGE | MISSING |');
  lines.push('|---|---:|---:|---:|---:|');
  for (const fieldKey of keyFields) {
    const c = agg.baselineByField[fieldKey] ?? initClassCounts();
    lines.push(`| ${fieldKey} | ${c.GOOD} | ${c.OK} | ${c.GARBAGE} | ${c.MISSING} |`);
  }
  lines.push('');

  lines.push('## Per-field deltas (baseline -> after)');
  lines.push('');
  lines.push('| Field | baseline_garbage→after_suppressed | baseline_garbage→after_displayable | baseline_ok→after_displayable | baseline_ok→after_suppressed (regressions) |');
  lines.push('|---|---:|---:|---:|---:|');
  for (const fieldKey of keyFields) {
    let bg = 0;
    let bg_to_supp = 0;
    let bg_to_disp = 0;
    let bok = 0;
    let bok_to_disp = 0;
    let bok_to_supp = 0;

    for (const r of rows) {
      const bcls = r.deterministic.baseline_snippet_fields[fieldKey]?.class ?? 'MISSING';
      const ast = r.deterministic.after_fields[fieldKey]?.status ?? 'missing';
      if (bcls === 'GARBAGE') {
        bg += 1;
        if (ast === 'suppressed') bg_to_supp += 1;
        if (ast === 'displayable') bg_to_disp += 1;
      }
      if (bcls === 'OK') {
        bok += 1;
        if (ast === 'displayable') bok_to_disp += 1;
        if (ast === 'suppressed') bok_to_supp += 1;
      }
    }

    const fmt = (n: number, d: number) => (d <= 0 ? `0 (0.0%)` : `${n} (${((n / d) * 100).toFixed(1)}%)`);
    lines.push(`| ${fieldKey} | ${fmt(bg_to_supp, bg)} | ${fmt(bg_to_disp, bg)} | ${fmt(bok_to_disp, bok)} | ${fmt(bok_to_supp, bok)} |`);
  }
  lines.push('');

  const topAfterTriggers = Object.entries(agg.topAfterTriggers)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40);
  lines.push('## Top AFTER triggers (field:trigger)');
  lines.push('');
  lines.push('| Trigger | Count |');
  lines.push('|---|---:|');
  for (const [k, v] of topAfterTriggers) lines.push(`| ${k} | ${v} |`);
  lines.push('');

  const topBaselineTriggers = Object.entries(agg.topBaselineTriggers)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40);
  lines.push('## Top BASELINE triggers (field:trigger)');
  lines.push('');
  lines.push('| Trigger | Count |');
  lines.push('|---|---:|');
  for (const [k, v] of topBaselineTriggers) lines.push(`| ${k} | ${v} |`);
  lines.push('');

  const topBasisPairsBaseline = Object.entries(agg.baselineBasisCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40);
  lines.push('## Baseline basis guess distribution (field:basis)');
  lines.push('');
  lines.push('| Basis | Count |');
  lines.push('|---|---:|');
  for (const [k, v] of topBasisPairsBaseline) lines.push(`| ${k} | ${v} |`);
  lines.push('');

  const topSegPairsBaseline = Object.entries(agg.baselineSegmentKeyCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50);
  lines.push('## Baseline segment-key distribution (field:segment_key)');
  lines.push('');
  lines.push('| Segment | Count |');
  lines.push('|---|---:|');
  for (const [k, v] of topSegPairsBaseline) lines.push(`| ${k} | ${v} |`);
  lines.push('');

  const garbageDeals = rows
    .map((r) => {
      const prod = r.deterministic.after_fields['product.text']?.status;
      const market = r.deterministic.after_fields['market.text']?.status;
      const one = r.deterministic.after_fields['one_liner.text']?.status;
      const garbageCount = [prod, market, one].filter((x) => x === 'suppressed').length;
      return { id: r.deal.id, name: r.deal.name, garbageCount, prod, market, one };
    })
    .sort((a, b) => b.garbageCount - a.garbageCount)
    .slice(0, 25);

  lines.push('## Worst deterministic copy (top 25 by suppressed fields)');
  lines.push('');
  lines.push('| Deal | Garbage fields | product | market | one_liner |');
  lines.push('|---|---:|---|---|---|');
  for (const r of garbageDeals) {
    lines.push(`| ${r.name ?? r.id} | ${r.garbageCount} | ${r.prod ?? '—'} | ${r.market ?? '—'} | ${r.one ?? '—'} |`);
  }
  lines.push('');

  lines.push('## Excluded deals (sample)');
  lines.push('');
  lines.push('| Deal | Reason |');
  lines.push('|---|---|');
  for (const x of excluded.slice(0, 50)) {
    lines.push(`| ${x.name ?? x.id} | ${x.reason} |`);
  }
  lines.push('');

  lines.push('## Root-cause taxonomy (to be filled by code trace)');
  lines.push('');
  lines.push('- RC1: (placeholder)');
  lines.push('- RC2: (placeholder)');
  lines.push('- RC3: (placeholder)');
  lines.push('');

  return lines.join('\n');
};

async function main() {
  const outJsonlAbs = resolvePath(process.cwd(), OUT_JSONL);
  const outMdAbs = resolvePath(process.cwd(), OUT_MD);
  await mkdir(resolvePath(process.cwd(), 'artifacts/forensics'), { recursive: true });

  console.log(`[forensics] API_BASE_URL=${API_BASE_URL}`);
  console.log(`[forensics] concurrency=${CONCURRENCY} limit=${LIMIT || 'none'}`);
  console.log(`[forensics] writing JSONL -> ${OUT_JSONL}`);
  console.log(`[forensics] writing report -> ${OUT_MD}`);

  const deals = await fetchJson<DealRow[]>(`/api/v1/deals`);
  const excluded: Array<{ id: string; name: string | null; reason: string }> = [];
  const included: DealRow[] = [];

  for (const d of deals) {
    const name = asNonEmptyString(d?.name ?? null);
    const { exclude, reason } = looksLikeMigrationTestDeal(d);
    if (exclude) {
      excluded.push({ id: d.id, name, reason: reason ?? 'excluded' });
    } else {
      included.push(d);
    }
  }

  const finalIncluded = LIMIT > 0 ? included.slice(0, LIMIT) : included;

  console.log(`[forensics] deals fetched=${deals.length} excluded=${excluded.length} included=${included.length} processing=${finalIncluded.length}`);

  const limiter = pLimit(CONCURRENCY);
  const agg = initAgg();
  agg.excluded = excluded.length;

  const rows: DealForensicsRow[] = [];
  const jsonlLines: string[] = [];

  let idx = 0;
  await Promise.all(
    finalIncluded.map((deal) =>
      limiter(async () => {
        const n = (idx += 1);
        if (n % 10 === 0 || n === 1) {
          console.log(`[forensics] fetching ${n}/${finalIncluded.length} deal_id=${deal.id}`);
        }

        const [det, gov] = await Promise.all([
          fetchJson<DeterministicReportEnvelope>(`/api/v1/deals/${deal.id}/report`).catch((err) => ({ ready: false, reason: `error:${String(err instanceof Error ? err.message : err)}` } as any)),
          fetchJson<GovernedOverlayEnvelope>(`/api/v1/deals/${deal.id}/governed-llm-overview`).catch(() => ({ overview: null } as any)),
        ]);

        const deterministic = pullDeterministicForensics(det);
        const governed = pullGovernedForensics(gov);

        const row: DealForensicsRow = {
          deal: {
            id: deal.id,
            name: asNonEmptyString(deal.name ?? null),
            stage: asNonEmptyString(deal.stage ?? null),
            created_at: asNonEmptyString(deal.created_at ?? deal.createdAt ?? null),
            updated_at: asNonEmptyString(deal.updated_at ?? deal.updatedAt ?? null),
          },
          deterministic,
          governed,
        };

        rows.push(row);
        jsonlLines.push(JSON.stringify(row));
        updateAgg(agg, row);
      })
    )
  );

  // stable ordering
  rows.sort((a, b) => (a.deal.updated_at ?? '').localeCompare(b.deal.updated_at ?? ''));

  await writeFile(outJsonlAbs, `${jsonlLines.join('\n')}\n`, 'utf8');
  agg.included = rows.length;

  const md = buildReportMd(agg, rows, excluded);
  await writeFile(outMdAbs, md, 'utf8');

  console.log(`[forensics] done. included=${agg.included} excluded=${agg.excluded}`);
}

main().catch((err) => {
  console.error('[forensics] fatal', err);
  process.exit(1);
});
