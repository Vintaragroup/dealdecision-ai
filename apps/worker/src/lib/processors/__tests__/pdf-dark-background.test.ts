// Part B: dark background detection tests.
// hasDarkBackground() is a pure exported helper — no side-effects, no DB, no PDF
// rendering; tests run entirely in memory.

import { describe, it, expect } from "vitest";
import { hasDarkBackground } from "../pdf";

// Build a minimal RGBA Uint8ClampedArray filled with a uniform colour.
function makePixels(pixelCount: number, r: number, g: number, b: number): Uint8ClampedArray {
	const data = new Uint8ClampedArray(pixelCount * 4);
	for (let i = 0; i < pixelCount * 4; i += 4) {
		data[i]     = r;
		data[i + 1] = g;
		data[i + 2] = b;
		data[i + 3] = 255; // alpha
	}
	return data;
}

describe("hasDarkBackground", () => {
	// ── Dark images ─────────────────────────────────────────────────────────────

	it("returns true for a nearly-black image (gray ≈ 20)", () => {
		// luminance ≈ 20/255 ≈ 0.078 << threshold 0.35
		const data = makePixels(1024, 20, 20, 20);
		expect(hasDarkBackground(data)).toBe(true);
	});

	it("returns true for a dark navy image (R=0, G=0, B=80)", () => {
		// luminance = 0.114 * 80 / 255 ≈ 0.036 — well below threshold
		const data = makePixels(512, 0, 0, 80);
		expect(hasDarkBackground(data)).toBe(true);
	});

	it("returns true for a mid-dark grey image on the boundary (luminance ≈ 0.34)", () => {
		// 0.34 * 255 ≈ 87 for all channels
		const data = makePixels(512, 87, 87, 87);
		expect(hasDarkBackground(data)).toBe(true);
	});

	// ── Light images ─────────────────────────────────────────────────────────────

	it("returns false for a white image", () => {
		const data = makePixels(1024, 255, 255, 255);
		expect(hasDarkBackground(data)).toBe(false);
	});

	it("returns false for a light-grey image (gray ≈ 200)", () => {
		// luminance ≈ 0.784 >> threshold
		const data = makePixels(512, 200, 200, 200);
		expect(hasDarkBackground(data)).toBe(false);
	});

	it("returns false for a typical slide background (pale off-white R=240, G=240, B=240)", () => {
		const data = makePixels(1024, 240, 240, 240);
		expect(hasDarkBackground(data)).toBe(false);
	});

	// ── Edge cases ───────────────────────────────────────────────────────────────

	it("returns false for an empty (zero-length) buffer — no pixels to sample", () => {
		expect(hasDarkBackground(new Uint8ClampedArray(0))).toBe(false);
	});

	it("is not affected by the alpha channel (only R, G, B matter)", () => {
		// RGBA with transparent pixels — luminance determined by RGB alone.
		const data = new Uint8ClampedArray([10, 10, 10, 0, 10, 10, 10, 0]); // 2 pixels, very dark
		expect(hasDarkBackground(data)).toBe(true);
	});
});
