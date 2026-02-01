export {};

import path from "node:path";
import fsp from "node:fs/promises";

import * as cliProgress from "cli-progress";

import {
	initDealRefreshState,
	runDealRefresh,
	type DealRefreshState,
	type RefreshRunnerEvent,
} from "../apps/api/src/lib/refreshRunner";
import { computeTraceCoverageFromArtifacts } from "../apps/worker/src/lib/trace_audit/coverage";

type DealRow = { id: string; name: string | null };

type Args = {
	limit: number;
	concurrency: number;
	dealIds: string[];
	dryRun: boolean;
	wait: boolean;
	resume: boolean;
	pollIntervalMs: number;
	timeoutMs: number;
	runId?: string;
};

type DealStage = "load-docs" | "extract" | "persist" | "analyze" | "done" | "failed";

type DocStage = "download" | "extract / parse" | "postprocess" | "persist";

type TraceStats = {
	documents: number;
	pages: number;
	headings: number;
	metrics: number;
	entities: number;
	full_text_chars: number;
	evidence_rows: number;
};

type DealFailure = {
	deal_id: string;
	document_id?: string;
	stage?: DealStage;
	step?: string;
	job_id?: string;
	reason: string;
	trace_run_id?: string | null;
};

type DealRuntime = {
	dealId: string;
	dealName?: string | null;
	slot: number;
	docIds: string[];
	stage: DealStage;
	step?: string;
	currentJobId?: string;
	stepStartedAtMs?: number;
	startedAtMs: number;
	currentDocId?: string;
	currentDocStage?: DocStage;
	currentDocPct?: number;
	jobStatus?: string;
	jobMessage?: string;
	jobProgressPct?: number | null;
	resumed: boolean;
	stall_context_key?: string;
	stall_warned_key?: string;
};

function envFlag(name: string, defaultValue: boolean): boolean {
	const raw = process.env[name];
	if (raw == null) return defaultValue;
	return ["1", "true", "yes", "y", "on"].includes(raw.toLowerCase());
}

function envInt(name: string, defaultValue: number): number {
	const raw = process.env[name];
	if (!raw) return defaultValue;
	const parsed = Number(raw);
	return Number.isFinite(parsed) ? parsed : defaultValue;
}

function parseArgs(argv: string[]): Args {
	const dealIds: string[] = [];
	let limit = envInt("LIMIT", 0);
	let concurrency = Math.max(1, envInt("CONCURRENCY", 2));
	let dryRun = envFlag("DRY_RUN", false);
	let wait = envFlag("WAIT", true);
	let resume = envFlag("RESUME", true);
	let pollIntervalMs = Math.max(250, envInt("POLL_INTERVAL_MS", 2000));
	let timeoutMs = Math.max(1000, envInt("TIMEOUT_MS", 60 * 60 * 1000));
	let runId: string | undefined;

	for (let i = 2; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--") {
			continue;
		}
		if (a === "--deal" || a === "--deal-id") {
			const v = argv[i + 1];
			if (!v) throw new Error(`${a} requires a value`);
			dealIds.push(v);
			i += 1;
			continue;
		}
		if (a === "--limit") {
			const v = argv[i + 1];
			if (!v) throw new Error("--limit requires a value");
			limit = Number(v);
			i += 1;
			continue;
		}
		if (a === "--concurrency") {
			const v = argv[i + 1];
			if (!v) throw new Error("--concurrency requires a value");
			concurrency = Math.max(1, Number(v));
			i += 1;
			continue;
		}
		if (a === "--dry-run") {
			dryRun = true;
			continue;
		}
		if (a === "--no-wait") {
			wait = false;
			continue;
		}
		if (a === "--no-resume") {
			resume = false;
			continue;
		}
		if (a === "--run-id") {
			const v = argv[i + 1];
			if (!v) throw new Error("--run-id requires a value");
			runId = v;
			i += 1;
			continue;
		}
		if (a === "--poll-interval-ms") {
			const v = argv[i + 1];
			if (!v) throw new Error("--poll-interval-ms requires a value");
			pollIntervalMs = Math.max(250, Number(v));
			i += 1;
			continue;
		}
		if (a === "--timeout-ms") {
			const v = argv[i + 1];
			if (!v) throw new Error("--timeout-ms requires a value");
			timeoutMs = Math.max(1000, Number(v));
			i += 1;
			continue;
		}
		if (a === "--help" || a === "-h") {
			// eslint-disable-next-line no-console
			console.log(
				[
					"Usage:",
					"  pnpm -s refresh:extraction-analysis:all",
					"  pnpm -s refresh:extraction-analysis:all -- --deal <dealId>",
					"  pnpm -s refresh:extraction-analysis:all -- --limit 5 --concurrency 2",
					"",
					"Env:",
					"  DATABASE_URL (Postgres)",
					"  REDIS_URL (BullMQ)",
					"  TRACE_RUNS_WRITE=true (default) to emit docs/trace artifacts",
				].join("\n")
			);
			process.exit(0);
		}
		throw new Error(`Unknown arg: ${a}`);
	}

	return {
		limit,
		concurrency,
		dealIds,
		dryRun,
		wait,
		resume,
		pollIntervalMs,
		timeoutMs,
		runId,
	};
}

function isoForPath(d: Date): string {
	return d.toISOString().replace(/:/g, "-").replace(/\./g, "-");
}

function parseDotenv(contents: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const rawLine of contents.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		const eq = line.indexOf("=");
		if (eq <= 0) continue;
		const key = line.slice(0, eq).trim();
		let value = line.slice(eq + 1).trim();
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}
		if (key && !(key in out)) out[key] = value;
	}
	return out;
}

async function loadEnvFallback(repoRoot: string) {
	const candidates = [path.join(repoRoot, ".env"), path.join(repoRoot, "apps/api/.env")];
	for (const candidate of candidates) {
		try {
			const txt = await fsp.readFile(candidate, "utf8");
			const parsed = parseDotenv(txt);
			if (!process.env.DATABASE_URL && parsed.DATABASE_URL) process.env.DATABASE_URL = parsed.DATABASE_URL;
			if (!process.env.REDIS_URL && parsed.REDIS_URL) process.env.REDIS_URL = parsed.REDIS_URL;
		} catch {
			// ignore
		}
	}
}

async function safeReadJson(filePath: string): Promise<any | null> {
	try {
		const txt = await fsp.readFile(filePath, "utf8");
		return JSON.parse(txt);
	} catch {
		return null;
	}
}

function clampPct(n: number): number {
	if (!Number.isFinite(n)) return 0;
	return Math.max(0, Math.min(100, Math.round(n)));
}

function mapRunnerStepToDealStage(step: string | undefined): DealStage {
	if (!step) return "load-docs";
	if (step === "reextract" || step === "verify") return "extract";
	if (step === "evidence") return "persist";
	if (step === "analyze") return "analyze";
	return "load-docs";
}

function mapDocStage(docPct: number): DocStage {
	if (docPct < 20) return "download";
	if (docPct < 75) return "extract / parse";
	if (docPct < 90) return "postprocess";
	return "persist";
}

function computeDocumentProgressFromOverall(params: {
	overallPct: number;
	docIds: string[];
}): { docId?: string; docPct: number; docStage: DocStage } {
	const docs = params.docIds;
	if (!docs || docs.length === 0) {
		return { docId: undefined, docPct: 0, docStage: "download" };
	}
	const overall = clampPct(params.overallPct);
	const share = 100 / docs.length;
	let idx = Math.floor(overall / share);
	if (idx >= docs.length) idx = docs.length - 1;
	const base = idx * share;
	const within = share <= 0 ? 0 : ((overall - base) / share) * 100;
	const docPct = clampPct(within);
	return { docId: docs[idx], docPct, docStage: mapDocStage(docPct) };
}

function computeSyntheticOverallPct(params: { elapsedMs: number; docCount: number }): number {
	// Deterministic fallback when job progress_pct isn't available.
	// Makes sure UI never sits at 0% with no motion.
	const docCount = Math.max(1, params.docCount);
	const expectedMs = Math.max(60_000, docCount * 30_000);
	const pct = (params.elapsedMs / expectedMs) * 100;
	return Math.min(99, clampPct(pct));
}

function mergeStats(a: TraceStats, b: TraceStats): TraceStats {
	return {
		documents: a.documents + b.documents,
		pages: a.pages + b.pages,
		headings: a.headings + b.headings,
		metrics: a.metrics + b.metrics,
		entities: a.entities + b.entities,
		full_text_chars: a.full_text_chars + b.full_text_chars,
		evidence_rows: a.evidence_rows + b.evidence_rows,
	};
}

function zeroStats(): TraceStats {
	return { documents: 0, pages: 0, headings: 0, metrics: 0, entities: 0, full_text_chars: 0, evidence_rows: 0 };
}

function deltaStats(after: TraceStats, before: TraceStats): TraceStats {
	return {
		documents: after.documents - before.documents,
		pages: after.pages - before.pages,
		headings: after.headings - before.headings,
		metrics: after.metrics - before.metrics,
		entities: after.entities - before.entities,
		full_text_chars: after.full_text_chars - before.full_text_chars,
		evidence_rows: after.evidence_rows - before.evidence_rows,
	};
}

function safeNumber(v: unknown): number {
	const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
	return Number.isFinite(n) ? n : 0;
}

function countArrayLike(v: unknown): number {
	return Array.isArray(v) ? v.length : 0;
}

function computeTraceStatsFromArtifacts(params: {
	documents_structured?: unknown;
	evidence_rows?: unknown;
 	document_id_allow_list?: Set<string>;
}): TraceStats {
	const docsPayload = (params.documents_structured as any)?.payload ?? params.documents_structured;
	const docsAll: any[] = Array.isArray(docsPayload) ? docsPayload : [];
	const docs = params.document_id_allow_list
		? docsAll.filter((d) => {
				const id = typeof d?.id === "string" ? d.id : typeof d?.document_id === "string" ? d.document_id : null;
				return id ? params.document_id_allow_list!.has(id) : false;
			})
		: docsAll;

	let pages = 0;
	let headings = 0;
	let metrics = 0;
	let entities = 0;
	let fullTextChars = 0;

	for (const d of docs) {
		pages += safeNumber(d?.page_count);
		const em = d?.extraction_metadata;
		headings += safeNumber(em?.headingsCount ?? em?.headings_count) || countArrayLike(d?.structured_data?.mainHeadings);
		metrics += safeNumber(em?.metricsCount ?? em?.metrics_count) || countArrayLike(d?.structured_data?.keyMetrics);

		const sd = d?.structured_data;
		entities +=
			countArrayLike(sd?.entities) ||
			countArrayLike(sd?.namedEntities) ||
			countArrayLike(sd?.entityMentions) ||
			0;
		const ft = (typeof sd?.full_text === "string" ? sd.full_text : typeof sd?.fullText === "string" ? sd.fullText : null) as
			| string
			| null;
		fullTextChars += ft ? ft.length : 0;
	}

	const evPayload = (params.evidence_rows as any)?.payload ?? params.evidence_rows;
	const evAll: any[] = Array.isArray(evPayload) ? evPayload : [];
	const ev = params.document_id_allow_list
		? evAll.filter((r) => {
				const id =
					typeof r?.document_id === "string"
						? r.document_id
						: typeof r?.documentId === "string"
							? r.documentId
							: null;
				return id ? params.document_id_allow_list!.has(id) : false;
			})
		: evAll;

	return {
		documents: docs.length,
		pages,
		headings,
		metrics,
		entities,
		full_text_chars: fullTextChars,
		evidence_rows: ev.length,
	};
}

type TraceStatsReadResult = {
	run_id: string | null;
	stats: TraceStats;
	missing: boolean;
};


async function readLatestTraceStats(params: {
	repoRoot: string;
	dealId: string;
	document_id_allow_list?: Set<string>;
	logMissing?: (line: string) => void;
}): Promise<TraceStatsReadResult> {
	const { repoRoot, dealId, logMissing } = params;
	const latestPath = path.join(repoRoot, "docs", "trace", dealId, "latest.json");
	const latest = await safeReadJson(latestPath);
	const runId = typeof latest?.run_id === "string" ? latest.run_id : null;
	if (!runId) {
		logMissing?.(`Missing trace latest.json run_id: deal=${dealId} path=${latestPath}`);
		return { run_id: null, stats: zeroStats(), missing: true };
	}
	const runDir = path.join(repoRoot, "docs", "trace", dealId, runId);
	const [docsStructured, evidenceRows] = await Promise.all([
		safeReadJson(path.join(runDir, "02_documents_structured.json")),
		safeReadJson(path.join(runDir, "03_evidence_rows.json")),
	]);
	let missing = false;
	if (docsStructured == null) {
		missing = true;
		logMissing?.(`Missing trace artifact: deal=${dealId} run_id=${runId} file=02_documents_structured.json`);
	}
	if (evidenceRows == null) {
		missing = true;
		logMissing?.(`Missing trace artifact: deal=${dealId} run_id=${runId} file=03_evidence_rows.json`);
	}
	return {
		run_id: runId,
		stats: computeTraceStatsFromArtifacts({
			documents_structured: docsStructured ?? undefined,
			evidence_rows: evidenceRows ?? undefined,
			document_id_allow_list: params.document_id_allow_list,
		}),
		missing,
	};
}

function createSlotPool(concurrency: number) {
	const free: number[] = Array.from({ length: concurrency }, (_, i) => i);
	const waiters: Array<(slot: number) => void> = [];
	return {
		async acquire(): Promise<number> {
			if (free.length > 0) return free.shift()!;
			return await new Promise<number>((resolve) => waiters.push(resolve));
		},
		release(slot: number) {
			if (waiters.length > 0) {
				const w = waiters.shift()!;
				w(slot);
				return;
			}
			free.push(slot);
		},
	};
}

async function main() {
	const args = parseArgs(process.argv);
	const repoRoot = process.cwd();
	await loadEnvFallback(repoRoot);

	if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
	if (!process.env.REDIS_URL) throw new Error("REDIS_URL is required");

	const runId = args.runId ?? `refresh__${isoForPath(new Date())}`;
	const outDir = path.join(repoRoot, "artifacts", "refresh_runs", runId);
	await fsp.mkdir(outDir, { recursive: true });
	const statePath = path.join(outDir, "state.json");
	const rollupPath = path.join(outDir, "rollup.json");

	const previousState = args.resume ? ((await safeReadJson(statePath)) as Record<string, DealRefreshState> | null) : null;
	const stateByDeal: Record<string, DealRefreshState> = previousState && typeof previousState === "object" ? previousState : {};

	const { getPool, closePool } = await import("../apps/api/src/lib/db");
	const { enqueueJob } = await import("../apps/api/src/services/jobs");
	const { closeQueues } = await import("../apps/api/src/lib/queue");

	const pool = getPool();

	const getJob = async (jobId: string) => {
		const { rows } = await pool.query(
			`SELECT job_id, type, status, progress_pct, message, deal_id, created_at, updated_at
			   FROM jobs
			  WHERE job_id = $1
			  LIMIT 1`,
			[jobId]
		);
		if (!rows?.[0]) return { job_id: jobId, status: "failed" as const, message: "Job not found" };
		const row = rows[0];
		return {
			job_id: String(row.job_id),
			type: row.type ?? undefined,
			status: String(row.status),
			progress_pct: row.progress_pct ?? undefined,
			message: row.message ?? undefined,
			deal_id: row.deal_id ?? undefined,
			created_at: row.created_at ? new Date(row.created_at).toISOString() : undefined,
			updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : undefined,
		} as any;
	};

	const fetchDeals = async (): Promise<DealRow[]> => {
		if (args.dealIds.length > 0) {
			const unique = [...new Set(args.dealIds.map(String))];
			const { rows } = await pool.query<DealRow>(
				`SELECT id, name
				   FROM deals
				  WHERE deleted_at IS NULL
				    AND id = ANY($1)
				  ORDER BY id ASC`,
				[unique]
			);
			return rows;
		}
		const { rows } = await pool.query<DealRow>(
			`SELECT id, name
			   FROM deals
			  WHERE deleted_at IS NULL
			  ORDER BY updated_at DESC, id ASC`
		);
		return rows;
	};

	const fetchDocumentIdsWithOriginals = async (dealId: string): Promise<string[]> => {
		const { rows } = await pool.query<{ id: string }>(
			`SELECT d.id
			   FROM documents d
			   JOIN document_files f ON f.document_id = d.id
			  WHERE d.deal_id = $1
			    AND d.status <> 'processing'
			  ORDER BY d.uploaded_at ASC, d.id ASC`,
			[dealId]
		);
		return rows.map((r) => r.id);
	};

	const dealsAll = await fetchDeals();
	const deals = args.limit > 0 ? dealsAll.slice(0, args.limit) : dealsAll;

	// eslint-disable-next-line no-console
	console.log(
		`Refresh runner: deals=${deals.length}/${dealsAll.length} concurrency=${args.concurrency} wait=${args.wait} dryRun=${args.dryRun} resume=${args.resume} runId=${runId}`
	);

	// --- Progress UI (cli-progress MultiBar) + safe cleanup
	const startedAtMs = Date.now();
	const nonTty = !(process.stdout.isTTY && process.stderr.isTTY) || Boolean(process.env.CI);
	const barsEnabled = !nonTty;

	let multibar: cliProgress.MultiBar | null = null;
	let overallBar: cliProgress.SingleBar | null = null;
	let workerBars: Array<cliProgress.SingleBar | null> = [];
	let heartbeat: NodeJS.Timeout | null = null;
	let uiTick: NodeJS.Timeout | null = null;
	let cleanedUp = false;

	const cleanupUI = () => {
		if (cleanedUp) return;
		cleanedUp = true;
		if (heartbeat) {
			clearInterval(heartbeat);
			heartbeat = null;
		}
		if (uiTick) {
			clearInterval(uiTick);
			uiTick = null;
		}
		try {
			multibar?.stop();
		} catch {
			// ignore
		}
	};

	const barsActive = () => Boolean(barsEnabled && multibar);

	const logLine = (line: string) => {
		if (barsActive()) multibar!.log(line);
		else console.log(line);
	};

	const logWarn = (line: string) => {
		if (barsActive()) multibar!.log(line);
		else console.warn(line);
	};

	const logError = (err: unknown) => {
		const line = err instanceof Error ? err.stack ?? err.message : String(err);
		if (barsActive()) multibar!.log(line);
		else console.error(err);
	};

	const renderOverall = (value: number, meta: string) => {
		if (!barsEnabled || !overallBar) return;
		overallBar.update(value, { meta });
	};

	const renderWorker = (slot: number, value: number, meta: string) => {
		if (!barsEnabled) return;
		const b = workerBars[slot];
		b?.update(value, { meta });
	};

	const resetWorkerToIdle = (slot: number) => {
		renderWorker(slot, 0, "idle");
	};

	process.once("SIGINT", () => {
		cleanupUI();
		process.exit(130);
	});
	process.once("SIGTERM", () => {
		cleanupUI();
		process.exit(143);
	});
	process.once("uncaughtException", (err) => {
		logError(err);
		cleanupUI();
		process.exit(1);
	});
	process.once("unhandledRejection", (reason) => {
		logError(reason);
		cleanupUI();
		process.exit(1);
	});

	if (barsEnabled) {
		multibar = new cliProgress.MultiBar(
			{
				clearOnComplete: false,
				hideCursor: true,
				autopadding: true,
				format: "{name} |{bar}| {percentage}% | {value}/{total} | {meta}",
			},
			cliProgress.Presets.shades_grey
		);
		overallBar = multibar.create(deals.length || 1, 0, {
			name: "deals",
			meta: `concurrency=${args.concurrency} elapsed=0s ok=0 failed=0 resumed=0`,
		});
		workerBars = Array.from({ length: args.concurrency }, (_, idx) =>
			multibar!.create(100, 0, {
				name: `w${idx + 1}`,
				meta: "idle",
			})
		);
	} else {
		logLine(
			JSON.stringify({
				type: "ui_disabled",
				reason: "non_tty_or_ci",
				non_tty: nonTty,
				is_tty: Boolean(process.stdout.isTTY),
				ci: Boolean(process.env.CI),
			})
		);
	}

	let okDeals = 0;
	let failedDeals = 0;
	let resumedDeals = 0;
	let skippedDeals = 0;
	let doneDeals = 0;
	const failures: DealFailure[] = [];

	const isStateFullyComplete = (st: DealRefreshState | undefined): boolean => {
		if (!st) return false;
		const steps = Object.values(st.steps ?? {});
		if (steps.length === 0) return false;
		return steps.every((s) => s.status === "succeeded" || s.status === "skipped");
	};

	const slotPool = createSlotPool(args.concurrency);
	const running: Map<string, DealRuntime> = new Map();

	const heartbeatEveryMs = 5000;
	heartbeat = setInterval(() => {
		const elapsedSec = Math.round((Date.now() - startedAtMs) / 1000);
		renderOverall(
			doneDeals,
			`concurrency=${args.concurrency} elapsed=${elapsedSec}s ok=${okDeals} failed=${failedDeals} resumed=${resumedDeals}`
		);
		const activeWorkers = Array.from(running.values())
			.sort((a, b) => a.slot - b.slot)
			.map((r) => {
				const stepElapsedSec = r.stepStartedAtMs ? Math.round((Date.now() - r.stepStartedAtMs) / 1000) : 0;
				return {
					slot: r.slot,
					dealId: r.dealId,
					stage: r.stage,
					docId: r.currentDocId ?? "-",
					docStep: r.currentDocStage ?? "-",
					docPct: r.currentDocPct ?? 0,
					step: r.step ?? "-",
					stepElapsedSec,
				};
			});

		if (barsEnabled && multibar) {
			const activesText = activeWorkers
				.map(
					(r) =>
						`${r.dealId} stage=${r.stage} doc=${r.docId} docStep=${r.docStep} docPct=${r.docPct}% step=${r.step} t=${r.stepElapsedSec}s`
				)
				.join(" | ");
			multibar.log(`Heartbeat: done=${doneDeals}/${deals.length} ${activesText || "(no active deals)"}`);
		} else {
			console.log(
				JSON.stringify({
					type: "heartbeat",
					done: doneDeals,
					total: deals.length,
					concurrency: args.concurrency,
					elapsedSec,
					ok: okDeals,
					failed: failedDeals,
					resumed: resumedDeals,
					skipped: skippedDeals,
					activeWorkers,
				})
			);
		}
	}, heartbeatEveryMs);

	// Update elapsed times continuously so the UI never looks frozen.
	uiTick = setInterval(() => {
		for (const r of running.values()) {
			const stepElapsedMs = r.stepStartedAtMs ? Date.now() - r.stepStartedAtMs : 0;
			const stepElapsedSec = Math.round(stepElapsedMs / 1000);
			let pct = typeof r.jobProgressPct === "number" ? clampPct(r.jobProgressPct) : 0;
			// Deterministic motion for in-flight jobs that don't report progress.
			if (r.currentJobId && r.stage !== "load-docs" && (pct === 0 || !Number.isFinite(pct)) && stepElapsedMs > 15_000) {
				pct = computeSyntheticOverallPct({ elapsedMs: stepElapsedMs, docCount: r.docIds.length });
				const dp = computeDocumentProgressFromOverall({ overallPct: pct, docIds: r.docIds });
				r.currentDocId = dp.docId;
				r.currentDocPct = dp.docPct;
				r.currentDocStage = dp.docStage;
			}

			const stallContextKey = `${r.stage}|${r.step ?? ""}|${r.currentDocId ?? ""}|${r.currentDocStage ?? ""}`;
			if (stallContextKey !== r.stall_context_key) {
				r.stall_context_key = stallContextKey;
				r.stall_warned_key = undefined;
			}
			if (stepElapsedMs > 120_000 && r.stall_warned_key !== stallContextKey) {
				r.stall_warned_key = stallContextKey;
				const docId = r.currentDocId ?? "-";
				const docStep = r.currentDocStage ?? "-";
				const line = `⚠️ Possible stall: deal=${r.dealId} stage=${r.stage} doc=${docId} step=${docStep} t=${stepElapsedSec}s`;
				logWarn(line);
			}

			renderWorker(
				r.slot,
				pct,
				`${r.dealId} ${r.stage}${r.resumed ? " (resumed)" : ""} | doc=${r.currentDocId ?? "-"} ${r.currentDocStage ?? "-"} ${r.currentDocPct ?? 0}% | step=${r.step ?? "-"} t=${stepElapsedSec}s`
			);
		}
		const elapsedSec = Math.round((Date.now() - startedAtMs) / 1000);
		renderOverall(
			doneDeals,
			`concurrency=${args.concurrency} elapsed=${elapsedSec}s ok=${okDeals} failed=${failedDeals} resumed=${resumedDeals}`
		);
	}, 1000);

	// --- Rollup and stats tracking
	const perDealResults: Array<{
		deal_id: string;
		ok: boolean;
		trace_run_id?: string | null;
		coverage?: unknown;
		error?: string;
		documents_targeted_unique?: number;
		documents_processed_unique?: number;
		stats_before?: TraceStats;
		stats_after?: TraceStats;
		stats_delta?: TraceStats;
		stats_missing_before?: boolean;
		stats_missing_after?: boolean;
	}> = [];

	const beforeStatsByDeal: Map<string, TraceStats> = new Map();
	const beforeTraceRunByDeal: Map<string, string | null> = new Map();
	const targetedUniqueDocIds: Set<string> = new Set();
	let documentsAttemptedTotal = 0;

	await Promise.all(
		deals
			.sort((a, b) => String(a.id).localeCompare(String(b.id)))
			.map(async (deal) => {
				const slot = await slotPool.acquire();
				const dealId = String(deal.id);
				let finalReason: string | undefined;
				let wasSkipped = false;
				const runtime: DealRuntime = {
					dealId,
					dealName: deal.name,
					slot,
					docIds: [],
					stage: "load-docs",
					startedAtMs: Date.now(),
					resumed: Boolean(stateByDeal[dealId]),
				};
				running.set(dealId, runtime);
				renderWorker(slot, 0, `${dealId} load-docs`);

				try {
					const docIds = await fetchDocumentIdsWithOriginals(dealId);
					runtime.docIds = [...docIds].map(String).sort((a, b) => a.localeCompare(b));
					for (const id of runtime.docIds) targetedUniqueDocIds.add(id);
					documentsAttemptedTotal += runtime.docIds.length;
					if (runtime.resumed) resumedDeals += 1;

					// Capture baseline stats for delta summary (filtered to targeted docs).
					const before = await readLatestTraceStats({
						repoRoot,
						dealId,
						document_id_allow_list: new Set(runtime.docIds),
						logMissing: (line) => logWarn(`WARN: ${line}`),
					});
					beforeTraceRunByDeal.set(dealId, before.run_id);
					beforeStatsByDeal.set(dealId, before.stats);

					const existing = stateByDeal[dealId];
					const initial = existing ?? initDealRefreshState(dealId, runtime.docIds);
					// If the doc set changed since last run, refresh it deterministically.
					initial.document_ids = runtime.docIds;
					if (runtime.resumed && isStateFullyComplete(existing)) {
						skippedDeals += 1;
						wasSkipped = true;
					}

					const next = await runDealRefresh({
						state: initial,
						options: {
							dryRun: args.dryRun,
							wait: args.wait,
							pollIntervalMs: args.pollIntervalMs,
							timeoutMs: args.timeoutMs,
						},
						deps: {
							enqueueJob: async (input) => {
								const job = await enqueueJob({
									deal_id: input.deal_id,
									type: input.type as any,
									payload: input.payload,
								});
								return { job_id: String(job.job_id), status: String(job.status) as any };
							},
							getJob,
							sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
							nowIso: () => new Date().toISOString(),
							onEvent: (event: RefreshRunnerEvent) => {
								// Convert runner events into deal/doc-level progress.
								if (event.deal_id !== dealId) return;

								if (event.type === "step_enqueued") {
									runtime.step = event.step;
									runtime.stage = mapRunnerStepToDealStage(event.step);
									runtime.currentJobId = event.job_id;
									runtime.stepStartedAtMs = Date.now();
									runtime.jobStatus = "queued";
									runtime.jobMessage = undefined;
									runtime.jobProgressPct = 0;
								renderWorker(slot, 0, `${dealId} ${runtime.stage} | job=${event.job_id} | doc=-`);
								return;
							}

								if (event.type === "job_polled") {
									runtime.step = event.step;
									runtime.stage = mapRunnerStepToDealStage(event.step);
									runtime.currentJobId = event.job_id;
									runtime.jobStatus = event.job.status;
									runtime.jobMessage = event.job.message;

								const elapsedMs = runtime.stepStartedAtMs ? Date.now() - runtime.stepStartedAtMs : 0;
								const overallPct =
									typeof event.job.progress_pct === "number"
										? clampPct(event.job.progress_pct)
										: computeSyntheticOverallPct({ elapsedMs, docCount: runtime.docIds.length });
								runtime.jobProgressPct = overallPct;

								const docProgress = computeDocumentProgressFromOverall({ overallPct, docIds: runtime.docIds });
								runtime.currentDocId = docProgress.docId;
								runtime.currentDocPct = docProgress.docPct;
								runtime.currentDocStage = docProgress.docStage;
								return;
							}

								if (event.type === "step_finished") {
									runtime.jobProgressPct = 100;
									runtime.jobStatus = event.ok ? "succeeded" : "failed";
								return;
							}

								if (event.type === "deal_finished") {
									// Deal completion is handled below.
									return;
								}
							},
						},
					});

					stateByDeal[dealId] = next;
					await fsp.writeFile(statePath, JSON.stringify(stateByDeal, null, 2) + "\n", "utf8");

					let traceRunId: string | null = null;
					let coverage: unknown | undefined;
					let afterStats: TraceStats | undefined;
					let afterMissing = false;
					const allowList = new Set(runtime.docIds);

					if (args.wait) {
						const latest = await readLatestTraceStats({
							repoRoot,
							dealId,
							document_id_allow_list: allowList,
							logMissing: (line) => logWarn(`WARN: ${line}`),
						});
						traceRunId = latest.run_id;
						afterStats = latest.stats;
						afterMissing = latest.missing;

						if (traceRunId) {
							const runDir = path.join(repoRoot, "docs", "trace", dealId, traceRunId);
							const [docsStructured, evidenceRows, orchestratorInputs, analyzerResults, uiPayloads] = await Promise.all([
								safeReadJson(path.join(runDir, "02_documents_structured.json")),
								safeReadJson(path.join(runDir, "03_evidence_rows.json")),
								safeReadJson(path.join(runDir, "07_orchestrator_inputs.json")),
								safeReadJson(path.join(runDir, "08_analyzer_results.json")),
								safeReadJson(path.join(runDir, "10_ui_payloads.json")),
							]);

							coverage = computeTraceCoverageFromArtifacts({
								documents_structured: docsStructured ?? undefined,
								evidence_rows: evidenceRows ?? undefined,
								orchestrator_inputs: orchestratorInputs ?? undefined,
								analyzer_results: analyzerResults ?? undefined,
								ui_payloads: uiPayloads ?? undefined,
							});
						}
					}

					const ok = Boolean(next.ok);
					doneDeals += 1;
					if (ok) okDeals += 1;
					else failedDeals += 1;

					runtime.stage = ok ? "done" : "failed";
					finalReason = ok ? undefined : next.error ?? "failed";

					const beforeStats = beforeStatsByDeal.get(dealId);
					if (!beforeStats) logWarn(`WARN: Missing stats_before in memory: deal=${dealId}`);
					const statsAfter = afterStats;
					if (args.wait && !statsAfter) logWarn(`WARN: Missing stats_after: deal=${dealId} (wait=true)`);
					const beforeStatsSafe = beforeStats ?? zeroStats();
					const afterStatsSafe = statsAfter ?? zeroStats();

					perDealResults.push({
						deal_id: dealId,
						ok,
						trace_run_id: traceRunId,
						coverage,
						error: next.error,
						documents_targeted_unique: runtime.docIds.length,
						documents_processed_unique: afterStatsSafe.documents,
						stats_before: beforeStatsSafe,
						stats_after: afterStatsSafe,
						stats_delta: deltaStats(afterStatsSafe, beforeStatsSafe),
						stats_missing_before: !beforeStats,
						stats_missing_after: args.wait ? afterMissing || !statsAfter : true,
					});

					if (!ok) {
						failures.push({
							deal_id: dealId,
							document_id: runtime.currentDocId,
							stage: runtime.stage,
							step: runtime.step,
							job_id: runtime.currentJobId,
							reason: next.error ?? "failed",
							trace_run_id: traceRunId,
						});
					}
				} catch (err) {
					doneDeals += 1;
					failedDeals += 1;
					runtime.stage = "failed";
					const reason = err instanceof Error ? err.message : String(err);
					finalReason = reason;
					failures.push({ deal_id: dealId, reason, document_id: runtime.currentDocId, stage: runtime.stage, step: runtime.step, job_id: runtime.currentJobId });
					perDealResults.push({ deal_id: dealId, ok: false, error: reason });
				} finally {
					const finalStage = runtime.stage;
					const finalMeta = `${dealId} ${finalStage}${wasSkipped ? " (skipped)" : ""}${runtime.resumed ? " (resumed)" : ""}${finalReason ? ` (${finalReason})` : ""}`;
					renderWorker(slot, 100, finalMeta);
					resetWorkerToIdle(slot);
					running.delete(dealId);
					slotPool.release(slot);
				}
			})
	);

	// Normal completion cleanup should happen only after printing summary.

	perDealResults.sort((a, b) => a.deal_id.localeCompare(b.deal_id));
	await fsp.writeFile(
		rollupPath,
		JSON.stringify(
			{
				schema_version: "refresh_rollup.v2",
				run_id: runId,
				created_at: new Date().toISOString(),
				wait: args.wait,
				dry_run: args.dryRun,
				results: perDealResults,
			},
			null,
			2
		) + "\n",
		"utf8"
	);

	const totalsAfter = perDealResults.reduce((acc, r) => mergeStats(acc, r.stats_after ?? zeroStats()), zeroStats());
	const totalsBefore = perDealResults.reduce((acc, r) => mergeStats(acc, r.stats_before ?? zeroStats()), zeroStats());
	const totalsDelta = deltaStats(totalsAfter, totalsBefore);
	const documentsTargetedUnique = targetedUniqueDocIds.size;
	let documentsProcessedUnique = totalsAfter.documents;
	if (documentsProcessedUnique > documentsTargetedUnique) documentsProcessedUnique = documentsTargetedUnique;
	const documentsFailedUnique = Math.max(0, documentsTargetedUnique - documentsProcessedUnique);

	// Stop progress rendering before printing summary so output doesn't interleave.
	cleanupUI();

	// eslint-disable-next-line no-console
	console.log("\n=== Refresh Summary ===");
	// eslint-disable-next-line no-console
	console.log(`Run: ${runId}`);
	// eslint-disable-next-line no-console
	console.log(
		`Deals: total=${deals.length} ok=${okDeals} failed=${failedDeals} resumed=${resumedDeals} skipped=${skippedDeals}`
	);
	// eslint-disable-next-line no-console
	console.log(
		`Documents: targeted_unique=${documentsTargetedUnique} attempted_total=${documentsAttemptedTotal} processed_unique=${documentsProcessedUnique} failed_unique=${documentsFailedUnique}`
	);
	// eslint-disable-next-line no-console
	console.log(
		`Stats delta: pages=${totalsDelta.pages} headings=${totalsDelta.headings} metrics=${totalsDelta.metrics} evidence_rows=${totalsDelta.evidence_rows} entities=${totalsDelta.entities} full_text_chars=${totalsDelta.full_text_chars}`
	);
	// eslint-disable-next-line no-console
	console.log(`Artifacts: ${path.relative(repoRoot, outDir)}`);
	// eslint-disable-next-line no-console
	console.log(
		JSON.stringify(
			{
				run_id: runId,
				artifacts_path: path.relative(repoRoot, outDir),
				deals: {
					total: deals.length,
					ok: okDeals,
					failed: failedDeals,
					resumed: resumedDeals,
					skipped: skippedDeals,
				},
				documents_targeted_unique: documentsTargetedUnique,
				documents_attempted_total: documentsAttemptedTotal,
				documents_processed_unique: documentsProcessedUnique,
				documents_failed_unique: documentsFailedUnique,
				total_pages_extracted: totalsAfter.pages,
				net_new_data: {
					headings: totalsDelta.headings,
					metrics: totalsDelta.metrics,
					evidence_rows: totalsDelta.evidence_rows,
					entities: totalsDelta.entities,
					full_text_chars: totalsDelta.full_text_chars,
				},
				failures,
			},
			null,
			2
		)
	);

	await closeQueues().catch(() => undefined);
	await closePool().catch(() => undefined);
}

main().catch((err) => {
	// eslint-disable-next-line no-console
	console.error(err);
	process.exit(1);
});

/*

function isoForPath(d: Date): string {
	return d.toISOString().replace(/:/g, "-").replace(/\./g, "-");
}

function createLimiter(concurrency: number) {
	let active = 0;
	const queue: Array<() => void> = [];

	const next = () => {
		active -= 1;
		const fn = queue.shift();
		if (fn) fn();
	};

	return async function limit<T>(fn: () => Promise<T>): Promise<T> {
		if (active >= concurrency) {
			await new Promise<void>((resolve) => queue.push(resolve));
		}
		active += 1;
		try {
			return await fn();
		} finally {
			next();
		}
	};
}

function parseDotenv(contents: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const rawLine of contents.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		const eq = line.indexOf("=");
		if (eq <= 0) continue;
		const key = line.slice(0, eq).trim();
		let value = line.slice(eq + 1).trim();
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}
		if (key && !(key in out)) out[key] = value;
	}
	return out;
}

async function loadEnvFallback(repoRoot: string) {
	const candidates = [path.join(repoRoot, ".env"), path.join(repoRoot, "apps/api/.env")];
	for (const candidate of candidates) {
		try {
			const txt = await fsp.readFile(candidate, "utf8");
			const parsed = parseDotenv(txt);
			if (!process.env.DATABASE_URL && parsed.DATABASE_URL) process.env.DATABASE_URL = parsed.DATABASE_URL;
			if (!process.env.REDIS_URL && parsed.REDIS_URL) process.env.REDIS_URL = parsed.REDIS_URL;
		} catch {
			// ignore
		}
	}
}

async function safeReadJson(filePath: string): Promise<any | null> {
	try {
		const txt = await fsp.readFile(filePath, "utf8");
		return JSON.parse(txt);
	} catch {
		return null;
	}
}

async function main() {
	const args = parseArgs(process.argv);
	const repoRoot = process.cwd();
	await loadEnvFallback(repoRoot);

	if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
	if (!process.env.REDIS_URL) throw new Error("REDIS_URL is required");
				const live: Map<string, LiveDealProgress> = new Map();
				let okCount = 0;
				let failCount = 0;
				let doneCount = 0;
				const startedAt = Date.now();

				const heartbeatMs = 5000;
				const heartbeat = setInterval(() => {
					const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
					const active = Array.from(live.values())
						.filter((p) => !p.status || (p.status !== "succeeded" && p.status !== "failed" && p.status !== "cancelled"))
						.slice(0, 4)
						.map((p) => {
							const step = p.step ?? "?";
							const status = p.status ?? "?";
							const pct = typeof p.progressPct === "number" ? ` ${p.progressPct}%` : "";
							return `${p.dealId}:${step}:${status}${pct}`;
						})
						.join(" | ");
					const activeCount = Math.max(0, Math.min(args.concurrency, deals.length) - (doneCount % Math.max(1, args.concurrency)));
					// Keep heartbeat single-line and stable.
					console.log(
						`Progress: done=${doneCount}/${deals.length} ok=${okCount} failed=${failCount} elapsed=${elapsedSec}s${active ? ` active=[${active}]` : ""}`,
					);
				}, heartbeatMs);

	const runId = args.runId ?? `refresh__${isoForPath(new Date())}`;
	const outDir = path.join(repoRoot, "artifacts", "refresh_runs", runId);
	await fsp.mkdir(outDir, { recursive: true });
	const statePath = path.join(outDir, "state.json");
	const rollupPath = path.join(outDir, "rollup.json");

	const previousState = args.resume ? ((await safeReadJson(statePath)) as Record<string, DealRefreshState> | null) : null;
	const stateByDeal: Record<string, DealRefreshState> = previousState && typeof previousState === "object" ? previousState : {};

	const { getPool, closePool } = await import("../apps/api/src/lib/db");
	const { enqueueJob } = await import("../apps/api/src/services/jobs");
	const { closeQueues } = await import("../apps/api/src/lib/queue");

	const pool = getPool();

	const getJob = async (jobId: string) => {
		const { rows } = await pool.query(
			`SELECT job_id, type, status, progress_pct, message, deal_id, created_at, updated_at
			   FROM jobs
			  WHERE job_id = $1
			  LIMIT 1`,
			[jobId]
		);
		if (!rows?.[0]) {
			return { job_id: jobId, status: "failed" as const, message: "Job not found" };
		}
		const row = rows[0];
		return {
			job_id: String(row.job_id),
			type: row.type ?? undefined,
			status: String(row.status),
			progress_pct: row.progress_pct ?? undefined,
			message: row.message ?? undefined,
			deal_id: row.deal_id ?? undefined,
			created_at: row.created_at ? new Date(row.created_at).toISOString() : undefined,
			updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : undefined,
										onEvent: (event) => {
											if (event.type === "step_enqueued") {
												live.set(event.deal_id, {
													dealId: event.deal_id,
													step: event.step,
													jobId: event.job_id,
													status: "queued",
													progressPct: null,
													message: null,
													updatedAtIso: event.at,
												});
												console.log(`Deal ${event.deal_id}: enqueued ${event.step} job=${event.job_id}`);
												return;
											}
											if (event.type === "job_polled") {
												const prev = live.get(event.deal_id) ?? { dealId: event.deal_id };
												live.set(event.deal_id, {
													...prev,
													step: event.step,
													jobId: event.job_id,
													status: event.job.status,
													progressPct: event.job.progress_pct ?? null,
													message: event.job.message ?? null,
													updatedAtIso: event.at,
												});
												return;
											}
											if (event.type === "step_finished") {
												const prev = live.get(event.deal_id) ?? { dealId: event.deal_id };
												live.set(event.deal_id, {
													...prev,
													step: event.step,
													jobId: event.job_id,
													status: event.ok ? "succeeded" : "failed",
													updatedAtIso: event.at,
													message: event.message ?? null,
												});
												console.log(
													`Deal ${event.deal_id}: ${event.step} ${event.ok ? "succeeded" : "failed"}${event.message ? ` (${event.message})` : ""}`,
												);
												return;
											}
											if (event.type === "deal_finished") {
												doneCount += 1;
												if (event.ok) okCount += 1;
												else failCount += 1;
												console.log(
													`Deal ${event.deal_id}: refresh ${event.ok ? "OK" : "FAILED"}${event.error ? ` (${event.error})` : ""}`,
												);
												return;
											}
										},
		} as any;
	};

	const fetchDeals = async (): Promise<DealRow[]> => {
		if (args.dealIds.length > 0) {
			const unique = [...new Set(args.dealIds.map(String))];
			const { rows } = await pool.query<DealRow>(
				`SELECT id, name
				   FROM deals
				  WHERE deleted_at IS NULL
				    AND id = ANY($1)
				  ORDER BY id ASC`,
				[unique]
			);
			return rows;
		}
		const { rows } = await pool.query<DealRow>(
			`SELECT id, name
			   FROM deals
			  WHERE deleted_at IS NULL
			  ORDER BY updated_at DESC, id ASC`
		);
		return rows;
	};

	const fetchDocumentIdsWithOriginals = async (dealId: string): Promise<string[]> => {
		const { rows } = await pool.query<{ id: string }>(
			`SELECT d.id
			   FROM documents d
			   JOIN document_files f ON f.document_id = d.id
			  WHERE d.deal_id = $1
			    AND d.status <> 'processing'
			  ORDER BY d.uploaded_at ASC, d.id ASC`,
			[dealId]
		);
		return rows.map((r) => r.id);
	};

	const dealsAll = await fetchDeals();
	const deals = args.limit > 0 ? dealsAll.slice(0, args.limit) : dealsAll;

	// eslint-disable-next-line no-console
	console.log(
		`Refresh runner: deals=${deals.length}/${dealsAll.length} concurrency=${args.concurrency} wait=${args.wait} dryRun=${args.dryRun} resume=${args.resume} runId=${runId}`
	);

	const limiter = createLimiter(args.concurrency);
	const perDealResults: Array<{ deal_id: string; ok: boolean; trace_run_id?: string | null; coverage?: unknown; error?: string }> = [];

	await Promise.all(
		deals
			.sort((a, b) => String(a.id).localeCompare(String(b.id)))
			.map((deal) =>
				limiter(async () => {
					const dealId = String(deal.id);
					const docIds = await fetchDocumentIdsWithOriginals(dealId);

					const existing = stateByDeal[dealId];
					const initial = existing ?? initDealRefreshState(dealId, docIds);
					// If the doc set changed since last run, refresh it deterministically.
					initial.document_ids = [...docIds].map(String).sort((a, b) => a.localeCompare(b));

					const next = await runDealRefresh({
						state: initial,
						options: {
							dryRun: args.dryRun,
							wait: args.wait,
							pollIntervalMs: args.pollIntervalMs,
							timeoutMs: args.timeoutMs,
						},
						deps: {
							enqueueJob: async (input) => {
								const job = await enqueueJob({
									deal_id: input.deal_id,
									type: input.type as any,
									payload: input.payload,
								});
								return { job_id: String(job.job_id), status: String(job.status) as any };
							},
							getJob,
							sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
							nowIso: () => new Date().toISOString(),
						},
					});

					stateByDeal[dealId] = next;
					await fsp.writeFile(statePath, JSON.stringify(stateByDeal, null, 2) + "\n", "utf8");

					let traceRunId: string | null = null;
					let coverage: unknown | undefined;
					if (args.wait && next.ok) {
						const latestPath = path.join(repoRoot, "docs", "trace", dealId, "latest.json");
						const latest = await safeReadJson(latestPath);
						traceRunId = typeof latest?.run_id === "string" ? latest.run_id : null;

						if (traceRunId) {
							const runDir = path.join(repoRoot, "docs", "trace", dealId, traceRunId);
							const [docsStructured, evidenceRows, orchestratorInputs, analyzerResults, uiPayloads] = await Promise.all([
								safeReadJson(path.join(runDir, "02_documents_structured.json")),
								safeReadJson(path.join(runDir, "03_evidence_rows.json")),
								safeReadJson(path.join(runDir, "07_orchestrator_inputs.json")),
								safeReadJson(path.join(runDir, "08_analyzer_results.json")),
								safeReadJson(path.join(runDir, "10_ui_payloads.json")),
							]);

							coverage = computeTraceCoverageFromArtifacts({
								documents_structured: docsStructured ?? undefined,
								evidence_rows: evidenceRows ?? undefined,
								orchestrator_inputs: orchestratorInputs ?? undefined,
								analyzer_results: analyzerResults ?? undefined,
								ui_payloads: uiPayloads ?? undefined,
							});
						}
					}

					perDealResults.push({
						deal_id: dealId,
						ok: Boolean(next.ok),
						trace_run_id: traceRunId,
						coverage,
						error: next.error,
					});
				})
			)
	);

	perDealResults.sort((a, b) => a.deal_id.localeCompare(b.deal_id));
	await fsp.writeFile(
		rollupPath,
		JSON.stringify(
			{
				schema_version: "refresh_rollup.v1",
				run_id: runId,
				created_at: new Date().toISOString(),
				wait: args.wait,
				dry_run: args.dryRun,
				results: perDealResults,
			},
			null,
			2
		) + "\n",
		"utf8"
	);

	// eslint-disable-next-line no-console
	console.log(`Wrote artifacts: ${path.relative(repoRoot, outDir)}`);

	await closeQueues().catch(() => undefined);
	await closePool().catch(() => undefined);
}

main().catch((err) => {
	// eslint-disable-next-line no-console
	console.error(err);
	process.exit(1);
});

*/
