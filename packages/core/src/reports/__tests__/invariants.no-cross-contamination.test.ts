import { getPageText, makeFixture, expectSourcePageToNotMatch } from "./helpers/makeFixtureReport";

describe("invariants: no cross-contamination across slides", () => {
  it("raise citations never point to market sizing language; historical revenue citations never point to forecast language", () => {
    const { report, pageTextByRef } = makeFixture({
      pages: [
        {
          document_id: "doc-1",
          page_index: 0,
          page: 1,
          text: "The Ask: Raising $2M via SAFE",
        },
        {
          document_id: "doc-1",
          page_index: 1,
          page: 2,
          text: "$8B TAM",
        },
      ],
    });

    const raise = report.structured_summary?.raise;
    const raiseSources: any[] = Array.isArray(raise?.sources) ? raise.sources : [];
    for (const src of raiseSources) {
      const pageText = getPageText(pageTextByRef, src);
      expectSourcePageToNotMatch(pageText, /(TAM|SAM|SOM|market\s*size|market\s*sizing)/i);
    }

    const hist = report.financial_coverage_v1?.evidence?.historical_revenue_present;
    if (hist) {
      const histText = getPageText(pageTextByRef, hist);
      expectSourcePageToNotMatch(histText, /(forecast|projection|projected)/i);
    }
  });
});
