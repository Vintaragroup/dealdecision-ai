import {
  expectSourcePageToMatch,
  expectSourcePageToNotMatch,
  getPageText,
  makeFixture,
} from "./helpers/makeFixtureReport";

describe("compiler fixture: raise vs TAM vs valuation slide accuracy", () => {
  it("uses $2M ask for raise and cites ask slide (not TAM or valuation)", () => {
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
        {
          document_id: "doc-1",
          page_index: 2,
          page: 3,
          text: "$20M valuation cap",
        },
      ],
    });

    expect(report.structured_summary).toBeTruthy();
    const raise = report.structured_summary.raise;

    // Compiler outputs structured_summary.raise.value as a display string.
    expect(typeof raise.value).toBe("string");
    expect(raise.value_json?.amount?.amount).toBe(2_000_000);

    expect(Array.isArray(raise.sources)).toBe(true);
    expect(raise.sources.length).toBeGreaterThan(0);

    const primary = raise.sources[0] as any;
    expect(primary.source_document_id).toBe("doc-1");
    expect(primary.page_index).toBe(0);
    expect(primary.page).toBe(1);

    const pageText = getPageText(pageTextByRef, primary);
    expectSourcePageToMatch(pageText, /(ask|raise|raising|SAFE|convertible)/i);
    expectSourcePageToNotMatch(pageText, /(TAM|SAM|SOM|market\s*size|market\s*sizing)/i);
  });
});
