import { describe, expect, it } from "@jest/globals";

import {
  DECISION_SCORE_COMPONENT_KEYS_V1,
  FUNDAMENTALS_COMPONENT_KEYS_V1,
  PRESENTATION_COMPONENT_KEYS_V1,
  SCORE_COMPONENT_KEYS_V1,
} from "../scoring-contract.v1";

describe("Scoring contract v1", () => {
  it("has unique component keys", () => {
    const set = new Set(SCORE_COMPONENT_KEYS_V1);
    expect(set.size).toBe(SCORE_COMPONENT_KEYS_V1.length);
  });

  it("decision keys are a subset of score keys", () => {
    const set = new Set(SCORE_COMPONENT_KEYS_V1);
    for (const k of DECISION_SCORE_COMPONENT_KEYS_V1) expect(set.has(k)).toBe(true);
  });

  it("presentation + fundamentals cover all keys", () => {
    const combined = new Set<string>([...PRESENTATION_COMPONENT_KEYS_V1, ...FUNDAMENTALS_COMPONENT_KEYS_V1]);
    expect(combined.size).toBe(SCORE_COMPONENT_KEYS_V1.length);
    for (const k of SCORE_COMPONENT_KEYS_V1) expect(combined.has(k)).toBe(true);
  });
});
