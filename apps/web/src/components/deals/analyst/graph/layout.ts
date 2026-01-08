import { Position, type Edge, type Node } from '@xyflow/react';

const ROW_Y: Record<string, number> = {
  deal: 0,
  document: 280,
  segment: 560,
  visual: 900,
  evidence: 1250,
};

const ROW_GAP = 320;
const X_GAP = 80;

const NODE_SIZE_BY_TYPE: Record<string, { w: number; h: number }> = {
  deal: { w: 260, h: 90 },
  document: { w: 320, h: 90 },
  segment: { w: 240, h: 80 },
  visual_asset: { w: 340, h: 120 },
  visual_group: { w: 360, h: 110 },
  evidence: { w: 260, h: 80 },
  evidence_group: { w: 280, h: 80 },
  default: { w: 300, h: 100 },
};

export type LayoutDirection = 'TB' | 'BT' | 'LR' | 'RL';

export type LayoutOptions = {
  direction?: LayoutDirection;
  ranksep?: number;
  nodesep?: number;
};

function getNodeW(node: Node): number {
  const measured = (node as any).measured as { width?: number } | undefined;
  const measuredWidth = typeof measured?.width === 'number' ? measured.width : undefined;
  if (measuredWidth && Number.isFinite(measuredWidth)) return measuredWidth;

  const widthProp = (node as any).width;
  if (typeof widthProp === 'number' && Number.isFinite(widthProp)) return widthProp;

  const t = String((node as any).type ?? '').toLowerCase();
  return NODE_SIZE_BY_TYPE[t]?.w ?? NODE_SIZE_BY_TYPE.default.w;
}

function getNodeH(node: Node): number {
  const measured = (node as any).measured as { height?: number } | undefined;
  const measuredHeight = typeof measured?.height === 'number' ? measured.height : undefined;
  if (measuredHeight && Number.isFinite(measuredHeight)) return measuredHeight;

  const heightProp = (node as any).height;
  if (typeof heightProp === 'number' && Number.isFinite(heightProp)) return heightProp;

  const t = String((node as any).type ?? '').toLowerCase();
  return NODE_SIZE_BY_TYPE[t]?.h ?? NODE_SIZE_BY_TYPE.default.h;
}

function estimateNodeSize(node: Node): { width: number; height: number } {
  return { width: getNodeW(node), height: getNodeH(node) };
}

function getPortPositions(direction: LayoutDirection): { sourcePosition: Position; targetPosition: Position } {
  switch (direction) {
    case 'BT':
      return { sourcePosition: Position.Top, targetPosition: Position.Bottom };
    case 'LR':
      return { sourcePosition: Position.Right, targetPosition: Position.Left };
    case 'RL':
      return { sourcePosition: Position.Left, targetPosition: Position.Right };
    case 'TB':
    default:
      return { sourcePosition: Position.Bottom, targetPosition: Position.Top };
  }
}

export function layoutGraph(nodes: Node[], _edges: Edge[], options: LayoutOptions = {}): Node[] {
  const direction = options.direction ?? 'TB';
  const { sourcePosition, targetPosition } = getPortPositions(direction);

  const rows: Record<'deal' | 'document' | 'segment' | 'visual' | 'evidence', Node[]> = {
    deal: [],
    document: [],
    segment: [],
    visual: [],
    evidence: [],
  };

  const normalizeType = (node: Node): string => {
    const t = String((node as any)?.type ?? '').toLowerCase();
    if (t === 'visual_asset' || t === 'visual_group') return 'visual';
    if (t === 'evidence_group') return 'evidence';
    return t;
  };

  for (const node of nodes) {
    const t = normalizeType(node);
    if (t === 'deal') rows.deal.push(node);
    else if (t === 'document') rows.document.push(node);
    else if (t === 'segment') rows.segment.push(node);
    else if (t === 'visual') rows.visual.push(node);
    else if (t === 'evidence') rows.evidence.push(node);
  }

  const safeLower = (v: unknown): string => (typeof v === 'string' ? v.toLowerCase() : '');

  rows.document.sort((a, b) => {
    const ad = (a.data ?? {}) as any;
    const bd = (b.data ?? {}) as any;
    const an = safeLower(ad.title ?? ad.label ?? '');
    const bn = safeLower(bd.title ?? bd.label ?? '');
    if (an !== bn) return an.localeCompare(bn);
    return String(a.id).localeCompare(String(b.id));
  });

  rows.segment.sort((a, b) => {
    const ad = (a.data ?? {}) as any;
    const bd = (b.data ?? {}) as any;
    const an = safeLower(ad.label ?? ad.segment ?? ad.segment_id ?? ad.__segmentId ?? '');
    const bn = safeLower(bd.label ?? bd.segment ?? bd.segment_id ?? bd.__segmentId ?? '');
    if (an !== bn) return an.localeCompare(bn);
    return String(a.id).localeCompare(String(b.id));
  });

  rows.visual.sort((a, b) => {
    const ad = (a.data ?? {}) as any;
    const bd = (b.data ?? {}) as any;
    const adoc = safeLower(ad.__docId ?? ad.document_id ?? ad.doc_id ?? '');
    const bdoc = safeLower(bd.__docId ?? bd.document_id ?? bd.doc_id ?? '');
    if (adoc !== bdoc) return adoc.localeCompare(bdoc);
    const aseg = safeLower(ad.__segmentId ?? ad.segment_id ?? '');
    const bseg = safeLower(bd.__segmentId ?? bd.segment_id ?? '');
    if (aseg !== bseg) return aseg.localeCompare(bseg);
    const apage = typeof ad.page_index === 'number' && Number.isFinite(ad.page_index) ? ad.page_index : -1;
    const bpage = typeof bd.page_index === 'number' && Number.isFinite(bd.page_index) ? bd.page_index : -1;
    if (apage !== bpage) return apage - bpage;
    return String(a.id).localeCompare(String(b.id));
  });

  rows.evidence.sort((a, b) => {
    const ad = (a.data ?? {}) as any;
    const bd = (b.data ?? {}) as any;
    const avis = safeLower(ad.visual_asset_id ?? ad.visual_id ?? ad.__visualId ?? '');
    const bvis = safeLower(bd.visual_asset_id ?? bd.visual_id ?? bd.__visualId ?? '');
    if (avis !== bvis) return avis.localeCompare(bvis);
    const atype = safeLower(ad.evidence_type ?? '');
    const btype = safeLower(bd.evidence_type ?? '');
    if (atype !== btype) return atype.localeCompare(btype);
    return String(a.id).localeCompare(String(b.id));
  });

  const order: Array<'deal' | 'document' | 'segment' | 'visual' | 'evidence'> = [
    'deal',
    'document',
    'segment',
    'visual',
    'evidence',
  ];

  const rowWidths = new Map<string, number>();
  for (const rowKey of order) {
    const list = rows[rowKey];
    if (!list.length) {
      rowWidths.set(rowKey, 0);
      continue;
    }
    const widths = list.map((n) => estimateNodeSize(n).width);
    const widthSum = widths.reduce((acc, w) => acc + w, 0);
    const totalWidth = widthSum + X_GAP * (list.length - 1);
    rowWidths.set(rowKey, totalWidth);
  }

  const globalWidth = order.reduce((acc, key) => Math.max(acc, rowWidths.get(key) ?? 0), 0);
  const startXByRow = new Map<string, number>();

  const laidOut: Node[] = [];
  for (const rowKey of order) {
    const list = rows[rowKey];
    if (!list.length) {
      startXByRow.set(rowKey, 0);
      continue;
    }

    const rowIndex = order.indexOf(rowKey);
    const baseY = typeof ROW_Y[rowKey] === 'number' ? ROW_Y[rowKey] : rowIndex * ROW_GAP;
    const rowWidth = rowWidths.get(rowKey) ?? 0;
    const startX = -globalWidth / 2 + (globalWidth - rowWidth) / 2;
    startXByRow.set(rowKey, startX);

    let cursorX = startX;

    for (const node of list) {
      const { width, height } = estimateNodeSize(node);
      laidOut.push({
        ...node,
        sourcePosition,
        targetPosition,
        data: { ...(node.data ?? {}), __layer: rowIndex },
        position: {
          x: cursorX,
          y: baseY,
        },
        measured: { width, height },
      } as Node);

      cursorX += width + X_GAP;
    }
  }

  const debugEnabled =
    import.meta.env.DEV &&
    typeof window !== 'undefined' &&
    window?.localStorage?.getItem('ddai:layout-debug') === '1';

  if (debugEnabled) {
    const rowWidthsObj = Object.fromEntries(order.map((k) => [k, Math.round(rowWidths.get(k) ?? 0)]));
    const startXObj = Object.fromEntries(order.map((k) => [k, Math.round(startXByRow.get(k) ?? 0)]));
    // eslint-disable-next-line no-console
    console.log('[layout swimlane]', {
      rowWidths: rowWidthsObj,
      globalWidth: Math.round(globalWidth),
      startX: startXObj,
      nodeCount: nodes.length,
    });
  }

  return laidOut;
}
