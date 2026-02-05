import dotenv from "dotenv";
import { createHash } from "crypto";

import { getPool } from "../src/lib/db";
import { enqueueJob } from "../src/services/jobs";

type JobStatus = "queued" | "running" | "retrying" | "succeeded" | "succeeded_with_warnings" | "failed" | "cancelled";

type StepStatus = "running" | "succeeded" | "failed" | "cancelled" | "succeeded_with_warnings";

function sha256Hex(input: string): string {
	return createHash("sha256").update(input).digest("hex");
}

// Must match apps/worker/src/lib/pipeline-run-ledger.ts stableUuid implementation.
function stableLedgerUuid(seed: string): string {
	const hex = sha256Hex(seed).slice(0, 32);
	const a = hex.slice(0, 8);
	const b = hex.slice(8, 12);
	const c = `4${hex.slice(13, 16)}`;
	const dNibble = ((parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
	const d = `${dNibble}${hex.slice(17, 20)}`;
	const e = hex.slice(20, 32);
	return `${a}-${b}-${c}-${d}-${e}`;
}

function parseArgs(argv: string[]): { dealId: string } {
	const args = argv.slice(2);
	let dealId: string | null = null;

	for (let i = 0; i < args.length; i += 1) {
		const a = args[i];
		if (a === "--deal" || a === "-d") {
			dealId = String(args[i + 1] ?? "");
			i += 1;
			continue;
		}
	}

	if (!dealId || dealId.trim().length === 0) {
		throw new Error("Missing required argument: --deal <deal_id>");
	}

	return { dealId: dealId.trim() };
}

function isTerminalJobStatus(st: string | null | undefined): st is JobStatus {
	const v = String(st ?? "").toLowerCase();
	return v === "succeeded" || v === "succeeded_with_warnings" || v === "failed" || v === "cancelled";
}

function isOkJobStatus(st: JobStatus): boolean {
	return st === "succeeded" || st === "succeeded_with_warnings";
}

function isTerminalStepStatus(st: string | null | undefined): st is StepStatus {
	const v = String(st ?? "").toLowerCase();
	return v === "succeeded" || v === "failed" || v === "cancelled" || v === "succeeded_with_warnings";
}

async function sleep(ms: number): Promise<void> {
	await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function waitForJobTerminal(pool: ReturnType<typeof getPool>, jobId: string, opts?: { timeoutMs?: number; pollMs?: number }) {
	const timeoutMs = typeof opts?.timeoutMs === "number" ? opts.timeoutMs : 15 * 60_000;
	const pollMs = typeof opts?.pollMs === "number" ? opts.pollMs : 2000;
	const started = Date.now();

	while (true) {
		const { rows } = await pool.query<{ status: string | null; message: string | null; updated_at: string | null }>(
			"SELECT status, message, updated_at FROM jobs WHERE job_id = $1 LIMIT 1",
			[jobId]
		);

		const statusRaw = rows?.[0]?.status ?? null;
		if (isTerminalJobStatus(statusRaw)) {
			const status = statusRaw as JobStatus;
			return {
				job_id: jobId,
				status,
				ok: isOkJobStatus(status),
				message: rows?.[0]?.message ?? null,
				updated_at: rows?.[0]?.updated_at ?? null,
			};
		}

		if (Date.now() - started > timeoutMs) {
			throw new Error(`Timed out waiting for job ${jobId} to reach terminal status`);
		}
		await sleep(pollMs);
	}
}

async function waitForStepTerminal(pool: ReturnType<typeof getPool>, params: { run_id: string; step_name: string }, opts?: { timeoutMs?: number; pollMs?: number }) {
	const timeoutMs = typeof opts?.timeoutMs === "number" ? opts.timeoutMs : 20 * 60_000;
	const pollMs = typeof opts?.pollMs === "number" ? opts.pollMs : 2000;
	const started = Date.now();

	while (true) {
		const { rows } = await pool.query<{ status: string | null; finished_at: string | null; summary: unknown | null; error: unknown | null }>(
			`SELECT status, finished_at, summary, error
			   FROM pipeline_step_runs
			  WHERE run_id = $1 AND step_name = $2
			  LIMIT 1`,
			[params.run_id, params.step_name]
		);

		const statusRaw = rows?.[0]?.status ?? null;
		if (isTerminalStepStatus(statusRaw)) {
			return {
				run_id: params.run_id,
				step_name: params.step_name,
				status: statusRaw as StepStatus,
				finished_at: rows?.[0]?.finished_at ?? null,
				summary: rows?.[0]?.summary ?? null,
				error: rows?.[0]?.error ?? null,
			};
		}

		if (Date.now() - started > timeoutMs) {
			throw new Error(`Timed out waiting for pipeline_step_runs ${params.step_name} (run_id=${params.run_id})`);
		}
		await sleep(pollMs);
	}
}

async function waitForLatestAnalyzeJobId(pool: ReturnType<typeof getPool>, dealId: string, opts?: { createdAfter?: Date; timeoutMs?: number; pollMs?: number }) {
	const timeoutMs = typeof opts?.timeoutMs === "number" ? opts.timeoutMs : 20 * 60_000;
	const pollMs = typeof opts?.pollMs === "number" ? opts.pollMs : 2000;
	const started = Date.now();
	const createdAfterIso = opts?.createdAfter ? opts.createdAfter.toISOString() : null;

	while (true) {
		const { rows } = await pool.query<{ job_id: string }>(
			`SELECT job_id
			   FROM jobs
			  WHERE deal_id = $1
			    AND type = 'analyze_deal'
			    AND deleted_at IS NULL
			    AND ($2::timestamptz IS NULL OR created_at >= $2::timestamptz)
			  ORDER BY created_at DESC
			  LIMIT 1`,
			[dealId, createdAfterIso]
		);

		const jobId = rows?.[0]?.job_id;
		if (typeof jobId === "string" && jobId.length > 0) return jobId;

		if (Date.now() - started > timeoutMs) {
			throw new Error("Timed out waiting for analyze_deal job to be enqueued by backend/worker finalize hook");
		}
		await sleep(pollMs);
	}
}

async function countEvidenceInsertedForRuns(pool: ReturnType<typeof getPool>, runIds: string[]): Promise<number | null> {
	const ids = Array.from(new Set(runIds.filter(Boolean)));
	if (ids.length === 0) return 0;
	try {
		const { rows } = await pool.query<{ c: string }>(
			`SELECT COUNT(*)::text AS c
			   FROM evidence_items
			  WHERE run_id = ANY($1::uuid[])`,
			[ids]
		);
		return Number.parseInt(rows?.[0]?.c ?? "0", 10);
	} catch {
		return null;
	}
}

async function main() {
	dotenv.config();

	if (process.env.NODE_ENV === "production") {
		throw new Error("Refusing to run smoke-full-process in production (NODE_ENV=production)");
	}

	const { dealId } = parseArgs(process.argv);
	const pool = getPool();
	const startedAt = new Date();

	console.log(`[smoke-full-process] deal=${dealId}`);

	// Step 1: reextract_documents (same as UI: include_warnings=true, force=true)
	const reextract = await enqueueJob(
		{
			deal_id: dealId,
			type: "reextract_documents",
			payload: {
				deal_id: dealId,
				include_warnings: true,
				force: true,
				mode: "manual",
			},
		},
		{ dedupe: { by: "deal" } }
	);

	const reextractDone = await waitForJobTerminal(pool, reextract.job_id);
	if (!reextractDone.ok) {
		console.log(
			JSON.stringify({
				step: "reextract_documents",
				job_id: reextractDone.job_id,
				status: reextractDone.status,
				message: reextractDone.message,
			})
		);
		throw new Error(`reextract_documents failed (${reextractDone.status})`);
	}

	// Step 2: extract_visuals (UI triggers the deal-level endpoint; we enqueue the same job type directly)
	const extract = await enqueueJob({ deal_id: dealId, type: "extract_visuals", payload: {} }, { dedupe: { by: "deal" } });
	const extractDone = await waitForJobTerminal(pool, extract.job_id);

	// Gate step: document_intelligence_batch (named step run under the extract_visuals run_id)
	const extractRunId = stableLedgerUuid(`pipeline-run:extract_visuals:${extract.job_id}`);
	const diBatch = await waitForStepTerminal(pool, { run_id: extractRunId, step_name: "document_intelligence_batch" });

	// Analyze is enqueued by backend/worker finalize hook; wait for it to appear, then wait for its step run.
	const analyzeJobId = await waitForLatestAnalyzeJobId(pool, dealId, { createdAfter: startedAt });
	const analyzeRunId = stableLedgerUuid(`pipeline-run:analyze_deal:${analyzeJobId}`);
	const analyzeStep = await waitForStepTerminal(pool, { run_id: analyzeRunId, step_name: "analyze_deal" });

	const evidenceInserted = await countEvidenceInsertedForRuns(pool, [extractRunId, analyzeRunId]);

	const summary = {
		deal_id: dealId,
		started_at: startedAt.toISOString(),
		reextract_documents: { job_id: reextractDone.job_id, status: reextractDone.status },
		extract_visuals: { job_id: extractDone.job_id, status: extractDone.status },
		document_intelligence_batch: { run_id: diBatch.run_id, status: diBatch.status },
		analyze_deal: { job_id: analyzeJobId, run_id: analyzeStep.run_id, status: analyzeStep.status },
		evidence_items_inserted: evidenceInserted,
	};

	console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
	const msg = err instanceof Error ? err.message : String(err);
	console.error(`[smoke-full-process] failed: ${msg}`);
	process.exit(1);
});
