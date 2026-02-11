import { describe, expect, it } from "vitest";
import type { DocumentStatus } from "@dealdecision/contracts";

describe("DocumentStatus contract", () => {
	it("includes ready_for_analysis", () => {
		const status: DocumentStatus = "ready_for_analysis";
		expect(status).toBe("ready_for_analysis");
	});
});
