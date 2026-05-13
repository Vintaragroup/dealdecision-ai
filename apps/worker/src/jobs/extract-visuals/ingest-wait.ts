/**
 * ingest-wait.ts
 *
 * Extracted polling loop from runExtractVisualsCoordinator.
 * Waits for all blocked documents to become ingest-ready before extraction proceeds.
 *
 * Contract: behavior-preserving extraction only — no logic changes from coordinator.ts.
 */
import type { Job } from "bullmq";
import { updateJob, makeDevLogger } from "../../lib/worker-utils";
import { emitJobProgress } from "../../lib/job-progress";
import { evaluateVisualDocReadiness, getVisualIngestBlockReason } from "../../lib/visual-readiness";

const devLog = makeDevLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export type BlockedDocEntry = {
	document_id: string;
	title: string | null;
	deleted_at: string | null;
	type: string | null;
	status: string | null;
	documents_meta_status: string | null;
	extraction_metadata_status: string | null;
	derived_ingest_complete: boolean;
	block_reason: "deleted" | "status_not_ready" | "meta_status_missing" | "meta_status_not_succeeded";
	page_count: number | null;
	has_extraction_metadata: boolean;
	has_original_bytes: boolean;
	has_rendered_pages: boolean;
	reason?: string | null;
};

export type IngestWaitOutcome =
	| { timedOut: true; result: { ok: false; [key: string]: unknown } }
	| {
			timedOut: false;
			readyDocumentIds: string[];
			docsReady: number;
			docsBlocked: number;
			docsBlockedPending: number;
	  };

// ── Helper ────────────────────────────────────────────────────────────────────

/**
 * Poll until at least one document becomes ready for visual extraction, or time out.
 *
 * Only called when `docsReady === 0` (all candidate docs are currently blocked).
 *
 * Returns `{ timedOut: true, result }` if the wait expires with no ready docs.
 * Returns `{ timedOut: false, readyDocumentIds, docsReady, docsBlocked, docsBlockedPending }`
 * when at least one doc becomes ready — caller is responsible for updating its own
 * local state and `targetDocumentIds`.
 */
export async function waitForIngest(params: {
	pool: { query: (sql: string, args: unknown[]) => Promise<{ rows: any[] }> };
	job: Job;
	candidateDocumentIds: string[];
	initialBlockedDocs: BlockedDocEntry[];
	initialBlockedReasonsCount: Record<string, number>;
	docsTotal: number;
	dealId: string | null | undefined;
	documentsMetaStatusOk: boolean;
	originalFileTablesOk: boolean;
}): Promise<IngestWaitOutcome> {
	const {
		pool,
		job,
		candidateDocumentIds,
		initialBlockedDocs,
		initialBlockedReasonsCount,
		docsTotal,
		dealId,
		documentsMetaStatusOk,
		originalFileTablesOk,
	} = params;

	const maxWaitMsRaw = Number(process.env.EXTRACT_VISUALS_WAIT_INGEST_MAX_MS);
	const pollMsRaw = Number(process.env.EXTRACT_VISUALS_WAIT_INGEST_POLL_MS);
	const maxWaitMs = Number.isFinite(maxWaitMsRaw) ? Math.max(0, Math.floor(maxWaitMsRaw)) : 120_000;
	const pollMs = Number.isFinite(pollMsRaw) ? Math.max(250, Math.floor(pollMsRaw)) : 5_000;
	const waitStart = Date.now();
	let attempts = 0;

	const maxDebugDocs = 50;
	let blockedDocsDebug = initialBlockedDocs.slice(0, maxDebugDocs);
	let docsTruncated = initialBlockedDocs.length > maxDebugDocs;
	let blockedDocumentIds = initialBlockedDocs.map((d) => d.document_id);
	let blockedDocumentIdsTruncated = blockedDocumentIds.slice(0, maxDebugDocs);
	let blockedReasonsCount = initialBlockedReasonsCount;
	let readyDocumentIds: string[] = [];
	let docsReady = 0;
	let docsBlocked = initialBlockedDocs.length;
	let docsBlockedPending = docsBlocked;

	const recomputeReadiness = async (): Promise<{
		ready_ids: string[];
		blocked_docs: BlockedDocEntry[];
		blocked_reasons_count: Record<string, number>;
	}> => {
		const nextBlockedDocs: BlockedDocEntry[] = [];
		const nextReasons: Record<string, number> = {};
		try {
			const { rows: metaRows } = await pool.query(
				documentsMetaStatusOk
					? "SELECT id, title, type, status, meta_status, extraction_metadata, deleted_at FROM documents WHERE id = ANY($1)"
					: "SELECT id, title, type, status, NULL::text AS meta_status, extraction_metadata, deleted_at FROM documents WHERE id = ANY($1)",
				[candidateDocumentIds]
			);
			const metaMap = new Map<string, any>();
			for (const row of metaRows ?? []) metaMap.set(row.id, row);
			for (const docId of candidateDocumentIds) {
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
				const metaStatus = documentsMetaStatus ?? extractionMetadataStatus;
				const readiness = evaluateVisualDocReadiness({ id: docId, status, deletedAt, metaStatus });
				if (readiness.blocked) {
					const blockReason = getVisualIngestBlockReason({ status, deletedAt, metaStatus });
					const derivedIngestComplete = blockReason == null;
					const br = (blockReason ?? "meta_status_missing") as
						| "deleted"
						| "status_not_ready"
						| "meta_status_missing"
						| "meta_status_not_succeeded";
					nextReasons[br] = (nextReasons[br] ?? 0) + 1;
					nextBlockedDocs.push({
						document_id: docId,
						title: typeof meta.title === "string" ? meta.title : null,
						deleted_at: deletedAt,
						type: typeof meta.type === "string" ? meta.type : null,
						status,
						documents_meta_status: documentsMetaStatus,
						extraction_metadata_status: extractionMetadataStatus,
						derived_ingest_complete: derivedIngestComplete,
						block_reason: br,
						page_count: null,
						has_extraction_metadata: meta.extraction_metadata != null,
						has_original_bytes: false,
						has_rendered_pages: false,
						reason: readiness.reason,
					});
				}
			}
		} catch (err) {
			console.warn(
				`[extract_visuals] ingest-wait readiness recompute failed: ${err instanceof Error ? err.message : String(err)}`
			);
		}
		const blockedIds = new Set(nextBlockedDocs.map((d) => d.document_id));
		const readyIds = candidateDocumentIds.filter((id) => !blockedIds.has(id));
		return { ready_ids: readyIds, blocked_docs: nextBlockedDocs, blocked_reasons_count: nextReasons };
	};

	await updateJob(job, "running", `Waiting for ingest to complete (docs_blocked=${docsBlocked}/${docsTotal})`, 2);
	await emitJobProgress(job, {
		job_id: job.id ? String(job.id) : "",
		deal_id: dealId ?? undefined,
		stage: "blocked",
		percent: 2,
		message: `Waiting for ingest to complete (docs_blocked=${docsBlocked}/${docsTotal})`,
		reason: "INGEST_NOT_COMPLETE",
		meta: {
			docs_total: docsTotal,
			docs_ready: 0,
			docs_blocked: docsBlocked,
			blocked_document_ids: blockedDocumentIdsTruncated,
			blocked_document_ids_total: blockedDocumentIds.length,
			blocked_reasons_count: blockedReasonsCount,
			wait_max_ms: maxWaitMs,
			wait_poll_ms: pollMs,
		},
	});

	while (docsReady === 0 && Date.now() - waitStart < maxWaitMs) {
		attempts += 1;
		await new Promise<void>((resolve) => setTimeout(resolve, pollMs));
		const snap = await recomputeReadiness();
		readyDocumentIds = snap.ready_ids;
		docsReady = readyDocumentIds.length;
		blockedDocsDebug = snap.blocked_docs.slice(0, maxDebugDocs);
		docsTruncated = snap.blocked_docs.length > maxDebugDocs;
		blockedDocumentIds = snap.blocked_docs.map((d) => d.document_id);
		blockedDocumentIdsTruncated = blockedDocumentIds.slice(0, maxDebugDocs);
		blockedReasonsCount = snap.blocked_reasons_count;
		docsBlocked = snap.blocked_docs.length;
		docsBlockedPending = docsBlocked;

		if (docsReady > 0) {
			break;
		}

		const waitedMs = Date.now() - waitStart;
		await updateJob(
			job,
			"running",
			`Waiting for ingest to complete (attempt=${attempts}, waited=${Math.round(waitedMs / 1000)}s)`,
			2
		);
		await emitJobProgress(job, {
			job_id: job.id ? String(job.id) : "",
			deal_id: dealId ?? undefined,
			stage: "blocked",
			percent: 2,
			message: `Waiting for ingest to complete (attempt=${attempts}, waited=${Math.round(waitedMs / 1000)}s)`,
			reason: "INGEST_NOT_COMPLETE",
			meta: {
				docs_total: docsTotal,
				docs_ready: 0,
				docs_blocked: docsBlocked,
				blocked_document_ids: blockedDocumentIdsTruncated,
				blocked_document_ids_total: blockedDocumentIds.length,
				docs_truncated: docsTruncated,
				blocked_reasons_count: blockedReasonsCount,
				waited_ms: waitedMs,
				attempts,
			},
		});
	}

	if (docsReady === 0) {
		const waitedMs = Date.now() - waitStart;
		const guardPayload = {
			reason: "INGEST_NOT_COMPLETE",
			blocked_docs: blockedDocsDebug,
			blocked_document_ids: blockedDocumentIdsTruncated,
			blocked_document_ids_total: blockedDocumentIds.length,
			docs_total: docsTotal,
			docs_ready: docsReady,
			docs_blocked: docsBlocked,
			docs_truncated: docsTruncated,
			blocked_reasons_count: blockedReasonsCount,
			suggested_action:
				"wait for ingest_documents to complete (or run reconcile-ingest), then re-run extract_visuals",
			diagnostics: {
				docs_total: docsTotal,
				docs_blocked_pending: docsBlockedPending,
				document_file_tables_present: originalFileTablesOk,
				waited_ms: waitedMs,
				wait_max_ms: maxWaitMs,
				wait_poll_ms: pollMs,
			},
		};
		await updateJob(
			job,
			"failed",
			`Visual extraction blocked: ingest not complete after ${Math.round(waitedMs / 1000)}s (docs_blocked=${docsBlocked})`,
			100
		);
		devLog("worker_extract_visuals_finish", {
			job_id: job.id ? String(job.id) : null,
			deal_id: dealId ?? null,
			docs_total: docsTotal,
			docs_blocked_pending: docsBlockedPending,
			guard_triggered: true,
			guard_waited_ms: waitedMs,
			guard_wait_max_ms: maxWaitMs,
			guard_poll_ms: pollMs,
		});
		return { timedOut: true, result: { ok: false, ...guardPayload } };
	}

	// Ready docs became available; proceed.
	await updateJob(
		job,
		"running",
		`Ingest complete for some docs; proceeding (ready=${docsReady}/${docsTotal})`,
		5
	);
	await emitJobProgress(job, {
		job_id: job.id ? String(job.id) : "",
		deal_id: dealId ?? undefined,
		stage: "blocked",
		percent: 5,
		message: `Ingest complete for some docs; proceeding (ready=${docsReady}/${docsTotal})`,
		reason: "INGEST_NOT_COMPLETE",
		meta: {
			docs_total: docsTotal,
			docs_ready: docsReady,
			docs_blocked: docsBlocked,
			blocked_document_ids: blockedDocumentIdsTruncated,
			blocked_document_ids_total: blockedDocumentIds.length,
			docs_truncated: docsTruncated,
			blocked_reasons_count: blockedReasonsCount,
		},
	});

	return {
		timedOut: false,
		readyDocumentIds,
		docsReady,
		docsBlocked,
		docsBlockedPending,
	};
}
