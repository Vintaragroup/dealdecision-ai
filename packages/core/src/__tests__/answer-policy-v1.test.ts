/**
 * Answer Policy V1 — Regression Tests
 *
 * Covers:
 *   - classifyQuestionIntent
 *   - buildPromptPolicyBlock
 *   - enforceAnswerSanity
 *
 * No OpenAI calls. All tests are fully deterministic.
 */

import {
  classifyQuestionIntent,
  buildPromptPolicyBlock,
  enforceAnswerSanity,
} from "../chat/answer-policy-v1";
import type { ProductProfileV1 } from "../orchestrator/types";
import type { OrchestratorReportV1 } from "../orchestrator/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeProductProfile(
  overrides: Partial<ProductProfileV1> = {}
): ProductProfileV1 {
  return {
    schema_version: "product_profile_v1",
    company_description: "TestCo is a B2B SaaS platform for compliance teams.",
    problem_statement: "Manual compliance tracking is slow and error-prone.",
    solution_summary: "Automated compliance monitoring with real-time alerts.",
    product_type: "SaaS",
    delivery_model: "B2B SaaS",
    target_customer: "Compliance officers at mid-market banks",
    buyer_persona: "Chief Compliance Officer",
    core_workflow: ["Connect data source", "Define rules", "Get alerts"],
    core_features: ["Rule engine", "Audit trail", "Dashboard", "Integrations"],
    differentiation_claims: ["50% faster audits", "pre-built bank rules"],
    integrations_or_dependencies: ["Salesforce", "Slack"],
    product_maturity: "Live",
    ai_claims_present: false,
    ai_usage_summary: null,
    ai_usage_type: "None",
    ai_defensibility_notes: null,
    ai_evidence_strength: "none",
    evidence: {},
    sources: [],
    ...overrides,
  };
}

function makeOrchReport(
  overrides: Partial<OrchestratorReportV1> = {}
): OrchestratorReportV1 {
  const base = {
    schema_version: "ddai_orchestrator_report_v1",
    generated_at: "2026-01-01T00:00:00Z",
    deal_id: "deal-test",
    generation_ms: 100,
    decision: {
      label: "CONSIDER" as const,
      confidence_band: "Medium" as const,
      rationale_bullets: [],
      caveats: [],
    },
    scores: {
      overall_recommendation_score: 60,
      risk_severity_score: 40,
      market_score: { raw: 65, band: "Strong" as const },
      financial_health_score: { status: "ok" as const, score: 55, band: "Fair" as const },
      data_completeness_index: 70,
    },
    stage_context: {
      stage: "Seed" as const,
      raise_amount: null,
      valuation_pre: null,
      missing_critical_terms: [],
    },
    document_confidence: { score: 72, band: "Adequate" as const },
    deal_terms: {
      canonical_fields_snapshot: [] as any[],
      coverage_grade: "partial" as const,
      conflicts: [],
    },
    segments: {
      executive_summary: { strengths: [], risks: [], narrative: "", sources: [] },
      market: { narrative: "", benchmarks: [], sources: [] },
      financial: {
        reconciliation: { confidence_score: 0, signals: [], sources: [] },
        benchmarks: [],
        sources: [],
      },
      risk_verification: { verification_requests: [], sources: [] },
      product_profile_v1: makeProductProfile(),
      governed_executive_summary_v1: null as any,
    },
    evidence_registry: {
      items: [],
      indexes: { by_segment: { product_profile_v1: [] } },
    },
    warnings: [],
    diagnostics: { inputs_present: {} as any, computation_ms: {} as any },
  } as unknown as OrchestratorReportV1;

  return { ...base, ...overrides };
}

// ─── classifyQuestionIntent ───────────────────────────────────────────────────

describe("classifyQuestionIntent — intent classification", () => {
  test("AI keywords → 'ai' intent", () => {
    expect(classifyQuestionIntent("How does the AI work?")).toBe("ai");
    expect(classifyQuestionIntent("Is this an LLM-based product?")).toBe("ai");
    expect(classifyQuestionIntent("What machine learning model do they use?")).toBe("ai");
    expect(classifyQuestionIntent("Does it use RAG or embeddings?")).toBe("ai");
  });

  test("Product keywords → 'product' intent (when no AI keywords)", () => {
    expect(classifyQuestionIntent("What does the product do?")).toBe("product");
    expect(classifyQuestionIntent("How does it work for my team?")).toBe("product");
    expect(classifyQuestionIntent("What are the key features of the platform?")).toBe("product");
    expect(classifyQuestionIntent("Tell me about the SaaS offering")).toBe("product");
  });

  test("Financial keywords → 'financial' intent", () => {
    expect(classifyQuestionIntent("What is their ARR?")).toBe("financial");
    expect(classifyQuestionIntent("What is the burn rate and runway?")).toBe("financial");
    expect(classifyQuestionIntent("How are the revenue and financials?")).toBe("financial");
  });

  test("Traction keywords → 'traction' intent", () => {
    expect(classifyQuestionIntent("How many customers do they have?")).toBe("traction");
    expect(classifyQuestionIntent("What is the retention rate?")).toBe("traction");
  });

  test("Risk keywords → 'risk' intent", () => {
    expect(classifyQuestionIntent("What are the red flags?")).toBe("risk");
    expect(classifyQuestionIntent("What are the key risks with this deal?")).toBe("risk");
  });

  test("Team keywords → 'team' intent", () => {
    expect(classifyQuestionIntent("Tell me about the founding team")).toBe("team");
    expect(classifyQuestionIntent("Who is the CEO and what's their background?")).toBe("team");
  });

  test("General fallback for unmatched questions", () => {
    expect(classifyQuestionIntent("Hello")).toBe("general");
    expect(classifyQuestionIntent("Give me a summary of this deal")).toBe("general");
  });

  test("AI intent takes priority over product", () => {
    // Message has both 'AI' and 'product' — AI wins
    expect(classifyQuestionIntent("What AI features does the product have?")).toBe("ai");
  });
});

// ─── buildPromptPolicyBlock ───────────────────────────────────────────────────

describe("buildPromptPolicyBlock — prompt policy rules", () => {
  test("always includes universal no-numeric-invention rule", () => {
    const block = buildPromptPolicyBlock("general");
    expect(block).toContain("NEVER assert a number");
    expect(block).toContain("ANSWER POLICY");
  });

  test("always includes Unknown preference rule", () => {
    const block = buildPromptPolicyBlock("general");
    expect(block).toContain('"Unknown" is preferred over');
  });

  test("always includes conversational style rule", () => {
    const block = buildPromptPolicyBlock("general");
    expect(block).toContain("2–6 sentences");
    expect(block).toContain("No bullet lists");
  });

  test("AI intent + marketing_only → forbids speculation about mechanism", () => {
    const pp = makeProductProfile({
      ai_claims_present: true,
      ai_evidence_strength: "marketing_only",
      ai_usage_summary: "We use AI to accelerate compliance.",
    });
    const block = buildPromptPolicyBlock("ai", pp);
    expect(block).toContain("doesn't explain how it's implemented");
    expect(block).toContain("Do NOT speculate");
    expect(block).toContain("OPEN_FULL_REPORT");
  });

  test("AI intent + ai_claims_present=false → blocks AI claims entirely", () => {
    const pp = makeProductProfile({
      ai_claims_present: false,
      ai_evidence_strength: "none",
    });
    const block = buildPromptPolicyBlock("ai", pp);
    expect(block).toContain("NO verified AI claims");
    expect(block).toContain("Do not state or imply the product uses AI");
  });

  test("AI intent + ai_evidence_strength=none (even if claims_present somehow true) → blocks", () => {
    const pp = makeProductProfile({
      ai_claims_present: false,
      ai_evidence_strength: "none",
    });
    const block = buildPromptPolicyBlock("ai", pp);
    expect(block).toContain("NO verified AI claims");
  });

  test("AI intent + strong evidence → use ai_usage_summary, no over-speculation warning", () => {
    const pp = makeProductProfile({
      ai_claims_present: true,
      ai_evidence_strength: "strong",
      ai_usage_summary: "Uses a proprietary scoring model.",
    });
    const block = buildPromptPolicyBlock("ai", pp);
    expect(block).toContain("ai_usage_summary from PRODUCT PROFILE");
    expect(block).not.toContain("doesn't explain how it's implemented");
  });

  test("Product intent + empty profile → suggests RUN_ANALYZE / REGENERATE_INSIGHTS", () => {
    const emptyPp = makeProductProfile({
      company_description: undefined as any,
      solution_summary: undefined as any,
    });
    const block = buildPromptPolicyBlock("product", emptyPp);
    expect(block).toMatch(/RUN_ANALYZE|REGENERATE_INSIGHTS/);
  });

  test("Financial intent + insufficient_data FHC → warns about missing financial data", () => {
    const r = makeOrchReport();
    // Manually set financial health score status to insufficient_data
    (r.scores.financial_health_score as any).status = "insufficient_data";
    const block = buildPromptPolicyBlock("financial", null, r);
    // Block must contain the warning text (case-insensitive match)
    expect(block.toLowerCase()).toContain("insufficient");
  });

  test("Risk intent → instructs to lead with verification requests", () => {
    const block = buildPromptPolicyBlock("risk");
    expect(block).toContain("VERIFICATION REQUESTS");
    expect(block).toContain("P0");
  });

  test("Traction intent → warns to only cite grounded figures", () => {
    const block = buildPromptPolicyBlock("traction");
    expect(block).toContain("ORCHESTRATOR DATA");
  });
});

// ─── enforceAnswerSanity ──────────────────────────────────────────────────────

describe("enforceAnswerSanity — hallucination guard", () => {
  test("speculative 'trained on' with marketing_only AI → downgrades to safe template", () => {
    const result = enforceAnswerSanity({
      intent: "ai",
      productProfile: makeProductProfile({
        ai_claims_present: true,
        ai_evidence_strength: "marketing_only",
      }),
      orchReport: undefined,
      message: "The platform is trained on millions of compliance records to detect patterns.",
      confidence: "high",
    });
    expect(result.downgraded).toBe(true);
    expect(result.confidence).toBe("low");
    expect(result.message).toContain("can't confirm that detail");
    expect(result.reason).toBeDefined();
  });

  test("speculative 'RAG pipeline' with no AI claims → downgrades to safe template", () => {
    const result = enforceAnswerSanity({
      intent: "ai",
      productProfile: makeProductProfile({
        ai_claims_present: false,
        ai_evidence_strength: "none",
      }),
      orchReport: undefined,
      message: "They use a RAG pipeline backed by a vector database to answer compliance queries.",
      confidence: "medium",
    });
    expect(result.downgraded).toBe(true);
    expect(result.confidence).toBe("low");
    expect(result.message).toContain("can't confirm that detail");
  });

  test("speculative 'fine-tuned' with no AI claims → downgrades", () => {
    const result = enforceAnswerSanity({
      intent: "ai",
      productProfile: makeProductProfile({ ai_claims_present: false }),
      orchReport: undefined,
      message: "This is fine-tuned on industry-specific compliance documents.",
      confidence: "high",
    });
    expect(result.downgraded).toBe(true);
  });

  test("speculative AI in product question → same guard applies", () => {
    const result = enforceAnswerSanity({
      intent: "product",
      productProfile: makeProductProfile({ ai_claims_present: false }),
      orchReport: undefined,
      message: "The product uses language models to generate reports automatically.",
      confidence: "medium",
    });
    expect(result.downgraded).toBe(true);
  });

  test("non-speculative AI response with strong evidence → no downgrade", () => {
    const result = enforceAnswerSanity({
      intent: "ai",
      productProfile: makeProductProfile({
        ai_claims_present: true,
        ai_evidence_strength: "strong",
        ai_usage_summary: "Uses a classification model to flag anomalies.",
      }),
      orchReport: undefined,
      message: "According to the materials, they use AI to detect compliance anomalies.",
      confidence: "high",
    });
    expect(result.downgraded).toBe(false);
    expect(result.message).toContain("anomalies");
  });

  test("ungrounded dollar figure → confidence downgraded high→medium", () => {
    const result = enforceAnswerSanity({
      intent: "financial",
      productProfile: null,
      orchReport: makeOrchReport(),
      message: "The company is reporting $45M in ARR with strong growth momentum.",
      confidence: "high",
      evidenceTexts: ["The company has 200 customers.", "Revenue growing 40% YoY."],
    });
    expect(result.downgraded).toBe(true);
    expect(result.confidence).toBe("medium");
    // Message should be unchanged (not rewritten, just confidence dropped)
    expect(result.message).toContain("$45M");
  });

  test("grounded figure in evidence → no downgrade", () => {
    const result = enforceAnswerSanity({
      intent: "financial",
      productProfile: null,
      orchReport: makeOrchReport(),
      message: "ARR is $2M based on audited financials.",
      confidence: "high",
      evidenceTexts: ["ARR of $2M confirmed in audited financials."],
    });
    expect(result.downgraded).toBe(false);
    expect(result.confidence).toBe("high");
  });

  test("grounded percentage in evidence → no downgrade", () => {
    const result = enforceAnswerSanity({
      intent: "traction",
      productProfile: null,
      orchReport: makeOrchReport(),
      message: "Customer retention is 94% per their cohort analysis.",
      confidence: "high",
      evidenceTexts: ["Customer retention rate 94% per cohort analysis."],
    });
    expect(result.downgraded).toBe(false);
  });

  test("non-product question with no issues → passes through unchanged", () => {
    const result = enforceAnswerSanity({
      intent: "risk",
      productProfile: null,
      orchReport: makeOrchReport(),
      message: "The main risks are regulatory pressure and customer concentration.",
      confidence: "medium",
    });
    expect(result.downgraded).toBe(false);
    expect(result.message).toBe("The main risks are regulatory pressure and customer concentration.");
    expect(result.confidence).toBe("medium");
  });

  test("general intent, clean response → no downgrade", () => {
    const result = enforceAnswerSanity({
      intent: "general",
      productProfile: null,
      orchReport: undefined,
      message: "I don't have enough context to answer that. Try running analysis first.",
      confidence: "low",
    });
    expect(result.downgraded).toBe(false);
  });

  test("AI question but strong evidence + no speculative patterns → passes through", () => {
    const result = enforceAnswerSanity({
      intent: "ai",
      productProfile: makeProductProfile({
        ai_claims_present: true,
        ai_evidence_strength: "strong",
      }),
      orchReport: undefined,
      message: "The materials state AI is used for anomaly detection. The deck doesn't provide implementation details beyond this.",
      confidence: "medium",
    });
    expect(result.downgraded).toBe(false);
  });

  test("empty message → passes through without error", () => {
    const result = enforceAnswerSanity({
      intent: "general",
      productProfile: null,
      orchReport: undefined,
      message: "",
      confidence: "low",
    });
    expect(result.downgraded).toBe(false);
    expect(result.message).toBe("");
  });

  test("numeric in orchestrator canonical fields → no downgrade", () => {
    const r = makeOrchReport();
    // Set a canonical field with a value matching the message
    (r.stage_context as any).raise_amount = "$3M";
    const result = enforceAnswerSanity({
      intent: "terms",
      productProfile: null,
      orchReport: r,
      message: "The raise amount is $3M at a pre-money valuation to be determined.",
      confidence: "high",
      evidenceTexts: [],
    });
    expect(result.downgraded).toBe(false);
  });
});
