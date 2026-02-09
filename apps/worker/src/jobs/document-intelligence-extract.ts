import type { Job } from "bullmq";

import { DocumentIntelligenceService } from "@dealdecision/core";

import { getPool } from "../lib/db";
import { updateJobProgress } from "../lib/job-progress";

type DocumentIntelligenceExtractJobData = {
	deal_id?: string;
	document_id?: string;
	run_id?: string;
	step_run_id?: string;
	force?: boolean;
	payload?: Record<string, unknown>;
	__pipeline_ledger?: { run_id: string; step_run_id: string };
};

export async function documentIntelligenceExtractProcessor(job: Job) {
	const data = (job.data ?? {}) as DocumentIntelligenceExtractJobData;

	// Normalize payload shape (tolerate nested payload wrappers).
	const normalized: any = (() => {
		const nested = (data as any)?.payload;
		if (nested && typeof nested === "object" && !Array.isArray(nested)) {
			const merged = { ...(nested as any), ...(data as any) };
			delete (merged as any).payload;
			return merged;
		}
		return data as any;
	})();

	const dealId = typeof normalized.deal_id === "string" ? normalized.deal_id.trim() : "";
	const documentId = typeof normalized.document_id === "string" ? normalized.document_id.trim() : "";
	const jobId = job.id ? String(job.id) : null;

	if (!dealId) {
		await updateJobProgress(job, { status: "failed", stage: "document_intelligence_extract", message: "Missing deal_id" });
		return { ok: false, reason: "missing_deal_id" };
	}
	if (!documentId) {
		await updateJobProgress(job, { status: "failed", stage: "document_intelligence_extract", message: "Missing document_id" });
		return { ok: false, reason: "missing_document_id" };
	}

	const ledger = (job.data as any)?.__pipeline_ledger as { run_id: string; step_run_id: string } | undefined;
	const explicitRunId = typeof (normalized as any)?.run_id === "string" ? String((normalized as any).run_id).trim() : "";
	const explicitStepRunId = typeof (normalized as any)?.step_run_id === "string" ? String((normalized as any).step_run_id).trim() : "";

	const runId = explicitRunId || ledger?.run_id || null;
	const stepRunId = explicitStepRunId || ledger?.step_run_id || null;

	console.log(
		JSON.stringify({
			event: "DOCUMENT_INTELLIGENCE_EXTRACT_START",
			job_id: jobId,
			deal_id: dealId,
			document_id: documentId,
			run_id: runId,
			step_run_id: stepRunId,
			provenance_source: explicitRunId || explicitStepRunId ? "payload" : ledger ? "run_ledger" : "none",
		})
	);

	await updateJobProgress(job, {
		status: "running",
		stage: "document_intelligence_extract",
		current: 5,
		total: 100,
		message: "Extracting document intelligence signals",
	});

	const pool = getPool();
	const service = new DocumentIntelligenceService(pool);

	const result = await service.extractSignals({
		deal_id: dealId,
		document_id: documentId,
		run_id: runId,
		step_run_id: stepRunId,
	});

	await updateJobProgress(job, {
		status: result.warnings.length > 0 ? "succeeded_with_warnings" : "succeeded",
		stage: "document_intelligence_extract",
		current: 100,
		total: 100,
		message: `Extracted ${result.summary.evidence_total} signal(s) (inserted=${result.inserted}, updated=${result.updated})`,
		meta: {
			inserted: result.inserted,
			updated: result.updated,
			warnings: result.warnings,
		},
	});

	console.log(
		JSON.stringify({
			event: "DOCUMENT_INTELLIGENCE_EXTRACT_COMPLETE",
			job_id: jobId,
			deal_id: dealId,
			document_id: documentId,
			inserted: result.inserted,
			updated: result.updated,
			evidence_total: result.summary.evidence_total,
			warnings: result.warnings,
		})
	);

	return result;
}
