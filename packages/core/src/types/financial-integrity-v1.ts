/**
 * Financial Integrity v1 — Shared Type Definitions
 *
 * Additive, backward-compatible types for the Financial Integrity analyzer.
 * Used by:
 *   - FinancialIntegrityAnalyzerV1 (packages/core/src/analyzers/)
 *   - DealIntelligenceObject extension (financial_integrity_v1 field)
 *   - report compiler (compiler-simple.ts → DioReport.financial_integrity)
 *   - frontend selectors (selectAuthoritativeFinancialIntegrityV1)
 *
 * Conventions follow packages/core/src/types/dio.ts:
 *   - Zod schema + z.infer<typeof ...Schema> pairing
 *   - scores 0–100 (nullable)
 *   - confidence 0–1
 *   - enum strings are uppercase ("PASS" | "WARN" | "FAIL")
 *   - optional fields via .optional(), not null defaults
 *   - arrays always present; use .default([])
 */

import { z } from "zod";

// ─── Status and Severity ────────────────────────────────────────────────────

export const IntegrityFlagStatusSchema = z.enum(["PASS", "WARN", "FAIL"]);
export type IntegrityFlagStatus = z.infer<typeof IntegrityFlagStatusSchema>;

export const IntegrityFlagSeveritySchema = z.enum([
  "low",
  "medium",
  "high",
  "critical",
]);
export type IntegrityFlagSeverity = z.infer<typeof IntegrityFlagSeveritySchema>;

// ─── Source Comparison Payload ──────────────────────────────────────────────
// Used by cross-source discrepancy flags to show both values side-by-side.

export const IntegrityFlagSourceRefSchema = z.object({
  source_kind: z.string().min(1), // matches financial_facts_v1.source_kind enum
  value: z.number(),
  period_label: z.string().optional(),
});
export type IntegrityFlagSourceRef = z.infer<typeof IntegrityFlagSourceRefSchema>;

// ─── Individual Integrity Flag ──────────────────────────────────────────────

export const IntegrityFlagSchema = z.object({
  /** Namespaced key identifying the rule, e.g. 'cross_source_discrepancy:revenue' */
  flag_key: z.string().min(1),

  status: IntegrityFlagStatusSchema,
  severity: IntegrityFlagSeveritySchema,

  /** Which financial fact type this flag relates to, if applicable */
  fact_type: z.string().optional(),

  /** Human-readable explanation of the flag outcome */
  note: z.string().min(1),

  /**
   * For cross-source discrepancy flags: the two competing source values.
   * source_a is the higher-priority source (e.g. xlsx_cell).
   * source_b is the lower-priority source (e.g. ocr or llm).
   */
  source_a: IntegrityFlagSourceRefSchema.optional(),
  source_b: IntegrityFlagSourceRefSchema.optional(),
});
export type IntegrityFlag = z.infer<typeof IntegrityFlagSchema>;

// ─── Top-Level Financial Integrity Result ───────────────────────────────────

export const FinancialIntegrityV1Schema = z.object({
  /** ISO 8601 timestamp of when this result was computed */
  computed_at: z.string().min(1),

  /**
   * Financial completeness score, 0–100.
   * Based on presence of critical financial metrics.
   * null when there are insufficient facts to compute.
   */
  completeness_score: z.number().min(0).max(100).nullable(),

  /**
   * Critical fact_types that are absent from financial_facts_v1.
   * Missing critical facts have a high impact on completeness_score.
   * Examples: 'total_revenue', 'burn_rate', 'cash_on_hand'
   */
  missing_critical: z.array(z.string()).default([]),

  /**
   * Supplementary fact_types that are absent but not blocking.
   * Examples: 'gross_margin', 'customer_count', 'revenue_growth_rate'
   */
  missing_supplementary: z.array(z.string()).default([]),

  /** All integrity flags produced by this analysis run */
  flags: z.array(IntegrityFlagSchema).default([]),

  /**
   * True when the analyzer received at least one valid financial fact.
   * Distinguishes "no facts analyzed (integrity unknown)" from
   * "facts analyzed, no issues found".
   * false when built from buildEmptyFinancialIntegrityV1() or when facts = [].
   */
  has_facts: z.boolean().default(false),
});
export type FinancialIntegrityV1 = z.infer<typeof FinancialIntegrityV1Schema>;
