/**
 * DPU Stale Recovery — proof harness
 *
 * Verifies two invariants of the `action_detail` payload produced by
 * ensureDocumentsReadyForAnalysis when blocked_reason === 'DPU_STALE':
 *
 *  1. job_id is DETERMINISTIC — same doc/DPU state ⟹ same job_id;
 *     different page counts ⟹ different job_id (distinct docs_fingerprint).
 *
 *  2. 202-equivalent payload shape — result carries `action_detail` and
 *     `stale_diagnostics` with the expected structure, types, and field values.
 *
 * Uses the exact same mock infrastructure pattern as
 * ensure-documents-ready-dpu-stale.test.ts — no new dependencies.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ensureDocumentsReadyForAnalysis } from '../lib/ensure-documents-ready-for-analysis';

// ─── Constants ────────────────────────────────────────────────────────────────

const DEAL_ID        = '00000000-0000-0000-0000-222222222222';
const DOC_ID         = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const OLD_TIMESTAMP  = '2020-01-01T00:00:00.000Z';
// Set min_dpu_created_at in the future so that OLD_TIMESTAMP always fails the freshness gate.
const FRESH_TOKEN    = new Date(Date.now() + 86_400_000).toISOString();

const VALID_STALE_REASONS = new Set([
  'fingerprint_mismatch',
  'timestamp_old',
  'doc_set_changed',
  'unknown',
] as const);

// ─── Mock builders ────────────────────────────────────────────────────────────

/**
 * Builds a minimal mock pool that puts the deal in a DPU_STALE state.
 * The `pageCount` param controls the docs_fingerprint so we can engineer fingerprint
 * collisions (same value) and divergences (different value) in test 1.
 */
function buildPool(opts: { pageCount?: number; latestDpuCreatedAt?: string | null } = {}) {
  const pageCount          = opts.pageCount ?? 10;
  const latestDpuCreatedAt = opts.latestDpuCreatedAt ?? OLD_TIMESTAMP;

  return {
    query: async (sql: string) => {
      // hasColumn probes
      if (sql.includes('information_schema.columns')) return { rows: [{ ok: 1 }] };

      // documents query
      if (sql.includes('d.extraction_metadata') && sql.includes('d.full_text')) {
        return {
          rows: [{
            id:                       DOC_ID,
            title:                    'Proof Deck',
            status:                   'ready_for_analysis',
            page_count:               pageCount,
            extraction_metadata: {
              rendered_pages_r2:        { prefix: 'r2://bucket/proof' },
              rendered_pages_count:     pageCount,
              rendered_pages_rendered:  pageCount,
            },
            full_text:                null,
            full_text_absent_reason:  null,
            file_name:                'proof.pdf',
            mime_type:                'application/pdf',
          }],
        };
      }

      // DPU table existence check
      if (sql.includes('to_regclass')) return { rows: [{ oid: 'document_page_understanding' }] };

      // DPU readiness query — all pages covered (stale by timestamp, not by gaps)
      if (sql.includes('WITH docs AS') && sql.includes('document_page_understanding')) {
        return {
          rows: [{
            document_id:          DOC_ID,
            title:                'Proof Deck',
            page_count:           pageCount,
            dpu_rows:             pageCount,
            dpu_rows_meaningful:  pageCount,
            non_meaningful_pages: [],
            missing_pages:        [],
            hard_missing_pages:   [],
          }],
        };
      }

      // Freshness query: returns the configured latestDpuCreatedAt
      if (sql.includes('MAX(GREATEST') && sql.includes('latest_dpu_created_at')) {
        return { rows: [{ latest_dpu_created_at: latestDpuCreatedAt }] };
      }

      // Self-heal guard: no recent DPU job → self-heal enqueues
      if (sql.includes('FROM jobs') && sql.includes('populate_document_page_understanding')) {
        return { rows: [] };
      }

      // Lightweight doc-shape query used inside readiness render
      if (
        sql.includes('FROM documents d') &&
        sql.includes('COALESCE(d.page_count') &&
        !sql.includes('d.extraction_metadata')
      ) {
        return {
          rows: [{ id: DOC_ID, page_count: pageCount, file_name: 'proof.pdf', mime_type: 'application/pdf' }],
        };
      }

      // Render-jobs guard (not exercised here)
      if (sql.includes('FROM jobs') && sql.includes("interval '2 hours'")) return { rows: [] };

      return { rows: [] };
    },
  } as any;
}

function buildEnqueue() {
  const enqueue = async (_input: unknown) => ({ job_id: 'job-mock', status: 'queued' as any });
  return { enqueue };
}

// ─── Shared args factory ──────────────────────────────────────────────────────

function baseArgs(pool: ReturnType<typeof buildPool>) {
  const { enqueue } = buildEnqueue();
  return {
    pool,
    dealId:                   DEAL_ID,
    requirePageUnderstanding: true,
    pageUnderstandingVersion: 'page_understanding_v1' as const,
    forceRefresh:             false,
    minDpuCreatedAt:          FRESH_TOKEN,
    enqueue,
  };
}

// ─── Test 1: job_id is deterministic ─────────────────────────────────────────

test('action_detail.job_id is deterministic — same state → same value; different state → different value', async () => {
  const pool10 = buildPool({ pageCount: 10 });

  // Two calls with identical DB state must return the identical job_id
  const [r1, r2] = await Promise.all([
    ensureDocumentsReadyForAnalysis(baseArgs(pool10)),
    ensureDocumentsReadyForAnalysis(baseArgs(pool10)),
  ]);

  assert.ok(r1.action_detail != null, 'Call 1: action_detail must be present when DPU is stale');
  assert.ok(r2.action_detail != null, 'Call 2: action_detail must be present when DPU is stale');

  assert.strictEqual(
    r1.action_detail!.job_id,
    r2.action_detail!.job_id,
    `job_id must be identical for the same DB state.\n  call1: ${r1.action_detail!.job_id}\n  call2: ${r2.action_detail!.job_id}`
  );

  // A different pageCount produces a different docs_fingerprint → different job_id
  const pool20 = buildPool({ pageCount: 20 });
  const r3     = await ensureDocumentsReadyForAnalysis(baseArgs(pool20));

  assert.ok(r3.action_detail != null, 'Call 3 (20 pages): action_detail must be present');

  assert.notStrictEqual(
    r1.action_detail!.job_id,
    r3.action_detail!.job_id,
    `job_id must differ when pageCount changes (fingerprint diverges).\n  10-page: ${r1.action_detail!.job_id}\n  20-page: ${r3.action_detail!.job_id}`
  );

  // Both job_ids must follow the canonical format: dpu_backfill:{dealId}:{fp}:page_understanding_v1
  for (const [label, id] of [
    ['10-page', r1.action_detail!.job_id],
    ['20-page', r3.action_detail!.job_id],
  ] as const) {
    assert.ok(
      id.startsWith(`dpu_backfill:${DEAL_ID}:`),
      `${label} job_id must start with 'dpu_backfill:{dealId}:'. Got: ${id}`
    );
    assert.ok(
      id.endsWith(':page_understanding_v1'),
      `${label} job_id must end with ':page_understanding_v1'. Got: ${id}`
    );
  }
});

// ─── Test 2: 202-equivalent payload shape ────────────────────────────────────

test('DPU_STALE result carries correctly-shaped stale_diagnostics and action_detail', async () => {
  const result = await ensureDocumentsReadyForAnalysis(baseArgs(buildPool({ pageCount: 12 })));

  // ── Gate 1 precondition ──
  assert.strictEqual(result.ready,          false,                  'Must be not-ready for stale DPU');
  assert.strictEqual(result.blocked_reason, 'DPU_STALE',           'blocked_reason must be DPU_STALE');
  assert.strictEqual(result.action,         'enqueue_dpu_backfill', 'action must be enqueue_dpu_backfill');

  // ── action_detail ──
  const ad = result.action_detail;
  assert.ok(ad != null, 'action_detail must be present when action=enqueue_dpu_backfill');

  assert.strictEqual(ad!.type, 'enqueue_dpu_backfill', 'action_detail.type must be enqueue_dpu_backfill');

  assert.ok(
    typeof ad!.job_id === 'string' && ad!.job_id.length > 0,
    'action_detail.job_id must be a non-empty string'
  );
  assert.ok(
    ad!.job_id.startsWith('dpu_backfill:'),
    `job_id must start with 'dpu_backfill:'. Got: ${ad!.job_id}`
  );
  assert.ok(
    ad!.job_id.endsWith(':page_understanding_v1'),
    `job_id must end with ':page_understanding_v1'. Got: ${ad!.job_id}`
  );

  assert.ok(
    typeof ad!.docs_fingerprint === 'string' && ad!.docs_fingerprint.length > 0,
    'action_detail.docs_fingerprint must be a non-empty string'
  );
  assert.ok(
    ad!.job_id.includes(ad!.docs_fingerprint),
    `job_id must embed docs_fingerprint.\n  job_id: ${ad!.job_id}\n  fp:     ${ad!.docs_fingerprint}`
  );
  assert.strictEqual(
    ad!.docs_fingerprint,
    result.docs_fingerprint,
    'action_detail.docs_fingerprint must equal result.docs_fingerprint'
  );

  // ── stale_diagnostics ──
  const sd = result.stale_diagnostics;
  assert.ok(sd != null, 'stale_diagnostics must be present when blocked_reason is set');

  assert.ok(
    VALID_STALE_REASONS.has(sd!.stale_reason as any),
    `stale_diagnostics.stale_reason="${sd!.stale_reason}" is not a recognised enum value: ${[...VALID_STALE_REASONS].join(', ')}`
  );

  // Timestamp-old scenario: deal has OLD_TIMESTAMP and no expectedDocsFingerprint
  assert.strictEqual(
    sd!.stale_reason,
    'timestamp_old',
    `Expected stale_reason=timestamp_old for old-DPU / no expectedDocsFingerprint scenario. Got: ${sd!.stale_reason}`
  );

  assert.ok(Array.isArray(sd!.per_doc), 'stale_diagnostics.per_doc must be an array');
  assert.ok(sd!.per_doc.length > 0, 'stale_diagnostics.per_doc must have at least one entry');

  const firstDoc = sd!.per_doc[0];
  assert.ok(typeof firstDoc.document_id    === 'string', 'per_doc[0].document_id must be a string');
  assert.ok(typeof firstDoc.expected_pages === 'number', 'per_doc[0].expected_pages must be a number');
  assert.ok(typeof firstDoc.dpu_rows       === 'number', 'per_doc[0].dpu_rows must be a number');
  assert.ok(typeof firstDoc.missing_pages  === 'number', 'per_doc[0].missing_pages must be a number');

  assert.strictEqual(
    sd!.docs_fingerprint,
    result.docs_fingerprint,
    'stale_diagnostics.docs_fingerprint must equal result.docs_fingerprint'
  );
});
