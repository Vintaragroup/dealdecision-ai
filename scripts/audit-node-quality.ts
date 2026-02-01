export {};

import fs from "node:fs";
import path from "node:path";

type DealRow = {
  id: string;
  name?: string | null;
  stage?: string | null;
  priority?: string | null;
};

type VisualAssetRow = {
  id?: string;
  visual_asset_id?: string;

  document_id?: string;
  document_title?: string | null;
  document_type?: string | null;

  page_index?: number | null;
  page_label?: string | null;

  extractor_version?: string | null;
  quality_flags?: { source?: string | null } | null;

  ocr_text?: string | null;
  structured_json?: any;

  slide_title?: string | null;
  slide_title_source?: string | null;
  slide_title_confidence?: number | null;

  computed_segment?: string | null;
  computed_confidence?: number | null;
  effective_segment?: string | null;
  segment_source?: string | null;

  unknown_reason_code?: string | null;
};

type DealVisualAssetsResponse = {
  deal_id: string;
  visual_assets: VisualAssetRow[];
};

type LineageNode = {
  node_type?: string;
  data?: any;
};

type LineageResponse = {
  deal_id?: string;
  nodes?: LineageNode[];
  segment_audit_report?: any;
};

type SegmentAuditItem = {
  visual_asset_id?: string;
  reason?: {
    classification_text_len?: number;
    classification_text_sources_used?: string[];
    unknown_reason_code?: string | null;
  };
  computed_reason?: {
    unknown_reason_code?: string | null;
  };
};

function nowStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}_${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function normalizeStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function inc(map: Record<string, number>, key: string, by = 1) {
  map[key] = (map[key] ?? 0) + by;
}

function createLimiter(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  const next = () => {
    active -= 1;
    const fn = queue.shift();
    if (fn) fn();
  };

  return async function limit<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= concurrency) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active += 1;
    try {
      return await fn();
    } finally {
      next();
    }
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} for ${url}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

function bigrams(s: string): string[] {
  const t = normalizeWhitespace(s).toLowerCase();
  if (t.length < 2) return [];
  const out: string[] = [];
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
  return out;
}

function diceCoefficient(a: string, b: string): number {
  const aa = bigrams(a);
  const bb = bigrams(b);
  if (aa.length === 0 || bb.length === 0) return 0;

  const counts = new Map<string, number>();
  for (const x of aa) counts.set(x, (counts.get(x) ?? 0) + 1);

  let intersection = 0;
  for (const x of bb) {
    const n = counts.get(x) ?? 0;
    if (n > 0) {
      intersection += 1;
      counts.set(x, n - 1);
    }
  }
  return (2 * intersection) / (aa.length + bb.length);
}

function getStructuredKind(a: VisualAssetRow): string {
  const k = a.structured_json?.kind;
  return typeof k === "string" && k ? k : "(none)";
}

function getStructuredTitle(a: VisualAssetRow): string | null {
  const kind = a.structured_json?.kind;
  if (kind !== "powerpoint_slide") return null;
  const t = a.structured_json?.title;
  return typeof t === "string" && t.trim() ? normalizeWhitespace(t) : null;
}

function getQualitySource(a: VisualAssetRow): string {
  const q = a.quality_flags?.source;
  return typeof q === "string" && q ? q : "(missing)";
}

function hasAnyText(a: VisualAssetRow): boolean {
  const ocr = normalizeStr(a.ocr_text);
  if (ocr.trim().length > 0) return true;
  if (a.structured_json != null) return true;
  return false;
}

function auditItemUnknownReason(item: SegmentAuditItem | undefined): string | null {
  const code = item?.computed_reason?.unknown_reason_code ?? item?.reason?.unknown_reason_code ?? null;
  return typeof code === "string" && code ? code : null;
}

function auditItemTextLen(item: SegmentAuditItem | undefined): number {
  const n = item?.reason?.classification_text_len;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

function auditItemSourcesUsed(item: SegmentAuditItem | undefined): string[] {
  const arr = item?.reason?.classification_text_sources_used;
  return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
}

function effectiveSegment(a: VisualAssetRow): string {
  const seg = normalizeStr(a.effective_segment || a.computed_segment);
  return seg || "unknown";
}

function effectiveTitle(a: VisualAssetRow): string | null {
  const t = typeof a.slide_title === "string" ? normalizeWhitespace(a.slide_title) : "";
  return t ? t : null;
}

async function main() {
  const baseUrl = process.argv[2] ?? process.env.API_BASE_URL ?? "http://localhost:9000";
  const outPathArg = process.argv[3] ?? `artifacts/node-quality-audit.${nowStamp()}.json`;
  const outPath = path.resolve(process.cwd(), outPathArg);

  const concurrency = Number(process.env.CONCURRENCY ?? 3);
  const limitDeals = Number(process.env.LIMIT ?? 0);

  const deals = await fetchJson<DealRow[]>(`${baseUrl}/api/dashboard/deals`);
  const selected = limitDeals > 0 ? deals.slice(0, limitDeals) : deals;

  const limit = createLimiter(Number.isFinite(concurrency) && concurrency > 0 ? concurrency : 3);

  const global = {
    deals: selected.length,
    assets_total: 0,

    by_extractor_version: {} as Record<string, number>,
    by_quality_source: {} as Record<string, number>,
    by_structured_kind: {} as Record<string, number>,

    title: {
      missing: 0,
      missing_with_text: 0,
      missing_structured_title_available: 0,
      mismatch_structured_title: 0,
      by_title_source: {} as Record<string, number>,
    },

    segment: {
      unknown: 0,
      unknown_with_text: 0,
      unknown_with_classifier_text: 0,
      unknown_reasons: {} as Record<string, number>,
    },

    classifier_inputs: {
      title_present_but_not_used: 0,
      title_used: 0,
    },

    join: {
      lineage_visual_asset_nodes: 0,
      unmatched_lineage_nodes: 0,
    },
  };

  const worstSamples: any[] = [];
  const perDeal: any[] = [];

  await Promise.all(
    selected.map((deal) =>
      limit(async () => {
        const va = await fetchJson<DealVisualAssetsResponse>(`${baseUrl}/api/v1/deals/${encodeURIComponent(deal.id)}/visual-assets`);
        const assets = Array.isArray(va.visual_assets) ? va.visual_assets : [];

        const lineageUrl = new URL(`${baseUrl}/api/v1/deals/${encodeURIComponent(deal.id)}/lineage`);
        lineageUrl.searchParams.set("segment_audit", "1");
        lineageUrl.searchParams.set("debug_segments", "1");
        lineageUrl.searchParams.set("group_pptx", "1");
        const lineage = await fetchJson<LineageResponse>(lineageUrl.toString());
        const nodes = Array.isArray(lineage.nodes) ? lineage.nodes : [];
        const vaNodes = nodes.filter((n) => normalizeStr(n.node_type) === "VISUAL_ASSET" && n.data);
        global.join.lineage_visual_asset_nodes += vaNodes.length;

        const auditById = new Map<string, SegmentAuditItem>();
        const auditDocs = lineage?.segment_audit_report?.documents;
        if (Array.isArray(auditDocs)) {
          for (const d of auditDocs) {
            const items = d?.items;
            if (!Array.isArray(items)) continue;
            for (const it of items) {
              const id = normalizeStr((it as any)?.visual_asset_id);
              if (!id) continue;
              auditById.set(id, it as SegmentAuditItem);
            }
          }
        }

        const byId = new Map<string, VisualAssetRow>();
        for (const a of assets) {
          const id = normalizeStr(a.id || a.visual_asset_id);
          if (!id) continue;
          byId.set(id, a);
        }

        let unmatched = 0;
        for (const n of vaNodes) {
          const id = normalizeStr(n.data.id || n.data.visual_asset_id || n.data.visualAssetId);
          if (!id) continue;
          if (!byId.has(id)) unmatched += 1;
        }
        global.join.unmatched_lineage_nodes += unmatched;

        const dealStats = {
          deal_id: deal.id,
          deal_name: deal.name ?? null,
          totals: {
            assets: assets.length,
            missing_title: 0,
            missing_title_with_text: 0,
            missing_structured_title_available: 0,
            mismatch_structured_title: 0,
            unknown_segment: 0,
            unknown_segment_with_text: 0,
            unknown_segment_with_classifier_text: 0,
          },
          by_structured_kind: {} as Record<string, number>,
          by_extractor_version: {} as Record<string, number>,
          by_quality_source: {} as Record<string, number>,
          top_issues: [] as any[],
          classifier_inputs: {
            title_present_but_not_used: 0,
            title_used: 0,
          },
          join: {
            lineage_visual_asset_nodes: vaNodes.length,
            unmatched_lineage_nodes: unmatched,
          },
        };

        for (const a of assets) {
          global.assets_total += 1;

          const extractor = typeof a.extractor_version === "string" && a.extractor_version ? a.extractor_version : "(missing)";
          const quality = getQualitySource(a);
          const kind = getStructuredKind(a);

          inc(global.by_extractor_version, extractor);
          inc(global.by_quality_source, quality);
          inc(global.by_structured_kind, kind);

          inc(dealStats.by_extractor_version, extractor);
          inc(dealStats.by_quality_source, quality);
          inc(dealStats.by_structured_kind, kind);

          const title = effectiveTitle(a);
          const titleSource = typeof a.slide_title_source === "string" && a.slide_title_source ? a.slide_title_source : "(missing)";
          if (title) inc(global.title.by_title_source, titleSource);

          const structuredTitle = getStructuredTitle(a);
          const hasText = hasAnyText(a);

          const assetId = normalizeStr(a.id || a.visual_asset_id);
          const auditItem = assetId ? auditById.get(assetId) : undefined;
          const classifierTextLen = auditItemTextLen(auditItem);
          const sourcesUsed = auditItemSourcesUsed(auditItem);
          const hasClassifierText = classifierTextLen > 0;

          if (title) {
            if (sourcesUsed.includes("title")) {
              global.classifier_inputs.title_used += 1;
              dealStats.classifier_inputs.title_used += 1;
            } else if (hasClassifierText) {
              // Only count this if there was enough classifier text to have a meaningful sources list.
              global.classifier_inputs.title_present_but_not_used += 1;
              dealStats.classifier_inputs.title_present_but_not_used += 1;
            }
          }

          if (!title) {
            global.title.missing += 1;
            dealStats.totals.missing_title += 1;
            if (hasText) {
              global.title.missing_with_text += 1;
              dealStats.totals.missing_title_with_text += 1;
            }
            if (structuredTitle) {
              global.title.missing_structured_title_available += 1;
              dealStats.totals.missing_structured_title_available += 1;
            }
          } else if (structuredTitle) {
            const sim = diceCoefficient(title, structuredTitle);
            if (sim < 0.55) {
              global.title.mismatch_structured_title += 1;
              dealStats.totals.mismatch_structured_title += 1;
              if (worstSamples.length < 60) {
                worstSamples.push({
                  reason: "mismatch_structured_title",
                  deal_id: deal.id,
                  deal_name: deal.name ?? null,
                  document_id: a.document_id ?? null,
                  document_title: a.document_title ?? null,
                  page_index: a.page_index ?? null,
                  extractor_version: extractor,
                  quality_source: quality,
                  structured_kind: kind,
                  slide_title: title,
                  slide_title_source: titleSource,
                  structured_title: structuredTitle,
                  similarity: Number(sim.toFixed(3)),
                });
              }
            }
          }

          const seg = effectiveSegment(a);
          if (seg === "unknown") {
            global.segment.unknown += 1;
            dealStats.totals.unknown_segment += 1;
            if (hasText) {
              global.segment.unknown_with_text += 1;
              dealStats.totals.unknown_segment_with_text += 1;
            }
            if (hasClassifierText) {
              global.segment.unknown_with_classifier_text += 1;
              dealStats.totals.unknown_segment_with_classifier_text += 1;
            }

            const reason = auditItemUnknownReason(auditItem) ?? "(unspecified)";
            inc(global.segment.unknown_reasons, reason);
          }

          const pushDealIssue = (reason: string) => {
            if (dealStats.top_issues.length >= 24) return;
            dealStats.top_issues.push({
              reason,
              asset_id: a.id ?? a.visual_asset_id ?? null,
              document_id: a.document_id ?? null,
              document_title: a.document_title ?? null,
              page_index: a.page_index ?? null,
              extractor_version: extractor,
              quality_source: quality,
              structured_kind: kind,
              slide_title: title,
              slide_title_source: titleSource,
              structured_title: structuredTitle,
              classifier_text_len: classifierTextLen,
              classification_text_sources_used: sourcesUsed,
              computed_segment: a.computed_segment ?? null,
              effective_segment: a.effective_segment ?? null,
              segment_source: a.segment_source ?? null,
            });
          };

          if (!title && structuredTitle) pushDealIssue("missing_title_structured");
          else if (!title && hasText) pushDealIssue("missing_title_with_text");
          else if (seg === "unknown" && hasText) pushDealIssue("unknown_segment_with_text");
        }

        perDeal.push(dealStats);
      })
    )
  );

  perDeal.sort((a, b) => b.totals.assets - a.totals.assets);

  const report = {
    generated_at: new Date().toISOString(),
    base_url: baseUrl,
    global,
    per_deal: perDeal,
    worst_samples: worstSamples,
    notes: {
      meaning:
        "This audit checks: (1) each visual/structured asset has a title, (2) each has a non-unknown segment when any text exists, and (3) PPTX structured titles match effective titles.",
      join:
        "We also count VISUAL_ASSET lineage nodes and whether they map to /visual-assets rows by id. If unmatched_lineage_nodes > 0, lineage/visual-assets are out of sync.",
    },
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ out: outPathArg, global }, null, 2));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
