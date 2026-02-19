import {
  expectSourcePageToMatch,
  expectSourcePageToNotMatch,
  getPageText,
  makeFixture,
} from "./helpers/makeFixtureReport";

describe("compiler fixture: historical vs forecast slide accuracy", () => {
  it("sets coverage flags and keeps TAM slide out of revenue citations", () => {
    const { report, pageTextByRef } = makeFixture({
      pages: [
        {
          document_id: "doc-1",
          page_index: 0,
          page: 1,
          text: "2024 Revenue: $500k",
        },
        {
          document_id: "doc-1",
          page_index: 1,
          page: 2,
          text: "2026 Forecast: $10M",
        },
        {
          document_id: "doc-1",
          page_index: 2,
          page: 3,
          text: "$100B market",
        },
      ],
    });

    expect(report.financial_coverage_v1).toBeTruthy();
    expect(report.financial_coverage_v1.coverage.historical_revenue_present).toBe(true);
    expect(report.financial_coverage_v1.coverage.forecast_revenue_present).toBe(true);

    expect(report.traction_signal_v1).toBeTruthy();
    expect(report.traction_signal_v1.historical_revenue_present).toBe(true);
    expect(report.traction_signal_v1.forecast_revenue_present).toBe(true);

    const ev = report.financial_coverage_v1.evidence ?? {};
    const hist = ev.historical_revenue_present;
    const fore = ev.forecast_revenue_present;

    expect(hist).toBeTruthy();
    expect(fore).toBeTruthy();

    const histText = getPageText(pageTextByRef, hist);
    expectSourcePageToMatch(histText, /(2024|actual|revenue)/i);
    expectSourcePageToNotMatch(histText, /(forecast|projection|projected)/i);

    const foreText = getPageText(pageTextByRef, fore);
    expectSourcePageToMatch(foreText, /(forecast|projection|projected|2026)/i);

    // TAM slide must never be used as the evidence page for historical/forecast revenue.
    expect((hist as any).page_index).not.toBe(2);
    expect((fore as any).page_index).not.toBe(2);

    // Also assert the cited page text for revenue evidence is not market sizing.
    expectSourcePageToNotMatch(histText, /(TAM|SAM|SOM|market\s*size|market\s*sizing)/i);
    expectSourcePageToNotMatch(foreText, /(TAM|SAM|SOM|market\s*size|market\s*sizing)/i);
  });
});
