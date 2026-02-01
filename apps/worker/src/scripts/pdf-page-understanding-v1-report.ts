import { Client } from "pg";

const WEBMAX = {
	deal_id: "6d308e3f-4d22-42da-938f-060ad3a409b2",
	document_id: "23b9f6a4-71ec-45e7-95cd-a6b82d3ca33b",
	label: "WebMax",
};

const THREE_ICE = {
	deal_id: "2bd8864c-b35d-4982-a9e1-83df13385bb1",
	document_id: "9e3e15e2-1e9b-4eeb-b8e1-ddcce489ab3e",
	label: "3ICE",
};

async function main() {
	const databaseUrl = process.env.DATABASE_URL;
	if (!databaseUrl) {
		console.error("Missing DATABASE_URL (e.g. postgresql://postgres:postgres@localhost:55432/dealdecision)");
		process.exit(1);
	}

	const client = new Client({ connectionString: databaseUrl });
	await client.connect();

	for (const t of [THREE_ICE, WEBMAX]) {
		const docRes = await client.query(
			"SELECT id, deal_id, title, page_count FROM documents WHERE id = $1 LIMIT 1",
			[t.document_id]
		);
		const doc = docRes.rows[0];
		const pagesTotal = typeof doc?.page_count === "number" ? doc.page_count : null;

		const pagesRes = await client.query(
			"SELECT COUNT(*)::int AS n FROM document_page_understanding WHERE document_id = $1 AND version = 'page_understanding_v1'",
			[t.document_id]
		);
		const pagesPersisted = pagesRes.rows?.[0]?.n ?? 0;

		const kmRes = await client.query(
			`SELECT
			   COUNT(*)::int AS total,
			   COUNT(*) FILTER (WHERE NULLIF(km->>'linked_asset_id','') IS NOT NULL)::int AS linked
			 FROM document_page_understanding dpu,
			      LATERAL jsonb_array_elements(COALESCE(dpu.payload->'key_metrics','[]'::jsonb)) km
			 WHERE dpu.document_id = $1 AND dpu.version = 'page_understanding_v1'`,
			[t.document_id]
		);
		const kmTotal = kmRes.rows?.[0]?.total ?? 0;
		const kmLinked = kmRes.rows?.[0]?.linked ?? 0;

		const regionRes = await client.query(
			`SELECT
			   COUNT(*)::int AS total,
			   COUNT(*) FILTER (WHERE NULLIF(r->>'linked_asset_id','') IS NOT NULL)::int AS linked
			 FROM document_page_understanding dpu,
			      LATERAL jsonb_array_elements(COALESCE(dpu.payload->'regions','[]'::jsonb)) r
			 WHERE dpu.document_id = $1 AND dpu.version = 'page_understanding_v1'`,
			[t.document_id]
		);
		const rTotal = regionRes.rows?.[0]?.total ?? 0;
		const rLinked = regionRes.rows?.[0]?.linked ?? 0;

		const kmPct = kmTotal > 0 ? ((100 * kmLinked) / kmTotal).toFixed(1) : "-";
		const rPct = rTotal > 0 ? ((100 * rLinked) / rTotal).toFixed(1) : "-";

		console.log("==", t.label, "==");
		console.log("document_id:", t.document_id);
		console.log("title:", doc?.title ?? "-");
		console.log("page_count:", pagesTotal ?? "-");
		console.log("pages_persisted:", pagesPersisted);
		console.log("regions linked:", rLinked, "/", rTotal, "(", rPct, "%)");
		console.log("metrics linked:", kmLinked, "/", kmTotal, "(", kmPct, "%)");
		console.log("");
	}

	await client.end();
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
