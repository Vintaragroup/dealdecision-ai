import {
  expectSourcePageToMatch,
  expectSourcePageToNotMatch,
  getPageText,
  makeFixture,
} from "./helpers/makeFixtureReport";

describe("compiler fixture: bookings vs ARR slide accuracy", () => {
  it("does not confuse bookings with ARR revenue evidence", () => {
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
          text: "2024 Bookings: $2M",
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

    const revenue = report.structured_summary.revenue;
    expect(revenue).toBeTruthy();
    expect(revenue.value?.amount).toBe(500_000);
    expect(revenue.value?.period).toBe("ARR");

    const primary = (Array.isArray(revenue.sources) ? revenue.sources[0] : null) as any;
    expect(primary).toBeTruthy();

    const pageText = getPageText(pageTextByRef, primary);
    expectSourcePageToMatch(pageText, /\bARR\b/i);
    expectSourcePageToNotMatch(pageText, /\bbookings\b/i);

    // Traction should reflect that bookings are present (from promoted facts)
    // while recurring revenue is also present (from structured_summary revenue).
    const tr = report.traction_signal_v1;
    expect(tr).toBeTruthy();
    expect(tr.bookings_present).toBe(true);
    expect(tr.recurring_revenue_present).toBe(true);
  });
});
