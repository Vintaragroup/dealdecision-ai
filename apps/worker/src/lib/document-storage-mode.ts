export type DocumentStorageMode = "local" | "r2";

function normalizeMode(raw: unknown): string {
	return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

/**
 * Controls where derived artifacts (like rendered page images) are expected to live.
 *
 * - Production typically uses R2 (`R2_BUCKET` set).
 * - Local/dev should default to local filesystem (shared docker volume at `UPLOAD_DIR`).
 *
 * Override with `DOCUMENT_STORAGE_MODE=local|r2`.
 */
export function getDocumentStorageMode(env: NodeJS.ProcessEnv = process.env): DocumentStorageMode {
	const explicit = normalizeMode(env.DOCUMENT_STORAGE_MODE || env.DOCUMENT_STORAGE);
	if (explicit === "local") return "local";
	if (explicit === "r2") return "r2";

	const bucket = typeof env.R2_BUCKET === "string" ? env.R2_BUCKET.trim() : "";
	return bucket ? "r2" : "local";
}

export function getR2BucketIfEnabled(env: NodeJS.ProcessEnv = process.env): string | null {
	if (getDocumentStorageMode(env) !== "r2") return null;
	const bucket = typeof env.R2_BUCKET === "string" ? env.R2_BUCKET.trim() : "";
	return bucket ? bucket : null;
}
