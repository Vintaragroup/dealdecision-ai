import type {
  DealScoringInputV0,
  ScoringContentItemV0,
  ScoringEvidenceLocatorV0,
  ScoringItemKindV0,
  ScoringSourceKindV0,
} from "@dealdecision/contracts";

type LineageNodeLike = {
  id: string;
  node_id?: string;
  node_type?: string;
  type?: string;
  kind?: string;
  label?: string;
  data?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

type LineageResponseLike = {
  deal_id: string;
  nodes: LineageNodeLike[];
  warnings?: string[];
};

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

function asNumber(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function nodeType(n: LineageNodeLike): string {
  return String(n.node_type ?? n.type ?? n.kind ?? "").toUpperCase();
}

function inferSourceKind(node: LineageNodeLike): ScoringSourceKindV0 {
  const data = (node.data ?? {}) as any;
  const extractor = asString(data.extractor_version)?.toLowerCase();
  const qfSource = asString((data.quality_flags as any)?.source)?.toLowerCase();

  if (extractor === "structured_native_v1" || (qfSource && qfSource.startsWith("structured_"))) {
    return "structured_native";
  }

  // If we have structured_json and also OCR snippet/text, treat as hybrid.
  const hasStructured = data.structured_json != null;
  const hasOcr = Boolean(asString(data.ocr_text) || asString(data.ocr_text_snippet));
  if (hasStructured && hasOcr) return "hybrid";

  // If we have an image and OCR-ish content, treat as OCR.
  if (hasOcr) return "ocr";

  return "unknown";
}

function inferItemKind(node: LineageNodeLike): ScoringItemKindV0 {
  const t = nodeType(node);
  const data = (node.data ?? {}) as any;
  const structuredKind = asString(data.structured_kind)?.toLowerCase();

  if (t === "DEAL") return "deal";
  if (t === "DOCUMENT") return "document";
  if (t.includes("VISUAL_GROUP")) return "slide";
  if (t.includes("VISUAL_ASSET_GROUP")) return "slide";
  if (t.includes("VISUAL_ASSET")) {
    if (structuredKind === "table") return "table";
    if (structuredKind === "bar" || structuredKind === "chart") return "chart";
    return "image";
  }

  return "unknown";
}

function buildLocator(node: LineageNodeLike): ScoringEvidenceLocatorV0[] {
  const data = (node.data ?? {}) as any;
  const document_id = asString(data.document_id) ?? asString((node.metadata ?? {})?.document_id) ?? null;
  if (!document_id) return [];

  const pageIndexRaw = data.page_index ?? data.pageIndex;
  const page_index = pageIndexRaw == null ? null : asNumber(pageIndexRaw);

  const visual_asset_id = asString(data.visual_asset_id) ?? asString(data.visualAssetId) ?? undefined;
  const image_uri = (typeof data.image_uri === "string" ? data.image_uri : null) ?? null;

  const page_label = asString(data.page_label) ?? undefined;
  const bbox = data.bbox;

  return [
    {
      document_id,
      page_index,
      page_label,
      visual_asset_id,
      bbox,
      image_uri,
    },
  ];
}

function buildText(node: LineageNodeLike): string | undefined {
  const data = (node.data ?? {}) as any;

  const captured = asString(data.captured_text);
  if (captured) return captured;

  const summary = asString(data.summary);
  if (summary) return summary;

  const ocrSnippet = asString(data.ocr_text_snippet);
  if (ocrSnippet) return ocrSnippet;

  const ocr = asString(data.ocr_text);
  if (ocr) return ocr.slice(0, 4000);

  return undefined;
}

export function buildDealScoringInputV0FromLineage(lineage: LineageResponseLike): DealScoringInputV0 {
  const items: ScoringContentItemV0[] = [];

  for (const n of lineage.nodes ?? []) {
    const t = nodeType(n);

    // Keep v0 lean: focus on content-bearing nodes.
    if (
      t !== "VISUAL_ASSET" &&
      t !== "VISUAL_ASSET_GROUP" &&
      t !== "VISUAL_GROUP" &&
      t !== "DOCUMENT" &&
      t !== "DEAL"
    ) {
      continue;
    }

    const data = (n.data ?? {}) as any;
    const id = asString(n.node_id) ?? n.id;

    const locators = buildLocator(n);

    items.push({
      id,
      kind: inferItemKind(n),
      source: inferSourceKind(n),
      document_id: asString(data.document_id) ?? undefined,
      page_index: (data.page_index == null ? null : asNumber(data.page_index)) ?? undefined,
      title: asString(data.title) ?? asString(data.slide_title) ?? asString(n.label) ?? undefined,
      text: buildText(n),
      structured_json: data.structured_json ?? undefined,
      confidence: asNumber(data.confidence) ?? null,
      segment:
        data.effective_segment || data.computed_segment || data.persisted_segment_key || data.segment
          ? {
              effective: asString(data.effective_segment) ?? undefined,
              computed: asString(data.computed_segment) ?? undefined,
              persisted: asString(data.persisted_segment_key) ?? asString(data.segment) ?? undefined,
              is_ocr_hint: Boolean(data.is_ocr_inferred_segment),
            }
          : undefined,
      evidence_snippets: Array.isArray(data.evidence_snippets)
        ? (data.evidence_snippets as unknown[]).filter((x) => typeof x === "string" && x.trim()).map((x) => String(x))
        : undefined,
      locators,
      meta: {
        node_type: t,
      },
    });
  }

  return {
    deal_id: lineage.deal_id,
    generated_at: new Date().toISOString(),
    items,
    warnings: Array.isArray(lineage.warnings) ? lineage.warnings : undefined,
  };
}
