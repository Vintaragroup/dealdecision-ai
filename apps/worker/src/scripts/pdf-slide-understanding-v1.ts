import fs from "fs/promises";
import path from "path";
import { processDocument } from "../lib/processors";

function parseArgs(argv: string[]) {
	const out: Record<string, string | boolean> = {};
	let i = 0;
	while (i < argv.length) {
		const a = argv[i];
		if (!a) {
			i += 1;
			continue;
		}
		if (a === "--doc-id") {
			out["docId"] = String(argv[i + 1] || "");
			i += 2;
			continue;
		}
		if (a === "--out") {
			out["out"] = String(argv[i + 1] || "");
			i += 2;
			continue;
		}
		if (a === "--help") {
			out["help"] = true;
			i += 1;
			continue;
		}
		if (!out["file"]) {
			out["file"] = a;
			i += 1;
			continue;
		}
		i += 1;
	}
	return out;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help || !args.file) {
		console.log("Usage: tsx src/scripts/pdf-slide-understanding-v1.ts <file.pdf> [--doc-id <id>] [--out <path.json>]");
		console.log("Env:");
		console.log("  VISION_WORKER_URL=http://127.0.0.1:8000");
		console.log("  PDF_EXTRACT_MODE=v2_shadow|v2_primary (default v1)");
		console.log("  PDF_SLIDE_UNDERSTANDING_MODE=shadow (default off)");
		process.exit(0);
	}

	const filePath = path.resolve(String(args.file));
	const fileName = path.basename(filePath);
	const docId = String(args.docId || "harness_doc");
	const dealId = "harness_deal";
	const outPath = String(args.out || path.resolve(process.cwd(), `artifacts/slide_understanding.${docId}.json`));

	// Force slide-understanding shadow mode for this harness unless user explicitly overrides.
	if (!process.env.PDF_SLIDE_UNDERSTANDING_MODE) process.env.PDF_SLIDE_UNDERSTANDING_MODE = "shadow";
	if (!process.env.PDF_EXTRACT_MODE) process.env.PDF_EXTRACT_MODE = "v2_shadow";

	const buf = await fs.readFile(filePath);
	const analysis = await processDocument(buf, fileName, docId, dealId);

	const pdf = analysis.contentType === "pdf" ? (analysis.content as any) : null;
	const pdfV2 = pdf?.pdf_v2;
	const pages = Array.isArray(pdfV2?.pages) ? pdfV2.pages : [];

	const sample = pages
		.filter((p: any) => p?.understanding_v1)
		.slice(0, 5)
		.map((p: any) => ({
			page_index: p.page_index,
			classification: p.classification?.kind,
			final_method: p.final?.method,
			title: p.understanding_v1?.title,
			slide_type: p.understanding_v1?.slide_type,
			metrics: (p.understanding_v1?.key_metrics || []).slice(0, 5).map((m: any) => ({ label: m.label, value: m.value, unit: m.unit })),
			summary: p.understanding_v1?.summary,
		}));

	const payload = {
		doc_id: docId,
		file: filePath,
		contentType: analysis.contentType,
		pdf_extract_mode: process.env.PDF_EXTRACT_MODE,
		slide_understanding_mode: process.env.PDF_SLIDE_UNDERSTANDING_MODE,
		pdf_v2_status: pdfV2?.status ?? null,
		pages_with_understanding: pages.filter((p: any) => Boolean(p?.understanding_v1)).length,
		sample,
		pdf_v2: pdfV2,
	};

	await fs.mkdir(path.dirname(outPath), { recursive: true });
	await fs.writeFile(outPath, JSON.stringify(payload, null, 2), "utf8");
	console.log(JSON.stringify({ ok: true, out: outPath, pages: pages.length, pages_with_understanding: payload.pages_with_understanding }, null, 2));
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
