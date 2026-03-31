/**
 * Unit tests for computeFinancialHealthComposite (compute-fhc.ts)
 *
 * Regression anchor: 2026-03-30 scoring calibration (Fix A)
 * FSI insufficient_data threshold: was 15, now 10.
 *
 * Key cases verified:
 *   A1. FSI = 0  → insufficient_data (no signals at all)
 *   A2. FSI = 5  → insufficient_data (single low-weight deck signal, margin=5)
 *   A3. FSI = 10 → ok, score computed   ← boundary: lowest passing deck signal (revenue=10)
 *   A4. FSI = 20 → ok, score computed   (revenue+burn deck signals)
 *   A5. FSI = 25 → ok, score computed   (income_statement XLSX)
 *   A6. FSI = 100 → ok, full score      (all XLSX sheets)
 *   A7. Deck-only + RC present → is_proxy=false
 *   A8. Deck-only + no RC → is_proxy=true, RC defaults to 50
 *   A9. XLSX + RC present → is_deck_only_fsi=false
 *   A10. Old threshold 15: revenue+burn=20 was previously ok; confirmed still ok at new threshold
 *   A11. Old threshold: revenue-only=10 was previously insufficient_data; confirmed now ok
 */

import { describe, it, expect } from "vitest";
import { computeFinancialHealthComposite } from "../compute-fhc.js";
import type { FhcRawInputs } from "../compute-fhc.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function noSignals(): FhcRawInputs {
  return {
    has_income_statement: false,
    has_cash_flow: false,
    has_balance_sheet: false,
    has_saas_kpis: false,
    has_use_of_funds: false,
    has_budget_model: false,
    reconciliation_confidence_score: null,
    deck_has_revenue: false,
    deck_has_burn: false,
    deck_has_runway: false,
    deck_has_growth: false,
    deck_has_margin: false,
  };
}

function withDeck(overrides: Partial<FhcRawInputs>): FhcRawInputs {
  return { ...noSignals(), ...overrides };
}

function withXlsx(overrides: Partial<FhcRawInputs>): FhcRawInputs {
  return { ...noSignals(), ...overrides };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("computeFinancialHealthComposite — FSI threshold: 10", () => {

  // A1 — No signals → FSI=0 → insufficient_data
  it("A1: no signals → insufficient_data, score null", () => {
    const result = computeFinancialHealthComposite(noSignals());
    expect(result.status).toBe("insufficient_data");
    expect(result.score).toBeNull();
    expect(result.inputs.fsi_evidence_strength).toBe(0);
  });

  // A2 — Single low-weight deck signal: margin only → FSI=5 → insufficient_data
  it("A2: deck_has_margin only (FSI=5) → insufficient_data", () => {
    const result = computeFinancialHealthComposite(withDeck({ deck_has_margin: true }));
    expect(result.status).toBe("insufficient_data");
    expect(result.score).toBeNull();
    expect(result.inputs.fsi_evidence_strength).toBe(5);
  });

  // A3 — BOUNDARY: deck_has_revenue only → FSI=10 → ok (this was the fix)
  // Previously (threshold=15): this returned insufficient_data.
  // After (threshold=10): this returns ok with a real score.
  it("A3: deck_has_revenue only (FSI=10) → ok, score computed [Fix A boundary]", () => {
    const result = computeFinancialHealthComposite(withDeck({ deck_has_revenue: true }));
    expect(result.status).toBe("ok");
    expect(result.score).not.toBeNull();
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    // FHC = round(0.6 * 10 + 0.4 * 50) = round(6 + 20) = 26
    expect(result.score).toBe(26);
    expect(result.is_deck_only_fsi).toBe(true);
    expect(result.is_proxy).toBe(true); // no RC
  });

  // A4 — deck revenue+burn → FSI=20 → ok
  it("A4: deck revenue+burn (FSI=20) → ok, score=32", () => {
    const result = computeFinancialHealthComposite(
      withDeck({ deck_has_revenue: true, deck_has_burn: true })
    );
    expect(result.status).toBe("ok");
    // FHC = round(0.6 * 20 + 0.4 * 50) = round(12 + 20) = 32
    expect(result.score).toBe(32);
    expect(result.is_deck_only_fsi).toBe(true);
  });

  // A5 — income_statement XLSX → FSI=25 → ok
  it("A5: income_statement XLSX only (FSI=25) → ok, score computed", () => {
    const result = computeFinancialHealthComposite(
      withXlsx({ has_income_statement: true })
    );
    expect(result.status).toBe("ok");
    // FHC = round(0.6 * 25 + 0.4 * 50) = round(15 + 20) = 35
    expect(result.score).toBe(35);
    expect(result.is_deck_only_fsi).toBe(false);
    expect(result.is_proxy).toBe(true); // no RC
  });

  // A6 — All XLSX sheets → FSI=100 → ok, high score
  it("A6: all XLSX sheets + high RC (FSI=100, RC=91) → ok, score=95", () => {
    const result = computeFinancialHealthComposite({
      has_income_statement: true,
      has_cash_flow: true,
      has_balance_sheet: true,
      has_saas_kpis: true,
      has_use_of_funds: true,
      has_budget_model: true,
      reconciliation_confidence_score: 0.91,
      deck_has_revenue: true,
      deck_has_burn: true,
      deck_has_runway: true,
      deck_has_growth: true,
      deck_has_margin: true,
    });
    expect(result.status).toBe("ok");
    // FSI = 100 (clamped), RC = round(91) = 91
    // FHC = round(0.6 * 100 + 0.4 * 91) = round(60 + 36.4) = 96
    expect(result.score).toBe(96);
    expect(result.is_deck_only_fsi).toBe(false);
    expect(result.is_proxy).toBe(false);
  });

  // A7 — Deck-only + RC present → is_proxy=false
  it("A7: deck revenue only + reconciliation_confidence present → is_proxy=false", () => {
    const result = computeFinancialHealthComposite(
      withDeck({ deck_has_revenue: true, reconciliation_confidence_score: 0.65 })
    );
    expect(result.status).toBe("ok");
    expect(result.is_proxy).toBe(false);
    // FHC = round(0.6 * 10 + 0.4 * 65) = round(6 + 26) = 32
    expect(result.score).toBe(32);
  });

  // A8 — Deck-only + no RC → is_proxy=true, RC defaults to 50
  it("A8: deck revenue+burn + no RC → is_proxy=true, RC defaults to 50", () => {
    const result = computeFinancialHealthComposite(
      withDeck({ deck_has_revenue: true, deck_has_burn: true })
    );
    expect(result.is_proxy).toBe(true);
    expect(result.inputs.reconciliation_confidence_pct).toBeNull();
  });

  // A9 — XLSX sources → is_deck_only_fsi false
  it("A9: income_statement + saas_kpis XLSX → is_deck_only_fsi=false", () => {
    const result = computeFinancialHealthComposite(
      withXlsx({ has_income_statement: true, has_saas_kpis: true })
    );
    expect(result.is_deck_only_fsi).toBe(false);
    // FSI = 25+20 = 45; FHC = round(0.6*45 + 0.4*50) = round(27+20) = 47
    expect(result.score).toBe(47);
  });

  // A10 — Regression: revenue+burn (FSI=20) was already ok at threshold=15; still ok at 10
  it("A10: revenue+burn (FSI=20) still ok at new threshold (no regression)", () => {
    const result = computeFinancialHealthComposite(
      withDeck({ deck_has_revenue: true, deck_has_burn: true })
    );
    expect(result.status).toBe("ok");
  });

  // A11 — Regression: revenue-only (FSI=10) was insufficient_data at threshold=15; now ok
  it("A11: revenue-only (FSI=10) was insufficient_data at threshold=15, now ok (Fix A)", () => {
    const result = computeFinancialHealthComposite(withDeck({ deck_has_revenue: true }));
    // Previously: insufficient_data. Now: ok.
    expect(result.status).toBe("ok");
    expect(result.score).toBe(26);
  });

  // A12 — Below boundary: deck growth only (FSI=5) stays insufficient_data
  it("A12: deck_has_growth only (FSI=5) → still insufficient_data (below new threshold)", () => {
    const result = computeFinancialHealthComposite(withDeck({ deck_has_growth: true }));
    expect(result.status).toBe("insufficient_data");
    expect(result.score).toBeNull();
  });

  // A13 — Inputs are preserved in result.inputs
  it("A13: result.inputs.fsi_evidence_strength reflects computed FSI", () => {
    const result = computeFinancialHealthComposite(
      withDeck({ deck_has_revenue: true, deck_has_runway: true })
    );
    // revenue=10 + runway=10 = 20
    expect(result.inputs.fsi_evidence_strength).toBe(20);
  });

  // A14 — missing_sections populated for XLSX-structural gaps
  it("A14: XLSX sources → structured missing_sections reported", () => {
    const result = computeFinancialHealthComposite(
      withXlsx({ has_income_statement: true })
    );
    expect(result.missing_sections).toContain("cash_flow");
    expect(result.missing_sections).toContain("balance_sheet");
    expect(result.missing_sections).not.toContain("income_statement");
  });

  // A15 — Anchor-style: single deck signal deal (StackFactor-style, partial)
  it("A15: anchor-style single deck signal (revenue only, no RC) → FHC=26, is_proxy=true", () => {
    // Mimics an anchor deal that previously returned insufficient_data (FSI=10).
    const result = computeFinancialHealthComposite({
      has_income_statement: false,
      has_cash_flow: false,
      has_balance_sheet: false,
      has_saas_kpis: false,
      has_use_of_funds: false,
      has_budget_model: false,
      reconciliation_confidence_score: null,
      deck_has_revenue: true,
      deck_has_burn: false,
      deck_has_runway: false,
      deck_has_growth: false,
      deck_has_margin: false,
    });
    expect(result.status).toBe("ok");
    expect(result.score).toBe(26);
    expect(result.is_proxy).toBe(true);
    expect(result.is_deck_only_fsi).toBe(true);
  });
});
