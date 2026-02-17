import { buildWorkspaceMirrorOverviewVM } from '../apps/web/src/lib/workspaceMirrorPr2ViewModel';
import { deterministicIsDisplayable } from '../apps/web/src/lib/deterministicDisplayPolicy';

export type DivergenceCategory =
  | 'CONTRACT_MISMATCH'
  | 'PRODUCER_SKIPPED_GOVERNED'
  | 'EVIDENCE_MISSING'
  | 'DETERMINISTIC_OVERRIDE'
  | 'UI_WIRING'
  | 'VERIFICATION_GAP'
  | 'NONE';

export type EvidenceState = {
  refs_applicable: boolean;
  refs_count: number;
  ids_applicable: boolean;
  ids_count: number;
  note?: string;
};

export type FieldDiff = {
  field:
    | 'hero_summary'
    | 'product_solution'
    | 'market_icp'
    | 'business_model'
    | 'raise_terms'
    | 'strengths'
    | 'concerns'
    | 'open_questions'
    | 'traction';

  expected_value: string;
  expected_source: 'governed' | 'deterministic' | 'missing';
  expected_evidence_state: EvidenceState;

  runtime_overlay_value: string | null;
  runtime_overlay_source: 'governed' | 'deterministic' | 'missing' | null;

  runtime_det_value: string | null;

  divergence_category: DivergenceCategory;
  likely_root_files: string[];
};

// IMPORTANT: This comparator mirrors the actual UI chooser in DealWorkspace.
// It trims strings and treats the em-dash as empty, but it does NOT try to
// suppress OCR soup at extraction time.
const asClean = (value: unknown): string | null => {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s || s === '—') return null;
  return s;
};

function getCanonicalDealSummaryV1(reportJson: any): any | null {
  const ds = reportJson?.deal_summary ?? reportJson?.report?.deal_summary ?? null;
  return ds && typeof ds === 'object' ? ds : null;
}

function canonicalReady(reportJson: any): { ready: boolean; ds: any | null } {
  const ds = getCanonicalDealSummaryV1(reportJson);
  const ready = Boolean(ds && typeof ds === 'object' && ds.ready === true);
  return { ready, ds };
}

function getDeterministicCandidates(reportJson: any): {
  canonicalTierOverview: string | null;
  canonicalTierHero: string | null;
  canonicalProduct: string | null;
  canonicalMarket: string | null;
  structuredRaise: string | null;
  structuredBusinessModel: string | null;
} {
  const { ready, ds } = canonicalReady(reportJson);

  const tiers = ready && ds?.tiers && typeof ds.tiers === 'object' ? ds.tiers : null;
  const canonicalTierHero = ready ? asClean(tiers?.hero) : null;
  const canonicalTierOverview = ready ? asClean(tiers?.overview) : null;

  const canonicalProduct = ready ? asClean(ds?.product?.text) : null;
  const canonicalMarket =
    ready
      ? (asClean(ds?.market_target?.text) || asClean(ds?.market?.text) || asClean(ds?.market_context?.text))
      : null;

  const structured = reportJson?.structured_summary && typeof reportJson.structured_summary === 'object' ? reportJson.structured_summary : null;
  const structuredRaise = asClean(structured?.raise?.value);
  const structuredBusinessModel = asClean(structured?.business_model?.value);

  return {
    canonicalTierOverview,
    canonicalTierHero,
    canonicalProduct,
    canonicalMarket,
    structuredRaise,
    structuredBusinessModel,
  };
}

function chooseGovernedFirst(opts: {
  deterministic: string | null;
  overlay?: { value: string | null; source?: 'governed' | 'deterministic' | 'missing' } | null;
}): { value: string; provenance: { source: 'governed' | 'deterministic' | 'missing' }; fromOverlay: boolean; detDisplayable: boolean } {
  // Mirrors the logic described in docs/forensics/deal_workspace_overview_render_truth_table.md anchor A7.
  const keyFactMissingText = 'Not extracted from evidence';

  const overlayVal = asClean(opts.overlay?.value);
  const overlaySource = opts.overlay?.source;

  if (overlayVal && overlaySource === 'governed') {
    return { value: overlayVal, provenance: { source: 'governed' }, fromOverlay: true, detDisplayable: false };
  }

  const detVal = asClean(opts.deterministic);
  const detDisplayable = detVal ? deterministicIsDisplayable(detVal) : false;
  if (detVal && detDisplayable) {
    return { value: detVal, provenance: { source: 'deterministic' }, fromOverlay: false, detDisplayable: true };
  }

  if (overlayVal) {
    return { value: overlayVal, provenance: { source: 'deterministic' }, fromOverlay: true, detDisplayable };
  }
  if (detVal) {
    return { value: detVal, provenance: { source: 'deterministic' }, fromOverlay: false, detDisplayable };
  }

  return { value: keyFactMissingText, provenance: { source: 'missing' }, fromOverlay: false, detDisplayable };
}

function evidenceStateForKeyFact(args: {
  chosen: ReturnType<typeof chooseGovernedFirst>;
  overlayEvidenceIds?: unknown;
  overlayEvidenceRefs?: unknown;
}): EvidenceState {
  const ids = Array.isArray(args.overlayEvidenceIds) ? args.overlayEvidenceIds : [];
  const refs = Array.isArray(args.overlayEvidenceRefs) ? args.overlayEvidenceRefs : [];

  return {
    refs_applicable: args.chosen.provenance.source === 'governed',
    refs_count: args.chosen.provenance.source === 'governed' ? refs.length : 0,
    ids_applicable: args.chosen.fromOverlay,
    ids_count: args.chosen.fromOverlay ? ids.length : 0,
  };
}

function overlaySkipReason(overlayJson: any): string | null {
  const ov = overlayJson?.overview && typeof overlayJson.overview === 'object' ? overlayJson.overview : null;
  const phase1 = ov?.overview_json?.phase1;
  const guiQ = phase1?.governed_ui_copy_v1_quality;
  const dfq = ov?.overview_json?.display_facts_v1_quality;
  const s1 = typeof guiQ?.skipped_reason === 'string' ? guiQ.skipped_reason : null;
  const s2 = typeof dfq?.skipped_reason === 'string' ? dfq.skipped_reason : null;
  return s1 ?? s2;
}

export function computeOverviewTruthTableDiff(args: {
  governedOverlayJson: any;
  reportJson: any;
}): FieldDiff[] {
  const overlayJson = args.governedOverlayJson;
  const reportJson = args.reportJson;

  const overlayOverview = overlayJson?.overview ?? null;
  const vm = buildWorkspaceMirrorOverviewVM(overlayJson);
  const det = getDeterministicCandidates(reportJson);

  const skipReason = overlaySkipReason(overlayJson);

  const likelyNoEvidenceRoots = [
    'apps/worker/src/lib/governed-llm-overlay.ts (generateDisplayFactsV1BestEffort, fetchDpuSnippet, pickSourcesForField, coerceSourceArray)',
    'apps/web/src/lib/workspaceMirrorPr2ViewModel.ts (buildWorkspaceMirrorOverviewVM evidence mapping)',
  ];

  const likelyOverrideRoots = [
    'apps/web/src/components/pages/DealWorkspace.tsx (governedKeyFacts.chooseGovernedFirst)',
    'apps/web/src/lib/deterministicDisplayPolicy.ts (deterministicIsDisplayable)',
  ];

  const out: FieldDiff[] = [];

  // hero_summary (governed panel one-liner)
  {
    const overlayVal = vm.missing ? null : vm.one_liner;
    const overlaySource = vm.missing ? null : (vm.field_sources.hero_summary as any);

    const summaryText = asClean(overlayOverview?.summary_text);
    const fallbackTierOverview = det.canonicalTierOverview;
    const fallbackTierHero = det.canonicalTierHero;

    const expected = overlayVal || summaryText || fallbackTierOverview || fallbackTierHero || 'Not extracted';

    const expectedSource: 'governed' | 'deterministic' | 'missing' =
      overlayVal
        ? (overlaySource === 'governed' ? 'governed' : overlaySource === 'deterministic' ? 'deterministic' : 'deterministic')
        : summaryText || fallbackTierOverview || fallbackTierHero
          ? 'deterministic'
          : 'missing';

    out.push({
      field: 'hero_summary',
      expected_value: expected,
      expected_source: expectedSource,
      expected_evidence_state: { refs_applicable: false, refs_count: 0, ids_applicable: false, ids_count: 0, note: 'Hero evidence is not wired as ids; refs only appear via governed key-fact wiring.' },
      runtime_overlay_value: overlayVal,
      runtime_overlay_source: overlaySource,
      runtime_det_value: fallbackTierOverview || fallbackTierHero,
      divergence_category:
        skipReason === 'no_evidence' && !overlayVal && (summaryText || fallbackTierOverview || fallbackTierHero)
          ? 'PRODUCER_SKIPPED_GOVERNED'
          : 'NONE',
      likely_root_files:
        skipReason === 'no_evidence' ? likelyNoEvidenceRoots : [],
    });
  }

  // Key facts
  {
    const productOverlay = vm.missing ? null : { value: vm.facts.product_solution.value, source: vm.facts.product_solution.source as any };
    const detVal = det.canonicalProduct;
    const chosen = chooseGovernedFirst({ deterministic: detVal, overlay: productOverlay });

    const evidence = evidenceStateForKeyFact({
      chosen,
      overlayEvidenceIds: vm.missing ? [] : (vm.facts.product_solution.evidence_ids ?? []),
      overlayEvidenceRefs: vm.missing ? [] : (vm.facts.product_solution.evidence_refs ?? []),
    });

    const category: DivergenceCategory =
      productOverlay?.source === 'governed' && chosen.provenance.source === 'deterministic' && chosen.detDisplayable
        ? 'DETERMINISTIC_OVERRIDE'
        : skipReason === 'no_evidence' && (productOverlay?.source === 'missing' || productOverlay?.value == null)
          ? 'PRODUCER_SKIPPED_GOVERNED'
          : 'NONE';

    out.push({
      field: 'product_solution',
      expected_value: chosen.value,
      expected_source: chosen.provenance.source,
      expected_evidence_state: evidence,
      runtime_overlay_value: productOverlay?.value ?? null,
      runtime_overlay_source: productOverlay?.source ?? null,
      runtime_det_value: detVal ?? null,
      divergence_category: category,
      likely_root_files:
        category === 'DETERMINISTIC_OVERRIDE' ? likelyOverrideRoots : (skipReason === 'no_evidence' ? likelyNoEvidenceRoots : []),
    });
  }

  {
    const marketOverlay = vm.missing ? null : { value: vm.facts.market_icp.value, source: vm.facts.market_icp.source as any };
    const detVal = det.canonicalMarket;
    const chosen = chooseGovernedFirst({ deterministic: detVal, overlay: marketOverlay });

    const evidence = evidenceStateForKeyFact({
      chosen,
      overlayEvidenceIds: vm.missing ? [] : (vm.facts.market_icp.evidence_ids ?? []),
      overlayEvidenceRefs: vm.missing ? [] : (vm.facts.market_icp.evidence_refs ?? []),
    });

    const category: DivergenceCategory =
      marketOverlay?.source === 'governed' && chosen.provenance.source === 'deterministic' && chosen.detDisplayable
        ? 'DETERMINISTIC_OVERRIDE'
        : skipReason === 'no_evidence' && (marketOverlay?.source === 'missing' || marketOverlay?.value == null)
          ? 'PRODUCER_SKIPPED_GOVERNED'
          : 'NONE';

    out.push({
      field: 'market_icp',
      expected_value: chosen.value,
      expected_source: chosen.provenance.source,
      expected_evidence_state: evidence,
      runtime_overlay_value: marketOverlay?.value ?? null,
      runtime_overlay_source: marketOverlay?.source ?? null,
      runtime_det_value: detVal ?? null,
      divergence_category: category,
      likely_root_files:
        category === 'DETERMINISTIC_OVERRIDE' ? likelyOverrideRoots : (skipReason === 'no_evidence' ? likelyNoEvidenceRoots : []),
    });
  }

  {
    const bmOverlay = vm.missing ? null : { value: vm.facts.business_model.value, source: vm.facts.business_model.source as any };
    const detVal = det.structuredBusinessModel;
    const chosen = chooseGovernedFirst({ deterministic: detVal, overlay: bmOverlay });

    const evidence = evidenceStateForKeyFact({
      chosen,
      overlayEvidenceIds: vm.missing ? [] : (vm.facts.business_model.evidence_ids ?? []),
      overlayEvidenceRefs: vm.missing ? [] : (vm.facts.business_model.evidence_refs ?? []),
    });

    const category: DivergenceCategory =
      bmOverlay?.source === 'governed' && chosen.provenance.source === 'deterministic' && chosen.detDisplayable
        ? 'DETERMINISTIC_OVERRIDE'
        : skipReason === 'no_evidence' && (bmOverlay?.source === 'missing' || bmOverlay?.value == null)
          ? 'PRODUCER_SKIPPED_GOVERNED'
          : 'NONE';

    out.push({
      field: 'business_model',
      expected_value: chosen.value,
      expected_source: chosen.provenance.source,
      expected_evidence_state: evidence,
      runtime_overlay_value: bmOverlay?.value ?? null,
      runtime_overlay_source: bmOverlay?.source ?? null,
      runtime_det_value: detVal ?? null,
      divergence_category: category,
      likely_root_files:
        category === 'DETERMINISTIC_OVERRIDE' ? likelyOverrideRoots : (skipReason === 'no_evidence' ? likelyNoEvidenceRoots : []),
    });
  }

  {
    const raiseOverlay = vm.missing ? null : { value: vm.facts.raise.value, source: vm.facts.raise.source as any };
    const detVal = det.structuredRaise;
    const chosen = chooseGovernedFirst({ deterministic: detVal, overlay: raiseOverlay });

    const evidence = evidenceStateForKeyFact({
      chosen,
      overlayEvidenceIds: vm.missing ? [] : (vm.facts.raise.evidence_ids ?? []),
      overlayEvidenceRefs: vm.missing ? [] : (vm.facts.raise.evidence_refs ?? []),
    });

    const category: DivergenceCategory =
      raiseOverlay?.source === 'governed' && chosen.provenance.source === 'deterministic' && chosen.detDisplayable
        ? 'DETERMINISTIC_OVERRIDE'
        : skipReason === 'no_evidence' && (raiseOverlay?.source === 'missing' || raiseOverlay?.value == null)
          ? 'PRODUCER_SKIPPED_GOVERNED'
          : 'NONE';

    out.push({
      field: 'raise_terms',
      expected_value: chosen.value,
      expected_source: chosen.provenance.source,
      expected_evidence_state: evidence,
      runtime_overlay_value: raiseOverlay?.value ?? null,
      runtime_overlay_source: raiseOverlay?.source ?? null,
      runtime_det_value: detVal ?? null,
      divergence_category: category,
      likely_root_files:
        category === 'DETERMINISTIC_OVERRIDE' ? likelyOverrideRoots : (skipReason === 'no_evidence' ? likelyNoEvidenceRoots : []),
    });
  }

  // Lists (governed panel only)
  const listFields: Array<{ field: FieldDiff['field']; value: string[]; source: any; evidenceRefs: any }> = vm.missing
    ? [
        { field: 'strengths', value: [], source: 'missing', evidenceRefs: [] },
        { field: 'concerns', value: [], source: 'missing', evidenceRefs: [] },
        { field: 'open_questions', value: [], source: 'missing', evidenceRefs: [] },
        { field: 'traction', value: [], source: 'missing', evidenceRefs: [] },
      ]
    : [
        { field: 'strengths', value: vm.strengths, source: vm.field_sources.strengths, evidenceRefs: vm.evidence_refs.strengths },
        { field: 'concerns', value: vm.risks, source: vm.field_sources.concerns, evidenceRefs: vm.evidence_refs.concerns },
        { field: 'open_questions', value: vm.open_questions, source: vm.field_sources.open_questions, evidenceRefs: vm.evidence_refs.open_questions },
        { field: 'traction', value: vm.traction_signals, source: vm.field_sources.traction, evidenceRefs: vm.evidence_refs.traction },
      ];

  for (const lf of listFields) {
    const expectedValue = lf.value.length > 0 ? lf.value.join('\n') : 'Not available';
    const expectedSource: any = lf.value.length > 0 ? (lf.source === 'governed' ? 'governed' : 'deterministic') : 'missing';

    out.push({
      field: lf.field,
      expected_value: expectedValue,
      expected_source: expectedSource,
      expected_evidence_state: {
        refs_applicable: expectedSource === 'governed',
        refs_count: expectedSource === 'governed' ? (Array.isArray(lf.evidenceRefs) ? lf.evidenceRefs.length : 0) : 0,
        ids_applicable: false,
        ids_count: 0,
      },
      runtime_overlay_value: lf.value.length > 0 ? expectedValue : null,
      runtime_overlay_source: lf.source ?? null,
      runtime_det_value: null,
      divergence_category: skipReason === 'no_evidence' && lf.value.length === 0 ? 'PRODUCER_SKIPPED_GOVERNED' : 'NONE',
      likely_root_files: skipReason === 'no_evidence' ? likelyNoEvidenceRoots : [],
    });
  }

  return out;
}

async function main() {
  const dealId = process.env.DEAL_ID || process.argv.find((a) => a.startsWith('--deal-id='))?.split('=')[1];
  const apiBaseUrl = process.env.API_BASE_URL || process.argv.find((a) => a.startsWith('--api-base-url='))?.split('=')[1] || 'http://localhost:9001';

  if (!dealId) {
    console.error('Missing DEAL_ID. Usage: DEAL_ID=<uuid> pnpm tsx scripts/overview-truth-table-comparator.ts');
    process.exit(2);
  }

  const overlayRes = await fetch(`${apiBaseUrl}/api/v1/deals/${dealId}/governed-llm-overview`, { headers: { accept: 'application/json' } });
  const reportRes = await fetch(`${apiBaseUrl}/api/v1/deals/${dealId}/report`, { headers: { accept: 'application/json' } });

  const governedOverlayJson = await overlayRes.json().catch(() => null);
  const reportJson = await reportRes.json().catch(() => null);

  const diffs = computeOverviewTruthTableDiff({ governedOverlayJson, reportJson });

  const out = {
    deal_id: dealId,
    api_base_url: apiBaseUrl,
    overlay_http_status: overlayRes.status,
    report_http_status: reportRes.status,
    overlay_skip_reason: overlaySkipReason(governedOverlayJson),
    diffs,
  };

  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}

// Run as a script (tsx)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
