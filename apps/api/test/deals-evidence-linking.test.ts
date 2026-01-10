import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { randomUUID } from 'crypto';
import { registerDealRoutes } from '../src/routes/deals';
import { registerEvidenceRoutes } from '../src/routes/evidence';
import { closeQueues } from '../src/lib/queue';

test.after(async () => {
  await closeQueues();
});

test('phase1 claim snippets are persisted as evidence and resolvable', async () => {
  const dealId = 'deal-ev-1';
  const docId = 'doc-123';
  const now = '2024-01-01T00:00:00.000Z';

  const evidenceStore: any[] = [];
  const documentStore: Array<{ id: string; title: string; page_count?: number | null }> = [
    { id: docId, title: 'Demo Doc', page_count: 2 },
  ];

  const businessModelEvidenceId = 'bm-1';

  const evidenceColumns = new Set([
    'id',
    'deal_id',
    'document_id',
    'source',
    'kind',
    'text',
    'excerpt',
    'confidence',
    'page',
    'page_number',
    'value',
    'dio_id',
    'section_key',
  ]);

  const documentColumns = new Set(['id', 'title', 'page_count', 'uploaded_at', 'updated_at']);

  const mockPool = {
    async query(sql: string, params?: any[]) {
      const q = String(sql);

      if (q.startsWith('SELECT to_regclass')) {
        const table = params?.[0];
        const exists = table === 'evidence' || table === 'documents';
        return { rows: [{ oid: exists ? 'ok' : null }] };
      }

      if (q.includes('FROM information_schema.columns')) {
        const table = params?.[0];
        const column = params?.[1];
        const ok =
          (table === 'evidence' && evidenceColumns.has(column)) || (table === 'documents' && documentColumns.has(column));
        return { rows: ok ? [{ ok: 1 }] : [] };
      }

      if (q.includes('SELECT * FROM deals WHERE id = $1')) {
        return {
          rows: [
            {
              id: dealId,
              name: 'Evidence Deal',
              stage: 'intake',
              priority: 'medium',
              trend: null,
              score: null,
              owner: null,
              created_at: now,
              updated_at: now,
              deleted_at: null,
            },
          ],
        };
      }

      if (q.includes('WITH stats AS') && q.includes('deal_intelligence_objects')) {
        return {
          rows: [
            {
              dio_id: 'dio-1',
              analysis_version: 1,
              recommendation: 'SCREEN',
              overall_score: null,
              overall_score_resolved: null,
              executive_summary_v1: null,
              executive_summary_v2: {
                title: 'ES',
                paragraphs: ['p1'],
                accountability_v1: { support: { product: 'evidence' } },
              },
              decision_summary_v1: null,
              phase1_coverage: { sections: { product: 'present' } },
              phase1_business_archetype_v1: null,
              phase1_deal_overview_v2: null,
              phase1_update_report_v1: null,
              phase1_deal_summary_v2: null,
              phase1_claims: [
                {
                  claim_id: 'c1',
                  category: 'product',
                  text: 'Product claim',
                  evidence: [{ document_id: docId, snippet: 'Product proof' }],
                },
                {
                  claim_id: 'c2',
                  category: 'traction',
                  text: 'Traction claim',
                  evidence: [{ document_id: docId, snippet: 'Traction proof' }],
                },
                {
                  claim_id: 'c3',
                  category: 'terms',
                  text: 'Terms claim',
                  evidence: [{ document_id: docId, snippet: 'Terms proof' }],
                },
                {
                  claim_id: 'c4',
                  category: 'risks',
                  text: 'Risk claim',
                  evidence: [{ document_id: docId, snippet: 'Risk proof' }],
                },
              ],
              phase_b_latest_run: null,
              phase_b_history: null,
              last_analyzed_at: now,
              run_count: 1,
            },
          ],
        };
      }

      if (q.includes('SELECT id') && q.includes('FROM evidence') && q.includes('IS NOT DISTINCT FROM')) {
        const snippet = params?.[1];
        const docParam = params?.[2] ?? null;
        const found = evidenceStore.find((row) => row.deal_id === dealId && row.text === snippet && row.document_id === docParam);
        return { rows: found ? [{ id: found.id }] : [] };
      }

      if (q.startsWith('INSERT INTO evidence')) {
        const colsMatch = q.match(/INSERT INTO evidence\s*\(([^)]+)\)/i);
        const cols = colsMatch ? colsMatch[1].split(',').map((c) => c.trim()) : [];
        const row: any = {};
        cols.forEach((col, idx) => {
          row[col] = Array.isArray(params) ? params[idx] : undefined;
        });
        row.id = row.id || randomUUID();
        row.created_at = now;
        row.text = row.text ?? row.excerpt ?? null;
        evidenceStore.push(row);
        return { rows: [] };
      }

      if (q.includes('FROM evidence') && q.includes('id = ANY')) {
        const ids = (params?.[0] ?? []) as string[];
        const rows = evidenceStore
          .filter((row) => ids.includes(row.id))
          .map((row) => ({
            id: row.id,
            document_id: row.document_id ?? null,
            source: row.source ?? null,
            kind: row.kind ?? null,
            text: row.text ?? null,
            value: row.value ?? null,
            confidence: row.confidence ?? null,
            created_at: row.created_at ?? now,
            page: row.page ?? row.page_number ?? null,
          }));
        return { rows };
      }

      if (q.includes('FROM documents') && q.includes('id = ANY')) {
        const ids = (params?.[0] ?? []) as string[];
        return { rows: documentStore.filter((doc) => ids.includes(doc.id)) };
      }

      if (q.includes('FROM evidence') && q.includes('deal_id = $1') && q.includes('section_key = $3')) {
        const sectionKey = params?.[2];
        const filtered = evidenceStore
          .filter((row) => row.deal_id === params?.[0] && row.section_key === sectionKey)
          .map((row) => ({ id: row.id, document_id: row.document_id, snippet: row.text ?? row.excerpt ?? null }));
        return { rows: filtered };
      }

      if (q.includes('FROM evidence') && q.includes('deal_id = $1') && q.includes('ORDER BY created_at')) {
        const filtered = evidenceStore
          .filter((row) => row.deal_id === params?.[0])
          .map((row) => ({
            id: row.id,
            deal_id: row.deal_id,
            document_id: row.document_id,
            source: row.source,
            kind: row.kind,
            text: row.text,
            confidence: row.confidence,
            created_at: row.created_at,
          }));
        return { rows: filtered };
      }

      if (q.includes('FROM evidence e') && q.includes('WHERE e.id = ANY')) {
        const ids = (params?.[0] ?? []) as string[];
        const rows = evidenceStore
          .filter((row) => ids.includes(row.id))
          .map((row) => ({
            id: row.id,
            document_id: row.document_id ?? null,
            page: row.page ?? row.page_number ?? null,
            snippet: row.text ?? null,
            document_title: documentStore.find((d) => d.id === row.document_id)?.title ?? null,
          }));
        return { rows };
      }

      throw new Error(`Unexpected SQL in mock pool: ${q}`);
    },
  } as any;

  const app = Fastify();
  await registerDealRoutes(app, mockPool);
  await registerEvidenceRoutes(app, mockPool);

  // seed one business model evidence row that should be ignored by sampling (no keywords)
  evidenceStore.push({
    id: businessModelEvidenceId,
    deal_id: dealId,
    document_id: docId,
    source: 'auto',
    kind: 'business_model',
    text: 'General notes without pricing details',
    section_key: 'business_model',
    created_at: now,
  });

  const dealRes = await app.inject({ method: 'GET', url: `/api/v1/deals/${dealId}?mode=phase1` });
  assert.equal(dealRes.statusCode, 200);
  const body = dealRes.json() as any;

  const sections =
    body?.phase1?.executive_summary_v2?.score_breakdown_v1?.sections ?? body?.executive_summary_v2?.score_breakdown_v1?.sections;
  assert.ok(Array.isArray(sections));
  const product = sections.find((s: any) => s.section_key === 'product');
  assert.ok(product, 'product section should exist');
  assert.ok(Array.isArray(product.evidence_ids_linked));
  assert.equal(product.evidence_ids_linked.length, 1);

  const traction = sections.find((s: any) => s.section_key === 'traction');
  const terms = sections.find((s: any) => s.section_key === 'terms');
  const risks = sections.find((s: any) => s.section_key === 'risks');
  const businessModel = sections.find((s: any) => s.section_key === 'business_model');

  for (const sec of [traction, terms, risks]) {
    assert.ok(sec, 'section missing');
    const ids = (sec?.evidence_ids_linked ?? sec?.evidence_ids_sample ?? []) as string[];
    assert.ok(Array.isArray(ids));
    assert.ok(ids.length > 0, 'expected evidence ids for section');
  }

  assert.ok(businessModel, 'business_model section should exist');
  const bmIds = (businessModel?.evidence_ids_linked ?? businessModel?.evidence_ids_sample ?? []) as string[];
  assert.ok(Array.isArray(bmIds));
  assert.equal(bmIds.length, 0, 'business_model should not link generic evidence');

  const evidenceId = product.evidence_ids_linked[0];
  assert.ok(evidenceStore.some((row) => row.id === evidenceId && row.document_id === docId), 'evidence persisted with document id');

  const resolveRes = await app.inject({ method: 'GET', url: `/api/v1/evidence/resolve?ids=${encodeURIComponent(evidenceId)}` });
  assert.equal(resolveRes.statusCode, 200);
  const resolved = resolveRes.json() as any;
  const resolvedItem = resolved?.results?.find((r: any) => r.id === evidenceId);
  assert.ok(resolvedItem?.ok, 'resolver should return ok');
  assert.equal(resolvedItem?.document_id, docId);

  const scoreEvidence = body?.phase1_score_evidence ?? body?.phase1?.score_evidence;
  assert.ok(scoreEvidence, 'phase1_score_evidence should be present');
  const evidenceIdsFromPayload = new Set<string>();
  for (const section of scoreEvidence.sections ?? []) {
    for (const claim of section.claims ?? []) {
      for (const ev of claim.evidence ?? []) {
        if (typeof ev.id === 'string') evidenceIdsFromPayload.add(ev.id);
      }
    }
  }
  assert.ok(evidenceIdsFromPayload.size > 0, 'score evidence should include evidence ids');

  const resolveMany = await app.inject({ method: 'GET', url: `/api/v1/evidence/resolve?ids=${encodeURIComponent(Array.from(evidenceIdsFromPayload).join(','))}` });
  assert.equal(resolveMany.statusCode, 200);
  const resolvedMany = resolveMany.json() as any;
  const okCount = (resolvedMany?.results ?? []).filter((r: any) => r?.ok).length;
  assert.ok(okCount >= evidenceIdsFromPayload.size, 'resolver should return all ids');

  await app.close();
});
