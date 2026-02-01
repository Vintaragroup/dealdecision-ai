export function isOcrishError(err: unknown): boolean {
	const msg =
		err instanceof Error
			? err.message
			: typeof err === "string"
				? err
				: err && typeof err === "object" && "message" in err && typeof (err as any).message === "string"
					? String((err as any).message)
					: String(err ?? "");
	const lower = msg.toLowerCase();

	// Fast path: explicit OCR signals
	if (lower.includes("tesseract")) return true;
	if (lower.includes("vision_ocr")) return true;
	if (lower.includes("ocr_v2")) return true;
	if (lower.includes("worker.ocr")) return true;

	// Common phrases
	if (/^ocr\s*page\s*\d+\b/.test(lower)) return true;
	if (lower.includes("ocr timed out")) return true;
	if (lower.includes("timed out") && lower.includes("ocr")) return true;

	// Generic OCR mention (kept late to reduce false positives)
	if (lower.includes("ocr")) return true;

	return false;
}

export type OcrishNonFatalWarning = {
	stage: "ingest_ocrish_error";
	errorMessage: string;
	at: string;
	needsOcr: boolean;
};

export type IngestErrorOutcome =
	| {
		kind: "succeeded_with_warnings";
		extractionMetadataPatch: Record<string, unknown>;
	}
	| {
		kind: "failed";
		extractionMetadataPatch: Record<string, unknown>;
		documentStatus: "failed";
		jobMessage: string;
	};

export function decideIngestOutcomeForError(params: {
	err: unknown;
	needsOcr: boolean;
	existingTextLen: number;
	minTextThresholdChars: number;
	nowIso: string;
}): IngestErrorOutcome {
	const message = params.err instanceof Error ? params.err.message : typeof params.err === "string" ? params.err : String(params.err ?? "Unknown error");
	const ocrish = isOcrishError(params.err);

	const sufficientText = params.existingTextLen >= Math.max(1, params.minTextThresholdChars);

	if (ocrish) {
		// needsOcr=false: never fail due to OCR-ish errors.
		// needsOcr=true: only fail if we still don't have enough text.
		if (!params.needsOcr || sufficientText) {
			const warning: OcrishNonFatalWarning = {
				stage: "ingest_ocrish_error",
				errorMessage: message,
				at: params.nowIso,
				needsOcr: params.needsOcr,
			};
			return {
				kind: "succeeded_with_warnings",
				extractionMetadataPatch: {
					status: "succeeded_with_warnings",
					errorMessage: null,
					lastWarningAt: params.nowIso,
					warnings: [warning],
				},
			};
		}
	}

	return {
		kind: "failed",
		documentStatus: "failed",
		jobMessage: `Document extraction failed: ${message}`,
		extractionMetadataPatch: {
			status: "failed",
			errorMessage: message,
			failedAt: params.nowIso,
		},
	};
}
