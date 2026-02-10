import { expect, test } from "vitest";

import { shouldSkipExtractVisualsAfterRenderV1 } from "./render-followups";

test("shouldSkipExtractVisualsAfterRenderV1: allows <=80 page PDFs even if routing disallowed", () => {
	expect(
		shouldSkipExtractVisualsAfterRenderV1({
			doc_kind: "pdf",
			page_count_total: 23,
			vision_fallback_allowed: false,
		})
	).toBe(false);
});

test("shouldSkipExtractVisualsAfterRenderV1: skips huge PDFs when routing disallowed", () => {
	expect(
		shouldSkipExtractVisualsAfterRenderV1({
			doc_kind: "pdf",
			page_count_total: 300,
			vision_fallback_allowed: false,
		})
	).toBe(true);
});

test("shouldSkipExtractVisualsAfterRenderV1: never skips when routing allowed", () => {
	expect(
		shouldSkipExtractVisualsAfterRenderV1({
			doc_kind: "pdf",
			page_count_total: 300,
			vision_fallback_allowed: true,
		})
	).toBe(false);
});

test("shouldSkipExtractVisualsAfterRenderV1: non-pdf never skips", () => {
	expect(
		shouldSkipExtractVisualsAfterRenderV1({
			doc_kind: "pptx",
			page_count_total: 300,
			vision_fallback_allowed: false,
		})
	).toBe(false);
});
