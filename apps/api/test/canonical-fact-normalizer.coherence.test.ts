import { test } from "node:test";
import assert from "node:assert/strict";

import { normalizeCanonicalFact } from "../src/lib/canonical/canonical-fact-normalizer";

test("coherence gate extracts best clause from slide-title style market heading", () => {
  const headingFragment =
    "a Powering Every Shared Payment Market Cino's target (100M users ICP) (annual) Cino Card (Today) €15.5B €155M 10% penetration";

  const slideTitle =
    "a Powering Every Shared Payment Market Cino's target (100M users ICP) (annual) Cino Card (Today) €15.5B €155M 10% penetration. First bank agnostic card for real-time shared payments.";

  const out = normalizeCanonicalFact(headingFragment, {
    kind: "market",
    maxLen: 220,
    sourceTexts: [slideTitle],
  });

  assert.ok(out.display_text);
  assert.match(out.display_text, /First bank agnostic card for real-time shared payments\./i);
  assert.ok(out.meta.rules_applied.includes("extract_best_clause_from_source"));
  assert.ok(!out.suppressed_reasons.includes("no_coherent_clause_found"));
});

test("coherence gate suppresses numeric soup with no coherent clause", () => {
  // Keep this under global numeric/symbol garbage thresholds, but still non-coherent:
  // no verbs, no explanatory connectors, and mostly numeric tokens.
  const numericSoup = "15.5B market opportunity 100M users annual";

  const out = normalizeCanonicalFact(numericSoup, {
    kind: "market_target",
    maxLen: 220,
    sourceTexts: [numericSoup],
  });

  assert.equal(out.display_text, null);
  assert.ok(out.suppressed_reasons.includes("not_coherent_sentence_like"));
  assert.ok(out.suppressed_reasons.includes("no_coherent_clause_found"));
});

test("coherence gate preserves normal sentence-like facts as good", () => {
  const sentence = "Cino captures 5% conversion at shared spend and powers real-time group payments.";
  const out = normalizeCanonicalFact(sentence, { kind: "market_context", maxLen: 220, sourceTexts: [sentence] });

  assert.ok(out.display_text);
  assert.equal(out.quality, "good");
  assert.ok(!out.meta.rules_applied.includes("extract_best_clause_from_source"));
});
