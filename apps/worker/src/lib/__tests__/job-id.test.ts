import { describe, expect, it } from "vitest";
import { makeJobId, sanitizeJobId } from "../job-id";

describe("sanitizeJobId", () => {
	it("removes ':' and stays stable", () => {
		const input = "extract_visuals:doc:123";
		const a = sanitizeJobId(input);
		const b = sanitizeJobId(input);
		expect(a).toBe(b);
		expect(a).not.toContain(":");
		expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
	});
});

describe("makeJobId", () => {
	it("removes colons and restricts to [A-Za-z0-9_-]", () => {
		const id = makeJobId("extract_visuals", ["doc:123", "range:0-10", "weird/part", "space part"]);
		expect(id).not.toContain(":");
		expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(id).toContain("extract_visuals");
	});

	it("normalizes ':' to '__'", () => {
		const id = makeJobId("a:b", ["c:d"]);
		expect(id).not.toContain(":");
		expect(id).toContain("a__b");
		expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
	});

	it("never returns empty", () => {
		const id = makeJobId(":", [":", " ", null, undefined]);
		expect(id.length).toBeGreaterThan(0);
		expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
	});
});
