import { makeFixture } from "./helpers/makeFixtureReport";

describe("compiler fixture: XLSX detection priority (documents metadata)", () => {
  it("marks xlsx_present when XLSX-like document exists", () => {
    const { report } = makeFixture({
      pages: [],
      documents: [
        {
          document_id: "doc-xlsx-1",
          kind: "xlsx",
          filename: "financials.xlsx",
          mime_type:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
      ],
    });

    const fc = report.financial_coverage_v1;
    expect(fc).toBeTruthy();

    expect(Array.isArray(fc.sources)).toBe(true);
    expect(fc.sources.some((s: any) => s && s.kind === "xlsx")).toBe(true);

    expect(Array.isArray(fc.notes)).toBe(true);
    expect(fc.notes).toContain("xlsx_present");
  });
});
