import { expect, test } from "vitest";

import { shouldRunOcr } from "./should-run-ocr";

test("shouldRunOcr: normal PDF with probe ok => skip", () => {
	const res = shouldRunOcr({
		contentType: "pdf",
		attempt: 1,
		fullText: "Hello world. This is a normal text PDF.",
		fullTextAbsentReason: null,
		textProbe: { decision: "text_ok_skip_ocr", needsOcr: false, min_text_threshold_chars: 10 },
		pageOcr: { attempted: false },
		priorNeedsOcrFlowState: null,
		env: { PDF_MIN_TEXT_THRESHOLD_CHARS: "10" } as any,
	});
	expect(res.run).toBe(false);
	expect(res.reason).toBe("probe_says_ok");
});

test("shouldRunOcr: probe says sparse => run", () => {
	const res = shouldRunOcr({
		contentType: "application/pdf",
		attempt: 1,
		fullText: "",
		fullTextAbsentReason: "no_text_extracted_needs_ocr",
		textProbe: { decision: "text_sparse_needs_ocr", needsOcr: true, min_text_threshold_chars: 800 },
		pageOcr: { attempted: false },
		priorNeedsOcrFlowState: null,
	});
	expect(res.run).toBe(true);
	expect(res.reason).toBe("needs_ocr_by_probe");
});

test("shouldRunOcr: idempotent skip when flow already completed", () => {
	const res = shouldRunOcr({
		contentType: "pdf",
		attempt: 1,
		fullText: "",
		fullTextAbsentReason: "no_text_extracted_needs_ocr",
		textProbe: { decision: "text_sparse_needs_ocr", needsOcr: true },
		priorNeedsOcrFlowState: "completed",
	});
	expect(res.run).toBe(false);
	expect(res.reason).toBe("already_completed");
});

test("shouldRunOcr: low-quality OCR-like gibberish above threshold => run", () => {
	const gibberish = ") wm DIGITAL MORTGAGE SOLUTIONS . RK) iy * . Re 3 . 4 ~Th [] \" EN SL N a f= Ne L 4 !";
	const res = shouldRunOcr({
		contentType: "pdf",
		attempt: 1,
		fullText: gibberish.repeat(200),
		fullTextAbsentReason: null,
		textProbe: { decision: "text_ok_skip_ocr", needsOcr: false },
		pageOcr: { attempted: true },
		priorNeedsOcrFlowState: null,
		env: { PDF_MIN_TEXT_THRESHOLD_CHARS: "800" } as any,
	});
	expect(res.run).toBe(true);
	expect(res.reason).toBe("needs_ocr_low_quality_text");
});
