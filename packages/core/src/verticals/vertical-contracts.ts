// packages/core/src/verticals/vertical-contracts.ts

export type VerticalKey =
  | "product"
  | "technology"
  | "services"
  | "real_estate"
  | "healthcare"
  | "other";

export type VerticalContract = {
  vertical: VerticalKey;

  revenue: {
    allowed: boolean;
    allowed_labels: string[];     // OK labels (case-insensitive token match against value_raw and/or label)
    forbidden_labels: string[];   // labels we must not treat as revenue (case-insensitive token match)
    require_selection_reason: boolean;
  };

  performance_metrics: {
    allowed: boolean;
    examples: string[];
  };

  deal_returns: {
    allowed: boolean;
    suppress_as_revenue: boolean; // if true, IRR/Multiple/etc must NEVER be treated as revenue
    examples: string[];
  };

  product_definition: {
    required: boolean;
    forbidden_tokens: string[];   // tokens that indicate press/social proof vs definition
  };

  diligence: {
    min_open_items: number;
    auto_generate_if_missing: boolean;
  };

  evidence_expectations: {
    tables_required: boolean;
    image_only_allowed: boolean;
  };
};

export const VERTICAL_CONTRACTS: Record<VerticalKey, VerticalContract> = {
  product: {
    vertical: "product",
    revenue: {
      allowed: true,
      allowed_labels: ["Revenue", "Annual Revenue", "TTM", "Run-rate", "GMV", "Attributed Revenue", "Marketing-attributed Revenue"],
      forbidden_labels: ["ARR", "MRR", "IRR", "Equity Multiple", "MOIC", "Cap Rate"],
      require_selection_reason: true,
    },
    performance_metrics: {
      allowed: true,
      examples: ["Conversion", "CAC", "ROAS", "Email/SMS performance", "DTC vs Wholesale mix"],
    },
    deal_returns: {
      allowed: false,
      suppress_as_revenue: true,
      examples: [],
    },
    product_definition: {
      required: true,
      forbidden_tokens: ["press", "award", "featured", "collab", "collaboration", "as seen in"],
    },
    diligence: { min_open_items: 3, auto_generate_if_missing: true },
    evidence_expectations: { tables_required: false, image_only_allowed: true },
  },

  technology: {
    vertical: "technology",
    revenue: {
      allowed: true,
      allowed_labels: ["ARR", "MRR", "Revenue", "Run-rate", "Annual Revenue", "Bookings"],
      forbidden_labels: ["IRR", "Equity Multiple", "MOIC", "Cap Rate"],
      require_selection_reason: true,
    },
    performance_metrics: { allowed: false, examples: [] },
    deal_returns: { allowed: false, suppress_as_revenue: true, examples: [] },
    product_definition: {
      required: true,
      forbidden_tokens: ["press", "award", "featured", "collab", "collaboration", "as seen in"],
    },
    diligence: { min_open_items: 3, auto_generate_if_missing: true },
    evidence_expectations: { tables_required: true, image_only_allowed: false },
  },

  services: {
    vertical: "services",
    revenue: {
      allowed: true,
      allowed_labels: ["Revenue", "Annual Revenue", "Contract Value", "Bookings", "Retainer"],
      forbidden_labels: ["ARR", "MRR", "IRR", "Equity Multiple", "MOIC", "Cap Rate"],
      require_selection_reason: true,
    },
    performance_metrics: {
      allowed: true,
      examples: ["Client retention", "Pipeline", "Utilization", "Gross margin", "Case studies ROI"],
    },
    deal_returns: { allowed: false, suppress_as_revenue: true, examples: [] },
    product_definition: {
      required: false,
      forbidden_tokens: ["press", "award", "featured", "collab", "collaboration", "as seen in"],
    },
    diligence: { min_open_items: 3, auto_generate_if_missing: true },
    evidence_expectations: { tables_required: false, image_only_allowed: true },
  },

  real_estate: {
    vertical: "real_estate",
    revenue: {
      allowed: false,
      allowed_labels: [],
      forbidden_labels: ["Revenue", "ARR", "MRR"],
      require_selection_reason: false,
    },
    performance_metrics: { allowed: false, examples: [] },
    deal_returns: {
      allowed: true,
      suppress_as_revenue: true,
      examples: ["IRR", "Equity Multiple", "MOIC", "Cash-on-Cash", "Cap Rate"],
    },
    product_definition: { required: false, forbidden_tokens: [] },
    diligence: { min_open_items: 2, auto_generate_if_missing: true },
    evidence_expectations: { tables_required: true, image_only_allowed: true },
  },

  healthcare: {
    vertical: "healthcare",
    revenue: {
      allowed: true,
      allowed_labels: ["Revenue", "Annual Revenue", "Run-rate"],
      forbidden_labels: ["IRR", "Equity Multiple", "MOIC", "Cap Rate"],
      require_selection_reason: true,
    },
    performance_metrics: {
      allowed: true,
      examples: ["Patient volume", "Reimbursement mix", "Provider utilization"],
    },
    deal_returns: { allowed: false, suppress_as_revenue: true, examples: [] },
    product_definition: {
      required: true,
      forbidden_tokens: ["press", "award", "featured", "collab", "collaboration", "as seen in"],
    },
    diligence: { min_open_items: 3, auto_generate_if_missing: true },
    evidence_expectations: { tables_required: true, image_only_allowed: true },
  },

  other: {
    vertical: "other",
    revenue: {
      allowed: true,
      allowed_labels: ["Revenue", "Annual Revenue"],
      forbidden_labels: ["ARR", "MRR", "IRR", "MOIC", "Cap Rate"],
      require_selection_reason: true,
    },
    performance_metrics: { allowed: true, examples: [] },
    deal_returns: { allowed: false, suppress_as_revenue: true, examples: [] },
    product_definition: { required: false, forbidden_tokens: [] },
    diligence: { min_open_items: 2, auto_generate_if_missing: true },
    evidence_expectations: { tables_required: false, image_only_allowed: true },
  },
};

export function getVerticalContract(vertical: VerticalKey): VerticalContract {
  return VERTICAL_CONTRACTS[vertical] ?? VERTICAL_CONTRACTS.other;
}