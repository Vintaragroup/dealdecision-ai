/**
 * debug-stackfactor-xlsx-db.ts
 *
 * DB diagnostics for StackFactor XLSX Use-of-Funds pipeline.
 * Answers the question: does the XLSX pipeline produce any
 * segment_key="use_of_funds" rows for StackFactor?
 *
 * Chain being validated:
 *   XLSX upload → vision_worker extract-xlsx
 *     → document_page_understanding (page_type=excel_range, segment_key)
 *     → visual_extractions (structured_json.segment_key)
 *     → parseUseOfFundsV1 (segment_key="use_of_funds")
 *     → render_package.use_of_funds_v1
 *     → insight_slots.use_of_funds = Computable (reason=DERIVED_FROM_USE_OF_FUNDS)
 *
 * Usage (from apps/worker/):
 *   pnpm tsx --require ./src/bin/load-env.cjs src/bin/debug-stackfactor-xlsx-db.ts
 */

import fs from "fs";
import path from "path";
import { Pool } from "pg";

const DEAL_ID = "adb2a1cf-bbb1-4f3b-8735-e2249415124f"; // StackFactor

const cs = process.env.DATABASE_URL;
if (!cs) { console.error("DATABASE_URL not set"); process.exit(1); }

const pool = new Pool({
  connectionString: cs,
  ssl:
    cs.includes("sslmode=require") || process.env.PGSSLMODE === "require"
      ? { rejectUnauthorized: false }
      : false,
});

// ─── helpers ──────────────────────────────────────────────────────────────────

function hr(title: string) {
  console.log(`\n${"─".repeat(70)}`);
  console.log(`  ${title}`);
  console.log("─".repeat(70));
}

function trunc(s: string | null | undefined, n = 200): string {
  if (!s) return "(null)";
  return s.length <= n ? s : s.slice(0, n) + `…(+${s.length - n})`;
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const report: Record<string, unknown> = { deal_id: DEAL_ID, generated_at: new Date().toISOString() };

  // ── 1. All documents for StackFactor ──────────────────────────────────────
  hr("1. DOCUMENTS FOR STACKFACTOR DEAL");

  const docsRes = await pool.query<{
    id: string;
    filename: string | null;
    mime_type: string | null;
    uploaded_at: string;
  }>(
    `SELECT d.id::text, f.file_name AS filename, COALESCE(f.mime_type, d.mime_type) AS mime_type, d.uploaded_at
       FROM documents d
       LEFT JOIN document_files f ON f.document_id = d.id
      WHERE d.deal_id = $1
      ORDER BY d.uploaded_at`,
    [DEAL_ID],
  );

  console.log(`Total documents: ${docsRes.rows.length}`);
  for (const d of docsRes.rows) {
    console.log(`  ${d.id.slice(0, 8)}  ${(d.mime_type ?? "").padEnd(70)}  ${d.filename ?? "(no filename)"}`);
  }

  const xlsxDocs = docsRes.rows.filter(
    (d) =>
      d.mime_type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      d.mime_type === "application/vnd.ms-excel" ||
      (d.filename ?? "").toLowerCase().endsWith(".xlsx") ||
      (d.filename ?? "").toLowerCase().endsWith(".xls"),
  );

  console.log(`\nXLSX documents: ${xlsxDocs.length}`);
  for (const d of xlsxDocs) {
    console.log(`  ✓ ${d.id.slice(0, 8)}  ${d.filename}`);
  }

  report["docs_total"] = docsRes.rows.length;
  report["docs_xlsx"] = xlsxDocs.map((d) => ({ id: d.id.slice(0, 8), filename: d.filename, mime: d.mime_type }));

  if (xlsxDocs.length === 0) {
    console.log("\n⚠  No XLSX documents found for this deal. Pipeline cannot produce use_of_funds from XLSX.");
  }

  // ── 2. DPU rows for XLSX documents ────────────────────────────────────────
  hr("2. DOCUMENT_PAGE_UNDERSTANDING ROWS (all docs)");

  const dpuRes = await pool.query<{
    doc_id: string;
    filename: string | null;
    page_index: number;
    page_type: string | null;
    segment_key: string | null;
    text_len: number;
    text_preview: string | null;
  }>(
    `SELECT
       d.id::text    AS doc_id,
       f.file_name   AS filename,
       dpu.page_index,
       dpu.payload->>'page_type'    AS page_type,
       dpu.payload->>'segment_key'  AS segment_key,
       length(dpu.payload->>'page_text') AS text_len,
       left(dpu.payload->>'page_text', 300) AS text_preview
     FROM document_page_understanding dpu
     JOIN documents d ON d.id = dpu.document_id
     LEFT JOIN document_files f ON f.document_id = d.id
    WHERE d.deal_id = $1::uuid
    ORDER BY d.uploaded_at, dpu.page_index`,
    [DEAL_ID],
  );

  console.log(`Total DPU rows across all docs: ${dpuRes.rows.length}`);

  // Group by doc
  const dpuByDoc = new Map<string, typeof dpuRes.rows>();
  for (const row of dpuRes.rows) {
    const key = row.doc_id.slice(0, 8);
    if (!dpuByDoc.has(key)) dpuByDoc.set(key, []);
    dpuByDoc.get(key)!.push(row);
  }

  const dpuSummary: unknown[] = [];
  for (const [docPrefix, rows] of dpuByDoc.entries()) {
    const fname = rows[0]?.filename ?? "?";
    console.log(`\n  doc=${docPrefix}  filename="${fname}"  pages=${rows.length}`);
    const segKeys = [...new Set(rows.map((r) => r.segment_key ?? "(null)"))];
    const pageTypes = [...new Set(rows.map((r) => r.page_type ?? "(null)"))];
    console.log(`  page_types   : ${pageTypes.join(", ")}`);
    console.log(`  segment_keys : ${segKeys.join(", ")}`);

    const uofRows = rows.filter((r) => r.segment_key === "use_of_funds");
    if (uofRows.length > 0) {
      console.log(`  ★ use_of_funds rows: ${uofRows.length}`);
      for (const r of uofRows) {
        console.log(`    page=${r.page_index}  text_len=${r.text_len}  preview: ${trunc(r.text_preview, 150)}`);
      }
    } else {
      console.log(`  ✗ no use_of_funds segment_key rows`);
    }

    dpuSummary.push({
      doc: docPrefix,
      filename: fname,
      pages: rows.length,
      page_types: pageTypes,
      segment_keys: segKeys,
      uof_row_count: uofRows.length,
    });
  }

  report["dpu_by_doc"] = dpuSummary;

  // ── 3. Excel-range DPU rows specifically ──────────────────────────────────
  hr("3. EXCEL_RANGE DPU ROWS (all docs)");

  const excelRows = dpuRes.rows.filter(
    (r) => r.page_type === "excel_range" || r.page_type === "excel_sheet_overview",
  );

  console.log(`excel_range / excel_sheet_overview rows: ${excelRows.length}`);
  for (const r of excelRows) {
    console.log(`  doc=${r.doc_id.slice(0, 8)}  page=${r.page_index}  type=${r.page_type}  seg=${r.segment_key ?? "(null)"}  len=${r.text_len}`);
    if (r.text_preview) {
      console.log(`    text: ${trunc(r.text_preview, 200)}`);
    }
  }

  report["excel_range_rows"] = excelRows.map((r) => ({
    doc: r.doc_id.slice(0, 8),
    filename: r.filename,
    page: r.page_index,
    type: r.page_type,
    segment_key: r.segment_key,
    text_len: r.text_len,
    text_preview: trunc(r.text_preview, 200),
  }));

  // ── 4. visual_extractions for all docs ────────────────────────────────────
  hr("4. VISUAL_EXTRACTIONS (segment_key breakdown)");

  const veRes = await pool.query<{
    ve_id: string;
    doc_id: string;
    filename: string | null;
    segment_key: string | null;
    sj_keys: string | null;
    sj_preview: string | null;
  }>(
    `SELECT
       ve.id::text AS ve_id,
       d.id::text  AS doc_id,
       f.file_name AS filename,
       ve.structured_json->>'segment_key'  AS segment_key,
       array_to_string(ARRAY(SELECT jsonb_object_keys(ve.structured_json)), ',') AS sj_keys,
       left(ve.structured_json::text, 300) AS sj_preview
     FROM visual_extractions ve
     JOIN visual_assets va ON va.id = ve.visual_asset_id
     JOIN documents d      ON d.id  = va.document_id
     LEFT JOIN document_files f ON f.document_id = d.id
    WHERE d.deal_id = $1::uuid
      AND ve.structured_json IS NOT NULL
    ORDER BY d.uploaded_at, ve.id`,

    [DEAL_ID],
  );

  console.log(`Total visual_extractions rows with structured_json: ${veRes.rows.length}`);

  // Segment key frequency
  const skFreq = new Map<string, number>();
  for (const r of veRes.rows) {
    const sk = r.segment_key ?? "(null)";
    skFreq.set(sk, (skFreq.get(sk) ?? 0) + 1);
  }
  console.log("\n  segment_key distribution:");
  for (const [sk, count] of [...skFreq.entries()].sort()) {
    const marker = sk === "use_of_funds" ? " ★" : "";
    console.log(`    ${sk.padEnd(25)} : ${count}${marker}`);
  }

  const uofVeRows = veRes.rows.filter((r) => r.segment_key === "use_of_funds");
  console.log(`\n  use_of_funds rows: ${uofVeRows.length}`);
  for (const r of uofVeRows) {
    console.log(`    ve_id=${r.ve_id.slice(0, 8)}  doc=${r.doc_id.slice(0, 8)}  ${r.filename}`);
    console.log(`    sj keys : ${r.sj_keys}`);
    console.log(`    preview : ${trunc(r.sj_preview, 250)}`);
  }

  report["ve_segment_keys"] = Object.fromEntries(skFreq);
  report["ve_uof_rows"] = uofVeRows.map((r) => ({
    ve_id: r.ve_id.slice(0, 8),
    doc: r.doc_id.slice(0, 8),
    filename: r.filename,
    sj_keys: r.sj_keys,
    sj_preview: trunc(r.sj_preview, 250),
  }));

  // ── 5. "financials" rows that might contain UoF text ──────────────────────
  hr("5. FINANCIALS SEGMENT ROWS (text scan for UoF keywords)");

  const UOF_KEYWORDS = [
    "use of funds", "use of proceeds", "use of capital",
    "sources and uses", "sources & uses",
    "capital allocation", "allocation of",
    "funding breakdown", "investment breakdown",
    "where the money goes", "how we plan to use",
  ];

  const finRows = dpuRes.rows.filter((r) => r.segment_key === "financials" || r.segment_key === "(null)");
  console.log(`Scanning ${finRows.length} financials/(null) DPU rows for UoF keywords…`);

  let kwHitCount = 0;
  const kwHits: unknown[] = [];
  for (const r of finRows) {
    const txt = (r.text_preview ?? "").toLowerCase();
    const hits = UOF_KEYWORDS.filter((kw) => txt.includes(kw.toLowerCase()));
    if (hits.length > 0) {
      kwHitCount++;
      console.log(`  ★ doc=${r.doc_id.slice(0, 8)}  page=${r.page_index}  seg=${r.segment_key}  kw_hits: [${hits.join(", ")}]`);
      console.log(`    preview: ${trunc(r.text_preview, 200)}`);
      kwHits.push({ doc: r.doc_id.slice(0, 8), page: r.page_index, segment_key: r.segment_key, kw_hits: hits });
    }
  }
  if (kwHitCount === 0) {
    console.log("  ✗ No DPU rows contain UoF keywords (in first 300 chars of page_text).");
    console.log("    → Either XLSX has no UoF sheet, or extraction hasn't run.");
  }

  report["uof_kw_hits_in_dpu"] = kwHits;

  // ── 6. Current render_package for StackFactor ─────────────────────────────
  hr("6. CURRENT RENDER_PACKAGE (use_of_funds_v1 + insight_slots)");

  const rpRes = await pool.query<{ render_package: Record<string, unknown>; updated_at: string }>(
    `SELECT render_package, updated_at
       FROM investor_insight_reports
      WHERE deal_id = $1
      ORDER BY updated_at DESC LIMIT 1`,
    [DEAL_ID],
  );

  if (!rpRes.rows.length) {
    console.log("No investor_insight_reports row found for this deal.");
    report["render_package"] = null;
  } else {
    const rp = rpRes.rows[0].render_package;
    const updatedAt = rpRes.rows[0].updated_at;
    console.log(`Report updated_at: ${updatedAt}`);

    // section keys
    const sections = (rp?.["sections"] as { key: string }[] | undefined) ?? [];
    const sectionKeys = sections.map((s) => s.key);
    console.log(`section_keys: [${sectionKeys.join(", ")}]`);

    // use_of_funds_v1
    const uofSec = sections.find((s) => s.key === "use_of_funds_v1");
    if (uofSec) {
      console.log(`\n✅ use_of_funds_v1 section PRESENT`);
      const body = (uofSec as Record<string, unknown>)["body"];
      console.log(`  body (first 400): ${trunc(typeof body === "string" ? body : JSON.stringify(body), 400)}`);
    } else {
      console.log(`\n✗ use_of_funds_v1 section ABSENT`);
    }

    // insight_slots
    const slotsSec = sections.find((s) => s.key === "insight_slots");
    const slotsBody = typeof (slotsSec as Record<string, unknown> | undefined)?.["body"] === "string"
      ? ((slotsSec as Record<string, unknown>)["body"] as string)
      : null;
    const uofSlotLine = slotsBody?.split("\n").find((l) => l.includes("use_of_funds"));
    console.log(`\ninsight_slots.use_of_funds line: ${uofSlotLine ?? "(not found)"}`);

    report["render_package"] = {
      updated_at: updatedAt,
      section_keys: sectionKeys,
      has_use_of_funds_v1: !!uofSec,
      uof_slot_line: uofSlotLine ?? null,
    };
  }

  // ── 7. Diagnosis summary ──────────────────────────────────────────────────
  hr("7. DIAGNOSIS SUMMARY");

  const hasXlsx = xlsxDocs.length > 0;
  const hasExcelRangeDpu = excelRows.length > 0;
  const hasUofSegmentKey = uofVeRows.length > 0;
  const hasUofKwInDpu = kwHitCount > 0;

  const steps = [
    { ok: hasXlsx,           label: "XLSX document exists for deal" },
    { ok: hasExcelRangeDpu,  label: "excel_range DPU rows exist (vision_worker ran)" },
    { ok: hasUofSegmentKey,  label: "visual_extractions row with segment_key=use_of_funds" },
    { ok: hasUofKwInDpu,     label: "DPU page_text contains UoF keywords (even if mis-segmented)" },
  ];

  for (const s of steps) {
    console.log(`  ${s.ok ? "✅" : "✗"} ${s.label}`);
  }

  console.log("\n  Probable root cause:");
  if (!hasXlsx) {
    console.log("  → NO XLSX DOCUMENT: Deal has no XLSX uploaded. use_of_funds=NOT_PRESENT is correct.");
  } else if (!hasExcelRangeDpu) {
    console.log("  → XLSX NOT EXTRACTED: vision_worker has not run extract-xlsx for this deal.");
    console.log("    Fix: re-enqueue document processing, or check ENABLE_PY_EXCEL_EXTRACTION flag.");
  } else if (!hasUofSegmentKey && !hasUofKwInDpu) {
    console.log("  → NO UoF CONTENT: XLSX has no Use-of-Funds sheet or row keywords. NOT_PRESENT is correct.");
  } else if (!hasUofSegmentKey && hasUofKwInDpu) {
    console.log("  → SEGMENTATION MISS: DPU rows contain UoF keyword text but segment_key != 'use_of_funds'.");
    console.log("    Fix: update _UOF_SHEET_NAME_PATTERNS / _UOF_ROW_PATTERNS in xlsx_structured.py,");
    console.log("    then re-enqueue XLSX extraction for this deal.");
  } else if (hasUofSegmentKey) {
    console.log("  → WIRING BUG: segment_key=use_of_funds exists in visual_extractions but");
    console.log("    parseUseOfFundsV1 or evalUseOfFundsSlot is not consuming it.");
    console.log("    Check: parseUseOfFundsV1 filters, DPU page_type, segment_key propagation.");
  }

  report["diagnosis"] = { hasXlsx, hasExcelRangeDpu, hasUofSegmentKey, hasUofKwInDpu };

  // ── 8. Write output ──────────────────────────────────────────────────────
  const tmpDir = path.join(process.cwd(), "tmp");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const outPath = path.join(tmpDir, "stackfactor-xlsx-db-diagnostics.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\n[debug-stackfactor-xlsx-db] Wrote: ${outPath}`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
