import { Position, type Edge, type Node } from '@xyflow/react';

const ROW_Y: Record<string, number> = {
  deal: 0,
  document: 280,
  segment: 560,
  visual: 900,
  evidence: 1250,
};

const ROW_GAP = 320;
const X_GAP = 110;

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

function normalizeType(node: Node): 'deal' | 'document' | 'segment' | 'visual' | 'evidence' | 'default' {
  const t = String((node as any)?.type ?? '').toLowerCase();
  if (t === 'deal') return 'deal';
  if (t === 'document') return 'document';
  if (t === 'segment') return 'segment';
  if (t === 'visual_asset' || t === 'visual_group') return 'visual';
  if (t === 'evidence' || t === 'evidence_group') return 'evidence';
  return 'default';
}

function rowYForNode(node: Node): number {
  const t = normalizeType(node);
  if (t === 'deal') return ROW_Y.deal;
  if (t === 'document') return ROW_Y.document;
  if (t === 'segment') return ROW_Y.segment;
  if (t === 'visual') return ROW_Y.visual;
  if (t === 'evidence') return ROW_Y.evidence;
  return ROW_Y.visual;
}

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

  // Hierarchy-aware layout for the Analyst graph.
  // This enforces: parent centered, children fanned out left-to-right.
  // We only apply this for TB because the UI is designed as top-down pipeline.
  if (direction === 'TB') {
    const byId = new Map(nodes.map((n) => [n.id, n] as const));
    const childrenById = new Map<string, string[]>();
    const parentsById = new Map<string, string[]>();

    const addChild = (source: string, target: string) => {
      if (!source || !target) return;
      if (!byId.has(source) || !byId.has(target)) return;
      if (source === target) return;

      const list = childrenById.get(source) ?? [];
      if (!list.includes(target)) list.push(target);
      childrenById.set(source, list);

      const plist = parentsById.get(target) ?? [];
      if (!plist.includes(source)) plist.push(source);
      parentsById.set(target, plist);
    };

    for (const e of _edges ?? []) {
      addChild(String(e.source ?? ''), String(e.target ?? ''));
    }

    const sortChildren = (ids: string[]) => {
      const safeLower = (v: unknown): string => (typeof v === 'string' ? v.toLowerCase() : '');
      return [...ids].sort((a, b) => {
        const na = byId.get(a);
        const nb = byId.get(b);
        const ta = na ? normalizeType(na) : 'default';
        const tb = nb ? normalizeType(nb) : 'default';
        if (ta !== tb) return ta.localeCompare(tb);
        const da = (na?.data ?? {}) as any;
        const db = (nb?.data ?? {}) as any;
        const la = safeLower(da.title ?? da.label ?? '');
        const lb = safeLower(db.title ?? db.label ?? '');
        if (la !== lb) return la.localeCompare(lb);
        return String(a).localeCompare(String(b));
      });
    };

    // Prefer a single deal root; otherwise, fall back to all nodes without parents.
    const dealRoots = nodes.filter((n) => normalizeType(n) === 'deal').map((n) => n.id);
    const roots = dealRoots.length > 0
      ? dealRoots
      : nodes.filter((n) => (parentsById.get(n.id) ?? []).length === 0).map((n) => n.id);

    const gapForParent = (nodeId: string): number => {
      const n = byId.get(nodeId);
      const t = n ? normalizeType(n) : 'default';
      const base = typeof options.nodesep === 'number' && Number.isFinite(options.nodesep) ? options.nodesep : X_GAP;
      if (t === 'deal') return Math.max(base, 160);
      if (t === 'document') return Math.max(base, 140);
      return base;
    };

    const widthById = new Map<string, number>();
    const subtreeWidthById = new Map<string, number>();
    for (const n of nodes) widthById.set(n.id, getNodeW(n));

    const visiting = new Set<string>();
    const subtreeWidth = (id: string): number => {
      if (subtreeWidthById.has(id)) return subtreeWidthById.get(id)!;
      if (visiting.has(id)) return widthById.get(id) ?? NODE_SIZE_BY_TYPE.default.w;
      visiting.add(id);
      const selfW = widthById.get(id) ?? NODE_SIZE_BY_TYPE.default.w;
      const kids0 = childrenById.get(id) ?? [];
      const kids = sortChildren(kids0);
      childrenById.set(id, kids);
      if (kids.length === 0) {
        subtreeWidthById.set(id, selfW);
        visiting.delete(id);
        return selfW;
      }
      const gap = gapForParent(id);
      const childWs = kids.map((kid) => subtreeWidth(kid));
      const totalKids = childWs.reduce((acc, w) => acc + w, 0) + gap * (kids.length - 1);
      const total = Math.max(selfW, totalKids);
      subtreeWidthById.set(id, total);
      visiting.delete(id);
      return total;
    };

    // Compute overall width across roots.
    const rootGap = typeof options.nodesep === 'number' && Number.isFinite(options.nodesep) ? options.nodesep : Math.max(X_GAP, 160);
    const rootWs = roots.map((r) => subtreeWidth(r));
    const totalWidth = rootWs.reduce((acc, w) => acc + w, 0) + (roots.length > 0 ? rootGap * (roots.length - 1) : 0);
    let rootCursor = -totalWidth / 2;

    const placed = new Map<string, { xLeft: number; y: number; w: number; h: number }>();
    const visited = new Set<string>();

    const place = (id: string, centerX: number) => {
      if (visited.has(id)) return;
      visited.add(id);
      const n = byId.get(id);
      if (!n) return;
      const w = widthById.get(id) ?? NODE_SIZE_BY_TYPE.default.w;
      const h = getNodeH(n);
      const xLeft = centerX - w / 2;
      const y = rowYForNode(n);
      placed.set(id, { xLeft, y, w, h });

      const kids = childrenById.get(id) ?? [];
      if (kids.length === 0) return;
      const gap = gapForParent(id);
      const subW = subtreeWidthById.get(id) ?? w;
      let cursor = centerX - subW / 2;
      for (const kid of kids) {
        const kidW = subtreeWidthById.get(kid) ?? (widthById.get(kid) ?? NODE_SIZE_BY_TYPE.default.w);
        const kidCenter = cursor + kidW / 2;
        place(kid, kidCenter);
        cursor += kidW + gap;
      }
    };

    for (let i = 0; i < roots.length; i++) {
      const r = roots[i];
      const rw = rootWs[i] ?? subtreeWidth(r);
      const center = rootCursor + rw / 2;
      place(r, center);
      rootCursor += rw + rootGap;
    }

    // Any nodes not reached from roots (should be rare) get appended in their row.
    const unplaced = nodes.filter((n) => !placed.has(n.id));
    if (unplaced.length > 0) {
      const startX = totalWidth / 2 + 220;
      const byRow = new Map<number, Node[]>();
      for (const n of unplaced) {
        const y = rowYForNode(n);
        const list = byRow.get(y) ?? [];
        list.push(n);
        byRow.set(y, list);
      }
      for (const [y, list0] of byRow.entries()) {
        const list = list0.sort((a, b) => String(a.id).localeCompare(String(b.id)));
        let cursor = startX;
        for (const n of list) {
          const w = getNodeW(n);
          const h = getNodeH(n);
          placed.set(n.id, { xLeft: cursor, y, w, h });
          cursor += w + X_GAP;
        }
      }
    }

    return nodes.map((node) => {
      const p = placed.get(node.id);
      if (!p) return node;
      return {
        ...node,
        sourcePosition,
        targetPosition,
        position: { x: p.xLeft, y: p.y },
      } as Node;
    });
  }

  const rows: Record<'deal' | 'document' | 'segment' | 'visual' | 'evidence', Node[]> = {
    deal: [],
    document: [],
    segment: [],
    visual: [],
    evidence: [],
  };

  const normalizeTypeLegacy = (node: Node): string => {
    const t = String((node as any)?.type ?? '').toLowerCase();
    if (t === 'visual_asset' || t === 'visual_group') return 'visual';
    if (t === 'evidence_group') return 'evidence';
    return t;
  };

  for (const node of nodes) {
    const t = normalizeTypeLegacy(node);
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
