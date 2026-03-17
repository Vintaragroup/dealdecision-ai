/**
 * Unit tests for first-pass-config constants.
 *
 * These are deliberately strict equality checks: the constants are used by
 * multiple parts of the pipeline (coordinator timeouts, chunk priorities) and
 * any accidental change should cause an immediate, obvious failure here.
 */
import { describe, it, expect } from "vitest";
import {
  FIRST_PASS_PAGE_THRESHOLD,
  FIRST_PASS_VISION_TIMEOUTS_PDF,
  FIRST_PASS_VISION_TIMEOUTS_PPTX,
  FIRST_PASS_CHUNK_PRIORITY,
  BACKGROUND_CHUNK_PRIORITY,
} from "../first-pass-config";

describe("first-pass-config constants", () => {
  it("FIRST_PASS_PAGE_THRESHOLD is 10", () => {
    expect(FIRST_PASS_PAGE_THRESHOLD).toBe(10);
  });

  it("FIRST_PASS_VISION_TIMEOUTS_PDF is [12_000, 30_000]", () => {
    expect(FIRST_PASS_VISION_TIMEOUTS_PDF).toEqual([12_000, 30_000]);
  });

  it("FIRST_PASS_VISION_TIMEOUTS_PPTX is [12_000, 30_000, 60_000]", () => {
    expect(FIRST_PASS_VISION_TIMEOUTS_PPTX).toEqual([12_000, 30_000, 60_000]);
  });

  it("FIRST_PASS_CHUNK_PRIORITY is 1 (highest BullMQ priority)", () => {
    expect(FIRST_PASS_CHUNK_PRIORITY).toBe(1);
  });

  it("BACKGROUND_CHUNK_PRIORITY is 5 (lower than first-pass)", () => {
    expect(BACKGROUND_CHUNK_PRIORITY).toBe(5);
  });

  it("FIRST_PASS_CHUNK_PRIORITY is lower number than BACKGROUND_CHUNK_PRIORITY (runs first)", () => {
    expect(FIRST_PASS_CHUNK_PRIORITY).toBeLessThan(BACKGROUND_CHUNK_PRIORITY);
  });

  it("FIRST_PASS_VISION_TIMEOUTS_PDF timeouts are shorter than background defaults [20k, 60k]", () => {
    expect(FIRST_PASS_VISION_TIMEOUTS_PDF[0]).toBeLessThan(20_000);
    expect(FIRST_PASS_VISION_TIMEOUTS_PDF[1]).toBeLessThan(60_000);
  });

  it("FIRST_PASS_VISION_TIMEOUTS_PPTX timeouts are shorter than background defaults [20k, 60k, 90k]", () => {
    expect(FIRST_PASS_VISION_TIMEOUTS_PPTX[0]).toBeLessThan(20_000);
    expect(FIRST_PASS_VISION_TIMEOUTS_PPTX[1]).toBeLessThan(60_000);
    expect(FIRST_PASS_VISION_TIMEOUTS_PPTX[2]).toBeLessThan(90_000);
  });
});
