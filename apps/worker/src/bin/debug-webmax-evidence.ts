/**
 * debug-webmax-evidence.mts
 *
 * Deep-dive debug for WebMax traction_signal BAD_EVIDENCE_REF.
 * Evidence ref: dpu:doc:58595eb2:page:1
 *
 * Usage (from apps/worker/):
 *   node -r ./src/bin/load-env.cjs tmp/debug-webmax-evidence.cjs
 */
import { Pool } from "pg";
import { normalizeForExtraction } from "../jobs/investor-insights/normalize";

// Inline snippet finder (mirrors audit-investor-insights.ts exactly)
function findSnippetInPageText(snippet: string, pageText: string): boolean {
  if (!snippet || !pageText) return false;
  const norm = normalizeForExtraction(snippet.trim()).text;
  const haystack = normalizeForExtraction(pageText).text;
  if (haystack.toLowerCase().includes(norm.toLowerCase())) return true;
  const stub = norm.slice(0, Math.min(40, norm.length));
  return stub.length > 3 && haystack.toLowerCase().includes(stub.toLowerCase());
}

const DEAL_ID = "23b2fa42-e6d1-4aa3-8fbc-f7aa083846e4";
const TARGET_REF = "dpu:doc:58595eb2:page:1";
const STORED_SNIPPET = "Retention ratio / 60.00%";
const DOC_PREFIX = "58595eb2";

const cs = process.env.DATABASE_URL;
if (!cs) { console.error("DATABASE_URL not set"); process.exit(1); }

const pool = new Pool({
  connectionString: cs,
  ssl: cs.includes("sslmode=require") || process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : false,
});

async function main() {
  // ─── 1. Fetch stored insight_slots body for WebMax ─────────────────
  console.log("=== 1. STORED INVESTOR INSIGHTS SLOTS (WebMax) ===\n");
  const repRes = await pool.query<{ render_package: Record<string, unknown>; updated_at: string }>(
    `SELECT render_package, updated_at FROM investor_insight_reports
     WHERE deal_id = $1 ORDER BY updated_at DESC LIMIT 1`,
    [DEAL_ID]
  );
  if (!repRes.rows.length) { console.log("No report found."); } else {
    const rp = repRes.rows[0].render_package as Record<string, unknown>;
    const slotsBody = (rp?.insight_slots ?? (rp?.sections as Record<string, unknown> | undefined)?.insight_slots ?? null) as string | null;
    console.log("Updated at:", repRes.rows[0].updated_at);
    const traction = typeof slotsBody === "string"
      ? slotsBody.split("\n").find(l => l.includes("traction_signal"))
      : null;
    if (traction) {
      console.log("traction_signal line:", traction);
    } else {
      console.log("Keys in render_package:", Object.keys(rp ?? {}));
      if (slotsBody) console.log("insight_slots body (first 400):", String(slotsBody).slice(0, 400));
      else console.log("insight_slots body: NOT FOUND");
    }
  }

  // ─── 2. Fetch DPU row at the evidence ref ──────────────────────────
  console.log("\n=== 2. DPU ROW: doc=" + DOC_PREFIX + " page_index=1 ===\n");
  const dpuRes = await pool.query<{
    document_id: string;
    page_index: number;
    page_text: string | null;
  }>(
    `SELECT document_id::text, page_index, payload->>'page_text' AS page_text
     FROM document_page_understanding
     WHERE deal_id = $1
       AND document_id::text LIKE $2
       AND page_index = 1
     LIMIT 5`,
    [DEAL_ID, DOC_PREFIX + "%"]
  );

  if (!dpuRes.rows.length) {
    console.log("❌ No DPU row found for doc=" + DOC_PREFIX + " page_index=1");
  } else {
    for (const row of dpuRes.rows) {
      const pt = row.page_text ?? "(null)";
      console.log("document_id:   ", row.document_id);
      console.log("page_index:    ", row.page_index);
      console.log("page_text len: ", pt.length);
      console.log("page_text (first 500 chars):\n", pt.slice(0, 500));
      console.log("\n--- normalized page_text (first 500) ---");
      const normPt = normalizeForExtraction(pt).text;
      console.log(normPt.slice(0, 500));

      // ─── 3. Snippet resolution attempt ─────────────────────────────
      console.log("\n=== 3. SNIPPET RESOLUTION ===\n");
      console.log("Stored snippet:     ", JSON.stringify(STORED_SNIPPET));
      const normSnip = normalizeForExtraction(STORED_SNIPPET.trim()).text;
      console.log("Normalized snippet: ", JSON.stringify(normSnip));
      const stub = normSnip.slice(0, Math.min(40, normSnip.length));
      console.log("Stub (first 40):    ", JSON.stringify(stub));

      const normHaystack = normPt.toLowerCase();
      const fullMatch   = normHaystack.includes(normSnip.toLowerCase());
      const stubMatch   = stub.length > 3 && normHaystack.includes(stub.toLowerCase());
      const snippetOk   = findSnippetInPageText(STORED_SNIPPET, pt);

      console.log("full match:  ", fullMatch);
      console.log("stub match:  ", stubMatch);
      console.log("findSnippet: ", snippetOk);

      if (!fullMatch) {
        // Find nearest tokens in normalized page_text
        console.log("\n--- Nearest token search ---");
        const tokens = normSnip.toLowerCase().split(/\s+/).filter(t => t.length > 2);
        for (const tok of tokens) {
          const idx = normHaystack.indexOf(tok);
          if (idx !== -1) {
            console.log(`  token "${tok}" FOUND at ${idx}: ...${normHaystack.slice(Math.max(0,idx-20), idx+tok.length+40)}...`);
          } else {
            console.log(`  token "${tok}" NOT FOUND in normalized page_text`);
          }
        }
      }
    }
  }

  // ─── 4. Scan ALL non-empty DPU pages for this doc ───────────────────
  console.log("\n=== 4. ALL NON-EMPTY DPU PAGES FOR docs=" + DOC_PREFIX + " ===\n");
  const allPagesRes = await pool.query<{
    document_id: string;
    page_index: number;
    page_text: string | null;
  }>(
    `SELECT document_id::text, page_index, payload->>'page_text' AS page_text
     FROM document_page_understanding
     WHERE deal_id = $1
       AND document_id::text LIKE $2
       AND payload->>'page_text' IS NOT NULL
       AND length(payload->>'page_text') > 0
     ORDER BY page_index`,
    [DEAL_ID, DOC_PREFIX + "%"]
  );
  console.log("Non-empty pages:", allPagesRes.rows.length);
  for (const r of allPagesRes.rows) {
    const pt = r.page_text ?? "";
    const hasSnippet = findSnippetInPageText(STORED_SNIPPET, pt);
    const preview = pt.replace(/\n/g, " ").slice(0, 80);
    console.log(`  page ${r.page_index}: len=${pt.length} | snippet_found=${hasSnippet} | "${preview}"`);
  }

  // ─── 5. Check the PDF doc (ae9a45e5) for the snippet ───────────────
  console.log("\n=== 5. CHECK PDF DOC (ae9a45e5) FOR SNIPPET ===\n");
  const pdfRes = await pool.query<{
    document_id: string;
    page_index: number;
    page_text: string | null;
  }>(
    `SELECT document_id::text, page_index, payload->>'page_text' AS page_text
     FROM document_page_understanding
     WHERE deal_id = $1
       AND document_id::text LIKE $2
       AND payload->>'page_text' IS NOT NULL
       AND length(payload->>'page_text') > 0
     ORDER BY page_index`,
    [DEAL_ID, "ae9a45e5%"]
  );
  let found = false;
  for (const r of pdfRes.rows) {
    const pt = r.page_text ?? "";
    if (findSnippetInPageText(STORED_SNIPPET, pt)) {
      found = true;
      console.log(`✅ Snippet FOUND in PDF ae9a45e5 page_index=${r.page_index}`);
      console.log("   Text context:", pt.replace(/\n/g, " ").slice(0, 200));
      break;
    }
  }
  if (!found) console.log("Snippet not found in any PDF page either.");

  await pool.end();
}

main().catch(e => { console.error(e); pool.end().catch(()=>{}); process.exit(1); });
