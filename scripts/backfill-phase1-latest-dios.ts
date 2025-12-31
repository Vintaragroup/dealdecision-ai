export {};

import { Pool } from "pg";
import {
	generatePhase1DIOV1,
	mergePhase1IntoDIO,
} from "../packages/core/src/phase1/phase1-dio-v1";

type LatestDIORow = {
	dio_id: string;
	deal_id: string;
	analysis_version: number;
	dio_data: any;
};

function env(name: string): string {
	const v = process.env[name];
	if (!v) throw new Error(`Missing env var ${name}`);
	return v;
}

async function main() {
	const databaseUrl = process.env.DATABASE_URL || env("DATABASE_URL");
	const pool = new Pool({ connectionString: databaseUrl });

	const { rows } = await pool.query<LatestDIORow>(
		`
		WITH latest AS (
			SELECT DISTINCT ON (dio.deal_id)
				dio.dio_id,
				dio.deal_id,
				dio.analysis_version,
				dio.dio_data
			FROM deal_intelligence_objects dio
			JOIN deals d ON d.id = dio.deal_id
			WHERE d.deleted_at IS NULL
			ORDER BY dio.deal_id, dio.analysis_version DESC
		)
		SELECT dio_id, deal_id, analysis_version, dio_data
		FROM latest
		WHERE NOT (dio_data ? 'dio')
		   OR (dio_data #> '{dio,phase1,executive_summary_v1}') IS NULL
		ORDER BY analysis_version DESC;
		`
	);

	if (rows.length === 0) {
		console.log("No latest DIO rows need Phase 1 backfill.");
		await pool.end();
		return;
	}

	console.log(`Found ${rows.length} latest DIO row(s) missing Phase 1.`);

	let updated = 0;
	let failed = 0;

	for (const row of rows) {
		try {
			const dio = row.dio_data && typeof row.dio_data === "object" ? row.dio_data : {};
			const docsRaw = (dio as any)?.inputs?.documents;
			const docs = Array.isArray(docsRaw) ? docsRaw : [];

			const phase1 = generatePhase1DIOV1({
				deal: {
					deal_id: row.deal_id,
					name: null,
					stage: null,
				},
				inputDocuments: docs
					.filter((d: any) => d && typeof d === "object")
					.map((d: any) => ({
						document_id: String(d.document_id ?? ""),
						title: d.title ?? null,
						type: d.type ?? null,
						page_count: d.page_count ?? null,
						full_text: typeof d.full_text === "string" ? d.full_text : undefined,
						fullText: typeof d.fullText === "string" ? d.fullText : undefined,
						text_summary: typeof d.text_summary === "string" ? d.text_summary : undefined,
						summary: typeof d.summary === "string" ? d.summary : undefined,
						mainHeadings: Array.isArray(d.mainHeadings) ? d.mainHeadings : undefined,
						headings: Array.isArray(d.headings) ? d.headings : undefined,
						keyMetrics: Array.isArray(d.keyMetrics) ? d.keyMetrics : undefined,
						metrics: Array.isArray(d.metrics) ? d.metrics : undefined,
						pages: Array.isArray(d.pages) ? d.pages : undefined,
					}))
					.filter((d: any) => d.document_id.trim().length > 0),
			});

			let next = mergePhase1IntoDIO(dio as any, phase1) as any;
			next = { ...next, updated_at: new Date().toISOString() };

			await pool.query(
				`UPDATE deal_intelligence_objects SET dio_data = $2, updated_at = now() WHERE dio_id = $1`,
				[row.dio_id, next]
			);

			updated += 1;
			console.log(
				`Backfilled Phase 1 for deal_id=${row.deal_id} dio_id=${row.dio_id} (version=${row.analysis_version})`
			);
		} catch (err) {
			failed += 1;
			const message = err instanceof Error ? err.message : String(err);
			console.warn(
				`Failed Phase 1 backfill for deal_id=${row.deal_id} dio_id=${row.dio_id}: ${message}`
			);
		}
	}

	console.log(`Done. updated=${updated} failed=${failed}`);
	await pool.end();
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
