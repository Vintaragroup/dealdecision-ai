/**
 * Resolve a download URL for a document's original file from its extraction_metadata.
 *
 * Extracted from index.ts so extract_visuals and other processors can import
 * without depending on the monolithic index module.
 */

import { getR2ObjectUrl } from "./r2";

/**
 * Scan a document's extraction_metadata object for any URL that can be used
 * to fetch the original file bytes.
 *
 * Returns null when no suitable URL is found. When only an R2 key is present,
 * mints a signed URL on demand via {@link getR2ObjectUrl}.
 */
export async function pickDownloadUrlFromExtractionMetadata(
	meta: unknown
): Promise<string | null> {
	if (!meta || typeof meta !== "object") return null;
	const m = meta as any;
	const candidates: unknown[] = [
		m?.upload?.signed_url,
		m?.upload?.signedUrl,
		m?.upload?.download_url,
		m?.upload?.downloadUrl,
		m?.upload?.url,
		m?.upload?.file_url,
		m?.upload?.fileUrl,
		m?.original_url,
		m?.originalUrl,
		m?.source_url,
		m?.sourceUrl,
		m?.r2_signed_url,
		m?.r2_url,
		m?.r2?.signed_url,
		m?.r2?.url,
		m?.storage?.signed_url,
		m?.storage?.url,
	];
	for (const c of candidates) {
		if (typeof c !== "string") continue;
		const s = c.trim();
		if (s.startsWith("http://") || s.startsWith("https://")) return s;
	}

	// Stable R2 reference case: mint a signed URL on demand.
	try {
		const bucket =
			typeof m?.upload?.bucket === "string" ? m.upload.bucket.trim() : "";
		const key = typeof m?.upload?.key === "string" ? m.upload.key.trim() : "";
		if (key) {
			return await getR2ObjectUrl({
				bucket: bucket || null,
				key,
				env: process.env,
			});
		}
	} catch {
		// ignore
	}
	return null;
}
