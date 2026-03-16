/**
 * evidence-weighting-v1.test.ts
 *
 * Deterministic unit tests for the Evidence Weighting System (fact-confidence-and-source-weighting).
 *
 * Validates:
 *   1. Full-page KPI evidence beats a short incidental mention (richness scoring)
 *   2. Corroborated value (2 docs agree) reaches VERIFIED tier
 *   3. ARR match in competitor context is rejected by fusion context guard
 *   4. MRR match in market-size context is rejected by stage-2 taint guard
 *   5. Revenue match in market context is rejected by stage-2 taint guard
 *   6. Customer count with competitor context is suppressed
 *   7. Conflict resolution prefers richest page over longest string
 *   8. buildConfidenceSignals: corroborationCount=2 → evidence_count=2 → VERIFIED
 *   9. EvidenceSourceStrength: classifySourceStrength returns correct tiers
 *
 * No DB, no LLM, no side effects.
 */

import { describe, it, expect } from "vitest";
import {
  buildConfidenceSignals,
  computeEvidenceConfidence,
  EVIDENCE_CONFIDENCE_LEVEL,
  EvidenceSourceStrength,
  classifySourceStrength,
  isStrongSource,
  isSourceTainted,
} from "@dealdecision/core";
import { fuseDealCanonicalFacts } from "../deal-fusion";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePage(documentId: string, pageIndex: number, text: string) {
  return { document_id: documentId, page_index: pageIndex, text };
}

// ─── 1. Full-page KPI evidence beats short incidental mention ─────────────────

describe("Phase 1 — page richness scoring: best match preferred over first match", () => {
  it("should prefer the KPI summary page match over an incidental earlier mention", () => {
    // Doc A: page 1 has a brief mention, page 8 is a full KPI summary
    const incidentalPage = makePage("doc-a", 1,
      "Our ARR is $500K mentioned in passing here in a very short sentence."
    );
    const kpiPage = makePage("doc-a", 8,
      `Financials Summary\n` +
      `ARR: $2.4M ARR (Q4 2024)\n` +
      `MRR: $200K\n` +
      `Growth: 180% YoY\n` +
      `Customers: 120 enterprise accounts\n` +
      `Gross Margin: 72%\n` +
      `Burn Rate: $150K/month\n` +
      `$2.4M ARR growing 180% year-over-year is our current run rate`
    );

    const result = fuseDealCanonicalFacts(
      [incidentalPage, kpiPage],
      [],
      [],
      "2025-01-01T00:00:00.000Z"
    );

    const arrFact = result.facts.find((f) => f.field === "arr_value");
    expect(arrFact).toBeDefined();
    // The KPI page match is preferred because it has higher richness score
    // (longer text + KPI keywords + more dollar signs)
    expect(arrFact!.evidence_ref).toContain("page:8");
  });
});

// ─── 2. Corroborated value (2 docs agree) reaches VERIFIED ────────────────────

describe("Phase 2 — corroboration: multi-doc agreement enables VERIFIED tier", () => {
  it("buildConfidenceSignals: corroborationCount=2 → evidence_count=2 → VERIFIED", () => {
    const signals = buildConfidenceSignals({
      computability: "Computable",
      evidenceRef: "dpu:doc:abc12345:page:3",
      source: "deck",
      reasonCode: null,
      hasConflict: false,
      corroborationCount: 2,
    });
    expect(signals.evidence_count).toBe(2);
    const result = computeEvidenceConfidence(signals);
    expect(result.level).toBe(EVIDENCE_CONFIDENCE_LEVEL.VERIFIED);
  });

  it("buildConfidenceSignals: corroborationCount=1 → evidence_count=1 → STRONG_EVIDENCE", () => {
    const signals = buildConfidenceSignals({
      computability: "Computable",
      evidenceRef: "dpu:doc:abc12345:page:3",
      source: "deck",
      reasonCode: null,
      hasConflict: false,
      corroborationCount: 1,
    });
    expect(signals.evidence_count).toBe(1);
    const result = computeEvidenceConfidence(signals);
    expect(result.level).toBe(EVIDENCE_CONFIDENCE_LEVEL.STRONG_EVIDENCE);
  });

  it("buildConfidenceSignals: corroborationCount=0, evidenceRef=null → evidence_count=0 → WEAK_EVIDENCE", () => {
    const signals = buildConfidenceSignals({
      computability: "Computable",
      evidenceRef: null,
      source: "deck",
      reasonCode: null,
      hasConflict: false,
      corroborationCount: 0,
    });
    expect(signals.evidence_count).toBe(0);
    const result = computeEvidenceConfidence(signals);
    expect(result.level).toBe(EVIDENCE_CONFIDENCE_LEVEL.WEAK_EVIDENCE);
  });

  it("fuseDealCanonicalFacts: two docs agree on ARR → confidence=1.0 (corroborated)", () => {
    const docAPage = makePage("doc-a", 2, "Our ARR is $1.2M ARR growing fast");
    const docBPage = makePage("doc-b", 1, "ARR: $1.2M (current run rate)");

    const result = fuseDealCanonicalFacts(
      [docAPage, docBPage],
      [],
      [],
      "2025-01-01T00:00:00.000Z"
    );

    const arrFact = result.facts.find((f) => f.field === "arr_value");
    expect(arrFact).toBeDefined();
    expect(arrFact!.confidence).toBe(1.0);
  });
});

// ─── 3. ARR context guard: competitor context → rejected in fusion ─────────────

describe("Phase 3 — context safety: ARR in competitor context suppressed in fusion", () => {
  it("should NOT extract ARR from a competitive landscape slide", () => {
    const competitorSlide = makePage("doc-a", 5,
      "Competitive Landscape\n" +
      "Our main competitor Acme Corp has $5M ARR and 200 enterprise customers.\n" +
      "Industry ARR pool across all vendors exceeds $500M ARR in the segment."
    );

    const result = fuseDealCanonicalFacts(
      [competitorSlide],
      [],
      [],
      "2025-01-01T00:00:00.000Z"
    );

    const arrFact = result.facts.find((f) => f.field === "arr_value");
    // ARR match should be rejected (competitor + industry market context taint)
    expect(arrFact).toBeUndefined();
  });

  it("should KEEP ARR from a traction/company-owned context", () => {
    const tractionPage = makePage("doc-a", 3,
      "Traction\nOur ARR is $2.4M ARR growing 180% year-over-year."
    );

    const result = fuseDealCanonicalFacts(
      [tractionPage],
      [],
      [],
      "2025-01-01T00:00:00.000Z"
    );

    const arrFact = result.facts.find((f) => f.field === "arr_value");
    expect(arrFact).toBeDefined();
  });
});

// ─── 4. MRR context guard: market-size context → rejected in fusion ────────────

describe("Phase 3 — context safety: MRR in market-size context suppressed in fusion", () => {
  it("should NOT extract MRR from a market-sizing slide with industry MRR pool language", () => {
    const marketSlide = makePage("doc-a", 4,
      "Market Opportunity\n" +
      "The total industry MRR market exceeds $200M MRR across all SaaS vendors in this segment."
    );

    const result = fuseDealCanonicalFacts(
      [marketSlide],
      [],
      [],
      "2025-01-01T00:00:00.000Z"
    );

    const mrrFact = result.facts.find((f) => f.field === "mrr_value");
    // MRR should be rejected — "industry MRR market" language in window
    expect(mrrFact).toBeUndefined();
  });

  it("should KEEP MRR from company-owned traction context", () => {
    const tractionPage = makePage("doc-a", 3,
      "Traction Metrics — Q4 2024\nMRR: $250K MRR (up 25% MoM from $200K)"
    );

    const result = fuseDealCanonicalFacts(
      [tractionPage],
      [],
      [],
      "2025-01-01T00:00:00.000Z"
    );

    const mrrFact = result.facts.find((f) => f.field === "mrr_value");
    expect(mrrFact).toBeDefined();
  });
});

// ─── 5. Revenue context guard: market context → rejected in fusion ─────────────

describe("Phase 3 — context safety: revenue in market context suppressed in fusion", () => {
  it("should NOT extract revenue from a TAM/market revenue context", () => {
    const marketSlide = makePage("doc-a", 2,
      "Total Addressable Market\n" +
      "Total market revenues exceed $5B annually across the segment. " +
      "Industry revenue pool: $5B total revenues in the space."
    );

    const result = fuseDealCanonicalFacts(
      [marketSlide],
      [],
      [],
      "2025-01-01T00:00:00.000Z"
    );

    const revFact = result.facts.find((f) => f.field === "revenue_value");
    // Revenue should be rejected — "total market revenues" and "industry revenue pool" in window
    expect(revFact).toBeUndefined();
  });

  it("should KEEP annual revenue from a company financials context", () => {
    const financialsPage = makePage("doc-a", 6,
      "Financial Summary\nAnnual revenues: $800K (FY2024)\nOur revenue grew 120% year-over-year."
    );

    const result = fuseDealCanonicalFacts(
      [financialsPage],
      [],
      [],
      "2025-01-01T00:00:00.000Z"
    );

    const revFact = result.facts.find((f) => f.field === "revenue_value");
    expect(revFact).toBeDefined();
  });
});

// ─── 6. Customer count context guard ─────────────────────────────────────────

describe("Phase 3 — context safety: customer count with competitor context suppressed", () => {
  it("should NOT use customer count from a competitor benchmarking context", () => {
    const competitorBenchSlide = makePage("doc-a", 5,
      "Competitive Analysis\n" +
      "Market leader Salesforce serves 150,000 customers worldwide. " +
      "Comparable companies average 10,000 customers at this stage."
    );

    const result = fuseDealCanonicalFacts(
      [competitorBenchSlide],
      [],
      [],
      "2025-01-01T00:00:00.000Z"
    );

    const customerFact = result.facts.find((f) => f.field === "customer_count");
    // Should be rejected — competitor/market leader/comparable context
    expect(customerFact).toBeUndefined();
  });

  it("should KEEP customer count from a company traction context", () => {
    const tractionPage = makePage("doc-a", 3,
      "Traction\nWe currently serve 120 customers across 8 industries."
    );

    const result = fuseDealCanonicalFacts(
      [tractionPage],
      [],
      [],
      "2025-01-01T00:00:00.000Z"
    );

    const customerFact = result.facts.find((f) => f.field === "customer_count");
    expect(customerFact).toBeDefined();
  });
});

// ─── 7. Conflict resolution: richest page preferred over longest string ────────

describe("Phase 4 — conflict resolution: richest source page preferred", () => {
  it("should prefer the KPI summary page candidate over a vague mention in conflict", () => {
    // Two docs disagree: doc-A has a vague mention, doc-B has a rich KPI page
    const docAVague = makePage("doc-a", 1,
      "We are raising $2M Series Seed"
    );
    const docBRich = makePage("doc-b", 3,
      `Financial Summary — Fundraising\n` +
      `Capital Raise: Raising $3M Seed Round\n` +
      `Pre-money valuation: $8M\n` +
      `Use of funds: product (40%), sales (35%), operations (25%)\n` +
      `Current runway: 18 months\n` +
      `Lead investor: Accel Partners`
    );

    const result = fuseDealCanonicalFacts(
      [docAVague, docBRich],
      [],
      [],
      "2025-01-01T00:00:00.000Z"
    );

    const raiseFact = result.facts.find((f) => f.field === "raise_amount");
    expect(raiseFact).toBeDefined();
    expect(raiseFact!.confidence).toBe(0.5); // conflict detected

    // Winner should come from doc-B (richer page with financial summary heading + more $ signs)
    expect(raiseFact!.source_document_id).toBe("doc-b");
  });
});

// ─── 8. EvidenceSourceStrength model ─────────────────────────────────────────

describe("Phase 1 — EvidenceSourceStrength: classifySourceStrength tiers", () => {
  it("XLSX source → XLSX_STRUCTURED (highest tier)", () => {
    const strength = classifySourceStrength("xlsx", "", 0);
    expect(strength).toBe(EvidenceSourceStrength.XLSX_STRUCTURED);
  });

  it("pdf_table source → XLSX_STRUCTURED", () => {
    const strength = classifySourceStrength("pdf_table", "", 0);
    expect(strength).toBe(EvidenceSourceStrength.XLSX_STRUCTURED);
  });

  it("deck source with KPI heading → DEDICATED_KPI_PAGE", () => {
    const kpiPageText = "KPI Summary\nARR: $2M | MRR: $167K | Customers: 80";
    const strength = classifySourceStrength("deck", kpiPageText, 20);
    expect(strength).toBe(EvidenceSourceStrength.DEDICATED_KPI_PAGE);
  });

  it("deck source with executive summary heading → EXECUTIVE_SUMMARY", () => {
    const execPageText = "Executive Summary\nWe are building the next-generation platform for SMB accounting automation with $2M ARR.";
    const strength = classifySourceStrength("deck", execPageText, 30);
    expect(strength).toBe(EvidenceSourceStrength.EXECUTIVE_SUMMARY);
  });

  it("deck source with long page text → FULL_PAGE_TEXT", () => {
    const longPageText = "a".repeat(400);
    const strength = classifySourceStrength("deck", longPageText, 50);
    expect(strength).toBe(EvidenceSourceStrength.FULL_PAGE_TEXT);
  });

  it("deck source with short snippet → EVIDENCE_SNIPPET", () => {
    const strength = classifySourceStrength("deck", "ARR: $2M", 50);
    expect(strength).toBe(EvidenceSourceStrength.EVIDENCE_SNIPPET);
  });

  it("empty page + short snippet → SINGLE_SHORT_PHRASE", () => {
    const strength = classifySourceStrength("deck", "", 30);
    expect(strength).toBe(EvidenceSourceStrength.SINGLE_SHORT_PHRASE);
  });

  it("isStrongSource: FULL_PAGE_TEXT and above → true", () => {
    expect(isStrongSource(EvidenceSourceStrength.XLSX_STRUCTURED)).toBe(true);
    expect(isStrongSource(EvidenceSourceStrength.DEDICATED_KPI_PAGE)).toBe(true);
    expect(isStrongSource(EvidenceSourceStrength.EXECUTIVE_SUMMARY)).toBe(true);
    expect(isStrongSource(EvidenceSourceStrength.FULL_PAGE_TEXT)).toBe(true);
    expect(isStrongSource(EvidenceSourceStrength.EVIDENCE_SNIPPET)).toBe(false);
    expect(isStrongSource(EvidenceSourceStrength.SINGLE_SHORT_PHRASE)).toBe(false);
  });

  it("isSourceTainted: CONTEXT_TAINTED → true; all others → false", () => {
    expect(isSourceTainted(EvidenceSourceStrength.CONTEXT_TAINTED)).toBe(true);
    expect(isSourceTainted(EvidenceSourceStrength.EVIDENCE_SNIPPET)).toBe(false);
    expect(isSourceTainted(EvidenceSourceStrength.XLSX_STRUCTURED)).toBe(false);
  });
});
