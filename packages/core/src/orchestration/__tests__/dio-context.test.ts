import { buildDIOContext } from "../dio-context";

describe("buildDIOContext (heuristics)", () => {
  it("classifies a typical pitch deck startup raise", async () => {
    const ctx = await buildDIOContext({
      filename: "Acme Pitch Deck.pdf",
      page_count: 12,
      headings: [
        "Problem",
        "Solution",
        "Market",
        "Product",
        "Traction",
        "Business Model",
        "Competition",
        "Team",
        "Financials",
        "The Ask",
        "ARR and Growth",
      ],
    });

    expect(ctx.primary_doc_type).toBe("pitch_deck");
    expect(ctx.deal_type).toBe("startup_raise");
    expect(ctx.vertical).toBe("saas");
    expect(ctx.stage).toBe("unknown");
    expect(ctx.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("classifies executive summary", async () => {
    const ctx = await buildDIOContext({
      filename: "Acme Executive Summary.pdf",
      page_count: 4,
      headings: ["Executive Summary", "Market Overview", "Go-To-Market", "Team"],
    });

    expect(ctx.primary_doc_type).toBe("exec_summary");
    expect(ctx.deal_type).toBe("startup_raise");
    expect(ctx.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("classifies one-pager", async () => {
    const ctx = await buildDIOContext({
      filename: "Acme One Pager.pdf",
      page_count: 1,
      headings: ["One Pager", "Overview", "Product", "Team"],
    });

    expect(ctx.primary_doc_type).toBe("one_pager");
    expect(ctx.deal_type).toBe("startup_raise");
    expect(ctx.confidence).toBeGreaterThanOrEqual(0.65);
  });

  it("classifies financials", async () => {
    const ctx = await buildDIOContext({
      filename: "Acme Financial Model and Projections.pdf",
      page_count: 18,
      headings: ["Income Statement", "Balance Sheet", "Cash Flow", "Projections"],
    });

    expect(ctx.primary_doc_type).toBe("financials");
    expect(ctx.confidence).toBeGreaterThanOrEqual(0.55);
  });

  it("classifies fund/SPV ops", async () => {
    const ctx = await buildDIOContext({
      filename: "Example SPV Investment Memo.pdf",
      page_count: 22,
      headings: ["Private Placement", "Limited Partners", "General Partner", "Terms", "Risk Factors"],
    });

    expect(ctx.deal_type).toBe("fund_spv");
    expect(ctx.stage).toBe("fund_ops");
    expect(ctx.confidence).toBeGreaterThanOrEqual(0.65);
  });

  it("classifies crypto mining", async () => {
    const ctx = await buildDIOContext({
      filename: "BTC Mining Investment Memorandum.pdf",
      page_count: 30,
      headings: ["Hashrate", "ASIC Fleet", "Hosting", "Power Costs", "Bitcoin", "Risk Factors"],
    });

    expect(ctx.deal_type).toBe("crypto_mining");
    expect(ctx.vertical).toBe("crypto");
    expect(ctx.confidence).toBeGreaterThanOrEqual(0.65);
  });

  it("detects explicit stage (seed)", async () => {
    const ctx = await buildDIOContext({
      filename: "Acme Seed Round Deck.pdf",
      page_count: 13,
      headings: ["Seed Round", "Problem", "Solution", "Traction", "Team", "Ask"],
    });

    expect(ctx.stage).toBe("seed");
    expect(ctx.confidence).toBeGreaterThanOrEqual(0.65);
  });
});
