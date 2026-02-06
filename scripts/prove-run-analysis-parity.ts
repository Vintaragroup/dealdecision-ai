import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { PNG } from "pngjs";
import { createCanvas } from "canvas";
import JSZip from "jszip";
import crypto from "node:crypto";
import { Client } from "pg";
import { pathToFileURL } from "node:url";

type Mode = "dev" | "prodlike";

type Scenario = {
	id: string;
	label: string;
	fileName: string;
	mimeType: string;
	docTypeHint?: string;
	requirePageUnderstanding?: boolean;
	expectsOcr: boolean;
	expectsForceOcrJob: boolean;
	generateBytes: (token: string) => Promise<Buffer>;
};

type ReadinessSnapshot = {
	at_ms: number;
	ready: boolean;
	blocked_reason: string | null;
	missing_pages_total: number;
	expected_pages_total: number;
	dpu_rows_total: number;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function isTerminalJobStatus(status: unknown): boolean {
	const s = String(status ?? "").toLowerCase();
	return ["succeeded", "succeeded_with_warnings", "failed", "canceled", "cancelled"].includes(s);
}

export function isSuccessJobStatus(status: unknown): boolean {
	const s = String(status ?? "").toLowerCase();
	return s === "succeeded" || s === "succeeded_with_warnings";
}

function nowIso() {
	return new Date().toISOString();
}

function randomDigits(len: number): string {
	let out = "";
	for (let i = 0; i < len; i++) out += String(Math.floor(Math.random() * 10));
	return out;
}

function sha256(buf: Buffer): string {
	return crypto.createHash("sha256").update(buf).digest("hex");
}

function parseArgs(argv: string[]) {
	const args: Record<string, string | boolean> = {};
	for (let i = 0; i < argv.length; i++) {
		const v = argv[i];
		if (!v.startsWith("--")) continue;
		const key = v.slice(2);
		const next = argv[i + 1];
		if (!next || next.startsWith("--")) {
			args[key] = true;
		} else {
			args[key] = next;
			i++;
		}
	}
	return args;
}

async function httpJson(baseUrl: string, path: string, init?: RequestInit): Promise<{ status: number; json: any }> {
	const url = `${baseUrl.replace(/\/$/, "")}${path}`;
	const res = await fetch(url, {
		...init,
		headers: {
			"content-type": "application/json",
			...(init?.headers ?? {}),
		},
	});
	const text = await res.text();
	let json: any = null;
	try {
		json = text ? JSON.parse(text) : null;
	} catch {
		json = { _raw: text };
	}
	return { status: res.status, json };
}

async function httpGetJson(baseUrl: string, path: string): Promise<any> {
	const url = `${baseUrl.replace(/\/$/, "")}${path}`;
	const res = await fetch(url);
	const text = await res.text();
	try {
		return JSON.parse(text);
	} catch {
		return { _raw: text, status: res.status };
	}
}

async function waitForApiHealthy(baseUrl: string, timeoutMs: number) {
	const start = Date.now();
	const url = `${baseUrl.replace(/\/$/, "")}/api/v1/health`;
	while (Date.now() - start < timeoutMs) {
		try {
			const res = await fetch(url);
			if (res.ok) return;
		} catch {
			// ignore and retry
		}
		await sleep(500);
	}
	throw new Error(`API did not become healthy within ${timeoutMs}ms: ${url}`);
}

function renderSevenSegDigit(png: PNG, digit: string, ox: number, oy: number, scale: number) {
	// 7 segments: a (top), b (top-right), c (bot-right), d (bottom), e (bot-left), f (top-left), g (middle)
	const map: Record<string, Array<"a" | "b" | "c" | "d" | "e" | "f" | "g">> = {
		"0": ["a", "b", "c", "d", "e", "f"],
		"1": ["b", "c"],
		"2": ["a", "b", "g", "e", "d"],
		"3": ["a", "b", "g", "c", "d"],
		"4": ["f", "g", "b", "c"],
		"5": ["a", "f", "g", "c", "d"],
		"6": ["a", "f", "g", "c", "d", "e"],
		"7": ["a", "b", "c"],
		"8": ["a", "b", "c", "d", "e", "f", "g"],
		"9": ["a", "b", "c", "d", "f", "g"],
	};

	const segments = map[digit] ?? [];
	const segW = 10 * scale;
	const segH = 40 * scale;
	const thick = 6 * scale;
	const gap = 4 * scale;

	const drawRect = (x: number, y: number, w: number, h: number) => {
		for (let yy = y; yy < y + h; yy++) {
			for (let xx = x; xx < x + w; xx++) {
				if (xx < 0 || yy < 0 || xx >= png.width || yy >= png.height) continue;
				const idx = (png.width * yy + xx) << 2;
				png.data[idx] = 0;
				png.data[idx + 1] = 0;
				png.data[idx + 2] = 0;
				png.data[idx + 3] = 255;
			}
		}
	};

	const x0 = ox;
	const y0 = oy;

	const seg = {
		a: () => drawRect(x0 + thick + gap, y0, segW, thick),
		b: () => drawRect(x0 + thick + gap + segW + gap, y0 + thick + gap, thick, segH),
		c: () => drawRect(x0 + thick + gap + segW + gap, y0 + thick + gap + segH + thick + gap, thick, segH),
		d: () =>
			drawRect(
				x0 + thick + gap,
				y0 + thick + gap + segH + thick + gap + segH + thick + gap,
				segW,
				thick
			),
		e: () => drawRect(x0, y0 + thick + gap + segH + thick + gap, thick, segH),
		f: () => drawRect(x0, y0 + thick + gap, thick, segH),
		g: () => drawRect(x0 + thick + gap, y0 + thick + gap + segH + gap, segW, thick),
	} as const;

	for (const s of segments) seg[s]();
}

async function makeTokenPng(tokenDigits: string): Promise<Buffer> {
	if (!/^\d{6,}$/.test(tokenDigits)) {
		throw new Error(`token must be digits (>=6): ${tokenDigits}`);
	}

	// Prefer a real font renderer for the "scanned PDF" scenario.
	// OCR engines handle standard glyphs far more reliably than synthetic segment displays.
	try {
		const width = 2000;
		const height = 1400;
		const canvas = createCanvas(width, height);
		const ctx = canvas.getContext("2d");

		ctx.fillStyle = "#ffffff";
		ctx.fillRect(0, 0, width, height);

		ctx.fillStyle = "#000000";
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";

		// Draw the token large and repeated to survive any downsampling during PDF rendering.
		ctx.font = "bold 220px sans-serif";
		ctx.fillText(tokenDigits, width / 2, height * 0.45);
		ctx.fillText(tokenDigits, width / 2, height * 0.70);

		// Add thick guide lines to increase contrast and help OCR segmentation.
		ctx.lineWidth = 18;
		ctx.beginPath();
		ctx.moveTo(140, height * 0.20);
		ctx.lineTo(width - 140, height * 0.20);
		ctx.moveTo(140, height * 0.88);
		ctx.lineTo(width - 140, height * 0.88);
		ctx.strokeStyle = "#000000";
		ctx.stroke();

		return Buffer.from(canvas.toBuffer("image/png"));
	} catch {
		// Fallback: synthetic seven-segment digits.
	}

	const scale = 3;
	const digitBoxW = 10 * scale + 6 * scale + 4 * scale + 6 * scale + 4 * scale + 10 * scale;
	const digitBoxH =
		6 * scale + 4 * scale + 40 * scale + 6 * scale + 4 * scale + 40 * scale + 6 * scale + 4 * scale;

	const padding = 20;
	const spacing = 20;
	const width = padding * 2 + tokenDigits.length * digitBoxW + (tokenDigits.length - 1) * spacing;
	const height = padding * 2 + digitBoxH;

	const png = new PNG({ width, height });
	// Fill white background
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const idx = (width * y + x) << 2;
			png.data[idx] = 255;
			png.data[idx + 1] = 255;
			png.data[idx + 2] = 255;
			png.data[idx + 3] = 255;
		}
	}

	let x = padding;
	const y = padding;
	for (const ch of tokenDigits) {
		renderSevenSegDigit(png, ch, x, y, scale);
		x += digitBoxW + spacing;
	}

	return PNG.sync.write(png);
}

async function makeTextPdf(tokenDigits: string): Promise<Buffer> {
	const pdf = await PDFDocument.create();
	const page = pdf.addPage([612, 792]);
	const font = await pdf.embedFont(StandardFonts.Helvetica);

	page.drawText(`TOKEN ${tokenDigits}`, {
		x: 50,
		y: 700,
		size: 42,
		font,
		color: rgb(0, 0, 0),
	});

	page.drawText("This is a text PDF. OCR should not be required.", {
		x: 50,
		y: 650,
		size: 16,
		font,
		color: rgb(0, 0, 0),
	});

	// Include enough extractable text to avoid triggering OCR on PDFs
	// that have real text but are below sparse-text thresholds.
	const body =
		`This is a proof document for the DealDecisionAI extraction pipeline. ` +
		`It contains selectable PDF text (not images) and should remain searchable without OCR. ` +
		`The verification token is ${tokenDigits} and appears repeatedly for deterministic search. ` +
		`Additional filler text is included to exceed sparse-text heuristics.`;
	const repeated = Array.from({ length: 10 }).map(() => body).join("\n");
	page.drawText(repeated, {
		x: 50,
		y: 620,
		size: 11,
		font,
		color: rgb(0, 0, 0),
		lineHeight: 14,
		maxWidth: 520,
	});

	const bytes = await pdf.save();
	return Buffer.from(bytes);
}

async function makeScannedPdfFromPng(tokenDigits: string): Promise<Buffer> {
	const pngBytes = await makeTokenPng(tokenDigits);
	const pdf = await PDFDocument.create();
	const img = await pdf.embedPng(pngBytes);
	const page = pdf.addPage([612, 792]);

	const maxW = 520;
	const maxH = 520;
	const scale = Math.min(maxW / img.width, maxH / img.height);
	const w = img.width * scale;
	const h = img.height * scale;

	page.drawImage(img, {
		x: (612 - w) / 2,
		y: (792 - h) / 2,
		width: w,
		height: h,
	});

	const bytes = await pdf.save();
	return Buffer.from(bytes);
}

async function makeMinimalDocx(tokenDigits: string): Promise<Buffer> {
	const zip = new JSZip();

	zip.file(
		"[Content_Types].xml",
		`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
	<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
	<Default Extension="xml" ContentType="application/xml"/>
	<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
	);

	zip
		.folder("_rels")
		?.file(
			".rels",
			`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
	<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
		);

	zip
		.folder("word")
		?.file(
			"document.xml",
			`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
	<w:body>
		<w:p>
			<w:r>
				<w:t>Office doc token ${tokenDigits}</w:t>
			</w:r>
		</w:p>
		<w:sectPr/>
	</w:body>
</w:document>`
		);

	const buf = await zip.generateAsync({ type: "nodebuffer" });
	return Buffer.from(buf);
}

async function createDraftDeal(baseUrl: string, name: string): Promise<string> {
	const { status, json } = await httpJson(baseUrl, "/api/v1/deals/draft", {
		method: "POST",
		body: JSON.stringify({ name }),
	});
	if (status !== 201) {
		throw new Error(`failed to create draft deal: status=${status} body=${JSON.stringify(json)}`);
	}
	const dealId = String(json?.deal_id ?? "");
	if (!dealId) throw new Error(`draft deal missing deal_id: ${JSON.stringify(json)}`);
	return dealId;
}

async function uploadDocumentJson(
	baseUrl: string,
	dealId: string,
	args: {
		fileBytes: Buffer;
		fileName: string;
		mimeType: string;
		title: string;
		typeHint?: string;
	}
): Promise<{ documentId: string; ingestJobId: string }> {
	const body = {
		file_buffer: args.fileBytes.toString("base64"),
		file_name: args.fileName,
		mime_type: args.mimeType,
		title: args.title,
		...(args.typeHint ? { type: args.typeHint } : {}),
	};

	const { status, json } = await httpJson(baseUrl, `/api/v1/deals/${encodeURIComponent(dealId)}/documents/upload`, {
		method: "POST",
		body: JSON.stringify(body),
	});

	if (status !== 202) {
		throw new Error(`failed to upload document: status=${status} body=${JSON.stringify(json)}`);
	}

	const documentId = String(json?.document_id ?? "");
	const jobId = String(json?.job_id ?? "");
	if (!documentId || !jobId) {
		throw new Error(`upload response missing ids: ${JSON.stringify(json)}`);
	}

	return { documentId, ingestJobId: jobId };
}

async function waitForJobTerminal(baseUrl: string, jobId: string, timeoutMs: number): Promise<any> {
	const start = Date.now();
	let lastLog = 0;
	while (Date.now() - start < timeoutMs) {
		const res = await httpGetJson(baseUrl, `/api/v1/jobs/${encodeURIComponent(jobId)}`);
		const status = String(res?.status ?? "").toLowerCase();
		const elapsed = Date.now() - start;
		if (elapsed - lastLog >= 5000) {
			lastLog = elapsed;
			console.log(JSON.stringify({ event: "JOB_WAIT", at: nowIso(), job_id: jobId, status, elapsed_ms: elapsed }));
		}
		if (isTerminalJobStatus(status)) {
			if (status === "failed") {
				console.error(
					JSON.stringify({
						event: "JOB_FAILED",
						at: nowIso(),
						job_id: jobId,
						message: typeof res?.message === "string" ? res.message : null,
						error: (res as any)?.error ?? null,
					})
				);
			}
			return res;
		}
		await sleep(1000);
	}
	throw new Error(`timeout waiting for job terminal: job_id=${jobId}`);
}

async function pollReadiness(
	baseUrl: string,
	dealId: string,
	timeoutMs: number
): Promise<{ final: any; transitions: ReadinessSnapshot[] }> {
	const start = Date.now();
	const transitions: ReadinessSnapshot[] = [];
	let lastLog = 0;

	const pushIfChanged = (r: any) => {
		const snap: ReadinessSnapshot = {
			at_ms: Date.now() - start,
			ready: Boolean(r?.ready),
			blocked_reason: typeof r?.blocked_reason === "string" ? r.blocked_reason : null,
			missing_pages_total: Number(r?.missing_pages_total ?? 0),
			expected_pages_total: Number(r?.expected_pages_total ?? 0),
			dpu_rows_total: Number(r?.dpu_rows_total ?? 0),
		};

		const prev = transitions[transitions.length - 1];
		if (!prev) {
			transitions.push(snap);
			return;
		}

		if (
			prev.ready !== snap.ready ||
			prev.blocked_reason !== snap.blocked_reason ||
			prev.missing_pages_total !== snap.missing_pages_total ||
			prev.expected_pages_total !== snap.expected_pages_total ||
			prev.dpu_rows_total !== snap.dpu_rows_total
		) {
			transitions.push(snap);
		}
	};

	while (Date.now() - start < timeoutMs) {
		const r = await httpGetJson(
			baseUrl,
			`/api/v1/deals/${encodeURIComponent(dealId)}/readiness?page_understanding_version=page_understanding_v1`
		);
		pushIfChanged(r);
		const elapsed = Date.now() - start;
		if (elapsed - lastLog >= 5000) {
			lastLog = elapsed;
			console.log(
				JSON.stringify({
					event: "READINESS_WAIT",
					at: nowIso(),
					deal_id: dealId,
					elapsed_ms: elapsed,
					ready: Boolean(r?.ready),
					blocked_reason: r?.blocked_reason ?? null,
					missing_pages_total: r?.missing_pages_total ?? null,
					expected_pages_total: r?.expected_pages_total ?? null,
					dpu_rows_total: r?.dpu_rows_total ?? null,
				})
			);
		}
		if (Boolean(r?.ready)) return { final: r, transitions };
		const poll = Number(r?.poll_after_ms ?? 2000);
		await sleep(Math.max(500, Math.min(5000, poll)));
	}

	const last = transitions[transitions.length - 1];
	throw new Error(`timeout waiting for readiness: deal_id=${dealId} last=${last ? JSON.stringify(last) : "<none>"}`);
}

async function runAnalyzeUiLike(
	baseUrl: string,
	dealId: string,
	timeoutMs: number,
	requirePageUnderstanding: boolean
): Promise<{ analyzeJobId: string; readinessTransitions: ReadinessSnapshot[] }> {
	const start = Date.now();
	let readinessTransitions: ReadinessSnapshot[] = [];

	while (Date.now() - start < timeoutMs) {
		const { status, json } = await httpJson(baseUrl, `/api/v1/deals/${encodeURIComponent(dealId)}/analyze`, {
			method: "POST",
			body: JSON.stringify({
				require_page_understanding: requirePageUnderstanding,
				page_understanding_version: "page_understanding_v1",
			}),
		});

		if ((status === 200 || status === 202) && json?.job_id) {
			return { analyzeJobId: String(json.job_id), readinessTransitions };
		}

		if (status === 202 && json?.error === "page_understanding_not_ready") {
			console.log(
				JSON.stringify({
					event: "PREPARE_NOT_READY",
					at: nowIso(),
					deal_id: dealId,
					blocked_reason: typeof json?.blocked_reason === "string" ? json.blocked_reason : null,
					poll_after_ms: typeof json?.poll_after_ms === "number" ? json.poll_after_ms : null,
					enqueued: json?.enqueued ?? null,
				})
			);

			// If a scenario opted out of page-understanding gating, treat this as an API contract violation.
			if (!requirePageUnderstanding) {
				throw new Error(`unexpected page_understanding_not_ready when require_page_understanding=false: ${JSON.stringify(json)}`);
			}
			const pollAfter = Number(json?.poll_after_ms ?? 2000);
			const pr = await pollReadiness(baseUrl, dealId, Math.min(timeoutMs, 120000));
			readinessTransitions = mergeTransitions(readinessTransitions, pr.transitions);
			await sleep(Math.max(500, Math.min(5000, pollAfter)));
			continue;
		}

		throw new Error(`unexpected analyze response: status=${status} body=${JSON.stringify(json)}`);
	}

	throw new Error(`timeout running analyze: deal_id=${dealId}`);
}

function mergeTransitions(a: ReadinessSnapshot[], b: ReadinessSnapshot[]): ReadinessSnapshot[] {
	if (a.length === 0) return b;
	if (b.length === 0) return a;
	const merged = [...a];
	for (const snap of b) {
		const prev = merged[merged.length - 1];
		if (
			prev.ready !== snap.ready ||
			prev.blocked_reason !== snap.blocked_reason ||
			prev.missing_pages_total !== snap.missing_pages_total ||
			prev.expected_pages_total !== snap.expected_pages_total ||
			prev.dpu_rows_total !== snap.dpu_rows_total
		) {
			merged.push(snap);
		}
	}
	return merged;
}

async function searchToken(baseUrl: string, dealId: string, tokenDigits: string): Promise<any> {
	const q = encodeURIComponent(tokenDigits);
	return httpGetJson(baseUrl, `/api/v1/deals/${encodeURIComponent(dealId)}/documents/search?q=${q}&limit=5`);
}

async function fetchDeal(baseUrl: string, dealId: string): Promise<any> {
	return httpGetJson(baseUrl, `/api/v1/deals/${encodeURIComponent(dealId)}`);
}

async function fetchReport(baseUrl: string, dealId: string): Promise<any> {
	return httpGetJson(baseUrl, `/api/v1/deals/${encodeURIComponent(dealId)}/report`);
}

async function dbFetchJobChain(db: Client, dealId: string) {
	const { rows } = await db.query(
		`SELECT job_id, type, status, deal_id, document_id, created_at, updated_at, payload
			 FROM jobs
			WHERE deal_id = $1
			ORDER BY created_at ASC NULLS LAST, job_id ASC`,
		[dealId]
	);
	return rows as Array<any>;
}

async function dbFetchDocumentEvidence(db: Client, docId: string) {
	const { rows } = await db.query(
		`SELECT id, deal_id, title, type, status, mime_type, page_count,
						full_text,
						length(coalesce(full_text,''))::int AS full_text_chars,
						full_text_absent_reason,
						extraction_metadata
			 FROM documents
			WHERE id = $1
			LIMIT 1`,
		[docId]
	);
	return rows[0] as any;
}

function summarizeJobRow(row: any) {
	const payload = row?.payload && typeof row.payload === "object" ? row.payload : null;
	const forceOcr = payload && typeof payload === "object" ? Boolean((payload as any).force_ocr) : false;
	const pageStart = payload && typeof (payload as any).page_start === "number" ? (payload as any).page_start : null;
	const pageEnd = payload && typeof (payload as any).page_end === "number" ? (payload as any).page_end : null;
	const reason = payload && typeof (payload as any).reason === "string" ? (payload as any).reason : null;

	return {
		created_at: row?.created_at ? new Date(row.created_at).toISOString() : null,
		type: row?.type ?? null,
		status: row?.status ?? null,
		job_id: row?.job_id ?? null,
		document_id: row?.document_id ?? null,
		force_ocr: forceOcr ? true : undefined,
		page_range: pageStart != null && pageEnd != null ? `${pageStart}-${pageEnd}` : undefined,
		reason: reason ?? undefined,
	};
}

function isTruthyNeedsOcr(docRow: any): boolean {
	const status = String(docRow?.status ?? "").toLowerCase();
	if (status === "needs_ocr") return true;
	const meta = docRow?.extraction_metadata && typeof docRow.extraction_metadata === "object" ? docRow.extraction_metadata : null;
	if (!meta) return false;
	if ((meta as any)?.needsOcr === true || (meta as any)?.needs_ocr === true) return true;
	const probe = (meta as any)?.textProbe;
	if (probe && typeof probe === "object") {
		const decision = (probe as any).decision;
		if (decision && typeof decision === "object" && (decision as any).run === true) return true;
		if ((probe as any).run === true || (probe as any).should_run_ocr === true) return true;
	}
	return false;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const mode = String(args.mode ?? "dev") as Mode;
	if (mode !== "dev" && mode !== "prodlike") {
		throw new Error(`--mode must be dev|prodlike (got ${mode})`);
	}

	const apiBaseUrl = String(args["api-base-url"] ?? process.env.API_BASE_URL ?? "http://localhost:9001");
	const dbUrl = String(
		args["db-url"] ?? process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:55433/dealdecision"
	);
	const timeoutMs = Number(args["timeout-ms"] ?? process.env.PROVE_TIMEOUT_MS ?? 12 * 60 * 1000);

	console.log(JSON.stringify({ event: "PROVE_START", at: nowIso(), mode, apiBaseUrl, dbUrl, timeoutMs }));

	await waitForApiHealthy(apiBaseUrl, 60_000);
	console.log(JSON.stringify({ event: "API_HEALTHY", at: nowIso(), mode, apiBaseUrl }));

	const db = new Client({ connectionString: dbUrl });
	await db.connect();

	const scenarios: Scenario[] = [
		{
			id: "text_pdf",
			label: "Text PDF (should NOT OCR)",
			fileName: "proof_text.pdf",
			mimeType: "application/pdf",
			requirePageUnderstanding: true,
			expectsOcr: false,
			expectsForceOcrJob: false,
			generateBytes: makeTextPdf,
		},
		{
			id: "scanned_pdf",
			label: "Scanned PDF (MUST OCR)",
			fileName: "proof_scanned.pdf",
			mimeType: "application/pdf",
			requirePageUnderstanding: true,
			expectsOcr: true,
			expectsForceOcrJob: true,
			generateBytes: makeScannedPdfFromPng,
		},
		{
			id: "image_png",
			label: "Image file PNG (MUST OCR)",
			fileName: "proof_image.png",
			mimeType: "image/png",
			requirePageUnderstanding: false,
			expectsOcr: true,
			expectsForceOcrJob: false,
			generateBytes: makeTokenPng,
		},
	];

	for (const scenario of scenarios) {
		const token = randomDigits(12);
		const dealName = `PROVE Run analysis parity ${mode} ${scenario.id} ${token}`;

		console.log(JSON.stringify({ event: "SCENARIO_START", at: nowIso(), mode, scenario: scenario.id, label: scenario.label, token }));

		const dealId = await createDraftDeal(apiBaseUrl, dealName);

		const fileBytes = await scenario.generateBytes(token);
		const digest = sha256(fileBytes);

		const { documentId, ingestJobId } = await uploadDocumentJson(apiBaseUrl, dealId, {
			fileBytes,
			fileName: scenario.fileName,
			mimeType: scenario.mimeType,
			title: `${scenario.label} ${token}`,
			typeHint: scenario.docTypeHint,
		});

		console.log(
			JSON.stringify({
				event: "UPLOAD_DONE",
				at: nowIso(),
				scenario: scenario.id,
				deal_id: dealId,
				document_id: documentId,
				mime_type: scenario.mimeType,
				file_name: scenario.fileName,
				bytes: fileBytes.length,
				sha256: digest,
				ingest_job_id: ingestJobId,
			})
		);

		const ingestTerminal = await waitForJobTerminal(apiBaseUrl, ingestJobId, timeoutMs);
		console.log(JSON.stringify({ event: "INGEST_TERMINAL", at: nowIso(), scenario: scenario.id, ingest: ingestTerminal }));

		const { analyzeJobId, readinessTransitions } = await runAnalyzeUiLike(
			apiBaseUrl,
			dealId,
			timeoutMs,
			scenario.requirePageUnderstanding !== false
		);
		console.log(JSON.stringify({ event: "ANALYZE_ENQUEUED", at: nowIso(), scenario: scenario.id, deal_id: dealId, job_id: analyzeJobId }));

		const analyzeTerminal = await waitForJobTerminal(apiBaseUrl, analyzeJobId, timeoutMs);
		console.log(JSON.stringify({ event: "ANALYZE_TERMINAL", at: nowIso(), scenario: scenario.id, analyze: analyzeTerminal }));

		const docRow = await dbFetchDocumentEvidence(db, documentId);
		const report = await fetchReport(apiBaseUrl, dealId);
		const reportReady = Boolean(report && typeof report === "object" ? (report as any).ready : false);

		const searchRes = await searchToken(apiBaseUrl, dealId, token);
		const searchHitCount = Array.isArray(searchRes?.results) ? searchRes.results.length : 0;

		const jobChain = await dbFetchJobChain(db, dealId);
		const summarized = jobChain
			.filter((r) =>
				[
					"render_document_pages",
					"document_intelligence_extract",
					"extract_visuals_deal",
					"populate_document_page_understanding",
					"analyze_deal",
					"ingest_documents",
				].includes(String(r?.type ?? ""))
			)
			.map(summarizeJobRow);

		const sawForceOcr = summarized.some((j) => j.type === "render_document_pages" && j.document_id === documentId && j.force_ocr === true);

		const fullTextChars = Number(docRow?.full_text_chars ?? 0);

		const proof = {
			deal_id: dealId,
			document_id: documentId,
			content_type: scenario.mimeType,
			token,
			readiness_transitions: readinessTransitions,
			job_chain: summarized,
			final: {
				analyze_succeeded: isSuccessJobStatus(analyzeTerminal?.status),
				report_ready: reportReady,
				full_text_chars: fullTextChars,
				search_hits: searchHitCount,
				full_text_absent_reason: docRow?.full_text_absent_reason ?? null,
				document_status: docRow?.status ?? null,
			},
			expectations: {
				expects_ocr: scenario.expectsOcr,
				expects_force_ocr_job: scenario.expectsForceOcrJob,
			},
			checks: {
				analyze_succeeded: isSuccessJobStatus(analyzeTerminal?.status),
				full_text_present: fullTextChars > 0,
				ocr_present_if_expected: scenario.expectsOcr ? fullTextChars > 0 : true,
				saw_force_ocr_job_if_expected: scenario.expectsForceOcrJob ? sawForceOcr : true,
				token_searchable: searchHitCount > 0,
				report_ready: reportReady,
			},
		};

		const ok = Object.values(proof.checks).every(Boolean);
		console.log(JSON.stringify({ event: "SCENARIO_DONE", at: nowIso(), scenario: scenario.id, ok, proof }));

		if (!ok) {
			console.error(JSON.stringify({ event: "SCENARIO_FAILED", at: nowIso(), scenario: scenario.id, deal_id: dealId, document_id: documentId, proof }, null, 2));
			process.exitCode = 2;
			break;
		}
	}

	await db.end();
	console.log(JSON.stringify({ event: "PROVE_DONE", at: nowIso(), mode }));
}

function isEntrypoint(): boolean {
	try {
		const argv1 = process.argv[1];
		if (!argv1) return false;
		return import.meta.url === pathToFileURL(argv1).href;
	} catch {
		return false;
	}
}

if (isEntrypoint()) {
	main().catch((err) => {
		console.error(
			JSON.stringify({
				event: "PROVE_FATAL",
				at: nowIso(),
				err: err instanceof Error ? err.message : String(err),
				stack: err instanceof Error ? err.stack : undefined,
			})
		);
		process.exit(1);
	});
}
