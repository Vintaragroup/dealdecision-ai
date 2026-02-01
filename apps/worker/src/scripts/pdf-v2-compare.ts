/*
Small harness to compare PDF v1 vs v2 (shadow artifacts) on a local PDF.

Usage:
  pnpm -C apps/worker tsx src/scripts/pdf-v2-compare.ts /path/to/file.pdf --doc-id <uuid>

Notes:
- Requires vision_worker to be running (VISION_BASE_URL) for v2 native extraction.
- Does NOT write to DB.
*/

import fs from "fs/promises";
import path from "path";

import { extractPDFContent } from "../lib/processors/pdf";
import { extractPDFContentV2Shadow } from "../lib/processors/pdf-v2";

function normalizeText(s: unknown): string {
	if (typeof s !== "string") return "";
	return s.replace(/\s+/g, " ").trim();
}

function snippet(s: string, max = 180): string {
	const t = normalizeText(s);
	if (!t) return "";
	return t.length > max ? `${t.slice(0, max)}…` : t;
}

function getArg(flag: string): string | null {
	const idx = process.argv.indexOf(flag);
	if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
	return null;
}

async function main() {
	const pdfPath = process.argv[2];
	if (!pdfPath) throw new Error("missing pdf path arg");

	const docId = getArg("--doc-id") || path.basename(pdfPath);

	const buf = await fs.readFile(pdfPath);

	const v1 = await extractPDFContent(buf, { docId });
	const v2 = await extractPDFContentV2Shadow(buf, { docId, fileName: path.basename(pdfPath) });

	const v2Pages = Array.isArray((v2 as any)?.pages) ? ((v2 as any).pages as any[]) : [];
	const v2ByPageNum = new Map<number, any>();
	for (const p of v2Pages) {
		const n = typeof p?.page_number === "number" ? p.page_number : typeof p?.page_index === "number" ? p.page_index + 1 : null;
		if (typeof n === "number" && Number.isFinite(n)) v2ByPageNum.set(n, p);
	}

	const perPage = (Array.isArray(v1.pages) ? v1.pages : []).map((p) => {
		const pageNumber = p.pageNumber;
		const v1Text = typeof p.text === "string" ? p.text : "";
		const v1Len = normalizeText(v1Text).length;

		const v2p = v2ByPageNum.get(pageNumber) ?? null;
		const v2Final = v2p?.final?.text;
		const v2FinalText = typeof v2Final === "string" ? v2Final : "";
		const v2Len = normalizeText(v2FinalText).length;

		return {
			page: pageNumber,
			v1: {
				text_len: v1Len,
				snippet: snippet(v1Text),
			},
			v2: {
				classification: v2p?.classification?.kind ?? null,
				final_method: v2p?.final?.method ?? null,
				native_method: v2p?.native?.method ?? null,
				text_len: v2Len,
				snippet: snippet(v2FinalText),
				ocr_len: typeof v2p?.ocr?.text === "string" ? normalizeText(v2p.ocr.text).length : 0,
				ocr_v2_len: typeof v2p?.ocr_v2?.text === "string" ? normalizeText(v2p.ocr_v2.text).length : 0,
				ocr_v2_snippet: typeof v2p?.ocr_v2?.text === "string" ? snippet(v2p.ocr_v2.text) : "",
				ocr_v2_avg_conf: typeof v2p?.ocr_v2?.avg_confidence === "number" ? v2p.ocr_v2.avg_confidence : null,
			},
		};
	});

	const allStats = perPage.map((r) => ({
		page: r.page,
		v1: { text_len: r.v1.text_len },
		v2: {
			classification: r.v2.classification,
			final_method: r.v2.final_method,
			text_len: r.v2.text_len,
			ocr_len: r.v2.ocr_len,
			ocr_v2_len: r.v2.ocr_v2_len,
			ocr_v2_avg_conf: r.v2.ocr_v2_avg_conf,
		},
	}));

	const notablePages = perPage
		.filter((r) => {
			// Surface pages where v2 is not purely native, or where it materially changes the amount of text.
			if (r.v2.final_method && r.v2.final_method !== "native") return true;
			const delta = Math.abs((r.v2.text_len || 0) - (r.v1.text_len || 0));
			return delta >= 200;
		})
		.slice(0, 12);

	console.log(
		JSON.stringify(
			{
				doc_id: docId,
				v1: {
					pages: v1.summary.processedPages,
					total_words: v1.summary.totalWords,
					ocr_used: Boolean(v1.summary.ocrUsed),
				},
				v2: {
					status: v2.status,
					extractor_version: v2.extractor_version,
					summary: v2.summary ?? null,
					error: v2.error ?? null,
				},
				pages: {
					count: perPage.length,
					notable: notablePages,
					all: allStats,
				},
			},
			null,
			2
		)
	);
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : String(err));
	process.exit(1);
});
