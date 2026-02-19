import {
  expectSourcePageToMatch,
  expectSourcePageToNotMatch,
  getPageText,
  makeFixture,
} from "./helpers/makeFixtureReport";

describe("compiler fixture: market vs revenue slide accuracy", () => {
  it("keeps ARR/revenue evidence on KPI slide (not market slide)", () => {
    const { report, pageTextByRef } = makeFixture({
      pages: [
        {
          document_id: "doc-1",
          page_index: 0,
          page: 1,
          text: "KPI: $500k ARR",
        },
        {
          document_id: "doc-1",
          page_index: 1,
          page: 2,
          text: "$8B market",
        },
      ],
      documents: [
        {
          document_id: "doc-1",
          kind: "pitch_deck",
          filename: "deck.pdf",
          metrics: [
            {
              key: "ARR",
              value: "$500k ARR",
              unit: "USD",
              page: 1,
              confidence: 0.95,
            },
          ],
        },
      ],
    });

    expect(report.structured_summary).toBeTruthy();
    expect(report.structured_summary.revenue).toBeTruthy();

    const revenue = report.structured_summary.revenue;
    expect(revenue.value?.amount).toBe(500_000);
    expect(revenue.value?.period).toBe("ARR");

    expect(Array.isArray(revenue.sources)).toBe(true);
    expect(revenue.sources.length).toBeGreaterThan(0);

    const primary = revenue.sources[0] as any;
    const pageText = getPageText(pageTextByRef, primary);

    // Evidence must align to ARR/KPI slide.
    expectSourcePageToMatch(pageText, /\bARR\b/i);
    expectSourcePageToNotMatch(pageText, /\bmarket\b/i);

    // Financial coverage should also attribute historical revenue to KPI slide (not market sizing).
    const fc = report.financial_coverage_v1;
    expect(fc).toBeTruthy();
    expect(fc.coverage?.historical_revenue_present).toBe(true);

    const ev = fc.evidence?.historical_revenue_present as any;
    expect(ev).toBeTruthy();

    const evText = getPageText(pageTextByRef, ev);
    expectSourcePageToMatch(evText, /\bARR\b/i);
    expectSourcePageToNotMatch(evText, /\bmarket\b/i);
  });
});
