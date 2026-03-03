/**
 * build-financial-coverage-v1.ts
 *
 * Re-exports from @dealdecision/core — canonical home of this logic.
 * Kept here so existing worker imports continue to resolve.
 *
 * NOTE: The old `inferFinancialCoverageProfileV1()` in
 * models/financial-coverage-profile.ts still exists for DIO-based usage
 * and must NOT be removed.
 */
export type { FinancialCoverageV1 } from "@dealdecision/core";
export {
  INCOME_STATEMENT_METRICS,
  UNIT_ECONOMICS_METRICS,
  CASH_FLOW_METRICS,
  buildFinancialCoverageV1,
} from "@dealdecision/core";
