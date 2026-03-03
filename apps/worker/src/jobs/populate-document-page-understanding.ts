import type { Job } from "bullmq";
import { sanitizeText } from "@dealdecision/core";

import { getPool } from "../lib/db";
import { updateJobProgress } from "../lib/job-progress";
import { enqueuePersistedJob } from "../lib/job-enqueue";
import { makeJobId } from "../lib/job-id";
import { populateDocumentPageUnderstandingFromVisualExtractions } from "../lib/document-page-understanding";
import { promoteSlideFactsFromDocumentPageUnderstanding } from "../lib/promote-slide-facts";
import { populatePageRegistryV1 } from "../lib/page-registry/populate-page-registry-v1";
import { populateDealFactRegistryV1 } from "../lib/deal-facts/populate-deal-fact-registry-v1";
import { populateFinancialFactRegistryV1 } from "../lib/financial-facts/populate-financial-fact-registry-v1";

function parseFiniteInt(value: unknown): number | null {
	const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
	if (!Number.isFinite(n)) return null;
	return Math.floor(n);
}

async function updateJob(job: Job, status: "running" | "failed" | "succeeded", message?: string, progressPct?: number | null) {
	await updateJobProgress(job, {
		status: status as any,
		stage: "status_update",
		current: typeof progressPct === "number" ? progressPct : undefined,
		total: typeof progressPct === "number" ? 100 : undefined,
		message,
		error: status === "failed" ? message ?? "failed" : undefined,
	});
}

async function countVisualAssetsForRange(pool: ReturnType<typeof getPool>, args: { documentId: string; pageStart: number; pageEnd: number }) {
	try {
		const { rows } = await pool.query<{ c: number }>(
			`SELECT COUNT(*)::int AS c
			   FROM visual_assets
			  WHERE document_id = $1
			    AND page_index >= $2
			    AND page_index < $3`,
			[sanitizeText(args.documentId), args.pageStart, args.pageEnd]
		);
		return typeof rows?.[0]?.c === "number" ? rows[0].c : 0;
	} catch {
		return 0;
	}
}

const RETRY_DELAYS_MS = [5000, 15000, 30000] as const;
const MAX_RETRY_ATTEMPTS = RETRY_DELAYS_MS.length;

export async function populateDocumentPageUnderstandingProcessor(job: Job) {
	const data = (job.data ?? {}) as any;

	const dealId = typeof data.deal_id === "string" ? data.deal_id.trim() : "";
	const docId = typeof data.document_id === "string" ? data.document_id.trim() : "";
	const versionRaw =
		typeof data.page_understanding_version === "string"
			? String(data.page_understanding_version)
			: typeof data.version === "string"
				? String(data.version)
				: "page_understanding_v1";
	const version = versionRaw.trim() || "page_understanding_v1";
	const forceRefresh = Boolean(data.force_refresh ?? data?.payload?.force_refresh);

	const retryAttemptRaw = parseFiniteInt(data.dpu_retry_attempt);
	const retryAttempt = retryAttemptRaw != null ? Math.max(0, retryAttemptRaw) : 0;

	const pageStartRaw = parseFiniteInt(data.page_start ?? data?.payload?.page_start);
	const pageEndRaw = parseFiniteInt(data.page_end ?? data?.payload?.page_end);

	if (!dealId && !docId) {
		await updateJob(job, "failed", "Missing deal_id or document_id", 100);
		return { ok: false, reason: "missing_identifiers" };
	}

	await updateJob(job, "running", "Populating document page understanding", 5);

	const pool = getPool();
	let resolvedDealId: string | null = dealId || null;
	let pageCount: number | null = null;

	if (docId) {
		try {
			const { rows } = await pool.query<{ deal_id: string | null; page_count: number | null }>(
				"SELECT deal_id, page_count FROM documents WHERE id = $1 LIMIT 1",
				[sanitizeText(docId)]
			);
			resolvedDealId = resolvedDealId || rows?.[0]?.deal_id || null;
			pageCount =
				typeof rows?.[0]?.page_count === "number" && Number.isFinite(rows[0].page_count)
					? Math.max(0, Math.floor(rows[0].page_count))
					: null;
		} catch {
			pageCount = null;
		}
	}

	const pageStart = docId ? Math.max(0, pageStartRaw ?? 0) : 0;
	const pageEnd =
		docId
			? Math.max(
				Math.max(1, pageStart + 1),
				pageEndRaw ?? (pageCount != null ? Math.max(1, pageCount) : Math.max(1, pageStart + 1))
			)
			: 0;

		// Force refresh semantics: delete existing DPU rows so (re)inserts get a new created_at.
		// This avoids stale /report fallbacks when rerunning analysis.
		if (forceRefresh && docId) {
			try {
				await pool.query(
					`DELETE FROM public.document_page_understanding
					  WHERE document_id = $1::uuid
					    AND version = $2::text
					    AND page_index >= $3::int
					    AND page_index < $4::int`,
					[sanitizeText(docId), sanitizeText(version), pageStart, pageEnd]
				);
			} catch {
				// best-effort
			}
		}

	try {
		const res = docId
			? await populateDocumentPageUnderstandingFromVisualExtractions(pool as any, {
				documentId: docId,
				...(resolvedDealId ? { dealId: resolvedDealId } : {}),
				pageStart,
				pageEnd,
				version,
			})
			: await populateDocumentPageUnderstandingFromVisualExtractions(pool as any, {
				dealId: resolvedDealId || dealId,
				version,
			});

		const candidatesFound = typeof (res as any)?.candidates_found === "number" ? (res as any).candidates_found : 0;

		// Bounded retry: if there are no candidates AND no visual_assets exist yet for this range, assume eventual
		// consistency / ordering lag and reschedule a delayed retry.
		if (docId && candidatesFound <= 0) {
			const assetsCount = await countVisualAssetsForRange(pool, { documentId: docId, pageStart, pageEnd });
			if (assetsCount <= 0) {
				if (retryAttempt < MAX_RETRY_ATTEMPTS) {
					const nextAttempt = retryAttempt + 1;
					const delayMs = RETRY_DELAYS_MS[nextAttempt - 1] ?? 30000;
					const parentJobId = job.id ? String(job.id) : null;
					const enqueueRes = await enqueuePersistedJob({
						type: "populate_document_page_understanding",
						job_id: makeJobId("populate_document_page_understanding", [docId, `${pageStart}-${pageEnd}`, version, `retry${nextAttempt}`]),
						idempotent: true,
						delay_ms: delayMs,
						deal_id: resolvedDealId ?? undefined,
						document_id: docId,
						page_start: pageStart,
						page_end: pageEnd,
						payload: {
							page_understanding_version: version,
							dpu_retry_attempt: nextAttempt,
							reason: "retry_no_visual_assets",
							trigger_job_id: parentJobId,
						},
						parent_job_id: parentJobId,
					});

					console.log(
						JSON.stringify({
							event: "POPULATE_RETRY_ENQUEUED",
							deal_id: resolvedDealId ?? null,
							document_id: docId,
							page_start: pageStart,
							page_end: pageEnd,
							version,
							attempt: nextAttempt,
							delay_ms: delayMs,
							job_id: enqueueRes.job_id,
							ts: new Date().toISOString(),
						})
					);

					await updateJob(
						job,
						"succeeded",
						`No visual assets yet; retry enqueued (attempt=${nextAttempt}, delay_ms=${delayMs})`,
						100
					);
					return { ok: true, retried: true, attempt: nextAttempt, delay_ms: delayMs, enqueue_job_id: enqueueRes.job_id, version };
				}

				console.log(
					JSON.stringify({
						event: "POPULATE_GIVE_UP_NO_ASSETS",
						deal_id: resolvedDealId ?? null,
						document_id: docId,
						page_start: pageStart,
						page_end: pageEnd,
						version,
						attempt: retryAttempt,
						ts: new Date().toISOString(),
					})
				);

				await updateJob(job, "succeeded", `No visual assets found after retries (attempt=${retryAttempt})`, 100);
				return { ok: false, reason: "no_assets_after_retries", attempt: retryAttempt, version };
			}
		}

		// Preserve existing behavior: deterministic slide fact promotion from DPU payloads.
		if (docId && resolvedDealId) {
			try {
				const promoted = await promoteSlideFactsFromDocumentPageUnderstanding(pool as any, {
					dealId: resolvedDealId,
					documentId: docId,
					pageStart,
					pageEnd,
					version,
					runId: job.id ? String(job.id) : null,
					stepRunId: null,
				});
				const attempted = Array.isArray(promoted.facts) ? promoted.facts.length : 0;
				if (attempted <= 0) {
					console.warn(
						JSON.stringify({
							event: "PROMOTE_SLIDE_FACTS_ZERO_FACTS",
							deal_id: resolvedDealId,
							document_id: docId,
							page_start: pageStart,
							page_end: pageEnd,
							version,
							attempted,
							inserted: promoted.inserted,
							updated: promoted.updated,
							warnings: promoted.warnings,
							ts: new Date().toISOString(),
						})
					)
				}
				console.log(
					JSON.stringify({
						event: "PROMOTE_SLIDE_FACTS",
						deal_id: resolvedDealId,
						document_id: docId,
						page_start: pageStart,
						page_end: pageEnd,
						attempted,
						inserted: promoted.inserted,
						updated: promoted.updated,
						fact_types: promoted.facts.map((f) => f.fact_type),
						warnings: promoted.warnings,
						ts: new Date().toISOString(),
					})
				);
			} catch {
				// never block job completion
			}
		}

		// Page Registry v1: index all pages with type, entities, numeric claims.
		// Best-effort: never blocks the job. Runs after DPU + slide fact promotion.
		if (docId && resolvedDealId) {
			try {
				const pageRegResult = await populatePageRegistryV1(pool as any, {
					dealId: resolvedDealId,
					documentId: docId,
					pageStart,
					pageEnd,
					version,
				});
				console.log(
					JSON.stringify({
						event: pageRegResult.ok
							? "PAGE_REGISTRY_V1_POPULATED"
							: "PAGE_REGISTRY_V1_ERROR",
						deal_id: resolvedDealId,
						document_id: docId,
						pages_attempted: pageRegResult.pages_attempted,
						pages_upserted: pageRegResult.pages_upserted,
						pages_skipped_no_text: pageRegResult.pages_skipped_no_text,
						error: pageRegResult.error ?? null,
						ts: new Date().toISOString(),
					})
				);
			} catch {
				// never block job completion
			}

			// Deal Fact Registry v1: extract + persist canonical non-financial facts.
			// Best-effort: never blocks the job. Runs after page_registry_v1 population.
			try {
				const dealFactResult = await populateDealFactRegistryV1(pool as any, {
					dealId: resolvedDealId,
					documentId: docId,
				});
				console.log(
					JSON.stringify({
						event: dealFactResult.ok
							? "DEAL_FACT_REGISTRY_V1_POPULATED"
							: "DEAL_FACT_REGISTRY_V1_ERROR",
						deal_id: resolvedDealId,
						document_id: docId,
						pages_loaded: dealFactResult.pages_loaded,
						facts_built: dealFactResult.facts_built,
						facts_conflicted: dealFactResult.facts_conflicted,
						facts_upserted: dealFactResult.facts_upserted,
						error: dealFactResult.error ?? null,
						ts: new Date().toISOString(),
					})
				);
			} catch {
				// never block job completion
			}

			// Financial Fact Registry v1 (PDF tables): extract structured financial facts
			// from financial-typed pages. Best-effort: never blocks the job.
			try {
				const finFactResult = await populateFinancialFactRegistryV1(pool as any, {
					deal_id: resolvedDealId,
					document_id: docId,
				});
				console.log(
					JSON.stringify({
						event:
							finFactResult.errors.length === 0
								? "FINANCIAL_FACT_REGISTRY_PDF_POPULATED"
								: "FINANCIAL_FACT_REGISTRY_PDF_ERROR",
						deal_id: resolvedDealId,
						document_id: docId,
						pages_scanned: finFactResult.pages_scanned,
						pages_with_data: finFactResult.pages_with_data,
						facts_extracted: finFactResult.facts_extracted,
						facts_derived: finFactResult.facts_derived,
						facts_upserted: finFactResult.facts_upserted,
						errors: finFactResult.errors.slice(0, 3),
						ts: new Date().toISOString(),
					})
				);
			} catch {
				// never block job completion
			}
		}

		await updateJob(
			job,
			"succeeded",
			`Populated document_page_understanding (upserted=${res.upserted}, empty=${res.page_text_empty}, version=${version})`,
			100
		);
		return { ok: true, ...res, version };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		await updateJob(job, "failed", `populate_document_page_understanding failed: ${msg}`, 100);
		throw err;
	}
}
