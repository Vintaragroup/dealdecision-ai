import { makeFixture } from "./helpers/makeFixtureReport";

describe("compiler fixture: raise display normalization", () => {
  it("keeps structured_summary.raise.value amount-only (no stage/round leakage)", () => {
    const { report } = makeFixture({
      pages: [
        {
          document_id: "doc-1",
          page_index: 0,
          page: 1,
          text: "The Ask: Raising $2M Pre-Seed via SAFE",
        },
      ],
    });

    expect(report.structured_summary).toBeTruthy();
    const raise = report.structured_summary.raise as any;

    expect(typeof raise.value).toBe("string");
    expect(raise.value_json?.amount?.amount).toBe(2_000_000);
    expect(String(raise.value)).not.toMatch(/\b(pre[-\s]?seed|seed|series\s*[a-z])\b/i);

    expect(raise.value_json?.amount?.amount).toBe(2_000_000);
    expect(raise.round_label).toBe("Pre-Seed");
  });
});
