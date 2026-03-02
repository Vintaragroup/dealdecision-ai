/**
 * audit-populate-registries.ts
 *
 * For the 3 audit deals, iterates every document that has DPU data
 * and runs: Page Registry v1 → Deal Fact Registry v1 → Financial Fact Registry v1.
 *
 * Usage:
 *   pnpm tsx src/scripts/audit-populate-registries.ts
 */

import { getPool, closePool, markDbShuttingDown } from "../lib/db";
import { populatePageRegistryV1 } from "../lib/page-registry/populate-page-registry-v1";
import { populateDealFactRegistryV1 } from "../lib/deal-facts/populate-deal-fact-registry-v1";
import { populateFinancialFactRegistryV1 } from "../lib/financial-facts/populate-financial-fact-registry-v1";

const AUDIT_DEALS: Record<string, string> = {
	WebMax: "23b2fa42-e6d1-4aa3-8fbc-f7aa083846e4",
	DealDecision: "517be946-cab9-4bc1-8982-9522ff9dab32",
	Cinco: "0fcec035-9aa3-4f6e-88fa-818c323add09",
};

const VERSION = "page_understanding_v1";

async function main() {
	const pool = getPool();

	for (const [dealName, dealId] of Object.entries(AUDIT_DEALS)) {
		console.log(`\n${"=".repeat(60)}`);
		console.log(`DEAL: ${dealName} (${dealId})`);
		console.log("=".repeat(60));

		// Get all documents for this deal that have DPU rows
		const { rows: docs } = await pool.query<{
			document_id: string;
			doc_name: string;
			page_count: number;
		}>(
			`
			SELECT DISTINCT
				dpu.document_id,
				COALESCE(d.title, dpu.document_id::text) AS doc_name,
				COALESCE(
					(SELECT dd.page_count FROM documents dd WHERE dd.id = dpu.document_id),
					(MAX(dpu.page_index) + 1)
				)::int AS page_count
			FROM document_page_understanding dpu
			LEFT JOIN documents d ON d.id = dpu.document_id
			WHERE dpu.deal_id = $1::uuid
			GROUP BY dpu.document_id, d.title
			ORDER BY doc_name
			`,
			[dealId]
		);

		if (docs.length === 0) {
			console.log("  [SKIP] No DPU rows found for this deal.");
			continue;
		}

		for (const doc of docs) {
			const { document_id, doc_name, page_count } = doc;
			const pageEnd = Math.max(1, page_count);
			console.log(`\n  DOC: ${doc_name} (${document_id})  pages=0-${pageEnd}`);

			// 1. Page Registry v1
			try {
				const pr = await populatePageRegistryV1(pool as any, {
					dealId,
					documentId: document_id,
					pageStart: 0,
					pageEnd,
					version: VERSION,
				});
				console.log(
					`    page_registry_v1:      ok=${pr.ok}  attempted=${pr.pages_attempted}  upserted=${pr.pages_upserted}  no_text=${pr.pages_skipped_no_text}${pr.error ? `  ERR=${pr.error}` : ""}`
				);
			} catch (e) {
				console.error(`    page_registry_v1 THREW: ${e instanceof Error ? e.message : String(e)}`);
			}

			// 2. Deal Fact Registry v1
			try {
				const df = await populateDealFactRegistryV1(pool as any, {
					dealId,
					documentId: document_id,
				});
				console.log(
					`    deal_facts_v1:         ok=${df.ok}  pages_loaded=${df.pages_loaded}  built=${df.facts_built}  conflicted=${df.facts_conflicted}  upserted=${df.facts_upserted}${df.error ? `  ERR=${df.error}` : ""}`
				);
			} catch (e) {
				console.error(`    deal_facts_v1 THREW: ${e instanceof Error ? e.message : String(e)}`);
			}

			// 3. Financial Fact Registry v1
			try {
				const ff = await populateFinancialFactRegistryV1(pool as any, {
					deal_id: dealId,
					document_id,
				});
				console.log(
					`    financial_facts_v1:    scanned=${ff.pages_scanned}  with_data=${ff.pages_with_data}  extracted=${ff.facts_extracted}  derived=${ff.facts_derived}  upserted=${ff.facts_upserted}  errors=${ff.errors.length}`
				);
				if (ff.errors.length > 0) {
					ff.errors.slice(0, 3).forEach((e) => console.error(`      ERR: ${JSON.stringify(e)}`));
				}
			} catch (e) {
				console.error(`    financial_facts_v1 THREW: ${e instanceof Error ? e.message : String(e)}`);
			}
		}
	}

	// Final count summary
	console.log(`\n${"=".repeat(60)}`);
	console.log("FINAL ROW COUNTS");
	console.log("=".repeat(60));

	const ids = Object.values(AUDIT_DEALS);
	const placeholders = ids.map((_, i) => `$${i + 1}::uuid`).join(", ");

	for (const table of ["page_registry_v1", "financial_facts_v1", "deal_facts_v1"] as const) {
		const { rows } = await pool.query<{ name: string; cnt: number }>(
			`SELECT d.name, count(t.*)::int AS cnt
			 FROM deals d
			 LEFT JOIN ${table} t ON t.deal_id = d.id
			 WHERE d.id IN (${placeholders})
			 GROUP BY d.name ORDER BY d.name`,
			ids
		);
		console.log(`\n  ${table}:`);
		for (const r of rows) {
			console.log(`    ${r.name.padEnd(20)} ${r.cnt}`);
		}
	}

	markDbShuttingDown();
	await closePool();
}

main().catch((e) => {
	console.error("FATAL:", e);
	process.exit(1);
});
