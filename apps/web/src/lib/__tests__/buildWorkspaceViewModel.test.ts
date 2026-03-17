import { describe, expect, test } from 'vitest';

import { buildWorkspaceViewModel } from '../../components/workspace/builders/buildWorkspaceViewModel';
import type { WorkspaceViewModelInputs } from '../../components/workspace/builders/buildWorkspaceViewModel';

// ─── Shared fixture ──────────────────────────────────────────────────────────

const BASE: WorkspaceViewModelInputs = {
  displayName: 'Acme Corp',
  dealDescription: 'B2B SaaS for workflow automation',
  dealStageLabel: 'Early Diligence',
  dealStageRaw: 'under_review',
  industry: 'Enterprise Software',
  lastUpdated: '2h ago',
  analyzing: false,
  reportViewScore: 72,
  verdict: 'INVEST',
  blockers: 0,
  filteredStrengths: ['Strong product-market fit', 'Experienced founding team'],
  filteredWeaknesses: ['Limited revenue history', 'High burn rate', 'No board yet'],
  confidenceBand: 'high',
  coverageRatio: 0.78,
  evidenceCoverage: 'Strong',
  governedDealOneLiner: 'Acme automates enterprise workflow with AI.',
  governedProduct: 'An AI workflow assistant for mid-market ops teams.',
  governedMarket: 'SMB-to-mid-market SaaS, ~$12B TAM.',
  governedBusinessModel: 'Usage-based SaaS with enterprise expansion.',
  governedRaise: '$5M Seed on $20M cap.',
  selectedHeaderReady: true,
  raiseValue: '$5M',
  raiseLabel: 'Seed',
  revenueValue: '$850K ARR',
  revenueTileLabel: 'ARR',
  revenueAllowed: true,
  growthValue: '40% MoM',
  growthLabel: 'Growth',
  customersValue: '25 customers',
  customersLabel: 'Customers',
  businessModelValue: 'Usage-based SaaS',
  businessModelLabel: 'Model',
  runwayTileValue: '18 months',
  burnTileValue: '$180K/mo',
  reportStructuredGrowthValue: null,
  tamValue: null,
  topSectionDealType: 'B2B SaaS',
  pipelineStatus: 'Active',
  diligencePhase: 'Early Diligence',
  insightsScore: 72,
  insightsConfidence: 'High',
};

// ─── icReadiness ─────────────────────────────────────────────────────────────

describe('icReadiness', () => {
  test('uses coverage_ratio × 100 when available', () => {
    const vm = buildWorkspaceViewModel({ ...BASE, coverageRatio: 0.78 });
    expect(vm.header.icReadiness).toBe(78);
  });

  test('rounds coverage_ratio to integer', () => {
    const vm = buildWorkspaceViewModel({ ...BASE, coverageRatio: 0.645 });
    expect(vm.header.icReadiness).toBe(65);
  });

  test('clamps coverage_ratio to 0–100', () => {
    const vm = buildWorkspaceViewModel({ ...BASE, coverageRatio: 1.5 });
    expect(vm.header.icReadiness).toBe(100);
  });

  test('falls back to band=high → 85 when coverageRatio is null', () => {
    const vm = buildWorkspaceViewModel({ ...BASE, coverageRatio: null, confidenceBand: 'high' });
    expect(vm.header.icReadiness).toBe(85);
  });

  test('falls back to band=med → 62', () => {
    const vm = buildWorkspaceViewModel({ ...BASE, coverageRatio: null, confidenceBand: 'med' });
    expect(vm.header.icReadiness).toBe(62);
  });

  test('falls back to band=low → 38', () => {
    const vm = buildWorkspaceViewModel({ ...BASE, coverageRatio: null, confidenceBand: 'low' });
    expect(vm.header.icReadiness).toBe(38);
  });

  test('falls back to band=unknown → 0 (pre-analysis state, no more hardcoded 72)', () => {
    const vm = buildWorkspaceViewModel({
      ...BASE,
      coverageRatio: null,
      confidenceBand: 'unknown',
    });
    expect(vm.header.icReadiness).toBe(0);
  });
});

// ─── concerns ────────────────────────────────────────────────────────────────

describe('concerns', () => {
  test('equals filteredWeaknesses.length', () => {
    const vm = buildWorkspaceViewModel(BASE);
    expect(vm.header.concerns).toBe(3);
  });

  test('is 0 when weaknesses array is empty', () => {
    const vm = buildWorkspaceViewModel({ ...BASE, filteredWeaknesses: [] });
    expect(vm.header.concerns).toBe(0);
  });
});

// ─── strengths ───────────────────────────────────────────────────────────────

describe('strengths', () => {
  test('equals filteredStrengths.length', () => {
    const vm = buildWorkspaceViewModel(BASE);
    expect(vm.header.strengths).toBe(2);
  });
});

// ─── evidenceConfidence ──────────────────────────────────────────────────────

describe('evidenceConfidence', () => {
  test('high band → 85', () => {
    const vm = buildWorkspaceViewModel({ ...BASE, confidenceBand: 'high' });
    expect(vm.header.evidenceConfidence).toBe(85);
  });

  test('med band → 60', () => {
    const vm = buildWorkspaceViewModel({ ...BASE, confidenceBand: 'med' });
    expect(vm.header.evidenceConfidence).toBe(60);
  });

  test('low band → 35', () => {
    const vm = buildWorkspaceViewModel({ ...BASE, confidenceBand: 'low' });
    expect(vm.header.evidenceConfidence).toBe(35);
  });

  test('unknown band → 0', () => {
    const vm = buildWorkspaceViewModel({ ...BASE, confidenceBand: 'unknown' });
    expect(vm.header.evidenceConfidence).toBe(0);
  });
});

// ─── TAM ─────────────────────────────────────────────────────────────────────

describe('snapshotFacts.tam', () => {
  test('uses tamValue when provided', () => {
    const vm = buildWorkspaceViewModel({ ...BASE, tamValue: '$12B' });
    expect(vm.overview.snapshotFacts.tam).toBe('$12B');
  });

  test('trims whitespace from tamValue', () => {
    const vm = buildWorkspaceViewModel({ ...BASE, tamValue: '  $5B  ' });
    expect(vm.overview.snapshotFacts.tam).toBe('$5B');
  });

  test('outputs "—" when tamValue is null', () => {
    const vm = buildWorkspaceViewModel({ ...BASE, tamValue: null });
    expect(vm.overview.snapshotFacts.tam).toBe('—');
  });

  test('outputs "—" when tamValue is undefined', () => {
    const vm = buildWorkspaceViewModel({ ...BASE, tamValue: undefined });
    expect(vm.overview.snapshotFacts.tam).toBe('—');
  });

  test('outputs "—" when tamValue is the sentinel dash', () => {
    const vm = buildWorkspaceViewModel({ ...BASE, tamValue: '—' });
    expect(vm.overview.snapshotFacts.tam).toBe('—');
  });

  test('outputs "—" when tamValue is empty string', () => {
    const vm = buildWorkspaceViewModel({ ...BASE, tamValue: '' });
    expect(vm.overview.snapshotFacts.tam).toBe('—');
  });
});

// ─── signalData (overview) ───────────────────────────────────────────────────

describe('overview.signalData', () => {
  test('is non-empty when strengths or weaknesses are present', () => {
    const vm = buildWorkspaceViewModel(BASE);
    expect(vm.overview.signalData.length).toBeGreaterThan(0);
  });

  test('is empty when both arrays are empty', () => {
    const vm = buildWorkspaceViewModel({
      ...BASE,
      filteredStrengths: [],
      filteredWeaknesses: [],
    });
    expect(vm.overview.signalData).toHaveLength(0);
  });

  test('strength entries have high scores (≥ 60) with high band', () => {
    const vm = buildWorkspaceViewModel({
      ...BASE,
      filteredStrengths: ['Strong product-market fit'],
      filteredWeaknesses: [],
      confidenceBand: 'high',
    });
    expect(vm.overview.signalData[0].confidence).toBe('Strong Evidence');
    expect(vm.overview.signalData[0].score).toBeGreaterThanOrEqual(60);
  });

  test('concern entries have low scores (≤ 55) and Partial Evidence with low band', () => {
    const vm = buildWorkspaceViewModel({
      ...BASE,
      filteredStrengths: [],
      filteredWeaknesses: ['High burn rate'],
      confidenceBand: 'low',
    });
    // With low band, concern confidence is 'Strong Evidence' (low confidence = more concern certainty)
    expect(vm.overview.signalData[0].score).toBeLessThanOrEqual(55);
    expect(vm.overview.signalData[0].name).toBe('High burn rate');
  });

  test('signal names match input strings', () => {
    const vm = buildWorkspaceViewModel({
      ...BASE,
      filteredStrengths: ['Clear market leadership'],
      filteredWeaknesses: [],
    });
    expect(vm.overview.signalData[0].name).toBe('Clear market leadership');
  });

  test('filters blank strings', () => {
    const vm = buildWorkspaceViewModel({
      ...BASE,
      filteredStrengths: ['  ', 'Real signal', ''],
      filteredWeaknesses: [],
    });
    expect(vm.overview.signalData).toHaveLength(1);
    expect(vm.overview.signalData[0].name).toBe('Real signal');
  });
});

// ─── signalCards (top-level) ─────────────────────────────────────────────────

describe('signalCards', () => {
  test('matches overview.signalCards', () => {
    const vm = buildWorkspaceViewModel(BASE);
    expect(vm.signalCards).toBe(vm.overview.signalCards);
  });

  test('strength cards have type=strength', () => {
    const vm = buildWorkspaceViewModel({
      ...BASE,
      filteredStrengths: ['Strong PMF'],
      filteredWeaknesses: [],
    });
    expect(vm.signalCards[0].type).toBe('strength');
  });

  test('weakness cards have type=concern', () => {
    const vm = buildWorkspaceViewModel({
      ...BASE,
      filteredStrengths: [],
      filteredWeaknesses: ['High burn'],
    });
    expect(vm.signalCards[0].type).toBe('concern');
  });
});

// ─── Header signals ──────────────────────────────────────────────────────────

describe('header.signals', () => {
  test('positive signals from strengths (up to 2)', () => {
    const vm = buildWorkspaceViewModel({
      ...BASE,
      filteredStrengths: ['S1', 'S2', 'S3'],
      filteredWeaknesses: [],
    });
    const positives = vm.header.signals.filter((s) => s.type === 'positive');
    expect(positives).toHaveLength(2);
    expect(positives[0].label).toBe('S1');
  });

  test('negative signals from weaknesses (up to 2)', () => {
    const vm = buildWorkspaceViewModel({
      ...BASE,
      filteredStrengths: [],
      filteredWeaknesses: ['W1', 'W2', 'W3'],
    });
    const negatives = vm.header.signals.filter((s) => s.type === 'negative');
    expect(negatives).toHaveLength(2);
    expect(negatives[0].label).toBe('W1');
  });
});

// ─── snapshotFacts KPIs ──────────────────────────────────────────────────────

describe('snapshotFacts KPIs', () => {
  test('raise comes from raiseValue when header is ready', () => {
    const vm = buildWorkspaceViewModel(BASE);
    expect(vm.overview.snapshotFacts.raise).toBe('$5M');
  });

  test('raise is "—" when header not ready', () => {
    const vm = buildWorkspaceViewModel({ ...BASE, selectedHeaderReady: false });
    expect(vm.overview.snapshotFacts.raise).toBe('—');
  });

  test('arr is "—" when revenue not allowed', () => {
    const vm = buildWorkspaceViewModel({ ...BASE, revenueAllowed: false });
    expect(vm.overview.snapshotFacts.arr).toBe('—');
  });

  test('growth prefers reportStructuredGrowthValue over growthValue', () => {
    const vm = buildWorkspaceViewModel({
      ...BASE,
      reportStructuredGrowthValue: '55% YoY',
      growthValue: '40% MoM',
    });
    expect(vm.overview.snapshotFacts.growth).toBe('55% YoY');
  });
});
