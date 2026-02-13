import { test } from "node:test";
import assert from "node:assert/strict";

import { normalizeAndFilterLines } from "../src/lib/segmented-nodes-for-deal";

test("normalizeAndFilterLines keeps good bullets", () => {
  const { kept, dropped } = normalizeAndFilterLines([
    "We sell subscription software that automates AP reconciliation for mid-market finance teams.",
  ]);
  assert.equal(kept.length, 1);
  assert.equal(dropped.length, 0);
});

test("normalizeAndFilterLines drops boilerplate", () => {
  const { kept, dropped } = normalizeAndFilterLines(["CONFIDENTIAL © 2026 All rights reserved."]);
  assert.equal(kept.length, 0);
  assert.ok(dropped.length >= 1);
  assert.equal(dropped[0]?.reason, "boilerplate");
});

test("normalizeAndFilterLines drops urls", () => {
  const { kept, dropped } = normalizeAndFilterLines(["https://example.com", "www.example.com/foo"]);
  assert.equal(kept.length, 0);
  assert.ok(dropped.every((d) => d.reason === "url"));
});

test("normalizeAndFilterLines drops OCR soup by symbol/digit ratio", () => {
  const { kept, dropped } = normalizeAndFilterLines([
    "|||||||||||||||||||||||||||||||||||||||||||||||||",
    "1234567890123456789012345678901234567890",
  ]);
  assert.equal(kept.length, 0);
  const reasons = new Set(dropped.map((d) => d.reason));
  assert.ok(reasons.has("ocr_symbol_ratio") || reasons.has("punctuation_run"));
  assert.ok(reasons.has("ocr_digit_ratio") || reasons.has("ocr_token_shape"));
});

test("normalizeAndFilterLines drops OCR soup by token shape", () => {
  const { kept, dropped } = normalizeAndFilterLines(["ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopQRSTUVWX"]);
  assert.equal(kept.length, 0);
  assert.ok(dropped.some((d) => d.reason === "ocr_token_shape"));
});

test("normalizeAndFilterLines drops repeated punctuation runs", () => {
  const { kept, dropped } = normalizeAndFilterLines(["-------- -------- --------", "............"]);
  assert.equal(kept.length, 0);
  assert.ok(dropped.some((d) => d.reason === "punctuation_run" || d.reason === "ocr_symbol_ratio"));
});
