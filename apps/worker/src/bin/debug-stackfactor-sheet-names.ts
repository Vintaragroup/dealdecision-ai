/**
 * debug-stackfactor-sheet-names.ts
 * Quick query: show all DPU rows for StackFactor XLSX docs, incl. sheet names.
 */
import { Pool } from "pg";

const DEAL_ID = "adb2a1cf-bbb1-4f3b-8735-e2249415124f"; // StackFactor

const cs = process.env.DATABASE_URL;
if (!cs) { console.error("DATABASE_URL not set"); process.exit(1); }

const pool = new Pool({
  connectionString: cs,
  ssl: cs.includes("sslmode=require") || process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : false,
});

async function main() {
  // Find XLSX docs for the deal
  const { rows: xlsxDocs } = await pool.query<{ id: string; filename: string | null }>(
    `SELECT d.id::text, f.file_name AS filename
       FROM documents d
       LEFT JOIN document_files f ON f.document_id = d.id
      WHERE d.deal_id = $1
        AND (f.mime_type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
             OR d.mime_type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
             OR f.file_name ILIKE '%.xlsx')
      ORDER BY d.uploaded_at`,
    [DEAL_ID],
  );

  if (xlsxDocs.length === 0) {
    console.log("No XLSX docs found for this deal.");
    await pool.end(); return;
  }

  for (const doc of xlsxDocs) {
    console.log(`\n${"═".repeat(70)}`);
    console.log(`  ${doc.filename ?? "(no name)"}  (doc_id=${doc.id})`);
    console.log("═".repeat(70));

    const { rows } = await pool.query<{
      page_index: number;
      page_type: string | null;
      sheet_name: string | null;
      page_text_len: number;
      preview: string | null;
    }>(
      `SELECT
         page_index,
         payload->>'page_type'    AS page_type,
         payload->>'sheet_name'   AS sheet_name,
         length(payload->>'page_text') AS page_text_len,
         left(payload->>'page_text', 350) AS preview
       FROM document_page_understanding
       WHERE document_id = $1::uuid
       ORDER BY page_index`,
      [doc.id],
    );

    if (rows.length === 0) {
      console.log("  (no DPU rows — document never processed)\n");
      continue;
    }

    console.log(`  Total DPU rows: ${rows.length}`);
    const types = [...new Set(rows.map(r => r.page_type ?? "(null)"))];
    console.log(`  page_types: ${types.join(", ")}`);
    console.log();

    for (const r of rows) {
      const sheetLabel = r.sheet_name ? `  sheet="${r.sheet_name}"` : "";
      console.log(`  page=${String(r.page_index).padStart(2)}  type=${(r.page_type ?? "null").padEnd(25)}${sheetLabel}`);
      if (r.preview && r.preview.trim()) {
        const lines = r.preview.trim().split("\n").slice(0, 5);
        for (const line of lines) {
          console.log(`         | ${line.slice(0, 120)}`);
        }
      }
    }
  }

  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
