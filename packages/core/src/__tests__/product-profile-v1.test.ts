/**
 * Product Profile V1 — Unit Tests
 *
 * Covers:
 *   1. parseProductProfileBody — null / valid / wrong schema_version
 *   2. buildOrchestratorReportV1 — product_profile_v1 segment populated
 *   3. buildOrchestratorReportV1 — falls back to EMPTY defaults when section absent
 */

import { parseProductProfileBody } from "../orchestrator/render-package-helpers";
import { buildOrchestratorReportV1 } from "../orchestrator/build-orchestrator-report-v1";
import type { ProductProfileV1 } from "../orchestrator/types";
import type { OrchestratorRenderPackageInput } from "../orchestrator/render-package-input";

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Minimal valid render package that will satisfy parser without crashing */
function makeMinimalRenderPackage(
  extraSections: OrchestratorRenderPackageInput["sections"] = []
): OrchestratorRenderPackageInput {
  return {
    schema_version: "investor_insights_v1",
    upstream_fingerprint: "test-fingerprint",
    gate_state: {
      all_passed: true,
      results: [
        { gate: "G1", passed: true },
        { gate: "G2", passed: true },
        { gate: "G3", passed: true },
      ],
    },
    sections: extraSections,
  };
}

/** Builds a minimal ProductProfileV1 payload string for the body field */
function makeProductProfileBody(overrides: Partial<ProductProfileV1> = {}): string {
  const base: ProductProfileV1 = {
    schema_version: "product_profile_v1",
    company_description: "TestCo builds AI-powered tools for developers.",
    problem_statement: "Developers waste time on boilerplate code.",
    solution_summary: "Automated scaffolding with AI code generation.",
    product_type: "SaaS",
    delivery_model: "B2B SaaS",
    target_customer: "Software engineers at mid-size companies",
    buyer_persona: "VP Engineering",
    core_workflow: ["Connect repo", "Run scaffolding", "Review output"],
    core_features: ["AI code gen", "Templates", "CI integration"],
    differentiation_claims: ["10x faster than manual", "idiomatic output"],
    integrations_or_dependencies: ["GitHub", "VSCode"],
    product_maturity: "Beta",
    ai_claims_present: true,
    ai_usage_summary: "Uses GPT-4 to generate repository scaffolding from specs.",
    ai_usage_type: "Generative",
    ai_defensibility_notes: "Proprietary prompt layer trained on OSS corpus.",
    ai_evidence_strength: "weak",
    evidence: {
      company_description: ["ev-001"],
      solution_summary: ["ev-002"],
    },
    sources: ["ev-001", "ev-002"],
    ...overrides,
  };
  return JSON.stringify(base);
}

// ─── parseProductProfileBody Tests ──────────────────────────────────────────

describe("parseProductProfileBody", () => {
  test("returns null when body is null", () => {
    expect(parseProductProfileBody(null)).toBeNull();
  });

  test("returns null when body is empty string", () => {
    expect(parseProductProfileBody("")).toBeNull();
  });

  test("returns null when JSON is invalid", () => {
    expect(parseProductProfileBody("{not valid json")).toBeNull();
  });

  test("returns null when schema_version is wrong", () => {
    const body = JSON.stringify({ schema_version: "other_version", product_type: "SaaS" });
    expect(parseProductProfileBody(body)).toBeNull();
  });

  test("returns null when schema_version is missing", () => {
    const body = JSON.stringify({ product_type: "SaaS" });
    expect(parseProductProfileBody(body)).toBeNull();
  });

  test("returns typed ProductProfileV1 when body is valid", () => {
    const body = makeProductProfileBody();
    const result = parseProductProfileBody(body);

    expect(result).not.toBeNull();
    expect(result!.schema_version).toBe("product_profile_v1");
    expect(result!.product_type).toBe("SaaS");
    expect(result!.delivery_model).toBe("B2B SaaS");
    expect(result!.ai_claims_present).toBe(true);
    expect(result!.ai_evidence_strength).toBe("weak");
    expect(result!.core_features).toHaveLength(3);
    expect(result!.sources).toContain("ev-001");
  });

  test("returns profile even when optional array fields are empty", () => {
    const body = makeProductProfileBody({
      core_features: [],
      differentiation_claims: [],
      integrations_or_dependencies: [],
      core_workflow: [],
      sources: [],
    });
    const result = parseProductProfileBody(body);
    expect(result).not.toBeNull();
    expect(result!.core_features).toEqual([]);
  });
});

// ─── buildOrchestratorReportV1 → product_profile_v1 segment ─────────────────

describe("buildOrchestratorReportV1 — product_profile_v1 segment", () => {
  test("falls back to EMPTY_PRODUCT_PROFILE when section is absent", () => {
    const rp = makeMinimalRenderPackage(); // no product_profile_v1 section
    const report = buildOrchestratorReportV1({ dealId: "deal-001", renderPackage: rp });

    const pp = report.segments.product_profile_v1;
    expect(pp).toBeDefined();
    expect(pp.schema_version).toBe("product_profile_v1");
    expect(pp.product_type).toBe("Unknown");
    expect(pp.delivery_model).toBe("Unknown");
    expect(pp.product_maturity).toBe("Unknown");
    expect(pp.ai_claims_present).toBe(false);
    expect(pp.ai_evidence_strength).toBe("none");
    expect(pp.core_features).toEqual([]);
    expect(pp.differentiation_claims).toEqual([]);
    expect(pp.sources).toEqual([]);
  });

  test("populates segment from render package section body", () => {
    const rp = makeMinimalRenderPackage([
      {
        key: "product_profile_v1",
        title: "Product Profile",
        kind: "message",
        body: makeProductProfileBody(),
      },
    ]);

    const report = buildOrchestratorReportV1({ dealId: "deal-002", renderPackage: rp });
    const pp = report.segments.product_profile_v1;

    expect(pp.schema_version).toBe("product_profile_v1");
    expect(pp.product_type).toBe("SaaS");
    expect(pp.delivery_model).toBe("B2B SaaS");
    expect(pp.product_maturity).toBe("Beta");
    expect(pp.company_description).toBe("TestCo builds AI-powered tools for developers.");
    expect(pp.problem_statement).toBe("Developers waste time on boilerplate code.");
    expect(pp.ai_claims_present).toBe(true);
    expect(pp.ai_usage_type).toBe("Generative");
    expect(pp.ai_evidence_strength).toBe("weak");
    expect(pp.core_features).toContain("AI code gen");
    expect(pp.differentiation_claims).toContain("10x faster than manual");
    expect(pp.sources).toContain("ev-001");
  });

  test("falls back to EMPTY when body is malformed JSON", () => {
    const rp = makeMinimalRenderPackage([
      {
        key: "product_profile_v1",
        title: "Product Profile",
        kind: "message",
        body: "{ corrupted json !!",
      },
    ]);

    const report = buildOrchestratorReportV1({ dealId: "deal-003", renderPackage: rp });
    const pp = report.segments.product_profile_v1;

    expect(pp.product_type).toBe("Unknown");
  });

  test("falls back to EMPTY when body has wrong schema_version", () => {
    const rp = makeMinimalRenderPackage([
      {
        key: "product_profile_v1",
        title: "Product Profile",
        kind: "message",
        body: JSON.stringify({ schema_version: "old_v0", product_type: "SaaS" }),
      },
    ]);

    const report = buildOrchestratorReportV1({ dealId: "deal-004", renderPackage: rp });
    const pp = report.segments.product_profile_v1;

    expect(pp.product_type).toBe("Unknown");
  });
});

// ─── evidence registry ───────────────────────────────────────────────────────

describe("buildOrchestratorReportV1 — evidence_registry includes product_profile_v1", () => {
  test("registry by_segment includes product_profile_v1 key", () => {
    const rp = makeMinimalRenderPackage();
    const report = buildOrchestratorReportV1({ dealId: "deal-010", renderPackage: rp });

    expect(report.evidence_registry.indexes.by_segment).toHaveProperty("product_profile_v1");
    expect(Array.isArray(report.evidence_registry.indexes.by_segment.product_profile_v1)).toBe(true);
  });
});
