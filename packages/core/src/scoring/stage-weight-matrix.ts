export type DimensionKey =
  | "problem_clarity"
  | "solution_product"
  | "market"
  | "business_model"
  | "traction"
  | "financial_profile"
  | "team"
  | "use_of_funds_raise_logic";

export function getStageWeightMatrix(stage: "pre_seed" | "seed" | "series_a" | "growth" | "ipo" | "public_company" | "unknown"): Record<DimensionKey, number> {
  if (stage === "pre_seed") {
    return {
      team: 0.22,
      problem_clarity: 0.18,
      solution_product: 0.16,
      market: 0.14,
      business_model: 0.12,
      traction: 0.10,
      use_of_funds_raise_logic: 0.06,
      financial_profile: 0.02,
    };
  }
  if (stage === "seed") {
    return {
      traction: 0.22,
      business_model: 0.16,
      market: 0.14,
      solution_product: 0.12,
      team: 0.12,
      financial_profile: 0.12,
      use_of_funds_raise_logic: 0.08,
      problem_clarity: 0.04,
    };
  }
  if (stage === "series_a") {
    return {
      traction: 0.18,
      financial_profile: 0.18,
      business_model: 0.14,
      market: 0.12,
      solution_product: 0.10,
      use_of_funds_raise_logic: 0.10,
      team: 0.10,
      problem_clarity: 0.08,
    };
  }
  if (stage === "growth") {
    return {
      financial_profile: 0.22,
      traction: 0.16,
      business_model: 0.14,
      use_of_funds_raise_logic: 0.12,
      market: 0.10,
      team: 0.10,
      solution_product: 0.08,
      problem_clarity: 0.08,
    };
  }

  // RC-004: IPO prep and public company — weight similarly to growth (financial-heavy)
  if (stage === "ipo" || stage === "public_company") {
    return {
      financial_profile: 0.22,
      traction: 0.16,
      business_model: 0.14,
      use_of_funds_raise_logic: 0.12,
      market: 0.10,
      team: 0.10,
      solution_product: 0.08,
      problem_clarity: 0.08,
    };
  }

  // unknown: equal weights
  const w = 1 / 8;
  return {
    problem_clarity: w,
    solution_product: w,
    market: w,
    business_model: w,
    traction: w,
    financial_profile: w,
    team: w,
    use_of_funds_raise_logic: w,
  };
}
