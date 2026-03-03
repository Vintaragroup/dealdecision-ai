// P1: safeJobId regression-proofing tests.
// Ensures BullMQ job IDs never contain ":" (Redis key-path separator).

import test from "node:test";
import assert from "node:assert/strict";

import { safeJobId } from "../services/jobs";

test("safeJobId: colons replaced with __", () => {
  assert.equal(safeJobId("dpu:dealId:docId:v1"), "dpu__dealId__docId__v1");
});

test("safeJobId: multiple consecutive colons collapsed to single __", () => {
  assert.equal(safeJobId("a::b:::c"), "a__b__c");
});

test("safeJobId: idempotent on already-safe IDs", () => {
  const id = "investor_insights__deal123__v1__manual_regenerate";
  assert.equal(safeJobId(id), id);
});

test("safeJobId: strips leading/trailing underscores produced by boundary colons", () => {
  const result = safeJobId(":foo:bar:");
  assert.ok(!result.startsWith("_"), `Should not start with _: "${result}"`);
  assert.ok(!result.endsWith("_"),   `Should not end with _: "${result}"`);
});

test("safeJobId: empty string returns empty string", () => {
  assert.equal(safeJobId(""), "");
});

test("safeJobId: UUID-style deal IDs pass through unchanged", () => {
  const id = "550e8400-e29b-41d4-a716-446655440000";
  assert.equal(safeJobId(id), id);
});

test("safeJobId: strips chars other than [A-Za-z0-9_-]", () => {
  const result = safeJobId("job/type.v1 extra");
  // slashes, dots, spaces → underscores; no leading/trailing
  assert.ok(!/[^A-Za-z0-9_-]/.test(result), `Unexpected char in "${result}"`);
});
