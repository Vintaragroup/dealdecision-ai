/**
 * RC-S6 Pass 3 — compiler-simple enrichment tests
 * Tests for: improved UOF breakdown (Climatic/Weavstra), project pipeline extraction, revenue model enrichment.
 * All helpers are private; tested via compileDIOToReportWithPromotedFacts with documentFullTexts.
 */
import { compileDIOToReportWithPromotedFacts } from '../compiler-simple';

function makeDIO(id = '00000000-0000-4000-8000-aaaaaaaaaa01'): any {
  const now = new Date().toISOString();
  return {
    schema_version: '1.0.0',
    dio_id: id,
    deal_id: id,
    created_at: now,
    updated_at: now,
    analysis_version: 1,
    dio_context: { primary_doc_type: 'pitch_deck' },
    inputs: { documents: [], evidence: [], config: { analyzer_versions: {}, features: {}, parameters: {} } },
    analyzer_results: {},
    dio: { phase1: {} },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// RC-S6-007: UOF breakdown improvements
// ─────────────────────────────────────────────────────────────────────────────

describe('RC-S6-007 UOF breakdown — Climatic THE RAISE labeled sections (Strategy C)', () => {
  const CLIMATIC_UOF_TEXT =
    'THE RAISE Seeking $25M Base Capital Legal & Custody Entity and custody structure setup ' +
    'SPV Creation First SPVs structured Debt is approved. Pipeline is ready. We need equity to deploy. ' +
    'Close Debt Deals $375M+ board-approved and ready to go Team & Pipeline Ramp team and activate $850M+ deployment pipeline';

  it('extracts 4 labeled UOF categories from THE RAISE section', () => {
    const report = compileDIOToReportWithPromotedFacts(makeDIO(), {
      promotedFacts: [],
      documentFullTexts: [CLIMATIC_UOF_TEXT],
    });
    const uofb = (report.structured_summary as any)?.use_of_funds_breakdown;
    expect(Array.isArray(uofb)).toBe(true);
    expect(uofb.length).toBeGreaterThanOrEqual(3);
    const labels = uofb.map((i: any) => i.category);
    expect(labels.some((l: string) => /legal\s+&\s+custody/i.test(l))).toBe(true);
    expect(labels.some((l: string) => /spv\s+creat/i.test(l))).toBe(true);
    expect(labels.some((l: string) => /close\s+debt/i.test(l))).toBe(true);
  });

  it('attaches dollar amount to Close Debt Deals and Team & Pipeline items', () => {
    const report = compileDIOToReportWithPromotedFacts(makeDIO(), {
      promotedFacts: [],
      documentFullTexts: [CLIMATIC_UOF_TEXT],
    });
    const uofb = (report.structured_summary as any)?.use_of_funds_breakdown as Array<any>;
    const closeDebt = uofb?.find((i: any) => /close\s+debt/i.test(i.category));
    expect(closeDebt?.amount_raw).toMatch(/\$375M/);
    expect(closeDebt?.amount).toBe(375_000_000);
    const teamPipeline = uofb?.find((i: any) => /team.*pipeline/i.test(i.category));
    expect(teamPipeline?.amount_raw).toMatch(/\$850M/);
  });
});

describe('RC-S6-007 UOF breakdown — Weavstra dollar-anchored multi-line items (Strategy B)', () => {
  const WEAVSTRA_UOF_TEXT =
    'Risk Management & Capital Deployment $500M HoldCo Series A & Use of Funds ' +
    '$200M for operations, team and to consolidate critical existing technology assets. ' +
    '$150M investment for a 80% controlling interest stake in the Al Meaning Layer. ' +
    '$75M investment to secure a leading position in the room temperature quantum chip company. ' +
    '$75M investment into 1 additional pre-negotiated companies and future critical technologies.';

  it('extracts dollar-anchored UOF items from Weavstra HoldCo section', () => {
    const report = compileDIOToReportWithPromotedFacts(makeDIO(), {
      promotedFacts: [],
      documentFullTexts: [WEAVSTRA_UOF_TEXT],
    });
    const uofb = (report.structured_summary as any)?.use_of_funds_breakdown as Array<any>;
    expect(Array.isArray(uofb)).toBe(true);
    expect(uofb.length).toBeGreaterThanOrEqual(3);
    // All items should have amount_raw
    const withAmount = uofb.filter((i: any) => i.amount_raw);
    expect(withAmount.length).toBeGreaterThanOrEqual(3);
    // $200M and $150M should be present
    const amounts = uofb.map((i: any) => i.amount);
    expect(amounts).toContain(200_000_000);
    expect(amounts).toContain(150_000_000);
  });

  it('does not fabricate UOF items when no UOF heading is present', () => {
    const report = compileDIOToReportWithPromotedFacts(makeDIO(), {
      promotedFacts: [],
      documentFullTexts: ['Company overview slide. Team and product roadmap.'],
    });
    const uofb = (report.structured_summary as any)?.use_of_funds_breakdown;
    expect(uofb == null || (Array.isArray(uofb) && uofb.length === 0)).toBe(true);
  });
});

describe('RC-S6-007 UOF breakdown — PAI single-line comma items (Strategy A — regression)', () => {
  it('still extracts PAI comma-list items correctly after refactor', () => {
    const text =
      'INVESTMENT SNAPSHOT Current: Seed Round (Priced) Use of funds: Product launch, customer delivery, deployment, and commercialization';
    const report = compileDIOToReportWithPromotedFacts(makeDIO(), {
      promotedFacts: [],
      documentFullTexts: [text],
    });
    const uofb = (report.structured_summary as any)?.use_of_funds_breakdown as Array<any>;
    expect(Array.isArray(uofb)).toBe(true);
    expect(uofb.length).toBeGreaterThanOrEqual(3);
    const cats = uofb.map((i: any) => i.category);
    expect(cats.some((c: string) => /product\s+launch/i.test(c))).toBe(true);
    expect(cats.some((c: string) => /commercialization/i.test(c))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RC-S6-012: Project pipeline extraction
// ─────────────────────────────────────────────────────────────────────────────

describe('RC-S6-012 project_pipeline — Climatic deployment table', () => {
  const CLIMATIC_PIPELINE_TEXT =
    'TRACTION Deployment Progress Project Capital Revenue Rtn Start Progress ' +
    '90% 50% 30% 30% \u00a92026 Climatic Global \u00b7 Commercial in Confidence ' +
    'Ammonia (AU) $150M\u20131.2B $26M\u2013215M 20% Dec 26 ' +
    'Solar Up (AU) $250M $35M 50% 2027 70% 70% ' +
    'Power Barge (UK) $20M\u2013200M \u2014 30% Jul 26 ' +
    'Hydro Grow (AU) $50M $12M TBA Jul 26 ' +
    'Waste \u2192 Fuel (MYA) $350M $60M TBA 2027 ' +
    'Ammonia (EG) $2,500M $250M TBA 2027 ' +
    'Islands Power (UK) $10M\u2013300M $3M\u201360M 50% May 26 90% ' +
    'BESS (AU) $70M $10M 25% Oct 26 90% 50% ' +
    'TEAM World Class Global Team';

  it('extracts all 8 project rows from Climatic deployment table', () => {
    const report = compileDIOToReportWithPromotedFacts(makeDIO(), {
      promotedFacts: [],
      documentFullTexts: [CLIMATIC_PIPELINE_TEXT],
    });
    const pp = (report.structured_summary as any)?.project_pipeline as Array<any>;
    expect(Array.isArray(pp)).toBe(true);
    expect(pp.length).toBe(8);
  });

  it('correctly parses Ammonia (AU) row fields', () => {
    const report = compileDIOToReportWithPromotedFacts(makeDIO(), {
      promotedFacts: [],
      documentFullTexts: [CLIMATIC_PIPELINE_TEXT],
    });
    const pp = (report.structured_summary as any)?.project_pipeline as Array<any>;
    // name may have trimmed OCR prefix; match by inclusion of "Ammonia" and country "(AU)"
    const ammonia = pp?.find((r: any) => r.name.includes('Ammonia') && r.name.includes('AU'));
    expect(ammonia).toBeTruthy();
    expect(ammonia.capital_raw).toMatch(/\$150M/);
    expect(ammonia.revenue_raw).toMatch(/\$26M/);
    expect(ammonia.return_pct).toBe('20%');
    expect(ammonia.start_date).toMatch(/Dec/i);
  });

  it('handles comma-formatted capital ($2,500M for Ammonia EG)', () => {
    const report = compileDIOToReportWithPromotedFacts(makeDIO(), {
      promotedFacts: [],
      documentFullTexts: [CLIMATIC_PIPELINE_TEXT],
    });
    const pp = (report.structured_summary as any)?.project_pipeline as Array<any>;
    const ammoniaEg = pp?.find((r: any) => r.name.includes('EG'));
    expect(ammoniaEg).toBeTruthy();
    expect(ammoniaEg.capital_raw).toMatch(/2,500M|\$2500M|\$2\.5B/i);
  });

  it('null revenue for Power Barge (UK) which has — in revenue column', () => {
    const report = compileDIOToReportWithPromotedFacts(makeDIO(), {
      promotedFacts: [],
      documentFullTexts: [CLIMATIC_PIPELINE_TEXT],
    });
    const pp = (report.structured_summary as any)?.project_pipeline as Array<any>;
    const powerBarge = pp?.find((r: any) => r.name.includes('Power Barge'));
    expect(powerBarge).toBeTruthy();
    expect(powerBarge.revenue_raw).toBeNull();
  });

  it('handles → in project name (Waste → Fuel)', () => {
    const report = compileDIOToReportWithPromotedFacts(makeDIO(), {
      promotedFacts: [],
      documentFullTexts: [CLIMATIC_PIPELINE_TEXT],
    });
    const pp = (report.structured_summary as any)?.project_pipeline as Array<any>;
    const wasteFuel = pp?.find((r: any) => r.name.includes('Fuel') || r.name.includes('Waste'));
    expect(wasteFuel).toBeTruthy();
  });

  it('returns null when no pipeline table header is present', () => {
    const report = compileDIOToReportWithPromotedFacts(makeDIO(), {
      promotedFacts: [],
      documentFullTexts: ['No pipeline table here. Just some text about the company.'],
    });
    const pp = (report.structured_summary as any)?.project_pipeline;
    expect(pp == null || (Array.isArray(pp) && pp.length === 0)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RC-S6-011 enrichment: Revenue model extraction
// ─────────────────────────────────────────────────────────────────────────────

describe('RC-S6-011 revenue_model — PAI RaaS unit economics', () => {
  it('extracts RaaS type and $75K/year/robot unit economics from PAI text', () => {
    const text =
      'Our Robot As A Service (RaaS) Model Will Allow Businesses To Employ Humanoids Affordably. ' +
      'RAAS BUSINESS MODEL Target $75,000/year (min) per installed robot Target BOM cost per robot $50,000';
    const report = compileDIOToReportWithPromotedFacts(makeDIO(), {
      promotedFacts: [],
      documentFullTexts: [text],
    });
    const rm = (report.structured_summary as any)?.revenue_model;
    expect(rm).toBeTruthy();
    expect(rm.type).toBe('RaaS');
    expect(rm.recurring).toBe(true);
    expect(rm.unit_economics).toMatch(/75K|75,000/i);
  });
});

describe('RC-S6-011 revenue_model — Climatic IRR / SPV fund model', () => {
  it('extracts SPV deployment type and 30%+ IRR for Climatic', () => {
    const text =
      'INFRASTRUCTURE-AS-A-SERVICE FOR CLIMATE 30%+ Target IRR Deployed in months not years. ' +
      'Structure SPVs that control and operate equipment under long-term contracts. 50% Capex savings.';
    const report = compileDIOToReportWithPromotedFacts(makeDIO(), {
      promotedFacts: [],
      documentFullTexts: [text],
    });
    const rm = (report.structured_summary as any)?.revenue_model;
    expect(rm).toBeTruthy();
    expect(rm.type).toMatch(/SPV|Infrastructure/i);
    expect(rm.unit_economics).toMatch(/30%/);
  });
});

describe('RC-S6-011 revenue_model — Weavstra enterprise + government', () => {
  it('extracts Enterprise + Government type for Weavstra based on sovereign + sole source signals', () => {
    const text =
      'Sovereign Agentic-Al application projected to save pilot client ~$100M. ' +
      'Secures path to US & Allied government sole source contracts. Sovereign infrastructure solutions.';
    const report = compileDIOToReportWithPromotedFacts(makeDIO(), {
      promotedFacts: [],
      documentFullTexts: [text],
    });
    const rm = (report.structured_summary as any)?.revenue_model;
    expect(rm).toBeTruthy();
    expect(rm.type).toMatch(/Enterprise|Government/i);
    expect(rm.recurring).toBe(true);
  });

  it('returns null revenue_model for generic text with no revenue signal', () => {
    const report = compileDIOToReportWithPromotedFacts(makeDIO(), {
      promotedFacts: [],
      documentFullTexts: ['The company is building a product. Market size is large.'],
    });
    const rm = (report.structured_summary as any)?.revenue_model;
    expect(rm == null).toBe(true);
  });
});
