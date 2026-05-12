import { describe, expect, test } from 'vitest';
import { getPolicyScoreSectionLabel, getSelectedPolicyIdFromAny } from '@dealdecision/core';

import { buildWorkspaceViewModel } from '../../components/workspace/builders/buildWorkspaceViewModel';
import type { WorkspaceViewModelInputs } from '../../components/workspace/builders/buildWorkspaceViewModel';
import type { DealWorkspaceOverviewModel } from '../../lib/selectors/selectDealWorkspaceOverviewModel';

// ─── Shared fixture ──────────────────────────────────────────────────────────

const OVERVIEW_MODEL_BASE: DealWorkspaceOverviewModel = {
  summaries: {
    short: {
      value: 'Acme automates enterprise workflow with AI.',
      origin: 'deterministic',
      evidenceIds: [],
      evidence: [],
      trust: 'structured',
      source: 'structured_summary',
    },
    long: {
      paragraphs: ['B2B SaaS for workflow automation'],
      text: 'B2B SaaS for workflow automation',
      origin: 'deterministic',
      evidenceIds: [],
      evidence: [],
      trust: 'structured',
      source: 'structured_summary',
    },
  },
  keyFacts: {
    product: {
      value: 'An AI workflow assistant for mid-market ops teams.',
      origin: 'deterministic',
      evidenceIds: [],
      evidence: [],
      trust: 'structured',
      source: 'structured_summary',
    },
    market: {
      value: 'SMB-to-mid-market SaaS, ~$12B TAM.',
      origin: 'deterministic',
      evidenceIds: [],
      evidence: [],
      trust: 'structured',
      source: 'structured_summary',
    },
    business_model: {
      value: 'Usage-based SaaS with enterprise expansion.',
      origin: 'deterministic',
      evidenceIds: [],
      evidence: [],
      trust: 'structured',
      source: 'structured_summary',
    },
    raise_terms: {
      value: '$5M Seed on $20M cap.',
      origin: 'deterministic',
      evidenceIds: [],
      evidence: [],
      trust: 'structured',
      source: 'structured_summary',
    },
  },
  rcS6: {
    teamHighlights: [],
    useOfFunds: [],
    projectPipeline: [],
    revenueModel: { type: null, unitEconomics: null, detail: null, recurring: null, trust: 'not_extracted' },
  },
};

const BASE: WorkspaceViewModelInputs = {
  overviewModel: OVERVIEW_MODEL_BASE,
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
  investmentSnapshotBody: '',
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

  test('concern entries have low scores (≤ 55) and Limited Evidence with low band', () => {
    const vm = buildWorkspaceViewModel({
      ...BASE,
      filteredStrengths: [],
      filteredWeaknesses: ['High burn rate'],
      confidenceBand: 'low',
    });
    // low band → limited evidence for concern cards (low confidence = uncertain picture)
    expect(vm.overview.signalData[0].score).toBeLessThanOrEqual(55);
    expect(vm.overview.signalData[0].name).toBe('High burn rate');
    expect(vm.overview.signalData[0].confidence).toBe('Limited Evidence');
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

describe('policy-aware metric schema', () => {
  test('real_estate_underwriting hides ARR and relabels traction metrics', () => {
    const vm = buildWorkspaceViewModel({
      ...BASE,
      selectedPolicyId: 'real_estate_underwriting',
      revenueValue: '$1.2M NOI',
      growthValue: '17%',
      customersValue: '36 months',
    });

    expect(vm.overview.snapshotFactLabels.arr).toBe('NOI');
    expect(vm.overview.snapshotFacts.arr).toBe('$1.2M');
    expect(vm.header.metrics.financials.map((x) => x.label)).toEqual(['Seed', 'NOI', 'Target IRR', 'Term']);
    expect(vm.header.metrics.traction[0]?.label).toBe('Target IRR');
    expect(vm.header.metrics.traction[1]?.label).toBe('Term');
    expect(vm.header.metrics.businessModel[0]?.label).toBe('Deal structure');
  });

  test('startup policy keeps ARR/customers schema', () => {
    const vm = buildWorkspaceViewModel({
      ...BASE,
      selectedPolicyId: 'enterprise_saas_b2b_v1',
    });

    expect(vm.overview.snapshotFacts.arr).toBe('$850K ARR');
    expect(vm.header.metrics.traction[0]?.label).toBe('Growth');
    expect(vm.header.metrics.traction[1]?.label).toBe('Customers');
  });

  test('API-mapped real-estate preferred-equity payload keeps non-startup schema in workspace VM', () => {
    const apiMappedDeal = {
      selected_policy: 'real_estate_underwriting',
      policy_id: 'real_estate_underwriting',
      deal_classification_v1: {
        selected_policy: 'real_estate_underwriting',
        selected: {
          asset_class: 'real_estate',
          deal_structure: 'preferred_equity',
          strategy_subtype: 'real_estate_preferred_equity',
        },
      },
    };

    const resolvedPolicyId = getSelectedPolicyIdFromAny(apiMappedDeal);
    expect(resolvedPolicyId).toBe('real_estate_underwriting');

    const vm = buildWorkspaceViewModel({
      ...BASE,
      selectedPolicyId: resolvedPolicyId,
      revenueValue: '$1.2M NOI',
      growthValue: '17%',
      customersValue: '36 months',
      businessModelValue: 'Real estate investment (preferred equity)',
    });

    expect(vm.overview.snapshotFactLabels.arr).toBe('NOI');
    expect(vm.overview.snapshotFacts.arr).toBe('$1.2M');
    expect(vm.header.metrics.traction[0]?.label).toBe('Target IRR');
    expect(vm.header.metrics.traction[1]?.label).toBe('Term');
    expect(vm.header.metrics.businessModel[0]?.label).toBe('Deal structure');
    expect(vm.header.metrics.businessModel[0]?.value).not.toContain('Omnichannel');
    expect(getPolicyScoreSectionLabel(resolvedPolicyId, 'business_model')).toBe('Deal structure');
    expect(getPolicyScoreSectionLabel(resolvedPolicyId, 'traction')).toBe('Underwriting metrics');
  });

  test('real-estate business model prefers governed policy-safe phrasing over startup taxonomy', () => {
    const vm = buildWorkspaceViewModel({
      ...BASE,
      overviewModel: {
        ...BASE.overviewModel,
        keyFacts: {
          ...BASE.overviewModel.keyFacts,
          business_model: {
            ...BASE.overviewModel.keyFacts.business_model,
            value: 'Preferred equity structure with debt service coverage covenant',
          },
        },
      },
      selectedPolicyId: 'real_estate_underwriting',
      businessModelValue: 'Omnichannel DTC subscription',
    });

    expect(vm.header.metrics.businessModel[0]?.value).toBe('Preferred equity structure with debt service coverage covenant');
  });

  test('real-estate extracted evidence relabels sections and gates startup-style text', () => {
    const vm = buildWorkspaceViewModel({
      ...BASE,
      overviewModel: {
        ...BASE.overviewModel,
        keyFacts: {
          ...BASE.overviewModel.keyFacts,
          product: { ...BASE.overviewModel.keyFacts.product, value: 'Omnichannel DTC platform with subscription checkout' },
          market: { ...BASE.overviewModel.keyFacts.market, value: 'B2C users and customer cohorts' },
          business_model: { ...BASE.overviewModel.keyFacts.business_model, value: 'Preferred equity structure' },
        },
      },
      selectedPolicyId: 'real_estate_underwriting',
    });

    expect(vm.overview.evidenceLabels.product).toBe('Asset / Facility');
    expect(vm.overview.evidenceLabels.market).toBe('Submarket / Demand');
    expect(vm.overview.productSummary).toBe('Not extracted from evidence');
    expect(vm.overview.marketSummary).toBe('Not extracted from evidence');
    expect(vm.overview.businessModelSummary).toBe('Preferred equity structure');
  });

  test('real-estate raise falls back to structured raise summary when header raise is missing', () => {
    const vm = buildWorkspaceViewModel({
      ...BASE,
      overviewModel: {
        ...BASE.overviewModel,
        keyFacts: {
          ...BASE.overviewModel.keyFacts,
          raise_terms: { ...BASE.overviewModel.keyFacts.raise_terms, value: '$35.6M construction loan + $11.9M equity' },
        },
      },
      selectedPolicyId: 'real_estate_underwriting',
      raiseValue: null,
    });

    expect(vm.overview.snapshotFacts.raise).toBe('$35.6M + $11.9M');
    expect(vm.header.raiseAmount).toBe('$35.6M + $11.9M');
  });

  test('real-estate malformed NOI placeholders are suppressed', () => {
    const vm = buildWorkspaceViewModel({
      ...BASE,
      selectedPolicyId: 'real_estate_underwriting',
      revenueValue: '$,',
    });

    expect(vm.overview.snapshotFacts.arr).toBe('—');
    const noiTile = vm.header.metrics.financials.find((x) => x.label === 'NOI');
    expect(noiTile?.value).toBe('—');
  });

  test('malformed Raise short values are hidden instead of rendered', () => {
    const vm = buildWorkspaceViewModel({
      ...BASE,
      overviewModel: {
        ...BASE.overviewModel,
        keyFacts: {
          ...BASE.overviewModel.keyFacts,
          raise_terms: { ...BASE.overviewModel.keyFacts.raise_terms, value: '$,' },
        },
      },
      selectedPolicyId: 'enterprise_saas_b2b_v1',
      raiseValue: '$,',
    });

    expect(vm.overview.snapshotFacts.raise).toBe('—');
    expect(vm.header.raiseAmount).toBe('—');
  });

  test('startup growth falls back to Mentioned for qualitative non-numeric values', () => {
    const vm = buildWorkspaceViewModel({
      ...BASE,
      selectedPolicyId: 'enterprise_saas_b2b_v1',
      reportStructuredGrowthValue: 'Strong pipeline momentum',
      growthValue: 'Growing quickly',
    });

    expect(vm.overview.snapshotFacts.growth).toBe('Mentioned');
  });

  test('real-estate hides Raise / Terms when it collides with Deal structure wording', () => {
    const sameText = 'Preferred equity structure with sponsor equity and lease-backed investment terms';
    const vm = buildWorkspaceViewModel({
      ...BASE,
      overviewModel: {
        ...BASE.overviewModel,
        keyFacts: {
          ...BASE.overviewModel.keyFacts,
          raise_terms: { ...BASE.overviewModel.keyFacts.raise_terms, value: sameText },
          business_model: { ...BASE.overviewModel.keyFacts.business_model, value: sameText },
        },
      },
      selectedPolicyId: 'real_estate_underwriting',
      raiseValue: sameText,
      businessModelValue: sameText,
    });

    expect(vm.overview.snapshotFacts.raise).toBe('—');
    expect(vm.overview.businessModelSummary).toBe(sameText);
  });

  test('startup policy retains startup snapshot and evidence labeling', () => {
    const vm = buildWorkspaceViewModel({
      ...BASE,
      selectedPolicyId: 'enterprise_saas_b2b_v1',
    });

    expect(vm.overview.snapshotFactLabels.arr).toBe('ARR');
    expect(vm.overview.evidenceLabels.product).toBe('Product');
    expect(vm.overview.evidenceLabels.market).toBe('Market');
    expect(vm.overview.productSummary).toBe(BASE.overviewModel.keyFacts.product.value);
  });
});

// ─── concern confidence labels ───────────────────────────────────────────────

describe('overview.signalData concern confidence labels', () => {
  test('concern is Limited Evidence when band is low', () => {
    const vm = buildWorkspaceViewModel({
      ...BASE, filteredStrengths: [], filteredWeaknesses: ['High burn'], confidenceBand: 'low',
    });
    expect(vm.overview.signalData[0].confidence).toBe('Limited Evidence');
  });

  test('concern is Limited Evidence when band is unknown (pre-analysis)', () => {
    const vm = buildWorkspaceViewModel({
      ...BASE, filteredStrengths: [], filteredWeaknesses: ['High burn'], confidenceBand: 'unknown',
    });
    expect(vm.overview.signalData[0].confidence).toBe('Limited Evidence');
  });

  test('concern is Partial Evidence when band is med', () => {
    const vm = buildWorkspaceViewModel({
      ...BASE, filteredStrengths: [], filteredWeaknesses: ['High burn'], confidenceBand: 'med',
    });
    expect(vm.overview.signalData[0].confidence).toBe('Partial Evidence');
  });

  test('concern is Partial Evidence when band is high', () => {
    const vm = buildWorkspaceViewModel({
      ...BASE, filteredStrengths: [], filteredWeaknesses: ['High burn'], confidenceBand: 'high',
    });
    expect(vm.overview.signalData[0].confidence).toBe('Partial Evidence');
  });
});

// ─── signal explanation ≠ name (description semantics) ──────────────────────

describe('signal explanation is distinct from name', () => {
  test('strength explanation is not a copy of the signal name', () => {
    const vm = buildWorkspaceViewModel({
      ...BASE,
      filteredStrengths: ['Strong product-market fit'],
      filteredWeaknesses: [],
      confidenceBand: 'high',
    });
    const signal = vm.overview.signalData[0];
    expect(signal.explanation).not.toBe(signal.name);
  });

  test('concern explanation is not a copy of the signal name', () => {
    const vm = buildWorkspaceViewModel({
      ...BASE,
      filteredStrengths: [],
      filteredWeaknesses: ['High burn rate'],
      confidenceBand: 'high',
    });
    const signal = vm.overview.signalData[0];
    expect(signal.explanation).not.toBe(signal.name);
  });

  test('strength high band has evidence context description', () => {
    const vm = buildWorkspaceViewModel({
      ...BASE,
      filteredStrengths: ['Clear market leadership'],
      filteredWeaknesses: [],
      confidenceBand: 'high',
    });
    expect(vm.overview.signalData[0].explanation).toBe(
      'Supporting evidence found across submitted materials.',
    );
  });

  test('strength med band has partial evidence description', () => {
    const vm = buildWorkspaceViewModel({
      ...BASE,
      filteredStrengths: ['Experienced founding team'],
      filteredWeaknesses: [],
      confidenceBand: 'med',
    });
    expect(vm.overview.signalData[0].explanation).toBe(
      'Partially supported by available evidence.',
    );
  });

  test('concern high band has diligence-flagged description', () => {
    const vm = buildWorkspaceViewModel({
      ...BASE,
      filteredStrengths: [],
      filteredWeaknesses: ['Limited revenue history'],
      confidenceBand: 'high',
    });
    expect(vm.overview.signalData[0].explanation).toBe('Flagged during diligence review.');
  });

  test('concern low band has limited-evidence description', () => {
    const vm = buildWorkspaceViewModel({
      ...BASE,
      filteredStrengths: [],
      filteredWeaknesses: ['No board yet'],
      confidenceBand: 'low',
    });
    expect(vm.overview.signalData[0].explanation).toBe(
      'Risk area — limited evidence to fully assess.',
    );
  });

  test('signal name still matches the original input string', () => {
    const vm = buildWorkspaceViewModel({
      ...BASE,
      filteredStrengths: ['Recurring revenue model'],
      filteredWeaknesses: [],
    });
    expect(vm.overview.signalData[0].name).toBe('Recurring revenue model');
  });
});

// ─── primaryIssues title-casing ──────────────────────────────────────────────

describe('header.primaryIssues title-casing', () => {
  test('human-readable strings are returned unchanged', () => {
    const vm = buildWorkspaceViewModel({
      ...BASE, filteredWeaknesses: ['High burn rate', 'No board yet'],
    });
    expect(vm.header.primaryIssues).toEqual(['High burn rate', 'No board yet']);
  });

  test('snake_case machine keys are converted to Title Case', () => {
    const vm = buildWorkspaceViewModel({
      ...BASE, filteredWeaknesses: ['market_traction', 'revenue_growth'],
    });
    expect(vm.header.primaryIssues).toEqual(['Market Traction', 'Revenue Growth']);
  });

  test('mixed strings: human-readable unchanged, snake_case converted', () => {
    const vm = buildWorkspaceViewModel({
      ...BASE, filteredWeaknesses: ['High burn rate', 'revenue_growth'],
    });
    expect(vm.header.primaryIssues[0]).toBe('High burn rate');
    expect(vm.header.primaryIssues[1]).toBe('Revenue Growth');
  });
});

// ─── deal tile Type title-casing ─────────────────────────────────────────────

describe('metrics.deal Type title-casing', () => {
  test('human-readable deal type is returned unchanged', () => {
    const vm = buildWorkspaceViewModel({ ...BASE, topSectionDealType: 'B2B SaaS' });
    const typeTile = vm.header.metrics.deal.find((t) => t.label === 'Type');
    expect(typeTile?.value).toBe('B2B SaaS');
  });

  test('snake_case deal type is normalised to Title Case', () => {
    const vm = buildWorkspaceViewModel({ ...BASE, topSectionDealType: 'series_a' });
    const typeTile = vm.header.metrics.deal.find((t) => t.label === 'Type');
    expect(typeTile?.value).toBe('Series A');
  });

  test('empty deal type results in em-dash sentinel', () => {
    const vm = buildWorkspaceViewModel({ ...BASE, topSectionDealType: '' });
    const typeTile = vm.header.metrics.deal.find((t) => t.label === 'Type');
    expect(typeTile?.value).toBe('\u2014');
  });

  test('overview deal tiles match header deal tiles', () => {
    const vm = buildWorkspaceViewModel(BASE);
    expect(vm.overview.deal).toEqual(vm.header.metrics.deal);
  });
});

// ─── vm structural completeness ──────────────────────────────────────────────

describe('vm structural completeness', () => {
  test('vm.header contains all render-required fields', () => {
    const vm = buildWorkspaceViewModel(BASE);
    const h = vm.header;
    // Every field that DealWorkspaceHeader receives must be present in vm.header
    expect(typeof h.dealName).toBe('string');
    expect(typeof h.dealDescription).toBe('string');
    expect(typeof h.stage).toBe('string');
    expect(typeof h.raiseAmount).toBe('string');
    expect(typeof h.industry).toBe('string');
    expect(typeof h.score).toBe('number');
    expect(['INVEST', 'CONSIDER', 'PASS', 'HARD_PASS']).toContain(h.verdict);
    expect(Array.isArray(h.primaryIssues)).toBe(true);
    expect(typeof h.blockers).toBe('number');
    expect(typeof h.concerns).toBe('number');
    expect(typeof h.strengths).toBe('number');
    expect(typeof h.icReadiness).toBe('number');
    expect(typeof h.evidenceConfidence).toBe('number');
    expect(['Strong', 'Moderate', 'Limited']).toContain(h.evidenceCoverage);
    expect(Array.isArray(h.signals)).toBe(true);
    expect(Array.isArray(h.metrics.financials)).toBe(true);
    expect(Array.isArray(h.metrics.traction)).toBe(true);
    expect(Array.isArray(h.metrics.deal)).toBe(true);
    expect(Array.isArray(h.metrics.businessModel)).toBe(true);
    expect(['Active', 'On Hold', 'Closed']).toContain(h.pipelineStatus);
    expect(typeof h.analyzing).toBe('boolean');
  });

  test('vm.overview contains all render-required fields', () => {
    const vm = buildWorkspaceViewModel(BASE);
    const o = vm.overview;
    expect(typeof o.companyName).toBe('string');
    expect(typeof o.companyDescription).toBe('string');
    expect(typeof o.snapshotFacts.raise).toBe('string');
    expect(typeof o.snapshotFacts.arr).toBe('string');
    expect(typeof o.snapshotFacts.growth).toBe('string');
    expect(typeof o.snapshotFacts.customers).toBe('string');
    expect(typeof o.snapshotFacts.tam).toBe('string');
    expect(Array.isArray(o.signalData)).toBe(true);
    expect(Array.isArray(o.financials)).toBe(true);
    expect(Array.isArray(o.traction)).toBe(true);
    expect(Array.isArray(o.deal)).toBe(true);
    expect(Array.isArray(o.businessModel)).toBe(true);
    expect(typeof o.productSummary).toBe('string');
    expect(typeof o.marketSummary).toBe('string');
    expect(typeof o.businessModelSummary).toBe('string');
    expect(typeof o.raiseTerms).toBe('string');
    expect(typeof o.insightsScore).toBe('number');
    expect(['High', 'Medium', 'Low']).toContain(o.insightsConfidence);
  });

  test('vm.header and vm.overview share the same KPI tiles (no duplication)', () => {
    const vm = buildWorkspaceViewModel(BASE);
    // Builder produces shared tile arrays — not two separate derivations
    expect(vm.header.metrics.financials).toEqual(vm.overview.financials);
    expect(vm.header.metrics.traction).toEqual(vm.overview.traction);
    expect(vm.header.metrics.deal).toEqual(vm.overview.deal);
    expect(vm.header.metrics.businessModel).toEqual(vm.overview.businessModel);
  });

  test('governed narrative fields are passed through to overview unchanged', () => {
    const vm = buildWorkspaceViewModel(BASE);
    expect(vm.overview.companyDescription).toBe(BASE.governedDealOneLiner);
    expect(vm.overview.productSummary).toBe(BASE.overviewModel.keyFacts.product.value);
    expect(vm.overview.marketSummary).toBe(BASE.overviewModel.keyFacts.market.value);
    expect(vm.overview.businessModelSummary).toBe(BASE.overviewModel.keyFacts.business_model.value);
    expect(vm.overview.raiseTerms).toBe(BASE.overviewModel.keyFacts.raise_terms.value);
  });

  test('insights entry point values are passed through to overview', () => {
    const vm = buildWorkspaceViewModel(BASE);
    expect(vm.overview.insightsScore).toBe(BASE.insightsScore);
    expect(vm.overview.insightsConfidence).toBe(BASE.insightsConfidence);
  });
});
