export type IngestDocumentsMode = "upload" | "from_storage";

export type IngestDocumentsJobInput = {
	documentId: string | null;
	dealId: string | null;
	fileName: string | null;
	fileBufferB64: string | null;
	mode: IngestDocumentsMode;
	attempt: number;
};

function asNonEmptyString(value: unknown): string | null {
	return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asNumber(value: unknown, fallback: number): number {
	const n = Number(value);
	return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function parseIngestDocumentsJobData(data: unknown): IngestDocumentsJobInput {
	const d = (data ?? {}) as Record<string, unknown>;

	const documentId = asNonEmptyString(d.documentId) ?? asNonEmptyString(d.document_id);
	const dealId = asNonEmptyString(d.dealId) ?? asNonEmptyString(d.deal_id);
	const fileName = asNonEmptyString(d.fileName) ?? asNonEmptyString(d.file_name);
	const fileBufferB64 = asNonEmptyString(d.fileBufferB64) ?? asNonEmptyString(d.file_buffer);
	const rawMode = asNonEmptyString(d.mode);
	const mode: IngestDocumentsMode = rawMode === "from_storage" ? "from_storage" : "upload";
	const attempt = asNumber(d.attempt, 1);

	return {
		documentId,
		dealId,
		fileName,
		fileBufferB64,
		mode,
		attempt,
	};
}

export function validateIngestDocumentsPayload(input: IngestDocumentsJobInput): {
	ok: boolean;
	missing: string[];
	errorMessage: string | null;
} {
	const missing: string[] = [];
	if (!input.documentId) missing.push("documentId");
	if (!input.dealId) missing.push("dealId");

	if (input.mode !== "from_storage") {
		if (!input.fileName) missing.push("fileName");
		if (!input.fileBufferB64) missing.push("fileBufferB64");
	}

	if (missing.length > 0) {
		return {
			ok: false,
			missing,
			errorMessage: `Missing required fields: ${missing.join(", ")}`,
		};
	}

	return { ok: true, missing: [], errorMessage: null };
}
