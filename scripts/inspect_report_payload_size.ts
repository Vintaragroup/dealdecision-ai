#!/usr/bin/env tsx

/**
 * Payload Size Forensics: /api/v1/deals/:dealId/report
 *
 * Discovery-only script.
 *
 * Usage:
 *   tsx scripts/inspect_report_payload_size.ts --deal <uuid> [--deal <uuid> ...]
 *   tsx scripts/inspect_report_payload_size.ts --deals <uuid,uuid,...>
 *   tsx scripts/inspect_report_payload_size.ts --from-api [--limit 10]
 *
 * Options:
 *   --api-base-url http://localhost:9001
 *   --no-narrate         (skip /report?narrate=1)
 *   --timeout-ms 240000
 *   --out-json artifacts/report_payload_size.<timestamp>.json
 */

import { writeFileSync } from 'node:fs';

type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

type FetchVariant = 'base' | 'narrated';

type FetchResult = {
  variant: FetchVariant;
  url: string;
  ok: boolean;
  status: number | null;
  elapsed_ms: number;
  error?: string;
  payload?: any;
  raw_bytes?: number;
};

type SizeEntry = { path: string; bytes: number; type: string; extra?: Record<string, any> };

type ReportSizeSummary = {
  dealId: string;
  variant: FetchVariant;
  url: string;
  ok: boolean;
  status: number | null;
  elapsed_ms: number;
  total_bytes: number | null;
  top_level_key_bytes: SizeEntry[];
  report_key_bytes: SizeEntry[];
  large_arrays: Array<{ path: string; length: number; approx_bytes: number; item_type: string }>; // heuristic
  top_strings: Array<{ path: string; bytes: number; chars: number; preview: string }>;
  notes: string[];
};

function parseArgs(argv: string[]) {
  const out: Record<string, any> = { deals: [] as string[] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];

    if (a === '--api-base-url') {
      out.apiBaseUrl = next;
      i++;
      continue;
    }
    if (a === '--deal') {
      if (typeof next === 'string') out.deals.push(next);
      i++;
      continue;
    }
    if (a === '--deals') {
      if (typeof next === 'string') out.deals.push(...next.split(',').map((s) => s.trim()).filter(Boolean));
      i++;
      continue;
    }
    if (a === '--from-api') {
      out.fromApi = true;
      continue;
    }
    if (a === '--limit') {
      out.limit = Number(next);
      i++;
      continue;
    }
    if (a === '--no-narrate') {
      out.noNarrate = true;
      continue;
    }
    if (a === '--timeout-ms') {
      out.timeoutMs = Number(next);
      i++;
      continue;
    }
    if (a === '--out-json') {
      out.outJson = next;
      i++;
      continue;
    }
    if (a === '--help' || a === '-h') {
      out.help = true;
      continue;
    }
  }
  return out;
}

function byteLenUtf8(s: string): number {
  return Buffer.byteLength(s, 'utf8');
}

function safeJsonStringify(v: any): string {
  try {
    return JSON.stringify(v);
  } catch {
    // Circular or non-serializable. Fall back to a tagged string.
    return '"<non_serializable>"';
  }
}

type WalkStats = { nodes: number; truncated: boolean; truncation_reasons: string[] };

const WALK_DEFAULTS = {
  maxNodes: 50_000,
  maxDepth: 12,
  maxArrayItems: 200,
  maxObjectKeys: 200,
} as const;

function approxArrayBytes(arr: any[], sampleN = 25): number {
  const n = arr.length;
  if (n === 0) return 2; // []

  const sample = arr.slice(0, Math.max(1, Math.min(sampleN, n)));
  const sampleBytes = sample.map((v) => byteLenUtf8(safeJsonStringify(v)));
  const avg = sampleBytes.reduce((a, b) => a + b, 0) / sampleBytes.length;

  // Brackets + commas between items (approx 1 byte each comma).
  const overhead = 2 + Math.max(0, n - 1);
  return Math.round(overhead + avg * n);
}

function approxObjectBytes(obj: Record<string, any>, sampleN = 200): number {
  const keys = Object.keys(obj);
  const n = keys.length;
  if (n === 0) return 2; // {}

  const sample = keys.slice(0, Math.max(1, Math.min(sampleN, n)));
  let sampleSum = 0;
  for (const k of sample) {
    // "key":<value>
    const keyBytes = byteLenUtf8(safeJsonStringify(k));
    const valueBytes = byteLenUtf8(safeJsonStringify(obj[k]));
    sampleSum += keyBytes + 1 + valueBytes; // + ':'
  }
  const avgPair = sampleSum / sample.length;
  const overhead = 2 + Math.max(0, n - 1); // braces + commas
  return Math.round(overhead + avgPair * n);
}

function approxBytes(v: any): number {
  // Per the request, use JSON.stringify as a rough estimator.
  // For extremely large arrays/objects, stringify-ing the whole value can be very slow,
  // so we fall back to a sampled estimator that still uses JSON.stringify on samples.
  try {
    if (Array.isArray(v)) {
      if (v.length > 500) return approxArrayBytes(v, 25);
      return byteLenUtf8(safeJsonStringify(v));
    }
    if (isPlainObject(v)) {
      const keyCount = Object.keys(v).length;
      if (keyCount > 2_000) return approxObjectBytes(v, 200);
      return byteLenUtf8(safeJsonStringify(v));
    }
    return byteLenUtf8(safeJsonStringify(v));
  } catch {
    return byteLenUtf8('"<approx_failed>"');
  }
}

function typeOf(v: any): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function isPlainObject(v: any): v is Record<string, any> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function collectTopLevelKeySizes(payload: any, rootLabel: string): SizeEntry[] {
  if (!isPlainObject(payload)) {
    return [{ path: rootLabel, bytes: approxBytes(payload), type: typeOf(payload) }];
  }
  const entries: SizeEntry[] = Object.keys(payload).map((k) => {
    const val = (payload as any)[k];
    return { path: `${rootLabel}.${k}`, bytes: approxBytes(val), type: typeOf(val) };
  });
  entries.sort((a, b) => b.bytes - a.bytes);
  return entries;
}

function pickReportObject(payload: any): any {
  if (!payload) return null;
  if (payload.report && isPlainObject(payload.report)) return payload.report;
  // Back-compat: some callers spread report fields onto payload.
  return payload;
}

function collectReportKeySizes(payload: any): SizeEntry[] {
  const reportObj = pickReportObject(payload);
  if (!isPlainObject(reportObj)) return [];
  const keys = Object.keys(reportObj);
  const entries: SizeEntry[] = keys.map((k) => {
    const v = (reportObj as any)[k];
    return { path: `report.${k}`, bytes: approxBytes(v), type: typeOf(v) };
  });
  entries.sort((a, b) => b.bytes - a.bytes);
  return entries;
}

function* walkJson(value: any, path: string, stats: WalkStats, opts = WALK_DEFAULTS): Generator<{ path: string; value: any }> {
  // Bounded traversal: report payloads can contain huge arrays (nodes, citations, traces).
  // We cap node count, depth, and per-container fanout.
  const stack: Array<{ value: any; path: string; depth: number }> = [{ value, path, depth: 0 }];

  const reasons = new Set<string>(stats.truncation_reasons ?? []);
  const mark = (r: string) => {
    stats.truncated = true;
    reasons.add(r);
  };

  while (stack.length) {
    const cur = stack.pop()!;
    stats.nodes++;
    if (stats.nodes > opts.maxNodes) {
      mark(`maxNodes>${opts.maxNodes}`);
      break;
    }

    yield { path: cur.path, value: cur.value };

    if (cur.value == null) continue;
    const t = typeof cur.value;
    if (t === 'string' || t === 'number' || t === 'boolean') continue;
    if (cur.depth >= opts.maxDepth) {
      mark(`maxDepth>=${opts.maxDepth}`);
      continue;
    }

    if (Array.isArray(cur.value)) {
      const arr = cur.value;
      const max = Math.min(arr.length, opts.maxArrayItems);
      if (arr.length > max) mark(`maxArrayItems=${opts.maxArrayItems}`);
      for (let i = max - 1; i >= 0; i--) {
        stack.push({ value: arr[i], path: `${cur.path}[${i}]`, depth: cur.depth + 1 });
      }
      continue;
    }

    if (typeof cur.value === 'object') {
      const obj = cur.value as Record<string, any>;
      const keys = Object.keys(obj);
      const max = Math.min(keys.length, opts.maxObjectKeys);
      if (keys.length > max) mark(`maxObjectKeys=${opts.maxObjectKeys}`);
      for (let i = max - 1; i >= 0; i--) {
        const k = keys[i];
        stack.push({ value: obj[k], path: `${cur.path}.${k}`, depth: cur.depth + 1 });
      }
    }
  }

  stats.truncation_reasons = Array.from(reasons);
}

function collectLargeArrays(payload: any, maxArrays = 50): { arrays: Array<{ path: string; length: number; approx_bytes: number; item_type: string }>; stats: WalkStats } {
  const candidates: Array<{ path: string; length: number; approx_bytes: number; item_type: string }> = [];
  const stats: WalkStats = { nodes: 0, truncated: false, truncation_reasons: [] };

  for (const node of walkJson(payload, '$', stats)) {
    const v = node.value;
    if (!Array.isArray(v)) continue;

    // Heuristic: treat any array with >= 25 items or any array whose path indicates known big buckets.
    const lowerPath = node.path.toLowerCase();
    const looksImportant = /(nodes|sources|citations|traces|evidence|segments|blocks|documents|assets|pages|extractions)/.test(lowerPath);
    if (v.length < 25 && !looksImportant) continue;

    const item0 = v[0];
    const itemType = item0 == null ? 'null' : (Array.isArray(item0) ? 'array' : typeof item0);

    // Size estimate for the array: sampled to avoid stringify-ing huge arrays.
    const bytes = v.length > 500 ? approxArrayBytes(v, 25) : approxBytes(v);

    candidates.push({ path: node.path, length: v.length, approx_bytes: bytes, item_type: itemType });
  }

  candidates.sort((a, b) => b.approx_bytes - a.approx_bytes);
  return { arrays: candidates.slice(0, maxArrays), stats };
}

function collectTopStrings(payload: any, topN = 20): { strings: Array<{ path: string; bytes: number; chars: number; preview: string }>; stats: WalkStats } {
  const strings: Array<{ path: string; bytes: number; chars: number; preview: string }> = [];
  const stats: WalkStats = { nodes: 0, truncated: false, truncation_reasons: [] };

  for (const node of walkJson(payload, '$', stats)) {
    const v = node.value;
    if (typeof v !== 'string') continue;
    const trimmed = v;
    const bytes = byteLenUtf8(trimmed);
    if (bytes < 512) continue; // ignore small strings

    const preview = trimmed.length > 160 ? (trimmed.slice(0, 160) + '…') : trimmed;
    strings.push({ path: node.path, bytes, chars: trimmed.length, preview });
  }

  strings.sort((a, b) => b.bytes - a.bytes);
  return { strings: strings.slice(0, topN), stats };
}

async function fetchJsonWithTimeout(url: string, timeoutMs: number): Promise<FetchResult> {
  const started = Date.now();
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => {
    try {
      controller?.abort();
    } catch {
      // ignore
    }
  }, timeoutMs);

  try {
    const res = await fetch(url, controller ? { signal: controller.signal } : undefined);
    const status = typeof res.status === 'number' ? res.status : null;
    const text = await res.text();
    const rawBytes = byteLenUtf8(text);

    let payload: any = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }

    return {
      variant: 'base',
      url,
      ok: Boolean((res as any).ok),
      status,
      elapsed_ms: Date.now() - started,
      payload,
      raw_bytes: rawBytes,
    };
  } catch (e: any) {
    const msg = e?.name === 'AbortError' ? `AbortError (timeout ${timeoutMs}ms)` : (e?.message || String(e));
    return {
      variant: 'base',
      url,
      ok: false,
      status: null,
      elapsed_ms: Date.now() - started,
      error: msg,
    };
  } finally {
    clearTimeout(timer);
  }
}

function apiUrl(baseUrl: string, path: string): string {
  const b = baseUrl.replace(/\/$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${b}${p}`;
}

async function analyzeDealVariant(args: {
  dealId: string;
  variant: FetchVariant;
  apiBaseUrl: string;
  timeoutMs: number;
}): Promise<ReportSizeSummary> {
  const { dealId, apiBaseUrl, timeoutMs, variant } = args;

  const t = Date.now();
  const cacheBuster = `t=${t}`;
  const path = variant === 'base'
    ? `/api/v1/deals/${encodeURIComponent(dealId)}/report?${cacheBuster}`
    : `/api/v1/deals/${encodeURIComponent(dealId)}/report?narrate=1&${cacheBuster}`;

  const url = apiUrl(apiBaseUrl, path);
  const fetchRes = await fetchJsonWithTimeout(url, timeoutMs);
  fetchRes.variant = variant;

  const notes: string[] = [];

  if (!fetchRes.ok || !fetchRes.payload) {
    return {
      dealId,
      variant,
      url,
      ok: fetchRes.ok,
      status: fetchRes.status,
      elapsed_ms: fetchRes.elapsed_ms,
      total_bytes: fetchRes.raw_bytes ?? null,
      top_level_key_bytes: [],
      report_key_bytes: [],
      large_arrays: [],
      top_strings: [],
      notes: [fetchRes.error ? `fetch_error=${fetchRes.error}` : 'no_payload'],
    };
  }

  const payload = fetchRes.payload;
  const totalBytes = fetchRes.raw_bytes ?? byteLenUtf8(JSON.stringify(payload));

  // Key size estimates by JSON.stringify.
  const topLevel = collectTopLevelKeySizes(payload, '$');
  const reportKeys = collectReportKeySizes(payload);

  // Arrays and strings.
  const largeArraysRes = collectLargeArrays(payload, 60);
  const topStringsRes = collectTopStrings(payload, 20);
  const largeArrays = largeArraysRes.arrays;
  const topStrings = topStringsRes.strings;

  if (largeArraysRes.stats.truncated) {
    notes.push(`walk_large_arrays_truncated=${largeArraysRes.stats.truncation_reasons.join(',')}`);
  }
  if (topStringsRes.stats.truncated) {
    notes.push(`walk_top_strings_truncated=${topStringsRes.stats.truncation_reasons.join(',')}`);
  }

  // Special sanity notes.
  const reportObj = pickReportObject(payload);
  const narr = reportObj && isPlainObject(reportObj) ? (reportObj as any).llm_narration_v1 : null;
  const narrErr = (() => {
    const meta = (payload as any)?.metadata ?? (reportObj as any)?.metadata ?? null;
    return meta && typeof meta === 'object' ? (meta as any).llm_narration_v1_error ?? null : null;
  })();
  if (variant === 'narrated') {
    notes.push(narr ? 'llm_narration_v1=present' : 'llm_narration_v1=absent');
    if (narrErr && typeof narrErr === 'object') {
      const code = typeof (narrErr as any).code === 'string' ? (narrErr as any).code : 'unknown';
      const msg = typeof (narrErr as any).message === 'string' ? (narrErr as any).message : '';
      notes.push(`llm_narration_v1_error=${code}${msg ? `:${msg}` : ''}`);
    }
  }

  return {
    dealId,
    variant,
    url,
    ok: true,
    status: fetchRes.status,
    elapsed_ms: fetchRes.elapsed_ms,
    total_bytes: totalBytes,
    top_level_key_bytes: topLevel.slice(0, 40),
    report_key_bytes: reportKeys.slice(0, 40),
    large_arrays: largeArrays,
    top_strings: topStrings,
    notes,
  };
}

function fmtBytes(bytes: number | null): string {
  if (bytes == null) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

function renderConsoleSummary(summary: ReportSizeSummary) {
  const head = `[${summary.variant}] deal=${summary.dealId} ok=${summary.ok} status=${summary.status ?? '-'} elapsed=${summary.elapsed_ms}ms bytes=${fmtBytes(summary.total_bytes)}`;
  console.log(head);
  if (summary.notes.length) console.log('  notes:', summary.notes.join(' | '));

  const top5 = (summary.report_key_bytes.length ? summary.report_key_bytes : summary.top_level_key_bytes).slice(0, 5);
  if (top5.length) {
    console.log('  top keys by approx bytes:');
    for (const e of top5) {
      console.log(`   - ${e.path}: ${fmtBytes(e.bytes)} (${e.type})`);
    }
  }

  const arrTop = summary.large_arrays.slice(0, 5);
  if (arrTop.length) {
    console.log('  large arrays (top 5):');
    for (const a of arrTop) {
      console.log(`   - ${a.path}: len=${a.length} approx=${fmtBytes(a.approx_bytes)} item=${a.item_type}`);
    }
  }

  const strTop = summary.top_strings.slice(0, 5);
  if (strTop.length) {
    console.log('  largest strings (top 5):');
    for (const s of strTop) {
      console.log(`   - ${s.path}: ${fmtBytes(s.bytes)} chars=${s.chars}`);
    }
  }
}

async function fetchDealsFromApi(apiBaseUrl: string, limit: number, timeoutMs: number): Promise<string[]> {
  const url = apiUrl(apiBaseUrl, `/api/v1/deals?t=${Date.now()}`);
  const res = await fetchJsonWithTimeout(url, timeoutMs);
  if (!res.ok || !Array.isArray(res.payload)) return [];
  return res.payload
    .slice(0, Math.max(0, limit))
    .map((d: any) => (typeof d?.id === 'string' ? d.id : null))
    .filter(Boolean);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log('Usage: tsx scripts/inspect_report_payload_size.ts --deal <uuid> [--deal <uuid> ...]');
    console.log('       tsx scripts/inspect_report_payload_size.ts --deals <uuid,uuid,...>');
    console.log('       tsx scripts/inspect_report_payload_size.ts --from-api [--limit 10]');
    console.log('Options: --api-base-url http://localhost:9001 --no-narrate --timeout-ms 240000 --out-json <path>');
    process.exit(0);
  }

  const apiBaseUrl = typeof args.apiBaseUrl === 'string' ? args.apiBaseUrl : (process.env.API_BASE_URL || 'http://localhost:9001');
  const timeoutMs = Number.isFinite(args.timeoutMs) ? Math.max(1000, args.timeoutMs) : 240_000;
  const limit = Number.isFinite(args.limit) ? Math.max(1, args.limit) : 6;
  const noNarrate = Boolean(args.noNarrate);

  let deals: string[] = Array.isArray(args.deals) ? args.deals : [];
  if ((!deals || deals.length === 0) && args.fromApi) {
    deals = await fetchDealsFromApi(apiBaseUrl, limit, timeoutMs);
  }

  if (!deals.length) {
    console.error('No deals provided. Use --deal/--deals or --from-api.');
    process.exit(1);
  }

  const summaries: ReportSizeSummary[] = [];

  for (const dealId of deals) {
    const base = await analyzeDealVariant({ dealId, variant: 'base', apiBaseUrl, timeoutMs });
    renderConsoleSummary(base);
    summaries.push(base);

    if (!noNarrate) {
      const narr = await analyzeDealVariant({ dealId, variant: 'narrated', apiBaseUrl, timeoutMs });
      renderConsoleSummary(narr);
      summaries.push(narr);
    }

    console.log('');
  }

  if (typeof args.outJson === 'string' && args.outJson.trim()) {
    const outPath = args.outJson.trim();
    writeFileSync(outPath, JSON.stringify({ apiBaseUrl, timeoutMs, deals, summaries }, null, 2), 'utf8');
    console.log(`Wrote JSON: ${outPath}`);
  }
}

main().catch((e) => {
  console.error('Fatal:', e?.message || String(e));
  process.exit(1);
});
