type FundabilityV1DTO = {
  spec_version?: string;
  phase_inference_v1?: {
    company_phase?: string;
    confidence?: number;
    supporting_evidence?: Array<{ signal?: string; source?: string; note?: string } | null>;
    missing_evidence?: string[];
  };
  fundability_assessment_v1?: {
    outcome?: string;
    reasons?: string[];
    fundability_score_0_100?: number | null;
    legacy_overall_score_0_100?: number | null;
    caps?: { max_fundability_score_0_100?: number };
    fundable_at_phase_if_downgraded?: string;
  };
  fundability_decision_v1?: {
    outcome?: string;
    should_block_investment?: boolean;
    missing_required_signals?: string[];
    next_requests?: string[];
  };
};

type DealListItem = {
  id: string;
  name: string;
  score?: number;
  stage?: string;
  fundability_v1?: FundabilityV1DTO;
};

type ReportRow = {
  deal_id: string;
  deal_name: string;
  stage?: string;
  legacy_score_0_100: number | null;
  fundability_score_0_100: number | null;
  delta_f_minus_legacy: number | null;
  phase?: string | null;
  phase_confidence?: number | null;
  outcome?: string | null;
  spec_version?: string | null;
  capped_max?: number | null;
  cap_reasons?: string[];
  missing_required_signals?: string[];
  next_requests?: string[];
  missing_evidence?: string[];
  supported_signals?: string[];
  supporting_evidence?: Array<{ signal: string; source?: string; note?: string }>;
};

type FundabilityCompareReport = {
  generated_at: string;
  summary: {
    apiBaseUrl: string;
    totalDeals: number;
    processedDeals: number;
    withFundabilityV1: number;
    withFundabilityScore: number;
    comparablePairs: number;
    minAbsDelta: number;
    includedRows: number;
    byOutcome: Array<{ key: string; count: number }>;
    byPhase: Array<{ key: string; count: number }>;
  };
  rows: ReportRow[];
  holes: {
    missingFundabilityV1: string[];
    missingFundabilityScore: string[];
    missingPhase: string[];
    missingOutcome: string[];
    missingLegacyScore: string[];
  };
};

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      args.help = true;
      continue;
    }
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = 'true';
      }
      continue;
    }
    positional.push(a);
  }

  return { args, positional };
}

function usage() {
  return `compare-fundability-v1

Compares legacy deal score vs fundability_v1 score across all deals.

Usage:
  pnpm tsx scripts/compare-fundability-v1.ts --api-base-url http://localhost:9000

Options:
  --api-base-url   Base URL for API (default: http://localhost:9000)
  --deal-id        Only include this deal id (optional)
  --deal-name-contains Only include deals whose name includes this substring (case-insensitive; optional)
  --out            Write JSON report to this path (optional)
  --format         Output format: json | md (default: json)
  --out-md         Write Markdown report to this path (optional)
  --snapshot       Path to write/read JSON snapshot for diffing (md only; default: artifacts/fundability-compare.snapshot.json)
  --no-diff        Disable diff section even if a snapshot exists (md only)
  --min-abs-delta  Only include rows with |delta| >= N (default: 0)
  --limit          Only process first N deals (optional)
  --help           Show help
`;
}

const PHASE_REQUIREMENTS: Record<string, string[]> = {
  IDEA: ['problem_definition', 'customer_persona', 'solution_concept'],
  PRE_SEED: ['prototype_or_roadmap', 'customer_discovery', 'icp_definition'],
  SEED: ['live_product', 'customers_or_users', 'revenue_or_strong_usage', 'gtm_hypothesis'],
  SEED_PLUS: ['revenue_growth', 'retention_metrics', 'unit_economics', 'burn_runway_clarity'],
  SERIES_A: ['predictable_growth', 'retention_metrics', 'cac_ltv_or_efficiency', 'operational_discipline'],
  SERIES_B: ['predictable_growth', 'retention_metrics', 'cac_ltv_or_efficiency', 'operational_discipline', 'scale_signal'],
};

function getPhaseRequirements(phase: unknown): string[] {
  const p = typeof phase === 'string' ? phase.trim() : '';
  return PHASE_REQUIREMENTS[p] ?? [];
}

function toNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function round0(value: number | null): number | null {
  return value == null ? null : Math.round(value);
}

function groupCount(rows: ReportRow[], keyFn: (r: ReportRow) => string) {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const k = keyFn(r);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => ({ key, count }));
}

function flattenCounts(values: Array<string | undefined | null>): Array<{ key: string; count: number }> {
  const counts = new Map<string, number>();
  for (const v of values) {
    const k = v && String(v).trim() ? String(v).trim() : 'none';
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => ({ key, count }));
}

function uniq<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function extractMissingSignalsFromAssessmentReasons(reasons: string[] | undefined): string[] {
  if (!Array.isArray(reasons)) return [];
  return reasons
    .filter((r) => typeof r === 'string' && r.startsWith('missing:'))
    .map((r) => r.slice('missing:'.length))
    .filter(Boolean);
}

function capLimitOrEmpty(value: unknown, maxLen: number): string {
  const s = typeof value === 'string' ? value : String(value ?? '');
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen - 1)}…`;
}

function toSignalList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((e) => (e && typeof e === 'object' ? (e as any).signal : undefined))
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
}

function toSupportingEvidence(value: unknown): Array<{ signal: string; source?: string; note?: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .filter((e) => e && typeof e === 'object')
    .map((e) => {
      const obj = e as any;
      const signal = typeof obj.signal === 'string' ? obj.signal.trim() : '';
      const source = typeof obj.source === 'string' && obj.source.trim().length > 0 ? obj.source.trim() : undefined;
      const note = typeof obj.note === 'string' && obj.note.trim().length > 0 ? obj.note.trim() : undefined;
      return { signal, source, note };
    })
    .filter((e) => e.signal.length > 0);
}

function takeTop<T>(items: T[], n: number): T[] {
  return items.slice(0, Math.max(0, n));
}

function isCapApplied(reasons: string[] | undefined): boolean {
  return Array.isArray(reasons) && reasons.some((r) => typeof r === 'string' && r.startsWith('score_cap_applied:'));
}

function summarizeCapReason(reasons: string[] | undefined): string {
  if (!Array.isArray(reasons) || reasons.length === 0) return 'none';
  const explicit = reasons.find((r) => typeof r === 'string' && r.startsWith('score_cap_applied:'));
  if (explicit) return explicit;
  const lowConf = reasons.find((r) => typeof r === 'string' && r.startsWith('low_phase_confidence:'));
  if (lowConf) return lowConf;
  return reasons[0] ?? 'none';
}

function escapeMd(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function mdTable(headers: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const headerLine = `| ${headers.map(escapeMd).join(' | ')} |`;
  const sepLine = `| ${headers.map(() => '---').join(' | ')} |`;
  const bodyLines = rows.map((r) => `| ${r.map((c) => escapeMd(c == null ? '' : String(c))).join(' | ')} |`);
  return [headerLine, sepLine, ...bodyLines].join('\n');
}

function takeExampleDealLinks(
  dealsById: Map<string, DealListItem>,
  ids: string[],
  apiBaseUrl: string,
  limit: number,
): Array<{ id: string; name: string; url: string }> {
  return ids.slice(0, limit).map((id) => {
    const deal = dealsById.get(id);
    const name = deal?.name ?? id;
    return { id, name, url: `${apiBaseUrl}/api/v1/deals/${id}` };
  });
}

type LineageNode = {
  id?: string;
  node_id?: string;
  type?: string;
  node_type?: string;
  data?: any;
};

type DealLineageResponse = {
  deal_id: string;
  nodes: LineageNode[];
  edges: any[];
  warnings?: string[];
};

type DealLineageSummary = {
  deal_id: string;
  segments_present: string[];
  extracted_signal_types_by_segment: Record<string, Array<{ type: string; count: number }>>;
  score_driver_deltas_by_segment: Record<string, Array<{ driver: string; delta_sum: number; count: number }>>;
  top_assets_by_segment: Record<
    string,
    Array<{ visual_asset_id: string; page_index: number | null; asset_type: string | null; summary: string | null; evidence_count: number }>
  >;
  warnings: string[];
};

type FundabilityCompareSnapshot = {
  generated_at: string;
  apiBaseUrl: string;
  deals: Record<
    string,
    {
      deal_name: string;
      stage?: string;
      legacy_score_0_100: number | null;
      fundability_score_0_100: number | null;
      capped_max?: number | null;
      phase?: string | null;
      phase_confidence?: number | null;
      missing_signals?: string[];
      supported_signals?: string[];
      segments_present?: string[];
    }
  >;
};

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;

  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  }

  const workers = new Array(Math.max(1, concurrency)).fill(0).map(() => worker());
  await Promise.all(workers);
  return results;
}

function parseSegmentKeyFromSegmentNodeId(nodeId: string): string | null {
  // expected: segment:<dealId>:<docId>:<segmentKey>
  const parts = nodeId.split(':');
  if (parts.length < 4) return null;
  const seg = parts[parts.length - 1];
  return seg && seg.trim().length > 0 ? seg.trim() : null;
}

function safeArray<T = any>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function toLineageSummary(resp: DealLineageResponse): DealLineageSummary {
  const segments = new Set<string>();
  const extractedTypesBySegment = new Map<string, Map<string, number>>();
  const driverDeltasBySegment = new Map<string, Map<string, { delta_sum: number; count: number }>>();
  const assetsBySegment = new Map<
    string,
    Array<{ visual_asset_id: string; page_index: number | null; asset_type: string | null; summary: string | null; evidence_count: number }>
  >();

  for (const n of safeArray(resp.nodes)) {
    const nodeType = typeof n?.node_type === 'string' ? n.node_type : '';
    const nodeId = typeof n?.id === 'string' ? n.id : typeof n?.node_id === 'string' ? n.node_id : '';

    if (nodeType === 'SEGMENT' && nodeId.startsWith('segment:')) {
      const segKey = parseSegmentKeyFromSegmentNodeId(nodeId);
      if (segKey) segments.add(segKey);
    }

    if (nodeType === 'VISUAL_ASSET') {
      const seg =
        typeof n?.data?.effective_segment === 'string' && n.data.effective_segment.trim().length > 0
          ? String(n.data.effective_segment)
          : typeof n?.data?.segment === 'string' && n.data.segment.trim().length > 0
            ? String(n.data.segment)
            : 'unknown';

      const pu = n?.data?.page_understanding;
      const extractedSignals = safeArray<{ type?: string }>(pu?.extracted_signals);
      const scoreContrib = safeArray<{ driver?: string; delta?: number }>(pu?.score_contributions);

      const visualAssetId = typeof n?.id === 'string' && n.id.startsWith('visual_asset:') ? n.id.slice('visual_asset:'.length) : null;
      const pageIndexRaw = n?.data?.page_index;
      const pageIndex = typeof pageIndexRaw === 'number' && Number.isFinite(pageIndexRaw) ? pageIndexRaw : null;
      const assetType = typeof n?.data?.asset_type === 'string' && n.data.asset_type.trim().length > 0 ? String(n.data.asset_type) : null;
      const summary = typeof pu?.summary === 'string' && pu.summary.trim().length > 0
        ? pu.summary.trim()
        : typeof n?.data?.ocr_text_snippet === 'string' && n.data.ocr_text_snippet.trim().length > 0
          ? n.data.ocr_text_snippet.trim()
          : null;
      const evCountRaw = n?.data?.evidence_count;
      const evidenceCount = typeof evCountRaw === 'number' && Number.isFinite(evCountRaw) ? evCountRaw : 0;

      if (visualAssetId) {
        if (!assetsBySegment.has(seg)) assetsBySegment.set(seg, []);
        assetsBySegment.get(seg)!.push({
          visual_asset_id: visualAssetId,
          page_index: pageIndex,
          asset_type: assetType,
          summary,
          evidence_count: evidenceCount,
        });
      }

      if (!extractedTypesBySegment.has(seg)) extractedTypesBySegment.set(seg, new Map());
      const typeCounts = extractedTypesBySegment.get(seg)!;
      for (const s of extractedSignals) {
        const t = typeof s?.type === 'string' && s.type.trim().length > 0 ? s.type.trim() : null;
        if (!t) continue;
        typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
      }

      if (!driverDeltasBySegment.has(seg)) driverDeltasBySegment.set(seg, new Map());
      const driverAgg = driverDeltasBySegment.get(seg)!;
      for (const c of scoreContrib) {
        const driver = typeof c?.driver === 'string' && c.driver.trim().length > 0 ? c.driver.trim() : null;
        if (!driver) continue;
        const delta = typeof c?.delta === 'number' && Number.isFinite(c.delta) ? c.delta : 0;
        const prev = driverAgg.get(driver) ?? { delta_sum: 0, count: 0 };
        driverAgg.set(driver, { delta_sum: prev.delta_sum + delta, count: prev.count + 1 });
      }
    }
  }

  const extracted_signal_types_by_segment: DealLineageSummary['extracted_signal_types_by_segment'] = {};
  for (const [seg, counts] of extractedTypesBySegment.entries()) {
    extracted_signal_types_by_segment[seg] = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([type, count]) => ({ type, count }));
  }

  const score_driver_deltas_by_segment: DealLineageSummary['score_driver_deltas_by_segment'] = {};
  for (const [seg, agg] of driverDeltasBySegment.entries()) {
    score_driver_deltas_by_segment[seg] = Array.from(agg.entries())
      .sort((a, b) => Math.abs(b[1].delta_sum) - Math.abs(a[1].delta_sum))
      .slice(0, 6)
      .map(([driver, v]) => ({ driver, delta_sum: Number(v.delta_sum.toFixed(2)), count: v.count }));
  }

  const top_assets_by_segment: DealLineageSummary['top_assets_by_segment'] = {};
  for (const [seg, assets] of assetsBySegment.entries()) {
    top_assets_by_segment[seg] = assets
      .slice()
      .sort((a, b) => b.evidence_count - a.evidence_count)
      .slice(0, 3)
      .map((a) => ({
        visual_asset_id: a.visual_asset_id,
        page_index: a.page_index,
        asset_type: a.asset_type,
        summary: a.summary,
        evidence_count: a.evidence_count,
      }));
  }

  return {
    deal_id: resp.deal_id,
    segments_present: Array.from(segments.values()).sort(),
    extracted_signal_types_by_segment,
    score_driver_deltas_by_segment,
    top_assets_by_segment,
    warnings: Array.isArray(resp.warnings) ? resp.warnings.filter((w) => typeof w === 'string' && w.trim().length > 0) : [],
  };
}

function expectedSegmentsForSignal(signal: string): string[] {
  // Heuristic mapping: helps users reason about why a signal is missing based on which segments exist.
  // Keep conservative and small; this is a debugging hint, not a hard rule.
  const s = String(signal).trim();
  const map: Record<string, string[]> = {
    problem_definition: ['overview', 'market', 'risks'],
    customer_persona: ['market', 'distribution', 'traction', 'overview'],
    solution_concept: ['solution', 'product', 'overview'],
    // Common other signals (best-effort)
    unit_economics: ['financials', 'business_model'],
    burn_runway_clarity: ['financials'],
    go_to_market: ['distribution', 'traction'],
    team_strength: ['team'],
  };
  return map[s] ?? [];
}

function classifySegmentsPresence(params: { present: string[]; expected: string[] }): { present: string[]; missing: string[] } {
  const presentSet = new Set(params.present);
  const expected = params.expected.filter((x) => x && x !== 'unknown');
  return {
    present: expected.filter((x) => presentSet.has(x)),
    missing: expected.filter((x) => !presentSet.has(x)),
  };
}

function computeMicroDebugDealIds(report: FundabilityCompareReport): string[] {
  const rowsAll = report.rows;
  const allSignals: string[] = [];
  for (const r of rowsAll) {
    const fromDecision = Array.isArray(r.missing_required_signals) ? r.missing_required_signals : [];
    const fromAssessment = extractMissingSignalsFromAssessmentReasons(r.cap_reasons);
    for (const s of [...fromDecision, ...fromAssessment]) allSignals.push(s);
  }

  const missingSignalCounts = Array.from(
    allSignals.reduce((m, s) => {
      m.set(s, (m.get(s) ?? 0) + 1);
      return m;
    }, new Map<string, number>()).entries(),
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([key]) => key)
    .filter((k) => k !== 'none');

  const result: string[] = [];
  const seen = new Set<string>();
  for (const signal of missingSignalCounts) {
    const candidates = rowsAll
      .filter((r) => {
        const fromDecision = Array.isArray(r.missing_required_signals) ? r.missing_required_signals : [];
        const fromAssessment = extractMissingSignalsFromAssessmentReasons(r.cap_reasons);
        return [...fromDecision, ...fromAssessment].includes(signal);
      })
      .slice()
      .sort((a, b) => Math.abs((b.delta_f_minus_legacy ?? 0) as number) - Math.abs((a.delta_f_minus_legacy ?? 0) as number))
      .slice(0, 8);

    for (const r of candidates) {
      if (seen.has(r.deal_id)) continue;
      seen.add(r.deal_id);
      result.push(r.deal_id);
    }
  }

  return result;
}

function toSnapshot(params: {
  report: FundabilityCompareReport;
  lineageByDealId: Map<string, DealLineageSummary>;
}): FundabilityCompareSnapshot {
  const deals: FundabilityCompareSnapshot['deals'] = {};
  for (const r of params.report.rows) {
    const missingSignals = uniq([
      ...(Array.isArray(r.missing_required_signals) ? r.missing_required_signals : []),
      ...extractMissingSignalsFromAssessmentReasons(r.cap_reasons),
    ]);
    const lineage = params.lineageByDealId.get(r.deal_id);
    deals[r.deal_id] = {
      deal_name: r.deal_name,
      stage: r.stage,
      legacy_score_0_100: r.legacy_score_0_100,
      fundability_score_0_100: r.fundability_score_0_100,
      capped_max: r.capped_max ?? null,
      phase: r.phase ?? null,
      phase_confidence: r.phase_confidence ?? null,
      missing_signals: missingSignals.length > 0 ? missingSignals : undefined,
      supported_signals: Array.isArray(r.supported_signals) ? r.supported_signals : undefined,
      segments_present: lineage ? lineage.segments_present : undefined,
    };
  }

  return {
    generated_at: params.report.generated_at,
    apiBaseUrl: params.report.summary.apiBaseUrl,
    deals,
  };
}

function diffSnapshot(prev: FundabilityCompareSnapshot, curr: FundabilityCompareSnapshot) {
  const changed: Array<{
    deal_id: string;
    deal_name: string;
    score_delta: number | null;
    conf_delta: number | null;
    missing_signals_delta: number | null;
    segments_added: string[];
  }> = [];

  for (const [dealId, now] of Object.entries(curr.deals)) {
    const before = prev.deals[dealId];
    if (!before) continue;

    const scoreDelta =
      typeof now.fundability_score_0_100 === 'number' && typeof before.fundability_score_0_100 === 'number'
        ? now.fundability_score_0_100 - before.fundability_score_0_100
        : null;

    const confDelta =
      typeof now.phase_confidence === 'number' && typeof before.phase_confidence === 'number'
        ? Number((now.phase_confidence - before.phase_confidence).toFixed(2))
        : null;

    const mNow = Array.isArray(now.missing_signals) ? now.missing_signals.length : null;
    const mBefore = Array.isArray(before.missing_signals) ? before.missing_signals.length : null;
    const missingDelta = mNow != null && mBefore != null ? mBefore - mNow : null;

    const segNow = new Set(Array.isArray(now.segments_present) ? now.segments_present : []);
    const segBefore = new Set(Array.isArray(before.segments_present) ? before.segments_present : []);
    const segmentsAdded = Array.from(segNow).filter((s) => !segBefore.has(s) && s !== 'unknown').sort();

    const hasMeaningfulChange =
      (scoreDelta != null && scoreDelta !== 0) ||
      (confDelta != null && confDelta !== 0) ||
      (missingDelta != null && missingDelta !== 0) ||
      segmentsAdded.length > 0;

    if (!hasMeaningfulChange) continue;
    changed.push({
      deal_id: dealId,
      deal_name: now.deal_name,
      score_delta: scoreDelta,
      conf_delta: confDelta,
      missing_signals_delta: missingDelta,
      segments_added: segmentsAdded,
    });
  }

  changed.sort((a, b) => {
    const aScore = Math.abs(a.score_delta ?? 0);
    const bScore = Math.abs(b.score_delta ?? 0);
    if (bScore !== aScore) return bScore - aScore;
    const aConf = Math.abs(a.conf_delta ?? 0);
    const bConf = Math.abs(b.conf_delta ?? 0);
    if (bConf !== aConf) return bConf - aConf;
    return (b.missing_signals_delta ?? 0) - (a.missing_signals_delta ?? 0);
  });

  return changed;
}

function toMarkdownReport(
  report: FundabilityCompareReport,
  dealsById: Map<string, DealListItem>,
  lineageByDealId: Map<string, DealLineageSummary>,
  diff?: { prevGeneratedAt: string; changes: ReturnType<typeof diffSnapshot> },
): string {
  const { summary, holes } = report;

  const holesSection = [
    ['Missing fundability_v1', holes.missingFundabilityV1.length],
    ['Missing fundability score', holes.missingFundabilityScore.length],
    ['Missing phase inference', holes.missingPhase.length],
    ['Missing outcome', holes.missingOutcome.length],
    ['Missing legacy score', holes.missingLegacyScore.length],
  ];

  const exampleLimit = 12;
  const exampleMissingFundability = takeExampleDealLinks(dealsById, holes.missingFundabilityV1, summary.apiBaseUrl, exampleLimit);
  const exampleMissingScore = takeExampleDealLinks(dealsById, holes.missingFundabilityScore, summary.apiBaseUrl, exampleLimit);
  const exampleMissingPhase = takeExampleDealLinks(dealsById, holes.missingPhase, summary.apiBaseUrl, exampleLimit);
  const exampleMissingOutcome = takeExampleDealLinks(dealsById, holes.missingOutcome, summary.apiBaseUrl, exampleLimit);

  const topDeltaRows = report.rows
    .filter((r) => r.delta_f_minus_legacy != null)
    .slice()
    .sort((a, b) => Math.abs(b.delta_f_minus_legacy!) - Math.abs(a.delta_f_minus_legacy!))
    .slice(0, 25);

  const capAppliedRows = report.rows.filter((r) => r.capped_max != null || (r.cap_reasons && isCapApplied(r.cap_reasons)));
  const capReasonCounts = flattenCounts(capAppliedRows.map((r) => summarizeCapReason(r.cap_reasons)));

  const missingSignalCounts = (() => {
    const allSignals: string[] = [];
    for (const r of report.rows) {
      const fromDecision = Array.isArray(r.missing_required_signals) ? r.missing_required_signals : [];
      const fromAssessment = extractMissingSignalsFromAssessmentReasons(r.cap_reasons);
      for (const s of [...fromDecision, ...fromAssessment]) allSignals.push(s);
    }
    return Array.from(
      allSignals.reduce((m, s) => {
        m.set(s, (m.get(s) ?? 0) + 1);
        return m;
      }, new Map<string, number>()).entries(),
    )
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([key, count]) => ({ key, count }));
  })();

  const dealUrl = (dealId: string) => `${summary.apiBaseUrl}/api/v1/deals/${dealId}`;
  const lineageUrl = (dealId: string) => `${summary.apiBaseUrl}/api/v1/deals/${dealId}/lineage?debug_segments=1`;

  function rowMissingSignals(r: ReportRow): string[] {
    const fromDecision = Array.isArray(r.missing_required_signals) ? r.missing_required_signals : [];
    const fromAssessment = extractMissingSignalsFromAssessmentReasons(r.cap_reasons);
    return uniq([...fromDecision, ...fromAssessment]);
  }

  function microRow(r: ReportRow) {
    const missingSignals = rowMissingSignals(r);
    const supported = Array.isArray(r.supported_signals) ? r.supported_signals : [];
    const supportingEvidence = Array.isArray(r.supporting_evidence) ? r.supporting_evidence : [];
    return {
      deal: `${r.deal_name} (${r.deal_id})`,
      url: dealUrl(r.deal_id),
      lineage_url: lineageUrl(r.deal_id),
      stage: r.stage ?? '',
      legacy: r.legacy_score_0_100 ?? '',
      fundability: r.fundability_score_0_100 ?? '',
      cap: r.capped_max ?? '',
      phase: r.phase ?? '',
      conf: r.phase_confidence == null ? '' : Number(r.phase_confidence.toFixed(2)),
      outcome: r.outcome ?? '',
      topReason: summarizeCapReason(r.cap_reasons),
      missingSignals,
      supportedSignals: supported,
      supportingEvidence,
      missingEvidence: Array.isArray(r.missing_evidence) ? r.missing_evidence : [],
      nextRequests: Array.isArray(r.next_requests) ? r.next_requests : [],
    };
  }

  const md: string[] = [];
  md.push(`# Fundability v1 vs Legacy — Comparison Report`);
  md.push('');
  md.push(`Generated: ${report.generated_at}`);
  md.push(`API: ${summary.apiBaseUrl}`);
  md.push('');

  md.push('## Snapshot');
  md.push(
    mdTable(
      ['Metric', 'Value'],
      [
        ['Total deals', summary.totalDeals],
        ['Processed deals', summary.processedDeals],
        ['Deals with any fundability_v1 signals', summary.withFundabilityV1],
        ['Deals with fundability score', summary.withFundabilityScore],
        ['Comparable pairs (legacy + fundability score)', summary.comparablePairs],
        ['minAbsDelta filter', summary.minAbsDelta],
        ['Rows included in report output', summary.includedRows],
      ],
    ),
  );
  md.push('');

  if (diff && diff.changes.length > 0) {
    md.push('## Since last run (diff)');
    md.push(`Previous snapshot: ${diff.prevGeneratedAt}`);
    md.push(
      mdTable(
        ['Deal', 'Δ fundability', 'Δ phase conf', 'Missing signals improved', 'Segments added'],
        diff.changes.slice(0, 20).map((c) => [
          `${c.deal_name} (${c.deal_id})`,
          c.score_delta == null ? '' : String(c.score_delta),
          c.conf_delta == null ? '' : String(c.conf_delta),
          c.missing_signals_delta == null ? '' : String(c.missing_signals_delta),
          c.segments_added.length > 0 ? c.segments_added.join(', ') : '',
        ]),
      ),
    );
    md.push('');
  }

  md.push('## Where the holes are');
  md.push(
    mdTable(
      ['Hole', 'Count'],
      holesSection,
    ),
  );
  md.push('');

  md.push('### Example deals to debug (API links)');
  const exampleBlocks: Array<{ title: string; items: Array<{ id: string; name: string; url: string }> }> = [
    { title: 'Missing `fundability_v1`', items: exampleMissingFundability },
    { title: 'Missing `fundability_score_0_100`', items: exampleMissingScore },
    { title: 'Missing `phase_inference_v1.company_phase`', items: exampleMissingPhase },
    { title: 'Missing outcome (`fundability_decision_v1` / `fundability_assessment_v1`)', items: exampleMissingOutcome },
  ];
  for (const block of exampleBlocks) {
    md.push(`#### ${block.title}`);
    if (block.items.length === 0) {
      md.push('- (none)');
      md.push('');
      continue;
    }
    for (const it of block.items) {
      md.push(`- ${escapeMd(it.name)} — ${it.url}`);
    }
    md.push('');
  }

  md.push('## What data connects to what (fundability_v1 wiring)');
  md.push('- Legacy score source: `deal.score` (existing/legacy scoring output)');
  md.push('- Phase inference: `deal.fundability_v1.phase_inference_v1.company_phase` (+ confidence)');
  md.push('- Fundability score: `deal.fundability_v1.fundability_assessment_v1.fundability_score_0_100`');
  md.push('- Score capping: `deal.fundability_v1.fundability_assessment_v1.caps.max_fundability_score_0_100`');
  md.push('- Legacy score echoed into fundability slice: `deal.fundability_v1.fundability_assessment_v1.legacy_overall_score_0_100`');
  md.push('- Outcome: prefer `deal.fundability_v1.fundability_decision_v1.outcome`, else `deal.fundability_v1.fundability_assessment_v1.outcome`');
  md.push('');

  md.push('## Breakdown');
  md.push('### By outcome');
  md.push(mdTable(['Outcome', 'Count'], summary.byOutcome.map((x) => [x.key, x.count])));
  md.push('');

  if (capAppliedRows.length > 0) {
    md.push('## Why scores are capped (top reasons)');
    md.push(mdTable(['Cap reason', 'Count'], capReasonCounts.map((x) => [x.key, x.count])));
    md.push('');
  }

  if (missingSignalCounts.length > 0) {
    md.push('## Most common missing signals (from reasons/decision)');
    md.push(mdTable(['Signal', 'Count'], missingSignalCounts.map((x) => [x.key, x.count])));
    md.push('');
  }

  if (missingSignalCounts.length > 0) {
    md.push('## Micro debugging (what is connecting vs not)');
    md.push('This section links missing signals → example deals, and shows which signals are present/missing per deal.');
    md.push('');

    const topSignals = missingSignalCounts.map((x) => x.key).filter((k) => k !== 'none').slice(0, 8);
    const exampleDealsPerSignal = 8;
    const supportedSignalsPreview = 8;

    for (const signal of topSignals) {
      const candidates = report.rows
        .filter((r) => rowMissingSignals(r).includes(signal))
        .slice()
        .sort((a, b) => Math.abs((b.delta_f_minus_legacy ?? 0) as number) - Math.abs((a.delta_f_minus_legacy ?? 0) as number));

      md.push(`### Missing signal: ${escapeMd(signal)}`);
      if (candidates.length === 0) {
        md.push('- (no deals found)');
        md.push('');
        continue;
      }

      for (const r of takeTop(candidates, exampleDealsPerSignal)) {
        const m = microRow(r);
        const lineage = lineageByDealId.get(r.deal_id);
        md.push(`- ${escapeMd(m.deal)}`);
        md.push(`  - deal=${m.url}`);
        md.push(`  - lineage(debug_segments=1)=${m.lineage_url}`);
        md.push(
          `  - stage=${escapeMd(String(m.stage))} legacy=${m.legacy} fundability=${m.fundability} cap=${m.cap} phase=${escapeMd(String(m.phase))} conf=${m.conf} outcome=${escapeMd(String(m.outcome))}`
        );
        md.push(`  - top_reason=${escapeMd(capLimitOrEmpty(m.topReason, 120))}`);

        const missingPreview = takeTop(m.missingSignals, 12);
        md.push(`  - missing_signals=${escapeMd(missingPreview.join(', ') || '(none)')}`);

        const supportedPreview = takeTop(m.supportedSignals, supportedSignalsPreview);
        md.push(`  - supported_signals(sample)=${escapeMd(supportedPreview.join(', ') || '(none)')}`);

        const evidencePreview = takeTop(m.supportingEvidence, 8).map((e) => {
          const src = e.source ? `@${e.source}` : '';
          return `${e.signal}${src}`;
        });
        if (evidencePreview.length > 0) {
          md.push(`  - supporting_evidence(sample)=${escapeMd(evidencePreview.join(', '))}`);
        }

        const missingEvidencePreview = takeTop(m.missingEvidence, 12);
        if (missingEvidencePreview.length > 0) {
          md.push(`  - phase_missing_evidence=${escapeMd(missingEvidencePreview.join(', '))}`);
        }

        const phaseReq = getPhaseRequirements(m.phase);
        if (phaseReq.length > 0) {
          const missingForPhase = Array.isArray(m.missingEvidence) ? m.missingEvidence : [];
          const met = Math.max(0, phaseReq.length - missingForPhase.length);
          md.push(
            `  - phase_requirements_met=${met}/${phaseReq.length} (required: ${escapeMd(phaseReq.join(', '))})`
          );
        }

        const nextRequestsPreview = takeTop(m.nextRequests, 8);
        if (nextRequestsPreview.length > 0) {
          md.push(`  - next_requests=${escapeMd(nextRequestsPreview.join(' | '))}`);
        }

        if (lineage) {
          const segmentsPreview = takeTop(lineage.segments_present, 12);
          if (segmentsPreview.length > 0) {
            md.push(`  - segments_present=${escapeMd(segmentsPreview.join(', '))}`);
          }

          const missingSignals = m.missingSignals;
          const expected = uniq(missingSignals.flatMap((sig) => expectedSegmentsForSignal(sig)));
          if (expected.length > 0) {
            const presence = classifySegmentsPresence({ present: lineage.segments_present, expected });
            md.push(
              `  - expected_segments_for_missing_signals=${escapeMd(expected.join(', '))} (present: ${escapeMd(
                presence.present.join(', ') || 'none'
              )}; missing: ${escapeMd(presence.missing.join(', ') || 'none')})`
            );
          }

          const segsForSignals = Object.keys(lineage.extracted_signal_types_by_segment)
            .filter((k) => k !== 'unknown')
            .slice(0, 6);
          if (segsForSignals.length > 0) {
            const parts = segsForSignals.map((seg) => {
              const topTypes = lineage.extracted_signal_types_by_segment[seg] ?? [];
              const head = topTypes
                .slice(0, 4)
                .map((t) => `${t.type}(${t.count})`)
                .join(', ');
              return `${seg}: ${head || '(none)'}`;
            });
            md.push(`  - extracted_signal_types=${escapeMd(parts.join(' | '))}`);
          }

          const segsForDrivers = Object.keys(lineage.score_driver_deltas_by_segment)
            .filter((k) => k !== 'unknown')
            .slice(0, 6);
          if (segsForDrivers.length > 0) {
            const parts = segsForDrivers.map((seg) => {
              const topDrivers = lineage.score_driver_deltas_by_segment[seg] ?? [];
              const head = topDrivers
                .slice(0, 3)
                .map((d) => `${d.driver}(${d.delta_sum})`)
                .join(', ');
              return `${seg}: ${head || '(none)'}`;
            });
            md.push(`  - score_drivers(delta_sum)=${escapeMd(parts.join(' | '))}`);
          }

          const segsForAssets = Object.keys(lineage.top_assets_by_segment)
            .filter((k) => k !== 'unknown')
            .slice(0, 6);
          if (segsForAssets.length > 0) {
            const parts = segsForAssets.map((seg) => {
              const assets = lineage.top_assets_by_segment[seg] ?? [];
              const head = assets
                .slice(0, 3)
                .map((a) => {
                  const p = a.page_index == null ? '?' : String(a.page_index);
                  const t = a.asset_type ?? 'asset';
                  const s = a.summary ? capLimitOrEmpty(a.summary, 80) : '';
                  const ev = typeof a.evidence_count === 'number' ? a.evidence_count : 0;
                  return `va:${a.visual_asset_id} p${p} ${t} ev:${ev} ${s ? `"${s}"` : ''}`.trim();
                })
                .join(' ; ');
              return `${seg}: ${head || '(none)'}`;
            });
            md.push(`  - top_assets(sample)=${escapeMd(parts.join(' | '))}`);
          }

          const firstAsset = (() => {
            for (const seg of Object.keys(lineage.top_assets_by_segment)) {
              if (seg === 'unknown') continue;
              const a = (lineage.top_assets_by_segment[seg] ?? [])[0];
              if (a?.visual_asset_id) return a.visual_asset_id;
            }
            return null;
          })();
          if (firstAsset) {
            const cmd = `curl -s "${m.lineage_url}" | jq '.nodes[] | select(.id=="visual_asset:${firstAsset}")'`;
            md.push(`  - asset_lookup_hint=${escapeMd(cmd)}`);
          }

          if (lineage.warnings.length > 0) {
            md.push(`  - lineage_warnings=${escapeMd(takeTop(lineage.warnings, 4).join(' | '))}`);
          }
        }
      }

      md.push('');
    }

    md.push('### Notes for “extract visuals” runs');
    md.push('- Visual extraction primarily increases OCR/visual evidence; it may or may not affect phase signals depending on which signal extractors consume visuals.');
    md.push('- After running extract-visuals, re-run analysis for the deal(s), then regenerate this report to see supported/missing signal changes.');
    md.push('- Use the lineage link above to see segment → extracted_signals → score_contributions for each page/asset.');
    md.push('');
  }

  if (summary.withFundabilityV1 === 0) {
    md.push('## Interpretation (why everything is missing)');
    md.push('- This run found **zero** deals emitting any `fundability_v1` signals. That means this report cannot compare legacy vs fundability yet.');
    md.push('- Most common causes:');
    md.push('  - Fundability feature flags are not enabled in the analyzer runtime (worker/orchestrator).');
    md.push('  - Deals have not been re-analyzed since fundability outputs were added (latest DIOs are old).');
    md.push('  - API/worker process is not running the latest code (stale container / older deploy).');
    md.push('- Fastest validation path:');
    md.push('  - Enable `FUNDABILITY_SHADOW_MODE=1` (and optionally `FUNDABILITY_SOFT_CAPS=1`, `FUNDABILITY_HARD_GATES=1`) in the worker runtime.');
    md.push('  - Re-run analysis for 1 deal, then verify `fundability_v1` appears on its detail response.');
    md.push('');
  }
  md.push('### By phase');
  md.push(mdTable(['Phase', 'Count'], summary.byPhase.map((x) => [x.key, x.count])));
  md.push('');

  md.push('## Largest score deltas (absolute)');
  if (topDeltaRows.length === 0) {
    md.push('- (no comparable rows)');
  } else {
    md.push(
      mdTable(
        ['Deal', 'Stage', 'Legacy', 'Fundability', 'Δ (F-L)', 'Cap', 'Phase', 'Outcome', 'Top reason'],
        topDeltaRows.map((r) => [
          `${r.deal_name} (${r.deal_id})`,
          r.stage ?? '',
          r.legacy_score_0_100 ?? '',
          r.fundability_score_0_100 ?? '',
          r.delta_f_minus_legacy ?? '',
          r.capped_max ?? '',
          r.phase ?? '',
          r.outcome ?? '',
          summarizeCapReason(r.cap_reasons),
        ]),
      ),
    );
  }
  md.push('');

  md.push('## Debugging checklist (quick)');
  md.push('- If `fundability_v1` is missing: confirm fundability outputs are being emitted for that deal (and that the API mapping includes them).');
  md.push('- If phase exists but score is missing: check the fundability assessment step ran and produced a score for the inferred phase.');
  md.push('- If score exists but outcome is missing: check decision emission (hard gates) vs assessment-only output.');
  md.push('- If a score is capped: inspect `fundability_assessment_v1.reasons` and `fundability_decision_v1.missing_required_signals` for what evidence is missing.');
  md.push('- Use the per-deal API link above to inspect the full `fundability_v1` payload and compare against legacy fields.');
  md.push('');

  return md.join('\n');
}

async function main() {
  const { args } = parseArgs(process.argv.slice(2));
  if (args.help) {
    // eslint-disable-next-line no-console
    console.log(usage());
    return;
  }

  const apiBaseUrl = String(args['api-base-url'] ?? 'http://localhost:9000').replace(/\/$/, '');
  const dealIdFilter = typeof args['deal-id'] === 'string' ? String(args['deal-id']).trim() : null;
  const dealNameContains = typeof args['deal-name-contains'] === 'string' ? String(args['deal-name-contains']).trim() : null;
  const outPath = typeof args.out === 'string' ? args.out : null;
  const format = String(args.format ?? 'json');
  const outMdPath = typeof args['out-md'] === 'string' ? String(args['out-md']) : null;
  const snapshotPath = typeof args.snapshot === 'string' ? String(args.snapshot) : 'artifacts/fundability-compare.snapshot.json';
  const diffEnabled = String(args['no-diff'] ?? '') !== 'true';
  const minAbsDelta = Number(args['min-abs-delta'] ?? 0);
  const limit = args.limit != null ? Number(args.limit) : null;

  if (!Number.isFinite(minAbsDelta) || minAbsDelta < 0) {
    throw new Error('--min-abs-delta must be a non-negative number');
  }
  if (limit != null && (!Number.isFinite(limit) || limit <= 0)) {
    throw new Error('--limit must be a positive number');
  }
  if (format !== 'json' && format !== 'md') {
    throw new Error('--format must be one of: json, md');
  }

  const res = await fetch(`${apiBaseUrl}/api/v1/deals`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to fetch /api/v1/deals (${res.status}): ${text.slice(0, 500)}`);
  }

  const deals = (await res.json()) as DealListItem[];

  const filteredDeals = deals.filter((d) => {
    if (dealIdFilter && d.id !== dealIdFilter) return false;
    if (dealNameContains) {
      const name = typeof d.name === 'string' ? d.name : '';
      if (!name.toLowerCase().includes(dealNameContains.toLowerCase())) return false;
    }
    return true;
  });

  const slice = limit != null ? filteredDeals.slice(0, limit) : filteredDeals;
  const dealsById = new Map<string, DealListItem>(slice.map((d) => [d.id, d]));

  const rowsAll: ReportRow[] = slice.map((deal) => {
    const legacyScore = toNumberOrNull(deal.score);
    const fundabilityScore = toNumberOrNull(deal.fundability_v1?.fundability_assessment_v1?.fundability_score_0_100);
    const delta = legacyScore != null && fundabilityScore != null ? fundabilityScore - legacyScore : null;

    const capReasons = deal.fundability_v1?.fundability_assessment_v1?.reasons;
    const missingFromDecision = deal.fundability_v1?.fundability_decision_v1?.missing_required_signals;
    const nextRequests = deal.fundability_v1?.fundability_decision_v1?.next_requests;
    const missingEvidence = deal.fundability_v1?.phase_inference_v1?.missing_evidence;
    const supportedEvidence = toSupportingEvidence(deal.fundability_v1?.phase_inference_v1?.supporting_evidence);
    const supportedSignals = supportedEvidence.map((e) => e.signal);

    return {
      deal_id: deal.id,
      deal_name: deal.name,
      stage: deal.stage,
      legacy_score_0_100: round0(legacyScore),
      fundability_score_0_100: round0(fundabilityScore),
      delta_f_minus_legacy: delta == null ? null : Number(delta.toFixed(1)),
      phase: deal.fundability_v1?.phase_inference_v1?.company_phase ?? null,
      phase_confidence: toNumberOrNull(deal.fundability_v1?.phase_inference_v1?.confidence),
      outcome:
        deal.fundability_v1?.fundability_decision_v1?.outcome ??
        deal.fundability_v1?.fundability_assessment_v1?.outcome ??
        null,
      spec_version: deal.fundability_v1?.spec_version ?? null,
      capped_max: toNumberOrNull(deal.fundability_v1?.fundability_assessment_v1?.caps?.max_fundability_score_0_100),
      cap_reasons: Array.isArray(capReasons) ? capReasons.filter((x) => typeof x === 'string') : undefined,
      missing_required_signals: Array.isArray(missingFromDecision) ? missingFromDecision.filter((x) => typeof x === 'string') : undefined,
      next_requests: Array.isArray(nextRequests) ? nextRequests.filter((x) => typeof x === 'string') : undefined,
      missing_evidence: Array.isArray(missingEvidence) ? missingEvidence.filter((x) => typeof x === 'string') : undefined,
      supported_signals: supportedSignals.length > 0 ? supportedSignals : undefined,
      supporting_evidence: supportedEvidence.length > 0 ? supportedEvidence : undefined,
    };
  });

  const rows = rowsAll.filter((r) => {
    if (r.delta_f_minus_legacy == null) return minAbsDelta === 0;
    return Math.abs(r.delta_f_minus_legacy) >= minAbsDelta;
  });

  const summary = {
    apiBaseUrl,
    totalDeals: deals.length,
    processedDeals: slice.length,
    withFundabilityV1: rowsAll.filter((r) => r.spec_version != null || r.phase != null || r.outcome != null).length,
    withFundabilityScore: rowsAll.filter((r) => r.fundability_score_0_100 != null).length,
    comparablePairs: rowsAll.filter((r) => r.fundability_score_0_100 != null && r.legacy_score_0_100 != null).length,
    minAbsDelta,
    includedRows: rows.length,
    byOutcome: groupCount(rowsAll, (r) => r.outcome ?? 'none'),
    byPhase: groupCount(rowsAll, (r) => r.phase ?? 'none'),
  };

  const holes = {
    missingFundabilityV1: rowsAll.filter((r) => r.spec_version == null && r.phase == null && r.outcome == null).map((r) => r.deal_id),
    missingFundabilityScore: rowsAll.filter((r) => r.fundability_score_0_100 == null).map((r) => r.deal_id),
    missingPhase: rowsAll.filter((r) => r.phase == null).map((r) => r.deal_id),
    missingOutcome: rowsAll.filter((r) => r.outcome == null).map((r) => r.deal_id),
    missingLegacyScore: rowsAll.filter((r) => r.legacy_score_0_100 == null).map((r) => r.deal_id),
  };

  const report: FundabilityCompareReport = { generated_at: new Date().toISOString(), summary, rows, holes };

  if (format === 'md') {
    const lineageByDealId = new Map<string, DealLineageSummary>();
    try {
      const dealIds = computeMicroDebugDealIds(report);
      const summaries = await mapWithConcurrency(dealIds, 4, async (dealId) => {
        const url = `${apiBaseUrl}/api/v1/deals/${dealId}/lineage?debug_segments=1`;
        const lr = await fetch(url);
        if (!lr.ok) {
          const text = await lr.text().catch(() => '');
          throw new Error(`Failed lineage for ${dealId} (${lr.status}): ${text.slice(0, 200)}`);
        }
        const json = (await lr.json()) as DealLineageResponse;
        return toLineageSummary(json);
      });
      for (const s of summaries) lineageByDealId.set(s.deal_id, s);
    } catch {
      // Best-effort; report still renders without lineage summaries.
    }

    let diff: { prevGeneratedAt: string; changes: ReturnType<typeof diffSnapshot> } | undefined;
    if (diffEnabled) {
      try {
        const fs = await import('node:fs/promises');
        const prevRaw = await fs.readFile(snapshotPath, 'utf8');
        const prev = JSON.parse(prevRaw) as FundabilityCompareSnapshot;
        const curr = toSnapshot({ report, lineageByDealId });
        const changes = diffSnapshot(prev, curr);
        diff = { prevGeneratedAt: prev.generated_at, changes };
      } catch {
        // ignore missing/invalid snapshot
      }
    }

    const md = toMarkdownReport(report, dealsById, lineageByDealId, diff);
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const targetPath = outMdPath ?? 'docs/Active/audit/analizer-debug/fundability-compare.md';
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, md, 'utf8');

    // Update snapshot for next run.
    try {
      const snap = toSnapshot({ report, lineageByDealId });
      await fs.mkdir(path.dirname(snapshotPath), { recursive: true });
      await fs.writeFile(snapshotPath, JSON.stringify(snap, null, 2), 'utf8');
    } catch {
      // best-effort
    }

    // eslint-disable-next-line no-console
    console.log(`Wrote Markdown report: ${targetPath}`);
    return;
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(report, null, 2));

  if (outPath) {
    const fs = await import('node:fs/promises');
    await fs.mkdir((await import('node:path')).dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, JSON.stringify(report, null, 2), 'utf8');
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(String(err?.stack ?? err));
  process.exitCode = 1;
});
