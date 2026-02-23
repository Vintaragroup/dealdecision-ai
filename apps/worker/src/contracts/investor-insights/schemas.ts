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
});

export const GateStateSchema = z.object({
  all_passed: z.boolean(),
  results: z.array(GateResultSchema),
});

export type GateState = z.infer<typeof GateStateSchema>;

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

  no_empty_blocks: z.boolean(),
});

export type RenderPackage = z.infer<typeof RenderPackageSchema>;

export const InvestorInsightsJobSchema = z.object({
  deal_id: z.string().uuid(),
  engine_version: z.string().min(1).default("v1"),
  force_recompute: z.boolean().optional(),
  triggered_by: z.string().optional(),
  requested_by_user_id: z.string().optional(),
});

export type InvestorInsightsJob = z.infer<typeof InvestorInsightsJobSchema>;
