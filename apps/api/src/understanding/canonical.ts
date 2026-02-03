import { createHash } from "node:crypto";

import type { DeterministicUnderstandingInput } from "./types";

export interface CanonicalUnderstandingInput {
  deal_id: string;
  documents: Array<Record<string, unknown>>;
  pages: Array<Record<string, unknown>>;
  segments?: Array<Record<string, unknown>>;
}

export function stableCompare(a: string | number, b: string | number): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function stableSortBy<T>(items: readonly T[], key: (item: T) => string | number): T[] {
  return [...items].sort((a, b) => stableCompare(key(a), key(b)));
}

export function stableJsonStringify(value: unknown): string {
  const seen = new WeakSet<object>();

  const normalize = (v: unknown): unknown => {
    if (v === null) return null;
    if (typeof v !== "object") return v;

    if (Array.isArray(v)) return v.map(normalize);

    const obj = v as Record<string, unknown>;
    if (seen.has(obj)) throw new Error("stableJsonStringify: circular reference");
    seen.add(obj);

    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) {
      const vv = obj[k];
      if (vv === undefined) continue;
      out[k] = normalize(vv);
    }
    return out;
  };

  return JSON.stringify(normalize(value));
}

const VOLATILE_KEY_EXACT = new Set([
  // timestamps
  "created_at",
  "updated_at",
  "scraped_at",
  "started_at",
  "finished_at",
  "processed_at",
  "ingested_at",
  "deleted_at",
  // runtime tracing / job execution
  "job_id",
  "run_id",
  "request_id",
  "trace_id",
  "span_id",
  "worker_id",
  "attempt_id",
  // common unstable identifiers for extracted assets
  "visual_asset_id",
  "asset_id",
  // generic runtime ids
  "id",
]);

function isVolatileKey(key: string): boolean {
  const k = key.toLowerCase();
  if (VOLATILE_KEY_EXACT.has(k)) return true;

  // Any *_at timestamp field is considered volatile.
  if (k.endsWith("_at")) return true;

  // URLs / paths are volatile (presigned URLs, local paths, rendered page paths, etc.).
  if (k.includes("url") || k.includes("uri") || k.includes("path")) return true;

  // Common storage/transport identifiers.
  // Use targeted patterns to avoid false positives (e.g. "assigned" contains "signed").
  if (k.includes("presigned")) return true;
  if (k.includes("download_url") || k.includes("downloaduri") || k.includes("download_uri")) return true;
  if (k.includes("signed_url") || k.includes("signeduri") || k.includes("signed_uri") || k.includes("signature")) return true;

  return false;
}

function sanitizeUnknown(value: unknown, parentKey?: string): unknown {
  if (value === null) return null;
  if (typeof value !== "object") return value;

  if (Array.isArray(value)) {
    const sanitized = value.map((v) => sanitizeUnknown(v, parentKey));

    // For deterministic hashing, sort arrays that are purely primitive values.
    // Keep object/array ordering as-is since order may be meaningful.
    const allPrimitive = sanitized.every(
      (v) => v === null || (typeof v !== "object" && typeof v !== "function")
    );

    if (allPrimitive) {
      return [...sanitized].sort((a, b) => {
        const sa = String(a);
        const sb = String(b);
        return stableCompare(sa, sb);
      });
    }

    return sanitized;
  }

  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    if (key === "raw_ocr_text") {
      // Keep raw OCR text exactly as-is.
      out[key] = obj[key];
      continue;
    }
    if (isVolatileKey(key)) continue;
    const v = obj[key];
    if (v === undefined) continue;
    out[key] = sanitizeUnknown(v, key);
  }
  return out;
}

export function buildCanonicalInput(deal: DeterministicUnderstandingInput): CanonicalUnderstandingInput {
  const documents = stableSortBy(deal.documents ?? [], (d) => d.document_id).map((d) => {
    return sanitizeUnknown({
      document_id: d.document_id,
      title: d.title,
      type: d.type,
      page_count: d.page_count,
    }) as Record<string, unknown>;
  });

  const pages = [...(deal.pages ?? [])]
    .sort((a, b) => {
      const docCmp = stableCompare(a.document_id, b.document_id);
      if (docCmp !== 0) return docCmp;

      const ai = typeof a.page_index === "number" ? a.page_index : Number.MAX_SAFE_INTEGER;
      const bi = typeof b.page_index === "number" ? b.page_index : Number.MAX_SAFE_INTEGER;
      const idxCmp = stableCompare(ai, bi);
      if (idxCmp !== 0) return idxCmp;

      return stableCompare(a.page_id, b.page_id);
    })
    .map((p) => {
      return {
        page_id: p.page_id,
        document_id: p.document_id,
        page_index: p.page_index,
        raw_ocr_text: p.raw_ocr_text,
        structured_extraction: sanitizeUnknown(p.structured_extraction, "structured_extraction"),
        evidence: sanitizeUnknown(p.evidence, "evidence"),
      } as Record<string, unknown>;
    });

  const segmentsInput = deal.segments;
  const segments = segmentsInput
    ? stableSortBy(segmentsInput, (s) => s.segment_id).map((s) => {
        const sortedPageIds = [...(s.page_ids ?? [])].sort((a, b) => stableCompare(a, b));
        return sanitizeUnknown({
          segment_id: s.segment_id,
          label: s.label,
          page_ids: sortedPageIds,
        }) as Record<string, unknown>;
      })
    : undefined;

  return {
    deal_id: deal.deal_id,
    documents,
    pages,
    segments,
  };
}

export function computeInputHash(canonical: CanonicalUnderstandingInput): string {
  return sha256Hex(stableJsonStringify(canonical));
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
