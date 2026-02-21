import { makeFixture } from "./helpers/makeFixtureReport";

describe("compiler fixture: forecast-only revenue governance", () => {
  it("does not set canonical structured_summary.revenue.value when only forecast revenue is present", () => {
    const { report } = makeFixture({
      pages: [
        {
          document_id: "doc-1",
          page_index: 0,
          page: 1,
          text: "2026 Forecast: $10M",
        },
        {
          document_id: "doc-1",
          page_index: 1,
          page: 2,
          text: "$8B market",
        },
      ],
    });

    expect(report.financial_coverage_v1).toBeTruthy();
    expect(report.financial_coverage_v1.coverage.forecast_revenue_present).toBe(true);
    expect(report.financial_coverage_v1.coverage.historical_revenue_present).toBe(false);

    // Canonical revenue must remain unset (forecast is not treated as historical revenue).
    expect(report.structured_summary).toBeTruthy();
    expect(report.structured_summary.revenue).toBeTruthy();
    expect(report.structured_summary.revenue.value).toBeNull();

    if (report.traction_signal_v1) {
      expect(report.traction_signal_v1.forecast_revenue_present).toBe(true);
      expect(report.traction_signal_v1.historical_revenue_present).toBe(false);
    }
  });
});
