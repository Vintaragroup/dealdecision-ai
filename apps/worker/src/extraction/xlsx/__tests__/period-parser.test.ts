/**
 * __tests__/period-parser.test.ts
 *
 * Unit tests for apps/worker/src/extraction/xlsx/period-parser.ts
 *
 * Coverage:
 *  1. Quarterly labels — all surface forms
 *  2. TTM / LTM / trailing labels
 *  3. Annual labels (4-digit, FY short-form, projected E/F suffix)
 *  4. Monthly labels
 *  5. Fallback / unknown labels
 *  6. scope_context output for classifyTemporalScope() integration
 *  7. is_projected flag
 */

import { describe, it, expect } from "vitest";
import { parsePeriodLabel } from "../period-parser.js";

// ─── Quarterly ─────────────────────────────────────────────────────────────────

describe("parsePeriodLabel — quarterly labels", () => {
  describe("standard Q# YYYY format", () => {
    it("Q1 2024 → quarter=1, year=2024, type=quarterly", () => {
      const r = parsePeriodLabel("Q1 2024");
      expect(r.period_type).toBe("quarterly");
      expect(r.quarter).toBe(1);
      expect(r.year).toBe(2024);
      expect(r.normalized).toBe("Q1 2024");
      expect(r.is_projected).toBe(false);
    });

    it("Q4 2025 → quarter=4, year=2025", () => {
      const r = parsePeriodLabel("Q4 2025");
      expect(r.period_type).toBe("quarterly");
      expect(r.quarter).toBe(4);
      expect(r.year).toBe(2025);
    });

    it("Q2 2025E → is_projected=true, scope_context contains 'projected'", () => {
      const r = parsePeriodLabel("Q2 2025E");
      expect(r.period_type).toBe("quarterly");
      expect(r.quarter).toBe(2);
      expect(r.year).toBe(2025);
      expect(r.is_projected).toBe(true);
      expect(r.scope_context).toContain("projected");
    });

    it("Q3-2024 → dash separator recognized", () => {
      const r = parsePeriodLabel("Q3-2024");
      expect(r.period_type).toBe("quarterly");
      expect(r.quarter).toBe(3);
      expect(r.year).toBe(2024);
      expect(r.normalized).toBe("Q3 2024");
    });

    it("Q1_2024F → underscore separator + F projected suffix", () => {
      const r = parsePeriodLabel("Q1_2024F");
      expect(r.period_type).toBe("quarterly");
      expect(r.is_projected).toBe(true);
      expect(r.normalized).toBe("Q1 2024");
    });
  });

  describe("YYYY-Q# format", () => {
    it("2024-Q1 → quarter=1, year=2024", () => {
      const r = parsePeriodLabel("2024-Q1");
      expect(r.period_type).toBe("quarterly");
      expect(r.quarter).toBe(1);
      expect(r.year).toBe(2024);
      expect(r.normalized).toBe("Q1 2024");
    });

    it("2024/Q2 → slash separator recognized", () => {
      const r = parsePeriodLabel("2024/Q2");
      expect(r.period_type).toBe("quarterly");
      expect(r.quarter).toBe(2);
      expect(r.year).toBe(2024);
    });
  });

  describe("short-form quarter-leading (1Q24, 2Q25E)", () => {
    it("1Q24 → quarter=1, year=2024 (2-digit year expanded)", () => {
      const r = parsePeriodLabel("1Q24");
      expect(r.period_type).toBe("quarterly");
      expect(r.quarter).toBe(1);
      expect(r.year).toBe(2024);
      expect(r.normalized).toBe("Q1 2024");
    });

    it("2Q25 → quarter=2, year=2025", () => {
      const r = parsePeriodLabel("2Q25");
      expect(r.period_type).toBe("quarterly");
      expect(r.quarter).toBe(2);
      expect(r.year).toBe(2025);
    });

    it("3Q26E → quarter=3, year=2026, is_projected=true", () => {
      const r = parsePeriodLabel("3Q26E");
      expect(r.period_type).toBe("quarterly");
      expect(r.quarter).toBe(3);
      expect(r.year).toBe(2026);
      expect(r.is_projected).toBe(true);
    });

    it("1Q2026 → quarter=1, year=2026 (4-digit year)", () => {
      const r = parsePeriodLabel("1Q2026");
      expect(r.period_type).toBe("quarterly");
      expect(r.quarter).toBe(1);
      expect(r.year).toBe(2026);
      expect(r.normalized).toBe("Q1 2026");
    });

    it("3Q2026 → quarter=3, year=2026 (4-digit year)", () => {
      const r = parsePeriodLabel("3Q2026");
      expect(r.period_type).toBe("quarterly");
      expect(r.quarter).toBe(3);
      expect(r.year).toBe(2026);
    });

    it("4Q2026E → quarter=4, year=2026, is_projected=true (4-digit year)", () => {
      const r = parsePeriodLabel("4Q2026E");
      expect(r.period_type).toBe("quarterly");
      expect(r.quarter).toBe(4);
      expect(r.year).toBe(2026);
      expect(r.is_projected).toBe(true);
    });

    it("2026Q1 → quarter=1, year=2026 (year-leading 4-digit)", () => {
      const r = parsePeriodLabel("2026Q1");
      expect(r.period_type).toBe("quarterly");
      expect(r.quarter).toBe(1);
      expect(r.year).toBe(2026);
    });

    it("2026Q3 → quarter=3, year=2026 (year-leading 4-digit)", () => {
      const r = parsePeriodLabel("2026Q3");
      expect(r.period_type).toBe("quarterly");
      expect(r.quarter).toBe(3);
      expect(r.year).toBe(2026);
    });
  });

  describe("FY-prefixed quarterly (FY25 Q1, FY2025-Q3)", () => {
    it("FY25 Q1 → quarter=1, year=2025 (2-digit FY expanded)", () => {
      const r = parsePeriodLabel("FY25 Q1");
      expect(r.period_type).toBe("quarterly");
      expect(r.quarter).toBe(1);
      expect(r.year).toBe(2025);
      expect(r.normalized).toBe("Q1 2025");
    });

    it("FY2025 Q3 → quarter=3, year=2025 (4-digit FY)", () => {
      const r = parsePeriodLabel("FY2025 Q3");
      expect(r.period_type).toBe("quarterly");
      expect(r.quarter).toBe(3);
      expect(r.year).toBe(2025);
    });

    it("FY25Q1E → quarter=1, year=2025, is_projected=true", () => {
      const r = parsePeriodLabel("FY25Q1E");
      expect(r.period_type).toBe("quarterly");
      expect(r.quarter).toBe(1);
      expect(r.year).toBe(2025);
      expect(r.is_projected).toBe(true);
    });
  });

  describe("'Quarter N YYYY' written form", () => {
    it("Quarter 3 2026 → quarter=3, year=2026", () => {
      const r = parsePeriodLabel("Quarter 3 2026");
      expect(r.period_type).toBe("quarterly");
      expect(r.quarter).toBe(3);
      expect(r.year).toBe(2026);
      expect(r.normalized).toBe("Q3 2026");
    });

    it("Quarter 1 2025E → is_projected=true", () => {
      const r = parsePeriodLabel("Quarter 1 2025E");
      expect(r.period_type).toBe("quarterly");
      expect(r.is_projected).toBe(true);
    });
  });
});

// ─── TTM / LTM ────────────────────────────────────────────────────────────────

describe("parsePeriodLabel — TTM / LTM labels", () => {
  it("TTM → period_type=ttm, normalized='TTM', scope_context contains 'ttm'", () => {
    const r = parsePeriodLabel("TTM");
    expect(r.period_type).toBe("ttm");
    expect(r.normalized).toBe("TTM");
    expect(r.year).toBeNull();
    expect(r.quarter).toBeNull();
    expect(r.is_projected).toBe(false);
    expect(r.scope_context).toContain("ttm");
  });

  it("LTM → period_type=ttm, normalized='TTM'", () => {
    const r = parsePeriodLabel("LTM");
    expect(r.period_type).toBe("ttm");
    expect(r.normalized).toBe("TTM");
  });

  it("T12M → period_type=ttm", () => {
    const r = parsePeriodLabel("T12M");
    expect(r.period_type).toBe("ttm");
    expect(r.normalized).toBe("TTM");
  });

  it("Trailing Twelve Months → period_type=ttm", () => {
    const r = parsePeriodLabel("Trailing Twelve Months");
    expect(r.period_type).toBe("ttm");
    expect(r.normalized).toBe("TTM");
    expect(r.scope_context).toContain("ttm");
  });

  it("Last Twelve Months → period_type=ttm", () => {
    const r = parsePeriodLabel("Last Twelve Months");
    expect(r.period_type).toBe("ttm");
    expect(r.normalized).toBe("TTM");
  });

  it("Trailing 12 Months → period_type=ttm", () => {
    const r = parsePeriodLabel("Trailing 12 Months");
    expect(r.period_type).toBe("ttm");
    expect(r.normalized).toBe("TTM");
  });
});

// ─── Annual ───────────────────────────────────────────────────────────────────

describe("parsePeriodLabel — annual labels", () => {
  it("2024 → period_type=annual, year=2024, normalized='2024'", () => {
    const r = parsePeriodLabel("2024");
    expect(r.period_type).toBe("annual");
    expect(r.year).toBe(2024);
    expect(r.quarter).toBeNull();
    expect(r.normalized).toBe("2024");
    expect(r.is_projected).toBe(false);
  });

  it("2025E → is_projected=true, scope_context contains 'projected'", () => {
    const r = parsePeriodLabel("2025E");
    expect(r.period_type).toBe("annual");
    expect(r.year).toBe(2025);
    expect(r.is_projected).toBe(true);
    expect(r.scope_context).toContain("projected");
  });

  it("2024F → is_projected=true (F suffix)", () => {
    const r = parsePeriodLabel("2024F");
    expect(r.period_type).toBe("annual");
    expect(r.is_projected).toBe(true);
  });

  it("FY2024 → period_type=annual, year=2024", () => {
    const r = parsePeriodLabel("FY2024");
    expect(r.period_type).toBe("annual");
    expect(r.year).toBe(2024);
    expect(r.is_projected).toBe(false);
  });

  it("FY2025E → period_type=annual, is_projected=true", () => {
    const r = parsePeriodLabel("FY2025E");
    expect(r.period_type).toBe("annual");
    expect(r.year).toBe(2025);
    expect(r.is_projected).toBe(true);
  });

  it("FY24 → period_type=annual, year=2024 (2-digit FY expanded)", () => {
    const r = parsePeriodLabel("FY24");
    expect(r.period_type).toBe("annual");
    expect(r.year).toBe(2024);
  });

  it("FY25E → period_type=annual, year=2025, is_projected=true", () => {
    const r = parsePeriodLabel("FY25E");
    expect(r.period_type).toBe("annual");
    expect(r.year).toBe(2025);
    expect(r.is_projected).toBe(true);
  });
});

// ─── Monthly ──────────────────────────────────────────────────────────────────

describe("parsePeriodLabel — monthly labels", () => {
  it("2024-03 → period_type=monthly, year=2024", () => {
    const r = parsePeriodLabel("2024-03");
    expect(r.period_type).toBe("monthly");
    expect(r.year).toBe(2024);
    expect(r.quarter).toBeNull();
    expect(r.normalized).toBe("2024-03");
  });

  it("2025-01 → period_type=monthly", () => {
    const r = parsePeriodLabel("2025-01");
    expect(r.period_type).toBe("monthly");
    expect(r.year).toBe(2025);
  });
});

// ─── Unknown / fallback ───────────────────────────────────────────────────────

describe("parsePeriodLabel — unknown / fallback", () => {
  it("empty string → period_type=unknown, normalized=''", () => {
    const r = parsePeriodLabel("");
    expect(r.period_type).toBe("unknown");
    expect(r.normalized).toBe("");
  });

  it("arbitrary label 'Revenue' → period_type=unknown", () => {
    const r = parsePeriodLabel("Revenue");
    expect(r.period_type).toBe("unknown");
    expect(r.normalized).toBe("Revenue");
  });

  it("scenario label 'Base' → period_type=unknown (scenarios handled upstream)", () => {
    const r = parsePeriodLabel("Base");
    expect(r.period_type).toBe("unknown");
  });

  it("'YTD' → period_type=unknown (not handled by period-parser; scope handled by classifyTemporalScope)", () => {
    // YTD is not a period type we normalize here — classifyTemporalScope handles it via CURRENT_KEYWORDS
    const r = parsePeriodLabel("YTD");
    expect(r.period_type).toBe("unknown");
  });
});

// ─── scope_context signal pass-through ───────────────────────────────────────

describe("parsePeriodLabel — scope_context for classifyTemporalScope integration", () => {
  it("projected annual gives non-empty scope_context", () => {
    const r = parsePeriodLabel("2026E");
    expect(r.scope_context).toMatch(/projected/i);
    expect(r.scope_context).toContain("2026");
  });

  it("historical annual gives empty scope_context (year comparison handles it)", () => {
    const r = parsePeriodLabel("2022");
    expect(r.scope_context).toBe("");
  });

  it("TTM gives 'ttm trailing' scope_context", () => {
    const r = parsePeriodLabel("TTM");
    expect(r.scope_context).toBe("ttm trailing");
  });

  it("projected quarterly gives non-empty scope_context", () => {
    const r = parsePeriodLabel("Q1 2027E");
    expect(r.scope_context).toMatch(/projected/i);
    expect(r.scope_context).toContain("2027");
  });

  it("historical quarterly gives empty scope_context", () => {
    const r = parsePeriodLabel("Q3 2022");
    expect(r.scope_context).toBe("");
  });
});

describe("ordinal forecast-year labels (Year N / Yr N)", () => {
  it("Year 1 → annual, is_projected=true, scope_context='projected forecast ordinal'", () => {
    const r = parsePeriodLabel("Year 1");
    expect(r.period_type).toBe("annual");
    expect(r.is_projected).toBe(true);
    expect(r.scope_context).toBe("projected forecast ordinal");
    expect(r.year).toBeNull();
    expect(r.normalized).toBe("Year 1");
  });

  it("Year 2 → projected", () => {
    const r = parsePeriodLabel("Year 2");
    expect(r.is_projected).toBe(true);
    expect(r.period_type).toBe("annual");
  });

  it("Yr 3 → projected (abbreviated prefix)", () => {
    const r = parsePeriodLabel("Yr 3");
    expect(r.is_projected).toBe(true);
    expect(r.scope_context).toBe("projected forecast ordinal");
  });

  it("Year 1E → is_projected=true (E suffix variant)", () => {
    const r = parsePeriodLabel("Year 1E");
    expect(r.is_projected).toBe(true);
    expect(r.period_type).toBe("annual");
  });

  it("Year 2F → is_projected=true (F suffix forecast variant)", () => {
    const r = parsePeriodLabel("Year 2F");
    expect(r.is_projected).toBe(true);
    expect(r.period_type).toBe("annual");
  });

  it("Year 5 → projected (large ordinal)", () => {
    const r = parsePeriodLabel("Year 5");
    expect(r.is_projected).toBe(true);
    expect(r.period_type).toBe("annual");
  });

  it("Year 1 → year is null (no calendar year determinable)", () => {
    const r = parsePeriodLabel("Year 1");
    expect(r.year).toBeNull();
    expect(r.quarter).toBeNull();
  });

  it("YEAR 1 (uppercase) → matched (case-insensitive)", () => {
    const r = parsePeriodLabel("YEAR 1");
    expect(r.is_projected).toBe(true);
  });

  it("'Year' alone (no number) → falls through to fallback (not ordinal match)", () => {
    const r = parsePeriodLabel("Year");
    // No number → no match for pattern 12 → fallback
    expect(r.is_projected).toBe(false);
  });
});

// ─── Named-month labels (Fix #5 — period label validation) ───────────────────

describe("parsePeriodLabel — named month labels", () => {
  it.each([
    ["September"],
    ["January"],
    ["December"],
    ["October"],
  ])('"%s" (full name) → period_type=monthly, year=null, is_projected=false', (label) => {
    const r = parsePeriodLabel(label);
    expect(r.period_type).toBe("monthly");
    expect(r.year).toBeNull();
    expect(r.is_projected).toBe(false);
    expect(r.normalized).toBe(label);
  });

  it.each([
    ["Jan"],
    ["Feb"],
    ["Mar"],
    ["Apr"],
    ["May"],
    ["Jun"],
    ["Jul"],
    ["Aug"],
    ["Sep"],
    ["Oct"],
    ["Nov"],
    ["Dec"],
  ])('"%s" (3-letter abbreviation) → period_type=monthly', (label) => {
    const r = parsePeriodLabel(label);
    expect(r.period_type).toBe("monthly");
    expect(r.year).toBeNull();
  });

  it('"Sep 2026" → period_type=monthly, year=2026', () => {
    const r = parsePeriodLabel("Sep 2026");
    expect(r.period_type).toBe("monthly");
    expect(r.year).toBe(2026);
    expect(r.quarter).toBeNull();
    expect(r.is_projected).toBe(false);
  });

  it('"October 2027" → period_type=monthly, year=2027', () => {
    const r = parsePeriodLabel("October 2027");
    expect(r.period_type).toBe("monthly");
    expect(r.year).toBe(2027);
  });

  it('"January 2025" → period_type=monthly, year=2025', () => {
    const r = parsePeriodLabel("January 2025");
    expect(r.period_type).toBe("monthly");
    expect(r.year).toBe(2025);
  });

  it.each(["Month 1", "Month 3", "Month 9", "Month 12"])(
    '"%s" → period_type=monthly, year=null',
    (label) => {
      const r = parsePeriodLabel(label);
      expect(r.period_type).toBe("monthly");
      expect(r.year).toBeNull();
      expect(r.is_projected).toBe(false);
    },
  );
});

// ─── Column-index labels (Fix #5 — period label validation) ──────────────────

describe("parsePeriodLabel — column-index labels", () => {
  it.each(["col_M", "col_A", "col_Z", "col_13", "column_4"])(
    '"%s" → period_type=unknown, normalized unchanged, no throw',
    (label) => {
      const r = parsePeriodLabel(label);
      expect(r.period_type).toBe("unknown");
      expect(r.normalized).toBe(label);
    },
  );

  it.each(["col_M", "col_A", "col_Z", "col_13", "column_4"])(
    '"%s" is NOT classified as annual or quarterly',
    (label) => {
      const r = parsePeriodLabel(label);
      expect(r.period_type).not.toBe("annual");
      expect(r.period_type).not.toBe("quarterly");
    },
  );
});
