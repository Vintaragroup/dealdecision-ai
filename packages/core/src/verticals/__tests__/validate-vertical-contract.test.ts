import { validateReportAgainstContract } from "../validate-vertical-contract";
import type { VerticalKey } from "../vertical-contracts";

describe("validateReportAgainstContract", () => {
  const baseExcerpt = () => ({
    structured_summary: {
      kpis: {
        revenue: {
          value_raw: null,
          value: null,
          scope_label: null,
          selection_reason: "not_extracted_yet",
          source: null,
        },
      },
    },
    score_explanation: {
      understanding_v1: {
        diligence_open_items: { count: 3, items: ["a", "b", "c"] },
      },
    },
  });

  it("product: product_definition contains 'collab' should error", () => {
    const vertical: VerticalKey = "product";
    const excerpt = {
      ...baseExcerpt(),
      product_summary: {
        product_definition: "Limited collab with a major brand.",
      },
    };

    const res = validateReportAgainstContract({ vertical, reportExcerpt: excerpt });
    const codes = res.violations.filter((v) => v.severity === "error").map((v) => v.code);
    expect(codes).toContain("product_definition.forbidden_token");
  });

  it("services: revenue value_raw contains 'MRR' should error", () => {
    const vertical: VerticalKey = "services";
    const excerpt = {
      ...baseExcerpt(),
      structured_summary: {
        kpis: {
          revenue: {
            value_raw: "$10k MRR",
            value: "$10k MRR",
            scope_label: "Revenue",
            selection_reason: "input_metric_preferred",
            source: { page: 3, slide_title: "Traction" },
          },
        },
      },
      product_summary: {
        product_definition: "A retained services offering.",
      },
    };

    const res = validateReportAgainstContract({ vertical, reportExcerpt: excerpt });
    const codes = res.violations.filter((v) => v.severity === "error").map((v) => v.code);
    expect(codes).toContain("revenue.value_raw.forbidden_metric_token");
  });

  it("technology: label 'Revenue (2024)' OK; 'IRR' forbidden", () => {
    const vertical: VerticalKey = "technology";

    const okExcerpt = {
      ...baseExcerpt(),
      structured_summary: {
        kpis: {
          revenue: {
            value_raw: "$1.2M",
            value: "$1.2M",
            scope_label: "Revenue (2024)",
            selection_reason: "financial_table_preferred",
            source: { page: 4, slide_title: "Financials" },
          },
        },
      },
      product_summary: {
        product_definition: "Compliance automation software.",
      },
    };

    const okRes = validateReportAgainstContract({ vertical, reportExcerpt: okExcerpt });
    expect(okRes.summary.errors).toBe(0);

    const badExcerpt = {
      ...baseExcerpt(),
      structured_summary: {
        kpis: {
          revenue: {
            value_raw: "20%",
            value: "20%",
            scope_label: "IRR",
            selection_reason: "input_metric_preferred",
            source: { page: 2, slide_title: "Returns" },
          },
        },
      },
      product_summary: {
        product_definition: "Compliance automation software.",
      },
    };

    const badRes = validateReportAgainstContract({ vertical, reportExcerpt: badExcerpt });
    const codes = badRes.violations.filter((v) => v.severity === "error").map((v) => v.code);
    expect(codes).toContain("revenue.label.forbidden");
  });

  it("real_estate: revenue present should error; IRR allowed in returns", () => {
    const vertical: VerticalKey = "real_estate";

    const excerpt = {
      ...baseExcerpt(),
      structured_summary: {
        kpis: {
          revenue: {
            value_raw: "IRR 18%",
            value: "IRR 18%",
            scope_label: "Revenue",
            selection_reason: null,
            source: { page: 8, slide_title: "Underwriting" },
          },
        },
      },
    };

    const res = validateReportAgainstContract({ vertical, reportExcerpt: excerpt });
    expect(res.summary.errors).toBeGreaterThan(0);
  });

  it("other: ARR/MRR forbidden", () => {
    const vertical: VerticalKey = "other";

    const excerpt = {
      ...baseExcerpt(),
      structured_summary: {
        kpis: {
          revenue: {
            value_raw: "ARR $1.0M",
            value: "ARR $1.0M",
            scope_label: "Revenue",
            selection_reason: "input_metric_preferred",
            source: { page: 1, slide_title: "Summary" },
          },
        },
      },
    };

    const res = validateReportAgainstContract({ vertical, reportExcerpt: excerpt });
    const codes = res.violations.filter((v) => v.severity === "error").map((v) => v.code);
    expect(codes).toContain("revenue.value_raw.forbidden_metric_token");
  });
});
