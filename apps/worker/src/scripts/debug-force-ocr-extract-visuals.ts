import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

import { enqueuePersistedJob } from "../lib/job-enqueue";
import { getPool } from "../lib/db";

type Args = {
	documentId: string;
	dealId?: string;
	pageStart: number;
	pageEnd: number;
	spawnWorker: boolean;
	timeoutMs: number;
};

function parseArgs(argv: string[]): Args {
	const out: Partial<Args> = {};

	const get = (name: string): string | null => {
		const idx = argv.indexOf(name);
		if (idx === -1) return null;
		const v = argv[idx + 1];
		return typeof v === "string" ? v : null;
	};

	const has = (name: string): boolean => argv.includes(name);

	const documentId = get("--document-id") || get("--document_id") || get("--doc") || null;
	if (!documentId) {
		throw new Error("Missing required arg: --document-id <uuid>");
	}

	const dealId = get("--deal-id") || get("--deal_id") || undefined;

	const pageStartRaw = get("--page-start") || get("--page_start") || "0";
	const pageStart = Number.parseInt(pageStartRaw, 10);
	if (!Number.isFinite(pageStart) || pageStart < 0) {
		throw new Error(`Invalid --page-start: ${pageStartRaw}`);
	}

	const pageEndRaw = get("--page-end") || get("--page_end") || null;
	const pageEnd = pageEndRaw == null ? pageStart + 1 : Number.parseInt(pageEndRaw, 10);
	if (!Number.isFinite(pageEnd) || pageEnd <= pageStart) {
		throw new Error(`Invalid --page-end: ${pageEndRaw ?? "(default)"}`);
	}

	const spawnWorker = has("--spawn-worker") ? true : has("--no-spawn-worker") ? false : true;

	const timeoutMsRaw = get("--timeout-ms") || "240000"; // 4 min
	const timeoutMs = Number.parseInt(timeoutMsRaw, 10);
	if (!Number.isFinite(timeoutMs) || timeoutMs < 10_000) {
		throw new Error(`Invalid --timeout-ms: ${timeoutMsRaw}`);
	}

	out.documentId = documentId;
	out.dealId = dealId;
	out.pageStart = pageStart;
	out.pageEnd = pageEnd;
	out.spawnWorker = spawnWorker;
	out.timeoutMs = timeoutMs;
	return out as Args;
}

async function lookupDealId(documentId: string): Promise<string | null> {
	const pool = getPool();
	const { rows } = await pool.query<{ deal_id: string | null }>(
		`SELECT deal_id FROM documents WHERE id = $1 LIMIT 1`,
		[documentId]
	);
	return rows?.[0]?.deal_id ?? null;
}

async function pollJobStatus(jobId: string, timeoutMs: number): Promise<{ status: string | null; lastError: string | null }> {
	const pool = getPool();
	const started = Date.now();
	let lastStatus: string | null = null;
	let lastError: string | null = null;
	while (Date.now() - started < timeoutMs) {
		const { rows } = await pool.query<{ status: string | null; error: string | null }>(
			`SELECT status, error FROM jobs WHERE job_id = $1 LIMIT 1`,
			[jobId]
		);
		lastStatus = rows?.[0]?.status ?? null;
		lastError = rows?.[0]?.error ?? null;
		if (lastStatus && ["succeeded", "failed", "cancelled"].includes(lastStatus)) {
			return { status: lastStatus, lastError };
		}
		await sleep(750);
	}
	return { status: lastStatus, lastError };
}

function maybeParseJsonLine(line: string): any | null {
	const trimmed = line.trim();
	if (!trimmed.startsWith("{")) return null;
	try {
		return JSON.parse(trimmed);
	} catch {
		return null;
	}
}

function shouldPrintEvent(obj: any, documentId: string): boolean {
	if (!obj || typeof obj !== "object") return false;
	const event = typeof obj.event === "string" ? obj.event : "";
	if (!event) return false;
	if (!event.startsWith("OCR_") && !event.startsWith("EXTRACT_VISUALS_")) return false;
	const doc = typeof obj.document_id === "string" ? obj.document_id : null;
	if (doc && doc !== documentId) return false;
	return true;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));

	if (!process.env.DATABASE_URL) {
		throw new Error("DATABASE_URL must be set to run this debug script");
	}
	if (!process.env.REDIS_URL) {
		throw new Error("REDIS_URL must be set to run this debug script");
	}

	const dealId = args.dealId ?? (await lookupDealId(args.documentId)) ?? undefined;
	if (!dealId) {
		throw new Error(`Could not resolve deal_id for document_id=${args.documentId}. Pass --deal-id.`);
	}

	console.log(
		JSON.stringify({
			event: "DEBUG_FORCE_OCR_START",
			document_id: args.documentId,
			deal_id: dealId,
			page_start: args.pageStart,
			page_end: args.pageEnd,
			spawn_worker: args.spawnWorker,
			ts: new Date().toISOString(),
		})
	);

	let workerProc: ReturnType<typeof spawn> | null = null;
	let sawJobSummary = false;

	if (args.spawnWorker) {
		// Run the worker without watch so we can capture logs and shut it down.
		workerProc = spawn(
			"pnpm",
			["-s", "--filter", "./apps/worker", "exec", "tsx", "src/index.ts"],
			{
				cwd: process.cwd(),
				env: {
					...process.env,
					ENABLE_VISUAL_EXTRACTION: process.env.ENABLE_VISUAL_EXTRACTION ?? "1",
					DEBUG_WORKER_LOGS: process.env.DEBUG_WORKER_LOGS ?? "1",
				},
				stdio: ["ignore", "pipe", "pipe"],
			}
		);

		const onLine = (raw: string) => {
			const line = raw.replace(/\r?\n$/, "");
			const obj = maybeParseJsonLine(line);
			if (obj && shouldPrintEvent(obj, args.documentId)) {
				console.log(line);
				if (obj.event === "EXTRACT_VISUALS_JOB_SUMMARY") sawJobSummary = true;
				return;
			}
			// Also print any obvious OCR log line even if not JSON-parsable.
			if (line.includes("OCR_REQUEST_") || line.includes("OCR_MISSING_IN_RESPONSE")) {
				console.log(line);
			}
		};

		workerProc.stdout?.setEncoding("utf8");
		workerProc.stderr?.setEncoding("utf8");
		workerProc.stdout?.on("data", (buf) => {
			String(buf)
				.split(/\n/)
				.filter(Boolean)
				.forEach((l) => onLine(l));
		});
		workerProc.stderr?.on("data", (buf) => {
			String(buf)
				.split(/\n/)
				.filter(Boolean)
				.forEach((l) => onLine(l));
		});

		// Give the worker a moment to connect to Redis/DB.
		await sleep(1500);
	}

	const { job_id } = await enqueuePersistedJob({
		type: "extract_visuals",
		deal_id: dealId,
		document_id: args.documentId,
		page_start: args.pageStart,
		page_end: args.pageEnd,
		payload: {
			force_ocr: true,
			// Keep behavior stable; only force OCR.
			force_reextract: false,
			force_resegment: false,
			enqueue_deep_scan: false,
		},
	});

	console.log(
		JSON.stringify({
			event: "DEBUG_FORCE_OCR_JOB_ENQUEUED",
			job_id,
			document_id: args.documentId,
			deal_id: dealId,
			page_start: args.pageStart,
			page_end: args.pageEnd,
			ts: new Date().toISOString(),
		})
	);

	const statusRes = await pollJobStatus(job_id, args.timeoutMs);
	console.log(
		JSON.stringify({
			event: "DEBUG_FORCE_OCR_JOB_STATUS",
			job_id,
			status: statusRes.status,
			error: statusRes.lastError,
			saw_job_summary_log: sawJobSummary,
			ts: new Date().toISOString(),
		})
	);

	if (workerProc) {
		// If we didn't see the summary log, give it a brief grace window to flush OCR logs.
		if (!sawJobSummary) {
			await sleep(1500);
		}
		workerProc.kill("SIGTERM");
		await sleep(500);
		if (!workerProc.killed) workerProc.kill("SIGKILL");
	}
}

main().catch((err) => {
	console.error(
		JSON.stringify({
			event: "DEBUG_FORCE_OCR_ERROR",
			error: err instanceof Error ? err.message : String(err),
			stack: err instanceof Error ? err.stack : null,
			ts: new Date().toISOString(),
		})
	);
	process.exitCode = 1;
});
