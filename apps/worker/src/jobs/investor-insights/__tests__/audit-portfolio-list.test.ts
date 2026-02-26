/**
 * audit-portfolio-list.test.ts
 *
 * Asserts that the committed canonical portfolio list
 * (apps/worker/tmp/audit_deals.json) exists, is well-formed, and
 * can be consumed by parseDealListFile without errors.
 *
 * This test acts as a guardrail: if someone accidentally deletes the file,
 * renames it, or introduces malformed entries, CI will fail here instead of
 * silently falling back to the hard-coded DEFAULT_DEAL_IDS in the bin script.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

import { parseDealListFile } from "../audit-investor-insights-coverage";

// Resolve relative to this test file:
//   __tests__/ → investor-insights/ → jobs/ → src/ → worker/ → tmp/
const PORTFOLIO_PATH = path.resolve(
	__dirname,
	"../../../../tmp/audit_deals.json"
);

describe("canonical portfolio list (apps/worker/tmp/audit_deals.json)", () => {
	it("file exists at the expected path", () => {
		expect(
			fs.existsSync(PORTFOLIO_PATH),
			`Portfolio list not found at: ${PORTFOLIO_PATH}\n` +
			"  Make sure apps/worker/tmp/audit_deals.json is committed.\n" +
			"  The .gitignore exception for this file is already in place."
		).toBe(true);
	});

	it("file parses as valid JSON", () => {
		const raw = fs.readFileSync(PORTFOLIO_PATH, "utf-8");
		expect(() => JSON.parse(raw)).not.toThrow();
	});

	it("passes parseDealListFile validation (deals array, valid UUIDs)", () => {
		const raw = JSON.parse(fs.readFileSync(PORTFOLIO_PATH, "utf-8"));
		expect(() => parseDealListFile(raw)).not.toThrow();
	});

	it("contains at least 1 deal", () => {
		const raw = JSON.parse(fs.readFileSync(PORTFOLIO_PATH, "utf-8")) as { deals?: unknown[] };
		expect(Array.isArray(raw.deals)).toBe(true);
		expect((raw.deals as unknown[]).length).toBeGreaterThanOrEqual(1);
	});

	it("contains a _note field documenting the file's purpose", () => {
		const raw = JSON.parse(fs.readFileSync(PORTFOLIO_PATH, "utf-8")) as Record<string, unknown>;
		expect(typeof raw["_note"]).toBe("string");
		expect((raw["_note"] as string).length).toBeGreaterThan(0);
	});

	it("all deal entries have non-empty name and valid UUID deal_id", () => {
		const parsed = parseDealListFile(
			JSON.parse(fs.readFileSync(PORTFOLIO_PATH, "utf-8"))
		);
		const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
		for (const deal of parsed.deals) {
			expect(deal.name.trim().length).toBeGreaterThan(0);
			expect(UUID_RE.test(deal.deal_id)).toBe(true);
		}
	});

	it("deal_ids are unique (no duplicates in the portfolio)", () => {
		const parsed = parseDealListFile(
			JSON.parse(fs.readFileSync(PORTFOLIO_PATH, "utf-8"))
		);
		const ids = parsed.deals.map((d) => d.deal_id);
		const unique = new Set(ids);
		expect(unique.size).toBe(ids.length);
	});
});
