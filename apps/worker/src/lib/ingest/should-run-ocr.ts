export type PdfTextProbeDecision = "text_ok_skip_ocr" | "text_sparse_needs_ocr";

export type ShouldRunOcrInput = {
	contentType: string;
	attempt: number;
	forceOcr?: boolean;
	fullText: string | null;
	fullTextAbsentReason: string | null;
	textProbe?: {
		decision?: PdfTextProbeDecision | string;
		needsOcr?: boolean;
		min_text_threshold_chars?: number;
		pages_with_text?: number;
		pages_probed?: number;
		char_count?: number;
		word_count?: number;
	} | null;
	pageOcr?: {
		attempted?: boolean;
		pages_attempted?: number;
		failed_pages?: unknown;
		errors?: unknown;
	} | null;
	priorNeedsOcrFlowState?: string | null;
	env?: NodeJS.ProcessEnv;
};

export type OcrDecisionReason =
	| "forced"
	| "not_pdf"
	| "env_disabled"
	| "already_completed"
	| "already_enqueued"
	| "probe_says_ok"
	| "needs_ocr_by_probe"
	| "needs_ocr_by_absent_reason"
	| "needs_ocr_by_empty_full_text"
	| "needs_ocr_low_quality_text";

export type ShouldRunOcrResult = {
	run: boolean;
	reason: OcrDecisionReason;
	minTextThresholdChars: number;
	quality?: {
		letters: number;
		digits: number;
		other: number;
		otherRatio: number;
		alphaRatio: number;
		wordishCount: number;
		shortWordishCount: number;
	};
};

function isTruthyFlag(value: string | undefined | null): boolean {
	if (!value) return false;
	return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function computeTextQuality(fullText: string): {
	letters: number;
	digits: number;
	other: number;
	otherRatio: number;
	alphaRatio: number;
	wordishCount: number;
	shortWordishCount: number;
} {
	const s = fullText;
	const noSpace = s.replace(/\s/g, "");
	const letters = (noSpace.match(/[A-Za-z]/g) ?? []).length;
	const digits = (noSpace.match(/[0-9]/g) ?? []).length;
	const other = Math.max(0, noSpace.length - letters - digits);
	const otherRatio = other / Math.max(1, noSpace.length);
	const alphaRatio = letters / Math.max(1, noSpace.length);
	const wordishCount = (s.match(/\b[A-Za-z]{2,}\b/g) ?? []).length;
	const shortWordishCount = (s.match(/\b[A-Za-z]{1,2}\b/g) ?? []).length;
	return { letters, digits, other, otherRatio, alphaRatio, wordishCount, shortWordishCount };
}

export function shouldRunOcr(input: ShouldRunOcrInput): ShouldRunOcrResult {
	const env = input.env ?? process.env;
	if (isTruthyFlag(env.DISABLE_OCR_LAST_RESORT)) {
		return { run: false, reason: "env_disabled", minTextThresholdChars: 800 };
	}

	const contentType = String(input.contentType ?? "").toLowerCase();
	const isPdf = contentType === "pdf" || contentType === "application/pdf" || contentType.endsWith("/pdf");
	if (!isPdf) return { run: false, reason: "not_pdf", minTextThresholdChars: 800 };

	if (input.forceOcr) {
		return { run: true, reason: "forced", minTextThresholdChars: 800 };
	}

	const prior = typeof input.priorNeedsOcrFlowState === "string" ? input.priorNeedsOcrFlowState.trim().toLowerCase() : "";
	if (prior === "completed" || prior === "reextract_enqueued") {
		return { run: false, reason: "already_completed", minTextThresholdChars: 800 };
	}
	if (prior === "enqueued" || prior === "requested") {
		return { run: false, reason: "already_enqueued", minTextThresholdChars: 800 };
	}

	const minTextThresholdCharsRaw = Number(env.PDF_MIN_TEXT_THRESHOLD_CHARS ?? env.PDF_MIN_TEXT_THRESHOLD ?? 800);
	const minTextThresholdChars = Number.isFinite(minTextThresholdCharsRaw) ? Math.max(0, Math.floor(minTextThresholdCharsRaw)) : 800;

	const fullText = typeof input.fullText === "string" ? input.fullText : "";
	const fullTextLen = fullText.trim().length;
	const absentReason = typeof input.fullTextAbsentReason === "string" ? input.fullTextAbsentReason.trim() : "";

	const probeDecision = typeof input.textProbe?.decision === "string" ? input.textProbe.decision : "";
	const probeNeeds = typeof input.textProbe?.needsOcr === "boolean" ? input.textProbe.needsOcr : null;

	if (probeDecision === "text_sparse_needs_ocr" || probeNeeds === true) {
		return { run: true, reason: "needs_ocr_by_probe", minTextThresholdChars };
	}

	if (absentReason) {
		return { run: true, reason: "needs_ocr_by_absent_reason", minTextThresholdChars };
	}

	if (fullTextLen === 0) {
		return { run: true, reason: "needs_ocr_by_empty_full_text", minTextThresholdChars };
	}

	// If the extractor/OCR already produced some text above the threshold, still allow a vision OCR fallback
	// when the text appears to be mostly garbage (common for low-quality internal OCR output).
	if (fullTextLen >= minTextThresholdChars) {
		const q = computeTextQuality(fullText);
		const lowAlpha = q.alphaRatio < 0.18;
		const lowWords = q.wordishCount < 40;
		const highOther = q.otherRatio > 0.38;
		const shortRatio = q.wordishCount > 0 ? q.shortWordishCount / q.wordishCount : 0;
		const mostlyShortWords = shortRatio > 0.55;
		const extremeShortWords = shortRatio > 0.8;
		const moderateOther = q.otherRatio > 0.15;
		const notMostlyLetters = q.alphaRatio < 0.88;

		if ((lowAlpha && lowWords) || (highOther && mostlyShortWords) || (extremeShortWords && moderateOther && notMostlyLetters)) {
			return { run: true, reason: "needs_ocr_low_quality_text", minTextThresholdChars, quality: q };
		}
	}

	return { run: false, reason: "probe_says_ok", minTextThresholdChars };
}
