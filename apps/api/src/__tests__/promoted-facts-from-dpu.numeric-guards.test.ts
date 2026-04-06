import { test } from 'node:test';
import assert from 'node:assert/strict';
import { derivePromotedFactsFromDpuForDeal } from '../lib/promoted-facts-from-dpu';

type DpuFixtureRow = {
  document_id: string;
  page_index: number;
  payload: any;
};

const DEAL_ID = '00000000-0000-4000-8000-00000000f042';

function dpuPayload(title: string, bullets: string[]): any {
  return {
    structured: {
      title,
      bullets,
    },
    source: {
      extracted_at: '2026-04-06T00:00:00.000Z',
    },
  };
}

function makePool(rows: DpuFixtureRow[]): any {
  return {
    query: async (sql: string) => {
      if (sql.includes('SELECT 1 FROM document_page_understanding')) {
        return { rows: [{ ok: 1 }] };
      }
      if (sql.includes('FROM public.document_page_understanding')) {
        return { rows };
      }
      throw new Error(`Unexpected query in test fixture: ${sql}`);
    },
  };
}

function factTypeOf(row: any): string {
  return String(row?.content_json?.fact_type ?? row?.fact_type ?? '').trim();
}

test('derivePromotedFactsFromDpuForDeal rejects external-contract money as revenue', async () => {
  const pool = makePool([
    {
      document_id: '11111111-1111-4111-8111-111111111111',
      page_index: 1,
      payload: dpuPayload('No reliable source for accurate injury or performance predictions', [
        '2022 Cost to Acquire: $230M, fully guaranteed contract. Three first-round draft picks.',
      ]),
    },
  ]);

  const facts = await derivePromotedFactsFromDpuForDeal(pool as any, DEAL_ID);
  const hasRevenue = facts.some((f: any) => factTypeOf(f) === 'revenue_v1');
  assert.equal(hasRevenue, false);
});

test('derivePromotedFactsFromDpuForDeal rejects hypothetical market-share ARR as raise', async () => {
  const pool = makePool([
    {
      document_id: '22222222-2222-4222-8222-222222222222',
      page_index: 6,
      payload: dpuPayload('TAM Assumptions', [
        '2% Market Share (1.7M Users) = $139M ARR. Help me understand what we should raise.',
      ]),
    },
  ]);

  const facts = await derivePromotedFactsFromDpuForDeal(pool as any, DEAL_ID);
  const hasRaise = facts.some((f: any) => factTypeOf(f) === 'raise_terms_v1');
  assert.equal(hasRaise, false);
});

test('derivePromotedFactsFromDpuForDeal rejects packaging-size OCR money as revenue', async () => {
  const pool = makePool([
    {
      document_id: '33333333-3333-4333-8333-333333333333',
      page_index: 14,
      payload: dpuPayload('Business Performance', [
        '375ml Overview: premium can format, 375ml bottle footprint, $375MM 375ml packaging line text.',
      ]),
    },
  ]);

  const facts = await derivePromotedFactsFromDpuForDeal(pool as any, DEAL_ID);
  const hasRevenue = facts.some((f: any) => factTypeOf(f) === 'revenue_v1');
  assert.equal(hasRevenue, false);
});

test('derivePromotedFactsFromDpuForDeal still extracts explicit financing and revenue facts', async () => {
  const pool = makePool([
    {
      document_id: '44444444-4444-4444-8444-444444444444',
      page_index: 2,
      payload: dpuPayload('Financial Highlights', [
        'We are raising $2M Seed SAFE on a $12M valuation.',
        'Revenue reached $1.2M in 2024.',
      ]),
    },
  ]);

  const facts = await derivePromotedFactsFromDpuForDeal(pool as any, DEAL_ID);
  const hasRaise = facts.some((f: any) => factTypeOf(f) === 'raise_terms_v1');
  const hasRevenue = facts.some((f: any) => factTypeOf(f) === 'revenue_v1');

  assert.equal(hasRaise, true);
  assert.equal(hasRevenue, true);
});
