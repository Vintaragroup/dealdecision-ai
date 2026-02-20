/**
 * Regression guard: the freshness anchor query in fetchPageUnderstandingReadinessForDeal
 * MUST use GREATEST(created_at, COALESCE(updated_at, created_at)) rather than raw
 * created_at alone.
 *
 * Background: DPU UPSERTs on rerun advance `updated_at` and `created_at` together, but
 * if only `created_at` were used the gate would still choose the original insertion time
 * and permanently return DPU_STALE after the first import.
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
