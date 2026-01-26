import { describe, expect, it } from "vitest";
import { makeJobId } from "../job-id";

describe("makeJobId", () => {
	it("removes colons and restricts to [A-Za-z0-9_-]", () => {
		const id = makeJobId("extract_visuals", ["doc:123", "range:0-10", "weird/part", "space part"]);
		expect(id).not.toContain(":");
		expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(id).toContain("extract_visuals");
	});

	it("never returns empty", () => {
		const id = makeJobId(":", [":", " ", null, undefined]);
		expect(id.length).toBeGreaterThan(0);
		expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
	});
});
