import type { Pool } from "pg";
import { sanitizeText } from "@dealdecision/core";
import { downloadFromR2 } from "../r2";

type LogLike = Pick<Console, "log" | "warn">;

export async function loadOriginalBytesFromDocumentStorage(params: {
	pool: Pool;
	documentId: string;
	logger?: LogLike;
	env?: NodeJS.ProcessEnv;
}): Promise<{ bytes: Buffer; bucket: string; key: string; mime_type: string | null } | null> {
	const logger = params.logger ?? console;
	try {
		const { rows } = await params.pool.query<{
			storage_bucket: string | null;
			storage_key: string | null;
			mime_type: string | null;
		}>(
			"SELECT storage_bucket, storage_key, mime_type FROM documents WHERE id = $1 LIMIT 1",
			[sanitizeText(params.documentId)]
		);
		const row = rows?.[0];
		const bucket = typeof row?.storage_bucket === "string" ? row.storage_bucket.trim() : "";
		const key = typeof row?.storage_key === "string" ? row.storage_key.trim() : "";
		const mime_type = typeof row?.mime_type === "string" ? row.mime_type : null;
		if (!key) return null;

		const bytes = await downloadFromR2({ bucket: bucket || null, key, env: params.env });
		if (!bytes || bytes.length === 0) {
			logger.warn(
				JSON.stringify({
					event: "INGEST_R2_DOWNLOAD_EMPTY",
					document_id: params.documentId,
					bucket: bucket || null,
					key,
				})
			);
			return null;
		}

		logger.log(
			JSON.stringify({
				event: "INGEST_R2_FALLBACK_USED",
				document_id: params.documentId,
				bucket: bucket || null,
				key,
				bytes: bytes.length,
			})
		);
		return { bytes, bucket, key, mime_type };
	} catch (err) {
		logger.warn(
			`[ingest_document] r2 fallback lookup/download failed doc=${params.documentId}: ${
				err instanceof Error ? err.message : String(err)
			}`
		);
		return null;
	}
}
