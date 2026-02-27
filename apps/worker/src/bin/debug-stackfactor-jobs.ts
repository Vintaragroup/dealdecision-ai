import { Pool } from "pg";

const DEAL_ID = "adb2a1cf-bbb1-4f3b-8735-e2249415124f";
const cs = process.env.DATABASE_URL;
if (!cs) { console.error("DATABASE_URL not set"); process.exit(1); }

const pool = new Pool({
  connectionString: cs,
  ssl: cs.includes("sslmode=require") || process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : false,
});

async function main() {
  // 1. Check jobs table for stuck/completed jobs
  const { rows: jobRows } = await pool.query<{
    job_id: string;
    queue: string;
    jstatus: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT job_id,
            queue,
            status_detail->>'status' AS jstatus,
            created_at::text,
            updated_at::text
       FROM jobs
      WHERE job_id LIKE '%1cc11a36%' OR job_id LIKE '%88b6e45d%'
      ORDER BY created_at DESC LIMIT 30`
  );

  console.log("\n=== JOBS TABLE (extract_visuals chunks) ===");
  if (jobRows.length === 0) console.log("  No jobs found.");
  for (const r of jobRows) {
    console.log(`  ${(r.jstatus ?? "?").padEnd(12)} | ${(r.queue ?? "?").padEnd(25)} | ${r.job_id}`);
  }

  // 2. Check visual_assets for XLSX docs
  const { rows: vaRows } = await pool.query<{
    doc_id: string;
    filename: string | null;
    va_id: string;
    page_index: number;
    extractor_version: string | null;
    created_at: string;
  }>(
    `SELECT d.id::text AS doc_id,
            f.file_name AS filename,
            va.id::text AS va_id,
            va.page_index,
            va.extractor_version,
            va.created_at::text
       FROM visual_assets va
       JOIN documents d ON d.id = va.document_id
       LEFT JOIN document_files f ON f.document_id = d.id
      WHERE d.deal_id = $1
        AND (COALESCE(f.mime_type, d.mime_type) = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
             OR f.file_name ILIKE '%.xlsx')
      ORDER BY d.uploaded_at, va.page_index
      LIMIT 100`,
    [DEAL_ID]
  );

  console.log(`\n=== VISUAL_ASSETS for XLSX docs (${vaRows.length} rows) ===`);
  for (const r of vaRows) {
    console.log(`  doc=${r.doc_id.slice(0, 8)}  page=${r.page_index}  extractor=${r.extractor_version}  va_id=${r.va_id.slice(0, 8)}  filename=${r.filename}`);
  }

  // 3. Check visual_extractions for XLSX docs
  const { rows: veRows } = await pool.query<{
    doc_id: string;
    filename: string | null;
    ve_id: string;
    page_index: number;
    extractor_version: string | null;
    sj_kind: string | null;
    sj_segment: string | null;
  }>(
    `SELECT d.id::text AS doc_id,
            f.file_name AS filename,
            ve.id::text AS ve_id,
            va.page_index,
            ve.extractor_version,
            ve.structured_json->>'kind' AS sj_kind,
            ve.structured_json->>'segment_key' AS sj_segment
       FROM visual_extractions ve
       JOIN visual_assets va ON va.id = ve.visual_asset_id
       JOIN documents d ON d.id = va.document_id
       LEFT JOIN document_files f ON f.document_id = d.id
      WHERE d.deal_id = $1
        AND (COALESCE(f.mime_type, d.mime_type) = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
             OR f.file_name ILIKE '%.xlsx')
      ORDER BY d.uploaded_at, va.page_index
      LIMIT 100`,
    [DEAL_ID]
  );

  console.log(`\n=== VISUAL_EXTRACTIONS for XLSX docs (${veRows.length} rows) ===`);
  for (const r of veRows) {
    console.log(`  doc=${r.doc_id.slice(0, 8)}  page=${r.page_index}  extractor=${r.extractor_version}  kind=${r.sj_kind}  segment=${r.sj_segment}`);
  }

  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
