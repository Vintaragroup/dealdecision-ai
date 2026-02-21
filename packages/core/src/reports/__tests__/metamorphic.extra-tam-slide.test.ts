import {
  expectSourcePageToMatch,
  expectSourcePageToNotMatch,
  getPageText,
  makeFixture,
} from "./helpers/makeFixtureReport";

describe("metamorphic: extra TAM slide does not steal raise citations", () => {
  it("keeps raise amount and still cites ask slide only", () => {
    const base = makeFixture({
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

    const withExtraTam = makeFixture({
      pages: [
        {
          document_id: "doc-1",
          page_index: 0,
          page: 1,
          text: "$100B TAM",
        },
        {
          document_id: "doc-1",
          page_index: 1,
          page: 2,
          text: "The Ask: Raising $2M via SAFE",
        },
        {
          document_id: "doc-1",
          page_index: 2,
          page: 3,
          text: "$8B TAM",
        },
      ],
    });

    const raise1 = base.report.structured_summary.raise;
    const raise2 = withExtraTam.report.structured_summary.raise;

    expect(raise1.value_json?.amount?.amount).toBe(2_000_000);
    expect(raise2.value_json?.amount?.amount).toBe(2_000_000);

    const src2 = (Array.isArray(raise2.sources) ? raise2.sources[0] : null) as any;
    expect(src2.page_index).toBe(1);

    const txt2 = getPageText(withExtraTam.pageTextByRef, src2);
    expectSourcePageToMatch(txt2, /(ask|raise|raising|SAFE|convertible)/i);
    expectSourcePageToNotMatch(txt2, /(TAM|SAM|SOM|market\s*size|market\s*sizing)/i);
  });
});
