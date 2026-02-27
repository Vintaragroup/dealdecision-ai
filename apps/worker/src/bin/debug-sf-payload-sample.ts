import { Pool } from "pg";
import fs from "fs";

const cs = process.env.DATABASE_URL!;
const pool = new Pool({ connectionString: cs, ssl: cs.includes("sslmode=require") ? { rejectUnauthorized: false } : false });

async function main() {
  const { rows } = await pool.query(`
    SELECT page_index,
           payload->>'page_type' AS type,
           payload->>'sheet_name' AS sheet_name,
           payload::text AS full_payload
    FROM document_page_understanding
    WHERE document_id = '1cc11a36-4e9f-40cf-b927-ea4e3155f4f4'
      AND page_index IN (0, 1, 8, 9)
    ORDER BY page_index
  `);

  const out: Record<string, unknown> = {};
  for (const r of rows) {
    const key = `page_${r.page_index}_${(r.sheet_name || "noname").replace(/\s+/g, "_")}`;
    out[key] = JSON.parse(r.full_payload);
  }
  fs.writeFileSync("/tmp/sf_dpu_payload_sample.json", JSON.stringify(out, null, 2));
  console.log("wrote /tmp/sf_dpu_payload_sample.json, size=" + JSON.stringify(out).length);
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });

