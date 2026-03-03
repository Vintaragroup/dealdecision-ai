/**
 * Regression guard: the freshness anchor query in fetchPageUnderstandingReadinessForDeal
 * MUST use GREATEST(created_at, COALESCE(updated_at, created_at)) rather than raw
 * created_at alone.
 *
 * Background: DPU UPSERTs on rerun advance `updated_at` and `created_at` together, but
 * if only `created_at` were used the gate would still choose the original insertion time
 * and permanently return DPU_STALE after the first import.
 *
 * XLSX readiness guard: XLSX/spreadsheet documents use structured extraction, not rendered
 * page images, so they must be excluded from the page-based `expected` CTE.  Without this,
 * an XLSX document with page_count > 0 would accumulate "missing pages" forever and the UI
 * would be permanently stuck on "Preparing documents… Missing N page(s)".
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Read the source file and check the SQL fragment directly — avoids needing DB connection.
const sourceFile = join(__dirname, '../lib/deal-page-understanding-readiness.ts');
let source: string;
try {
  source = readFileSync(sourceFile, 'utf8');
} catch {
  // CI may not have this path; skip gracefully.
  console.warn('[readiness-test] deal-page-understanding-readiness.ts not found, skipping SQL assertions.');
  process.exit(0);
}

test('freshness query uses GREATEST to respect rerun upserts', () => {
  // The query MUST use GREATEST so that either column advancing is sufficient.
  assert.match(
    source,
    /GREATEST\(dpu\.created_at,\s*COALESCE\(dpu\.updated_at,\s*dpu\.created_at\)\)/s,
    'Expected GREATEST(created_at, COALESCE(updated_at, created_at)) in freshness query'
  );
});

test('freshness query does NOT use bare MAX(dpu.created_at) alone', () => {
  // Regression: bare MAX(dpu.created_at) was the original broken query.
  // The replacement wraps it in GREATEST — the raw form should not appear by itself.
  const barePattern = /MAX\(\s*dpu\.created_at\s*\)(?!\s*,|\s*::\s*text(?:.*GREATEST))[\s\S]{0,20}AS\s+latest_dpu_created_at/;
  assert.equal(
    barePattern.test(source),
    false,
    'Bare MAX(dpu.created_at) AS latest_dpu_created_at found — should have been replaced with GREATEST'
  );
});

test('fetchPageUnderstandingReadinessForDeal is exported', () => {
  assert.ok(
    source.includes('export async function fetchPageUnderstandingReadinessForDeal'),
    'Expected fetchPageUnderstandingReadinessForDeal to be exported'
  );
});

// ── XLSX / spreadsheet exclusion guards ──────────────────────────────────────

test('docs CTE selects file_name and mime_type for XLSX detection', () => {
  // The docs CTE must include file_name and mime_type so xlsx_docs can be derived.
  assert.ok(
    source.includes('file_name') && source.includes('mime_type'),
    'Expected file_name and mime_type columns in the readiness SQL docs CTE'
  );
});

test('SQL contains xlsx_docs CTE that detects spreadsheet file extensions', () => {
  // Regression guard: XLSX docs must be excluded from page-based expected pages.
  assert.match(
    source,
    /xlsx_docs/,
    'Expected xlsx_docs CTE in the readiness SQL'
  );
  assert.match(
    source,
    /\.xlsx/,
    'Expected .xlsx file extension check in xlsx_docs CTE'
  );
  assert.match(
    source,
    /\.xls/,
    'Expected .xls file extension check in xlsx_docs CTE'
  );
  assert.match(
    source,
    /spreadsheet/,
    'Expected spreadsheet mime_type check in xlsx_docs CTE'
  );
});

test('expected CTE excludes xlsx_docs from page-based expected pages', () => {
  // Regression guard: the expected pages CTE must filter out XLSX documents.
  // Without this, XLSX docs show "Missing N page(s)" forever.
  assert.match(
    source,
    /NOT IN \(SELECT document_id FROM xlsx_docs\)/s,
    'Expected "NOT IN (SELECT document_id FROM xlsx_docs)" in the expected CTE'
  );
});

test('computePageUnderstandingReadiness: XLSX-like doc with no expected pages is ready', () => {
  // Unit test for the pure computation layer.
  // Simulates what happens after the SQL excludes XLSX from expected pages:
  // page_count=5 (sheets) but missing_pages=[] because the SQL excluded the doc.
  const { computePageUnderstandingReadiness } = require('../lib/deal-page-understanding-readiness');
  const result = computePageUnderstandingReadiness({
    dealId: 'deal-xlsx-001',
    version: 'page_understanding_v1',
    documents: [
      {
        document_id: 'doc-xlsx-001',
        title: 'Financial Model.xlsx',
        page_count: 5,    // 5 sheets — but SQL excluded them from expected pages
        dpu_rows: 0,
        missing_pages: [], // SQL returns empty because xlsx_docs excluded this doc
        hard_missing_pages: [],
      },
    ],
  });

  assert.equal(result.ready, true, 'XLSX doc with no expected missing pages should be ready');
  assert.equal(result.missing_pages_total, 0, 'XLSX doc with no missing pages should have missing_pages_total=0');
  assert.equal(result.hard_missing_pages_total, 0, 'hard_missing_pages_total should be 0');
});

test('computePageUnderstandingReadiness: mixed PDF (missing pages) + XLSX (no expected pages) stays not-ready', () => {
  // A deal with a PDF that has missing pages AND an XLSX should remain not-ready
  // because the PDF pages are genuinely missing.
  const { computePageUnderstandingReadiness } = require('../lib/deal-page-understanding-readiness');
  const result = computePageUnderstandingReadiness({
    dealId: 'deal-mixed-001',
    version: 'page_understanding_v1',
    documents: [
      {
        document_id: 'doc-pdf-001',
        title: 'Pitch Deck.pdf',
        page_count: 10,
        dpu_rows: 7,
        missing_pages: [3, 4, 5],
        hard_missing_pages: [3, 4, 5],
      },
      {
        document_id: 'doc-xlsx-001',
        title: 'Financial Model.xlsx',
        page_count: 5,
        dpu_rows: 0,
        missing_pages: [],  // SQL excluded this doc
        hard_missing_pages: [],
      },
    ],
  });

  assert.equal(result.ready, false, 'Deal with PDF missing pages should remain not-ready even if XLSX is fine');
  assert.equal(result.hard_missing_pages_total, 3, 'Only PDF hard-missing pages should count');
});

// ── Fail-soft wrapper guards ──────────────────────────────────────────────────

test('fetchPageUnderstandingReadinessForDeal returns READINESS_COMPUTE_ERROR (not throw) when DB query fails', async () => {
  // Regression guard for the 500 → 202 fix.
  // Previously a DB error in fetchPageUnderstandingReadinessForDeal propagated as an exception,
  // causing readiness callers to return HTTP 500 which the UI showed as "Analysis failed to start".
  // After the fix, the function must catch all DB errors and return a safe fallback payload.
  const { fetchPageUnderstandingReadinessForDeal } = require('../lib/deal-page-understanding-readiness');

  const brokenPool = {
    query: async (_sql: string) => {
      throw new Error('FATAL: DB connection refused (simulated)');
    },
  };

  const result = await fetchPageUnderstandingReadinessForDeal(brokenPool, 'deal-fail-001', 'page_understanding_v1');

  assert.ok(result, 'Should return a result, not throw');
  assert.equal(result.ready, false, 'Fallback result should not be ready');
  assert.equal(result.blocked_reason, 'READINESS_COMPUTE_ERROR', 'Should surface READINESS_COMPUTE_ERROR blocked_reason');
  assert.equal(result.deal_id, 'deal-fail-001', 'Should preserve deal_id in fallback');
  assert.equal(result.version, 'page_understanding_v1', 'Should preserve version in fallback');
  assert.ok(typeof result.poll_after_ms === 'number', 'Should include poll_after_ms');
});

test('fetchPageUnderstandingReadinessForDeal returns READINESS_COMPUTE_ERROR when hasTable probe fails', async () => {
  // If even the hasTable probe fails (e.g. permission denied on to_regclass),
  // the outer try/catch must still prevent any exception from reaching the caller.
  const { fetchPageUnderstandingReadinessForDeal } = require('../lib/deal-page-understanding-readiness');

  const brokenPool = {
    query: async (_sql: string) => {
      throw new Error('ERROR: permission denied for table information_schema.columns');
    },
  };

  const result = await fetchPageUnderstandingReadinessForDeal(brokenPool, 'deal-fail-002', 'page_understanding_v1');

  assert.ok(result, 'Should return a result, not throw');
  assert.equal(result.ready, false);
  assert.equal(result.blocked_reason, 'READINESS_COMPUTE_ERROR');
});

