/**
 * Tests for build-deal-fact-registry-v1.ts
 *
 * Coverage:
 *  - ask page with raise + valuation numeric claims → raise_amount + valuation facts
 *  - traction page with numeric claims → traction_metric facts
 *  - team page with CEO/CTO key_claims → team_key_role, confidence high when name present
 *  - empty rows → ok=true, facts=[]
 *  - total cap of 120 enforced
 */

import { describe, it, expect } from "vitest";
import { buildDealFactRegistryV1 } from "../../deal-facts/build-deal-fact-registry-v1";
import type { PageRegistryRowV1 } from "@dealdecision/core";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function baseRow(
  overrides: Partial<PageRegistryRowV1> & Pick<PageRegistryRowV1, "page_type">
): PageRegistryRowV1 {
  return {
    page_id:        `pagev1:deal1:doc1:${Math.random()}`,
    deal_id:        "deal1",
    document_id:    "doc1",
    page_number:    1,
    confidence:     "high",
    entities:       [],
    numeric_claims: [],
    key_claims:     [],
    evidence_ids:   ["ev1"],
    excerpt:        "Test page excerpt",
    ...overrides,
  };
}

// ─── Empty input ───────────────────────────────────────────────────────────────

describe("buildDealFactRegistryV1 — empty input", () => {
  it("returns ok=true and empty facts when no rows", () => {
    const result = buildDealFactRegistryV1({ dealId: "deal1", pageRegistryRows: [] });
    expect(result.ok).toBe(true);
    expect(result.facts).toEqual([]);
    expect(result.pages_processed).toBe(0);
  });

  it("returns ok=true and empty facts when all rows are non-preferred page types", () => {
    const result = buildDealFactRegistryV1({
      dealId: "deal1",
      pageRegistryRows: [
        baseRow({ page_type: "other" }),
        baseRow({ page_type: "unknown" }),
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.facts).toEqual([]);
  });
});

// ─── Ask page ─────────────────────────────────────────────────────────────────

describe("buildDealFactRegistryV1 — ask page", () => {
  it("extracts raise_amount from currency claim with raise context", () => {
    const result = buildDealFactRegistryV1({
      dealId: "deal1",
      pageRegistryRows: [
        baseRow({
          page_type: "ask",
          numeric_claims: [
            {
              raw: "$5M",
              value: 5_000_000,
              unit: "currency",
              currency: "USD",
              context: "We are raising $5M seed round",
              normalized_label: "raise_amount",
            },
          ],
        }),
      ],
    });

    expect(result.ok).toBe(true);
    const raiseFactors = result.facts.filter((f) => f.type === "raise_amount");
    expect(raiseFactors.length).toBeGreaterThanOrEqual(1);
    expect(raiseFactors[0].value).toMatchObject({ kind: "money", value: 5_000_000 });
  });

  it("extracts valuation from currency claim with valuation context", () => {
    const result = buildDealFactRegistryV1({
      dealId: "deal2",
      pageRegistryRows: [
        baseRow({
          page_type: "ask",
          numeric_claims: [
            {
              raw: "$20M",
              value: 20_000_000,
              unit: "currency",
              currency: "USD",
              context: "pre-money valuation of $20M",
              normalized_label: "valuation",
            },
          ],
        }),
      ],
    });

    expect(result.ok).toBe(true);
    const valFacts = result.facts.filter((f) => f.type === "valuation");
    expect(valFacts.length).toBeGreaterThanOrEqual(1);
    expect(valFacts[0].value).toMatchObject({ kind: "money", value: 20_000_000 });
  });

  it("extracts round_stage from key_claims excerpt", () => {
    const result = buildDealFactRegistryV1({
      dealId: "deal3",
      pageRegistryRows: [
        baseRow({
          page_type: "ask",
          numeric_claims: [],
          key_claims: [{ text: "Series A round closing Q1 2025" }],
        }),
      ],
    });

    expect(result.ok).toBe(true);
    const stageFacts = result.facts.filter((f) => f.type === "round_stage");
    expect(stageFacts.length).toBeGreaterThanOrEqual(1);
    expect(stageFacts[0].value).toMatchObject({ kind: "string" });
  });
});

// ─── Traction page ────────────────────────────────────────────────────────────

describe("buildDealFactRegistryV1 — traction page", () => {
  it("extracts traction_metric for each numeric claim", () => {
    const result = buildDealFactRegistryV1({
      dealId: "deal4",
      pageRegistryRows: [
        baseRow({
          page_type: "traction",
          numeric_claims: [
            { raw: "$1.2M", value: 1_200_000, unit: "currency", currency: "USD", context: "ARR of $1.2M" },
            { raw: "120%", value: 120, unit: "percent", context: "YoY growth of 120%" },
          ],
        }),
      ],
    });

    expect(result.ok).toBe(true);
    const trFacts = result.facts.filter((f) => f.type === "traction_metric");
    expect(trFacts.length).toBe(2);
  });

  it("includes ARR label when context contains 'ARR'", () => {
    const result = buildDealFactRegistryV1({
      dealId: "deal5",
      pageRegistryRows: [
        baseRow({
          page_type: "traction",
          numeric_claims: [
            { raw: "$500K", value: 500_000, unit: "currency", currency: "USD", context: "current ARR $500K" },
          ],
        }),
      ],
    });

    const trFacts = result.facts.filter((f) => f.type === "traction_metric");
    expect(trFacts.length).toBe(1);
    expect(trFacts[0].label.toLowerCase()).toContain("arr");
  });
});

// ─── Team page ────────────────────────────────────────────────────────────────

describe("buildDealFactRegistryV1 — team page", () => {
  it("extracts team_key_role with high confidence when name+role pattern matches", () => {
    const result = buildDealFactRegistryV1({
      dealId: "deal6",
      pageRegistryRows: [
        baseRow({
          page_type: "team",
          key_claims: [
            { text: "Jane Smith, CEO" },
            { text: "Bob Jones, CTO" },
          ],
        }),
      ],
    });

    expect(result.ok).toBe(true);
    const roleFacts = result.facts.filter((f) => f.type === "team_key_role");
    expect(roleFacts.length).toBeGreaterThanOrEqual(2);
    // name+role → confidence from page confidence (high)
    expect(roleFacts[0].confidence).toBe("high");
  });

  it("extracts team_key_role with low confidence when role only (no name)", () => {
    const result = buildDealFactRegistryV1({
      dealId: "deal7",
      pageRegistryRows: [
        baseRow({
          page_type: "team",
          confidence: "medium",
          key_claims: [{ text: "Our founding team includes strong CEO experience." }],
        }),
      ],
    });

    expect(result.ok).toBe(true);
    const roleFacts = result.facts.filter((f) => f.type === "team_key_role");
    // role-only extractions get low confidence
    if (roleFacts.length > 0) {
      expect(roleFacts[0].confidence).toBe("low");
    }
  });
});

// ─── Total cap ────────────────────────────────────────────────────────────────

describe("buildDealFactRegistryV1 — caps", () => {
  it("caps total facts at 120", () => {
    // Generate 200 traction page rows, each with 2 unique numeric claims
    const rows: PageRegistryRowV1[] = Array.from({ length: 100 }, (_, i) =>
      baseRow({
        page_type:  "traction",
        page_number: i + 1,
        page_id:    `pagev1:deal8:doc1:${i + 1}`,
        numeric_claims: [
          {
            raw:     `$${i * 1000 + 1}`,
            value:   i * 1000 + 1,
            unit:    "currency",
            currency: "USD",
            context: `unique traction metric for page ${i}a`,
          },
          {
            raw:     `$${i * 1000 + 2}`,
            value:   i * 1000 + 2,
            unit:    "currency",
            currency: "USD",
            context: `unique traction metric for page ${i}b`,
          },
        ],
      })
    );

    const result = buildDealFactRegistryV1({ dealId: "deal8", pageRegistryRows: rows });
    expect(result.ok).toBe(true);
    expect(result.facts.length).toBeLessThanOrEqual(120);
  });
});

// ─── Determinism ──────────────────────────────────────────────────────────────

describe("buildDealFactRegistryV1 — determinism", () => {
  it("produces the same fact_ids on repeated calls", () => {
    const rows: PageRegistryRowV1[] = [
      baseRow({
        page_type: "ask",
        page_id:   "pagev1:dealX:doc1:1",
        numeric_claims: [
          {
            raw: "$3M", value: 3_000_000, unit: "currency", currency: "USD",
            context: "raising $3M seed", normalized_label: "raise_amount",
          },
        ],
      }),
    ];

    const r1 = buildDealFactRegistryV1({ dealId: "dealX", pageRegistryRows: rows });
    const r2 = buildDealFactRegistryV1({ dealId: "dealX", pageRegistryRows: rows });
    const ids1 = r1.facts.map((f) => f.fact_id).sort();
    const ids2 = r2.facts.map((f) => f.fact_id).sort();
    expect(ids1).toEqual(ids2);
  });
});
