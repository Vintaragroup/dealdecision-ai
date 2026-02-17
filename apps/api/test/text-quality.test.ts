import { test } from "node:test";
import assert from "node:assert/strict";

import { assessTextQuality, sanitizeForDisplay } from "../src/lib/text-quality";

test("sanitizeForDisplay collapses whitespace and normalizes punctuation", () => {
  const s = sanitizeForDisplay("Hello\n\nworld —  test   ");
  assert.equal(s, "Hello world - test");
});

test("assessTextQuality suppresses obvious boilerplate/footer", () => {
  const a = assessTextQuality("CONFIDENTIAL © 2024 www.example.com");
  assert.equal(a.quality, "garbage");
  assert.equal(a.display, null);
  assert.ok(a.reasons.includes("boilerplate_marker"));
});

test("assessTextQuality accepts a normal product sentence", () => {
  const a = assessTextQuality("We sell subscription software that automates dispatch routing for field service teams.");
  assert.ok(a.quality === "good" || a.quality === "ok");
  assert.equal(typeof a.display, "string");
  assert.ok((a.display ?? "").length > 20);
});
