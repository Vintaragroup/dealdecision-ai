/**
 * Unit tests for WS-C (PR20): isXlsxPageUseful + XLSX_DPU_USEFUL_HEURISTIC_VERSION
 *
 * Pure function — no DB, no LLM, no side effects.
 */
import { describe, it, expect } from "vitest";
import {
	isXlsxPageUseful,
	XLSX_DPU_USEFUL_HEURISTIC_VERSION,
} from "../stages/_shared";

// ─── Constants ────────────────────────────────────────────────────────────────

describe("XLSX_DPU_USEFUL_HEURISTIC_VERSION", () => {
	it('is "v1"', () => {
		expect(XLSX_DPU_USEFUL_HEURISTIC_VERSION).toBe("v1");
	});
});

// ─── isXlsxPageUseful — non-XLSX pages ────────────────────────────────────────

describe("isXlsxPageUseful — non-XLSX page types", () => {
	it("returns true for non-empty text on a pdf page", () => {
		expect(isXlsxPageUseful("Some text content here.", "pdf")).toBe(true);
	});

	it("returns false for empty text on a pdf page", () => {
		expect(isXlsxPageUseful("", "pdf")).toBe(false);
	});

	it("returns false for whitespace-only text on a pdf page", () => {
		expect(isXlsxPageUseful("   \n\t  ", "pdf")).toBe(false);
	});

	it("returns true for non-empty text on an image page", () => {
		expect(isXlsxPageUseful("Revenue was $1.2M", "image")).toBe(true);
	});
});

// ─── isXlsxPageUseful — XLSX pages (condition 1: length >= 80) ───────────────

describe("isXlsxPageUseful — XLSX pages, condition 1 (length >= 80)", () => {
	const PAGE_TYPE = "excel_range";

	it("returns true for page_text with >= 80 characters", () => {
		const longText = "A".repeat(80);
		expect(isXlsxPageUseful(longText, PAGE_TYPE)).toBe(true);
	});

	it("returns true for page_text with > 80 characters", () => {
		const longText = "Revenue $1.2M  Expenses $800K  EBITDA $400K  Growth 35%  Margin 33%  ARR $2M";
		expect(longText.length).toBeGreaterThanOrEqual(70);
		const extendedText = longText + " additional context here!";
		expect(isXlsxPageUseful(extendedText, PAGE_TYPE)).toBe(true);
	});

	it("returns false for page_text with exactly 79 characters without numeric tokens", () => {
		const text = "A".repeat(79); // no numeric tokens
		expect(isXlsxPageUseful(text, PAGE_TYPE)).toBe(false);
	});
});

// ─── isXlsxPageUseful — XLSX pages (condition 2: >= 3 numeric KPI tokens) ────

describe("isXlsxPageUseful — XLSX pages, condition 2 (>= 3 numeric KPI tokens)", () => {
	const PAGE_TYPE = "excel_range";

	it("returns true for short text with >= 3 numeric tokens", () => {
		expect(isXlsxPageUseful("$1.2M 35% 400K", PAGE_TYPE)).toBe(true);
	});

	it("returns true for exactly 3 numeric tokens", () => {
		expect(isXlsxPageUseful("100 200 300", PAGE_TYPE)).toBe(true);
	});

	it("returns false for text with only 2 numeric tokens", () => {
		expect(isXlsxPageUseful("$1.2M 35%", PAGE_TYPE)).toBe(false);
	});

	it("returns false for empty string (no tokens, no length)", () => {
		expect(isXlsxPageUseful("", PAGE_TYPE)).toBe(false);
	});

	it("returns true for currency + percent + integer tokens", () => {
		expect(isXlsxPageUseful("$500,000 32% 12", PAGE_TYPE)).toBe(true);
	});

	it("returns true for KMB suffixed tokens", () => {
		expect(isXlsxPageUseful("1.5M 2.3K 44B", PAGE_TYPE)).toBe(true);
	});
});

// ─── isXlsxPageUseful — boundary cases ────────────────────────────────────────

describe("isXlsxPageUseful — boundary cases", () => {
	const PAGE_TYPE = "excel_range";

	it("returns false for XLSX page with only 1 numeric token and short text", () => {
		expect(isXlsxPageUseful("Total: $1.2M", PAGE_TYPE)).toBe(false);
	});

	it("returns false for XLSX page that is a single long number below 80 chars", () => {
		// 79 chars of text but not meeting any condition
		expect(isXlsxPageUseful("1234567", PAGE_TYPE)).toBe(false);
	});

	it("returns true when conditions overlap (long text AND numeric tokens)", () => {
		const text = "$1.2M revenue $800K expenses $400K EBITDA growing at 35% with ARR $2M";
		expect(text.length).toBeGreaterThanOrEqual(60);
		// Even if < 80 chars, has >= 3 tokens
		if (text.length < 80) {
			expect(isXlsxPageUseful(text, PAGE_TYPE)).toBe(true); // condition 2
		} else {
			expect(isXlsxPageUseful(text, PAGE_TYPE)).toBe(true); // condition 1 or 2
		}
	});
});
