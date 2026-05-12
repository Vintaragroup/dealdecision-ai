/**
 * LLM Financial Verification V1
 *
 * Records the output of the LLM Financial Verifier module: semantic
 * classification of each extracted financial value — entity level, financial
 * type, underwritability, and data-source quality.
 *
 * Phase 1: Types only. No LLM calls are made in Phase 1.
 * Phase 2+: The Financial Verifier job populates this structure.
 *
 * PRIORITY: XLSX > Cap Table > Verified structured extraction > Deck language.
 * The LLM verifier never overwrites XLSX or cap-table sourced values.
 */

export type FinancialEntityLevel =
  | 'parent_company'
  | 'subsidiary'
  | 'spv'
  | 'project'
  | 'fund'
  | 'unknown';

export type FinancialType =
  | 'current_revenue'
  | 'historical_revenue'
  | 'projected_revenue'
  | 'modeled_economics'
  | 'capex'
  | 'opex'
  | 'debt_facility'
  | 'equity_raise'
  | 'safe'
  | 'grant'
  | 'valuation'
  | 'cash_balance'
  | 'burn_rate'
  | 'runway'
  | 'use_of_funds'
  | 'unit_economics'
  | 'customer_metric'
  | 'unknown';

export type FinancialUnderwritable = 'yes' | 'no' | 'partial';

export type FinancialSourceKind =
  | 'audited_financial'
  | 'spreadsheet_model'
  | 'bank_statement'
  | 'signed_contract'
  | 'third_party'
  | 'management_claim'
  | 'projection'
  | 'deck'
  | 'ocr_only'
  | 'inferred'
  | 'unknown';

export type LLMVerifiedFinancialValue = {
  /** Original extraction identifier — matches evidence_id from promoted_facts when available */
  extraction_ref: string | null;
  raw_value: string | null;
  normalized_value: string | null;
  currency: string | null;
  amount: number | null;
  period: string | null;
  entity_level: FinancialEntityLevel;
  financial_type: FinancialType;
  /** 0–1 confidence in this classification */
  confidence: number;
  underwritable: FinancialUnderwritable;
  source_kind: FinancialSourceKind;
  evidence_refs: string[];
  reason: string;
  /** True if this value was marked as a projection or forecast by the LLM */
  flagged_as_projection: boolean;
  /** True if this value is likely a market/TAM figure misclassified as company revenue */
  flagged_as_market_sizing: boolean;
};

export type FinancialGapItem = {
  field: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
};

export type LLMFinancialVerificationV1 = {
  schema_version: 'llm_financial_verification_v1';
  deal_id: string;
  run_id: string | null;
  created_at: string;
  model?: string | null;
  provider?: string | null;
  verified_values: LLMVerifiedFinancialValue[];
  financial_gaps: FinancialGapItem[];
  /** Human-readable summary of the financial verification */
  summary: string | null;
  /** True if XLSX data was present and used as the primary source of truth */
  xlsx_data_present: boolean;
  /** True if cap table was present */
  cap_table_present: boolean;
};
