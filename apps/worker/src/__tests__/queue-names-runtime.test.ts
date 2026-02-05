import { describe, it, expect } from "vitest";

import { QUEUE_NAMES } from "@dealdecision/core";

describe("QUEUE_NAMES runtime export", () => {
	it("includes populate_document_page_understanding", () => {
		expect(QUEUE_NAMES).toBeTruthy();
		expect(QUEUE_NAMES.populate_document_page_understanding).toBe("populate_document_page_understanding");
	});
});
