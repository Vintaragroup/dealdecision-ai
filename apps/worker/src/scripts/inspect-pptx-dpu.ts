/**
 * inspect-pptx-dpu.ts
 *
 * DB snapshot script for diagnosing PPTX DPU / readiness issues after a rerun.
 *
 * Usage:
 *   pnpm --filter worker exec ts-node src/scripts/inspect-pptx-dpu.ts --deal-id <UUID>
 *   # or via the wrapper:
 *   DATABASE_URL=<url> node -r esbuild-register src/scripts/inspect-pptx-dpu.ts --deal-id <UUID>
 *
 * Output (printed to stdout as structured JSON + human-readable summary):
 *   - Deal document list with document_id, mime_type, page_count
 *   - rendered_page_count (from extraction_metadata)
 *   - document_page_understanding row count per document, min/max page_index, latest created_at/updated_at
 *   - missing page indices (expected but not in DPU)
 *   - Readiness signal (expected, present, missing, ready)
 *   - Latest job statuses for render_document_pages, extract_visuals, populate_document_page_understanding, analyze_deal
 */

import { getPool, closePool, markDbShuttingDown } from "../lib/db";

function parseArg(flag: string): string | undefined {
	const idx = process.argv.indexOf(flag);
	if (idx === -1) return undefined;
	const val = process.argv[idx + 1];
	if (!val || val.startsWith("--")) return undefined;
	return val;
}

function isUuid(v: unknown): v is string {
	if (typeof v !== "string") return false;
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.trim());
}

/* ─────────────────────────────────────────────── main ─ */
async function main() {
	const dealId = parseArg("--deal-id");
	const version = parseArg("--version") ?? "page_understanding_v1";

	if (!dealId || !isUuid(dealId)) {
		console.error(
			"[inspect-pptx-dpu] Usage: inspect-pptx-dpu.ts --deal-id <UUID> [--version page_understanding_v1]"
		);
		process.exit(1);
	}

	const pool = getPool();

	/* ── 1. Documents ── */
	type DocRow = {
		id: string;
		title: string | null;
		mime_type: string | null;
		file_name: string | null;
		page_count: number | null;
		status: string | null;
		extraction_metadata: any;
	};

	const hasMimeType = await pool
		.query<{ ok: number }>(
			`SELECT 1 as ok FROM information_schema.columns WHERE table_name='documents' AND column_name='mime_type' LIMIT 1`
		)
		.then((r) => (r.rows ?? []).length > 0)
		.catch(() => false);

	const hasFileName = await pool
		.query<{ ok: number }>(
			`SELECT 1 as ok FROM information_schema.columns WHERE table_name='documents' AND column_name='file_name' LIMIT 1`
		)
		.then((r) => (r.rows ?? []).length > 0)
		.catch(() => false);

	const mimeExpr = hasMimeType ? "d.mime_type" : "NULL::text AS mime_type";
	const fileNameExpr = hasFileName ? "d.file_name" : "NULL::text AS file_name";

	const { rows: docs } = await pool.query<DocRow>(
		`SELECT d.id, d.title, ${mimeExpr}, ${fileNameExpr}, COALESCE(d.page_count, 0) AS page_count, d.status, d.extraction_metadata
		   FROM documents d
		  WHERE d.deal_id = $1::uuid
		    AND d.deleted_at IS NULL
		  ORDER BY d.title NULLS LAST, d.id`,
		[dealId]
	);

	/* ── 2. DPU row counts per document ── */
	type DpuRow = {
		document_id: string;
		dpu_count: number;
		min_page_index: number | null;
		max_page_index: number | null;
		latest_created_at: string | null;
		latest_updated_at: string | null;
	};

	let dpuByDoc: Map<string, DpuRow> = new Map();
	try {
		const { rows: dpuRows } = await pool.query<DpuRow>(
			`SELECT dpu.document_id,
			        COUNT(*)::int AS dpu_count,
			        MIN(dpu.page_index) AS min_page_index,
			        MAX(dpu.page_index) AS max_page_index,
			        MAX(dpu.created_at)::text AS latest_created_at,
			        MAX(COALESCE(dpu.updated_at, dpu.created_at))::text AS latest_updated_at
			   FROM document_page_understanding dpu
			   JOIN documents d ON d.id = dpu.document_id
			  WHERE d.deal_id = $1::uuid
			    AND d.deleted_at IS NULL
			    AND dpu.version = $2
			  GROUP BY dpu.document_id`,
			[dealId, version]
		);
		for (const r of dpuRows) dpuByDoc.set(r.document_id, r);
	} catch (err) {
		console.warn("[inspect-pptx-dpu] document_page_understanding table missing or query failed:", err instanceof Error ? err.message : err);
	}

	/* ── 3. Missing page indices per document ── */
	type MissingRow = { document_id: string; missing_pages: number[] };
	let missingByDoc: Map<string, number[]> = new Map();
	try {
		const { rows: missingRows } = await pool.query<MissingRow>(
			`WITH docs AS (
			  SELECT id AS document_id, COALESCE(page_count, 0) AS page_count
			    FROM documents
			   WHERE deal_id = $1::uuid AND deleted_at IS NULL
			),
			expected AS (
			  SELECT document_id, generate_series(0, page_count - 1) AS page_index
			    FROM docs WHERE page_count > 0
			),
			present AS (
			  SELECT dpu.document_id, dpu.page_index
			    FROM document_page_understanding dpu
			    JOIN docs d ON d.document_id = dpu.document_id
			   WHERE dpu.version = $2
			)
			SELECT e.document_id,
			       COALESCE(array_agg(e.page_index ORDER BY e.page_index) FILTER (WHERE p.page_index IS NULL), '{}') AS missing_pages
			  FROM expected e
			  LEFT JOIN present p ON p.document_id = e.document_id AND p.page_index = e.page_index
			 GROUP BY e.document_id`,
			[dealId, version]
		);
		for (const r of missingRows) missingByDoc.set(r.document_id, r.missing_pages ?? []);
	} catch {
		// ignore
	}

	/* ── 4. Latest job statuses ── */
	type JobRow = {
		id: string;
		type: string;
		status: string;
		created_at: string | null;
		started_at: string | null;
		finished_at: string | null;
		message: string | null;
	};

	const { rows: jobs } = await pool.query<JobRow>(
		`SELECT j.id, j.type, j.status,
		        j.created_at::text, j.started_at::text, j.finished_at::text, j.message
		   FROM jobs j
		  WHERE j.deal_id = $1::uuid
		    AND j.type = ANY($2::text[])
		  ORDER BY j.created_at DESC
		  LIMIT 20`,
		[dealId, ["render_document_pages", "extract_visuals", "populate_document_page_understanding", "analyze_deal"]]
	).catch(() => ({ rows: [] as JobRow[] }));

	const latestByType: Record<string, JobRow | undefined> = {};
	for (const j of jobs) {
		if (!latestByType[j.type]) latestByType[j.type] = j;
	}

	/* ── 5. visual_assets counts per document ── */
	type VisRow = { document_id: string; visual_asset_count: number; visual_extraction_count: number };
	let visByDoc: Map<string, VisRow> = new Map();
	try {
		const { rows: visRows } = await pool.query<VisRow>(
			`SELECT va.document_id,
			        COUNT(DISTINCT va.id)::int AS visual_asset_count,
			        COUNT(DISTINCT ve.id)::int AS visual_extraction_count
			   FROM documents d
			   JOIN visual_assets va ON va.document_id = d.id
			   LEFT JOIN visual_extractions ve ON ve.visual_asset_id = va.id AND ve.extractor_version = va.extractor_version
			  WHERE d.deal_id = $1::uuid AND d.deleted_at IS NULL
			  GROUP BY va.document_id`,
			[dealId]
		);
		for (const r of visRows) visByDoc.set(r.document_id, r);
	} catch {
		// ignore
	}

	/* ── 6. DB connection info ── */
	const dbInfo = await pool
		.query<{ db_host: string | null; db_name: string; db_version: string }>(
			"SELECT inet_server_addr()::text AS db_host, current_database() AS db_name, version() AS db_version"
		)
		.then((r) => r.rows?.[0] ?? null)
		.catch(() => null);

	markDbShuttingDown();
	await closePool();

	/* ── 7. Print results ── */
	console.log("\n════════════════════════════════════════════════════");
	console.log("  PPTX DPU Snapshot");
	console.log("════════════════════════════════════════════════════");
	console.log(`  Deal:    ${dealId}`);
	console.log(`  Version: ${version}`);
	console.log(`  DB Host: ${dbInfo?.db_host ?? "unknown"} / ${dbInfo?.db_name ?? "unknown"}`);
	console.log("");

	console.log("── Documents ──────────────────────────────────────");
	for (const doc of docs) {
		const dpu = dpuByDoc.get(doc.id);
		const missing = missingByDoc.get(doc.id) ?? [];
		const vis = visByDoc.get(doc.id);
		const meta = doc.extraction_metadata && typeof doc.extraction_metadata === "object" ? (doc.extraction_metadata as any) : null;
		const renderedR2 = meta?.rendered_pages_r2 ? "yes" : "no";
		const renderedCount = typeof meta?.rendered_pages_count === "number" ? meta.rendered_pages_count : "?";

		const fileOrTitle = doc.file_name ?? doc.title ?? doc.id.slice(0, 8);
		const mime = doc.mime_type ?? "unknown";
		const expected = doc.page_count ?? 0;
		const dpuCount = dpu?.dpu_count ?? 0;
		const ready = dpuCount === expected && expected > 0;

		console.log(`\n  [${doc.id.slice(0, 8)}…] ${fileOrTitle}`);
		console.log(`    mime_type:         ${mime}`);
		console.log(`    page_count (docs): ${expected}`);
		console.log(`    rendered_r2:       ${renderedR2} (count=${renderedCount})`);
		console.log(`    visual_assets:     ${vis?.visual_asset_count ?? 0}`);
		console.log(`    visual_extracts:   ${vis?.visual_extraction_count ?? 0}`);
		console.log(`    dpu_rows:          ${dpuCount} / ${expected} — ${ready ? "✅ READY" : "❌ MISSING"}`);
		console.log(`    missing_pages:     ${missing.length === 0 ? "none" : missing.slice(0, 10).join(",") + (missing.length > 10 ? `…(${missing.length} total)` : "")}`);
		console.log(`    dpu latest_created_at: ${dpu?.latest_created_at ?? "—"}`);
		console.log(`    dpu latest_updated_at: ${dpu?.latest_updated_at ?? "—"}`);
	}

	console.log("\n── Readiness Summary ───────────────────────────────");
	const totalExpected = docs.reduce((n, d) => n + (d.page_count ?? 0), 0);
	const totalDpu = docs.reduce((n, d) => n + (dpuByDoc.get(d.id)?.dpu_count ?? 0), 0);
	const totalMissing = docs.reduce((n, d) => n + (missingByDoc.get(d.id)?.length ?? 0), 0);
	console.log(`  expected_pages_total: ${totalExpected}`);
	console.log(`  dpu_rows_total:       ${totalDpu}`);
	console.log(`  missing_pages_total:  ${totalMissing}`);
	console.log(`  ready:                ${totalMissing === 0 && totalExpected > 0 ? "✅ YES" : "❌ NO"}`);

	console.log("\n── Latest job chain ────────────────────────────────");
	for (const type of ["render_document_pages", "extract_visuals", "populate_document_page_understanding", "analyze_deal"]) {
		const j = latestByType[type];
		if (j) {
			console.log(`  ${type.padEnd(42)} ${j.status.padEnd(12)} created=${j.created_at ?? "?"} finished=${j.finished_at ?? "—"}`);
			if (j.message) console.log(`    └─ ${j.message.slice(0, 120)}`);
		} else {
			console.log(`  ${type.padEnd(42)} (no job found)`);
		}
	}

	/* ── PPTX Rerun Verification Checklist ── */
	const dpuLatestTs = Array.from(dpuByDoc.values()).reduce<string | null>((best, r) => {
		const ts = r.latest_updated_at ?? r.latest_created_at ?? null;
		if (!ts) return best;
		if (!best) return ts;
		return ts > best ? ts : best;
	}, null);
	const analyzeJob = latestByType["analyze_deal"];
	const analyzeSucceeded = analyzeJob?.status === "succeeded";

	const check = (ok: boolean) => (ok ? "✅" : "❌");

	console.log("\n── PPTX Rerun Verification Checklist ───────────────");
	console.log(`  1. rendered_pages populated         ${check(docs.some((d) => (d.page_count ?? 0) > 0))}`);
	console.log(`  2. DPU rows = expected (all docs)   ${check(totalDpu === totalExpected && totalExpected > 0)}`);
	console.log(`  3. missing_pages = 0                ${check(totalMissing === 0 && totalExpected > 0)}`);
	console.log(`  4. latest_dpu_freshness_ts present  ${check(dpuLatestTs !== null)}  (${dpuLatestTs ?? "—"})`);
	console.log(`  5. readiness ready=true             ${check(totalMissing === 0 && totalExpected > 0 && totalDpu === totalExpected)}`);
	console.log(`     blocked_reason=null              ${check(totalMissing === 0)}`);
	console.log(`  6. analyze_deal succeeded           ${check(analyzeSucceeded)}  job=${analyzeJob?.id ?? "—"}`);
	console.log(`  7. [manual] report version increments — compare analysis_version old vs new in UI`);
	console.log("");
	console.log("  Suggested command sequence:");
	console.log(`  a) Trigger rerun via UI (Run Analysis button)`);
	console.log(`  b) Run this script:`);
	console.log(`     pnpm --filter worker exec tsx src/scripts/inspect-pptx-dpu.ts --deal-id ${dealId}`);
	console.log(`  c) Curl readiness:`);
	console.log(`     curl -H "Authorization: Bearer $TOKEN" '$API_BASE/api/v1/deals/${dealId}/readiness'`);
	console.log(`  d) Verify overlay refresh panel updated (check governed_overview.created_at)`);
	console.log("\n════════════════════════════════════════════════════\n");
}

main().catch((err) => {
	console.error("[inspect-pptx-dpu] fatal:", err);
	process.exit(1);
});
