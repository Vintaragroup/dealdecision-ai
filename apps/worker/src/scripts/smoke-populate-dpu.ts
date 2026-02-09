import { getPool, closePool, markDbShuttingDown } from "../lib/db";
import { populateDocumentPageUnderstandingFromVisualExtractions } from "../lib/document-page-understanding";

function parseArg(flag: string): string | undefined {
	const idx = process.argv.indexOf(flag);
	if (idx === -1) return undefined;
	const val = process.argv[idx + 1];
	if (!val || val.startsWith("--")) return undefined;
	return val;
}

async function main() {
	const pool = getPool();

	const forcedDocumentId = parseArg("--document-id");

	const documentId = forcedDocumentId
		? forcedDocumentId
		: (
				await pool.query<{ document_id: string }>(
					`
					SELECT va.document_id
					  FROM public.visual_assets va
					  JOIN public.visual_extractions ve
						ON ve.visual_asset_id = va.id
					   AND ve.extractor_version = va.extractor_version
					 GROUP BY va.document_id
					 ORDER BY COUNT(*) DESC
					 LIMIT 1
					`
				)
		  ).rows?.[0]?.document_id;

	if (!documentId) {
		console.error("[smoke-populate-dpu] No document found with visual_extractions; cannot run smoke.");
		process.exit(2);
	}

	const pageCountRes = await pool.query<{ page_count: number }>(
		`
		SELECT COALESCE(
			(SELECT d.page_count FROM public.documents d WHERE d.id = $1::uuid),
			(SELECT (MAX(va.page_index) + 1) FROM public.visual_assets va WHERE va.document_id = $1::uuid),
			0
		)::int AS page_count
		`,
		[documentId]
	);
	const pageCount = pageCountRes.rows?.[0]?.page_count ?? 0;
	const pageEnd = Math.max(0, Math.floor(pageCount));

	if (!Number.isFinite(pageEnd) || pageEnd <= 0) {
		console.error(`[smoke-populate-dpu] page_count is not valid for document_id=${documentId}; page_count=${pageCount}`);
		process.exit(3);
	}

	const result = await populateDocumentPageUnderstandingFromVisualExtractions(pool, {
		documentId,
		pageStart: 0,
		pageEnd,
		version: "page_understanding_v1",
	});

	console.log(
		JSON.stringify({
			event: "SMOKE_POPULATE_DPU_RESULT",
			document_id: documentId,
			page_start: 0,
			page_end: pageEnd,
			version: "page_understanding_v1",
			upserted: result.upserted,
			page_text_empty: result.page_text_empty,
			ts: new Date().toISOString(),
		})
	);

	if (result.upserted <= 0) {
		console.error(
			`[smoke-populate-dpu] FAIL: upserted=0 for document_id=${documentId} range=0-${pageEnd} (need visual_assets+visual_extractions in range)`
		);
		process.exit(1);
	}
}

main()
	.catch((err) => {
		console.error("[smoke-populate-dpu] ERROR", err);
		process.exit(1);
	})
	.finally(async () => {
		try {
			markDbShuttingDown();
			await closePool();
		} catch {
			// ignore
		}
	});
