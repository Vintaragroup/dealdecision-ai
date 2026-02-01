import {
  apiGetRenderedPageSignedUrl,
  resolveApiAssetUrl,
  type DealVisualAsset,
  type DocumentAnalysisResponse,
} from './apiClient';

const pageSnapshotUrlCache = new Map<string, string | null>();

export function __clearPageSnapshotUrlCacheForTests() {
  pageSnapshotUrlCache.clear();
}

type SnapshotDocumentLike =
  | Pick<DocumentAnalysisResponse, 'deal_id' | 'document_id' | 'extraction_metadata'>
  | { deal_id?: string | null; document_id?: string | null; id?: string | null; extraction_metadata?: any | null }
  | null
  | undefined;

function pad4(n: number): string {
  return String(Math.max(0, Math.trunc(n))).padStart(4, '0');
}

function normalizePageIndex(pageIndex: unknown): number | null {
  const idx = Number.parseInt(String(pageIndex ?? ''), 10);
  if (!Number.isFinite(idx) || idx < 0) return null;
  return Math.trunc(idx);
}

function getMeta(document: SnapshotDocumentLike): any | null {
  const meta = (document as any)?.extraction_metadata;
  return meta && typeof meta === 'object' ? meta : null;
}

function inferDocumentId(document: SnapshotDocumentLike): string | null {
  const d = document as any;
  const v = typeof d?.document_id === 'string' ? d.document_id : typeof d?.id === 'string' ? d.id : null;
  return v && v.trim().length > 0 ? v.trim() : null;
}

function inferDealId(document: SnapshotDocumentLike): string | null {
  const d = document as any;
  const v = typeof d?.deal_id === 'string' ? d.deal_id : null;
  return v && v.trim().length > 0 ? v.trim() : null;
}

function tryMetaList(meta: any, pageIndex: number): string | null {
  const listCandidates: unknown[] = [
    meta?.rendered_pages_urls,
    meta?.rendered_pages_uris,
    meta?.rendered_page_urls,
    meta?.rendered_page_uris,
    meta?.page_image_urls,
    meta?.page_image_uris,
    meta?.page_images,
    meta?.page_image_uris,
  ];

  for (const cand of listCandidates) {
    if (!Array.isArray(cand)) continue;
    const v = cand[pageIndex];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }

  return null;
}

function tryMetaPrefix(meta: any, pageIndex: number): string | null {
  const prefixCandidates: unknown[] = [
    meta?.rendered_pages_url_prefix,
    meta?.rendered_pages_uri_prefix,
    meta?.page_images_url_prefix,
    meta?.page_images_uri_prefix,
    meta?.page_image_url_prefix,
  ];

  for (const cand of prefixCandidates) {
    if (typeof cand !== 'string') continue;
    const prefix = cand.trim();
    if (!prefix) continue;

    const clean = prefix.replace(/\/+$/, '');
    return `${clean}/page_${pad4(pageIndex)}.png`;
  }

  return null;
}

export async function getPageSnapshotUrl(params: {
  dealId: string;
  document: SnapshotDocumentLike;
  pageIndex: number;
  visualAsset?: Pick<DealVisualAsset, 'image_uri'> | null;
}): Promise<string | null> {
  const idx = normalizePageIndex(params.pageIndex);
  if (idx == null) return null;

  const dealId = String(params.dealId ?? '').trim();
  const documentId = inferDocumentId(params.document);
  const docDealId = inferDealId(params.document);
  const meta = getMeta(params.document);
  const effectiveDealId = (docDealId || dealId).trim();

  const cacheKey = effectiveDealId && documentId ? `${effectiveDealId}:${documentId}:${idx}` : null;
  if (cacheKey && pageSnapshotUrlCache.has(cacheKey)) {
    return pageSnapshotUrlCache.get(cacheKey) ?? null;
  }

  // A) Prefer R2-backed rendered pages (mint fresh URL server-side).
  // Note: safe to try even if extraction_metadata is missing; API will fail if no rendered page exists.
  if (effectiveDealId && documentId) {
    try {
      const res = await apiGetRenderedPageSignedUrl(effectiveDealId, documentId, idx);
      if (typeof res?.url === 'string' && res.url.trim().length > 0) {
        const url = res.url.trim();
        if (cacheKey) pageSnapshotUrlCache.set(cacheKey, url);
        return url;
      }
    } catch {
      // fall through
    }
  }

  // B) Fallback: if the visual asset already points at a rendered page image.
  const assetUri = typeof params.visualAsset?.image_uri === 'string' ? params.visualAsset.image_uri.trim() : '';
  if (assetUri) {
    const resolved = resolveApiAssetUrl(assetUri);
    const url = resolved || assetUri;
    if (cacheKey) pageSnapshotUrlCache.set(cacheKey, url);
    return url;
  }

  // C) Fallback: legacy extraction_metadata lists/prefixes for rendered pages.
  if (meta) {
    const listUri = tryMetaList(meta, idx);
    if (listUri) {
      const resolved = resolveApiAssetUrl(listUri);
      const url = resolved || listUri;
      if (cacheKey) pageSnapshotUrlCache.set(cacheKey, url);
      return url;
    }

    const prefixUri = tryMetaPrefix(meta, idx);
    if (prefixUri) {
      const resolved = resolveApiAssetUrl(prefixUri);
      const url = resolved || prefixUri;
      if (cacheKey) pageSnapshotUrlCache.set(cacheKey, url);
      return url;
    }
  }

  if (cacheKey) pageSnapshotUrlCache.set(cacheKey, null);
  return null;
}
