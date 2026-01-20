import { describe, expect, it } from "@jest/globals";

import {
  DECISION_SCORE_COMPONENT_KEYS_V2,
  FUNDAMENTALS_COMPONENT_KEYS_V2,
  PRESENTATION_COMPONENT_KEYS_V2,
  SCORE_COMPONENT_KEYS_V2,
} from "../scoring-contract.v2";

describe("Scoring contract v2", () => {
  it("has unique component keys", () => {
    const set = new Set(SCORE_COMPONENT_KEYS_V2);
    expect(set.size).toBe(SCORE_COMPONENT_KEYS_V2.length);
  });

  it("presentation + fundamentals cover all score keys", () => {
    const combined = new Set<string>([...PRESENTATION_COMPONENT_KEYS_V2, ...FUNDAMENTALS_COMPONENT_KEYS_V2]);
    expect(combined.size).toBe(SCORE_COMPONENT_KEYS_V2.length);
    for (const k of SCORE_COMPONENT_KEYS_V2) expect(combined.has(k)).toBe(true);
  });

  it("decision keys equal fundamentals", () => {
    expect([...DECISION_SCORE_COMPONENT_KEYS_V2]).toEqual([...FUNDAMENTALS_COMPONENT_KEYS_V2]);
  });
});
