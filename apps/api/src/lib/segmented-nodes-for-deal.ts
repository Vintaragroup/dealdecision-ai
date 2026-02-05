import type { Pool } from "pg";
import { normalizeAnalystSegment, type AnalystSegment } from "./analyst-segment";
import { segmentDpuPage } from "./segment-dpu-page";

const asNonEmptyString = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isMissingTableError(err: any): boolean {
  return String(err?.code ?? "") === "42P01";
}

export type SegmentedDealNode = {
  node_id: string;
  document_id: string;
  source_document_id: string;
  page_index: number;
  slide_title: string | null;
  bullets: string[];
  bullets_snippet: string;
  visual_asset_id: string | null;
  segment_key: AnalystSegment | null;
  structured_segment_key_raw: string | null;
  quality_flags_segment_key_raw: string | null;
  segment_reason: {
    rules_hit: string[];
    keywords_hit: string[];
    classifier_confidence: number | null;
    source: "deterministic" | "hybrid" | "unknown";
  };
};

function slideTitleFromPayload(payload: any): string | null {
  const structured = payload?.structured ?? null;
  const textBlocks = payload?.text_blocks ?? null;
  return (
    asNonEmptyString(structured?.title) ??
    asNonEmptyString(structured?.slide_title) ??
    asNonEmptyString(textBlocks?.title) ??
    null
  );
}

function bulletsFromPayload(payload: any, maxBullets = 12): string[] {
  const structured = payload?.structured ?? null;
  const textBlocks = payload?.text_blocks ?? null;
  const bullets: unknown = Array.isArray(structured?.bullets) ? structured.bullets : Array.isArray(textBlocks?.bullets) ? textBlocks.bullets : null;
  if (!Array.isArray(bullets)) return [];
  const out: string[] = [];
  for (const b of bullets) {
    if (out.length >= maxBullets) break;
    const s = asNonEmptyString(b);
    if (!s) continue;
    out.push(s);
  }
  return out;
}

function segmentFromTitleAndBullets(input: { title: string | null; bullets: string[] }): {
  segment_key: AnalystSegment;
  confidence: number;
  reason: { title_rules_hit: string[]; bullet_rules_hit: string[]; override_rules_hit: string[]; keywords: string[] };
} {
  return segmentDpuPage({ title: input.title, bullets: input.bullets });
}

function bulletsSnippetFromPayload(payload: any, maxLen: number): string {
  const bullets = bulletsFromPayload(payload, 12);
  const joined = bullets.join(" • ").replace(/\s+/g, " ").trim();
  if (!joined) return "";
  if (joined.length <= maxLen) return joined;
  return `${joined.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`;
}

function visualAssetIdFromPayload(payload: any): string | null {
  const p = payload && typeof payload === "object" ? payload : null;
  const source = p?.source && typeof p.source === "object" ? p.source : null;
  const fallback = p?.metadata?.source && typeof p.metadata.source === "object" ? p.metadata.source : null;
  const raw = asNonEmptyString(source?.visual_asset_id) ?? asNonEmptyString(fallback?.visual_asset_id) ?? asNonEmptyString(p?.visual_asset_id);
  return raw && isUuid(raw) ? raw : null;
}

export async function getSegmentedNodesForDeal(pool: Pool, dealId: string): Promise<{ nodes: SegmentedDealNode[]; warnings: string[] }> {
  const warnings: string[] = [];

  let dpuRows: Array<{ document_id: string; page_index: number; payload: any }> = [];
  try {
    const { rows } = await pool.query(
      `
      SELECT document_id::text, page_index, payload
      FROM public.document_page_understanding
      WHERE deal_id = $1::uuid
        AND version = 'page_understanding_v1'
      ORDER BY document_id, page_index
      `,
      [dealId]
    );

    dpuRows = (rows ?? []).map((r: any) => ({
      document_id: String(r.document_id),
      page_index: Number(r.page_index),
      payload: r.payload ?? null,
    }));
  } catch (err) {
    if (isMissingTableError(err)) {
      warnings.push("document_page_understanding table missing");
      return { nodes: [], warnings };
    }
    throw err;
  }

  const visualAssetIds = Array.from(
    new Set(
      dpuRows
        .map((r) => visualAssetIdFromPayload(r.payload))
        .filter((v): v is string => Boolean(v && isUuid(v)))
    )
  );

  const visualAssetById = new Map<string, { quality_flags: any }>();
  if (visualAssetIds.length > 0) {
    try {
      const { rows } = await pool.query(
        `
        SELECT id::text, quality_flags
        FROM visual_assets
        WHERE id = ANY($1::uuid[])
        `,
        [visualAssetIds]
      );
      for (const r of rows ?? []) {
        const id = String((r as any).id);
        visualAssetById.set(id, { quality_flags: (r as any).quality_flags ?? null });
      }
    } catch (err) {
      if (isMissingTableError(err)) {
        warnings.push("visual_assets table missing; segment mapping via quality_flags unavailable");
      } else {
        warnings.push("visual_assets query failed; segment mapping via quality_flags unavailable");
      }
    }
  } else {
    warnings.push("No visual_asset_id references found in DPU payloads");
  }

  const nodes: SegmentedDealNode[] = [];
  for (const r of dpuRows) {
    const p = r.payload && typeof r.payload === "object" ? r.payload : null;
    const structuredKeyRaw = asNonEmptyString(p?.structured?.segment_key);
    const structuredKey = structuredKeyRaw ? normalizeAnalystSegment(structuredKeyRaw) : null;

    const visualAssetId = visualAssetIdFromPayload(p);
    const qualityFlags = visualAssetId ? visualAssetById.get(visualAssetId)?.quality_flags : null;

    const qfKeyRaw = asNonEmptyString(qualityFlags?.segment_key);
    const qfKey = qfKeyRaw ? normalizeAnalystSegment(qfKeyRaw) : null;
    const qfConfidence = typeof qualityFlags?.segment_confidence === "number" ? qualityFlags.segment_confidence : null;
    const qfSource = asNonEmptyString((qualityFlags as any)?.segment_source);
    const qfIsHumanOverride = qfSource === "human_override";

    let segmentKey: AnalystSegment | null = null;
    let segmentReason: SegmentedDealNode["segment_reason"] = {
      rules_hit: [],
      keywords_hit: [],
      classifier_confidence: null,
      source: "unknown",
    };

    const slideTitle = slideTitleFromPayload(p);
    const bullets = bulletsFromPayload(p, 12);
    const deterministic = segmentFromTitleAndBullets({ title: slideTitle, bullets });
    const deterministicIsStrong = deterministic.confidence >= 0.8 || deterministic.reason.title_rules_hit.length > 0;

    // Keep explicit human overrides stable (these are typically curated and should win).
    if (qfIsHumanOverride && qfKey) {
      segmentKey = qfKey;
      segmentReason = {
        rules_hit: ["visual_assets.quality_flags.segment_key"],
        keywords_hit: [],
        classifier_confidence: qfConfidence,
        source: "hybrid",
      };
    } else if (deterministicIsStrong) {
      segmentKey = deterministic.segment_key;
      segmentReason = {
        rules_hit: [
          ...deterministic.reason.title_rules_hit.map((x) => `segmenter:title:${x}`),
          ...deterministic.reason.bullet_rules_hit.map((x) => `segmenter:bullet:${x}`),
          ...deterministic.reason.override_rules_hit.map((x) => `segmenter:override:${x}`),
          "segmenter:dpu_page_v1",
        ],
        keywords_hit: deterministic.reason.keywords,
        classifier_confidence: deterministic.confidence,
        source: "deterministic",
        // include richer diagnostics for inspector
        title_rules_hit: deterministic.reason.title_rules_hit,
        bullet_rules_hit: deterministic.reason.bullet_rules_hit,
        override_rules_hit: deterministic.reason.override_rules_hit,
      } as any;
    } else if (qfKey) {
      segmentKey = qfKey;
      segmentReason = {
        rules_hit: ["visual_assets.quality_flags.segment_key"],
        keywords_hit: [],
        classifier_confidence: qfConfidence,
        source: "hybrid",
      };
    } else if (structuredKey) {
      segmentKey = structuredKey;
      segmentReason = {
        rules_hit: ["payload.structured.segment_key"],
        keywords_hit: [],
        classifier_confidence: null,
        source: "deterministic",
      };
    } else if (deterministic.segment_key !== "unknown" && deterministic.confidence > 0) {
      // Weak but non-empty deterministic fallback.
      segmentKey = deterministic.segment_key;
      segmentReason = {
        rules_hit: [
          ...deterministic.reason.title_rules_hit.map((x) => `segmenter:title:${x}`),
          ...deterministic.reason.bullet_rules_hit.map((x) => `segmenter:bullet:${x}`),
          ...deterministic.reason.override_rules_hit.map((x) => `segmenter:override:${x}`),
          "segmenter:dpu_page_v1:weak",
        ],
        keywords_hit: deterministic.reason.keywords,
        classifier_confidence: deterministic.confidence,
        source: "deterministic",
        title_rules_hit: deterministic.reason.title_rules_hit,
        bullet_rules_hit: deterministic.reason.bullet_rules_hit,
        override_rules_hit: deterministic.reason.override_rules_hit,
      } as any;
    }


    nodes.push({
      node_id: `${r.document_id}:${r.page_index}`,
      document_id: r.document_id,
      source_document_id: r.document_id,
      page_index: r.page_index,
      slide_title: slideTitle,
      bullets,
      bullets_snippet: bulletsSnippetFromPayload(p, 240),
      visual_asset_id: visualAssetId,
      segment_key: segmentKey,
      structured_segment_key_raw: structuredKeyRaw,
      quality_flags_segment_key_raw: qfKeyRaw,
      segment_reason: segmentReason,
    });
  }

  return { nodes, warnings };
}
