/**
 * Multi-deal audit for /api/v1/deals/:deal_id/visual-assets
 *
 * Usage:
 *   pnpm -s tsx scripts/audit-visual-assets-segments.ts
 *   pnpm -s tsx scripts/audit-visual-assets-segments.ts --limit 25
 *   pnpm -s tsx scripts/audit-visual-assets-segments.ts --deal <deal_id>
 *
 * Environment:
 *   API_BASE_URL (default: http://localhost:9000)
 */

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

type DealRow = {
  id: string;
  name?: string | null;
};

type VisualAssetRow = {
  id?: string;
  visual_asset_id?: string;
  document_id?: string;
  page_index?: number;
  asset_type?: string;
  effective_segment?: string;
  segment?: string;
  segment_source?: string;
  persisted_segment_key?: string | null;
  computed_reason?: any;
};

type VisualAssetsResponse = {
  deal_id: string;
  visual_assets: VisualAssetRow[];
};

type DealListResponse = {
  deals?: DealRow[];
} | DealRow[];

function parseArgs(argv: string[]) {
  const out: { baseUrl: string; limit: number; dealId?: string; outFile?: string } = {
    baseUrl: process.env.API_BASE_URL || "http://localhost:9000",
    limit: 50,
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--limit") {
      const n = Number(argv[i + 1]);
      if (Number.isFinite(n) && n > 0) out.limit = Math.floor(n);
      i++;
      continue;
    }
    if (a === "--deal") {
      const v = argv[i + 1];
      if (typeof v === "string" && v.trim()) out.dealId = v.trim();
      i++;
      continue;
    }
    if (a === "--out") {
      const v = argv[i + 1];
      if (typeof v === "string" && v.trim()) out.outFile = v.trim();
      i++;
      continue;
    }
    if (a === "--base-url") {
      const v = argv[i + 1];
      if (typeof v === "string" && v.trim()) out.baseUrl = v.trim().replace(/\/$/, "");
      i++;
      continue;
    }
  }

  out.baseUrl = out.baseUrl.replace(/\/$/, "");
  return out;
}

async function fetchJson(url: string, timeoutMs = 20_000): Promise<Json> {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} for ${url}${text ? `: ${text.slice(0, 240)}` : ""}`);
    }
    return (await res.json()) as Json;
  } finally {
    clearTimeout(to);
  }
}

function asArray<T = any>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function getDealRows(obj: Json): DealRow[] {
  if (Array.isArray(obj)) return (obj as any[]).filter((d) => d && typeof d.id === "string");
  if (obj && typeof obj === "object") {
    const deals = (obj as any).deals;
    return asArray(deals).filter((d) => d && typeof (d as any).id === "string") as DealRow[];
  }
  return [];
}

function pickSegment(a: VisualAssetRow): string {
  const seg = typeof a.effective_segment === "string" ? a.effective_segment : typeof a.segment === "string" ? a.segment : "unknown";
  return seg || "unknown";
}

function nowStamp() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function main() {
  const { baseUrl, limit, dealId, outFile } = parseArgs(process.argv);

  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  const dealsToCheck: DealRow[] = [];

  if (dealId) {
    dealsToCheck.push({ id: dealId });
  } else {
    const dealsJson = await fetchJson(`${baseUrl}/api/v1/deals`);
    const deals = getDealRows(dealsJson);
    dealsToCheck.push(...deals.slice(0, limit));
  }

  const perDeal: any[] = [];

  for (const d of dealsToCheck) {
    const id = d.id;
    const url = `${baseUrl}/api/v1/deals/${encodeURIComponent(id)}/visual-assets`;

    let assetsRes: VisualAssetsResponse | null = null;
    let err: string | null = null;

    try {
      const j = (await fetchJson(url)) as any;
      assetsRes = {
        deal_id: String(j?.deal_id ?? id),
        visual_assets: asArray(j?.visual_assets),
      };
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    }

    const assets = assetsRes?.visual_assets ?? [];
    const total = assets.length;

    const unknownAssets = assets.filter((a) => pickSegment(a) === "unknown");
    const unknown = unknownAssets.length;

    const unknownWithPersisted = unknownAssets.filter((a) => Boolean(a.persisted_segment_key)).length;

    const bySource: Record<string, number> = {};
    for (const a of assets) {
      const src = typeof a.segment_source === "string" && a.segment_source.trim() ? a.segment_source.trim() : "(none)";
      bySource[src] = (bySource[src] ?? 0) + 1;
    }

    const sampleUnknown = unknownAssets.slice(0, 5).map((a) => ({
      page_index: typeof a.page_index === "number" ? a.page_index : null,
      asset_type: typeof a.asset_type === "string" ? a.asset_type : null,
      segment_source: typeof a.segment_source === "string" ? a.segment_source : null,
      persisted_segment_key: a.persisted_segment_key ?? null,
      computed_reason: a.computed_reason ?? null,
    }));

    perDeal.push({
      deal_id: id,
      total_visual_assets: total,
      unknown,
      unknown_with_persisted_segment_key: unknownWithPersisted,
      segment_source_counts: bySource,
      sample_unknown: sampleUnknown,
      error: err,
    });
  }

  const totals = perDeal.reduce(
    (acc, d) => {
      acc.deals += 1;
      if (!d.error) acc.deals_ok += 1;
      acc.total_visual_assets += d.total_visual_assets || 0;
      acc.total_unknown += d.unknown || 0;
      acc.total_unknown_with_persisted += d.unknown_with_persisted_segment_key || 0;
      return acc;
    },
    {
      deals: 0,
      deals_ok: 0,
      total_visual_assets: 0,
      total_unknown: 0,
      total_unknown_with_persisted: 0,
    }
  );

  const report = {
    generated_at: new Date().toISOString(),
    base_url: baseUrl,
    params: { limit, deal_id: dealId ?? null },
    totals,
    deals: perDeal.sort((a, b) => (b.unknown || 0) - (a.unknown || 0)),
  };

  const defaultOut = path.join("artifacts", `audit_visual_assets_segments_${nowStamp()}.json`);
  const outPath = outFile ? outFile : defaultOut;

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(report, null, 2), "utf-8");

  // Also print a tiny summary for quick terminal feedback.
  console.log(JSON.stringify({ out: outPath, ...totals }, null, 2));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
