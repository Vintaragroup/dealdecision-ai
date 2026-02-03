import type { DealVisualAsset, DeterministicUnderstandingInput } from './apiClient';

export function makeUnderstandingPageId(documentId: string, pageIndex: number): string {
  return `visual_asset_group:${documentId}:${pageIndex}`;
}

function normalizeTextCandidate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.replace(/\r\n?/g, '\n').trim();
  return t.length > 0 ? t : null;
}

function extractTextFromAsset(a: DealVisualAsset): string | null {
  const direct = normalizeTextCandidate(a.ocr_text);
  if (direct) return direct;

  const sj = a.structured_json as any;
  if (sj && typeof sj === 'object') {
    const v = normalizeTextCandidate(sj.text ?? sj.captured_text ?? sj.ocr_text);
    if (v) return v;
  }

  return null;
}

function parseBboxXY(bbox: unknown): { x: number; y: number } | null {
  // Reuse the common normalized bbox shape used in the repo: {x,y,w,h} in [0,1].
  // Stay permissive since bbox is untyped.
  if (!bbox || typeof bbox !== 'object') return null;
  const b: any = bbox as any;
  const x = typeof b.x === 'number' && Number.isFinite(b.x) ? b.x : null;
  const y = typeof b.y === 'number' && Number.isFinite(b.y) ? b.y : null;
  if (x == null || y == null) return null;
  return {
    x: Math.max(0, Math.min(1, x)),
    y: Math.max(0, Math.min(1, y)),
  };
}

export function buildDeterministicUnderstandingInputFromDealVisualAssets(args: {
  dealId: string;
  dealVisualAssets: DealVisualAsset[];
}): DeterministicUnderstandingInput {
  const { dealId, dealVisualAssets } = args;

  const byDocPage = new Map<string, DealVisualAsset[]>();
  for (const a of dealVisualAssets ?? []) {
    const docId = typeof a?.document_id === 'string' ? a.document_id : '';
    const pageIndex = typeof a?.page_index === 'number' && Number.isFinite(a.page_index) ? a.page_index : null;
    if (!docId || pageIndex == null || pageIndex < 0) continue;
    const key = `${docId}::${pageIndex}`;
    const list = byDocPage.get(key) ?? [];
    list.push(a);
    byDocPage.set(key, list);
  }

  const documentsById = new Map<string, { document_id: string; title?: string }>();
  const pages: DeterministicUnderstandingInput['pages'] = [];

  const keys = [...byDocPage.keys()].sort((a, b) => a.localeCompare(b));
  for (const key of keys) {
    const [docId, pageStr] = key.split('::');
    const pageIndex = Number(pageStr);
    if (!docId || !Number.isFinite(pageIndex)) continue;

    const assets = (byDocPage.get(key) ?? []).slice();
    assets.sort((a, b) => {
      const ba = parseBboxXY(a.bbox);
      const bb = parseBboxXY(b.bbox);
      const ya = ba?.y ?? 0;
      const yb = bb?.y ?? 0;
      if (ya !== yb) return ya - yb;
      const xa = ba?.x ?? 0;
      const xb = bb?.x ?? 0;
      if (xa !== xb) return xa - xb;
      return String(a.visual_asset_id).localeCompare(String(b.visual_asset_id));
    });

    const items = assets
      .map((a) => ({
        id: a.visual_asset_id,
        text: extractTextFromAsset(a),
      }))
      .filter((it) => typeof it.text === 'string' && it.text.trim().length > 0) as Array<{ id: string; text: string }>;

    const seen = new Set<string>();
    const parts: string[] = [];
    for (const it of items) {
      const dedupeKey = it.text.replace(/\s+/g, ' ').trim().toLowerCase();
      if (!dedupeKey) continue;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      parts.push(it.text);
    }

    const aggregated = parts.length ? parts.join('\n\n') : '';

    pages.push({
      page_id: makeUnderstandingPageId(docId, pageIndex),
      document_id: docId,
      page_index: pageIndex,
      page_number: pageIndex + 1,
      raw_ocr_text: aggregated,
    });

    if (!documentsById.has(docId)) {
      const title = assets.find((a) => typeof a?.document_title === 'string' && a.document_title.trim())?.document_title;
      documentsById.set(docId, {
        document_id: docId,
        ...(typeof title === 'string' && title.trim() ? { title: title.trim() } : {}),
      });
    }
  }

  const documents = [...documentsById.values()].sort((a, b) => a.document_id.localeCompare(b.document_id));

  return {
    deal_id: dealId,
    documents,
    pages,
  };
}
