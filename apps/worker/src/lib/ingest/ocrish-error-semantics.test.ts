import { describe, expect, it } from "vitest";
import { decideIngestOutcomeForError, isOcrishError } from "./ocrish-error-semantics";

describe("isOcrishError", () => {
	it("detects common OCR timeout patterns", () => {
		expect(isOcrishError(new Error("OCR page 3 timed out after 120000ms"))).toBe(true);
		expect(isOcrishError(new Error("tesseract.js worker crashed"))).toBe(true);
		expect(isOcrishError(new Error("vision_ocr: request failed"))).toBe(true);
	});

	it("does not mark unrelated errors as OCR-ish", () => {
		expect(isOcrishError(new Error("database connection refused"))).toBe(false);
		expect(isOcrishError(new Error("invalid pdf header"))).toBe(false);
	});
});

describe("decideIngestOutcomeForError", () => {
	it("needsOcr=false + OCR-ish error => succeeded_with_warnings (no top-level errorMessage)", () => {
		const out = decideIngestOutcomeForError({
			err: new Error("OCR page 1 timed out after 120000ms"),
			needsOcr: false,
			existingTextLen: 5000,
			minTextThresholdChars: 800,
			nowIso: "2026-01-27T00:00:00.000Z",
		});

		expect(out.kind).toBe("succeeded_with_warnings");
		if (out.kind !== "succeeded_with_warnings") throw new Error("unexpected");
		expect(out.extractionMetadataPatch.status).toBe("succeeded_with_warnings");
		expect(out.extractionMetadataPatch.errorMessage).toBeNull();
		const warnings = (out.extractionMetadataPatch as any).warnings;
		expect(Array.isArray(warnings)).toBe(true);
		expect(warnings[0]).toMatchObject({
			stage: "ingest_ocrish_error",
			needsOcr: false,
		});
	});

	it("needsOcr=true + OCR fails + no text => failed", () => {
		const out = decideIngestOutcomeForError({
			err: new Error("tesseract: worker crash"),
			needsOcr: true,
			existingTextLen: 0,
			minTextThresholdChars: 800,
			nowIso: "2026-01-27T00:00:00.000Z",
		});

		expect(out.kind).toBe("failed");
		if (out.kind !== "failed") throw new Error("unexpected");
		expect(out.documentStatus).toBe("failed");
		expect(out.extractionMetadataPatch.status).toBe("failed");
	});
});
