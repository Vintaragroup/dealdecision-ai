/**
 * Tests for temporal-scope.ts — canonical temporal classification primitive.
 *
 * Coverage:
 *   - classifyTemporalScope: year-based heuristics (past / current / future)
 *   - classifyTemporalScope: keyword priority chain (scenario > projected > target > current > historical)
 *   - classifyTemporalScope: subtype override (highest priority)
 *   - classifyTemporalScope: unknown fallback
 *   - extractYearFromLabel: various label formats
 *   - isProjectedScope: projected/scenario/target → true, others → false
 *   - temporalScopeLabel: human-readable qualifier suffixes
 */

import {
  classifyTemporalScope,
  extractYearFromLabel,
  isProjectedScope,
  temporalScopeLabel,
  type TemporalScope,
} from "../temporal/temporal-scope";

// ─── classifyTemporalScope — year arithmetic ──────────────────────────────────

const CURRENT_YEAR = new Date().getFullYear();

describe("classifyTemporalScope — year arithmetic (no context text)", () => {
  it("past year → historical", () => {
    expect(classifyTemporalScope(2020, "", undefined, 2025)).toBe("historical");
  });

  it("future year → projected", () => {
    expect(classifyTemporalScope(2030, "", undefined, 2025)).toBe("projected");
  });

  it("current year → current", () => {
    expect(classifyTemporalScope(CURRENT_YEAR, "")).toBe("current");
  });

  it("null year + no context → unknown", () => {
    expect(classifyTemporalScope(null, "")).toBe("unknown");
  });
});

// ─── classifyTemporalScope — keyword priority chain ───────────────────────────

describe("classifyTemporalScope — scenario keywords fire before projected", () => {
  it("'base case scenario' → scenario", () => {
    expect(classifyTemporalScope(null, "base case scenario revenue")).toBe("scenario");
  });

  it("'bull case upside' → scenario", () => {
    expect(classifyTemporalScope(null, "bull case upside revenue of $5M")).toBe("scenario");
  });

  it("'bear case downside' → scenario", () => {
    expect(classifyTemporalScope(null, "bear case downside sensitivity analysis")).toBe("scenario");
  });
});

describe("classifyTemporalScope — projected keywords", () => {
  it("'forecasted revenue' → projected", () => {
    expect(classifyTemporalScope(null, "forecasted revenue for next year")).toBe("projected");
  });

  it("'pro forma ARR' → projected", () => {
    expect(classifyTemporalScope(null, "pro forma ARR based on signed contracts")).toBe("projected");
  });

  it("'forward-looking revenue guidance' → projected", () => {
    expect(classifyTemporalScope(null, "forward-looking revenue guidance")).toBe("projected");
  });

  it("'budgeted expenses' → projected", () => {
    expect(classifyTemporalScope(null, "budgeted expenses for FY2026")).toBe("projected");
  });
});

describe("classifyTemporalScope — target keywords (lower priority than projected)", () => {
  it("'target ARR' → target", () => {
    expect(classifyTemporalScope(null, "target ARR of $10M by end of year")).toBe("target");
  });

  it("'goal of $5M milestone' → target", () => {
    expect(classifyTemporalScope(null, "goal of $5M milestone for Q4")).toBe("target");
  });

  it("projected keyword beats target keyword", () => {
    expect(classifyTemporalScope(null, "forecasted target ARR of $10M")).toBe("projected");
  });
});

describe("classifyTemporalScope — current keywords", () => {
  it("'TTM revenue' → current", () => {
    expect(classifyTemporalScope(null, "TTM revenue of $2.4M")).toBe("current");
  });

  it("'trailing twelve months' → current", () => {
    expect(classifyTemporalScope(null, "trailing twelve months EBITDA")).toBe("current");
  });

  it("'run rate ARR' → current", () => {
    expect(classifyTemporalScope(null, "current run rate ARR $1.8M")).toBe("current");
  });

  it("'YTD revenue' → current", () => {
    expect(classifyTemporalScope(null, "YTD revenue through Q3")).toBe("current");
  });
});

describe("classifyTemporalScope — historical keywords", () => {
  it("'actual revenue' → historical", () => {
    expect(classifyTemporalScope(null, "actual revenue for fiscal year 2023")).toBe("historical");
  });

  it("'audited financials as of 2022' → historical", () => {
    expect(classifyTemporalScope(null, "audited financials as of 2022")).toBe("historical");
  });

  it("'prior year EBITDA' → historical", () => {
    expect(classifyTemporalScope(null, "prior year EBITDA of $800K")).toBe("historical");
  });
});

// ─── classifyTemporalScope — subtype override (highest priority) ───────────────

describe("classifyTemporalScope — subtype override beats keywords", () => {
  it("subtype='forecast' → projected even when context says 'actual'", () => {
    expect(classifyTemporalScope(null, "actual revenue figures", "forecast")).toBe("projected");
  });

  it("subtype='actual' → historical even when context says 'forecasted'", () => {
    expect(classifyTemporalScope(null, "forecasted revenue for 2026", "actual")).toBe("historical");
  });

  it("subtype='ttm' → current", () => {
    expect(classifyTemporalScope(null, "", "ttm")).toBe("current");
  });

  it("subtype='scenario' → scenario", () => {
    expect(classifyTemporalScope(null, "", "scenario")).toBe("scenario");
  });

  it("subtype='target' → target", () => {
    expect(classifyTemporalScope(null, "", "target")).toBe("target");
  });

  it("subtype='pro forma' → projected", () => {
    expect(classifyTemporalScope(null, "", "pro forma")).toBe("projected");
  });

  it("unknown subtype falls through to keyword chain", () => {
    expect(classifyTemporalScope(null, "forecasted ARR", "unknown-type")).toBe("projected");
  });
});

// ─── extractYearFromLabel ─────────────────────────────────────────────────────

describe("extractYearFromLabel", () => {
  it("extracts bare 4-digit year", () => {
    expect(extractYearFromLabel("2025")).toBe(2025);
  });

  it("extracts year from FY prefix", () => {
    expect(extractYearFromLabel("FY2025")).toBe(2025);
  });

  it("extracts year from quarter label", () => {
    expect(extractYearFromLabel("Q3 2025")).toBe(2025);
  });

  it("extracts year from ISO date prefix", () => {
    expect(extractYearFromLabel("2025-03")).toBe(2025);
  });

  it("extracts year from prose label", () => {
    expect(extractYearFromLabel("as of Jan 2025")).toBe(2025);
  });

  it("returns null when no year present", () => {
    expect(extractYearFromLabel("no year here")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractYearFromLabel("")).toBeNull();
  });

  it("rejects year below 2000", () => {
    expect(extractYearFromLabel("FY1999")).toBeNull();
  });

  it("accepts year 2099 (upper bound)", () => {
    expect(extractYearFromLabel("2099")).toBe(2099);
  });
});

// ─── isProjectedScope ─────────────────────────────────────────────────────────

describe("isProjectedScope", () => {
  it("projected → true", () => {
    expect(isProjectedScope("projected")).toBe(true);
  });

  it("scenario → true", () => {
    expect(isProjectedScope("scenario")).toBe(true);
  });

  it("target → true", () => {
    expect(isProjectedScope("target")).toBe(true);
  });

  it("historical → false", () => {
    expect(isProjectedScope("historical")).toBe(false);
  });

  it("current → false", () => {
    expect(isProjectedScope("current")).toBe(false);
  });

  it("unknown → false", () => {
    expect(isProjectedScope("unknown")).toBe(false);
  });
});

// ─── temporalScopeLabel ───────────────────────────────────────────────────────

describe("temporalScopeLabel", () => {
  const cases: Array<[TemporalScope, string]> = [
    ["historical", "(historical)"],
    ["current",    "(current)"],
    ["projected",  "(projected)"],
    ["scenario",   "(scenario)"],
    ["target",     "(target)"],
    ["unknown",    ""],
  ];

  for (const [scope, expected] of cases) {
    it(`${scope} → "${expected}"`, () => {
      expect(temporalScopeLabel(scope)).toBe(expected);
    });
  }
});
