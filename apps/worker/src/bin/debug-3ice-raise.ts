/**
 * debug-3ice-raise.ts
 *
 * Diagnose why raise_terms was NotComputable for 3ICE despite
 * the pitch deck containing "raising approximately $10M".
 *
 * Deal  : 61ef36dd-391a-4a4e-b30b-1f5d1f19f91e
 * Doc   : 6af4720f-77fc-476e-acc5-b330c7e2fa2e
 * Page  : 33  (0-indexed)
 *
 * Usage (from apps/worker/):
 *   node -r ./src/bin/load-env.cjs tmp/debug-3ice-raise.cjs
 *
 * Outputs:
 *   - DPU page count for deal
 *   - Every page whose text matches RAISE_ANCHOR (verb) near a money token
 *   - Whether RAISE_AMOUNT_PATTERN (before and after fix) matches each candidate
 */
import { Pool } from "pg";
import { normalizeForExtraction } from "../jobs/investor-insights/normalize";

const DEAL_ID = "61ef36dd-391a-4a4e-b30b-1f5d1f19f91e";
const DOC_ID  = "6af4720f-77fc-476e-acc5-b330c7e2fa2e";

// ── Inline re-definitions of the patterns (mirrors processor.ts) ──────────────

const CURRENCY       = String.raw`(?:\$|€|£|\bUSD\b|\bEUR\b|\bGBP\b)`;
const AMOUNT         = String.raw`\d{1,3}(?:[,\d]{0,3})*(?:\.\d+)?`;
const SUFFIX         = String.raw`(?:\s*(?:MM|BB|[KMBTkmbt]|thousand|million|billion|trillion)\b)?`;
const MONEY_FRAGMENT = String.raw`${CURRENCY}\s*${AMOUNT}${SUFFIX}`;
const RAISE_ANCHOR   = String.raw`(?:rais(?:e|ing|ed)|seeking|fund(?:ed|ing)?|financ(?:ed|ing)?|invest(?:ment|ing)?|offer(?:ing)?|proceeds|allocation)`;
const _NO_CUR        = `[^$€£\\n]`;

/** Old Form A — no adverb support (what was failing 3ICE) */
const OLD_RAISE_AMOUNT_PATTERN = new RegExp(
  `${RAISE_ANCHOR}\\s+${MONEY_FRAGMENT}` +
  `|${MONEY_FRAGMENT}${_NO_CUR}{0,40}?\\b${RAISE_ANCHOR}\\b`,
  "i"
);

/** New Form A — with _RAISE_ADVERB (the fix) */
const _RAISE_ADVERB = String.raw`(?:approximately|about|around|roughly|~\s*|over|under|nearly|some|a\s+total\s+of|up\s+to|at\s+least|just\s+over)?\s*`;
const NEW_RAISE_AMOUNT_PATTERN = new RegExp(
  `${RAISE_ANCHOR}\\s+${_RAISE_ADVERB}${MONEY_FRAGMENT}` +
  `|${MONEY_FRAGMENT}${_NO_CUR}{0,40}?\\b${RAISE_ANCHOR}\\b`,
  "i"
);

// ── DB setup ──────────────────────────────────────────────────────────────────

const cs = process.env.DATABASE_URL;
if (!cs) { console.error("DATABASE_URL not set"); process.exit(1); }

const pool = new Pool({
  connectionString: cs,
  ssl: cs.includes("sslmode=require") || process.env.PGSSLMODE === "require"
    ? { rejectUnauthorized: false }
    : false,
});

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== debug-3ice-raise ===");
  console.log(`Deal ID : ${DEAL_ID}`);
  console.log(`Doc ID  : ${DOC_ID}\n`);

  // 1. Page count
  const countRes = await pool.query<{ total: string }>(
    `SELECT COUNT(*)::bigint AS total
       FROM public.document_page_understanding
      WHERE deal_id = $1::uuid`,
    [DEAL_ID]
  );
  console.log(`DPU pages for deal : ${countRes.rows[0]?.total ?? 0}\n`);

  // 2. Fetch all pages for the deal, look for raise-adjacent money tokens
  const pagesRes = await pool.query<{
    document_id: string;
    page_index: number;
    payload: { page_text?: string; normalized_text?: string };
  }>(
    `SELECT document_id, page_index, payload
       FROM public.document_page_understanding
      WHERE deal_id = $1::uuid
      ORDER BY document_id, page_index`,
    [DEAL_ID]
  );

  console.log(`=== Raise-signal scan across ${pagesRes.rows.length} pages ===\n`);

  let foundCount = 0;
  for (const row of pagesRes.rows) {
    const rawText = row.payload?.page_text ?? row.payload?.normalized_text ?? "";
    if (!rawText) continue;

    const { text: normText } = normalizeForExtraction(rawText);

    // Quick pre-filter: must contain a RAISE_ANCHOR-like word
    if (!/rais|seek|fund|financ|invest|offer|proceed|allocat/i.test(normText)) continue;

    const docShort = row.document_id.replace(/-/g, "").slice(0, 8);
    const ref = `dpu:doc:${docShort}:page:${row.page_index}`;

    const oldMatch = OLD_RAISE_AMOUNT_PATTERN.exec(normText);
    const newMatch = NEW_RAISE_AMOUNT_PATTERN.exec(normText);

    if (oldMatch || newMatch) {
      foundCount++;
      console.log(`─ ${ref}`);
      // Show ~120 chars around the match
      const matchText = (newMatch ?? oldMatch)![0];
      const idx = normText.indexOf(matchText);
      const start = Math.max(0, idx - 40);
      const end   = Math.min(normText.length, idx + matchText.length + 80);
      console.log(`  Context : "${normText.slice(start, end)}"`);
      console.log(`  old match : ${oldMatch ? JSON.stringify(oldMatch[0]) : "— NO MATCH —"}`);
      console.log(`  new match : ${newMatch ? JSON.stringify(newMatch[0]) : "— NO MATCH —"}`);
      console.log();
    }
  }

  if (foundCount === 0) {
    console.log("No raise signals found. Check DPU payload field names.");
  }

  // 3. Targeted check: page 33 of the known doc
  console.log("=== Targeted page 33 check ===\n");
  const p33Res = await pool.query<{
    page_index: number;
    payload: { page_text?: string };
  }>(
    `SELECT page_index, payload
       FROM public.document_page_understanding
      WHERE deal_id = $1::uuid
        AND document_id = $2::uuid
        AND page_index = 33
      LIMIT 1`,
    [DEAL_ID, DOC_ID]
  );

  if (!p33Res.rows.length) {
    console.log("Page 33 not found for this doc_id.  Is the doc_id correct?");
  } else {
    const pageText = p33Res.rows[0]?.payload?.page_text ?? "";
    console.log(`Raw page_text (first 300): "${pageText.slice(0, 300)}"`);
    const { text: norm } = normalizeForExtraction(pageText);
    console.log(`Normalized  (first 300): "${norm.slice(0, 300)}"`);
    console.log();
    console.log(`OLD pattern match : ${JSON.stringify(OLD_RAISE_AMOUNT_PATTERN.exec(norm)?.[0] ?? null)}`);
    console.log(`NEW pattern match : ${JSON.stringify(NEW_RAISE_AMOUNT_PATTERN.exec(norm)?.[0] ?? null)}`);
  }
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => pool.end());
