process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerDealRoutes } from '../src/routes/deals';
import { closeQueues } from '../src/lib/queue';

test.after(async () => {
  await closeQueues();
});

test('GET /api/v1/deals/:dealId/lineage returns segment_audit_report when requested', async () => {
  const dealId = 'deal-audit-1';

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const q = String(sql);
      const p0 = Array.isArray(params) ? params[0] : undefined;

      if (q.includes('to_regclass')) {
        return { rows: [{ oid: 'ok' }] };
      }

      if (q.includes('information_schema.columns')) {
        const tableName = Array.isArray(params) ? params[0] : undefined;
        const columnName = Array.isArray(params) ? params[1] : undefined;

        // Enable minimal feature detection paths used by lineage.
        if (tableName === 'deals' && (columnName === 'lifecycle_status' || columnName === 'score')) return { rows: [{ ok: 1 }] };
        if (tableName === 'documents' && (columnName === 'updated_at' || columnName === 'extraction_metadata')) return { rows: [] };
        if (tableName === 'visual_extractions' && (columnName === 'ocr_blocks' || columnName === 'units' || columnName === 'extraction_confidence' || columnName === 'structured_kind' || columnName === 'structured_summary')) {
          return { rows: [{ ok: 1 }] };
        }
        return { rows: [] };
      }

      if (q.includes('FROM deals') && q.includes('WHERE id = $1')) {
        assert.equal(p0, dealId);
        return { rows: [{ id: dealId, name: 'Audit Deal', lifecycle_status: 'under_review', score: 42 }] };
      }

      if (q.includes('FROM documents') && q.includes('WHERE deal_id = $1')) {
        assert.equal(p0, dealId);
        return {
          rows: [
            {
              id: 'doc-a',
              title: 'Deck',
              type: 'pitch_deck',
              page_count: 2,
              uploaded_at: '2026-01-01T00:00:00.000Z',
            },
          ],
        };
      }

      if (q.includes('FROM visual_assets')) {
        assert.equal(p0, dealId);
        return {
          rows: [
            {
              id: 'va-persisted-unknown',
              document_id: 'doc-a',
              page_index: 0,
              asset_type: 'structured',
              bbox: null,
              image_uri: null,
              image_hash: null,
              extractor_version: 'structured_native_v1',
              confidence: '1',
              quality_flags: { source: 'structured_powerpoint', segment_key: 'unknown' },
              created_at: '2026-01-05T00:00:00.000Z',
              ocr_text: null,
              ocr_blocks: null,
              structured_json: { kind: 'powerpoint_slide', title: 'Team', slide_number: 1 },
              structured_summary: null,
              units: null,
              extraction_confidence: null,
              structured_kind: null,
              extraction_method: null,
              evidence_count: 0,
              evidence_sample_snippets: [],
            },
            {
              id: 'va-persisted-unknown-product',
              document_id: 'doc-a',
              page_index: 1,
              asset_type: 'structured',
              bbox: null,
              image_uri: null,
              image_hash: null,
              extractor_version: 'structured_native_v1',
              confidence: '1',
              quality_flags: { source: 'structured_powerpoint', segment_key: 'unknown' },
              created_at: '2026-01-05T00:00:00.000Z',
              ocr_text: null,
              ocr_blocks: null,
              structured_json: { kind: 'powerpoint_slide', title: 'Product', slide_number: 2 },
              structured_summary: null,
              units: null,
              extraction_confidence: null,
              structured_kind: null,
              extraction_method: null,
              evidence_count: 0,
              evidence_sample_snippets: [],
            },
            {
              id: 'va-empty-vision',
              document_id: 'doc-a',
              page_index: 2,
              asset_type: 'image',
              bbox: { x: 0, y: 0, w: 1, h: 1 },
              image_uri: '/tmp/page_002.png',
              image_hash: null,
              extractor_version: 'vision_v1',
              confidence: '0.5',
              quality_flags: { source: 'vision_v1' },
              created_at: '2026-01-06T00:00:00.000Z',
              // Designed to trigger a hard-heading override ('Market:') while distribution tokens score highly.
              // Audit invariants must hold: computed_segment must match computed_reason.top_scores[0].segment.
              ocr_text: 'Market: Distribution Channels\nChannels: partners, reseller, marketing, sales\nGo-to-market plan',
              ocr_blocks: null,
              structured_json: null,
              structured_summary: null,
              units: null,
              extraction_confidence: null,
              structured_kind: null,
              extraction_method: 'vision_v1',
              evidence_count: 0,
              evidence_sample_snippets: [],
            },
          ],
        };
      }

      throw new Error(`Unexpected query: ${q}`);
    },
  } as any;

  const app = Fastify();
  await registerDealRoutes(app, mockPool);

    const res = await app.inject({
    method: 'GET',
        url: `/api/v1/deals/${dealId}/lineage?debug_segments=1&segment_audit=1&segment_rescore=1`,
  });

  assert.equal(res.statusCode, 200);
  const body = res.json() as any;

  assert.equal(body.deal_id, dealId);
  assert.ok(body.segment_audit_report, 'segment_audit_report missing');
  assert.equal(body.segment_audit_report.deal_id, dealId);
  assert.ok(Array.isArray(body.segment_audit_report.documents));
  assert.ok(body.segment_audit_report.documents.length >= 1);

  const doc = body.segment_audit_report.documents.find((d: any) => d.document_id === 'doc-a');
  assert.ok(doc);
  assert.ok(Array.isArray(doc.items));
  assert.equal(doc.items.length, 3);

  for (const it of doc.items) {
    assert.equal(it.document_id, 'doc-a');
    assert.ok(it.reason);
    assert.equal(typeof it.reason.classification_text_len, 'number');

    assert.ok(it.content_preview, 'content_preview missing');
    assert.equal(typeof it.content_preview.ocr_text_len, 'number');
    assert.ok(Array.isArray(it.content_preview.structured_json_keys));
  }

  const unknownItems = doc.items.filter((it: any) => it.segment === 'unknown');
  for (const it of unknownItems) {
    assert.ok(it.reason.unknown_reason_code, 'unknown_reason_code must be set for unknown segment');
    assert.ok(
      ['NO_TEXT', 'LOW_SIGNAL', 'AMBIGUOUS_TIE'].includes(it.reason.unknown_reason_code),
      `unexpected unknown_reason_code: ${String(it.reason.unknown_reason_code)}`
    );
  }

  // Persisted segment_key='unknown' is treated as missing.
  const persistedUnknown = doc.items.find((it: any) => it.visual_asset_id === 'va-persisted-unknown');
  assert.ok(persistedUnknown);
  assert.equal(persistedUnknown.segment, 'team');
  assert.equal(persistedUnknown.segment_source, 'structured');
  assert.equal(persistedUnknown.reason.unknown_reason_code, null);

  assert.ok(persistedUnknown.content_preview.structured_json_present);
  assert.ok(persistedUnknown.content_preview.structured_json_snippet);
  assert.ok(String(persistedUnknown.content_preview.structured_json_snippet).includes('"title":"Team"'));

      // When segment_rescore=1, items should include computed fields.
      for (const it of doc.items) {
        assert.equal(typeof it.captured_text, 'string');
        assert.ok(String(it.captured_text).length <= 800);
        assert.equal(typeof it.computed_segment, 'string');
        assert.ok(it.computed_reason);
        assert.equal(typeof it.computed_reason.classification_text_len, 'number');
        assert.ok(Array.isArray(it.computed_reason.classification_text_sources_used));

        // Invariant: top_scores must be sorted desc, and computed_segment must match argmax
        // when there is a clear winner by >= tie_delta.
        if (Array.isArray(it.computed_reason.top_scores) && it.computed_reason.top_scores.length >= 2) {
          const s0 = it.computed_reason.top_scores[0];
          const s1 = it.computed_reason.top_scores[1];
          assert.ok(typeof s0.segment === 'string');
          assert.ok(typeof s0.score === 'number');
          assert.ok(typeof s1.score === 'number');
          assert.ok(s0.score >= s1.score);

          const tieDelta = typeof it.computed_reason.tie_delta === 'number' ? it.computed_reason.tie_delta : 0;
          if (s0.score - s1.score >= tieDelta) {
            assert.equal(it.computed_segment, s0.segment);
          }
        }

        // If an override is applied, the audit must explain it.
        if (it.computed_reason.override_applied === true) {
          assert.ok(typeof it.computed_reason.override_rule_id === 'string' && it.computed_reason.override_rule_id.length > 0);
          assert.ok(typeof it.computed_reason.override_explanation === 'string' && it.computed_reason.override_explanation.length > 0);
          // When override is present, pre-override ranking should also be available.
          assert.ok(Array.isArray(it.computed_reason.top_scores_pre_override));
        }
        // unknown_reason_code should be present when computed is unknown
        if (it.computed_segment === 'unknown') {
          assert.ok(it.computed_reason.unknown_reason_code);
        }
      }

      const productSlide = doc.items.find((it: any) => it.visual_asset_id === 'va-persisted-unknown-product');
      assert.ok(productSlide);
      assert.equal(productSlide.segment_source, 'structured');
      assert.equal(productSlide.segment, 'product');
      assert.equal(productSlide.computed_segment, 'product');
  await app.close();
});
