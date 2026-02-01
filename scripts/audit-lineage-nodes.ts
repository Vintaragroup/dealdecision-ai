export {};

import fs from "node:fs";
import path from "node:path";

type DealRow = {
  id: string;
  name?: string | null;
  stage?: string | null;
  priority?: string | null;
};

type LineageNode = {
  node_type?: string;
  data?: any;
};

type LineageResponse = {
  deal_id?: string;
  nodes?: LineageNode[];
};

function nowStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}_${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function inc(map: Record<string, number>, key: string, by = 1) {
  map[key] = (map[key] ?? 0) + by;
}

function normalizeStr(v: unknown): string {
  return typeof v === "string" ? v : "";
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

async function fetchJson<T>(url: URL, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(init?.body ? { "content-type": "application/json" } : {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url.toString()}${text ? `\n${text.slice(0, 500)}` : ""}`);
  }
  return (await res.json()) as T;
}

function getStructuredKind(n: any): string | null {
  const structured = n?.structured_json ?? n?.structured ?? null;
  if (!structured || typeof structured !== "object") return null;
  const k = structured.kind;
  return typeof k === "string" && k ? k : null;
}

function getQualitySource(n: any): string | null {
  const q = n?.quality_flags?.source ?? n?.quality_source ?? null;
  return typeof q === "string" && q ? q : null;
}

function getExtractorVersion(n: any): string | null {
  const v = n?.extractor_version ?? n?.extractorVersion ?? null;
  return typeof v === "string" && v ? v : null;
}

function getUnknownReason(n: any): string | null {
  const fromComputed = n?.computed_reason?.unknown_reason_code;
  const fromReason = n?.reason?.unknown_reason_code;
  const fromQuality = n?.quality_flags?.unknown_reason_code;
  const best = fromComputed ?? fromReason ?? fromQuality;
  return typeof best === "string" && best ? best : null;
}

function docKindFromDocNode(docData: any): string {
  const em = docData?.extraction_metadata;
  const kind = normalizeStr(em?.doc_kind ?? em?.docKind);
  return kind || "(unknown)";
}

async function main() {
  const baseUrl = process.argv[2] ?? process.env.API_BASE_URL ?? "http://localhost:9000";
  const outPathArg = process.argv[3] ?? `artifacts/lineage-nodes-audit.${nowStamp()}.json`;
  const outPath = path.resolve(process.cwd(), outPathArg);

  const concurrency = Number(process.env.CONCURRENCY ?? 3);
  const limitDeals = Number(process.env.LIMIT ?? 0);

  const base = new URL(baseUrl);
  const deals = await fetchJson<DealRow[]>(new URL("/api/dashboard/deals", base));
  const selected = limitDeals > 0 ? deals.slice(0, limitDeals) : deals;

  const limit = createLimiter(Number.isFinite(concurrency) && concurrency > 0 ? concurrency : 3);

  const expectedNodeTypes = new Set(["DEAL", "DOCUMENT", "VISUAL_ASSET", "VISUAL_ASSET_GROUP", "EVIDENCE", "SEGMENT", "ANALYSIS"]);

  const global = {
    deals: selected.length,
    nodes_total: 0,
    node_types: {} as Record<string, number>,
    unexpected_node_types: {} as Record<string, number>,

    documents: {
      total: 0,
      doc_kinds: {} as Record<string, number>,
      doc_types: {} as Record<string, number>,
    },

    visual_assets: {
      total: 0,
      segments: {} as Record<string, number>,
      unknown_reasons: {} as Record<string, number>,
      extractor_versions: {} as Record<string, number>,
      quality_sources: {} as Record<string, number>,
      structured_kinds: {} as Record<string, number>,
      missing_document_id: 0,
      missing_text_both: 0,
    },
  };

  const perDeal: any[] = [];

  await Promise.all(
    selected.map((d) =>
      limit(async () => {
        const lineageUrl = new URL(`/api/v1/deals/${encodeURIComponent(d.id)}/lineage`, base);
        // Ask for extra debug if the route supports it; harmless if ignored.
        lineageUrl.searchParams.set("segment_audit", "1");
        lineageUrl.searchParams.set("debug_segments", "1");
        lineageUrl.searchParams.set("group_pptx", "1");

        const lineage = await fetchJson<LineageResponse>(lineageUrl);
        const nodes = Array.isArray(lineage.nodes) ? lineage.nodes : [];

        const dealStats = {
          deal_id: d.id,
          deal_name: d.name ?? null,
          nodes_total: nodes.length,
          node_types: {} as Record<string, number>,
          documents: {
            total: 0,
            doc_kinds: {} as Record<string, number>,
            doc_types: {} as Record<string, number>,
          },
          visual_assets: {
            total: 0,
            segments: {} as Record<string, number>,
            unknown_reasons: {} as Record<string, number>,
            extractor_versions: {} as Record<string, number>,
            quality_sources: {} as Record<string, number>,
            structured_kinds: {} as Record<string, number>,
            missing_document_id: 0,
            missing_text_both: 0,
          },
        };

        global.nodes_total += nodes.length;

        for (const n of nodes) {
          const t = normalizeStr(n.node_type) || "(missing)";
          inc(global.node_types, t);
          inc(dealStats.node_types, t);
          if (t !== "(missing)" && !expectedNodeTypes.has(t)) inc(global.unexpected_node_types, t);

          if (t === "DOCUMENT" && n.data) {
            dealStats.documents.total += 1;
            global.documents.total += 1;

            const docKind = docKindFromDocNode(n.data);
            inc(dealStats.documents.doc_kinds, docKind);
            inc(global.documents.doc_kinds, docKind);

            const docType = normalizeStr(n.data.type) || "(unknown)";
            inc(dealStats.documents.doc_types, docType);
            inc(global.documents.doc_types, docType);
          }

          if (t === "VISUAL_ASSET" && n.data) {
            dealStats.visual_assets.total += 1;
            global.visual_assets.total += 1;

            const docId = normalizeStr(n.data.document_id);
            if (!docId) {
              dealStats.visual_assets.missing_document_id += 1;
              global.visual_assets.missing_document_id += 1;
            }

            const seg = normalizeStr(n.data.segment ?? n.data.effective_segment ?? n.data.computed_segment) || "(missing)";
            inc(dealStats.visual_assets.segments, seg);
            inc(global.visual_assets.segments, seg);

            if (seg === "unknown" || seg === "(missing)") {
              const reason = getUnknownReason(n.data) ?? "(unspecified)";
              inc(dealStats.visual_assets.unknown_reasons, reason);
              inc(global.visual_assets.unknown_reasons, reason);
            }

            const ev = getExtractorVersion(n.data) ?? "(missing)";
            inc(dealStats.visual_assets.extractor_versions, ev);
            inc(global.visual_assets.extractor_versions, ev);

            const qs = getQualitySource(n.data) ?? "(missing)";
            inc(dealStats.visual_assets.quality_sources, qs);
            inc(global.visual_assets.quality_sources, qs);

            const sk = getStructuredKind(n.data) ?? "(none)";
            inc(dealStats.visual_assets.structured_kinds, sk);
            inc(global.visual_assets.structured_kinds, sk);

            const ocrText = normalizeStr(n.data.ocr_text);
            const structured = n.data.structured_json;
            const hasStructured = structured != null;
            if (!ocrText && !hasStructured) {
              dealStats.visual_assets.missing_text_both += 1;
              global.visual_assets.missing_text_both += 1;
            }
          }
        }

        perDeal.push(dealStats);
      })
    )
  );

  perDeal.sort((a, b) => b.visual_assets.total - a.visual_assets.total);

  const report = {
    generated_at: new Date().toISOString(),
    base_url: baseUrl,
    global,
    per_deal: perDeal,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ out: outPathArg, global: report.global }, null, 2));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
