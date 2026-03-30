import { z } from "zod";

const evidenceStrength = z.enum(["strong", "moderate", "weak", "none"]);
const questionPriority = z.enum(["p0", "p1", "p2"]);

export const DealDeepDiveV1Schema = z.object({
  schema_version: z.literal("deal_deep_dive_v1"),
  deal_id: z.string().min(1),
  analysis_version: z.number().int().nullable(),
  generated_at: z.string().min(1),
  discovery: z.object({
    section: z.literal("discovery"),
    sources: z.object({
      dio_present: z.boolean(),
      report_present: z.boolean(),
      investor_orchestrator_present: z.boolean(),
      financial_breakdown_present: z.boolean(),
      underwriting_readiness_present: z.boolean(),
    }),
    key_facts: z.object({
      raise_present: z.boolean(),
      business_model_present: z.boolean(),
      revenue_present: z.boolean(),
      customers_present: z.boolean(),
      growth_present: z.boolean(),
    }),
    diligence_open_items_count: z.number().int().min(0),
    verification_requests_count: z.number().int().min(0),
  }),
  gap: z.object({
    section: z.literal("gap"),
    missing_critical_facts: z.array(z.string()),
    underwriting_gaps: z.array(z.string()),
    diligence_open_items: z.array(z.string()),
    verification_requests: z.array(z.string()),
  }),
  market: z.object({
    section: z.literal("market"),
    tam_reasoning: z.object({
      status: z.enum(["supported", "partial", "missing"]),
      notes: z.array(z.string()),
      evidence_refs: z.array(z.string()),
      evidence_strength: evidenceStrength,
    }),
    timing_logic: z.object({
      status: z.enum(["supported", "partial", "missing"]),
      notes: z.array(z.string()),
      evidence_refs: z.array(z.string()),
      evidence_strength: evidenceStrength,
    }),
  }),
  product: z.object({
    section: z.literal("product"),
    differentiation_detection: z.object({
      status: z.enum(["clear", "mixed", "unclear"]),
      notes: z.array(z.string()),
      evidence_refs: z.array(z.string()),
      evidence_strength: evidenceStrength,
    }),
    defensibility_logic: z.object({
      status: z.enum(["clear", "partial", "unclear"]),
      notes: z.array(z.string()),
      evidence_refs: z.array(z.string()),
      evidence_strength: evidenceStrength,
    }),
  }),
  business_model: z.object({
    section: z.literal("business_model"),
    revenue_model_inference: z.object({
      inferred_model: z.string().nullable(),
      status: z.enum(["supported", "partial", "missing"]),
      evidence_refs: z.array(z.string()),
      evidence_strength: evidenceStrength,
    }),
    scaling_logic: z.object({
      status: z.enum(["supported", "partial", "missing"]),
      notes: z.array(z.string()),
      evidence_refs: z.array(z.string()),
      evidence_strength: evidenceStrength,
    }),
  }),
  traction: z.object({
    section: z.literal("traction"),
    growth_validation: z.object({
      status: z.enum(["validated", "partial", "unvalidated"]),
      notes: z.array(z.string()),
      evidence_refs: z.array(z.string()),
      evidence_strength: evidenceStrength,
    }),
    proof_vs_promise_detection: z.object({
      status: z.enum(["proof_heavy", "mixed", "promise_heavy"]),
      notes: z.array(z.string()),
      evidence_refs: z.array(z.string()),
      evidence_strength: evidenceStrength,
    }),
  }),
  financials: z.object({
    section: z.literal("financials"),
    interpretation_layer: z.object({
      status: z.enum(["supported", "partial", "missing"]),
      current_state_signals: z.array(z.string()),
      forward_view_signals: z.array(z.string()),
      evidence_refs: z.array(z.string()),
      evidence_strength: evidenceStrength,
    }),
  }),
  team: z.object({
    section: z.literal("team"),
    capability_inference: z.object({
      status: z.enum(["supported", "partial", "missing"]),
      inferred_capabilities: z.array(z.string()),
      evidence_refs: z.array(z.string()),
      evidence_strength: evidenceStrength,
    }),
  }),
  risks: z.object({
    section: z.literal("risks"),
    classification: z.array(z.object({
      category: z.enum(["market", "product", "execution", "financial", "team", "other"]),
      severity: z.enum(["critical", "high", "medium", "low"]),
      risk: z.string(),
      evidence_refs: z.array(z.string()),
    })),
  }),
  red_flags: z.object({
    section: z.literal("red_flags"),
    items: z.array(z.object({
      flag: z.string(),
      contradiction_type: z.enum(["numeric_divergence", "semantic_divergence", "source_divergence", "missing_critical"]),
      evidence_refs: z.array(z.string()),
    })),
  }),
  open_questions: z.object({
    section: z.literal("open_questions"),
    prioritized: z.array(z.object({
      question: z.string(),
      priority: questionPriority,
      reason: z.string(),
      evidence_refs: z.array(z.string()),
    })),
  }),
  implementation: z.object({
    section: z.literal("implementation"),
    actions: z.array(z.object({
      action_id: z.string(),
      priority: z.enum(["high", "medium", "low"]),
      title: z.string(),
      rationale: z.string(),
      source: z.enum(["structured_summary", "underwriting_readiness_v1", "score_explanation", "orchestrator_report_v1"]),
    })),
  }),
});
