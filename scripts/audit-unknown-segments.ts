export {};

type DealListItem = {
  id: string;
  name?: string;
};

type LineageNode = {
  node_type?: string;
  data?: any;
};

type LineageResponse = {
  deal_id?: string;
  nodes?: LineageNode[];
};

function envFlag(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw == null) return defaultValue;
  return ["1", "true", "yes", "y", "on"].includes(raw.toLowerCase());
}

function envInt(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function envFloat(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function normalizeStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function inferDocKindFromLabel(labelRaw: string): string {
  const label = labelRaw.toLowerCase();
  if (label.includes(".xlsx") || label.includes("excel")) return "excel";
  if (label.includes(".pdf")) return "pdf";
  if (label.includes(".ppt") || label.includes(".pptx")) return "powerpoint";
  if (label.includes(".doc") || label.includes(".docx")) return "word";
  if (label.match(/\.(png|jpg|jpeg|gif|webp)$/)) return "image";
  return "unknown";
}

function isFinancialishDocument(doc: { type?: string | null; title?: string | null; doc_kind?: string | null }): boolean {
  const t = normalizeStr(doc.type).toLowerCase();
  const title = normalizeStr(doc.title).toLowerCase();
  const kind = normalizeStr(doc.doc_kind).toLowerCase();
  if (t === "financials") return true;
  if (kind === "excel") return true;
  if (title.includes("financial")) return true;
  if (title.includes("revenue") || title.includes("income") || title.includes("p&l") || title.includes("balance sheet")) return true;
  return false;
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
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url.toString()}${text ? `\n${text}` : ""}`);
  }
  return (await res.json()) as T;
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

async function main() {
  const apiBase = process.env.API_BASE_URL || "http://localhost:9000";
  const dealId = process.env.DEAL_ID || "";
  const limitDeals = envInt("LIMIT", 0);
  const concurrency = envInt("CONCURRENCY", 3);
  const unknownPctThreshold = envFloat("UNKNOWN_PCT_THRESHOLD", 0.01);
  const failOnFindings = envFlag("FAIL_ON_FINDINGS", false);

  const base = new URL(apiBase);

  const deals: DealListItem[] = dealId
    ? [{ id: dealId, name: dealId }]
    : await fetchJson<DealListItem[]>(new URL("/api/v1/deals", base));

  const selected = limitDeals > 0 ? deals.slice(0, limitDeals) : deals;
  const limit = createLimiter(concurrency);

  const results: Array<{
    deal_id: string;
    deal_name?: string;
    financial_docs: number;
    financial_assets: number;
    unknown_assets: number;
    unknown_pct: number;
    unknown_reasons: Record<string, number>;
  }> = [];

  await Promise.all(
    selected.map((d) =>
      limit(async () => {
        const url = new URL(`/api/v1/deals/${encodeURIComponent(d.id)}/lineage`, base);
        const lineage = await fetchJson<LineageResponse>(url);
        const nodes = Array.isArray(lineage.nodes) ? lineage.nodes : [];

        const docs = nodes
          .filter((n) => String(n.node_type) === "DOCUMENT" && n.data)
          .map((n) => {
            const em = (n.data.extraction_metadata && typeof n.data.extraction_metadata === "object") ? n.data.extraction_metadata : {};
            const label = normalizeStr(n.data.label || n.data.title);
            const inferredKind = inferDocKindFromLabel(label);
            return {
              document_id: normalizeStr(n.data.id || n.data.document_id || n.data.documentId || n.data.doc_id),
              title: label,
              type: normalizeStr(n.data.type || ""),
              doc_kind: normalizeStr(em.doc_kind || em.docKind || inferredKind),
            };
          })
          .filter((x) => x.document_id);

        const financialDocIds = new Set(docs.filter(isFinancialishDocument).map((x) => x.document_id));

        let financialAssets = 0;
        let unknownAssets = 0;
        const unknownReasons: Record<string, number> = {};

        for (const n of nodes) {
          if (String(n.node_type) !== "VISUAL_ASSET" || !n.data) continue;
          const docId = normalizeStr(n.data.document_id);
          if (!financialDocIds.has(docId)) continue;

          financialAssets += 1;
          const seg = normalizeStr(n.data.segment || n.data.effective_segment);
          if (seg !== "unknown") continue;

          unknownAssets += 1;
          const reason =
            normalizeStr(n.data?.computed_reason?.unknown_reason_code) ||
            normalizeStr(n.data?.quality_flags?.unknown_reason_code) ||
            "(unspecified)";
          unknownReasons[reason] = (unknownReasons[reason] || 0) + 1;
        }

        const unknownPct = financialAssets > 0 ? unknownAssets / financialAssets : 0;

        results.push({
          deal_id: d.id,
          deal_name: d.name,
          financial_docs: financialDocIds.size,
          financial_assets: financialAssets,
          unknown_assets: unknownAssets,
          unknown_pct: Number(unknownPct.toFixed(4)),
          unknown_reasons: unknownReasons,
        });
      })
    )
  );

  results.sort((a, b) => b.unknown_pct - a.unknown_pct);

  const worst = results.filter((r) => r.financial_assets > 0).slice(0, 12);
  const flagged = results.filter((r) => r.financial_assets > 0 && r.unknown_pct > unknownPctThreshold);

  console.log(JSON.stringify({
    checked_deals: results.length,
    threshold_unknown_pct: unknownPctThreshold,
    flagged_deals: flagged.length,
    worst,
  }, null, 2));

  if (failOnFindings && flagged.length > 0) {
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
