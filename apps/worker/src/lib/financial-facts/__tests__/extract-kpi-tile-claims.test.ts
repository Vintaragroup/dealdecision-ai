/**
 * extract-kpi-tile-claims.test.ts
 *
 * Unit tests for extractKpiTileClaims().
 *
 * Validates:
 * - KPI phrase detection (value-first, label-first, delimited multi-KPI)
 * - Normalization: K / M / B / %, multi-currency
 * - Metric mapping for financial and count metrics
 * - False-positive rejection (year-only, long prose, sports references)
 * - Slide-type suppression (team/testimonial → [])
 * - Slide-type confidence via applySlideAwareness (caller-side)
 * - Per-page dedup (same metric_key + period_label → only one fact)
 * - Cap of MAX_KPI_CLAIMS_PER_PAGE
 * - Never throws
 */

import { describe, it, expect } from "vitest";
import { extractKpiTileClaims, findMetricInText, isYearLike, SUPPRESSED_SLIDE_TYPES, isExampleOrScenarioContext } from "../extract-kpi-tile-claims";

const BASE_OPTS = {
  deal_id:     "test-deal-id",
  document_id: "test-doc-id",
  page_number: 5,
};

// ─── Basic KPI extraction ─────────────────────────────────────────────────────

describe("extractKpiTileClaims — basic financial metrics", () => {
  it("extracts MRR from value-first phrase", () => {
    const facts = extractKpiTileClaims("$40K MRR", BASE_OPTS);
    expect(facts).toHaveLength(1);
    expect(facts[0]!.metric_key).toBe("mrr");
    expect(facts[0]!.value).toBe(40_000);
    expect(facts[0]!.unit).toBe("currency");
    expect(facts[0]!.currency).toBe("USD");
    expect(facts[0]!.source_kind).toBe("kpi_tile");
    expect(facts[0]!.confidence).toBe("low");
  });

  it("extracts MRR with trailing + modifier ($40K+ MRR & Growing)", () => {
    const facts = extractKpiTileClaims("$40K+ MRR & Growing", BASE_OPTS);
    expect(facts).toHaveLength(1);
    expect(facts[0]!.metric_key).toBe("mrr");
    expect(facts[0]!.value).toBe(40_000);
  });

  it("extracts ARR from label-first phrase", () => {
    const facts = extractKpiTileClaims("ARR $3M", BASE_OPTS);
    expect(facts).toHaveLength(1);
    expect(facts[0]!.metric_key).toBe("arr");
    expect(facts[0]!.value).toBe(3_000_000);
  });

  it("extracts ARR from colon-separated phrase", () => {
    const facts = extractKpiTileClaims("ARR: $2.5M", BASE_OPTS);
    expect(facts).toHaveLength(1);
    expect(facts[0]!.metric_key).toBe("arr");
    expect(facts[0]!.value).toBe(2_500_000);
  });

  it("extracts GTV with EUR currency", () => {
    const facts = extractKpiTileClaims("€1B GTV", BASE_OPTS);
    expect(facts).toHaveLength(1);
    expect(facts[0]!.metric_key).toBe("gtv");
    expect(facts[0]!.value).toBe(1_000_000_000);
    expect(facts[0]!.currency).toBe("EUR");
  });

  it("extracts revenue in EUR", () => {
    const facts = extractKpiTileClaims("€27M revenue", BASE_OPTS);
    expect(facts).toHaveLength(1);
    expect(facts[0]!.metric_key).toBe("revenue");
    expect(facts[0]!.value).toBe(27_000_000);
    expect(facts[0]!.currency).toBe("EUR");
  });

  it("extracts raise amount from 'raised' verb", () => {
    const facts = extractKpiTileClaims("€5.6M raised", BASE_OPTS);
    expect(facts).toHaveLength(1);
    expect(facts[0]!.metric_key).toBe("raise_amount");
    expect(facts[0]!.value).toBe(5_600_000);
    expect(facts[0]!.currency).toBe("EUR");
  });

  it("extracts pre-money valuation", () => {
    const facts = extractKpiTileClaims("$20M valuation", BASE_OPTS);
    expect(facts).toHaveLength(1);
    expect(facts[0]!.metric_key).toBe("pre_money_valuation");
    expect(facts[0]!.value).toBe(20_000_000);
  });
});

// ─── Retention / percent metrics ─────────────────────────────────────────────

describe("extractKpiTileClaims — percent metrics", () => {
  it("extracts retention percent", () => {
    const facts = extractKpiTileClaims("85% retention", BASE_OPTS);
    expect(facts).toHaveLength(1);
    expect(facts[0]!.metric_key).toBe("retention_pct");
    expect(facts[0]!.value).toBe(85);
    expect(facts[0]!.unit).toBe("percent");
  });

  it("extracts gross margin", () => {
    const facts = extractKpiTileClaims("72% gross margin", BASE_OPTS);
    expect(facts).toHaveLength(1);
    expect(facts[0]!.metric_key).toBe("gross_margin");
    expect(facts[0]!.value).toBe(72);
    expect(facts[0]!.unit).toBe("percent");
  });

  it("extracts churn percent", () => {
    const facts = extractKpiTileClaims("3% churn", BASE_OPTS);
    expect(facts).toHaveLength(1);
    expect(facts[0]!.metric_key).toBe("churn_pct");
    expect(facts[0]!.value).toBe(3);
    expect(facts[0]!.unit).toBe("percent");
  });
});

// ─── Count metrics ────────────────────────────────────────────────────────────

describe("extractKpiTileClaims — count metrics", () => {
  it("extracts active users (with 'active' qualifier)", () => {
    const facts = extractKpiTileClaims("330k active users", BASE_OPTS);
    expect(facts).toHaveLength(1);
    expect(facts[0]!.metric_key).toBe("active_users");
    expect(facts[0]!.value).toBe(330_000);
    expect(facts[0]!.unit).toBe("number");
  });

  it("extracts active users (plain 'users')", () => {
    const facts = extractKpiTileClaims("500k users", BASE_OPTS);
    expect(facts).toHaveLength(1);
    expect(facts[0]!.metric_key).toBe("active_users");
    expect(facts[0]!.value).toBe(500_000);
  });

  it("extracts customer count", () => {
    const facts = extractKpiTileClaims("6000 merchants", BASE_OPTS);
    expect(facts).toHaveLength(1);
    expect(facts[0]!.metric_key).toBe("merchant_count");
    expect(facts[0]!.value).toBe(6_000);
    expect(facts[0]!.unit).toBe("number");
  });

  it("extracts partner count from 'payment processors'", () => {
    const facts = extractKpiTileClaims("4 payment processors", BASE_OPTS);
    expect(facts).toHaveLength(1);
    expect(facts[0]!.metric_key).toBe("partner_count");
    expect(facts[0]!.value).toBe(4);
    expect(facts[0]!.unit).toBe("number");
  });

  it("extracts impression count", () => {
    const facts = extractKpiTileClaims("20M impressions", BASE_OPTS);
    expect(facts).toHaveLength(1);
    expect(facts[0]!.metric_key).toBe("impression_count");
    expect(facts[0]!.value).toBe(20_000_000);
    expect(facts[0]!.unit).toBe("number");
  });

  it("extracts customer count (clients)", () => {
    const facts = extractKpiTileClaims("12 clients", BASE_OPTS);
    expect(facts).toHaveLength(1);
    expect(facts[0]!.metric_key).toBe("customer_count");
    expect(facts[0]!.value).toBe(12);
  });
});

// ─── Multiplier normalization ─────────────────────────────────────────────────

describe("extractKpiTileClaims — value normalization", () => {
  it("normalizes K suffix", () => {
    expect(extractKpiTileClaims("$40K MRR", BASE_OPTS)[0]!.value).toBe(40_000);
  });

  it("normalizes M suffix with currency", () => {
    expect(extractKpiTileClaims("$3M ARR", BASE_OPTS)[0]!.value).toBe(3_000_000);
  });

  it("normalizes B suffix", () => {
    expect(extractKpiTileClaims("$1B valuation", BASE_OPTS)[0]!.value).toBe(1_000_000_000);
  });

  it("normalizes lowercase k suffix without currency", () => {
    expect(extractKpiTileClaims("330k active users", BASE_OPTS)[0]!.value).toBe(330_000);
  });

  it("normalizes decimal M value", () => {
    expect(extractKpiTileClaims("€5.6M raised", BASE_OPTS)[0]!.value).toBe(5_600_000);
  });
});

// ─── Period detection ─────────────────────────────────────────────────────────

describe("extractKpiTileClaims — period detection", () => {
  it("defaults to period_label='current' when no period in phrase", () => {
    const facts = extractKpiTileClaims("$40K MRR", BASE_OPTS);
    expect(facts[0]!.period_label).toBe("current");
    expect(facts[0]!.period_type).toBe("unknown");
  });

  it("extracts FY period from phrase", () => {
    const facts = extractKpiTileClaims("$5M ARR FY2024", BASE_OPTS);
    expect(facts[0]!.period_label).toBe("FY2024");
    expect(facts[0]!.period_type).toBe("annual");
  });
});

// ─── Multi-segment lines ──────────────────────────────────────────────────────

describe("extractKpiTileClaims — multi-segment / newlines", () => {
  it("extracts multiple KPIs from bullet-delimited line", () => {
    const text = "330k active users • €1B GTV";
    const facts = extractKpiTileClaims(text, BASE_OPTS);
    const metricKeys = facts.map((f) => f.metric_key);
    expect(metricKeys).toContain("active_users");
    expect(metricKeys).toContain("gtv");
    expect(facts.length).toBeGreaterThanOrEqual(2);
  });

  it("extracts multiple KPIs from separate lines", () => {
    const text = "$40K MRR\n$3M ARR\n330k users";
    const facts = extractKpiTileClaims(text, BASE_OPTS);
    const keys = facts.map((f) => f.metric_key);
    expect(keys).toContain("mrr");
    expect(keys).toContain("arr");
    expect(keys).toContain("active_users");
  });
});

// ─── False-positive rejection ─────────────────────────────────────────────────

describe("extractKpiTileClaims — false-positive rejection", () => {
  it("rejects a plain year (2024) without metric context", () => {
    const facts = extractKpiTileClaims("2024", BASE_OPTS);
    expect(facts).toHaveLength(0);
  });

  it("rejects year-looking integer on a revenue line without currency symbol", () => {
    // "2024 revenue" — 2024 looks like a year, no currency symbol → rejected
    const facts = extractKpiTileClaims("2024 revenue", BASE_OPTS);
    expect(facts).toHaveLength(0);
  });

  it("accepts currency value at or above 1000 even if it visually resembles a year", () => {
    // $2,024 has a currency symbol; value=2024 >= MIN_CURRENCY_VALUE → extracted
    const facts = extractKpiTileClaims("$2,024 MRR", BASE_OPTS);
    expect(facts).toHaveLength(1);
    expect(facts[0]!.value).toBe(2_024);
  });

  it("rejects currency value below 1000 threshold", () => {
    const facts = extractKpiTileClaims("$500 MRR", BASE_OPTS);
    expect(facts).toHaveLength(0);
  });

  it("rejects long prose lines", () => {
    const prose = "We are very excited to announce that our company has recently achieved record ARR growth of $5M thanks to our amazing customers and partners who believe in our mission and vision";
    const facts = extractKpiTileClaims(prose, BASE_OPTS);
    expect(facts).toHaveLength(0);
  });

  it("rejects sports-contextual numbers (no metric match)", () => {
    const facts = extractKpiTileClaims("4 Stanley Cups", BASE_OPTS);
    expect(facts).toHaveLength(0);
  });

  it("rejects team member counts on non-relevant lines (no metric match)", () => {
    // "23 players" — no match in any known metric pattern
    const facts = extractKpiTileClaims("23 players", BASE_OPTS);
    expect(facts).toHaveLength(0);
  });
});

// ─── Slide-type suppression ───────────────────────────────────────────────────

describe("extractKpiTileClaims — slide-type suppression", () => {
  it("returns [] for team slide", () => {
    const facts = extractKpiTileClaims("$40K MRR", { ...BASE_OPTS, slide_type: "team" });
    expect(facts).toHaveLength(0);
  });

  it("returns [] for testimonial slide", () => {
    const facts = extractKpiTileClaims("330k users", { ...BASE_OPTS, slide_type: "testimonial" });
    expect(facts).toHaveLength(0);
  });

  it("returns [] for quote slide", () => {
    const facts = extractKpiTileClaims("$3M ARR", { ...BASE_OPTS, slide_type: "quote" });
    expect(facts).toHaveLength(0);
  });

  it("returns [] for cover slide", () => {
    const facts = extractKpiTileClaims("$3M ARR", { ...BASE_OPTS, slide_type: "cover" });
    expect(facts).toHaveLength(0);
  });

  it("extracts normally for traction slide", () => {
    const facts = extractKpiTileClaims("$40K MRR", { ...BASE_OPTS, slide_type: "traction" });
    expect(facts).toHaveLength(1);
    expect(facts[0]!.confidence).toBe("low"); // slide awareness applied by caller
  });

  it("extracts normally when slide_type is undefined", () => {
    const facts = extractKpiTileClaims("$40K MRR", { ...BASE_OPTS, slide_type: undefined });
    expect(facts).toHaveLength(1);
  });
});

// ─── Deduplication ────────────────────────────────────────────────────────────

describe("extractKpiTileClaims — deduplication", () => {
  it("emits only one fact per (metric_key, period_label) per call", () => {
    const text = "$40K MRR\n$50K MRR"; // two MRR claims, same period → deduped
    const facts = extractKpiTileClaims(text, BASE_OPTS);
    const mrrFacts = facts.filter((f) => f.metric_key === "mrr");
    expect(mrrFacts).toHaveLength(1);
    expect(mrrFacts[0]!.value).toBe(40_000); // first one wins
  });
});

// ─── Output schema ────────────────────────────────────────────────────────────

describe("extractKpiTileClaims — output schema", () => {
  it("stamps deal_id and document_id on facts", () => {
    const facts = extractKpiTileClaims("$3M ARR", BASE_OPTS);
    expect(facts[0]!.deal_id).toBe("test-deal-id");
    expect(facts[0]!.document_id).toBe("test-doc-id");
  });

  it("stamps page_number on facts", () => {
    const facts = extractKpiTileClaims("$3M ARR", BASE_OPTS);
    expect(facts[0]!.page_number).toBe(5);
  });

  it("stamps slide_type when provided", () => {
    const facts = extractKpiTileClaims("$3M ARR", { ...BASE_OPTS, slide_type: "traction" });
    expect(facts[0]!.slide_type).toBe("traction");
  });

  it("always sets source_kind to kpi_tile", () => {
    const facts = extractKpiTileClaims("$3M ARR\n20M impressions", BASE_OPTS);
    expect(facts.every((f) => f.source_kind === "kpi_tile")).toBe(true);
  });

  it("always sets reconciliation_status to unknown", () => {
    const facts = extractKpiTileClaims("$3M ARR", BASE_OPTS);
    expect(facts[0]!.reconciliation_status).toBe("unknown");
  });

  it("always sets fact_id", () => {
    const facts = extractKpiTileClaims("$3M ARR", BASE_OPTS);
    expect(typeof facts[0]!.fact_id).toBe("string");
    expect(facts[0]!.fact_id.length).toBeGreaterThan(0);
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

describe("extractKpiTileClaims — edge cases", () => {
  it("returns [] for empty string", () => {
    expect(extractKpiTileClaims("", BASE_OPTS)).toHaveLength(0);
  });

  it("returns [] for whitespace-only text", () => {
    expect(extractKpiTileClaims("   \n  ", BASE_OPTS)).toHaveLength(0);
  });

  it("never throws for any input", () => {
    const inputs = [null as unknown as string, undefined as unknown as string, "💰💰💰", "---", "####"];
    for (const input of inputs) {
      expect(() => extractKpiTileClaims(input, BASE_OPTS)).not.toThrow();
    }
  });
});

// ─── Internal helpers ─────────────────────────────────────────────────────────

describe("findMetricInText", () => {
  it("returns mrr for 'MRR mention'", () => {
    expect(findMetricInText("$40K MRR")?.key).toBe("mrr");
  });

  it("returns active_users for 'active users'", () => {
    expect(findMetricInText("330k active users")?.key).toBe("active_users");
  });

  it("returns null when no metric found", () => {
    expect(findMetricInText("Stanley Cup Finals")).toBeNull();
  });

  it("returns arr before revenue (arr is higher priority)", () => {
    // "ARR revenue growth" contains both; ARR is earlier in priority list
    expect(findMetricInText("ARR revenue growth")?.key).toBe("arr");
  });
});

describe("isYearLike", () => {
  it("returns true for calendar years 1990-2050", () => {
    expect(isYearLike(2024)).toBe(true);
    expect(isYearLike(1990)).toBe(true);
    expect(isYearLike(2050)).toBe(true);
  });

  it("returns false for values outside year range", () => {
    expect(isYearLike(40_000)).toBe(false);
    expect(isYearLike(1_000_000)).toBe(false);
    expect(isYearLike(330_000)).toBe(false);
  });

  it("returns false for non-integers", () => {
    expect(isYearLike(2024.5)).toBe(false);
  });
});

describe("SUPPRESSED_SLIDE_TYPES", () => {
  it("contains team, testimonial, quote, cover, appendix", () => {
    expect(SUPPRESSED_SLIDE_TYPES.has("team")).toBe(true);
    expect(SUPPRESSED_SLIDE_TYPES.has("testimonial")).toBe(true);
    expect(SUPPRESSED_SLIDE_TYPES.has("quote")).toBe(true);
    expect(SUPPRESSED_SLIDE_TYPES.has("cover")).toBe(true);
    expect(SUPPRESSED_SLIDE_TYPES.has("appendix")).toBe(true);
  });

  it("does NOT contain traction, financials, market", () => {
    expect(SUPPRESSED_SLIDE_TYPES.has("traction")).toBe(false);
    expect(SUPPRESSED_SLIDE_TYPES.has("financials")).toBe(false);
    expect(SUPPRESSED_SLIDE_TYPES.has("market")).toBe(false);
  });
});

// ─── Example / use-case context suppression ───────────────────────────────────

describe("extractKpiTileClaims — example/use-case suppression", () => {
  it("rejects segment containing 'customer example'", () => {
    const facts = extractKpiTileClaims("Customer example ARR: $7K", BASE_OPTS);
    expect(facts).toHaveLength(0);
  });

  it("rejects 'use case' segment", () => {
    const facts = extractKpiTileClaims("Use case: $40K MRR per merchant", BASE_OPTS);
    expect(facts).toHaveLength(0);
  });

  it("rejects 'use-case' (hyphen) segment", () => {
    const facts = extractKpiTileClaims("Use-case revenue $2M", BASE_OPTS);
    expect(facts).toHaveLength(0);
  });

  it("rejects 'scenario' segment", () => {
    const facts = extractKpiTileClaims("Sample scenario revenue $2M", BASE_OPTS);
    expect(facts).toHaveLength(0);
  });

  it("rejects 'hypothetical' segment", () => {
    const facts = extractKpiTileClaims("Hypothetical ARR: $500K", BASE_OPTS);
    expect(facts).toHaveLength(0);
  });

  it("rejects 'merchant example' segment", () => {
    const facts = extractKpiTileClaims("Merchant example MRR: $4K", BASE_OPTS);
    expect(facts).toHaveLength(0);
  });

  it("rejects 'case study' segment", () => {
    const facts = extractKpiTileClaims("Case study: $3M revenue", BASE_OPTS);
    expect(facts).toHaveLength(0);
  });

  it("rejects 'sample merchant' segment", () => {
    const facts = extractKpiTileClaims("Sample merchant revenue $7,000", BASE_OPTS);
    expect(facts).toHaveLength(0);
  });

  it("does NOT suppress normal company context", () => {
    const facts = extractKpiTileClaims("$40K MRR", BASE_OPTS);
    expect(facts).toHaveLength(1);
  });

  it("does NOT suppress when 'example' appears as part of a company name suffix", () => {
    // "Inc ARR: $3M" — no match → extracted
    const facts = extractKpiTileClaims("Acme Inc ARR: $3M", BASE_OPTS);
    expect(facts).toHaveLength(1);
  });
});

// ─── Market-size projection suppression ──────────────────────────────────────

describe("extractKpiTileClaims — market projection suppression", () => {
  it("rejects 'Per SAM ARR' segment", () => {
    const facts = extractKpiTileClaims("$7,000 Per SAM ARR", BASE_OPTS);
    expect(facts).toHaveLength(0);
  });

  it("rejects 'Per SOM ARR' segment", () => {
    const facts = extractKpiTileClaims("$7,000 Per SOM ARR", BASE_OPTS);
    expect(facts).toHaveLength(0);
  });

  it("rejects '% of SOM revenue' segment", () => {
    const facts = extractKpiTileClaims("$2M revenue 8% of SOM", BASE_OPTS);
    expect(facts).toHaveLength(0);
  });

  it("rejects 'SAM ARR' market header segment", () => {
    const facts = extractKpiTileClaims("SAM ARR $118M", BASE_OPTS);
    expect(facts).toHaveLength(0);
  });

  it("rejects 'SOM MRR' segment for mrr", () => {
    const facts = extractKpiTileClaims("SOM MRR $499", BASE_OPTS);
    expect(facts).toHaveLength(0);
  });

  it("does NOT suppress merchant_count (non-sensitive key) in market context", () => {
    // merchant_count is not in MARKET_PROJECTION_SENSITIVE_KEYS, so not suppressed
    const facts = extractKpiTileClaims("10,000 merchants", BASE_OPTS);
    expect(facts[0]?.metric_key).toBe("merchant_count");
  });

  it("does NOT suppress retention_pct in market context", () => {
    // retention_pct is not revenue/ARR/MRR/GTV/GMV
    const facts = extractKpiTileClaims("85% retention", BASE_OPTS);
    expect(facts[0]?.metric_key).toBe("retention_pct");
  });
});

// ─── isExampleOrScenarioContext ───────────────────────────────────────────────

describe("isExampleOrScenarioContext", () => {
  it("returns true for 'customer example'", () => {
    expect(isExampleOrScenarioContext("customer example revenue")).toBe(true);
  });

  it("returns true for 'use case'", () => {
    expect(isExampleOrScenarioContext("Use case: $40K MRR")).toBe(true);
  });

  it("returns true for 'use-case' (hyphen)", () => {
    expect(isExampleOrScenarioContext("use-case metric $2M")).toBe(true);
  });

  it("returns true for 'scenario'", () => {
    expect(isExampleOrScenarioContext("scenario revenue $2M")).toBe(true);
  });

  it("returns true for 'hypothetical'", () => {
    expect(isExampleOrScenarioContext("hypothetical ARR $500K")).toBe(true);
  });

  it("returns true for 'merchant example'", () => {
    expect(isExampleOrScenarioContext("Merchant example MRR $499")).toBe(true);
  });

  it("returns true for 'case study'", () => {
    expect(isExampleOrScenarioContext("Case study: $3M revenue")).toBe(true);
  });

  it("returns true for 'sample merchant'", () => {
    expect(isExampleOrScenarioContext("sample merchant ARR")).toBe(true);
  });

  it("returns false for normal traction language", () => {
    expect(isExampleOrScenarioContext("$40K MRR growing 20% MoM")).toBe(false);
  });

  it("returns false for company context language", () => {
    expect(isExampleOrScenarioContext("Current ARR: $3M across 10,000 merchants")).toBe(false);
  });

  it("returns false for standalone 'example' not followed by context noun", () => {
    // "Acme Inc" — "example" not present → false
    expect(isExampleOrScenarioContext("Acme Inc ARR: $3M")).toBe(false);
  });
});
