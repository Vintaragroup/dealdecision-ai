import { classifyDealV1 } from "../deal-classifier";

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
});
