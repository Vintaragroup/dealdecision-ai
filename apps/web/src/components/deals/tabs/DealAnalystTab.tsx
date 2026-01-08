import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type ReactFlowInstance,
} from '@xyflow/react';
import { AlertCircle, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { Button } from '../../ui/button';
import {
  apiGetDealLineage,
  apiGetDocumentVisualAssets,
  isLiveBackend,
  resolveApiAssetUrl,
  type DealLineageResponse,
  type DocumentVisualAsset,
} from '../../../lib/apiClient';

import { layoutGraph } from '../analyst/graph/layout';
import { FloatingEdge } from '../analyst/graph/FloatingEdge';
import {
  computeVisibleGraph,
  defaultExpandedForNode,
  type ExpandedById,
} from '../analyst/graph/visibility';
import { projectClusteredGraph } from '../analyst/graph/cluster';
import {
  DealNode,
  DefaultNode,
  DocumentNode,
  EvidenceNode,
  EvidenceGroupNode,
  SegmentNode,
  VisualGroupNode,
  VisualAssetNode as AnalystVisualAssetNode,
} from '../analyst/graph/nodes';

import {
  getDevtoolsConsoleLoggingEnabled,
  getReactFlowDevtoolsEnabled,
  ReactFlowDevToolsOverlay,
  ReactFlowViewportBadge,
  useReactFlowChangeLogger,
  type DevtoolsSelection,
} from './reactflow-devtools';

type DealAnalystTabProps = {
  dealId: string;
  darkMode: boolean;
};

type InspectorSelection =
  | { kind: 'none' }
  | { kind: 'deal'; deal_id: string; name?: string | null }
  | { kind: 'document'; document_id: string; title?: string; type?: string; page_count?: number }
  | { kind: 'visual_asset'; document_id: string; visual_asset_id: string }
  | { kind: 'visual_group'; label?: string; segment_label?: string; count_slides?: number; evidence_count_total?: number; avg_confidence?: number | null; sample_summaries?: string[] }
  | { kind: 'evidence_group'; label?: string; evidence_count_total?: number; avg_confidence?: number | null; sample_summaries?: string[]; sample_snippet?: string | null; count?: number }
  | { kind: 'evidence'; visual_asset_id: string; count?: number };

type StructuredViewMode = 'preview' | 'raw';
type ColorMode = 'off' | 'document' | 'segment';

const COLOR_MODE_STORAGE_KEY = 'analystColorMode';
const MINIMAP_SCALE_STORAGE_KEY = 'analystMiniMapScale';
const MINIMAP_SCALE_MIN = 0.75;
const MINIMAP_SCALE_MAX = 2.5;
const MINIMAP_BASE_WIDTH = 180;
const MINIMAP_BASE_HEIGHT = 120;
const CLUSTER_SLIDES_STORAGE_KEY = 'analystClusterSlides';
const CLUSTER_MIN_VISUALS = 12;

export type TablePreviewModel = {
  rows: string[][];
  method?: string;
  confidence?: number;
  notes?: string;
  totalRows: number;
  totalCols: number;
  shownRows: number;
  shownCols: number;
  truncated: boolean;
};

export type BarChartPreviewModel = {
  values: number[];
  labels: string[];
  displayHeights: number[]; // 0..1 (display only)
  displayValues: string[];
  title?: string;
  unit?: string;
  yUnit?: string;
  method?: string;
  confidence?: number;
  notes?: string;
  valuesAreNormalized: boolean;
  totalBars: number;
  shownBars: number;
  truncated: boolean;
};

type NormalizedBbox = { x: number; y: number; w: number; h: number };

export function formatTableTruncationLabel(model: TablePreviewModel): string | null {
  if (!model.truncated) return null;
  return `Showing first ${model.shownRows} of ${model.totalRows} rows, first ${model.shownCols} of ${model.totalCols} columns`;
}

export function formatBarChartTruncationLabel(model: BarChartPreviewModel): string | null {
  if (!model.truncated) return null;
  return `Showing first ${model.shownBars} of ${model.totalBars} bars`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseNormalizedBbox(bbox: unknown): NormalizedBbox | null {
  if (!isRecord(bbox)) return null;
  const x = (bbox as any).x;
  const y = (bbox as any).y;
  const w = (bbox as any).w;
  const h = (bbox as any).h;
  if (typeof x !== 'number' || typeof y !== 'number' || typeof w !== 'number' || typeof h !== 'number') return null;
  if (![x, y, w, h].every((v) => Number.isFinite(v))) return null;
  return { x, y, w, h };
}

export function formatBboxLabel(bbox: unknown): string | null {
  const b = parseNormalizedBbox(bbox);
  if (!b) return null;
  return `bbox x=${b.x.toFixed(2)} y=${b.y.toFixed(2)} w=${b.w.toFixed(2)} h=${b.h.toFixed(2)}`;
}

export function getQualityFlagChips(
  qualityFlags: unknown,
  caps: { maxChips: number } = { maxChips: 8 }
): { chips: string[]; moreCount: number } {
  const maxChips = Math.max(0, Math.floor(caps.maxChips));
  const keys: string[] = [];

  if (Array.isArray(qualityFlags)) {
    for (const item of qualityFlags) {
      if (typeof item === 'string' && item.trim().length > 0) keys.push(item.trim());
      else if (isRecord(item) && typeof (item as any).key === 'string') keys.push(String((item as any).key).trim());
      else if (isRecord(item) && typeof (item as any).name === 'string') keys.push(String((item as any).name).trim());
    }
  } else if (isRecord(qualityFlags)) {
    for (const [k, v] of Object.entries(qualityFlags)) {
      if (!k || k.trim().length === 0) continue;
      // Prefer boolean true flags; also allow non-empty strings / non-null values.
      if (v === true) keys.push(k);
      else if (typeof v === 'string' && v.trim().length > 0) keys.push(k);
      else if (v != null && v !== false) keys.push(k);
    }
  }

  const uniqueSorted = Array.from(new Set(keys)).sort((a, b) => a.localeCompare(b));
  const chips = uniqueSorted.slice(0, maxChips);
  const moreCount = Math.max(0, uniqueSorted.length - chips.length);
  return { chips, moreCount };
}

function formatCompactNumber(value: number, maxLen: number = 6): string {
  if (!Number.isFinite(value)) return '';

  const fixed = (() => {
    // Prefer a short fixed representation for typical chart values.
    const s = value.toFixed(2);
    // Trim trailing zeros and dot.
    return s.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  })();

  if (fixed.length <= maxLen) return fixed;

  const prec = (() => {
    const abs = Math.abs(value);
    if (abs >= 1000) return value.toPrecision(3);
    if (abs >= 100) return value.toPrecision(4);
    return value.toPrecision(3);
  })();

  const cleaned = prec.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.slice(0, maxLen);
}

export function getTablePreviewModel(
  structuredJson: unknown,
  caps: { maxRows: number; maxCols: number } = { maxRows: 30, maxCols: 12 }
): TablePreviewModel | null {
  if (!isRecord(structuredJson)) return null;
  const table = structuredJson.table;
  if (!isRecord(table)) return null;

  const rawRows = table.rows;
  if (!Array.isArray(rawRows) || rawRows.length === 0) return null;
  if (!rawRows.every((r) => Array.isArray(r))) return null;

  const normalizedRows: string[][] = rawRows.map((r) =>
    (r as unknown[]).map((cell) => {
      if (cell == null) return '';
      if (typeof cell === 'string') return cell;
      if (typeof cell === 'number' || typeof cell === 'boolean') return String(cell);
      try {
        return JSON.stringify(cell);
      } catch {
        return String(cell);
      }
    })
  );

  const totalRows = normalizedRows.length;
  const totalCols = normalizedRows.reduce((m, r) => Math.max(m, r.length), 0);
  if (totalCols <= 0) return null;

  const shownRows = Math.max(0, Math.min(totalRows, caps.maxRows));
  const shownCols = Math.max(0, Math.min(totalCols, caps.maxCols));
  if (shownRows === 0 || shownCols === 0) return null;

  const rows = normalizedRows.slice(0, shownRows).map((r) => {
    const sliced = r.slice(0, shownCols);
    while (sliced.length < shownCols) sliced.push('');
    return sliced;
  });

  const confidence = typeof table.confidence === 'number' ? table.confidence : undefined;
  const method = typeof table.method === 'string' ? table.method : undefined;
  const notes = typeof table.notes === 'string' ? table.notes : undefined;

  const truncated = totalRows > shownRows || totalCols > shownCols;

  return {
    rows,
    method,
    confidence,
    notes,
    totalRows,
    totalCols,
    shownRows,
    shownCols,
    truncated,
  };
}

export function getBarChartPreviewModel(
  structuredJson: unknown,
  caps: { maxBars: number } = { maxBars: 24 }
): BarChartPreviewModel | null {
  if (!isRecord(structuredJson)) return null;
  const chart = structuredJson.chart;
  if (!isRecord(chart)) return null;
  if (chart.type !== 'bar') return null;

  const series = chart.series;
  if (!Array.isArray(series) || series.length === 0) return null;
  const s0 = series[0];
  if (!isRecord(s0)) return null;

  const rawValues = s0.values;
  if (!Array.isArray(rawValues) || rawValues.length === 0) return null;
  if (!rawValues.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;

  const valuesAll = rawValues as number[];
  const totalBars = valuesAll.length;
  const shownBars = Math.max(0, Math.min(totalBars, caps.maxBars));
  if (shownBars === 0) return null;

  const values = valuesAll.slice(0, shownBars);
  const maxValue = Math.max(0, ...valuesAll);
  const denom = maxValue > 0 ? maxValue : 0;
  const displayHeights = values.map((v) => {
    if (denom <= 0) return 0;
    return Math.max(0, Math.min(1, v / denom));
  });

  const xLabels = chart.x_labels;
  const useXLabels = Array.isArray(xLabels) && xLabels.length === totalBars && xLabels.every((l) => typeof l === 'string');
  const labels = (useXLabels ? (xLabels as string[]) : valuesAll.map((_, i) => String(i + 1))).slice(0, shownBars);

  const displayValues = values.map((v) => formatCompactNumber(v, 6));

  const title = typeof chart.title === 'string' ? chart.title : undefined;
  const yUnit = typeof chart.y_unit === 'string' ? chart.y_unit : undefined;
  const unit = typeof s0.unit === 'string' ? s0.unit : undefined;
  const method = typeof chart.method === 'string' ? chart.method : undefined;
  const confidence = typeof chart.confidence === 'number' ? chart.confidence : undefined;
  const notes = typeof chart.notes === 'string' ? chart.notes : undefined;
  const valuesAreNormalized = s0.values_are_normalized === true;

  const truncated = totalBars > shownBars;

  return {
    values,
    labels,
    displayHeights,
    displayValues,
    title,
    unit,
    yUnit,
    method,
    confidence,
    notes,
    valuesAreNormalized,
    totalBars,
    shownBars,
    truncated,
  };
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function normalizeLineageNodeType(raw: any):
  | 'deal'
  | 'document'
  | 'segment'
  | 'visual_group'
  | 'visual_asset'
  | 'evidence_group'
  | 'evidence'
  | 'default' {
  const t0 = String(raw?.type ?? raw?.node_type ?? '').trim();
  const t = t0.toLowerCase();
  if (t === 'deal') return 'deal';
  if (t === 'document') return 'document';
  if (t === 'segment') return 'segment';
  if (t === 'visual_group' || t === 'visual group') return 'visual_group';
  if (t === 'visual_asset' || t === 'visual asset') return 'visual_asset';
  if (t === 'evidence_group' || t === 'evidence group') return 'evidence_group';
  if (t === 'evidence') return 'evidence';
  return 'default';
}

function layerForType(nodeType: ReturnType<typeof normalizeLineageNodeType>): number {
  if (nodeType === 'deal') return 0;
  if (nodeType === 'document') return 1;
  if (nodeType === 'segment') return 2;
  if (nodeType === 'visual_group') return 3;
  if (nodeType === 'visual_asset') return 3;
  if (nodeType === 'evidence_group') return 4;
  if (nodeType === 'evidence') return 4;
  return 3;
}

function colorFromKey(key: string, darkMode: boolean): { stroke: string; fill: string; tint: string } {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  const strokeLightness = darkMode ? 72 : 45;
  const fillLightness = darkMode ? 20 : 92;
  const tintLightness = darkMode ? 30 : 85;
  const stroke = `hsl(${hue} 80% ${strokeLightness}%)`;
  const fill = `hsl(${hue} 32% ${fillLightness}%)`;
  const tint = `hsl(${hue} 60% ${tintLightness}%)`;
  return { stroke, fill, tint };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getDocIdFromData(d: any): string | null {
  const docId = d?.document_id ?? d?.doc_id ?? d?.documentId;
  if (typeof docId === 'string' && docId.trim()) return docId.trim();
  return null;
}

function getSegmentIdFromData(d: any): string | null {
  const segId = d?.segment_id ?? d?.segmentId;
  if (typeof segId === 'string' && segId.trim()) return segId.trim();
  return null;
}

function branchKeyFromData(data: any, colorMode: ColorMode): string | null {
  if (colorMode === 'off') return null;
  const docId = data?.__docId ?? getDocIdFromData(data);
  const segId = data?.__segmentId ?? getSegmentIdFromData(data);
  if (colorMode === 'document') return docId ?? null;
  return segId ?? docId ?? null;
}

function getBranchKeyFromNodeData(nodeType: string, data: any): string {
  const fromData = typeof data?.__branchKey === 'string' && data.__branchKey.trim().length > 0 ? data.__branchKey.trim() : null;
  if (fromData) return fromData;

  const docId = (() => {
    const doc = data?.__docId ?? data?.document_id ?? data?.doc_id ?? data?.documentId;
    return typeof doc === 'string' && doc.trim() ? doc.trim() : null;
  })();
  const segId = (() => {
    const seg = data?.__segmentId ?? data?.segment_id ?? data?.segmentId;
    return typeof seg === 'string' && seg.trim() ? seg.trim() : null;
  })();

  if (docId || segId) {
    const docPart = docId ?? 'none';
    const segPart = segId ?? 'none';
    return `${docPart}:${segPart}`;
  }

  if (nodeType === 'deal') return 'deal';

  return `type:${nodeType || 'unknown'}`;
}

function isHoverDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem('ddai:hover-debug') === '1';
}

function getLineageNodeId(raw: any): string {
  const id = raw?.node_id ?? raw?.id;
  return typeof id === 'string' && id.trim().length > 0 ? id : '';
}

let didLogVisualAssetNodeTypes = false;
const minimapLoggedTypes = new Set<string>();

function buildFullGraphFromLineage(lineage: DealLineageResponse): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // DEV-only: verify lineage-enriched visual_asset fields survive mapping into React Flow nodes.
  let didLogLineageVisualAssetMapping = false;

  for (let idx = 0; idx < (lineage.nodes || []).length; idx++) {
    const raw = (lineage.nodes || [])[idx] as any;
    const nodeType = normalizeLineageNodeType(raw);
    const id = getLineageNodeId(raw) || `unknown:${nodeType}:${idx}`;
    const layer = layerForType(nodeType);
    const inferredDocId = (() => {
      const fromData = getDocIdFromData(raw?.data ?? {});
      if (fromData) return fromData;
      if (String(id).startsWith('document:')) return id.slice('document:'.length);
      return null;
    })();
    const inferredSegmentId = (() => {
      const fromData = getSegmentIdFromData(raw?.data ?? {});
      if (fromData) return fromData;
      if (String(id).startsWith('segment:')) return id.slice('segment:'.length);
      return null;
    })();
    const label =
      raw?.data?.label ??
      raw?.label ??
      raw?.data?.title ??
      raw?.metadata?.title ??
      id;

    const mapped: Node = {
      id,
      type: nodeType,
      position: { x: 0, y: 0 },
      data: {
        ...(raw?.data ?? {}),
        ...(raw?.metadata ? { __metadata: raw.metadata } : {}),
        label,
        __node_type: nodeType,
        __layer: layer,
        __docId: inferredDocId ?? undefined,
        __segmentId: inferredSegmentId ?? undefined,
        __branchKey: getBranchKeyFromNodeData(nodeType, {
          ...(raw?.data ?? {}),
          __docId: inferredDocId ?? undefined,
          __segmentId: inferredSegmentId ?? undefined,
          __branchKey: (raw?.data as any)?.__branchKey,
        }),
      },
      selectable: true,
    } as Node;

    if (
      !didLogLineageVisualAssetMapping &&
      import.meta.env.DEV &&
      getDevtoolsConsoleLoggingEnabled() &&
      nodeType === 'visual_asset'
    ) {
      didLogLineageVisualAssetMapping = true;
      try {
        // eslint-disable-next-line no-console
        console.log('[DEV lineage→mapped visual_asset]', {
          id,
          rawKeys: Object.keys(raw?.data ?? {}),
          raw: {
            ocr_text_snippet: raw?.data?.ocr_text_snippet,
            evidence0: raw?.data?.evidence_snippets?.[0],
            structured_kind: raw?.data?.structured_kind,
          },
          mappedKeys: Object.keys((mapped as any)?.data ?? {}),
          mapped: {
            ocr_text_snippet: (mapped as any)?.data?.ocr_text_snippet,
            evidence0: (mapped as any)?.data?.evidence_snippets?.[0],
            structured_kind: (mapped as any)?.data?.structured_kind,
          },
        });
      } catch {
        // ignore
      }
    }

    nodes.push(mapped);
  }

  if (!didLogVisualAssetNodeTypes && import.meta.env.DEV && getDevtoolsConsoleLoggingEnabled() && typeof window !== 'undefined') {
    didLogVisualAssetNodeTypes = true;
    const firstThree = nodes
      .filter((n) => String((n as any)?.type ?? '') === 'visual_asset')
      .slice(0, 3)
      .map((n) => ({ id: n.id, type: (n as any).type, __node_type: (n as any)?.data?.__node_type }));
    if (firstThree.length > 0) console.log('[DealAnalystTab] visual_asset node types', firstThree);
  }

  for (const rawEdge of lineage.edges || []) {
    edges.push({
      id: rawEdge.id,
      source: rawEdge.source,
      target: rawEdge.target,
      data: {
        __docId: undefined,
        __segmentId: undefined,
      },
    } as Edge);
  }

  return inferBranchMetadata(nodes, edges);
}

function inferBranchMetadata(nodes: Node[], edges: Edge[]): { nodes: Node[]; edges: Edge[] } {
  const docById = new Map<string, string>();
  const segById = new Map<string, string>();

  const seedFromNode = (n: Node) => {
    const data = (n.data ?? {}) as any;
    const type = String((n as any)?.type ?? '').toLowerCase();
    const docId = data.__docId ?? getDocIdFromData(data) ?? (type === 'document' ? (data.document_id ?? (String(n.id).startsWith('document:') ? String(n.id).slice('document:'.length) : String(n.id))) : null);
    const segId = data.__segmentId ?? getSegmentIdFromData(data) ?? (type === 'segment' ? (data.segment_id ?? (String(n.id).startsWith('segment:') ? String(n.id).slice('segment:'.length) : String(n.id))) : null);
    if (typeof docId === 'string' && docId.trim()) docById.set(n.id, String(docId));
    if (typeof segId === 'string' && segId.trim()) segById.set(n.id, String(segId));
  };

  for (const n of nodes) seedFromNode(n);

  for (let iter = 0; iter < 5; iter++) {
    let changed = false;
    for (const e of edges) {
      const sDoc = docById.get(e.source);
      const tDoc = docById.get(e.target);
      if (sDoc && !tDoc) {
        docById.set(e.target, sDoc);
        changed = true;
      } else if (tDoc && !sDoc) {
        docById.set(e.source, tDoc);
        changed = true;
      }

      const sSeg = segById.get(e.source);
      const tSeg = segById.get(e.target);
      if (sSeg && !tSeg) {
        segById.set(e.target, sSeg);
        changed = true;
      } else if (tSeg && !sSeg) {
        segById.set(e.source, tSeg);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const updatedNodes = nodes.map((n) => {
    const data = { ...(n.data ?? {}) } as any;
    const docId = docById.get(n.id) ?? data.__docId;
    const segId = segById.get(n.id) ?? data.__segmentId;
    const nodeType = String((n as any)?.type ?? '').toLowerCase();
    const mergedData = {
      ...data,
      __docId: docId,
      __segmentId: segId,
    };
    return {
      ...n,
      data: {
        ...mergedData,
        __branchKey: getBranchKeyFromNodeData(nodeType, mergedData),
      },
    } as Node;
  });

  const updatedEdges = edges.map((e) => {
    const docId = docById.get(e.target) ?? docById.get(e.source);
    const segId = segById.get(e.target) ?? segById.get(e.source) ?? docId;
    const branchKey = `${docId ?? 'none'}:${segId ?? 'none'}`;
    return {
      ...e,
      data: {
        ...(e as any).data,
        __docId: docId,
        __segmentId: segId,
        __branchKey: branchKey,
      },
    } as Edge;
  });

  return { nodes: updatedNodes, edges: updatedEdges };
}

function branchKeyForEdge(edge: Edge, colorMode: ColorMode, nodeKeys: Map<string, string>): string | null {
  if (colorMode === 'off') return null;
  const data = ((edge as any)?.data ?? {}) as any;
  const docId = data.__docId ?? getDocIdFromData(data);
  const segId = data.__segmentId ?? getSegmentIdFromData(data);

  const keyFromData = (() => {
    if (colorMode === 'document') return docId ?? null;
    return segId ?? docId ?? null;
  })();
  if (keyFromData) return keyFromData;

  const fromSource = nodeKeys.get(edge.source);
  const fromTarget = nodeKeys.get(edge.target);
  return fromSource ?? fromTarget ?? null;
}

function findDealRootId(nodes: Node[], dealId: string): string {
  const explicit = nodes.find((n) => String((n as any)?.type ?? '').toLowerCase() === 'deal');
  return explicit?.id ?? `deal:${dealId}`;
}

export function DealAnalystTab({ dealId, darkMode }: DealAnalystTabProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const devtoolsEnabled = useMemo(() => getReactFlowDevtoolsEnabled(), []);

  const [lineage, setLineage] = useState<DealLineageResponse | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const [fullGraph, setFullGraph] = useState<{ nodes: Node[]; edges: Edge[] } | null>(null);
  const [expandedById, setExpandedById] = useState<ExpandedById>({});
  const [layoutNonce, setLayoutNonce] = useState(0);
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);
  const didInitialFitRef = useRef(false);
  const lastFitViewNonceRef = useRef<number | null>(null);
  const [colorMode, setColorMode] = useState<ColorMode>(() => {
    if (typeof window === 'undefined') return 'off';
    const stored = window.localStorage.getItem(COLOR_MODE_STORAGE_KEY);
    return stored === 'document' || stored === 'segment' ? stored : 'off';
  });

  const [clusterSlides, setClusterSlides] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    const stored = window.localStorage.getItem(CLUSTER_SLIDES_STORAGE_KEY);
    if (stored === 'false') return false;
    if (stored === 'true') return true;
    return true;
  });

  const [hoverBranchKey, setHoverBranchKey] = useState<string | null>(null);
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null);

  const [minimapScale, setMinimapScale] = useState<number>(() => {
    if (typeof window === 'undefined') return 1;
    const raw = window.localStorage.getItem(MINIMAP_SCALE_STORAGE_KEY);
    const parsed = raw != null ? Number(raw) : NaN;
    if (Number.isFinite(parsed)) return clamp(parsed, MINIMAP_SCALE_MIN, MINIMAP_SCALE_MAX);
    return 1;
  });

  const [nodes, setNodes, onNodesChange] = useNodesState([] as Node[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[]);

  const { logNodesChange, logEdgesChange } = useReactFlowChangeLogger(devtoolsEnabled);

  const relayoutScheduledRef = useRef(false);
  const hasMeasuredDimensionsRef = useRef(false);
  const lastFitCountsRef = useRef({ nodes: 0, edges: 0 });
  const clusterLogOnceRef = useRef<string | null>(null);

  const [selection, setSelection] = useState<InspectorSelection>({ kind: 'none' });
  const [selectedRfNodeId, setSelectedRfNodeId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [visualDetailLoading, setVisualDetailLoading] = useState(false);
  const [visualDetailError, setVisualDetailError] = useState<string | null>(null);
  const [selectedVisual, setSelectedVisual] = useState<DocumentVisualAsset | null>(null);

  const [imageLoadError, setImageLoadError] = useState(false);
  const [showBboxOverlay, setShowBboxOverlay] = useState(false);

  const [structuredViewMode, setStructuredViewMode] = useState<StructuredViewMode>('raw');

  const tablePreviewModel = useMemo(
    () => (selectedVisual ? getTablePreviewModel(selectedVisual.structured_json) : null),
    [selectedVisual]
  );

  const barChartPreviewModel = useMemo(
    () => (selectedVisual ? getBarChartPreviewModel(selectedVisual.structured_json) : null),
    [selectedVisual]
  );

  useEffect(() => {
    const hasPreview = Boolean(tablePreviewModel || (!tablePreviewModel && barChartPreviewModel));
    setStructuredViewMode(hasPreview ? 'preview' : 'raw');
  }, [selectedVisual?.visual_asset_id, tablePreviewModel, barChartPreviewModel]);

  useEffect(() => {
    setImageLoadError(false);
    setShowBboxOverlay(false);
  }, [selectedVisual?.visual_asset_id]);

  useEffect(() => {
    if (selection.kind !== 'none' && !inspectorOpen) setInspectorOpen(true);
  }, [selection.kind, inspectorOpen]);

  const docAssetCacheRef = useRef(new Map<string, DocumentVisualAsset[]>());

  const refresh = async () => {
    if (!dealId || !isLiveBackend()) return;

    setLoading(true);
    setError(null);
    setVisualDetailError(null);
    setSelectedVisual(null);

    try {
      const res = await apiGetDealLineage(dealId);
      // DEV: expose lineage for quick inspection in the browser console.
      // Usage: window.__lineage?.nodes?.find(n => String(n.id).startsWith('visual_asset:'))
      if (typeof window !== 'undefined') {
        (window as any).__lineage = res;
        if (import.meta.env.DEV && getDevtoolsConsoleLoggingEnabled()) {
          try {
            const sample = (res?.nodes ?? []).find((n: any) => String(n?.id ?? '').startsWith('visual_asset:'));
            // eslint-disable-next-line no-console
            console.log('[lineage sample visual_asset]', sample?.id, sample?.data);
          } catch {
            // ignore
          }
        }
      }
      setLineage(res);
      setWarnings(Array.isArray(res?.warnings) ? res.warnings : []);
      setSelection({ kind: 'none' });
      setSelectedRfNodeId(null);
      docAssetCacheRef.current.clear();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load analyst graph');
      setLineage(null);
      setWarnings([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  useEffect(() => {
    didInitialFitRef.current = false;
    lastFitViewNonceRef.current = null;
  }, [dealId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(COLOR_MODE_STORAGE_KEY, colorMode);
  }, [colorMode]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(CLUSTER_SLIDES_STORAGE_KEY, String(clusterSlides));
  }, [clusterSlides]);

  useEffect(() => {
    if (colorMode === 'off') {
      setHoverBranchKey(null);
      setHoverNodeId(null);
    }
  }, [colorMode]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(MINIMAP_SCALE_STORAGE_KEY, String(minimapScale));
  }, [minimapScale]);

  useEffect(() => {
    if (!lineage) {
      setFullGraph(null);
      setExpandedById({});
      return;
    }

    const g = buildFullGraphFromLineage(lineage);
    setFullGraph(g);

    const initExpanded: ExpandedById = {};
    for (const n of g.nodes) initExpanded[n.id] = defaultExpandedForNode(n);
    setExpandedById(initExpanded);
  }, [lineage]);

  useEffect(() => {
    clusterLogOnceRef.current = null;
  }, [lineage]);

  const dealRootId = useMemo(() => {
    if (!fullGraph) return `deal:${dealId}`;
    return findDealRootId(fullGraph.nodes, dealId);
  }, [fullGraph, dealId]);

  const visible = useMemo(() => {
    if (!fullGraph) {
      return {
        visibleNodes: [] as Node[],
        visibleEdges: [] as Edge[],
        descendantCountsById: {} as Record<string, number>,
        connectedNodeIds: new Set<string>(),
      };
    }
    return computeVisibleGraph({
      nodes: fullGraph.nodes,
      edges: fullGraph.edges,
      rootId: dealRootId,
      expandedById,
    });
  }, [fullGraph, dealRootId, expandedById]);

  const clusterVisualStats = useMemo(() => {
    if (!fullGraph) return { visualCount: 0, distinctDocs: 0 };
    let visualCount = 0;
    const docs = new Set<string>();
    for (const n of fullGraph.nodes) {
      const t = String((n as any)?.type ?? '').toLowerCase();
      if (t !== 'visual_asset') continue;
      visualCount += 1;
      const docId = getDocIdFromData((n.data ?? {}) as any);
      if (docId) docs.add(docId);
    }
    return { visualCount, distinctDocs: docs.size };
  }, [fullGraph]);

  const clusterEligible = useMemo(() => {
    const { visualCount, distinctDocs } = clusterVisualStats;
    if (visualCount >= CLUSTER_MIN_VISUALS) return true;
    if (visualCount >= 8 && distinctDocs >= 2) return true;
    return false;
  }, [clusterVisualStats]);

  const clusterEnabled = clusterSlides && clusterEligible;

  const clustered = useMemo(() => {
    return projectClusteredGraph({
      nodes: visible.visibleNodes,
      edges: visible.visibleEdges,
      expandedById,
      clusterEnabled,
      clusterEligible,
    });
  }, [visible.visibleNodes, visible.visibleEdges, expandedById, clusterEnabled, clusterEligible]);

  useEffect(() => {
    if (!import.meta.env.DEV || !getDevtoolsConsoleLoggingEnabled()) return;
    if (clusterLogOnceRef.current !== null) return;
    const expandedGroupId = clustered.expandedGroupIds[0] ?? null;
    // eslint-disable-next-line no-console
    console.log(`[cluster] eligible=${clusterEligible} enabled=${clusterEnabled} expandedGroupId=${expandedGroupId ?? 'null'}`);
    // eslint-disable-next-line no-console
    console.log('[cluster] nodes out: visual_group=%d evidence_group=%d visual_asset=%d evidence=%d', clustered.stats.visual_group, clustered.stats.evidence_group, clustered.stats.visual_asset, clustered.stats.evidence);
    clusterLogOnceRef.current = 'logged';
  }, [clustered, clusterEligible, clusterEnabled]);

  const renderedEdges = useMemo(() => {
    return clustered.edges.map((e) => {
      const data = (e as any).data ?? {};
      const docId = data.__docId ?? getDocIdFromData(data);
      const segId = data.__segmentId ?? getSegmentIdFromData(data);
      const colorKey = colorMode === 'segment' ? segId ?? docId : colorMode === 'document' ? docId : null;
      const accent = colorKey ? colorFromKey(String(colorKey), darkMode) : null;
      const stroke = accent?.stroke ?? (darkMode ? 'rgba(255,255,255,0.2)' : 'rgba(17,24,39,0.25)');
      return {
        ...e,
        type: 'floating',
        animated: false,
        style: {
          ...(e as any).style,
          stroke,
          strokeWidth: accent ? 2 : undefined,
          opacity: accent ? 0.75 : undefined,
        },
        data,
      } as Edge;
    });
  }, [clustered.edges, darkMode, colorMode]);

  const renderedNodesUnlaid = useMemo(() => {
    const toggle = (id: string) => {
      setExpandedById((prev) => {
        const node = fullGraph?.nodes.find((n) => n.id === id) ?? clustered.nodes.find((n) => n.id === id);
        const cur = prev[id] ?? (node ? defaultExpandedForNode(node) : false);
        return { ...prev, [id]: !cur };
      });
    };

    return clustered.nodes.map((n) => {
      const baseNode = fullGraph?.nodes.find((bn) => bn.id === n.id) ?? n;
      const stableType = String((baseNode as any)?.type ?? (n as any)?.type ?? 'default').trim().toLowerCase();
      const expanded = expandedById[n.id] ?? defaultExpandedForNode(n);
      const descendantCount = clustered.descendantCountsById[n.id] ?? 0;
      const baseData = (baseNode as any)?.data ?? {};
      const colorKey = (() => {
        if (colorMode === 'off') return null;
        if (stableType === 'deal') return null;
        const docId = baseData.__docId ?? getDocIdFromData(baseData);
        const segId = baseData.__segmentId ?? getSegmentIdFromData(baseData);
        if (colorMode === 'segment') return segId ?? docId ?? null;
        return docId ?? null;
      })();
      const accent = colorKey ? colorFromKey(colorKey, darkMode) : null;
      return {
        ...n,
        type: stableType,
        draggable: false,
        // Force node to receive pointer events even if the pane layer is draggable.
        className: `${typeof (n as any).className === 'string' ? (n as any).className : ''} pointer-events-auto`.trim(),
        style: {
          ...(((n as any).style as any) ?? {}),
          pointerEvents: 'all',
        },
        data: {
          ...((baseNode as any)?.data ?? {}),
          ...(n.data ?? {}),
          __darkMode: darkMode,
          __node_type: stableType,
          expanded,
          descendantCount,
          onToggleExpand: () => toggle(n.id),
          __accentColor: accent?.stroke,
          __accentTint: accent?.tint,
        },
      } as Node;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clustered.nodes, clustered.descendantCountsById, expandedById, darkMode, fullGraph, colorMode]);

  const renderedNodes = useMemo(() => {
    // Re-run layout when lineage loads, when expansion changes, or on explicit re-layout.
    void layoutNonce;
    return layoutGraph(renderedNodesUnlaid, renderedEdges, { direction: 'TB' });
  }, [renderedNodesUnlaid, renderedEdges, layoutNonce]);

  useEffect(() => {
    if (!import.meta.env.DEV || !getDevtoolsConsoleLoggingEnabled()) return;
    // Warn if layout recomputes while hover is active (should not happen).
    if (hoverBranchKey != null) {
      // eslint-disable-next-line no-console
      console.warn('[hover/layout warning] layout recomputed while hover active', { layoutNonce, hoverBranchKey });
    }
  }, [layoutNonce, hoverBranchKey]);


  const branchKeyByNodeId = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of renderedNodes) {
      const nodeType = String((n as any)?.type ?? '').toLowerCase();
      const key = getBranchKeyFromNodeData(nodeType, (n as any)?.data ?? {});
      if (key) map.set(n.id, key);
    }
    return map;
  }, [renderedNodes]);

  const branchKeyByEdgeId = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of renderedEdges) {
      const data = ((e as any)?.data ?? {}) as any;
      const key = typeof data.__branchKey === 'string' && data.__branchKey.trim()
        ? data.__branchKey.trim()
        : branchKeyFromData(data, colorMode) ?? null;
      if (key) map.set(e.id, key);
      else {
        const fromSource = branchKeyByNodeId.get(e.source);
        const fromTarget = branchKeyByNodeId.get(e.target);
        const fallback = fromSource ?? fromTarget;
        if (fallback) map.set(e.id, fallback);
      }
    }
    return map;
  }, [renderedEdges, colorMode, branchKeyByNodeId]);

  const displayNodes = useMemo(() => {
    if (hoverBranchKey == null || colorMode === 'off') return renderedNodes;
    return renderedNodes.map((n) => {
      const key = branchKeyByNodeId.get(n.id) ?? getBranchKeyFromNodeData(String((n as any)?.type ?? '').toLowerCase(), (n as any)?.data ?? {});
      if (key === hoverBranchKey) return n;
      const baseStyle = { ...(((n as any).style as any) ?? {}) } as any;
      const nextOpacity = 0.2;
      if (baseStyle.opacity === nextOpacity) return n;
      return {
        ...n,
        style: {
          ...baseStyle,
          opacity: nextOpacity,
        },
      } as Node;
    });
  }, [renderedNodes, hoverBranchKey, branchKeyByNodeId, colorMode]);

  const displayEdges = useMemo(() => {
    if (hoverBranchKey == null || colorMode === 'off') return renderedEdges;
    return renderedEdges.map((e) => {
      const key = branchKeyByEdgeId.get(e.id) ?? null;
      if (key === hoverBranchKey) return e;
      const baseStyle = { ...(((e as any).style as any) ?? {}) } as any;
      const nextOpacity = 0.2;
      const baseStrokeWidth = typeof baseStyle.strokeWidth === 'number' ? baseStyle.strokeWidth : undefined;
      if (baseStyle.opacity === nextOpacity) return e;
      return {
        ...e,
        style: {
          ...baseStyle,
          opacity: nextOpacity,
          strokeWidth: baseStrokeWidth,
        },
      } as Edge;
    });
  }, [renderedEdges, hoverBranchKey, branchKeyByEdgeId, colorMode]);

  useEffect(() => {
    if (!clusterEnabled) return;
    if (selection.kind === 'visual_group' || selection.kind === 'evidence_group') return;
    if (!clustered.hiddenSelectionMap.size) return;

    const findReplacement = (ids: string[]): string | undefined => {
      for (const id of ids) {
        if (!id) continue;
        const replacement = clustered.hiddenSelectionMap.get(id);
        if (replacement) return replacement;
      }
      return undefined;
    };

    if (selection.kind === 'visual_asset') {
      const candidateIds = [selectedRfNodeId ?? '', `visual_asset:${selection.visual_asset_id}`];
      const replacement = findReplacement(candidateIds);
      if (!replacement) return;
      const meta = clustered.groupMeta[replacement];
      setSelection({
        kind: 'visual_group',
        label: meta?.segmentLabel ?? meta?.segmentId ?? selection.visual_asset_id,
        segment_label: meta?.segmentLabel,
        count_slides: meta?.countSlides,
        evidence_count_total: meta?.evidenceCountTotal,
        avg_confidence: meta?.avgConfidence ?? null,
        sample_summaries: meta?.sampleSummaries,
      });
      setSelectedRfNodeId(replacement);
      return;
    }

    if (selection.kind === 'evidence') {
      const candidateIds = [selectedRfNodeId ?? '', `evidence:${selection.visual_asset_id}`];
      const replacement = findReplacement(candidateIds);
      if (!replacement) return;
      const meta = clustered.groupMeta[replacement];
      setSelection({
        kind: 'evidence_group',
        label: meta?.segmentLabel ? `${meta.segmentLabel} evidence` : undefined,
        evidence_count_total: meta?.evidenceCountTotal,
        avg_confidence: meta?.avgConfidence ?? null,
        sample_summaries: meta?.evidenceSamples,
      });
      setSelectedRfNodeId(replacement);
    }
  }, [clusterEnabled, clustered.hiddenSelectionMap, clustered.groupMeta, selection, selectedRfNodeId]);

  const minimapSize = useMemo(() => {
    return {
      width: Math.round(MINIMAP_BASE_WIDTH * minimapScale),
      height: Math.round(MINIMAP_BASE_HEIGHT * minimapScale),
    };
  }, [minimapScale]);

  const colorLegend = useMemo(() => {
    if (!fullGraph) return [] as Array<{ id: string; label: string; color: string }>;
    if (colorMode === 'off') return [] as Array<{ id: string; label: string; color: string }>;
    const items = new Map<string, { id: string; label: string; color: string }>();
    for (const n of fullGraph.nodes) {
      const data = (n.data ?? {}) as any;
      const type = String((n as any)?.type ?? '').toLowerCase();
      if (colorMode === 'document' && type === 'document') {
        const docId = data.__docId ?? getDocIdFromData(data);
        if (!docId) continue;
        const label = typeof data.title === 'string' && data.title.trim() ? data.title : typeof data.label === 'string' ? data.label : docId;
        const { stroke } = colorFromKey(docId, darkMode);
        items.set(docId, { id: docId, label, color: stroke });
      }
      if (colorMode === 'segment' && type === 'segment') {
        const segId = data.__segmentId ?? getSegmentIdFromData(data);
        if (!segId) continue;
        const label = typeof data.label === 'string' && data.label.trim() ? data.label : segId;
        const { stroke } = colorFromKey(segId, darkMode);
        items.set(segId, { id: segId, label, color: stroke });
      }
    }
    return Array.from(items.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [fullGraph, colorMode, darkMode]);

  useEffect(() => {
    if (import.meta.env.DEV && getDevtoolsConsoleLoggingEnabled()) {
      try {
        const sample = renderedNodes.find((n) => String((n as any)?.id ?? '').startsWith('visual_asset:')) as any;
        // eslint-disable-next-line no-console
        console.log('[renderedNodes sample visual_asset]', sample?.id, sample?.data);
      } catch {
        // ignore
      }
    }

    setNodes(renderedNodes);
    setEdges(renderedEdges);
  }, [renderedNodes, renderedEdges, setNodes, setEdges]);

  useEffect(() => {
    if (!import.meta.env.DEV || !getDevtoolsConsoleLoggingEnabled()) return;
    const branchMatches = hoverBranchKey
      ? renderedNodes.filter((n) => branchKeyByNodeId.get(n.id) === hoverBranchKey).map((n) => n.id)
      : [];
    const anyBranch = branchMatches.length > 0;
    // eslint-disable-next-line no-console
    console.log('[hover debug]', {
      colorMode,
      hoverBranchKey,
      hoverNodeId,
      branchMatchCount: branchMatches.length,
      branchMatchIds: branchMatches.slice(0, 8),
      branchKeyMissing: hoverBranchKey != null && !anyBranch,
    });
  }, [hoverBranchKey, hoverNodeId, colorMode, renderedNodes, branchKeyByNodeId]);

  useEffect(() => {
    if (!rfInstance) return;
    if (clustered.nodes.length === 0) return;

    const shouldFit = !didInitialFitRef.current || lastFitViewNonceRef.current !== layoutNonce;
    if (!shouldFit) return;

    lastFitCountsRef.current = { nodes: clustered.nodes.length, edges: clustered.edges.length };

    const raf = requestAnimationFrame(() => {
      try {
        rfInstance.fitView({ padding: 0.25, duration: 300, includeHiddenNodes: true });
        didInitialFitRef.current = true;
        lastFitViewNonceRef.current = layoutNonce;
        if (import.meta.env.DEV && getDevtoolsConsoleLoggingEnabled()) {
          // eslint-disable-next-line no-console
          console.log('[viewport] initial fitView', {
            nodeCount: clustered.nodes.length,
            edgeCount: clustered.edges.length,
            layoutNonce,
          });
        }
      } catch {
        // ignore
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [rfInstance, clustered.nodes.length, clustered.edges.length, layoutNonce]);

  const handleNodesChange = (changes: any) => {
    onNodesChange(changes);

    if (devtoolsEnabled) logNodesChange(changes as any);

    // When nodes get measured (real dimensions), re-run dagre once to reduce overlaps.
    const hasDimensions = Array.isArray(changes) && changes.some((c) => c?.type === 'dimensions');
    if (hasDimensions && !hasMeasuredDimensionsRef.current && !relayoutScheduledRef.current) {
      relayoutScheduledRef.current = true;
      hasMeasuredDimensionsRef.current = true;
      queueMicrotask(() => {
        relayoutScheduledRef.current = false;
        setLayoutNonce((v) => v + 1);
      });
    }
  };

  const handleEdgesChange = (changes: any) => {
    onEdgesChange(changes);

    if (devtoolsEnabled) logEdgesChange(changes as any);
  };

  const handleNodeMouseEnter = (_event: any, node: Node) => {
    const data = ((node as any)?.data ?? {}) as any;
    const nodeType = String((node as any)?.type ?? '').toLowerCase();
    const nodeId = String((node as any)?.id ?? '');
    const key = getBranchKeyFromNodeData(nodeType, data);

    if (isHoverDebugEnabled()) {
      // eslint-disable-next-line no-console
      console.log('[hover enter]', {
        nodeId,
        nodeType,
        key,
        hasDoc: Boolean(data?.__docId ?? data?.document_id ?? data?.doc_id ?? data?.documentId),
        hasSeg: Boolean(data?.__segmentId ?? data?.segment_id ?? data?.segmentId),
      });
      if (!key) {
        // eslint-disable-next-line no-console
        console.log('[hover enter] branchKey null for node', nodeId);
      }
    }

    if (colorMode === 'off') return;
    setHoverNodeId(nodeId || null);
    setHoverBranchKey(key);
  };

  const handleNodeMouseLeave = () => {
    if (isHoverDebugEnabled()) {
      // eslint-disable-next-line no-console
      console.log('[hover leave] clear hover');
    }
    setHoverNodeId(null);
    setHoverBranchKey(null);
  };

  const selectedNodeIdForDevtools = useMemo(() => {
    if (selectedRfNodeId) return selectedRfNodeId;
    if (selection.kind === 'none') return null;
    if (selection.kind === 'deal') return `deal:${selection.deal_id || dealId}`;
    if (selection.kind === 'document') return `document:${selection.document_id}`;
    if (selection.kind === 'visual_asset') return `visual_asset:${selection.visual_asset_id}`;
    if (selection.kind === 'evidence') return `evidence:${selection.visual_asset_id}`;
    return null;
  }, [selectedRfNodeId, selection, dealId]);

  const selectedRfNode = useMemo(() => {
    const id = selectedNodeIdForDevtools;
    if (!id) return null;
    return nodes.find((n) => String((n as any)?.id ?? '') === id) ?? null;
  }, [nodes, selectedNodeIdForDevtools]);

  const hasSelectedLineageVisualDetails = useMemo(() => {
    if (!selectedRfNode) return false;
    const t = String((selectedRfNode as any)?.type ?? '').toLowerCase();
    if (t !== 'visual_asset') return false;
    const d = ((selectedRfNode as any)?.data ?? {}) as any;
    return Boolean(
      (typeof d.image_uri === 'string' && d.image_uri.trim()) ||
        (typeof d.ocr_text_snippet === 'string' && d.ocr_text_snippet.trim())
    );
  }, [selectedRfNode]);

  const devtoolsSelection: DevtoolsSelection = useMemo(
    () => ({ enabled: devtoolsEnabled, selectedNodeId: selectedNodeIdForDevtools, selectedKind: selection.kind }),
    [devtoolsEnabled, selectedNodeIdForDevtools, selection.kind]
  );

  const nodeTypes = useMemo(
    () => ({
      deal: DealNode,
      document: DocumentNode,
      segment: SegmentNode,
      visual_group: VisualGroupNode,
      visual_asset: AnalystVisualAssetNode,
      evidence_group: EvidenceGroupNode,
      evidence: EvidenceNode,
      default: DefaultNode,
    }),
    []
  );

  const edgeTypes = useMemo(() => ({ floating: FloatingEdge }), []);


  const hasVisuals = useMemo(() => {
    return Boolean(
      lineage?.nodes?.some((n: any) => {
        const t = String(n?.type ?? '').toLowerCase();
        return t === 'visual_asset' || t === 'visual group' || t === 'visual_group';
      })
    );
  }, [lineage]);

  const summarizeVisualAsset = (asset: DocumentVisualAsset): string | null => {
    const t = asset.asset_type ? String(asset.asset_type) : '';
    const page = Number.isFinite(asset.page_index) ? asset.page_index + 1 : null;

    const table = getTablePreviewModel(asset.structured_json, { maxRows: 6, maxCols: 6 });
    if (table) return `Table detected${page != null ? ` (p${page})` : ''}${t ? ` · ${t}` : ''}`;

    const chart = getBarChartPreviewModel(asset.structured_json, { maxBars: 8 });
    if (chart) return `Bar chart detected${page != null ? ` (p${page})` : ''}${t ? ` · ${t}` : ''}`;

    if (asset.ocr_text && asset.ocr_text.trim().length > 0) return `OCR text available${page != null ? ` (p${page})` : ''}${t ? ` · ${t}` : ''}`;

    return t || null;
  };

  const loadVisualDetails = async (documentId: string, visualAssetId: string) => {
    if (!dealId || !documentId || !visualAssetId) return;

    setVisualDetailLoading(true);
    setVisualDetailError(null);
    setSelectedVisual(null);

    try {
      const cached = docAssetCacheRef.current.get(documentId);
      let assets: DocumentVisualAsset[] = [];

      if (cached) {
        assets = cached;
      } else {
        const resp: any = await apiGetDocumentVisualAssets(dealId, documentId);
        const fromVisualAssets = Array.isArray(resp?.visual_assets) ? resp.visual_assets : null;
        const fromAssets = Array.isArray(resp?.assets) ? resp.assets : null;
        assets = (fromVisualAssets ?? fromAssets ?? []) as DocumentVisualAsset[];
        docAssetCacheRef.current.set(documentId, assets);
      }
      if (!Array.isArray(assets)) assets = [];

      // Enrich graph nodes so Visual/Evidence nodes can show thumbnails and summaries.
      setFullGraph((prev) => {
        if (!prev) return prev;
        const byVaId = new Map(assets.map((a) => [a.visual_asset_id, a] as const));
        const updatedNodes = prev.nodes.map((n) => {
          const id = n.id;
          if (id.startsWith('visual_asset:')) {
            const vaId = id.slice('visual_asset:'.length);
            const a = byVaId.get(vaId);
            if (!a) return n;

            const existing = (n.data ?? {}) as any;
            const ocrText = typeof a.ocr_text === 'string' ? a.ocr_text.trim() : '';
            const derivedOcrSnippet = ocrText.length > 0 ? (ocrText.length > 180 ? `${ocrText.slice(0, 180).trimEnd()}…` : ocrText) : undefined;

            const table = getTablePreviewModel(a.structured_json, { maxRows: 6, maxCols: 8 });
            const chart = !table ? getBarChartPreviewModel(a.structured_json, { maxBars: 12 }) : null;
            const derivedStructuredKind = table ? 'table' : chart ? 'bar' : undefined;
            const derivedStructuredSummary = table
              ? `Table • ${table.totalRows}×${table.totalCols}`
              : chart
                ? `Bar chart • ${chart.totalBars} bars`
                : undefined;

            return {
              ...n,
              data: {
                ...(n.data ?? {}),
                image_uri: (n.data as any)?.image_uri ?? a.image_uri,
                confidence: (n.data as any)?.confidence ?? a.confidence,
                asset_type: (n.data as any)?.asset_type ?? a.asset_type,
                page_index: (n.data as any)?.page_index ?? a.page_index,
                evidence_count: existing.evidence_count ?? a.evidence?.evidence_count,
                ocr_text_snippet: existing.ocr_text_snippet ?? derivedOcrSnippet,
                structured_kind: existing.structured_kind ?? derivedStructuredKind,
                structured_summary: existing.structured_summary ?? derivedStructuredSummary,
              },
            } as Node;
          }
          if (id.startsWith('evidence:')) {
            const vaId = id.slice('evidence:'.length);
            const a = byVaId.get(vaId);
            if (!a) return n;
            const snippet = a.evidence?.sample_snippets?.[0];
            return {
              ...n,
              data: {
                ...(n.data ?? {}),
                count: a.evidence?.evidence_count ?? (n.data as any)?.count,
                sample_snippet: typeof snippet === 'string' && snippet.trim().length > 0 ? snippet.trim() : undefined,
              },
            } as Node;
          }
          return n;
        });
        return { ...prev, nodes: updatedNodes };
      });

      const match = assets.find((a) => a.visual_asset_id === visualAssetId) ?? null;
      setSelectedVisual(match);
      if (!match) setVisualDetailError('Visual asset details not found (document list did not include it).');
    } catch (e) {
      setVisualDetailError(e instanceof Error ? e.message : 'Failed to load visual asset details');
    } finally {
      setVisualDetailLoading(false);
    }
  };

  if (!isLiveBackend()) {
    return (
      <div className={`text-center py-12 rounded-lg border-2 border-dashed ${
        darkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50/50'
      }`}>
        <AlertCircle className={`w-12 h-12 mx-auto mb-3 opacity-40 ${darkMode ? 'text-gray-400' : 'text-gray-400'}`} />
        <h3 className={`text-base mb-1 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Live mode required</h3>
        <p className={`text-sm ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
          Switch to the live backend to view the analyst lineage graph.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className={`text-lg mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>Analyst Mode</h3>
          <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            Deal → documents → extracted visual assets → evidence.
          </p>
        </div>
        <Button
          variant="secondary"
          darkMode={darkMode}
          icon={<RefreshCw className="w-4 h-4" />}
          onClick={refresh}
          loading={loading}
        >
          Refresh
        </Button>
      </div>

      {Array.isArray(warnings) && warnings.length > 0 ? (
        <div className={`rounded-lg border px-4 py-3 ${darkMode ? 'bg-white/5 border-white/10 text-gray-300' : 'bg-white border-gray-200 text-gray-700'}`}>
          <div className="text-sm font-medium mb-1">Warnings</div>
          <ul className="list-disc pl-5 text-sm space-y-1">
            {warnings.slice(0, 8).map((w, idx) => (
              <li key={`warn-${idx}`}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? (
        <div className={`rounded-lg border px-4 py-3 ${darkMode ? 'bg-white/5 border-white/10 text-gray-300' : 'bg-white border-gray-200 text-gray-700'}`}>
          <div className="text-sm font-medium mb-1">Failed to load analyst graph</div>
          <div className="text-sm opacity-80">{error}</div>
        </div>
      ) : null}

      <div
        className={`grid grid-cols-1 gap-4 ${
          inspectorOpen
            ? 'lg:grid-cols-[minmax(0,1fr)_380px]'
            : 'lg:grid-cols-[minmax(0,1fr)_56px]'
        }`}
      >
        <div className={`rounded-lg border overflow-hidden ${darkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-white'}`}>
          <div className="h-[600px]">
            <ReactFlow
              nodes={displayNodes}
              edges={displayEdges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              defaultEdgeOptions={{ type: 'floating' }}
              nodesDraggable={false}
              nodesConnectable={false}
              edgesFocusable={false}
              elementsSelectable
              selectNodesOnDrag={false}
              // Allow natural left-drag panning; rely on click for selection.
              panOnDrag
              panOnScroll={false}
              zoomOnScroll={false}
              zoomOnDoubleClick={false}
              preventScrolling
              nodeClickDistance={18}
              paneClickDistance={6}
              className="[&_.react-flow__container]:cursor-grab [&_.react-flow__viewport]:cursor-grab [&_.react-flow__pane]:cursor-grab [&_.react-flow__pane]:active:cursor-grabbing [&_.react-flow__node]:cursor-grab [&_.react-flow__nodes]:pointer-events-auto"
              onInit={(instance: ReactFlowInstance) => setRfInstance(instance)}
              fitView
              onNodesChange={handleNodesChange}
              onEdgesChange={handleEdgesChange}
              onNodeMouseEnter={handleNodeMouseEnter}
              onNodeMouseLeave={handleNodeMouseLeave}
              onNodeClick={(evt, node) => {
                if (import.meta.env.DEV && getDevtoolsConsoleLoggingEnabled()) console.log('[NODE CLICK]', node.id, node.type);
                evt?.stopPropagation?.();

                // Use the actual rendered React Flow node id for devtools lookup.
                setSelectedRfNodeId(String((node as any)?.id ?? ''));

                const data = (node as any)?.data ?? {};
                const nodeId = String((node as any)?.id ?? '');
                const fromPrefix = (prefix: string) =>
                  nodeId.startsWith(prefix) ? nodeId.slice(prefix.length) : '';

                const documentIdFromNode = fromPrefix('document:') || fromPrefix('document_id:');
                const visualIdFromNode = fromPrefix('visual_asset:') || fromPrefix('visual:');
                const evidenceVisualIdFromNode = fromPrefix('evidence:');

                const t = String(data.__node_type ?? node.type ?? '').toLowerCase();

                if (t === 'deal') {
                  setSelection({ kind: 'deal', deal_id: String(data.deal_id ?? dealId), name: (data.name as any) ?? null });
                  setSelectedVisual(null);
                  setVisualDetailError(null);
                  return;
                }

                if (t === 'document') {
                  setSelection({
                    kind: 'document',
                    document_id: String(data.document_id ?? documentIdFromNode ?? ''),
                    title: typeof data.title === 'string' ? data.title : undefined,
                    type: typeof data.type === 'string' ? data.type : undefined,
                    page_count: typeof data.page_count === 'number' ? data.page_count : undefined,
                  });
                  setSelectedVisual(null);
                  setVisualDetailError(null);
                  return;
                }

                if (t === 'visual_asset') {
                  const document_id = String(data.document_id ?? documentIdFromNode ?? '');
                  const visual_asset_id = String(data.visual_asset_id ?? visualIdFromNode ?? '');
                  if (!document_id || !visual_asset_id) {
                    setVisualDetailError('Visual asset node missing document_id or visual_asset_id.');
                    setSelectedVisual(null);
                    return;
                  }
                  setSelection({ kind: 'visual_asset', document_id, visual_asset_id });
                  loadVisualDetails(document_id, visual_asset_id);
                  return;
                }

                if (t === 'visual_group') {
                  const summaries = Array.isArray(data.sample_summaries)
                    ? data.sample_summaries.filter((s: any) => typeof s === 'string' && s.trim().length > 0)
                    : undefined;
                  const avgConfidence =
                    typeof data.avg_confidence === 'number' && Number.isFinite(data.avg_confidence)
                      ? data.avg_confidence
                      : null;
                  const evidenceCountTotal =
                    typeof data.evidence_count_total === 'number' && Number.isFinite(data.evidence_count_total)
                      ? data.evidence_count_total
                      : undefined;
                  const slideCount =
                    typeof data.count_slides === 'number' && Number.isFinite(data.count_slides)
                      ? data.count_slides
                      : undefined;

                  setSelection({
                    kind: 'visual_group',
                    label: typeof data.label === 'string' ? data.label : undefined,
                    segment_label: typeof data.segment_label === 'string' ? data.segment_label : undefined,
                    count_slides: slideCount,
                    evidence_count_total: evidenceCountTotal,
                    avg_confidence: avgConfidence,
                    sample_summaries: summaries,
                  });
                  setSelectedVisual(null);
                  setVisualDetailError(null);
                  return;
                }

                if (t === 'evidence_group') {
                  const summaries = Array.isArray(data.sample_summaries)
                    ? data.sample_summaries.filter((s: any) => typeof s === 'string' && s.trim().length > 0)
                    : undefined;
                  const avgConfidence =
                    typeof data.avg_confidence === 'number' && Number.isFinite(data.avg_confidence)
                      ? data.avg_confidence
                      : null;
                  const evidenceCountTotal =
                    typeof data.evidence_count_total === 'number' && Number.isFinite(data.evidence_count_total)
                      ? data.evidence_count_total
                      : typeof data.count === 'number'
                        ? data.count
                        : undefined;

                  setSelection({
                    kind: 'evidence_group',
                    label: typeof data.label === 'string' ? data.label : undefined,
                    evidence_count_total: evidenceCountTotal,
                    avg_confidence: avgConfidence,
                    sample_summaries: summaries,
                    sample_snippet: typeof data.sample_snippet === 'string' ? data.sample_snippet : null,
                    count: typeof data.count === 'number' ? data.count : undefined,
                  });
                  setSelectedVisual(null);
                  setVisualDetailError(null);
                  return;
                }

                if (t === 'evidence') {
                  const visual_asset_id = String(data.visual_asset_id ?? evidenceVisualIdFromNode ?? '');
                  const count = typeof data.count === 'number' ? data.count : undefined;
                  setSelection({ kind: 'evidence', visual_asset_id, count });
                  setSelectedVisual(null);
                  setVisualDetailError(null);
                  return;
                }

                setSelection({ kind: 'none' });
                setSelectedRfNodeId(null);
              }}
            >
              {devtoolsEnabled ? (
                <>
                  <ReactFlowDevToolsOverlay
                    enabled={devtoolsEnabled}
                    darkMode={darkMode}
                    selection={devtoolsSelection}
                  />
                  <ReactFlowViewportBadge
                    enabled={devtoolsEnabled}
                    darkMode={darkMode}
                    selectedNodeId={selectedNodeIdForDevtools}
                  />
                </>
              ) : null}

              <Panel position="top-right">
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    darkMode={darkMode}
                    onClick={() => {
                      didInitialFitRef.current = false;
                      lastFitViewNonceRef.current = null;
                      setLayoutNonce((v) => v + 1);
                    }}
                  >
                    Re-layout
                  </Button>
                  <Button
                    variant="secondary"
                    darkMode={darkMode}
                    onClick={() => {
                      if (!fullGraph) return;
                      const next: ExpandedById = {};
                      for (const n of fullGraph.nodes) next[n.id] = true;
                      setExpandedById(next);
                      setLayoutNonce((v) => v + 1);
                    }}
                  >
                    Expand all
                  </Button>
                  <Button
                    variant="secondary"
                    darkMode={darkMode}
                    onClick={() => {
                      if (!fullGraph) return;
                      const next: ExpandedById = {};
                      for (const n of fullGraph.nodes) next[n.id] = false;
                      // Always keep the deal root visible.
                      next[dealRootId] = true;
                      setExpandedById(next);
                      setLayoutNonce((v) => v + 1);
                    }}
                  >
                    Collapse all
                  </Button>
                  <div className={`inline-flex items-center gap-1 text-xs ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                    <span>Color:</span>
                    <div className={`inline-flex rounded-md border ${darkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-white'}`}>
                      {(['off', 'document', 'segment'] as ColorMode[]).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          className={`px-2 py-1 text-xs border-l first:border-l-0 ${darkMode ? 'border-white/10' : 'border-gray-200'} ${
                            colorMode === mode
                              ? darkMode
                                ? 'bg-white/10 text-white'
                                : 'bg-gray-100 text-gray-900'
                              : darkMode
                                ? 'text-gray-400 hover:text-gray-200'
                                : 'text-gray-600 hover:text-gray-900'
                          }`}
                          onClick={() => setColorMode(mode)}
                        >
                          {mode === 'off' ? 'Off' : mode === 'document' ? 'By Doc' : 'By Segment'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className={`inline-flex items-center gap-2 text-xs ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                    <span>Cluster</span>
                    <button
                      type="button"
                      className={`px-2 py-1 rounded-md border text-xs ${
                        darkMode
                          ? clusterEnabled
                            ? 'border-white/10 bg-white/10 text-white'
                            : 'border-white/10 bg-transparent text-gray-400'
                          : clusterEnabled
                            ? 'border-gray-200 bg-gray-100 text-gray-900'
                            : 'border-gray-200 bg-white text-gray-600'
                      } ${!clusterEligible ? 'opacity-60 cursor-not-allowed' : 'hover:opacity-90'}`}
                      disabled={!clusterEligible}
                      onClick={() => {
                        if (!clusterEligible) return;
                        setClusterSlides((v) => !v);
                        setLayoutNonce((v) => v + 1);
                      }}
                      aria-pressed={clusterEnabled}
                    >
                      {clusterEnabled ? 'On' : 'Off'}
                    </button>
                    {!clusterEligible ? (
                      <span className={`text-[11px] ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        Needs ≥ {CLUSTER_MIN_VISUALS} visuals or 2 docs with 8+
                      </span>
                    ) : null}
                  </div>
                  <div className={`inline-flex items-center gap-2 text-xs ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                    <span>MiniMap</span>
                    <input
                      type="range"
                      min={MINIMAP_SCALE_MIN}
                      max={MINIMAP_SCALE_MAX}
                      step={0.05}
                      value={minimapScale}
                      onChange={(e) => {
                        const next = clamp(Number(e.target.value), MINIMAP_SCALE_MIN, MINIMAP_SCALE_MAX);
                        setMinimapScale(next);
                      }}
                      className="h-1 w-24 accent-indigo-500"
                      aria-label="MiniMap scale"
                    />
                    <span className="tabular-nums w-10 text-right">{Math.round(minimapScale * 100)}%</span>
                  </div>
                </div>
              </Panel>
              <MiniMap
                pannable
                zoomable
                nodeColor={(n) => {
                  const t = String((n as any)?.type ?? '').toLowerCase();
                  if (import.meta.env.DEV && getDevtoolsConsoleLoggingEnabled() && !minimapLoggedTypes.has(t)) {
                    minimapLoggedTypes.add(t);
                    // eslint-disable-next-line no-console
                    console.log('[minimap] color callback hit', { id: (n as any)?.id, type: t });
                  }
                  if (darkMode) {
                    if (t === 'deal') return '#ffffff';
                    if (t === 'document') return '#00e5ff';
                    if (t === 'segment') return '#d946ef';
                    if (t === 'visual_group' || t === 'visual_asset') return '#22c55e';
                    if (t === 'evidence_group' || t === 'evidence') return '#ff8a00';
                    return '#a5b4fc';
                  }
                  if (t === 'deal') return '#000000';
                  if (t === 'document') return '#00bcd4';
                  if (t === 'segment') return '#a855f7';
                  if (t === 'visual_group' || t === 'visual_asset') return '#16a34a';
                  if (t === 'evidence_group' || t === 'evidence') return '#ea580c';
                  return '#1f2937';
                }}
                nodeStrokeColor={(n) => {
                  const t = String((n as any)?.type ?? '').toLowerCase();
                  if (darkMode) {
                    if (t === 'deal') return '#ffffff';
                    if (t === 'document') return '#8ae5ff';
                    if (t === 'segment') return '#f3b8ff';
                    if (t === 'visual_group' || t === 'visual_asset') return '#7ce7a8';
                    if (t === 'evidence_group' || t === 'evidence') return '#ffc78a';
                    return '#d8e0ff';
                  }
                  if (t === 'deal') return '#111827';
                  if (t === 'document') return '#0284c7';
                  if (t === 'segment') return '#7e22ce';
                  if (t === 'visual_group' || t === 'visual_asset') return '#15803d';
                  if (t === 'evidence_group' || t === 'evidence') return '#9a3412';
                  return '#111827';
                }}
                nodeStrokeWidth={2}
                maskColor={darkMode ? 'rgba(10,12,18,0.7)' : 'rgba(255,255,255,0.55)'}
                style={{
                  width: minimapSize.width,
                  height: minimapSize.height,
                  border: darkMode ? '1px solid rgba(148,163,184,0.5)' : '1px solid rgba(55,65,81,0.35)',
                  background: darkMode ? 'rgba(24,28,38,0.95)' : 'rgba(234,242,248,0.95)',
                }}
              />
              {colorMode !== 'off' && colorLegend.length > 0 ? (
                <Panel position="bottom-right">
                  <div className={`rounded-md border px-3 py-2 text-xs ${darkMode ? 'border-white/10 bg-white/5 text-gray-100' : 'border-gray-200 bg-white text-gray-800'}`}>
                    <div className="text-[11px] font-semibold mb-1">{colorMode === 'document' ? 'Documents' : 'Segments'}</div>
                    <div className="space-y-1 max-h-40 overflow-auto">
                      {colorLegend.map((item) => (
                        <div key={item.id} className="flex items-center gap-2">
                          <span className="inline-flex h-3 w-3 rounded-full" style={{ backgroundColor: item.color }} aria-hidden />
                          <span className="truncate" title={item.label}>{item.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </Panel>
              ) : null}
              <Controls />
              <Background gap={18} size={1} color={darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(17,24,39,0.08)'} />
            </ReactFlow>

            {!loading && lineage && !hasVisuals ? (
              <div className={`pointer-events-none absolute inset-x-0 top-3 mx-auto w-fit rounded-lg border px-3 py-2 text-sm ${
                darkMode ? 'bg-black/40 border-white/10 text-gray-200' : 'bg-white/90 border-gray-200 text-gray-700'
              }`}>
                No visual assets yet. Run visual extraction to populate this view.
              </div>
            ) : null}
          </div>
        </div>

        <div
          className={`rounded-lg border ${
            darkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-white'
          } ${inspectorOpen ? 'p-4' : 'p-2'}`}
        >
          <div className="flex items-center justify-between gap-2">
            {inspectorOpen ? (
              <div className={`text-sm font-medium ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>Inspector</div>
            ) : (
              <div className="sr-only">Inspector</div>
            )}
            <button
              type="button"
              className={`inline-flex items-center justify-center rounded-md p-1 ${
                darkMode ? 'text-gray-300 hover:bg-white/5' : 'text-gray-700 hover:bg-gray-100'
              }`}
              onClick={() => setInspectorOpen((v) => !v)}
              aria-expanded={inspectorOpen}
              aria-label={inspectorOpen ? 'Collapse inspector' : 'Expand inspector'}
            >
              {inspectorOpen ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </button>
          </div>

          {inspectorOpen ? (
            <div className="mt-3 space-y-4">
              {selection.kind === 'none' ? (
                <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  Click a node to inspect details.
                </div>
              ) : null}

              {selection.kind === 'deal' ? (
                <div className="space-y-2">
                  <div className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    <div className="text-xs opacity-70">Deal</div>
                    <div className="font-medium">{selection.name || selection.deal_id}</div>
                  </div>
                </div>
              ) : null}

              {selection.kind === 'document' ? (
                <div className="space-y-2">
                  <div className="text-xs opacity-70">Document</div>
                  <div className={`text-sm font-medium ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>{selection.title || selection.document_id}</div>
                  <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    {selection.type ? `Type: ${selection.type}` : 'Type: —'}
                    {typeof selection.page_count === 'number' ? ` · Pages: ${selection.page_count}` : ''}
                  </div>
                  <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                    Select a visual asset node to view OCR, structured JSON, and evidence.
                  </div>
                </div>
              ) : null}

              {selection.kind === 'visual_group' ? (
                <div className="space-y-2">
                  <div className="text-xs opacity-70">Visual group</div>
                  <div className={`text-sm font-medium ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                    {selection.label || selection.segment_label || 'Visual group'}
                  </div>
                  <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    Slides: {typeof selection.count_slides === 'number' ? selection.count_slides : '—'} · Evidence: {typeof selection.evidence_count_total === 'number' ? selection.evidence_count_total : '—'} · Avg conf:{' '}
                    {(() => {
                      const v = selection.avg_confidence;
                      if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
                      const pct = v <= 1 ? v * 100 : v;
                      return `${Math.round(pct)}%`;
                    })()}
                  </div>
                  {Array.isArray(selection.sample_summaries) && selection.sample_summaries.length > 0 ? (
                    <div className="space-y-1">
                      <div className={`text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Sample summaries</div>
                      <ul className={`list-disc pl-5 text-xs space-y-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        {selection.sample_summaries.slice(0, 4).map((s, idx) => (
                          <li key={`vg-s-${idx}`}>{s}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {selection.kind === 'evidence_group' ? (
                <div className="space-y-2">
                  <div className="text-xs opacity-70">Evidence group</div>
                  <div className={`text-sm font-medium ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                    {selection.label || 'Evidence group'}
                  </div>
                  <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    Items: {typeof selection.evidence_count_total === 'number' ? selection.evidence_count_total : typeof selection.count === 'number' ? selection.count : '—'} · Avg conf:{' '}
                    {(() => {
                      const v = selection.avg_confidence;
                      if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
                      const pct = v <= 1 ? v * 100 : v;
                      return `${Math.round(pct)}%`;
                    })()}
                  </div>
                  {(() => {
                    const snippets = Array.isArray(selection.sample_summaries)
                      ? selection.sample_summaries
                      : selection.sample_snippet
                        ? [selection.sample_snippet]
                        : [];
                    if (snippets.length === 0) return null;
                    return (
                      <div className="space-y-1">
                        <div className={`text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Sample snippets</div>
                        <ul className={`list-disc pl-5 text-xs space-y-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                          {snippets.slice(0, 4).map((s, idx) => (
                            <li key={`eg-s-${idx}`}>{s}</li>
                          ))}
                        </ul>
                      </div>
                    );
                  })()}
                </div>
              ) : null}

              {selection.kind === 'evidence' ? (
                <div className="space-y-2">
                  <div className="text-xs opacity-70">Evidence</div>
                  <div className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Visual asset: <span className="font-mono">{selection.visual_asset_id}</span>
                  </div>
                  <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    Count: {typeof selection.count === 'number' ? selection.count : '—'}
                  </div>
                  <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                    Select the visual asset node to view evidence snippets.
                  </div>
                </div>
              ) : null}

              {selection.kind === 'visual_asset' ? (
                <div className="space-y-3">
                  <div className="text-xs opacity-70">Visual asset</div>
                  <div className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Asset ID: <span className="font-mono">{selection.visual_asset_id}</span>
                  </div>

                  {(() => {
                    const rfData = ((selectedRfNode as any)?.data ?? {}) as any;
                    const rfImgSrc = resolveApiAssetUrl(typeof rfData.image_uri === 'string' ? rfData.image_uri : null);
                    const rfEvidence = Array.isArray(rfData.evidence_snippets) ? (rfData.evidence_snippets as unknown[]) : [];
                    const rfEvidenceSnips = rfEvidence
                      .filter((s) => typeof s === 'string' && s.trim().length > 0)
                      .map((s) => (s as string).trim());
                    const rfOcr = typeof rfData.ocr_text_snippet === 'string' ? rfData.ocr_text_snippet.trim() : '';
                    const rfSlideTitle = typeof rfData.slide_title === 'string' ? rfData.slide_title.trim() : '';
                    const rfSlideTitleConf =
                      typeof rfData.slide_title_confidence === 'number' && Number.isFinite(rfData.slide_title_confidence)
                        ? Math.round(rfData.slide_title_confidence * 100)
                        : null;
                    const rfSlideTitleSource = typeof rfData.slide_title_source === 'string' ? rfData.slide_title_source : '';
                    const rfStructuredKind = typeof rfData.structured_kind === 'string' ? rfData.structured_kind : null;
                    const rfStructuredSummary = rfData.structured_summary as any;
                    const rfPageUnderstanding = rfData.page_understanding as any;

                    const hasRfEnrichment = Boolean(
                      rfImgSrc ||
                      rfEvidenceSnips.length > 0 ||
                      (rfOcr && rfOcr.length > 0) ||
                      (rfSlideTitle && rfSlideTitle.length > 0) ||
                      rfStructuredKind
                    );

                    if (!hasRfEnrichment) return null;

                    const structuredLine = (() => {
                      if (rfStructuredKind === 'table') {
                        const t = rfStructuredSummary?.table;
                        const rows = typeof t?.rows === 'number' && Number.isFinite(t.rows) ? t.rows : null;
                        const cols = typeof t?.cols === 'number' && Number.isFinite(t.cols) ? t.cols : null;
                        return `Table • ${rows != null ? rows : '—'}×${cols != null ? cols : '—'}`;
                      }
                      if (rfStructuredKind === 'bar') {
                        const b = rfStructuredSummary?.bar ?? rfStructuredSummary?.chart;
                        const bars = typeof b?.bars === 'number' && Number.isFinite(b.bars) ? b.bars : null;
                        return `Bar chart • ${bars != null ? bars : '—'} bars`;
                      }
                      return null;
                    })();

                    return (
                      <div className="space-y-2">
                        <div className={`text-sm font-medium ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>Lineage (enriched)</div>

                        {rfImgSrc ? (
                          <img
                            src={rfImgSrc}
                            alt="Visual asset"
                            className={`w-full max-h-[220px] object-contain rounded-md border ${darkMode ? 'border-white/10' : 'border-gray-200'}`}
                          />
                        ) : null}

                        {structuredLine ? (
                          <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>{structuredLine}</div>
                        ) : null}

                        {rfSlideTitle ? (
                          <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                            Slide title: {rfSlideTitle}
                            {rfSlideTitleConf != null ? ` · ${rfSlideTitleConf}%` : ''}
                            {rfSlideTitleSource ? ` (${rfSlideTitleSource})` : ''}
                          </div>
                        ) : null}

                        <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                          Evidence: {typeof rfData.evidence_count === 'number' ? rfData.evidence_count : '—'}
                        </div>

                        {rfEvidenceSnips.length > 0 ? (
                          <div className="space-y-1">
                            <div className={`text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Evidence snippets</div>
                            <ul className={`list-disc pl-5 text-xs space-y-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                              {rfEvidenceSnips.slice(0, 3).map((s, idx) => (
                                <li key={`rf-ev-${idx}`}>{s}</li>
                              ))}
                            </ul>
                          </div>
                        ) : rfOcr ? (
                          <div className="space-y-1">
                            <div className={`text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>OCR snippet</div>
                            <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>{rfOcr}</div>
                          </div>
                        ) : (
                          <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>No evidence extracted yet</div>
                        )}

                        <div className="space-y-2">
                          <div className={`text-sm font-medium ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>Slide Understanding</div>

                          {typeof rfPageUnderstanding?.summary === 'string' && rfPageUnderstanding.summary.trim() ? (
                            <div className={`text-xs ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{rfPageUnderstanding.summary}</div>
                          ) : (
                            <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>No summary available</div>
                          )}

                          {Array.isArray(rfPageUnderstanding?.key_points) && rfPageUnderstanding.key_points.length > 0 ? (
                            <div className="space-y-1">
                              <div className={`text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Key points</div>
                              <ul className={`list-disc pl-5 text-xs space-y-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                {rfPageUnderstanding.key_points.slice(0, 8).map((kp: any, idx: number) => (
                                  <li key={`kp-${idx}`}>{String(kp)}</li>
                                ))}
                              </ul>
                            </div>
                          ) : null}

                          {Array.isArray(rfPageUnderstanding?.extracted_signals) && rfPageUnderstanding.extracted_signals.length > 0 ? (
                            <div className="space-y-1">
                              <div className={`text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Extracted signals</div>
                              <div className={`overflow-auto rounded-md border text-xs ${darkMode ? 'border-white/10 bg-black/10 text-gray-200' : 'border-gray-200 bg-white text-gray-800'}`}>
                                <table className="min-w-full text-left">
                                  <thead className={darkMode ? 'bg-white/5' : 'bg-gray-50'}>
                                    <tr>
                                      <th className="px-2 py-1 font-medium">Type</th>
                                      <th className="px-2 py-1 font-medium">Value</th>
                                      <th className="px-2 py-1 font-medium">Unit</th>
                                      <th className="px-2 py-1 font-medium">Conf</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {rfPageUnderstanding.extracted_signals.map((sig: any, idx: number) => (
                                      <tr key={`sig-${idx}`} className={darkMode ? 'border-t border-white/5' : 'border-t border-gray-100'}>
                                        <td className="px-2 py-1 align-top whitespace-pre-wrap">{String(sig?.type ?? '—')}</td>
                                        <td className="px-2 py-1 align-top whitespace-pre-wrap">{String(sig?.value ?? '—')}</td>
                                        <td className="px-2 py-1 align-top whitespace-pre-wrap">{sig?.unit ? String(sig.unit) : '—'}</td>
                                        <td className="px-2 py-1 align-top whitespace-pre-wrap">
                                          {typeof sig?.confidence === 'number' && Number.isFinite(sig.confidence)
                                            ? `${Math.round(sig.confidence * (sig.confidence <= 1 ? 100 : 1))}%`
                                            : '—'}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          ) : null}

                          <div className="space-y-1">
                            <div className={`text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Scoring contribution</div>
                            {Array.isArray(rfPageUnderstanding?.score_contributions) && rfPageUnderstanding.score_contributions.length > 0 ? (
                              <ul className={`list-disc pl-5 text-xs space-y-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                {rfPageUnderstanding.score_contributions.slice(0, 8).map((sc: any, idx: number) => (
                                  <li key={`sc-${idx}`}>
                                    <span className="font-medium">{String(sc?.driver ?? 'Driver')}</span>
                                    {typeof sc?.delta === 'number' ? ` · Δ ${sc.delta}` : ''}
                                    {sc?.rationale ? ` — ${String(sc.rationale)}` : ''}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>No slide-level scoring yet</div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {visualDetailLoading ? (
                    <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Loading details…</div>
                  ) : null}
                  {visualDetailError && !selectedVisual && !hasSelectedLineageVisualDetails ? (
                    <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>{visualDetailError}</div>
                  ) : null}

                  {selectedVisual ? (
                    <>
                      <div className="space-y-2">
                        <div className={`text-sm font-medium ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>Evidence</div>

                        {(() => {
            							const imgSrc = resolveApiAssetUrl(selectedVisual.image_uri);
                          const bbox = parseNormalizedBbox(selectedVisual.bbox);
                          const bboxLabel = formatBboxLabel(selectedVisual.bbox);
                          const flags = getQualityFlagChips(selectedVisual.quality_flags, { maxChips: 8 });

                          return (
                            <div className={`rounded-md border p-2 ${darkMode ? 'border-white/10 bg-black/10' : 'border-gray-200 bg-white'}`}>
                              {imgSrc && !imageLoadError ? (
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between gap-2">
                                    <button
                                      type="button"
                                      className={`text-xs underline-offset-2 hover:underline ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}
                                      onClick={() => setShowBboxOverlay((v) => !v)}
                                    >
                                      {showBboxOverlay ? 'Hide bbox overlay' : 'Show bbox overlay'}
                                    </button>
                                    {showBboxOverlay ? (
                                      <span className={`text-[10px] ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>Overlay is approximate</span>
                                    ) : null}
                                  </div>

                                  <div className="relative">
                                    <img
                                      src={imgSrc}
                                      alt="Visual asset crop"
                                      className={`w-full max-h-[260px] object-contain rounded-md border ${darkMode ? 'border-white/10' : 'border-gray-200'}`}
                                      onError={() => setImageLoadError(true)}
                                    />
                                    {showBboxOverlay && bbox ? (
                                      <div
                                        className={`pointer-events-none absolute border-2 ${darkMode ? 'border-red-300/70' : 'border-red-500/70'}`}
                                        style={{
                                          left: `${bbox.x * 100}%`,
                                          top: `${bbox.y * 100}%`,
                                          width: `${bbox.w * 100}%`,
                                          height: `${bbox.h * 100}%`,
                                        }}
                                      />
                                    ) : null}
                                  </div>
                                </div>
                              ) : imgSrc && imageLoadError ? (
                                <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>Failed to load image</div>
                              ) : (
                                <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                                  No image crop available for this asset yet.
                                </div>
                              )}

                              <div className={`mt-2 text-xs ${darkMode ? 'text-gray-400' : 'text-gray-700'}`}>
                                Page {selectedVisual.page_index + 1} • {selectedVisual.asset_type}
                                {Number.isFinite(selectedVisual.confidence) ? ` • confidence ${selectedVisual.confidence.toFixed(2)}` : ''}
                              </div>

                              <div className={`mt-1 text-[11px] ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                                Extractor: {selectedVisual.extractor_version || '—'}
                                {selectedVisual.extracted_at ? ` • extracted ${selectedVisual.extracted_at}` : ''}
                              </div>

                              {bboxLabel ? (
                                <div className={`mt-1 text-[11px] ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>{bboxLabel}</div>
                              ) : (
                                <div className={`mt-1 text-[11px] ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>bbox: —</div>
                              )}

                              {flags.chips.length > 0 ? (
                                <div className="mt-2 flex flex-wrap items-center gap-1">
                                  {flags.chips.map((c) => (
                                    <span
                                      key={`qf-${c}`}
                                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] ${
                                        darkMode ? 'border-white/10 bg-white/5 text-gray-200' : 'border-gray-200 bg-gray-50 text-gray-800'
                                      }`}
                                    >
                                      {c}
                                    </span>
                                  ))}
                                  {flags.moreCount > 0 ? (
                                    <span className={`text-[10px] ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>+{flags.moreCount} more</span>
                                  ) : null}
                                </div>
                              ) : (
                                <div className={`mt-2 text-[11px] ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>quality_flags: —</div>
                              )}
                            </div>
                          );
                        })()}
                      </div>

                      <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        Evidence: {selectedVisual.evidence?.evidence_count ?? 0}
                      </div>

                      {Array.isArray(selectedVisual.evidence?.sample_snippets) && selectedVisual.evidence.sample_snippets.length > 0 ? (
                        <details className="rounded-md">
                          <summary className={`cursor-pointer text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                            Evidence snippets
                          </summary>
                          <ul className={`mt-2 list-disc pl-5 text-sm space-y-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                            {selectedVisual.evidence.sample_snippets.slice(0, 6).map((s, idx) => (
                              <li key={`snip-${idx}`}>{s}</li>
                            ))}
                          </ul>
                        </details>
                      ) : null}

                      {typeof selectedVisual.ocr_text === 'string' && selectedVisual.ocr_text.trim().length > 0 ? (
                        <details>
                          <summary className={`cursor-pointer text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>OCR text</summary>
                          <pre className={`mt-2 whitespace-pre-wrap text-xs rounded-md p-2 border ${darkMode ? 'border-white/10 bg-black/20 text-gray-200' : 'border-gray-200 bg-gray-50 text-gray-800'}`}>
                            {selectedVisual.ocr_text}
                          </pre>
                        </details>
                      ) : null}

                      {selectedVisual.structured_json != null ? (
                        <details>
                          <summary className={`cursor-pointer text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Structured JSON</summary>
                          {tablePreviewModel || barChartPreviewModel ? (
                            <div className="mt-2 space-y-2">
                              <div className="flex items-center justify-between gap-2">
                                <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                  {tablePreviewModel ? (
                                    <>
                                      <span className={`font-medium ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Table extracted</span>
                                      {typeof tablePreviewModel.method === 'string' ? ` · ${tablePreviewModel.method}` : ''}
                                      {typeof tablePreviewModel.confidence === 'number' && Number.isFinite(tablePreviewModel.confidence)
                                        ? ` · ${tablePreviewModel.confidence.toFixed(2)}`
                                        : ''}
                                      {' · '}
                                      {tablePreviewModel.totalRows} rows × {tablePreviewModel.totalCols} cols
                                      {(() => {
                                        const label = formatTableTruncationLabel(tablePreviewModel);
                                        return label ? ` · ${label}` : '';
                                      })()}
                                    </>
                                  ) : barChartPreviewModel ? (
                                    <>
                                      <span className={`font-medium ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Bar chart extracted</span>
                                      {typeof barChartPreviewModel.method === 'string' ? ` · ${barChartPreviewModel.method}` : ''}
                                      {typeof barChartPreviewModel.confidence === 'number' && Number.isFinite(barChartPreviewModel.confidence)
                                        ? ` · ${barChartPreviewModel.confidence.toFixed(2)}`
                                        : ''}
                                      {typeof barChartPreviewModel.title === 'string' && barChartPreviewModel.title.trim().length > 0
                                        ? ` · ${barChartPreviewModel.title}`
                                        : ''}
                                      {typeof barChartPreviewModel.unit === 'string' && barChartPreviewModel.unit.trim().length > 0
                                        ? ` · Unit: ${barChartPreviewModel.unit}`
                                        : typeof barChartPreviewModel.yUnit === 'string' && barChartPreviewModel.yUnit.trim().length > 0
                                          ? ` · Unit: ${barChartPreviewModel.yUnit}`
                                          : ''}
                                      {(() => {
                                        const label = formatBarChartTruncationLabel(barChartPreviewModel);
                                        return label ? ` · ${label}` : '';
                                      })()}
                                    </>
                                  ) : null}
                                  {barChartPreviewModel?.valuesAreNormalized ? (
                                    <span
                                      className={`ml-2 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] ${
                                        darkMode ? 'border-white/10 bg-white/5 text-gray-200' : 'border-gray-200 bg-gray-50 text-gray-800'
                                      }`}
                                      title="Heights reflect relative proportions; not absolute units."
                                    >
                                      Normalized values (axis not read)
                                    </span>
                                  ) : null}
                                </div>

                                <div
                                  className={`inline-flex rounded-md border overflow-hidden ${darkMode ? 'border-white/10' : 'border-gray-200'}`}
                                  role="group"
                                  aria-label="Structured data view"
                                >
                                  <button
                                    type="button"
                                    className={`px-2 py-1 text-xs ${
                                      structuredViewMode === 'preview'
                                        ? darkMode
                                          ? 'bg-white/10 text-gray-100'
                                          : 'bg-gray-100 text-gray-900'
                                        : darkMode
                                          ? 'bg-transparent text-gray-400 hover:text-gray-200'
                                          : 'bg-transparent text-gray-600 hover:text-gray-900'
                                    }`}
                                    onClick={() => setStructuredViewMode('preview')}
                                  >
                                    Preview
                                  </button>
                                  <button
                                    type="button"
                                    className={`px-2 py-1 text-xs border-l ${
                                      darkMode ? 'border-white/10' : 'border-gray-200'
                                    } ${
                                      structuredViewMode === 'raw'
                                        ? darkMode
                                          ? 'bg-white/10 text-gray-100'
                                          : 'bg-gray-100 text-gray-900'
                                        : darkMode
                                          ? 'bg-transparent text-gray-400 hover:text-gray-200'
                                          : 'bg-transparent text-gray-600 hover:text-gray-900'
                                    }`}
                                    onClick={() => setStructuredViewMode('raw')}
                                  >
                                    Raw JSON
                                  </button>
                                </div>
                              </div>

                              {structuredViewMode === 'preview' ? (
                                <>
                                  {tablePreviewModel ? (
                                    <>
                                      {typeof tablePreviewModel.notes === 'string' && tablePreviewModel.notes.trim().length > 0 ? (
                                        <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>Notes: {tablePreviewModel.notes}</div>
                                      ) : null}
                                      <div
                                        className={`overflow-auto max-h-[420px] rounded-md border ${
                                          darkMode ? 'border-white/10 bg-black/10' : 'border-gray-200 bg-white'
                                        }`}
                                      >
                                        <table className={`min-w-full text-xs ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                                          <tbody>
                                            {tablePreviewModel.rows.map((row, rIdx) => (
                                              <tr key={`row-${rIdx}`} className={darkMode ? 'border-b border-white/5' : 'border-b border-gray-100'}>
                                                {row.map((cell, cIdx) => (
                                                  <td
                                                    key={`cell-${rIdx}-${cIdx}`}
                                                    className={`align-top px-2 py-1 whitespace-pre-wrap ${
                                                      darkMode ? 'border-r border-white/5' : 'border-r border-gray-100'
                                                    }`}
                                                  >
                                                    {cell}
                                                  </td>
                                                ))}
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    </>
                                  ) : barChartPreviewModel ? (
                                    <>
                                      {barChartPreviewModel.valuesAreNormalized ? (
                                        <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                                          Heights reflect relative proportions; not absolute units.
                                        </div>
                                      ) : null}
                                      {typeof barChartPreviewModel.notes === 'string' && barChartPreviewModel.notes.trim().length > 0 ? (
                                        <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>Notes: {barChartPreviewModel.notes}</div>
                                      ) : null}
                                      <div
                                        className={`overflow-auto max-h-[420px] rounded-md border p-3 ${
                                          darkMode ? 'border-white/10 bg-black/10' : 'border-gray-200 bg-white'
                                        }`}
                                      >
                                        <div className="min-w-max">
                                          <div className="flex items-end gap-3">
                                            {barChartPreviewModel.values.map((v, i) => {
                                              const h = barChartPreviewModel.displayHeights[i] ?? 0;
                                              const label = barChartPreviewModel.labels[i] ?? String(i + 1);
                                              const dv = barChartPreviewModel.displayValues[i] ?? '';
                                              return (
                                                <div key={`bar-${i}`} className="flex flex-col items-center justify-end">
                                                  <div className={`text-[10px] leading-none mb-1 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`} title={String(v)}>
                                                    {dv}
                                                  </div>
                                                  <div className="h-28 w-10 flex items-end">
                                                    <div
                                                      className={`w-full rounded-sm ${darkMode ? 'bg-white/20' : 'bg-gray-700'}`}
                                                      style={{ height: `${Math.round(h * 100)}%` }}
                                                      title={barChartPreviewModel.valuesAreNormalized ? 'Normalized values (axis not read)' : undefined}
                                                    />
                                                  </div>
                                                  <div
                                                    className={`mt-1 max-w-[2.5rem] truncate text-[10px] leading-none ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}
                                                    title={label}
                                                  >
                                                    {label}
                                                  </div>
                                                </div>
                                              );
                                            })}
                                          </div>
                                        </div>
                                      </div>
                                    </>
                                  ) : null}
                                </>
                              ) : (
                                <pre
                                  className={`whitespace-pre-wrap text-xs rounded-md p-2 border ${
                                    darkMode ? 'border-white/10 bg-black/20 text-gray-200' : 'border-gray-200 bg-gray-50 text-gray-800'
                                  }`}
                                >
                                  {safeJson(selectedVisual.structured_json)}
                                </pre>
                              )}
                            </div>
                          ) : (
                            <pre
                              className={`mt-2 whitespace-pre-wrap text-xs rounded-md p-2 border ${
                                darkMode ? 'border-white/10 bg-black/20 text-gray-200' : 'border-gray-200 bg-gray-50 text-gray-800'
                              }`}
                            >
                              {safeJson(selectedVisual.structured_json)}
                            </pre>
                          )}
                        </details>
                      ) : null}

                      {selectedVisual.quality_flags != null ? (
                        <details>
                          <summary className={`cursor-pointer text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Quality flags</summary>
                          <pre className={`mt-2 whitespace-pre-wrap text-xs rounded-md p-2 border ${darkMode ? 'border-white/10 bg-black/20 text-gray-200' : 'border-gray-200 bg-gray-50 text-gray-800'}`}>
                            {safeJson(selectedVisual.quality_flags)}
                          </pre>
                        </details>
                      ) : null}
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
