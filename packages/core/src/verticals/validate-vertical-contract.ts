import type { VerticalKey, VerticalContract } from "./vertical-contracts";
import { getVerticalContract } from "./vertical-contracts";

export type ContractViolation = {
  code: string;
  severity: "error" | "warn";
  message: string;
  path?: string;
  evidence?: any;
};

type ValidationArgs = {
  vertical: VerticalKey;
  reportExcerpt: any; // stable excerpt shape from pickStableReportExcerpt
};

type ValidationResult = {
  violations: ContractViolation[];
  summary: { errors: number; warns: number };
};

const normalize = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

const lower = (v: unknown): string => normalize(v).toLowerCase();

const isPresent = (v: unknown): boolean => {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return normalize(v).length > 0;
  return true;
};

const containsAnyToken = (text: string, tokens: string[]): string | null => {
  const t = text.toLowerCase();
  for (const token of tokens) {
    const needle = token.toLowerCase();
    if (!needle) continue;

    // Prefer boundary checks for all-caps-ish metric codes (ARR/MRR/IRR/MOIC).
    if (/^[a-z]{2,6}$/i.test(token) && token.toUpperCase() === token) {
      const re = new RegExp(`\\b${token}\\b`, "i");
      if (re.test(text)) return token;
      continue;
    }

    if (t.includes(needle)) return token;
  }
  return null;
};

const RETURNS_TOKENS = ["IRR", "MOIC", "Equity Multiple", "Cap Rate", "Cash-on-Cash", "Cash on Cash"];
const ARR_MRR_TOKENS = ["ARR", "MRR"];

function getRevenueKpi(reportExcerpt: any): any {
  return reportExcerpt?.structured_summary?.kpis?.revenue ?? reportExcerpt?.structured_summary?.revenue ?? null;
}

function getProductDefinition(reportExcerpt: any): string {
  return normalize(
    reportExcerpt?.product_summary?.product_definition ??
      reportExcerpt?.structured_summary?.product_summary?.product_definition ??
      reportExcerpt?.product_definition
  );
}

function getDiligenceCount(reportExcerpt: any): number {
  const countRaw = reportExcerpt?.score_explanation?.understanding_v1?.diligence_open_items?.count;
  if (Number.isFinite(Number(countRaw))) return Number(countRaw);

  const items = reportExcerpt?.score_explanation?.understanding_v1?.diligence_open_items?.items;
  if (Array.isArray(items)) return items.length;

  return 0;
}

function push(
  violations: ContractViolation[],
  v: ContractViolation
): void {
  violations.push(v);
}

function validateRevenueAllowedFalse(contract: VerticalContract, reportExcerpt: any, violations: ContractViolation[]) {
  const revenue = getRevenueKpi(reportExcerpt);
  if (!revenue) return;

  const valueRaw = normalize(revenue?.value_raw);
  const value = revenue?.value;
  const label = normalize(revenue?.scope_label ?? revenue?.label);
  const hasValueLike = valueRaw.length > 0 || value != null || label.length > 0;

  if (hasValueLike) {
    push(violations, {
      code: "revenue.disallowed.present",
      severity: "error",
      message: `Revenue is not allowed for vertical ${contract.vertical}, but revenue fields are present.`,
      path: "structured_summary.kpis.revenue",
      evidence: {
        value_raw: valueRaw || null,
        scope_label: label || null,
        has_value: value != null,
      },
    });
  }

  const combined = `${label} ${valueRaw}`.trim();
  const returnsToken = containsAnyToken(combined, RETURNS_TOKENS);
  if (returnsToken) {
    push(violations, {
      code: "revenue.disallowed.contains_returns_token",
      severity: "error",
      message: `Revenue must not contain returns token '${returnsToken}' for vertical ${contract.vertical}.`,
      path: "structured_summary.kpis.revenue",
      evidence: { combined },
    });
  }
}

function validateRevenueAllowedTrue(contract: VerticalContract, reportExcerpt: any, violations: ContractViolation[]) {
  const revenue = getRevenueKpi(reportExcerpt);
  if (!revenue) {
    if (contract.revenue.require_selection_reason) {
      push(violations, {
        code: "revenue.selection_reason.missing",
        severity: "warn",
        message: `Revenue selection_reason is missing (required by contract) for vertical ${contract.vertical}.`,
        path: "structured_summary.kpis.revenue.selection_reason",
      });
    }
    return;
  }

  const valueRaw = normalize(revenue?.value_raw);
  const value = revenue?.value;
  const label = normalize(revenue?.scope_label ?? revenue?.label);
  const selectionReason = normalize(revenue?.selection_reason);

  if (contract.revenue.require_selection_reason && selectionReason.length === 0) {
    const hasValue = value != null || valueRaw.length > 0;
    push(violations, {
      code: "revenue.selection_reason.missing",
      severity: hasValue ? "error" : "warn",
      message: hasValue
        ? `Revenue selection_reason is missing even though revenue has a value for vertical ${contract.vertical}.`
        : `Revenue selection_reason is missing (required by contract) for vertical ${contract.vertical}.`,
      path: "structured_summary.kpis.revenue.selection_reason",
      evidence: { value_raw: valueRaw || null, has_value: value != null },
    });
  }

  if (label.length > 0) {
    const forbiddenInLabel = containsAnyToken(label, contract.revenue.forbidden_labels);
    if (forbiddenInLabel) {
      push(violations, {
        code: "revenue.label.forbidden",
        severity: "error",
        message: `Revenue label/scope_label contains forbidden token '${forbiddenInLabel}' for vertical ${contract.vertical}.`,
        path: "structured_summary.kpis.revenue.scope_label",
        evidence: { label },
      });
    }
  }

  // Special rule: ARR/MRR forbidden unless explicitly allowed by this vertical.
  const allowedLabelText = contract.revenue.allowed_labels.map((x) => x.toLowerCase());
  const arrMrrToken = containsAnyToken(valueRaw, ARR_MRR_TOKENS);
  if (arrMrrToken) {
    const allowsToken = allowedLabelText.includes(arrMrrToken.toLowerCase());
    if (!allowsToken) {
      push(violations, {
        code: "revenue.value_raw.forbidden_metric_token",
        severity: "error",
        message: `Revenue value_raw contains '${arrMrrToken}', which is forbidden for vertical ${contract.vertical}.`,
        path: "structured_summary.kpis.revenue.value_raw",
        evidence: { value_raw: valueRaw },
      });
    }
  }

  // If returns are allowed for this vertical, ensure they are not misclassified as revenue.
  if (contract.deal_returns.allowed) {
    const returnsToken = containsAnyToken(valueRaw, RETURNS_TOKENS);
    if (returnsToken) {
      push(violations, {
        code: "deal_returns.misclassified_as_revenue",
        severity: "error",
        message: `Revenue value_raw contains returns token '${returnsToken}' but returns must not be treated as revenue for vertical ${contract.vertical}.`,
        path: "structured_summary.kpis.revenue.value_raw",
        evidence: { value_raw: valueRaw },
      });
    }
  }

  // Evidence expectation: if tables are required and we claim a financial table preference, ensure table-like source fields exist.
  if (contract.evidence_expectations.tables_required) {
    const reasonLower = lower(selectionReason);
    const indicatesTable = reasonLower.includes("financial_table_preferred");
    if (indicatesTable) {
      const source = revenue?.source ?? null;
      const page = source?.page ?? null;
      const slideTitle = source?.slide_title ?? null;
      const ok = page != null && slideTitle != null;
      if (!ok) {
        push(violations, {
          code: "evidence.tables_required.missing_table_source",
          severity: "warn",
          message: `Revenue selection_reason indicates financial table preference, but revenue source is missing page and/or slide_title for vertical ${contract.vertical}.`,
          path: "structured_summary.kpis.revenue.source",
          evidence: { selection_reason: selectionReason || null, source },
        });
      }
    }
  }
}

function validateProductDefinition(contract: VerticalContract, reportExcerpt: any, violations: ContractViolation[]) {
  const pd = getProductDefinition(reportExcerpt);

  if (contract.product_definition.required && pd.length === 0) {
    const citationsTotalSources = Number(reportExcerpt?.citations?.total_sources ?? 0);
    const hero = normalize(reportExcerpt?.deal_summary?.tiers?.hero);
    const isPlaceholderHero = hero.includes("This is a company in");
    const lowSignal = citationsTotalSources === 0 || isPlaceholderHero;

    push(violations, {
      code: "product_definition.missing",
      severity: lowSignal ? "warn" : "error",
      message: lowSignal
        ? `product_definition is required for vertical ${contract.vertical} but is missing (low-signal excerpt).`
        : `product_definition is required for vertical ${contract.vertical} but is missing.`,
      path: "product_summary.product_definition",
      evidence: { citations_total_sources: citationsTotalSources, hero: hero || null },
    });
    return;
  }

  if (pd.length > 0 && contract.product_definition.forbidden_tokens.length > 0) {
    const token = containsAnyToken(pd, contract.product_definition.forbidden_tokens);
    if (token) {
      push(violations, {
        code: "product_definition.forbidden_token",
        severity: "error",
        message: `product_definition contains forbidden token '${token}' for vertical ${contract.vertical}.`,
        path: "product_summary.product_definition",
        evidence: { product_definition: pd },
      });
    }
  }
}

function validateDiligence(contract: VerticalContract, reportExcerpt: any, violations: ContractViolation[]) {
  const count = getDiligenceCount(reportExcerpt);
  const min = contract.diligence.min_open_items;

  if (count < min) {
    push(violations, {
      code: "diligence.min_open_items",
      severity: contract.diligence.auto_generate_if_missing ? "warn" : "error",
      message: `Diligence open items count (${count}) is below contract minimum (${min}) for vertical ${contract.vertical}.`,
      path: "score_explanation.understanding_v1.diligence_open_items.count",
      evidence: {
        count,
        min,
        auto_generate_if_missing: contract.diligence.auto_generate_if_missing,
      },
    });
  }
}

export function validateReportAgainstContract(args: ValidationArgs): ValidationResult {
  const contract = getVerticalContract(args.vertical);
  const reportExcerpt = args.reportExcerpt ?? {};

  const violations: ContractViolation[] = [];

  if (!contract.revenue.allowed) {
    validateRevenueAllowedFalse(contract, reportExcerpt, violations);
  } else {
    validateRevenueAllowedTrue(contract, reportExcerpt, violations);
  }

  validateProductDefinition(contract, reportExcerpt, violations);
  validateDiligence(contract, reportExcerpt, violations);

  const errors = violations.filter((v) => v.severity === "error").length;
  const warns = violations.filter((v) => v.severity === "warn").length;

  return { violations, summary: { errors, warns } };
}
