import { buildDIOContext, buildDIOContextFromInputData } from "../dio-context";
import fs from "fs";
import path from "path";

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

describe("buildDIOContextFromInputData (multi-document aggregation)", () => {
  it("pitch_deck + financials spreadsheet -> primary_doc_type pitch_deck; deal_type startup_raise", async () => {
    const input_data = {
      documents: [
        {
          title: "WebMax Pitch Deck.pdf",
          filename: "WebMax_Pitch_Deck.pdf",
          contentType: "application/pdf",
          totalPages: 14,
          mainHeadings: [
            "Problem",
            "Solution",
            "Traction",
            "Market",
            "Team",
            "Use of Funds",
            "We are raising $5M Seed",
          ],
        },
        {
          title: "WebMax Financial Model.xlsx",
          filename: "WebMax_Financial_Model.xlsx",
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          totalPages: 0,
          mainHeadings: ["P&L", "Cash Flow", "Forecast"],
        },
      ],
    };

    const ctx = await buildDIOContextFromInputData(input_data as any);

    expect(ctx.primary_doc_type).toBe("pitch_deck");
    expect(ctx.deal_type).toBe("startup_raise");
    expect(ctx.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it("long business plan + small pitch attachment -> primary_doc_type business_plan_im", async () => {
    const input_data = {
      documents: [
        {
          title: "Acme Business Plan (Investment Memorandum).pdf",
          filename: "Acme_Business_Plan_IM.pdf",
          contentType: "application/pdf",
          totalPages: 42,
          mainHeadings: [
            "Investment Memorandum",
            "Executive Summary",
            "Business Plan",
            "Market Overview",
            "Financial Projections",
            "Use of Funds",
            "Valuation",
            "Risk Factors",
            "Terms",
          ],
        },
        {
          title: "Acme Pitch Attachment.pdf",
          filename: "Acme_Pitch_Attachment.pdf",
          contentType: "application/pdf",
          totalPages: 5,
          mainHeadings: ["Appendix", "Screenshots", "Team Bios"],
        },
      ],
    };

    const ctx = await buildDIOContextFromInputData(input_data as any);

    expect(ctx.primary_doc_type).toBe("business_plan_im");
    expect(ctx.primary_doc_type).not.toBe("pitch_deck");
  });

  it("fund deck + tear sheet + financials (no pitch deck) -> deal_type fund_spv", async () => {
    const input_data = {
      documents: [
        {
          title: "Vintara Fund Investment Memorandum.pdf",
          filename: "Vintara_Fund_IM.pdf",
          contentType: "application/pdf",
          totalPages: 28,
          mainHeadings: [
            "Fund Overview",
            "Limited Partners",
            "General Partner",
            "Management Fee & Carry",
            "Subscription Agreement",
            "SPV Structure",
          ],
        },
        {
          title: "Deal Tear Sheet.pdf",
          filename: "Tear_Sheet.pdf",
          contentType: "application/pdf",
          totalPages: 2,
          mainHeadings: ["Executive Summary", "Terms", "Private Placement"],
        },
        {
          title: "Fund Financials.xlsx",
          filename: "Fund_Financials.xlsx",
          contentType: "application/vnd.ms-excel",
          totalPages: 0,
          mainHeadings: ["Financial", "Model"],
        },
      ],
    };

    const ctx = await buildDIOContextFromInputData(input_data as any);

    expect(ctx.deal_type).toBe("fund_spv");
    expect(["business_plan_im", "financials", "exec_summary", "one_pager", "other"]).toContain(ctx.primary_doc_type);
    expect(ctx.primary_doc_type).not.toBe("pitch_deck");
    expect(ctx.confidence).toBeGreaterThanOrEqual(0.34);
  });

  it("Vintara v4 report fixture: long IM/business-plan PDF should not be classified as pitch_deck", async () => {
    const fixturePath = path.resolve(
      __dirname,
      "../../../../..",
      "docs/dio-reports/reports/vintara-group-llc_v4.json"
    );
    const raw = fs.readFileSync(fixturePath, "utf-8");
    const parsed = JSON.parse(raw);
    const docs = parsed?.latestDio?.dio?.inputs?.documents;
    expect(Array.isArray(docs)).toBe(true);
    expect(docs.length).toBeGreaterThanOrEqual(1);

    const ctx = await buildDIOContextFromInputData({ documents: docs } as any);

    expect(ctx.primary_doc_type).not.toBe("pitch_deck");
    expect(["business_plan_im", "exec_summary"]).toContain(ctx.primary_doc_type);
  });
});
