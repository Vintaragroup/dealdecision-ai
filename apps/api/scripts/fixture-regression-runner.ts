import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { createHash } from "crypto";
import { pickStableReportExcerpt } from "../test/helpers/report-snapshot";

type JobStatus = "queued" | "running" | "retrying" | "succeeded" | "succeeded_with_warnings" | "failed" | "cancelled";

type StepStatus = "running" | "succeeded" | "failed" | "cancelled" | "succeeded_with_warnings";

type Args = {
	decksRoot: string;
	outRoot: string;
	include: string[];
	exclude: string[];
	full: boolean;
	baseUrl: string;
	timeoutMs: number;
};

type FixtureRow = {
	fixtureKey: string;
	vertical: string;
	basenameSlug: string;
	inputPath: string;
	deal_id?: string;
	document_id?: string;
	status: "ok" | "failed" | "skipped";
	step?: string;
	error?: string;
	deck_archetype_key?: string | null;
	inputs_hash?: string | null;
	duration_ms: number;
	output?: {
		snapshot: string;
		meta: string;
		full?: string;
	};
};

function sha256Hex(input: string | Buffer): string {
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

function slugify(input: string): string {
	return String(input)
		.toLowerCase()
		.replace(/\.[a-z0-9]+$/i, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/(^-|-$)/g, "")
		.slice(0, 120);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseCsvList(value: string | undefined | null): string[] {
	const raw = String(value ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	return Array.from(new Set(raw));
}

function parseArgs(argv: string[]): Args {
	const args = argv.slice(2);

	const out: Args = {
		decksRoot: "apps/api/test/fixtures/decks",
		outRoot: "apps/api/test/fixtures/regressions",
		include: ["product", "technology", "services", "real_estate"],
		exclude: ["other", "healthcare"],
		full: false,
		baseUrl: "http://localhost:9001",
		timeoutMs: 600_000,
	};

	for (let i = 0; i < args.length; i += 1) {
		const a = args[i];
		if (a === "--decksRoot") {
			out.decksRoot = String(args[i + 1] ?? "");
			i += 1;
			continue;
		}
		if (a === "--outRoot") {
			out.outRoot = String(args[i + 1] ?? "");
			i += 1;
			continue;
		}
		if (a === "--include") {
			out.include = parseCsvList(args[i + 1]);
			i += 1;
			continue;
		}
		if (a === "--exclude") {
			out.exclude = parseCsvList(args[i + 1]);
			i += 1;
			continue;
		}
		if (a === "--full") {
			out.full = true;
			continue;
		}
		if (a === "--baseUrl") {
			out.baseUrl = String(args[i + 1] ?? "");
			i += 1;
			continue;
		}
		if (a === "--timeoutMs") {
			const v = Number(args[i + 1]);
			if (Number.isFinite(v) && v > 0) out.timeoutMs = Math.floor(v);
			i += 1;
			continue;
		}
		if (a === "--help" || a === "-h") {
			// eslint-disable-next-line no-console
			console.log(
				[
					"fixture-regression-runner.ts",
					"  --decksRoot <path>  (default: apps/api/test/fixtures/decks)",
					"  --outRoot <path>    (default: apps/api/test/fixtures/regressions)",
					"  --include a,b,c     (default: product,technology,services,real_estate)",
					"  --exclude a,b,c     (default: other,healthcare)",
					"  --full              (write full report JSON)",
					"  --baseUrl <url>     (default: http://localhost:9001)",
					"  --timeoutMs <ms>    (default: 600000)",
				].join("\n")
			);
			process.exit(0);
		}
	}

	out.decksRoot = out.decksRoot.trim();
	out.outRoot = out.outRoot.trim();
	out.baseUrl = out.baseUrl.trim().replace(/\/+$/, "");

	if (!out.decksRoot) throw new Error("--decksRoot is required");
	if (!out.outRoot) throw new Error("--outRoot is required");
	if (!out.baseUrl) throw new Error("--baseUrl is required");

	return out;
}

function normalizeRelativeRootArg(cwd: string, raw: string): string {
	const v = String(raw ?? "").trim();
	if (!v) return v;
	if (path.isAbsolute(v)) return v;

	// Common invocation: `pnpm -C apps/api ... --decksRoot apps/api/test/...`.
	// When CWD is already `apps/api`, this would resolve to `apps/api/apps/api/...`.
	const cwdNorm = cwd.split(path.sep).join("/");
	const valNorm = v.split(path.sep).join("/");
	if (cwdNorm.endsWith("/apps/api") && valNorm.startsWith("apps/api/")) {
		return valNorm.slice("apps/api/".length);
	}
	return v;
}

function isAllowedDeckFile(filePath: string): boolean {
	const ext = path.extname(filePath).toLowerCase();
	return ext === ".pdf" || ext === ".pptx";
}

function mimeTypeForPath(filePath: string): string | null {
	const ext = path.extname(filePath).toLowerCase();
	if (ext === ".pdf") return "application/pdf";
	if (ext === ".pptx") return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
	return null;
}

function walkFilesRecursive(rootDir: string): string[] {
	const out: string[] = [];

	const walk = (dir: string) => {
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}

		for (const ent of entries) {
			const full = path.join(dir, ent.name);
			if (ent.isDirectory()) {
				walk(full);
				continue;
			}
			if (ent.isFile()) out.push(full);
		}
	};

	walk(rootDir);
	return out;
}

async function fetchJson<T>(
	url: string,
	init: {
		method: "GET" | "POST";
		body?: any;
		headers?: Record<string, string>;
		timeoutMs?: number;
	}
): Promise<{ status: number; json: T; text: string; headers: Headers }> {
	const controller = new AbortController();
	const timeoutMs = typeof init.timeoutMs === "number" ? init.timeoutMs : 60_000;
	const t = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const res = await fetch(url, {
			method: init.method,
			headers: {
				"content-type": "application/json",
				...(init.headers ?? {}),
			},
			body: init.body === undefined ? undefined : JSON.stringify(init.body),
			signal: controller.signal,
		});

		const text = await res.text();
		let json: any = null;
		try {
			json = text ? JSON.parse(text) : null;
		} catch {
			json = null;
		}

		return { status: res.status, json: json as T, text, headers: res.headers };
	} finally {
		clearTimeout(t);
	}
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

async function waitForJobTerminal(
	baseUrl: string,
	jobId: string,
	opts?: { timeoutMs?: number; pollMs?: number }
): Promise<{ job_id: string; status: JobStatus; ok: boolean; message: string | null; updated_at: string | null }> {
	const timeoutMs = typeof opts?.timeoutMs === "number" ? opts.timeoutMs : 15 * 60_000;
	const pollMs = typeof opts?.pollMs === "number" ? opts.pollMs : 2000;
	const started = Date.now();
	let polls = 0;
	let lastLogAt = started;

	while (true) {
		polls += 1;
		const res = await fetchJson<any>(`${baseUrl}/api/v1/jobs/${jobId}`, {
			method: "GET",
			timeoutMs: Math.max(5000, Math.min(60_000, timeoutMs)),
		});

		if (res.status === 404) {
			if (Date.now() - started > timeoutMs) {
				throw new Error(`Timed out waiting for job ${jobId} to appear`);
			}
			await sleep(pollMs);
			continue;
		}

		if (res.status !== 200) {
			throw new Error(`job_fetch_http_${res.status}: ${res.text.slice(0, 240)}`);
		}

		const statusRaw = (res.json as any)?.status ?? null;
		if (isTerminalJobStatus(statusRaw)) {
			const status = statusRaw as JobStatus;
			return {
				job_id: jobId,
				status,
				ok: isOkJobStatus(status),
				message: (res.json as any)?.message ?? null,
				updated_at: (res.json as any)?.updated_at ?? null,
			};
		}

		if (Date.now() - lastLogAt >= 5000) {
			lastLogAt = Date.now();
			// eslint-disable-next-line no-console
			console.log(
				JSON.stringify(
					{
						event: "job.poll",
						job_id: jobId,
						status: statusRaw,
						polls,
						waited_ms: Date.now() - started,
						updated_at: (res.json as any)?.updated_at ?? null,
					},
					null,
					2
				)
			);
		}

		if (Date.now() - started > timeoutMs) {
			throw new Error(`Timed out waiting for job ${jobId} to reach terminal status`);
		}
		await sleep(pollMs);
	}
}

async function waitForLatestDealDocumentJobTerminal(args: {
	baseUrl: string;
	dealId: string;
	documentId: string;
	type: string;
	timeoutMs: number;
	pollMs?: number;
}): Promise<{ job_id: string; status: JobStatus; ok: boolean; message: string | null }> {
	const pollMs = typeof args.pollMs === "number" ? args.pollMs : 2000;
	const started = Date.now();
	let polls = 0;
	let lastLogAt = started;

	while (true) {
		polls += 1;
		const res = await fetchJson<any>(
			`${args.baseUrl}/api/v1/deals/${args.dealId}/jobs?type=${encodeURIComponent(args.type)}&limit=50`,
			{ method: "GET", timeoutMs: Math.max(10_000, Math.min(60_000, args.timeoutMs)) }
		);
		if (res.status !== 200) {
			throw new Error(`deal_jobs_fetch_http_${res.status}: ${res.text.slice(0, 240)}`);
		}

		const jobs = Array.isArray(res.json) ? (res.json as any[]) : [];
		const docJobs = jobs.filter((j) => j && String(j.document_id ?? "") === args.documentId);
		const latest = docJobs.length > 0 ? docJobs[0] : null;
		const statusRaw = latest ? String(latest.status ?? "") : null;

		if (latest && isTerminalJobStatus(statusRaw)) {
			const st = statusRaw as JobStatus;
			return {
				job_id: String(latest.job_id ?? ""),
				status: st,
				ok: isOkJobStatus(st),
				message: typeof latest.message === "string" ? latest.message : null,
			};
		}

		if (Date.now() - lastLogAt >= 5000) {
			lastLogAt = Date.now();
			// eslint-disable-next-line no-console
			console.log(
				JSON.stringify(
					{
						event: "deal_job.poll",
						deal_id: args.dealId,
						document_id: args.documentId,
						type: args.type,
						status: statusRaw,
						polls,
						waited_ms: Date.now() - started,
					},
					null,
					2
				)
			);
		}

		if (Date.now() - started > args.timeoutMs) {
			throw new Error(`Timed out waiting for latest ${args.type} job for document ${args.documentId} to finish`);
		}

		await sleep(pollMs);
	}
}

async function createOrReuseDeal(baseUrl: string, dealTitle: string): Promise<string> {
	const url = `${baseUrl}/api/v1/deals`;
	const res = await fetchJson<any>(url, {
		method: "POST",
		body: { name: dealTitle, stage: "intake", priority: "medium" },
		timeoutMs: 60_000,
	});

	if (res.status === 409) {
		const existing = (res.json as any)?.existing_deal_id;
		if (typeof existing === "string" && existing.length > 0) return existing;
		throw new Error(`create_deal_conflict_missing_existing_deal_id: ${res.text.slice(0, 240)}`);
	}

	if (res.status >= 200 && res.status < 300) {
		const id = (res.json as any)?.id;
		if (typeof id === "string" && id.length > 0) return id;
		const dealIdAlt = (res.json as any)?.deal_id;
		if (typeof dealIdAlt === "string" && dealIdAlt.length > 0) return dealIdAlt;
		throw new Error(`create_deal_missing_id: ${res.text.slice(0, 240)}`);
	}

	throw new Error(`create_deal_failed_http_${res.status}: ${res.text.slice(0, 600)}`);
}

async function uploadOrReuseDocument(args: {
	baseUrl: string;
	dealId: string;
	title: string;
	filePath: string;
	fileName: string;
}): Promise<{ documentId: string; reused: boolean }> {
	const url = `${args.baseUrl}/api/v1/deals/${args.dealId}/documents/upload`;
	const bytes = fs.readFileSync(args.filePath);
	const b64 = bytes.toString("base64");
	const mime = mimeTypeForPath(args.filePath);

	const res = await fetchJson<any>(url, {
		method: "POST",
		body: {
			file_buffer: b64,
			file_name: args.fileName,
			title: args.title,
			mime_type: mime,
		},
		timeoutMs: 5 * 60_000,
	});

	if (res.status === 409) {
		const existing = (res.json as any)?.existing_document_id;
		if (typeof existing === "string" && existing.length > 0) return { documentId: existing, reused: true };
		throw new Error(`upload_conflict_missing_existing_document_id: ${res.text.slice(0, 240)}`);
	}

	if (res.status === 202 || (res.status >= 200 && res.status < 300)) {
		const id = (res.json as any)?.document_id;
		if (typeof id === "string" && id.length > 0) return { documentId: id, reused: false };
		throw new Error(`upload_missing_document_id: ${res.text.slice(0, 240)}`);
	}

	throw new Error(`upload_failed_http_${res.status}: ${res.text.slice(0, 600)}`);
}

async function reextractDocumentsForDeal(args: {
	baseUrl: string;
	dealId: string;
	documentIds: string[];
}): Promise<string> {
	const res = await fetchJson<any>(`${args.baseUrl}/api/v1/deals/${args.dealId}/documents/re-extract`, {
		method: "POST",
		body: { document_ids: args.documentIds, force: true, mode: "manual" },
		timeoutMs: 60_000,
	});

	if (res.status === 202) {
		const jobId = (res.json as any)?.job_id;
		if (typeof jobId === "string" && jobId.length > 0) return jobId;
		throw new Error(`reextract_documents_missing_job_id: ${res.text.slice(0, 240)}`);
	}

	throw new Error(`reextract_documents_failed_http_${res.status}: ${res.text.slice(0, 600)}`);
}

async function prepareAndWaitReadiness(args: {
	baseUrl: string;
	dealId: string;
	timeoutMs: number;
	fixtureKey: string;
}): Promise<any> {
	const started = Date.now();

	const prepareOnce = async (): Promise<void> => {
		const res = await fetchJson<any>(`${args.baseUrl}/api/v1/deals/${args.dealId}/prepare`, {
			method: "POST",
			body: { page_understanding_version: "page_understanding_v1" },
			timeoutMs: 60_000,
		});

		if (res.status === 200 || res.status === 202) return;
		throw new Error(`prepare_http_${res.status}: ${res.text.slice(0, 600)}`);
	};

	await prepareOnce();

	let last: any = null;
	let polls = 0;
	while (true) {
		polls += 1;
		if (Date.now() - started > args.timeoutMs) {
			const reason = typeof last?.blocked_reason === "string" ? last.blocked_reason : "timeout";
			throw new Error(`readiness_timeout:${reason}`);
		}

		const res = await fetchJson<any>(`${args.baseUrl}/api/v1/deals/${args.dealId}/readiness?page_understanding_version=page_understanding_v1`, {
			method: "GET",
			timeoutMs: 60_000,
		});
		if (res.status !== 200) {
			throw new Error(`readiness_http_${res.status}: ${res.text.slice(0, 600)}`);
		}
		last = res.json;

		const ready = Boolean((last as any)?.ready === true);
		if (ready) return last;

		const blockedReason = typeof (last as any)?.blocked_reason === "string" ? String((last as any).blocked_reason) : null;
		const blockedMessage = typeof (last as any)?.blocked_message === "string" ? String((last as any).blocked_message) : null;

		if (polls % 10 === 0) {
			// eslint-disable-next-line no-console
			console.log(
				JSON.stringify(
					{
						event: "readiness.poll",
						fixture: args.fixtureKey,
						deal_id: args.dealId,
						blocked_reason: blockedReason,
						blocked_message: blockedMessage ? blockedMessage.slice(0, 240) : null,
						expected_pages_total: (last as any)?.expected_pages_total ?? null,
						missing_pages_total: (last as any)?.missing_pages_total ?? null,
						dpu_rows_total: (last as any)?.dpu_rows_total ?? null,
					},
					null,
					2
				)
			);
			await prepareOnce();
		}

		const pollAfter = typeof (last as any)?.poll_after_ms === "number" && Number.isFinite((last as any).poll_after_ms)
			? Math.max(500, Math.min(5000, Math.floor((last as any).poll_after_ms)))
			: 1500;
		await sleep(pollAfter);
	}
}

async function extractVisualsAndWait(args: {
	baseUrl: string;
	dealId: string;
	fixtureKey: string;
	deadlineTs: number;
}): Promise<{ job_id: string; status: JobStatus }> {
	const res = await fetchJson<any>(`${args.baseUrl}/api/v1/deals/${args.dealId}/extract-visuals`, {
		method: "POST",
		body: {},
		headers: {
			"x-idempotency-key": `fixture:${args.fixtureKey}:extract-visuals`,
			"x-client-source": "fixture-regression-runner",
		},
		timeoutMs: 60_000,
	});

	if (res.status !== 202) {
		throw new Error(`extract_visuals_http_${res.status}: ${res.text.slice(0, 600)}`);
	}

	const jobId = (res.json as any)?.job_id;
	if (typeof jobId !== "string" || !jobId) throw new Error("extract_visuals_missing_job_id");

	const timeoutLeft = Math.max(5_000, args.deadlineTs - Date.now());
	const done = await waitForJobTerminal(args.baseUrl, jobId, { timeoutMs: timeoutLeft, pollMs: 2000 });
	if (!done.ok) {
		throw new Error(`extract_visuals_failed:${done.status}:${done.message ?? ""}`.slice(0, 600));
	}

	return { job_id: jobId, status: done.status };
}

async function analyzeDealAndWait(args: {
	baseUrl: string;
	dealId: string;
	fixtureKey: string;
	deadlineTs: number;
}): Promise<{ job_id: string; status: JobStatus }> {
	const timeoutLeft0 = Math.max(5_000, args.deadlineTs - Date.now());

	for (let attempt = 1; attempt <= 6; attempt += 1) {
		const res = await fetchJson<any>(`${args.baseUrl}/api/v1/deals/${args.dealId}/analyze`, {
			method: "POST",
			body: { require_page_understanding: true, page_understanding_version: "page_understanding_v1" },
			headers: {
				"x-client-source": "fixture-regression-runner",
			},
			timeoutMs: 60_000,
		});

		if (res.status === 202) {
			const body = res.json as any;
			if (body?.status === "preparing_documents") {
				await prepareAndWaitReadiness({
					baseUrl: args.baseUrl,
					dealId: args.dealId,
					timeoutMs: Math.max(30_000, timeoutLeft0),
					fixtureKey: args.fixtureKey,
				});
				continue;
			}

			const jobId = body?.job_id;
			if (typeof jobId !== "string" || !jobId) {
				throw new Error(`analyze_missing_job_id: ${res.text.slice(0, 240)}`);
			}

			const timeoutLeft = Math.max(5_000, args.deadlineTs - Date.now());
			const done = await waitForJobTerminal(args.baseUrl, jobId, { timeoutMs: timeoutLeft, pollMs: 2000 });
			if (!done.ok) {
				throw new Error(`analyze_failed:${done.status}:${done.message ?? ""}`.slice(0, 600));
			}

			return { job_id: jobId, status: done.status };
		}

		throw new Error(`analyze_http_${res.status}: ${res.text.slice(0, 600)}`);
	}

	throw new Error("analyze_exhausted_attempts");
}

async function fetchReportReady(args: {
	baseUrl: string;
	dealId: string;
	deadlineTs: number;
	fixtureKey: string;
}): Promise<any> {
	let last: any = null;
	let polls = 0;

	while (true) {
		polls += 1;
		if (Date.now() > args.deadlineTs) {
			throw new Error(`report_timeout:${typeof last?.ready === "boolean" ? String(last.ready) : "unknown"}`);
		}

		const res = await fetchJson<any>(`${args.baseUrl}/api/v1/deals/${args.dealId}/report`, {
			method: "GET",
			timeoutMs: 60_000,
		});

		if (res.status !== 200) {
			throw new Error(`report_http_${res.status}: ${res.text.slice(0, 600)}`);
		}

		last = res.json;
		if (last && typeof last === "object" && (last as any).ready === true) {
			return last;
		}

		if (polls % 10 === 0) {
			// eslint-disable-next-line no-console
			console.log(
				JSON.stringify(
					{
						event: "report.poll",
						fixture: args.fixtureKey,
						deal_id: args.dealId,
						ready: (last as any)?.ready ?? null,
						version: (last as any)?.version ?? null,
					},
					null,
					2
				)
			);
		}

		await sleep(1500);
	}
}

async function main() {
	dotenv.config();

	if (process.env.NODE_ENV === "production") {
		throw new Error("Refusing to run fixture-regression-runner in production (NODE_ENV=production)");
	}

	const args = parseArgs(process.argv);

	const decksRootAbs = path.resolve(process.cwd(), normalizeRelativeRootArg(process.cwd(), args.decksRoot));
	const outRootAbs = path.resolve(process.cwd(), normalizeRelativeRootArg(process.cwd(), args.outRoot));

	const include = new Set(args.include.map((s) => s.trim()).filter(Boolean));
	const exclude = new Set(args.exclude.map((s) => s.trim()).filter(Boolean));

	const verticals = Array.from(include).filter((v) => !exclude.has(v));
	if (verticals.length === 0) throw new Error("No verticals selected (include minus exclude is empty)");

	fs.mkdirSync(outRootAbs, { recursive: true });

	// eslint-disable-next-line no-console
	console.log(
		JSON.stringify(
			{
				event: "runner.start",
				decksRoot: decksRootAbs,
				outRoot: outRootAbs,
				verticals,
				full: args.full,
				baseUrl: args.baseUrl,
				timeoutMs: args.timeoutMs,
			},
			null,
			2
		)
	);

	// No direct DB access: poll via HTTP API.

	const fixtures: Array<{ vertical: string; filePath: string; basename: string; basenameSlug: string }> = [];
	for (const vertical of verticals) {
		const vDir = path.join(decksRootAbs, vertical);
		if (!fs.existsSync(vDir) || !fs.statSync(vDir).isDirectory()) {
			// eslint-disable-next-line no-console
			console.warn(JSON.stringify({ event: "vertical.missing", vertical, path: vDir }, null, 2));
			continue;
		}
		const all = walkFilesRecursive(vDir);
		for (const fp of all) {
			if (!isAllowedDeckFile(fp)) continue;
			const base = path.basename(fp);
			fixtures.push({ vertical, filePath: fp, basename: base, basenameSlug: slugify(base) });
		}
	}

	fixtures.sort((a, b) => {
		const ak = `${a.vertical}/${a.basenameSlug}`;
		const bk = `${b.vertical}/${b.basenameSlug}`;
		return ak.localeCompare(bk);
	});

	// eslint-disable-next-line no-console
	console.log(JSON.stringify({ event: "runner.fixtures", count: fixtures.length }, null, 2));

	const summary: FixtureRow[] = [];

	for (const f of fixtures) {
		const fixtureKey = `${f.vertical}/${f.basenameSlug}`;
		const dealTitle = `fixture:${f.vertical}:${f.basenameSlug}`;
		const deadlineTs = Date.now() + args.timeoutMs;
		const startedAt = Date.now();

		const outDir = path.join(outRootAbs, f.vertical);
		fs.mkdirSync(outDir, { recursive: true });

		const outSnapshot = path.join(outDir, `${f.basenameSlug}.snapshot.json`);
		const outMeta = path.join(outDir, `${f.basenameSlug}.meta.json`);
		const outFull = path.join(outDir, `${f.basenameSlug}.full.report.json`);

		const row: FixtureRow = {
			fixtureKey,
			vertical: f.vertical,
			basenameSlug: f.basenameSlug,
			inputPath: path.relative(process.cwd(), f.filePath),
			status: "failed",
			duration_ms: 0,
		};

		const logStep = (step: string, extra?: Record<string, any>) => {
			row.step = step;
			// eslint-disable-next-line no-console
			console.log(
				JSON.stringify(
					{
						event: "fixture.step",
						fixture: fixtureKey,
						step,
						...extra,
					},
					null,
					2
				)
			);
		};

		try {
			logStep("deal.create_or_reuse", { deal_title: dealTitle });
			const dealId = await createOrReuseDeal(args.baseUrl, dealTitle);
			row.deal_id = dealId;

			logStep("document.upload_or_reuse", { file: path.basename(f.filePath) });
			const uploadRes = await uploadOrReuseDocument({
				baseUrl: args.baseUrl,
				dealId,
				title: dealTitle,
				filePath: f.filePath,
				fileName: path.basename(f.filePath),
			});
			const documentId = uploadRes.documentId;
			row.document_id = documentId;

			if (uploadRes.reused) {
				logStep("documents.reextract", { document_id: documentId, mode: "manual" });
				const reextractJobId = await reextractDocumentsForDeal({ baseUrl: args.baseUrl, dealId, documentIds: [documentId] });
				const done = await waitForJobTerminal(args.baseUrl, reextractJobId, {
					timeoutMs: Math.min(5 * 60_000, Math.max(30_000, deadlineTs - Date.now())),
					pollMs: 2000,
				});
				if (!done.ok) {
					throw new Error(`reextract_documents_not_ok:${done.status}:${done.message ?? ""}`.slice(0, 600));
				}

				// reextract_documents enqueues ingest jobs; wait for ingest completion to avoid analyze races.
				const ingestDone = await waitForLatestDealDocumentJobTerminal({
					baseUrl: args.baseUrl,
					dealId,
					documentId,
					type: "ingest_documents",
					timeoutMs: Math.min(8 * 60_000, Math.max(60_000, deadlineTs - Date.now())),
					pollMs: 2000,
				});
				if (!ingestDone.ok) {
					throw new Error(`ingest_after_reextract_not_ok:${ingestDone.status}:${ingestDone.message ?? ""}`.slice(0, 600));
				}
			}

			logStep("prepare_and_readiness");
			await prepareAndWaitReadiness({ baseUrl: args.baseUrl, dealId, timeoutMs: Math.max(30_000, deadlineTs - Date.now()), fixtureKey });

			logStep("extract_visuals");
			await extractVisualsAndWait({ baseUrl: args.baseUrl, dealId, fixtureKey, deadlineTs });

			logStep("analyze_deal");
			await analyzeDealAndWait({ baseUrl: args.baseUrl, dealId, fixtureKey, deadlineTs });

			logStep("report.fetch");
			const report = await fetchReportReady({ baseUrl: args.baseUrl, dealId, deadlineTs, fixtureKey });

			const excerpt = pickStableReportExcerpt(report);
			fs.writeFileSync(outSnapshot, JSON.stringify(excerpt, null, 2), "utf8");

			const meta = (() => {
				const m = report?.metadata ?? report?.report?.metadata ?? null;
				const deckKey = typeof m?.deck_archetype?.key === "string" ? String(m.deck_archetype.key) : null;
				const detInputsHash = typeof m?.deterministic_score_inputs_v1?.inputs_hash === "string" ? String(m.deterministic_score_inputs_v1.inputs_hash) : null;
				const fileHash = sha256Hex(fs.readFileSync(f.filePath));
				return {
					fixture_key: fixtureKey,
					vertical: f.vertical,
					basename_slug: f.basenameSlug,
					deal_id: dealId,
					document_id: documentId,
					inputs_hash: detInputsHash ?? fileHash,
					deck_archetype_key: deckKey,
					generated_at: new Date().toISOString(),
					base_url: args.baseUrl,
					deck_file: path.relative(process.cwd(), f.filePath),
					deck_file_sha256: fileHash,
				};
			})();

			row.inputs_hash = meta.inputs_hash;
			row.deck_archetype_key = meta.deck_archetype_key;

			fs.writeFileSync(outMeta, JSON.stringify(meta, null, 2), "utf8");

			if (args.full) {
				fs.writeFileSync(outFull, JSON.stringify(report, null, 2), "utf8");
				row.output = {
					snapshot: path.relative(process.cwd(), outSnapshot),
					meta: path.relative(process.cwd(), outMeta),
					full: path.relative(process.cwd(), outFull),
				};
			} else {
				row.output = {
					snapshot: path.relative(process.cwd(), outSnapshot),
					meta: path.relative(process.cwd(), outMeta),
				};
			}

			row.status = "ok";
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			row.status = "failed";
			row.error = msg;
			row.step = row.step ?? "unknown";

			// Best-effort: last job error message from API.
			try {
				if (row.deal_id) {
					const res = await fetchJson<any>(`${args.baseUrl}/api/v1/deals/${row.deal_id}/jobs?limit=1`, {
						method: "GET",
						timeoutMs: 30_000,
					});
					const last = Array.isArray(res.json) ? (res.json[0] ?? null) : null;
					if (last) {
						// eslint-disable-next-line no-console
						console.error(
							JSON.stringify(
								{
									event: "fixture.failed",
									fixture: fixtureKey,
									error: msg,
									last_job: {
										job_id: (last as any).job_id,
										type: (last as any).type,
										status: (last as any).status,
										message: (last as any).message,
										updated_at: (last as any).updated_at,
									},
								},
								null,
								2
							)
						);
					}
				}
			} catch {
				// ignore
			}
			// eslint-disable-next-line no-console
			console.error(
				JSON.stringify(
					{
						event: "fixture.error",
						fixture: fixtureKey,
						step: row.step,
						error: msg,
						stack: err instanceof Error && typeof err.stack === "string" ? err.stack.split("\n").slice(0, 8).join("\n") : null,
					},
					null,
					2
				)
			);
		} finally {
			row.duration_ms = Date.now() - startedAt;
			summary.push(row);
		}
	}

	const summaryPath = path.join(outRootAbs, "fixture-summary.json");
	fs.writeFileSync(
		summaryPath,
		JSON.stringify(
			{
				generated_at: new Date().toISOString(),
				decks_root: path.relative(process.cwd(), decksRootAbs),
				out_root: path.relative(process.cwd(), outRootAbs),
				base_url: args.baseUrl,
				full: args.full,
				timeout_ms: args.timeoutMs,
				verticals,
				fixtures: summary,
			},
			null,
			2
		),
		"utf8"
	);

	const ok = summary.filter((r) => r.status === "ok").length;
	const failed = summary.filter((r) => r.status === "failed").length;
	// eslint-disable-next-line no-console
	console.log(JSON.stringify({ event: "runner.done", ok, failed, summary: path.relative(process.cwd(), summaryPath) }, null, 2));
}

main()
	.catch((err) => {
		const msg = err instanceof Error ? err.message : String(err);
		// eslint-disable-next-line no-console
		console.error(`[fixture-regression-runner] failed: ${msg}`);
		process.exit(1);
	})
	.finally(() => {
		// no-op
	});
