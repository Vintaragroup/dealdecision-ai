/**
 * readiness.ts
 *
 * Extracted document readiness evaluation loop from runExtractVisualsCoordinator.
 * Iterates target document IDs, queries DB metadata, evaluates ingest readiness,
 * and returns ready/blocked partition with counts.
 *
 * Contract: behavior-preserving extraction only — no logic changes from coordinator.ts.
 */
import { resolvePageImageUris } from "../../lib/visual-extraction";
import { getDocumentOriginalFile } from "../../lib/db";
import { evaluateVisualDocReadiness, getVisualIngestBlockReason } from "../../lib/visual-readiness";
import { makeDevLogger } from "../../lib/worker-utils";
import type { BlockedDocEntry } from "./ingest-wait";

const devLog = makeDevLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export type ReadinessResult = {
	readyDocumentIds: string[];
	blockedDocs: BlockedDocEntry[];
	blockedReasonsCount: Record<string, number>;
	docsReady: number;
	docsBlocked: number;
	docsBlockedPending: number;
};

// ── Helper ────────────────────────────────────────────────────────────────────

/**
 * Evaluate readiness of each target document for visual extraction.
 *
 * Queries documents table for metadata, checks ingest readiness via
 * evaluateVisualDocReadiness, and partitions documents into ready and blocked.
 *
 * The `allowRenderedPagesFallback` flag permits bypassing the ingest guard
 * when rendered pages already exist locally (non-production dev path).
 */
export async function evaluateTargetDocumentReadiness(params: {
	pool: { query: (sql: string, args: unknown[]) => Promise<{ rows: any[] }> };
	targetDocumentIds: string[];
	documentsMetaStatusOk: boolean;
	originalFileTablesOk: boolean;
	allowRenderedPagesFallback: boolean;
	jobId: string | null;
	dealId: string | null | undefined;
}): Promise<ReadinessResult> {
	const {
		pool,
		targetDocumentIds,
		documentsMetaStatusOk,
		originalFileTablesOk,
		allowRenderedPagesFallback,
		jobId,
		dealId,
	} = params;

	const blockedDocs: BlockedDocEntry[] = [];
	const blockedReasonsCount: Record<string, number> = {};

	try {
		const { rows: metaRows } = await pool.query(
			documentsMetaStatusOk
				? "SELECT id, deal_id, title, type, status, meta_status, page_count, extraction_metadata, deleted_at FROM documents WHERE id = ANY($1)"
				: "SELECT id, deal_id, title, type, status, NULL::text AS meta_status, page_count, extraction_metadata, deleted_at FROM documents WHERE id = ANY($1)",
			[targetDocumentIds]
		);
		const metaMap = new Map<string, any>();
		for (const row of metaRows ?? []) metaMap.set(row.id, row);

		for (const docId of targetDocumentIds) {
			const meta = metaMap.get(docId) ?? {};
			const status = typeof meta.status === "string" ? meta.status : null;
			const deletedAt = meta.deleted_at != null ? String(meta.deleted_at) : null;
			const extractionMetadataStatus = (() => {
				const em = meta.extraction_metadata;
				if (!em || typeof em !== "object") return null;
				const raw = (em as any).status;
				return typeof raw === "string" ? raw : null;
			})();
			const documentsMetaStatus = (() => {
				const raw = (meta as any).meta_status;
				return typeof raw === "string" ? raw : null;
			})();
			// Source of truth: documents.meta_status; fallback: extraction_metadata.status
			const metaStatus = documentsMetaStatus ?? extractionMetadataStatus;

			const pageCountRaw = meta.page_count;
			const pageCount = typeof pageCountRaw === "number" && Number.isFinite(pageCountRaw) ? pageCountRaw : null;
			let hasRenderedPages = false;
			try {
				const previewUris = await resolvePageImageUris(pool, docId, { env: process.env, logger: console });
				hasRenderedPages = Array.isArray(previewUris) && previewUris.length > 0;
			} catch (err) {
				console.warn(
					`[extract_visuals] preview resolve failed doc=${docId}: ${err instanceof Error ? err.message : String(err)}`
				);
			}

			let hasOriginalBytes = false;
			if (originalFileTablesOk) {
				try {
					const original = await getDocumentOriginalFile(docId);
					hasOriginalBytes = !!(original?.bytes && original.bytes.length > 0);
				} catch {
					hasOriginalBytes = false;
				}
			}

			const readiness = evaluateVisualDocReadiness({
				id: docId,
				status,
				deletedAt,
				metaStatus,
			});
			const bypassIngestGuard =
				allowRenderedPagesFallback &&
				readiness.blocked &&
				readiness.reason === "ingest_not_complete" &&
				hasRenderedPages &&
				deletedAt == null;
			if (readiness.blocked && !bypassIngestGuard) {
				const blockReason = getVisualIngestBlockReason({
					status,
					deletedAt,
					metaStatus,
				});
				const derivedIngestComplete = blockReason == null;
				const br = (blockReason ?? "meta_status_missing") as
					| "deleted"
					| "status_not_ready"
					| "meta_status_missing"
					| "meta_status_not_succeeded";
				blockedReasonsCount[br] = (blockedReasonsCount[br] ?? 0) + 1;

				blockedDocs.push({
					document_id: docId,
					title: typeof meta.title === "string" ? meta.title : null,
					deleted_at: deletedAt,
					type: typeof meta.type === "string" ? meta.type : null,
					status,
					documents_meta_status: documentsMetaStatus,
					extraction_metadata_status: extractionMetadataStatus,
					derived_ingest_complete: derivedIngestComplete,
					block_reason: br,
					page_count: pageCount,
					has_extraction_metadata: meta.extraction_metadata != null,
					has_original_bytes: hasOriginalBytes,
					has_rendered_pages: hasRenderedPages,
					reason: readiness.reason,
				});
			} else if (bypassIngestGuard) {
				devLog("worker_extract_visuals_ingest_guard_bypassed", {
					job_id: jobId,
					deal_id: dealId ?? null,
					document_id: docId,
					reason: "rendered_pages_present",
					status,
					meta_status: metaStatus,
					allow_rendered_pages_fallback: true,
				});
			}
		}
	} catch (err) {
		console.warn(
			`[extract_visuals] guard precheck failed: ${err instanceof Error ? err.message : String(err)}`
		);
	}

	const blockedDocIds = new Set(blockedDocs.map((d) => d.document_id));
	const readyDocumentIds = targetDocumentIds.filter((id) => !blockedDocIds.has(id));
	const docsReady = readyDocumentIds.length;
	const docsBlocked = blockedDocs.length;

	return {
		readyDocumentIds,
		blockedDocs,
		blockedReasonsCount,
		docsReady,
		docsBlocked,
		docsBlockedPending: docsBlocked, // mirrors original: docsBlockedPending = docsBlocked
	};
}
