import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  normalizeToken,
  classifySpacingKey,
  closestTargetKey,
  type SpacingSeverity,
} from "../check-style-drift";

// ---------------------------------------------------------------------------
// Helper: mirrors the tokenTest logic in check-style-drift.ts getRules().
// Kept inline so test assertions are self-contained.
// ---------------------------------------------------------------------------
const SPACING_PREFIX_RX = /^(?:scroll-m[xytblr]?|space-[xy]|gap-[xy]|gap|p[xytblr]?|m[xytblr]?)-/;
const ARBITRARY_SPACING_RX = /^(?:scroll-m[xytblr]?|space-[xy]|gap-[xy]|gap|p[xytblr]?|m[xytblr]?)-\[.+\]$/;

function applySpacingRules(
  token: string,
): { rule: string; severity: SpacingSeverity; suggestion?: string } | null {
  const { baseToken, spacingKey } = normalizeToken(token);

  if (ARBITRARY_SPACING_RX.test(baseToken)) {
    return { rule: "tailwind-arbitrary-spacing", severity: "HARD_FAIL" };
  }

  if (!spacingKey || !SPACING_PREFIX_RX.test(baseToken)) return null;

  const severity = classifySpacingKey(spacingKey);
  if (severity === "OK") return null;

  const suggestion = severity === "MIGRATION" ? closestTargetKey(spacingKey) : undefined;
  return { rule: "tailwind-spacing-scale", severity, suggestion };
}

// ---------------------------------------------------------------------------
// normalizeToken
// ---------------------------------------------------------------------------
describe("normalizeToken", () => {
  test("plain token: no variants", () => {
    const t = normalizeToken("gap-9");
    assert.equal(t.baseToken, "gap-9");
    assert.equal(t.spacingKey, "9");
    assert.deepEqual(t.variants, []);
    assert.equal(t.isNegative, false);
    assert.equal(t.hadImportant, false);
  });

  test("single variant prefix", () => {
    const t = normalizeToken("md:gap-9");
    assert.equal(t.baseToken, "gap-9");
    assert.equal(t.spacingKey, "9");
    assert.deepEqual(t.variants, ["md"]);
  });

  test("chained variant prefixes", () => {
    const t = normalizeToken("dark:md:hover:gap-9");
    assert.equal(t.baseToken, "gap-9");
    assert.deepEqual(t.variants, ["dark", "md", "hover"]);
  });

  test("! important modifier", () => {
    const t = normalizeToken("hover:!mb-7");
    assert.equal(t.hadImportant, true);
    assert.equal(t.baseToken, "mb-7");
    assert.equal(t.spacingKey, "7");
    assert.deepEqual(t.variants, ["hover"]);
  });

  test("negative spacing -mt-4", () => {
    const t = normalizeToken("-mt-4");
    assert.equal(t.isNegative, true);
    assert.equal(t.baseToken, "mt-4");
    assert.equal(t.spacingKey, "4");
    assert.deepEqual(t.variants, []);
  });

  test("fractional key 0.5", () => {
    const t = normalizeToken("p-0.5");
    assert.equal(t.spacingKey, "0.5");
  });

  test("bracket arbitrary value returns null spacingKey", () => {
    const t = normalizeToken("p-[18px]");
    assert.equal(t.spacingKey, null);
    assert.equal(t.baseToken, "p-[18px]");
  });

  test("bracket variant (data attribute)", () => {
    const t = normalizeToken("data-[state=open]:p-4");
    assert.equal(t.baseToken, "p-4");
    assert.equal(t.spacingKey, "4");
    assert.deepEqual(t.variants, ["data-[state=open]"]);
  });

  test("positional token top-[50%] returns null spacingKey", () => {
    const t = normalizeToken("top-[50%]");
    assert.equal(t.spacingKey, null);
    assert.equal(t.baseToken, "top-[50%]");
  });
});

// ---------------------------------------------------------------------------
// classifySpacingKey
// ---------------------------------------------------------------------------
describe("classifySpacingKey", () => {
  test("key in both CURRENT and TARGET → OK", () => {
    assert.equal(classifySpacingKey("4"), "OK");
    assert.equal(classifySpacingKey("0"), "OK");
    assert.equal(classifySpacingKey("24"), "OK");
  });

  test("former migration keys now removed from CURRENT → HARD_FAIL (window closed)", () => {
    // 3.5, 7, 11, 13, 14 were migrated out of the codebase and removed from CURRENT.
    // CURRENT now equals TARGET — these keys are fully disallowed.
    assert.equal(classifySpacingKey("3.5"), "HARD_FAIL");
    assert.equal(classifySpacingKey("7"), "HARD_FAIL");
    assert.equal(classifySpacingKey("11"), "HARD_FAIL");
    assert.equal(classifySpacingKey("13"), "HARD_FAIL");
    assert.equal(classifySpacingKey("14"), "HARD_FAIL");
  });

  test("key in neither list → HARD_FAIL", () => {
    assert.equal(classifySpacingKey("9"), "HARD_FAIL");
    assert.equal(classifySpacingKey("15"), "HARD_FAIL");
    assert.equal(classifySpacingKey("17"), "HARD_FAIL");
  });
});

// ---------------------------------------------------------------------------
// closestTargetKey
// ---------------------------------------------------------------------------
describe("closestTargetKey", () => {
  test("exact target key returns itself", () => {
    assert.equal(closestTargetKey("4"), "4");
    assert.equal(closestTargetKey("0"), "0");
  });

  test("9 → closest to 8", () => {
    assert.equal(closestTargetKey("9"), "8");
  });

  test("7 → closest to 6 or 8 (equidistant → first in sorted list)", () => {
    // 7 is equidistant from 6 and 8; sorted array picks 6 (lower wins as best starts at 6)
    const result = closestTargetKey("7");
    assert.ok(result === "6" || result === "8", `Expected 6 or 8, got ${result}`);
  });

  test("14 → closest to 12 or 16", () => {
    const result = closestTargetKey("14");
    assert.ok(result === "12" || result === "16", `Expected 12 or 16, got ${result}`);
  });

  test("3.5 → closest to 3 or 4", () => {
    const result = closestTargetKey("3.5");
    assert.ok(result === "3" || result === "4", `Expected 3 or 4, got ${result}`);
  });
});

// ---------------------------------------------------------------------------
// Integration: full token classification via applySpacingRules()
// ---------------------------------------------------------------------------
describe("applySpacingRules integration", () => {
  test("gap-9 → HARD_FAIL (9 not in CURRENT)", () => {
    const r = applySpacingRules("gap-9");
    assert.ok(r !== null);
    assert.equal(r!.severity, "HARD_FAIL");
    assert.equal(r!.rule, "tailwind-spacing-scale");
  });

  test("md:gap-9 → HARD_FAIL (variant prefix normalized)", () => {
    const r = applySpacingRules("md:gap-9");
    assert.ok(r !== null);
    assert.equal(r!.severity, "HARD_FAIL");
  });

  test("dark:md:hover:gap-9 → HARD_FAIL (multiple variants normalized)", () => {
    const r = applySpacingRules("dark:md:hover:gap-9");
    assert.ok(r !== null);
    assert.equal(r!.severity, "HARD_FAIL");
  });

  test("hover:!mb-7 → HARD_FAIL (7 removed from CURRENT — migration window closed)", () => {
    const r = applySpacingRules("hover:!mb-7");
    assert.ok(r !== null);
    assert.equal(r!.severity, "HARD_FAIL");
    assert.equal(r!.rule, "tailwind-spacing-scale");
  });

  test("-mt-4 → OK (negative, 4 in TARGET)", () => {
    const r = applySpacingRules("-mt-4");
    assert.equal(r, null, "Allowed key should return null (no violation)");
  });

  test("md:p-[18px] → HARD_FAIL arbitrary-spacing", () => {
    const r = applySpacingRules("md:p-[18px]");
    assert.ok(r !== null);
    assert.equal(r!.severity, "HARD_FAIL");
    assert.equal(r!.rule, "tailwind-arbitrary-spacing");
  });

  test("hover:gap-[10px] → HARD_FAIL arbitrary-spacing", () => {
    const r = applySpacingRules("hover:gap-[10px]");
    assert.ok(r !== null);
    assert.equal(r!.severity, "HARD_FAIL");
    assert.equal(r!.rule, "tailwind-arbitrary-spacing");
  });

  test("top-[50%] → NOT flagged (positional, not spacing)", () => {
    const r = applySpacingRules("top-[50%]");
    assert.equal(r, null, "Positional arbitrary values must not be flagged");
  });

  test("translate-y-[calc(-50%_-_2px)] → NOT flagged", () => {
    const r = applySpacingRules("translate-y-[calc(-50%_-_2px)]");
    assert.equal(r, null);
  });

  test("ring-[3px] → NOT flagged (focus ring, not spacing)", () => {
    const r = applySpacingRules("ring-[3px]");
    assert.equal(r, null);
  });

  test("max-w-[calc(100%-2rem)] → NOT flagged (layout constraint)", () => {
    const r = applySpacingRules("max-w-[calc(100%-2rem)]");
    assert.equal(r, null);
  });

  test("w-[100px] → NOT flagged (size, not spacing)", () => {
    const r = applySpacingRules("w-[100px]");
    assert.equal(r, null);
  });

  test("p-4 → OK (in both CURRENT and TARGET)", () => {
    const r = applySpacingRules("p-4");
    assert.equal(r, null);
  });

  test("p-7 → HARD_FAIL (7 removed from CURRENT)", () => {
    const r = applySpacingRules("p-7");
    assert.ok(r !== null);
    assert.equal(r!.severity, "HARD_FAIL");
  });

  test("px-17 → HARD_FAIL (17 not in CURRENT)", () => {
    const r = applySpacingRules("px-17");
    assert.ok(r !== null);
    assert.equal(r!.severity, "HARD_FAIL");
  });
});
