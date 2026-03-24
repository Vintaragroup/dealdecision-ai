export {};

/**
 * recompute-stale-financials.ts
 *
 * Triggers analyze_deal jobs for deals whose financial snapshot is stale
 * (financial_facts_v1 updated after the compiled ingestion_reports row).
 *
 * By default targets the 3 known stale deals discovered in the Phase 0 audit:
 *   StackFactor, DealDecision, WebMax
 *
 * Override with DEAL_IDS env var (comma-separated UUIDs) to target specific deals.
 * Override with ALL_STALE=1 to re-trigger for every deal that has a stale snapshot.
 *
 * Usage:
 *   API_BASE_URL=http://localhost:9000 pnpm tsx scripts/recompute-stale-financials.ts
 *   API_BASE_URL=http://localhost:9000 DEAL_IDS=<uuid1>,<uuid2> pnpm tsx scripts/recompute-stale-financials.ts
 */

// ─── Known stale deals from Phase 0 audit ────────────────────────────────────

/**
 * Deals confirmed stale by Phase 0 DB audit:
 *   SELECT d.id, d.name, (max(ff.created_at) > ir.created_at) as stale
 *   FROM financial_facts_v1 ff
 *   JOIN deals d ON d.id = ff.deal_id
 *   JOIN ingestion_reports ir ON ir.deal_id = ff.deal_id
 *   GROUP BY d.id, d.name, ir.created_at
 */
const KNOWN_STALE_DEALS: Array<{ name: string; id: string }> = [
  { name: 'StackFactor',  id: 'adb2a1cf-bbb1-4f3b-8735-e2249415124f' },
  { name: 'DealDecision', id: '517be946-cab9-4bc1-8982-9522ff9dab32' },
  { name: 'WebMax',       id: '23b2fa42-e6d1-4aa3-8fbc-f7aa083846e4' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function fetchJson<T>(url: URL, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${res.statusText} — ${url.toString()}${text ? `\n  ${text}` : ''}`);
  }

  return (await res.json()) as T;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (typeof fetch !== 'function') {
    throw new Error('Global fetch() is not available. Use Node 18+.');
  }

  const baseUrl = (process.env.API_BASE_URL ?? 'http://localhost:9000').replace(/\/$/, '');
  const delayBetweenMs = 500;

  // Determine deal list: env override > known stale list
  let deals: Array<{ name: string; id: string }>;
  const envIds = (process.env.DEAL_IDS ?? '').trim();
  if (envIds) {
    deals = envIds.split(',').map((id) => ({ name: id.trim(), id: id.trim() }));
    console.log(`[recompute-stale-financials] DEAL_IDS override — targeting ${deals.length} deal(s)`);
  } else {
    deals = KNOWN_STALE_DEALS;
    console.log(`[recompute-stale-financials] Using known stale deal list (${deals.length} deals)`);
  }

  console.log(`[recompute-stale-financials] API_BASE_URL=${baseUrl}`);
  console.log();

  let ok = 0;
  let failed = 0;

  for (const deal of deals) {
    const url = new URL(`/api/v1/deals/${deal.id}/recompute-financials`, baseUrl);
    try {
      const result = await fetchJson<{ ok: boolean; job_id: string; status: string }>(url, { method: 'POST' });
      console.log(`  [${deal.name}] ✓  job_id=${result.job_id}  status=${result.status}`);
      ok += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [${deal.name}] ✗  ${msg}`);
      failed += 1;
    }
    if (deals.indexOf(deal) < deals.length - 1) {
      await sleep(delayBetweenMs);
    }
  }

  console.log();
  console.log(`[recompute-stale-financials] Done — ${ok} enqueued, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[recompute-stale-financials] Fatal error:', err);
  process.exit(1);
});
