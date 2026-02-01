import { classifyDealForDioLike, classifyDealV1 } from "../deal-classifier";

describe("deal-classifier v1", () => {
  it("classifies real estate preferred equity (Cross Dev-like) and routes to real_estate_underwriting", () => {
    const text = `
    Nobis Preferred Equity Opportunity
    Net Operating Income (NOI): $4,666,200
    DSCR: 1.61
    Loan-to-Value (LTV): 75%
    Preferred Equity raise: $11,665,000
    Cap rate discussion and lease term details.
    `;

    const out = classifyDealV1({
      documents: [{ full_text: text, headings: ["Preferred Equity", "NOI", "DSCR", "LTV"] }],
      evidence: [],
    });

    expect(out.selected.asset_class).toBe("real_estate");
    expect(out.selected.deal_structure).toBe("preferred_equity");
    expect(out.selected_policy).toBe("real_estate_underwriting");
    expect(out.selected.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("classifies startup pitch / SAFE raise and routes to startup_raise", () => {
    const text = `
    We are raising on a SAFE (Simple Agreement for Future Equity) with a $10M valuation cap and 20% discount.
    Seed round. Pre-money valuation discussion.
    ARR growth and CAC efficiency highlighted.
    `;

    const out = classifyDealV1({
      documents: [{ full_text: text }],
      evidence: [],
    });

    expect(out.selected_policy).toBe("startup_raise");
    expect(out.selected.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("classifies fund LPA and routes to fund_spv", () => {
    const text = `
    LIMITED PARTNERSHIP AGREEMENT (LPA)
    General Partner (GP) and Limited Partners (LP)
    Management fee 2% and carried interest 20%.
    Capital commitments and subscription documents.
    `;

    const out = classifyDealV1({
      documents: [{ full_text: text }],
      evidence: [],
    });

    expect(out.selected.asset_class).toBe("fund_vehicle");
    expect(out.selected_policy).toBe("fund_spv");
  });

  it("routes ambiguous documents to unknown_generic", () => {
    const text = `This is a generic document with no clear deal terms or underwriting metrics.`;

    const out = classifyDealV1({
      documents: [{ full_text: text }],
      evidence: [],
    });

    expect(out.selected_policy).toBe("unknown_generic");
    expect(out.domain_policy_id).toBe("unknown_generic");
    expect(out.selected.confidence).toBeLessThan(0.7);
    expect(out.candidates.length).toBeGreaterThan(0);
  });

  it("classifies execution-ready pre-revenue ventures and routes to execution_ready_v1", () => {
    const text = `
    We are pre-revenue today.
    Signed LOI with a national distributor and a strategic partnership agreement.
    Manufacturing is production-ready with a contract manufacturer.
    Launch in 3 months with a detailed go-to-market plan.
    Regulatory: FDA 510(k) submission in progress.
    `;

    const out = classifyDealV1({
      documents: [{ full_text: text }],
      evidence: [],
    });

    expect(out.selected_policy).toBe("execution_ready_v1");
    expect(out.selected.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("golden: execution_ready_v1 selects itself (not domain fallback) and is top candidate", () => {
    const text = `
    Pre-revenue but ready to scale. Product is built and the team is fully hired.
    Go-to-market is ready with launch in 4 months.
    Signed LOIs and paid pilots in negotiation; $850k pipeline and $250k in signed contract value.
    Strategic partnerships signed with channel partners and distributors.
    Use of funds: scale sales and marketing; SAFE raise with valuation cap and discount.

    Healthcare/regulatory readiness: FDA 510(k) pathway, clinical trial Phase II, HIPAA-compliant workflows,
    CPT reimbursement strategy.
    `;

    const out = classifyDealV1({
      documents: [{ full_text: text }],
      evidence: [],
    });

    expect(out.selected_policy).toBe("execution_ready_v1");
    expect(out.domain_policy_id).not.toBe("unknown_generic");
    expect(out.selected.confidence).toBeGreaterThanOrEqual(0.7);

    const top = out.candidates[0] as any;
    expect(top?.policy_id).toBe("execution_ready_v1");
    expect(top?.confidence).toBe(out.selected.confidence);
  });

  it("classifies revenue-generating early-stage startups and routes to operating_startup_revenue_v1", () => {
    const text = `
    Seed stage startup with early traction.
    MRR: $50,000. Revenue growing.
    Gross margin 70%. Unit economics and cohort KPIs tracked.
    `;

    const out = classifyDealV1({
      documents: [{ full_text: text }],
      evidence: [],
    });

    expect(out.selected_policy).toBe("operating_startup_revenue_v1");
    expect(out.selected.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("golden: operating_startup_revenue_v1 selects itself (not domain fallback) and is top candidate", () => {
    const text = `
    Operating startup with repeatable sales motion and existing customers.
    Revenue: $1.4M trailing 12 months; ARR $1.8M; MRR $150k.
    Growth 80% YoY. Net dollar retention (NRR) 118% with churn 3% monthly.
    Gross margin 68% and improving contribution margin.
    Cohort retention, unit economics, CAC payback tracked.
    `;

    const out = classifyDealV1({
      documents: [{ full_text: text }],
      evidence: [],
    });

    expect(out.selected_policy).toBe("operating_startup_revenue_v1");
    expect(out.selected.confidence).toBeGreaterThanOrEqual(0.7);

    const top = out.candidates[0] as any;
    expect(top?.policy_id).toBe("operating_startup_revenue_v1");
    expect(top?.confidence).toBe(out.selected.confidence);
  });

  it("classifies DTC/ecommerce brand decks and routes to consumer_ecommerce_brand_v1", () => {
    const text = `
    DTC brand on Shopify Plus with growing Amazon (FBA) channel.
    Unit economics: LTV:CAC 4.2x, CAC $35, AOV $95, ROAS 3.1.
    Gross margin 62%. Conversion rate 3.5%.
    Repeat purchase rate 40% with cohort analysis.
    `;

    const out = classifyDealV1({
      documents: [{ full_text: text }],
      evidence: [],
    });

    expect(out.selected_policy).toBe("consumer_ecommerce_brand_v1");
    expect(out.domain_policy_id).toBe("consumer_ecommerce_brand_v1");
    expect(out.selected.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("classifies consumer fintech platform decks and routes to consumer_fintech_platform_v1", () => {
    const text = `
    Consumer payments platform and digital wallet.
    Card issuing with interchange revenue and embedded finance APIs.
    KYC/AML compliance posture described.
    TPV: $12M last quarter, transaction volume growing 60% YoY.
    Fraud rate 0.2%.
    `;

    const out = classifyDealV1({
      documents: [{ full_text: text }],
      evidence: [],
    });

    expect(out.selected_policy).toBe("consumer_fintech_platform_v1");
    expect(out.domain_policy_id).toBe("consumer_fintech_platform_v1");
    expect(out.selected.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("domain routing: healthcare/biotech snippet routes to healthcare_biotech_v1", () => {
    const text = `
    FDA 510(k) pathway with clinical trial Phase II planned.
    IRB approval required. CPT code and reimbursement strategy.
    HIPAA-compliant EHR integration.
    `;

    const out = classifyDealV1({
      documents: [{ full_text: text }],
      evidence: [],
    });

    expect(out.domain_policy_id).toBe("healthcare_biotech_v1");
    expect(out.selected_policy).toBe("healthcare_biotech_v1");
    expect(out.candidates.some((c) => (c as any).policy_id === "healthcare_biotech_v1" && c.confidence >= 0.6)).toBe(true);
  });

  it("golden: healthcare_biotech_v1 selects itself (not domain fallback) with strong regulatory + validation signals", () => {
    const text = `
    FDA pathway: 510(k) submission planned; IDE discussed.
    Clinical trial Phase II with IRB oversight; primary endpoint defined and peer-reviewed data referenced.
    Diagnostic performance: sensitivity 94% and specificity 92%.
    Reimbursement: CPT/DRG strategy with payer discussions.
    Team: MD/PhD with KOL advisors.
    Timeline: 12 months to clearance; burn rate and runway planning included.
    `;

    const out = classifyDealV1({
      documents: [{ full_text: text }],
      evidence: [],
    });

    expect(out.selected_policy).toBe("healthcare_biotech_v1");
    expect(out.domain_policy_id).toBe("healthcare_biotech_v1");
    expect(out.selected.confidence).toBeGreaterThanOrEqual(0.7);

    const top = out.candidates[0] as any;
    expect(top?.policy_id).toBe("healthcare_biotech_v1");
    expect(top?.confidence).toBe(out.selected.confidence);
  });

  it("negative guard: HIPAA/EHR workflow SaaS without regulatory/clinical signals does not route to healthcare_biotech_v1", () => {
    const text = `
    HIPAA-compliant EHR integration for provider workflow automation.
    B2B SaaS with ARR $1.2M, NRR 118%, SOC2 Type II, SSO (SAML).
    No FDA pathway required.
    `;

    const out = classifyDealV1({
      documents: [{ full_text: text }],
      evidence: [],
    });

    expect(out.selected_policy).toBe("enterprise_saas_b2b_v1");
    expect(out.selected_policy).not.toBe("healthcare_biotech_v1");
  });

  it("domain routing: enterprise SaaS snippet routes to enterprise_saas_b2b_v1", () => {
    const text = `
    Enterprise SaaS with ARR and NRR metrics.
    SOC2 Type II, SSO (SAML) support, procurement security review.
    Seat-based pricing, ACV and pipeline.
    `;

    const out = classifyDealV1({
      documents: [{ full_text: text }],
      evidence: [],
    });

    expect(out.domain_policy_id).toBe("enterprise_saas_b2b_v1");
    expect(out.selected_policy).toBe("enterprise_saas_b2b_v1");
    expect(out.candidates.some((c) => (c as any).policy_id === "enterprise_saas_b2b_v1" && c.confidence >= 0.6)).toBe(true);
  });

  it("domain routing: spirits/CPG snippet routes to physical_product_cpg_spirits_v1", () => {
    const text = `
    Spirits brand launching with a wholesale distributor.
    Signed distribution agreement in two states; three-tier distribution strategy.
    TTB licensing in place. Doors: 120. Retail velocity: 4.5 units/store/week.
    Gross margin 62%. Contribution margin 35%. Inventory turns 6.
    `;

    const out = classifyDealV1({
      documents: [{ full_text: text }],
      evidence: [],
    });

    expect(out.domain_policy_id).toBe("physical_product_cpg_spirits_v1");
    expect(out.selected_policy).toBe("physical_product_cpg_spirits_v1");
    expect(out.candidates.some((c) => (c as any).policy_id === "physical_product_cpg_spirits_v1" && c.confidence >= 0.6)).toBe(true);
  });

  it("golden: media_entertainment_ip_v1 selects itself with rights + distribution package + recoupment/waterfall", () => {
    const text = `
    Chain of title verified; option agreement executed for underlying rights.
    Distribution agreement under negotiation with a sales agent; minimum guarantee (MG) discussed and pre-sales in select territories.
    Talent attachments: director and lead cast attached; SAG-AFTRA / WGA considerations noted.
    Completion bond plan in place. Waterfall and recoupment schedule defined; target recoupment multiple 2.0x.
    Marketing commitment (P&A) outlined.
    `;

    const out = classifyDealV1({
      documents: [{ full_text: text }],
      evidence: [],
    });

    expect(out.selected_policy).toBe("media_entertainment_ip_v1");
    expect(out.domain_policy_id).toBe("media_entertainment_ip_v1");
    expect(out.selected.confidence).toBeGreaterThanOrEqual(0.7);

    const top = out.candidates[0] as any;
    expect(top?.policy_id).toBe("media_entertainment_ip_v1");
    expect(top?.confidence).toBe(out.selected.confidence);
  });

  it("negative guard: generic software licensing language does not route to media_entertainment_ip_v1", () => {
    const text = `
    Enterprise SaaS with software licensing and royalty-like revenue share terms.
    ARR $2.4M, NRR 122%, SOC2 Type II, SSO (SAML). Enterprise procurement and security review.
    `;

    const out = classifyDealV1({
      documents: [{ full_text: text }],
      evidence: [],
    });

    expect(out.selected_policy).toBe("enterprise_saas_b2b_v1");
    expect(out.selected_policy).not.toBe("media_entertainment_ip_v1");
  });

  it("classifies enterprise SaaS from Phase1 text (even when docs/evidence are sparse)", () => {
    const dioLike: any = {
      inputs: { documents: [], evidence: [] },
      phase1: {
        executive_summary_v1: {
          title: "Enterprise SaaS Seed Round",
          one_liner: "B2B enterprise SaaS platform with SOC2 Type II and SSO.",
          deal_type: "startup_raise",
          raise: "Seed",
          business_model: "B2B SaaS",
          traction_signals: ["ARR $1.5M", "NRR 125%", "ACV $25k", "pipeline coverage 4x"],
          key_risks_detected: [],
          unknowns: [],
          confidence: { overall: "high" },
          evidence: [],
        },
        decision_summary_v1: {
          score: 78,
          recommendation: "CONSIDER",
          reasons: ["Strong retention", "Enterprise readiness"],
          blockers: [],
          next_requests: [],
          confidence: "high",
        },
        claims: [],
        coverage: { sections: {} },
      },
    };

    const out = classifyDealForDioLike(dioLike);
    expect(out.selected_policy).toBe("enterprise_saas_b2b_v1");
    expect(out.domain_policy_id).toBe("enterprise_saas_b2b_v1");
  });

  it("negative: ecommerce/DTC should not route to enterprise_saas_b2b_v1", () => {
    const text = `
    DTC brand on Shopify Plus with growing Amazon (FBA) channel.
    Unit economics: LTV:CAC 4.2x, CAC $35, AOV $95, ROAS 3.1.
    Gross margin 62%. Conversion rate 3.5%.
    Repeat purchase rate 40% with cohort analysis.
    `;

    const out = classifyDealV1({
      documents: [{ full_text: text }],
      evidence: [],
    });

    expect(out.selected_policy).toBe("consumer_ecommerce_brand_v1");
    expect(out.selected_policy).not.toBe("enterprise_saas_b2b_v1");
  });

  it("negative: ecommerce/DTC should not route to physical_product_cpg_spirits_v1", () => {
    const text = `
    DTC brand on Shopify Plus with growing Amazon (FBA) channel.
    Unit economics: LTV:CAC 4.2x, CAC $35, AOV $95, ROAS 3.1.
    Gross margin 62%. Conversion rate 3.5%.
    Repeat purchase rate 40% with cohort analysis.
    `;

    const out = classifyDealV1({
      documents: [{ full_text: text }],
      evidence: [],
    });

    expect(out.selected_policy).toBe("consumer_ecommerce_brand_v1");
    expect(out.selected_policy).not.toBe("physical_product_cpg_spirits_v1");
  });
});
