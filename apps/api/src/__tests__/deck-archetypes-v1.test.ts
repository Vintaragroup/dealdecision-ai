import test from "node:test";
import assert from "node:assert/strict";

import { inferDeckArchetypeV1 } from "../lib/deck-archetypes";

test("deck_archetype_v1 infers consumer_apparel_dtc for Palm-like DTC/wholesale apparel deck", () => {
  const nodes = [
    {
      slide_title: "Product",
      bullets: ["Premium golf apparel designed for performance and lifestyle, including gloves."],
      segment_key: "product",
    },
    {
      slide_title: "Industry Outlook",
      bullets: ["Golf participation is growing, expanding the premium apparel category."],
      segment_key: "market",
    },
    {
      slide_title: "Traction",
      bullets: ["Wholesale accounts growing (46 accounts) alongside DTC conversion gains."],
      segment_key: "traction",
    },
    {
      slide_title: "Business Model",
      bullets: ["DTC ecommerce plus wholesale distribution to specialty retail partners."],
      segment_key: "business_model",
    },
    {
      slide_title: "Go To Market",
      bullets: ["Paid social, email, and retail partner programs drive DTC growth."],
      segment_key: "go_to_market",
    },
  ];

  const out = inferDeckArchetypeV1(nodes as any);
  assert.equal(out.deck_archetype.key, "consumer_apparel_dtc");
  assert.ok(out.deck_archetype.confidence >= 0.45);

  const missing = out.diagnostics.filter((d) => d.kind === "missing_required");
  assert.equal(missing.length, 0);
});

test("deck_archetype_v1 infers enterprise_saas_compliance for compliance/security-heavy enterprise SaaS deck", () => {
  const nodes = [
    {
      slide_title: "Compliance Controls",
      bullets: ["Audit controls and policy coverage across regulated enterprise workflows."],
      segment_key: "operations",
    },
    {
      slide_title: "Security & Privacy",
      bullets: ["SOC 2 alignment and GDPR readiness for regulated customers."],
      segment_key: "operations",
    },
    {
      slide_title: "Product Platform",
      bullets: ["API-first workflow automation for compliance and evidence collection."],
      segment_key: "product",
    },
    {
      slide_title: "Customer Traction",
      bullets: ["Enterprise pilots converting with expansion across teams."],
      segment_key: "traction",
    },
    {
      slide_title: "Risks",
      bullets: ["Regulatory requirements are evolving; security posture is continuously monitored."],
      segment_key: "risks",
    },
  ];

  const out = inferDeckArchetypeV1(nodes as any);
  assert.equal(out.deck_archetype.key, "enterprise_saas_compliance");
  assert.ok(out.deck_archetype.confidence >= 0.45);

  const missing = out.diagnostics.filter((d) => d.kind === "missing_required");
  assert.equal(missing.length, 0);
});

test("deck_archetype_v1 treats business_model as satisfied via synthesized business_model_summary_v1 when segment nodes are missing", () => {
  const nodes = [
    {
      slide_title: "Product",
      bullets: ["Premium golf apparel designed for performance and lifestyle, including gloves."],
      segment_key: "product",
    },
    {
      slide_title: "Industry Outlook",
      bullets: ["Golf participation is growing, expanding the premium apparel category."],
      segment_key: "market",
    },
    {
      slide_title: "Traction",
      bullets: ["Wholesale accounts growing alongside DTC conversion gains."],
      segment_key: "traction",
    },
    {
      slide_title: "Go To Market",
      bullets: ["DTC ecommerce plus wholesale distribution to specialty retail partners."],
      segment_key: "go_to_market",
    },
  ];

  const structured_summary = {
    business_model_summary_v1: {
      value: "DTC ecommerce plus wholesale distribution to retail partners",
      confidence: 0.85,
      derived_from: {
        product_pages: [4],
        gtm_pages: [9],
      },
    },
  };

  const out = inferDeckArchetypeV1(nodes as any, { structured_summary });
  assert.equal(out.deck_archetype.key, "consumer_apparel_dtc");
  assert.ok(out.deck_archetype.confidence >= 0.42);

  const satisfied = out.diagnostics.filter((d) => d.kind === "satisfied_by_synthesis" && d.segment === "business_model");
  assert.equal(satisfied.length, 1);

  const missing = out.diagnostics.filter((d) => d.kind === "missing_required");
  assert.equal(missing.length, 0);
});

test("deck_archetype_v1 does not satisfy business_model via synthesis when confidence or provenance anchors are insufficient", () => {
  const nodes = [
    {
      slide_title: "Product",
      bullets: ["Premium golf apparel designed for performance and lifestyle."],
      segment_key: "product",
    },
    {
      slide_title: "Market",
      bullets: ["Apparel category growth supports DTC expansion."],
      segment_key: "market",
    },
    {
      slide_title: "Traction",
      bullets: ["Wholesale accounts growing alongside DTC gains."],
      segment_key: "traction",
    },
    {
      slide_title: "Go To Market",
      bullets: ["DTC and wholesale distribution."],
      segment_key: "go_to_market",
    },
  ];

  const structured_summary = {
    business_model_summary_v1: {
      value: "DTC and wholesale",
      confidence: 0.55,
      derived_from: {
        product_pages: [],
        gtm_pages: [],
      },
    },
  };

  const out = inferDeckArchetypeV1(nodes as any, { structured_summary });
  assert.equal(out.deck_archetype.key, "consumer_apparel_dtc");

  const satisfied = out.diagnostics.filter((d) => d.kind === "satisfied_by_synthesis");
  assert.equal(satisfied.length, 0);

  const missing = out.diagnostics.filter((d) => d.kind === "missing_required");
  assert.ok(missing.length >= 1);
  assert.ok(missing.some((d) => String(d.message).includes("business_model")));
});
