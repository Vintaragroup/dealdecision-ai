type FundingStage = "pre_seed" | "seed" | "series_a" | "growth" | "unknown";

export type StageExpectationsProfileV1 = {
  stage: FundingStage;
  confidence: "low" | "medium" | "high"; // confidence in stage-based expectations application
  expectations: {
    // what we expect to see at this stage (not whether it's present)
    requires_traction_evidence: boolean;
    requires_unit_economics: boolean;
    requires_income_statement: boolean;
    requires_burn_and_runway: boolean;
    requires_capital_logic: boolean; // raise + use of funds + milestones
    requires_team_depth: boolean;    // placeholder for later; v1 uses false unless deterministic team signals exist
  };
  observed: {
    // what we actually have present (from coverage profiles)
    traction_evidence_present: boolean;   // v1: derived from financial + capital logic only (no slide parsing)
    unit_economics_present: boolean;
    income_statement_present: boolean;
    burn_and_runway_present: boolean;
    capital_logic_present: boolean;       // capital_logic_v1.appears_coherent or at least raise present
    xlsx_present: boolean;
  };
  gaps: Array<{
    code: string;              // stable code, e.g. "missing_unit_economics"
    severity: "low" | "medium" | "high";
    message: string;           // short deterministic message
  }>;
  notes?: string[];
};

type Gap = StageExpectationsProfileV1['gaps'][number];

const asStage = (v: unknown): FundingStage => {
  if (v === 'pre_seed' || v === 'seed' || v === 'series_a' || v === 'growth' || v === 'unknown') return v;
  return 'unknown';
};

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

const expectationMatrix = (stage: FundingStage): StageExpectationsProfileV1['expectations'] => {
  if (stage === 'pre_seed') {
    return {
      requires_traction_evidence: false,
      requires_unit_economics: false,
      requires_income_statement: false,
      requires_burn_and_runway: false,
      requires_capital_logic: true,
      requires_team_depth: false,
    };
  }
  if (stage === 'seed') {
    return {
      requires_traction_evidence: true,
      requires_unit_economics: true,
      requires_income_statement: false,
      requires_burn_and_runway: true,
      requires_capital_logic: true,
      requires_team_depth: false,
    };
  }
  if (stage === 'series_a') {
    return {
      requires_traction_evidence: true,
      requires_unit_economics: true,
      requires_income_statement: true,
      requires_burn_and_runway: true,
      requires_capital_logic: true,
      requires_team_depth: false,
    };
  }
  if (stage === 'growth') {
    return {
      requires_traction_evidence: true,
      requires_unit_economics: true,
      requires_income_statement: true,
      requires_burn_and_runway: true,
      requires_capital_logic: true,
      requires_team_depth: false,
    };
  }
  // unknown
  return {
    requires_traction_evidence: false,
    requires_unit_economics: false,
    requires_income_statement: false,
    requires_burn_and_runway: false,
    requires_capital_logic: true,
    requires_team_depth: false,
  };
};

const inferExpectationsConfidence = (stage: FundingStage, fundingStageConfidence: unknown): StageExpectationsProfileV1['confidence'] => {
  const c = typeof fundingStageConfidence === 'number' && Number.isFinite(fundingStageConfidence)
    ? clamp01(fundingStageConfidence)
    : 0;

  if (stage !== 'unknown' && c >= 0.6) return 'high';
  if (stage !== 'unknown' && c >= 0.3) return 'medium';
  return 'low';
};

const severityFor = (stage: FundingStage, code: string, ctx: { raisePresent: boolean; capitalAppearsCoherent: boolean }): Gap['severity'] => {
  // Pre-seed: capital logic is still expected, but missing it is lower-severity.
  if (stage === 'pre_seed' && code === 'missing_capital_logic') {
    if (ctx.raisePresent && !ctx.capitalAppearsCoherent) return 'medium';
    return 'low';
  }

  const highStage = stage === 'series_a' || stage === 'growth';
  const mediumStage = stage === 'seed';

  const highCodes = new Set([
    'missing_unit_economics',
    'missing_income_statement',
    'missing_burn_or_runway',
    'missing_capital_logic',
    'missing_traction_evidence',
  ]);

  if (highStage && highCodes.has(code)) return 'high';
  if (mediumStage && highCodes.has(code)) return 'medium';

  if (stage === 'growth' && code === 'missing_xlsx_financials') return 'medium';
  return 'low';
};

export function inferStageExpectationsProfileV1(input: {
  funding_stage_v1?: any;           // FundingStageModelV1
  financial_coverage_v1?: any;       // FinancialCoverageProfileV1
  capital_logic_v1?: any;           // CapitalLogicProfileV1
}): StageExpectationsProfileV1 {
  const stage = asStage(input?.funding_stage_v1?.funding_stage);
  const fundingStageConf = input?.funding_stage_v1?.confidence;
  const expectations = expectationMatrix(stage);
  const confidence = stage === 'unknown' ? 'low' : inferExpectationsConfidence(stage, fundingStageConf);

  const sources = Array.isArray(input?.financial_coverage_v1?.sources) ? input.financial_coverage_v1.sources : [];
  const xlsx_present = sources.some((s: any) => s && typeof s === 'object' && String(s.kind ?? '').toLowerCase() === 'xlsx');

  const cov = input?.financial_coverage_v1?.coverage ?? {};
  const unit_economics_present = !!cov.unit_economics_present;
  const income_statement_present = !!cov.income_statement_present;
  const burn_and_runway_present = !!cov.burn_rate_present && !!cov.runway_present;

  const historical_revenue_present = !!cov.historical_revenue_present;
  const traction_evidence_present = historical_revenue_present || unit_economics_present;

  const raisePresent = !!input?.capital_logic_v1?.raise?.present;
  const capitalAppearsCoherent = !!input?.capital_logic_v1?.coherence?.appears_coherent;
  const capital_logic_present = capitalAppearsCoherent || raisePresent;

  const observed: StageExpectationsProfileV1['observed'] = {
    traction_evidence_present,
    unit_economics_present,
    income_statement_present,
    burn_and_runway_present,
    capital_logic_present,
    xlsx_present,
  };

  const gaps: Gap[] = [];
  const pushGap = (code: Gap['code'], message: string): void => {
    gaps.push({
      code,
      severity: severityFor(stage, code, { raisePresent, capitalAppearsCoherent }),
      message,
    });
  };

  // Capital logic is considered strictly coherent when appears_coherent is true.
  // This avoids inventing missing milestones/use-of-funds while still surfacing a gap.
  const coherentCapitalLogicSatisfied = capitalAppearsCoherent;

  // Gaps
  if (expectations.requires_traction_evidence && !observed.traction_evidence_present) {
    pushGap('missing_traction_evidence', 'Missing traction evidence for stage.');
  }
  if (expectations.requires_unit_economics && !observed.unit_economics_present) {
    pushGap('missing_unit_economics', 'Missing unit economics for stage.');
  }
  if (expectations.requires_income_statement && !observed.income_statement_present) {
    pushGap('missing_income_statement', 'Missing income statement signals for stage.');
  }
  if (expectations.requires_burn_and_runway && !observed.burn_and_runway_present) {
    pushGap('missing_burn_or_runway', 'Missing burn rate or runway signals for stage.');
  }
  if (expectations.requires_capital_logic && !coherentCapitalLogicSatisfied) {
    pushGap('missing_capital_logic', 'Missing coherent capital logic (raise + use of funds + milestones).');
  }
  if (stage === 'growth' && !observed.xlsx_present) {
    pushGap('missing_xlsx_financials', 'Missing XLSX financials expected at growth stage.');
  }

  const notes: string[] = [];
  // Explicitly call out that this is a funding-stage expectation, not workflow stage or governance phase.
  notes.push('funding_stage_only');
  if (stage === 'unknown') notes.push('stage_unknown');

  return {
    stage,
    confidence,
    expectations,
    observed,
    gaps,
    notes,
  };
}
