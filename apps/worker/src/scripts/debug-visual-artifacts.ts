import path from "path";
import fs from "fs/promises";
import { getPool, closePool } from "../lib/db";

function parseArgs(argv: string[]) {
	const args = new Map<string, string>();
	for (let i = 0; i < argv.length; i += 1) {
		const raw = argv[i];
		if (raw === "--") continue;
		if (!raw.startsWith("--")) continue;
		const key = raw.slice(2);
		const next = argv[i + 1];
		if (!next || next.startsWith("--")) {
			args.set(key, "1");
			continue;
		}
		args.set(key, next);
		i += 1;
	}
	return args;
}

async function dirExists(p: string): Promise<boolean> {
	try {
		const s = await fs.stat(p);
		return s.isDirectory();
	} catch {
		return false;
	}
}

async function fileExists(p: string): Promise<boolean> {
	try {
		const s = await fs.stat(p);
		return s.isFile();
	} catch {
		return false;
	}
}

function safeDocIdForPath(documentId: string): string {
	return String(documentId || "").replace(/[^a-zA-Z0-9_\-]/g, "_");
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const documentId = args.get("document") || args.get("documentId") || "";
	if (!documentId) {
		console.error(
			"Usage: pnpm -C apps/worker debug:visual-artifacts -- --document <documentId> [--upload-dir <dir>]"
		);
		process.exit(2);
	}

	const uploadDir = args.get("upload-dir")
		? path.resolve(args.get("upload-dir") as string)
		: process.env.UPLOAD_DIR
			? path.resolve(process.env.UPLOAD_DIR)
			: path.resolve(process.cwd(), "uploads");

	const safeId = safeDocIdForPath(documentId);
	const renderedDir = path.join(uploadDir, "rendered_pages", safeId);

	const pool = getPool();

	const doc = await pool.query<{
		id: string;
		page_count: number | null;
		extraction_metadata: any;
	}>("SELECT id, page_count, extraction_metadata FROM documents WHERE id = $1", [documentId]);

	if (doc.rows.length === 0) {
		console.log(JSON.stringify({ ok: false, error: "document_not_found", document_id: documentId }));
		await closePool();
		process.exit(1);
	}

	const row = doc.rows[0];
	const meta = row.extraction_metadata && typeof row.extraction_metadata === "object" ? row.extraction_metadata : null;

	const counts = await pool.query<{
		total: number;
		null_image_uri: number;
		nonnull_image_uri: number;
	}>(
		"SELECT COUNT(*)::int AS total, SUM(CASE WHEN image_uri IS NULL THEN 1 ELSE 0 END)::int AS null_image_uri, SUM(CASE WHEN image_uri IS NOT NULL THEN 1 ELSE 0 END)::int AS nonnull_image_uri FROM visual_assets WHERE document_id = $1",
		[documentId]
	);

	const exists = await dirExists(renderedDir);
	let files: string[] = [];
	if (exists) {
		try {
			files = (await fs.readdir(renderedDir)).filter((f) => f.toLowerCase().endsWith(".png")).sort();
		} catch {
			files = [];
		}
	}

	const sample = files.slice(0, 5);
	const sampleAbs = sample.map((f) => path.join(renderedDir, f));
	const sampleStats = await Promise.all(sampleAbs.map(async (p) => ({ path: p, exists: await fileExists(p) })));

	console.log(
		JSON.stringify(
			{
				ok: true,
				document_id: documentId,
				page_count: row.page_count,
				upload_dir: uploadDir,
				rendered_pages_dir: renderedDir,
				rendered_pages_dir_exists: exists,
				rendered_pages_png_count: files.length,
				rendered_pages_png_sample: sample,
				rendered_pages_sample_exists: sampleStats,
				extraction_metadata_rendered_pages_dir: meta?.rendered_pages_dir ?? meta?.renderedPagesDir ?? null,
				visual_assets_counts: counts.rows[0] ?? { total: 0, null_image_uri: 0, nonnull_image_uri: 0 },
			},
			null,
			2
		)
	);

	await closePool();
}

main().catch(async (err) => {
	console.error(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }));
	try {
		await closePool();
	} catch {
		// ignore
	}
	process.exit(1);
});
