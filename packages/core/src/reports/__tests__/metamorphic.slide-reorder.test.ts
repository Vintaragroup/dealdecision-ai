import {
  expectSourcePageToMatch,
  expectSourcePageToNotMatch,
  getPageText,
  makeFixture,
} from "./helpers/makeFixtureReport";

describe("metamorphic: slide reorder does not change values", () => {
  it("keeps raise amount stable but updates citation page_index", () => {
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
        {
          document_id: "doc-1",
          page_index: 2,
          page: 3,
          text: "$20M valuation cap",
        },
      ],
    });

    const reordered = makeFixture({
      pages: [
        {
          document_id: "doc-1",
          page_index: 0,
          page: 1,
          text: "$8B TAM",
        },
        {
          document_id: "doc-1",
          page_index: 1,
          page: 2,
          text: "$20M valuation cap",
        },
        {
          document_id: "doc-1",
          page_index: 2,
          page: 3,
          text: "The Ask: Raising $2M via SAFE",
        },
      ],
    });

    const raise1 = base.report.structured_summary.raise;
    const raise2 = reordered.report.structured_summary.raise;

    expect(raise1.value_json?.amount?.amount).toBe(2_000_000);
    expect(raise2.value_json?.amount?.amount).toBe(2_000_000);

    const src1 = (Array.isArray(raise1.sources) ? raise1.sources[0] : null) as any;
    const src2 = (Array.isArray(raise2.sources) ? raise2.sources[0] : null) as any;

    expect(src1.page_index).toBe(0);
    expect(src2.page_index).toBe(2);

    const txt2 = getPageText(reordered.pageTextByRef, src2);
    expectSourcePageToMatch(txt2, /(ask|raise|raising|SAFE|convertible)/i);
    expectSourcePageToNotMatch(txt2, /(TAM|SAM|SOM|market\s*size|market\s*sizing)/i);
  });
});
