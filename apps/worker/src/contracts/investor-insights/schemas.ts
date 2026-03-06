import { z } from "zod";

/**
 * Investor Insights – Worker Contracts (Zod)
 * Binding docs live under:
 * docs/Active/Authoritative/investor-analysis-engine/
 */

export const GateResultSchema = z.object({
  gate: z.enum(["G0", "G1", "G2", "G3", "G4", "G5"]),
  passed: z.boolean(),
  reason_code: z.string().optional(),
  threshold: z.number().optional(),
  actual: z.number().optional(),
  /** Optional diagnostic map attached by G3 on parse / schema failures.
   *  Includes payload_length, preview (first 200 chars), and schema_version.
   *  Never present on passing gates; stripped from UI output. */
  diag: z.record(z.unknown()).optional(),
});

export const GateStateSchema = z.object({
  all_passed: z.boolean(),
  results: z.array(GateResultSchema),
});

export type GateState = z.infer<typeof GateStateSchema>;

// ─── Evidence Gate v1 schemas ─────────────────────────────────────────────────
// Separate from G-gate schemas; evaluates evidence quality rather than data existence.

export const EvidenceGateResultSchema = z.object({
  gate: z.enum(["E0", "E1", "E2", "E3", "E4"]),
  passed: z.boolean(),
  actual: z.number().nullable(),
  threshold: z.number().nullable(),
  reason_code: z.string().nullable(),
});

export const EvidenceGateStateSchema = z.object({
  passed: z.boolean(),
  blocking_reason: z.string().nullable(),
  results: z.array(EvidenceGateResultSchema),
  metrics: z.object({
    docs_count: z.number(),
    expected_pages_total: z.number(),
    coverage_pct: z.number(),
    evidence_count: z.number(),
    hard_missing_pages_total: z.number().nullable(),
  }),
});

export type EvidenceGateState = z.infer<typeof EvidenceGateStateSchema>;

export const ComplianceEventSchema = z.object({
  code: z.string().min(3),
  severity: z.enum(["info", "warn", "error"]),
  message: z.string().min(1),
  at: z.string().datetime(),
  related_id: z.string().optional(),
});

export const ComplianceStateSchema = z.object({
  status: z.enum(["not_run", "passed", "failed", "quarantined"]),
  events: z.array(ComplianceEventSchema).default([]),
});

export type ComplianceState = z.infer<typeof ComplianceStateSchema>;

export const CoverageMetricsSchema = z.object({
  dpu_coverage_ratio: z.number().min(0).max(1).optional(),
  assumption_density: z.number().min(0).max(1).optional(),
  critical_unverified_claims: z.number().int().min(0).optional(),
});

export const RenderSectionSchema = z.object({
  key: z.string().min(1),
  title: z.string().min(1),
  kind: z.enum([
    "gate_state",
    "message",
    "claims",
    "risks",
    "financials",
    "milestones",
    "questions",
    "contradictions",
    "audit",
  ]),
  items: z.array(z.unknown()).optional(),
  body: z.string().optional(),
  fallback: z.string().optional(),
});

// ─── Governed-skip observability (WS-B PR20) ────────────────────────────────

export const GovernedSkipSchema = z.object({
  stage: z.enum(["governed_summary_v1", "governed_executive_summary_v1", "product_profile_v1", "llm_interpretation_v1"]),
  reason_code: z.string().min(1),
  ts: z.string().datetime(),
});

export type GovernedSkipRecord = z.infer<typeof GovernedSkipSchema>;

export const RenderPackageSchema = z.object({
  render_version: z.literal("ui_contract_v1"),
  ui_contract_version: z.string().min(1),
  engine_version: z.string().min(1),
  schema_version: z.string().min(1),
  governance_version: z.string().min(1),
  constitution_version: z.string().min(1),

  deal_id: z.string().uuid(),
  upstream_fingerprint: z.string().min(8),
  status: z.enum(["not_started", "queued", "running", "deterministic_only", "complete", "failed", "quarantined"]),

  gate_state: GateStateSchema,
  compliance_state: ComplianceStateSchema,
  coverage_metrics: CoverageMetricsSchema.optional(),

  sections: z.array(RenderSectionSchema),
  audit_footer: z.record(z.unknown()).optional(),

  // Evidence gate v1: populated when the processor reaches the quality check
  // (i.e. G0–G5 all passed). Optional so old render packages remain valid.
  evidence_gate: EvidenceGateStateSchema.optional(),

  no_empty_blocks: z.boolean(),

  // WS-B PR20: governed-skip observability — populated when any LLM stage was skipped.
  // Optional so pre-existing render packages without this field remain valid.
  governed_skips: z.array(GovernedSkipSchema).optional(),

  // WS-A PR20: recovery metadata — populated when mode="recover_structured_json".
  recovery_metadata: z
    .object({
      attempted: z.boolean(),
      attempt_count: z.number().int().min(1),
      last_attempt_at: z.string().datetime(),
      last_result: z.enum(["pending", "succeeded", "failed"]),
      reason_code: z.string().nullable(),
    })
    .optional(),

  // PR22: deterministic Overview-tab slot fallbacks.
  // Populated when DETERMINISTIC_SLOT_FALLBACK_V1=true and at least one
  // slot was extractable from DPU pages.  Optional so pre-existing render
  // packages without this field remain valid.
  deterministic_overview_slots: z
    .object({
      product: z
        .object({
          value: z.string().min(1),
          confidence: z.number().min(0).max(1),
          provenance: z.literal("deterministic_fallback_v1"),
        })
        .optional(),
      market: z
        .object({
          value: z.string().min(1),
          confidence: z.number().min(0).max(1),
          provenance: z.literal("deterministic_fallback_v1"),
        })
        .optional(),
      business_model: z
        .object({
          value: z.string().min(1),
          confidence: z.number().min(0).max(1),
          provenance: z.literal("deterministic_fallback_v1"),
        })
        .optional(),
    })
    .optional(),
});

export type RenderPackage = z.infer<typeof RenderPackageSchema>;

export const InvestorInsightsJobSchema = z.object({
  deal_id: z.string().uuid(),
  engine_version: z.string().min(1).default("v1"),
  force_recompute: z.boolean().optional(),
  triggered_by: z.string().optional(),
  requested_by_user_id: z.string().optional(),
  /**
   * WS-A PR20: Processor execution mode.
   *
   * - "standard"                  Default mode. Full pipeline with dedup check.
   * - "recover_structured_json"   Structured-JSON recovery retry. Skips dedup,
   *                               records recovery_metadata in render_package,
   *                               and emits DETERMINISTIC_ONLY_RECOVERY_* events.
   */
  mode: z.enum(["standard", "recover_structured_json"]).default("standard"),
});

export type InvestorInsightsJob = z.infer<typeof InvestorInsightsJobSchema>;
