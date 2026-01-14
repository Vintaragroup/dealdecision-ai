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
import { Modal } from '../../ui/Modal';
import {
  apiGetDealLineage,
  apiGetDealVisualAssets,
  apiGetDocumentVisualAssets,
  apiDeleteVisualAssetSegmentOverride,
  isLiveBackend,
  resolveApiAssetUrl,
  type DealLineageResponse,
  type DealVisualAsset,
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

const ANALYST_NODE_TYPES = {
  deal: DealNode,
  document: DocumentNode,
  segment: SegmentNode,
  visual_group: VisualGroupNode,
  visual_asset: AnalystVisualAssetNode,
  visual_asset_group: AnalystVisualAssetNode,
  evidence_group: EvidenceGroupNode,
  evidence: EvidenceNode,
  default: DefaultNode,
} as const;

const ANALYST_EDGE_TYPES = { floating: FloatingEdge } as const;

type DealAnalystTabProps = {
  dealId: string;
  darkMode: boolean;
};

type InspectorSelection =
  | { kind: 'none' }
  | { kind: 'deal'; deal_id: string; name?: string | null }
  | { kind: 'document'; document_id: string; title?: string; type?: string; page_count?: number }
  | { kind: 'visual_asset'; document_id: string; visual_asset_id: string }
  | {
      kind: 'visual_asset_group';
      document_id: string;
      visual_asset_group_id: string;
      page_label?: string;
      count_members?: number;
      member_visual_asset_ids?: string[];
    }
  | { kind: 'visual_group'; label?: string; segment_label?: string; count_slides?: number; evidence_count_total?: number; avg_confidence?: number | null; sample_summaries?: string[] }
  | { kind: 'evidence_group'; label?: string; evidence_count_total?: number; avg_confidence?: number | null; sample_summaries?: string[]; sample_snippet?: string | null; count?: number }
  | { kind: 'evidence'; visual_asset_id: string; count?: number };

type StructuredViewMode = 'preview' | 'raw';
type ColorMode = 'off' | 'document' | 'segment';
type SegmentViewMode = 'effective' | 'computed' | 'persisted';

const COLOR_MODE_STORAGE_KEY = 'analystColorMode';
const MINIMAP_SCALE_STORAGE_KEY = 'analystMiniMapScale';
const MINIMAP_SCALE_MIN = 0.75;
const MINIMAP_SCALE_MAX = 2.5;
const MINIMAP_BASE_WIDTH = 180;
const MINIMAP_BASE_HEIGHT = 120;
const CLUSTER_SLIDES_STORAGE_KEY = 'analystClusterSlides';
const CLUSTER_MIN_VISUALS = 12;
const SEGMENT_VIEW_MODE_STORAGE_KEY = 'analystSegmentViewMode';

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
  | 'visual_asset_group'
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
  if (t === 'visual_asset_group' || t === 'visual asset group' || t === 'visual-asset-group') return 'visual_asset_group';
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
  if (nodeType === 'visual_asset_group') return 3;
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

function hoverMatchKey(nodeType: string, data: any, colorMode: ColorMode): string | null {
  if (colorMode === 'off') return null;
  const t = String(nodeType || '').toLowerCase();
  if (t === 'deal') return 'deal';
  // Match keys must align with ColorMode semantics.
  // - document mode => docId
  // - segment mode  => segmentId (fallback docId)
  return branchKeyFromData(data, colorMode);
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

type RawLineageEdge = { id: string; source: string; target: string };

function stableJsonForCompare(value: unknown): string {
  try {
    return JSON.stringify(value, (_k, v) => {
      if (typeof v === 'function') return '[fn]';
      if (v === undefined) return null;
      return v;
    });
  } catch {
    return '';
  }
}

function reconcileNodesById(prev: Node[], next: Node[]): Node[] {
  const prevById = new Map<string, Node>();
  for (const n of prev) prevById.set(n.id, n);

  const out: Node[] = [];
  for (const n of next) {
    const p = prevById.get(n.id);
    if (!p) {
      out.push(n);
      continue;
    }

    const same =
      String((p as any)?.type ?? '') === String((n as any)?.type ?? '') &&
      (p.position?.x ?? 0) === (n.position?.x ?? 0) &&
      (p.position?.y ?? 0) === (n.position?.y ?? 0) &&
      stableJsonForCompare((p as any).data) === stableJsonForCompare((n as any).data) &&
      stableJsonForCompare((p as any).style) === stableJsonForCompare((n as any).style) &&
      Boolean((p as any).hidden) === Boolean((n as any).hidden);

    if (same) {
      out.push(p);
      continue;
    }

    // Preserve React Flow internal measurements/fields by merging onto the previous node.
    out.push({
      ...p,
      ...n,
      position: n.position,
      data: (n as any).data,
      style: (n as any).style,
    } as Node);
  }

  if (out.length === prev.length && out.every((n, idx) => n === prev[idx])) return prev;
  return out;
}

function reconcileEdgesById(prev: Edge[], next: Edge[]): Edge[] {
  const prevById = new Map<string, Edge>();
  for (const e of prev) prevById.set(e.id, e);

  const out: Edge[] = [];
  for (const e of next) {
    const p = prevById.get(e.id);
    if (!p) {
      out.push(e);
      continue;
    }

    const same =
      p.source === e.source &&
      p.target === e.target &&
      String((p as any)?.type ?? '') === String((e as any)?.type ?? '') &&
      stableJsonForCompare((p as any).data) === stableJsonForCompare((e as any).data) &&
      stableJsonForCompare((p as any).style) === stableJsonForCompare((e as any).style);

    if (same) {
      out.push(p);
      continue;
    }

    out.push({
      ...p,
      ...e,
      data: (e as any).data,
      style: (e as any).style,
    } as Edge);
  }

  if (out.length === prev.length && out.every((e, idx) => e === prev[idx])) return prev;
  return out;
}

function nodeTypeOf(n: Node): string {
  return String((n as any)?.type ?? (n as any)?.data?.__node_type ?? '').toLowerCase();
}

function addEdgeUnique(out: Edge[], seen: Set<string>, source: string, target: string, idHint: string) {
  if (!source || !target || source === target) return;
  const key = `${source}→${target}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push({
    id: `canon:${idHint}:${source}:${target}`,
    source,
    target,
    data: {
      __docId: undefined,
      __segmentId: undefined,
    },
  } as Edge);
}

function edgeIdForHierarchy(source: string, target: string): string {
  // Stable, human-readable edge ids for key hierarchy edges.
  if (
    source.startsWith('document:') &&
    (target.startsWith('segment:') || target.startsWith('visual_asset:') || target.startsWith('visual_asset_group:') || target.startsWith('visual_group:'))
  ) {
    return `${source}-->${target}`;
  }
  if (
    source.startsWith('segment:') &&
    (target.startsWith('visual_asset:') ||
      target.startsWith('visual_asset_group:') ||
      target.startsWith('visual_group:') ||
      target.startsWith('evidence_group:') ||
      target.startsWith('evidence:'))
  ) {
    return `${source}-->${target}`;
  }
  if (source.startsWith('deal:') && target.startsWith('document:')) {
    return `${source}-->${target}`;
  }
  return `canon:hier:${source}:${target}`;
}

function isDocumentNodeId(id: string): boolean {
  return typeof id === 'string' && id.startsWith('document:');
}

function isSegmentNodeId(id: string): boolean {
  return typeof id === 'string' && id.startsWith('segment:');
}

function isVisualNodeId(id: string): boolean {
  return (
    typeof id === 'string' &&
    (id.startsWith('visual_asset:') || id.startsWith('visual_asset_group:') || id.startsWith('visual_group:'))
  );
}

function buildDocumentsById(nodes: Node[]): Map<string, string> {
  const docs = new Map<string, string>();
  for (const n of nodes) {
    if (nodeTypeOf(n) !== 'document') continue;
    const data = (n.data ?? {}) as any;
    const docId = (data.__docId ?? getDocIdFromData(data) ?? (String(n.id).startsWith('document:') ? String(n.id).slice('document:'.length) : null)) as string | null;
    if (typeof docId === 'string' && docId.trim()) docs.set(docId.trim(), n.id);
  }
  return docs;
}

function normalizeSegmentKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}


// Must match the API lineage segment taxonomy.
const CANONICAL_SEGMENTS = [
  'overview',
  'problem',
  'solution',
  'market',
  'traction',
  'business_model',
  'distribution',
  'team',
  'competition',
  'risks',
  'financials',
  'raise_terms',
  'exit',
  'unknown',
] as const;

type CanonicalSegmentKey = (typeof CANONICAL_SEGMENTS)[number];

const CANONICAL_SEGMENT_SET: ReadonlySet<string> = new Set(CANONICAL_SEGMENTS);
const CANONICAL_SEGMENT_ORDER: ReadonlyMap<string, number> = new Map(
  CANONICAL_SEGMENTS.map((k, i) => [k, i] as const)
);

function coerceCanonicalSegmentKey(raw: unknown): CanonicalSegmentKey {
  const normalized = normalizeSegmentKey(raw);
  if (!normalized) return 'unknown';
  if (CANONICAL_SEGMENT_SET.has(normalized)) return normalized as CanonicalSegmentKey;
  return 'unknown';
}

function inferSegmentKeyForVisual(args: {
  visualNode: Node;
  visualAsset: DealVisualAsset | null;
  segmentViewMode: SegmentViewMode;
}): string {
  const { visualNode, visualAsset, segmentViewMode } = args;
  const data = (visualNode.data ?? {}) as any;

  const segmentSource = (() => {
    if (typeof data?.segment_source === 'string' && data.segment_source.trim().length > 0) return String(data.segment_source);
    if (typeof data?.quality_flags?.segment_source === 'string' && data.quality_flags.segment_source.trim().length > 0)
      return String(data.quality_flags.segment_source);
    if (typeof (visualAsset as any)?.segment_source === 'string' && String((visualAsset as any).segment_source).trim().length > 0)
      return String((visualAsset as any).segment_source);
    return null;
  })();

  // Guardrail: OCR-inferred segment hints should not be treated as "effective" or "persisted" segmentation.
  // They are low-trust hints for triage/debugging, not a promoted/validated segment assignment.
  const isOcrInferredSegment = typeof segmentSource === 'string' && segmentSource.toLowerCase().startsWith('inferred_ocr');

  const pick = (...candidates: unknown[]): CanonicalSegmentKey => {
    for (const c of candidates) {
      const v = coerceCanonicalSegmentKey(c);
      if (v !== 'unknown') return v;
    }
    return 'unknown';
  };

  if (segmentViewMode === 'computed') {
    return pick(
      data?.computed_segment,
      data?.effective_segment,
      data?.segment,
      data?.persisted_segment_key,
      (visualAsset as any)?.persisted_segment_key
    );
  }

  if (segmentViewMode === 'persisted') {
    if (isOcrInferredSegment) {
      return pick(data?.computed_segment, (visualAsset as any)?.computed_segment);
    }
    return pick(
      data?.persisted_segment_key,
      (visualAsset as any)?.persisted_segment_key,
      data?.effective_segment,
      data?.segment,
      data?.computed_segment,
      (visualAsset as any)?.computed_segment
    );
  }

  // Effective (default):
  // Contract: effective_segment → segment → persisted_segment_key → computed_segment (never structured_json.segment_key).
  if (isOcrInferredSegment) {
    return pick(data?.computed_segment, (visualAsset as any)?.computed_segment);
  }
  return pick(
    data?.effective_segment,
    data?.segment,
    data?.persisted_segment_key,
    (visualAsset as any)?.persisted_segment_key,
    data?.computed_segment,
    (visualAsset as any)?.computed_segment
  );
}

function applyDocumentScopedSegmentsGraph(args: {
  nodes: Node[];
  edges: Edge[];
  dealId: string;
  dealVisualAssets: DealVisualAsset[] | null;
  segmentViewMode: SegmentViewMode;
}): { nodes: Node[]; edges: Edge[] } {
  const { nodes, edges, dealId, dealVisualAssets, segmentViewMode } = args;

  const nodeById = new Map(nodes.map((n) => [n.id, n] as const));
  const docsById = buildDocumentsById(nodes);
  const assetsById = new Map<string, DealVisualAsset>();
  for (const a of dealVisualAssets ?? []) {
    if (a?.visual_asset_id) assetsById.set(a.visual_asset_id, a);
  }

  const segmentNodeIds = new Set<string>();
  const segmentLabelById = new Map<string, string>();
  const segmentDocById = new Map<string, string>();
  const segmentKeyById = new Map<string, string>();
  const segmentsByDoc = new Map<string, Set<string>>();
  const visualsWithRouting: Array<{
    visualNodeId: string;
    docId: string;
    segmentKey: string;
    segmentNodeId: string;
    docNodeId: string;
  }> = [];

  for (const n of nodes) {
    const nodeType = nodeTypeOf(n);
    if (nodeType !== 'visual_asset' && nodeType !== 'visual_asset_group') continue;

    const visualNodeId = String(n.id || '').trim();
    if (!visualNodeId) continue;

    const assetId = (() => {
      const id = String(n.id);
      if (id.startsWith('visual_asset:')) return id.slice('visual_asset:'.length);
      const fromData = (n.data as any)?.visual_asset_id;
      return typeof fromData === 'string' && fromData.trim() ? fromData.trim() : null;
    })();

    const asset = assetId ? (assetsById.get(assetId) ?? null) : null;
    const docId = String(((n.data as any)?.__docId ?? getDocIdFromData(n.data as any) ?? asset?.document_id ?? '')).trim();
    if (!docId) continue;

    const docNodeId = docsById.get(docId) ?? `document:${docId}`;
    if (!nodeById.has(docNodeId)) continue;

    const segmentKey = inferSegmentKeyForVisual({ visualNode: n, visualAsset: asset, segmentViewMode });
    const segmentNodeId = `segment:${dealId}:${docId}:${segmentKey}`;

    segmentNodeIds.add(segmentNodeId);
    segmentDocById.set(segmentNodeId, docId);
    segmentKeyById.set(segmentNodeId, segmentKey);
    segmentLabelById.set(
      segmentNodeId,
      segmentKey === 'financials'
        ? 'Financials'
        : segmentKey === 'business_model'
          ? 'Business model'
          : segmentKey === 'raise_terms'
            ? 'Raise terms'
            : segmentKey === 'unknown'
              ? 'Unknown'
              : segmentKey
    );

    if (!segmentsByDoc.has(docId)) segmentsByDoc.set(docId, new Set());
    segmentsByDoc.get(docId)!.add(segmentNodeId);

    visualsWithRouting.push({ visualNodeId, docId, segmentKey, segmentNodeId, docNodeId });
  }

  // Create segment nodes only for documents with visuals.
  const addedSegmentNodes: Node[] = [];
  for (const segNodeId of segmentNodeIds) {
    if (nodeById.has(segNodeId)) continue;
    const docId = segmentDocById.get(segNodeId) ?? null;
    const label = segmentLabelById.get(segNodeId) ?? 'Unknown';
    const segmentKey = segmentKeyById.get(segNodeId) ?? 'unknown';
    const segmentOrder = CANONICAL_SEGMENT_ORDER.get(segmentKey) ?? CANONICAL_SEGMENT_ORDER.get('unknown') ?? 999;
    addedSegmentNodes.push({
      id: segNodeId,
      type: 'segment',
      position: { x: 0, y: 0 },
      data: {
        label,
        segment_label: label,
        segment_key: segmentKey,
        __segmentOrder: segmentOrder,
        __node_type: 'segment',
        __layer: layerForType('segment'),
        __docId: docId ?? undefined,
        __segmentId: segmentKey,
        __branchKey: docId ? `${docId}:${segmentKey}` : undefined,
      },
      selectable: true,
    } as Node);
  }

  const nextNodes = nodes.concat(addedSegmentNodes);
  const nextNodeById = new Map(nextNodes.map((n) => [n.id, n] as const));

  const seen = new Set<string>();
  const nextEdges: Edge[] = [];
  const add = (source: string, target: string, data?: Record<string, unknown>) => {
    if (!source || !target || source === target) return;
    if (!nextNodeById.has(source) || !nextNodeById.has(target)) return;
    const key = `${source}→${target}`;
    if (seen.has(key)) return;
    seen.add(key);
    nextEdges.push({
      id: edgeIdForHierarchy(source, target),
      source,
      target,
      data: { ...((data ?? {}) as any) },
    } as Edge);
  };

  // Keep existing edges but remove any direct deal→segment and any document→visual (we enforce segment routing).
  const dealNodeId = `deal:${dealId}`;
  for (const e of edges) {
    if (String(e.source).startsWith('deal:') && isSegmentNodeId(String(e.target))) continue;
    if (String(e.source).startsWith('deal:') && isVisualNodeId(String(e.target))) continue;
    if (isDocumentNodeId(String(e.source)) && isVisualNodeId(String(e.target))) continue;
    if (isSegmentNodeId(String(e.source)) && isVisualNodeId(String(e.target))) continue;
    if (isDocumentNodeId(String(e.source)) && isSegmentNodeId(String(e.target))) continue;
    add(e.source, e.target, (e as any).data ?? {});
  }

  // Ensure Deal→Document edges exist.
  for (const [docId, docNodeId] of docsById.entries()) {
    add(dealNodeId, docNodeId, { __docId: docId, __segmentId: docId, __branchKey: `${docId}:${docId}` });
  }

  // Document→Segment edges.
  for (const [docId, segIds] of segmentsByDoc.entries()) {
    const docNodeId = docsById.get(docId);
    if (!docNodeId) continue;
    for (const segNodeId of segIds.values()) {
      const segmentKey = segmentKeyById.get(segNodeId) ?? 'unknown';
      add(docNodeId, segNodeId, {
        __docId: docId,
        __segmentId: segmentKey,
        __branchKey: `${docId}:${segmentKey}`,
      });
    }
  }

  // Segment→Visual edges.
  for (const r of visualsWithRouting) {
    add(r.segmentNodeId, r.visualNodeId, {
      __docId: r.docId,
      __segmentId: r.segmentKey,
      __branchKey: `${r.docId}:${r.segmentKey}`,
    });
  }

  // DEV logging: 10 random assets with invariant checks.
  if (import.meta.env.DEV && getDevtoolsConsoleLoggingEnabled() && visualsWithRouting.length > 0) {
    try {
      const shuffled = [...visualsWithRouting].sort(() => Math.random() - 0.5);
      const sample = shuffled.slice(0, 10);
      const rows = sample.map((s) => ({
        visualNodeId: s.visualNodeId,
        docId: s.docId,
        segmentKey: s.segmentKey,
        segmentNodeId: s.segmentNodeId,
        docNodeId: s.docNodeId,
        segmentIdOk: s.segmentNodeId.startsWith(`segment:${s.docId}:`),
      }));
      // eslint-disable-next-line no-console
      console.log('[Analyst graph] sample segment routing', rows);
      const bad = rows.find((r) => r.segmentIdOk !== true);
      if (bad) {
        // eslint-disable-next-line no-console
        console.warn('[Analyst graph] segmentNodeId invariant failed', bad);
      }
    } catch {
      // ignore
    }
  }

  // Final safety: absolutely no deal→segment edges.
  const finalEdges = nextEdges.filter((e) => !(String(e.source).startsWith('deal:') && isSegmentNodeId(String(e.target))));
  return { nodes: nextNodes, edges: finalEdges };
}

function buildCanonicalEdges(args: { nodes: Node[]; rawEdges: RawLineageEdge[]; dealId: string }): Edge[] {
  const { nodes, rawEdges, dealId } = args;

  const byId = new Map<string, Node>();
  const typeById = new Map<string, string>();
  for (const n of nodes) {
    byId.set(n.id, n);
    typeById.set(n.id, nodeTypeOf(n));
  }

  const dealNodeId = findDealRootId(nodes, dealId);

  const docNodeIds: string[] = [];
  const segNodeIds: string[] = [];
  for (const n of nodes) {
    const t = nodeTypeOf(n);
    if (t === 'document') docNodeIds.push(n.id);
    if (t === 'segment') segNodeIds.push(n.id);
  }

  // Undirected parent candidates from raw edges.
  const parentsByChild = new Map<string, Set<string>>();
  const addParent = (child: string, parent: string) => {
    if (!child || !parent) return;
    if (!parentsByChild.has(child)) parentsByChild.set(child, new Set());
    parentsByChild.get(child)!.add(parent);
  };
  for (const e of rawEdges) {
    if (!e?.source || !e?.target) continue;
    if (!typeById.has(e.source) || !typeById.has(e.target)) continue;
    addParent(e.target, e.source);
    addParent(e.source, e.target);
  }

  const pickParentOfType = (childId: string, wantType: string): string | null => {
    const set = parentsByChild.get(childId);
    if (!set) return null;
    for (const pid of set) {
      if (typeById.get(pid) === wantType) return pid;
    }
    return null;
  };

  const pickDocParent = (nodeId: string): string | null => {
    const n = byId.get(nodeId);
    const d = ((n as any)?.data ?? {}) as any;
    const docId = d.__docId ?? getDocIdFromData(d);
    if (typeof docId === 'string' && docId.trim()) {
      const asNodeId = `document:${docId.trim()}`;
      if (byId.has(asNodeId)) return asNodeId;
      // sometimes document nodes don't use the prefix; search by __docId
      const found = nodes.find((x) => nodeTypeOf(x) === 'document' && ((x.data as any)?.__docId ?? getDocIdFromData(x.data as any)) === docId.trim());
      if (found) return found.id;
    }
    return pickParentOfType(nodeId, 'document');
  };

  const pickSegParent = (nodeId: string): string | null => {
    const n = byId.get(nodeId);
    const d = ((n as any)?.data ?? {}) as any;
    const segId = d.__segmentId ?? getSegmentIdFromData(d);
    if (typeof segId === 'string' && segId.trim()) {
      const asNodeId = `segment:${segId.trim()}`;
      if (byId.has(asNodeId)) return asNodeId;
      const found = nodes.find((x) => nodeTypeOf(x) === 'segment' && ((x.data as any)?.__segmentId ?? getSegmentIdFromData(x.data as any)) === segId.trim());
      if (found) return found.id;
    }
    return pickParentOfType(nodeId, 'segment');
  };

  const out: Edge[] = [];
  const seen = new Set<string>();

  // 1) Deal → Document
  for (const docId of docNodeIds) addEdgeUnique(out, seen, dealNodeId, docId, 'deal-doc');

  // 2) Document → Segment
  // IMPORTANT: do not connect segments directly to the deal if there is at least one document.
  // If we cannot infer a specific document parent, keep the segment under the deal.
  for (const segId of segNodeIds) {
    const docParent = pickDocParent(segId);
    if (docParent) {
      addEdgeUnique(out, seen, docParent, segId, 'doc-seg');
      continue;
    }

    // If the segment can't be attributed to a specific document, keep it reachable under the deal.
    addEdgeUnique(out, seen, dealNodeId, segId, docNodeIds.length > 0 ? 'deal-seg:unknown-doc' : 'deal-seg:only-when-no-docs');
  }

  // 3) Segment → Visual (fallback doc→visual if seg unknown)
  for (const n of nodes) {
    const t = nodeTypeOf(n);
    if (t !== 'visual_asset' && t !== 'visual_asset_group' && t !== 'visual_group') continue;
    const segParent = pickSegParent(n.id) ?? pickParentOfType(n.id, 'segment');
    if (segParent) {
      addEdgeUnique(out, seen, segParent, n.id, 'seg-vis');
      continue;
    }
    const docParent = pickDocParent(n.id);
    if (docParent) addEdgeUnique(out, seen, docParent, n.id, 'doc-vis');
    else addEdgeUnique(out, seen, dealNodeId, n.id, 'deal-vis');
  }

  // 4) Visual → Evidence (best-effort: prefer raw visual parent)
  for (const n of nodes) {
    const t = nodeTypeOf(n);
    if (t !== 'evidence' && t !== 'evidence_group') continue;
    const visParent =
      pickParentOfType(n.id, 'visual_asset') ??
      pickParentOfType(n.id, 'visual_asset_group') ??
      pickParentOfType(n.id, 'visual_group');
    if (visParent) {
      addEdgeUnique(out, seen, visParent, n.id, 'vis-evid');
      continue;
    }
    // fallback: keep evidence reachable under its segment/doc/deal (but do not connect segment→deal etc)
    const segParent = pickSegParent(n.id) ?? pickParentOfType(n.id, 'segment');
    if (segParent) {
      addEdgeUnique(out, seen, segParent, n.id, 'seg-evid');
      continue;
    }
    const docParent = pickDocParent(n.id);
    if (docParent) addEdgeUnique(out, seen, docParent, n.id, 'doc-evid');
    else addEdgeUnique(out, seen, dealNodeId, n.id, 'deal-evid');
  }

  if (import.meta.env.DEV && getDevtoolsConsoleLoggingEnabled()) {
    try {
      const counts = out.reduce((m, e) => {
        const st = typeById.get(e.source) ?? 'unknown';
        const tt = typeById.get(e.target) ?? 'unknown';
        const k = `${st}→${tt}`;
        (m as any)[k] = ((m as any)[k] ?? 0) + 1;
        return m;
      }, {} as Record<string, number>);
      // eslint-disable-next-line no-console
      console.log('[canonical edges] countsByType', counts);
    } catch {
      // ignore
    }
  }

  return out;
}

function buildFullGraphFromLineage(
  lineage: DealLineageResponse,
  dealId: string,
  dealVisualAssets: DealVisualAsset[] | null,
  opts?: {
    segmentViewMode?: SegmentViewMode;
  }
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const visualAssetsById = new Map<string, DealVisualAsset>();
  for (const a of dealVisualAssets ?? []) {
    if (a?.visual_asset_id) visualAssetsById.set(a.visual_asset_id, a);
  }

  // DEV-only: verify lineage-enriched visual_asset fields survive mapping into React Flow nodes.
  let didLogLineageVisualAssetMapping = false;

  for (let idx = 0; idx < (lineage.nodes || []).length; idx++) {
    const raw = (lineage.nodes || [])[idx] as any;
    const nodeType = normalizeLineageNodeType(raw);

    // UI invariant: segments are document-scoped; we synthesize them from visuals.
    if (nodeType === 'segment') continue;

    const id = getLineageNodeId(raw) || `unknown:${nodeType}:${idx}`;
    const layer = layerForType(nodeType);

    const visualAssetIdFromNodeId = (() => {
      const s = String(id);
      if (s.startsWith('visual_asset:')) return s.slice('visual_asset:'.length);
      return null;
    })();

    const inferredDocId = (() => {
      const fromData = getDocIdFromData(raw?.data ?? {});
      if (fromData) return fromData;
      if (String(id).startsWith('document:')) return id.slice('document:'.length);

      // If the lineage node is a visual_asset, prefer the doc id from the deal visual assets endpoint.
      if (nodeType === 'visual_asset' && visualAssetIdFromNodeId) {
        const a = visualAssetsById.get(visualAssetIdFromNodeId);
        if (a?.document_id) return a.document_id;
      }

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

    const rawData = { ...(raw?.data ?? {}) } as any;
    if (nodeType === 'visual_asset' && inferredDocId) {
      // Ensure downstream helpers can always discover doc id.
      if (rawData.document_id == null && rawData.doc_id == null && rawData.documentId == null) {
        rawData.document_id = inferredDocId;
      }
      if (visualAssetIdFromNodeId && rawData.visual_asset_id == null) rawData.visual_asset_id = visualAssetIdFromNodeId;
    }

    // Segment routing is controlled by Segment View Mode via inferSegmentKeyForVisual().

    const mapped: Node = {
      id,
      type: nodeType,
      position: { x: 0, y: 0 },
      data: {
        ...rawData,
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

  const rawEdges: RawLineageEdge[] = [];
  for (const re of lineage.edges || []) {
    const id = typeof (re as any)?.id === 'string' ? String((re as any).id) : '';
    const source = typeof (re as any)?.source === 'string' ? String((re as any).source) : '';
    const target = typeof (re as any)?.target === 'string' ? String((re as any).target) : '';
    if (!source || !target) continue;
    rawEdges.push({ id: id || `${source}->${target}`, source, target });
  }

  const canonicalEdges = buildCanonicalEdges({ nodes, rawEdges, dealId });
  const inferred = inferBranchMetadata(nodes, canonicalEdges);
  // Enforce Deal→Document→Segment→Visual→Evidence with deal+document-scoped segment ids.
  return applyDocumentScopedSegmentsGraph({
    ...inferred,
    dealId,
    dealVisualAssets,
    segmentViewMode: opts?.segmentViewMode ?? 'effective',
  });
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

  const [segmentViewMode, setSegmentViewMode] = useState<SegmentViewMode>(() => {
    if (typeof window === 'undefined') return 'effective';
    const stored = window.localStorage.getItem(SEGMENT_VIEW_MODE_STORAGE_KEY);
    return stored === 'computed' || stored === 'persisted' || stored === 'effective' ? stored : 'effective';
  });

  const [hoverBranchKey, setHoverBranchKey] = useState<string | null>(null);
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null);
  const [hoverScopeNodeIds, setHoverScopeNodeIds] = useState<Set<string> | null>(null);
  const [hoverScopeEdgeIds, setHoverScopeEdgeIds] = useState<Set<string> | null>(null);
  const hoverClearTimerRef = useRef<number | null>(null);
  const hoverEpochRef = useRef(0);

  const [minimapScale, setMinimapScale] = useState<number>(() => {
    if (typeof window === 'undefined') return 1;
    const raw = window.localStorage.getItem(MINIMAP_SCALE_STORAGE_KEY);
    const parsed = raw != null ? Number(raw) : NaN;
    if (Number.isFinite(parsed)) return clamp(parsed, MINIMAP_SCALE_MIN, MINIMAP_SCALE_MAX);
    return 1;
  });

  const [nodes, setNodes, onNodesChange] = useNodesState([] as Node[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[]);

  // Keep stable per-node expand toggles so node.data does not churn every render.
  const toggleExpandByIdRef = useRef(new Map<string, () => void>());
  const fullGraphRef = useRef<typeof fullGraph>(null);
  const clusteredRef = useRef<typeof clustered | null>(null);
  const toggleExpandImplRef = useRef<(id: string) => void>(() => {});

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
  const [selectedVisual, setSelectedVisual] = useState<DealVisualAsset | null>(null);
  const [dealVisualAssets, setDealVisualAssets] = useState<DealVisualAsset[] | null>(null);

  const [inspectorImageModal, setInspectorImageModal] = useState<{ src: string; title?: string } | null>(null);

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
    setInspectorImageModal(null);
  }, [selection.kind, (selection as any)?.visual_asset_id, (selection as any)?.visual_asset_group_id, selectedRfNodeId]);

  useEffect(() => {
    if (selection.kind !== 'none' && !inspectorOpen) setInspectorOpen(true);
  }, [selection.kind, inspectorOpen]);

  const visualAssetCacheRef = useRef(new Map<string, DealVisualAsset>());
  const dealAssetsFetchedRef = useRef(false);

  const refresh = async () => {
    if (!dealId || !isLiveBackend()) return;

    setLoading(true);
    setError(null);
    setVisualDetailError(null);
    setSelectedVisual(null);
    setDealVisualAssets(null);
    visualAssetCacheRef.current.clear();
    dealAssetsFetchedRef.current = false;

    try {
      const lineagePromise = apiGetDealLineage(dealId);
      const assetsPromise = apiGetDealVisualAssets(dealId);

      const [lineageRes, assetsRes] = await Promise.allSettled([lineagePromise, assetsPromise]);

      if (lineageRes.status !== 'fulfilled') throw lineageRes.reason;
      const res = lineageRes.value;

      if (assetsRes.status === 'fulfilled') {
        const assets = Array.isArray(assetsRes.value?.visual_assets) ? assetsRes.value.visual_assets : [];
        setDealVisualAssets(assets);
        upsertAssetsIntoCache(assets);
        dealAssetsFetchedRef.current = true;

        if (import.meta.env.DEV && getDevtoolsConsoleLoggingEnabled()) {
          try {
            const byType = assets.reduce((m, a) => {
              const k = String(a?.document_type ?? a?.document?.type ?? 'unknown').toUpperCase();
              (m as any)[k] = ((m as any)[k] ?? 0) + 1;
              return m;
            }, {} as Record<string, number>);
            // eslint-disable-next-line no-console
            console.log('[DealAnalystTab] deal visual assets by document_type', byType);
          } catch {
            // ignore
          }
        }
      } else {
        setDealVisualAssets(null);
        // Keep false so selection can try again.
        dealAssetsFetchedRef.current = false;
      }

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
      // Note: dealVisualAssets + cache are populated by the assets fetch above.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load analyst graph');
      setLineage(null);
      setWarnings([]);
      setDealVisualAssets(null);
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
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(SEGMENT_VIEW_MODE_STORAGE_KEY, segmentViewMode);
  }, [segmentViewMode]);

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
    const g = buildFullGraphFromLineage(lineage, dealId, dealVisualAssets, {
      segmentViewMode,
    });
    setFullGraph(g);

    setExpandedById((prev) => {
      const next: ExpandedById = { ...(prev ?? {}) };
      for (const n of g.nodes) {
        if (next[n.id] === undefined) next[n.id] = defaultExpandedForNode(n);
      }
      return next;
    });
  }, [lineage, dealId, dealVisualAssets, segmentViewMode]);

  useEffect(() => {
    fullGraphRef.current = fullGraph;
  }, [fullGraph]);

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
    clusteredRef.current = clustered;
  }, [clustered]);

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

  // Toggle impl uses refs so per-node handlers can remain stable across renders.
  toggleExpandImplRef.current = (id: string) => {
    setExpandedById((prev) => {
      const fg = fullGraphRef.current;
      const cl = clusteredRef.current;
      const node = fg?.nodes.find((n) => n.id === id) ?? cl?.nodes.find((n) => n.id === id);
      const cur = prev[id] ?? (node ? defaultExpandedForNode(node) : false);
      return { ...prev, [id]: !cur };
    });
  };

  useEffect(() => {
    // Prune handlers for nodes that no longer exist.
    const keep = new Set(clustered.nodes.map((n) => n.id));
    const map = toggleExpandByIdRef.current;
    for (const key of map.keys()) {
      if (!keep.has(key)) map.delete(key);
    }
  }, [clustered.nodes]);

  const renderedNodesUnlaid = useMemo(() => {
    return clustered.nodes.map((n) => {
      const baseNode = fullGraph?.nodes.find((bn) => bn.id === n.id) ?? n;
      const stableType = String((baseNode as any)?.type ?? (n as any)?.type ?? 'default').trim().toLowerCase();
      const expanded = expandedById[n.id] ?? defaultExpandedForNode(n);
      // Use full-graph descendant counts so the toggle stays visible even when children are hidden in the current projection.
      const descendantCount = visible.descendantCountsById[n.id] ?? clustered.descendantCountsById[n.id] ?? 0;
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

      const handlers = toggleExpandByIdRef.current;
      let onToggleExpand = handlers.get(n.id);
      if (!onToggleExpand) {
        onToggleExpand = () => toggleExpandImplRef.current(n.id);
        handlers.set(n.id, onToggleExpand);
      }

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
          onToggleExpand,
          __accentColor: accent?.stroke,
          __accentTint: accent?.tint,
        },
      } as Node;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clustered.nodes, clustered.descendantCountsById, visible.descendantCountsById, expandedById, darkMode, fullGraph, colorMode]);

  const renderedNodes = useMemo(() => {
    // Re-run layout when lineage loads, when expansion changes, or on explicit re-layout.
    void layoutNonce;
    return layoutGraph(renderedNodesUnlaid, renderedEdges, { direction: 'TB' });
  }, [renderedNodesUnlaid, renderedEdges, layoutNonce]);

  const nodeById = useMemo(() => {
    const m = new Map<string, Node>();
    for (const n of nodes) m.set(n.id, n);
    return m;
  }, [nodes]);

  const edgesBySource = useMemo(() => {
    const m = new Map<string, Edge[]>();
    for (const e of edges) {
      if (!m.has(e.source)) m.set(e.source, []);
      m.get(e.source)!.push(e);
    }
    return m;
  }, [edges]);

  const edgesByTarget = useMemo(() => {
    const m = new Map<string, Edge[]>();
    for (const e of edges) {
      if (!m.has(e.target)) m.set(e.target, []);
      m.get(e.target)!.push(e);
    }
    return m;
  }, [edges]);

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
    for (const n of nodes) {
      const nodeType = String((n as any)?.type ?? '').toLowerCase();
      const key = hoverMatchKey(nodeType, (n as any)?.data ?? {}, colorMode);
      if (key) map.set(n.id, key);
    }
    return map;
  }, [nodes, colorMode]);

  const branchKeyByEdgeId = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of edges) {
      const fromEndpoints = branchKeyByNodeId.get(e.source) ?? branchKeyByNodeId.get(e.target) ?? null;
      if (fromEndpoints) {
        map.set(e.id, fromEndpoints);
        continue;
      }

      const data = ((e as any)?.data ?? {}) as any;
      const fromData = branchKeyFromData(data, colorMode);
      if (fromData) {
        map.set(e.id, fromData);
      }
    }
    return map;
  }, [edges, colorMode, branchKeyByNodeId]);

  const displayNodes = useMemo(() => {
    if (hoverBranchKey == null || colorMode === 'off') return nodes;
    return nodes.map((n) => {
      const key = branchKeyByNodeId.get(n.id) ?? null;
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
  }, [nodes, hoverBranchKey, branchKeyByNodeId, colorMode]);

  const displayEdges = useMemo(() => {
    if (hoverBranchKey == null || colorMode === 'off') return edges;
    return edges.map((e) => {
      const key = branchKeyByNodeId.get(e.source) ?? branchKeyByNodeId.get(e.target) ?? branchKeyByEdgeId.get(e.id) ?? null;
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
  }, [edges, hoverBranchKey, branchKeyByEdgeId, branchKeyByNodeId, colorMode]);

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

    // Reconcile by id so unchanged nodes/edges keep object identity.
    setNodes((prev) => reconcileNodesById(prev as Node[], renderedNodes));
    setEdges((prev) => reconcileEdgesById(prev as Edge[], renderedEdges));
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
  }, [hoverBranchKey, hoverNodeId, colorMode, nodes, branchKeyByNodeId]);

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

  const computeHoverScope = (node: Node): { nodeIds: Set<string>; edgeIds: Set<string> } => {
    const nodeIds = new Set<string>();
    const edgeIds = new Set<string>();

    const addNode = (id: string) => { if (id) nodeIds.add(id); };
    const addEdge = (e: Edge) => {
      if (!e) return;
      edgeIds.add(e.id);
      addNode(e.source);
      addNode(e.target);
    };

    const typeOfId = (id: string): string => {
      const n = nodeById.get(id);
      return n ? nodeTypeOf(n) : '';
    };

    const outgoing = (id: string) => edgesBySource.get(id) ?? [];
    const incoming = (id: string) => edgesByTarget.get(id) ?? [];

    const rootId = node.id;
    const t = nodeTypeOf(node);

    addNode(rootId);

    if (t === 'deal') {
      for (const e of outgoing(rootId)) {
        if (typeOfId(e.target) === 'document') addEdge(e);
      }
      return { nodeIds, edgeIds };
    }

    if (t === 'document') {
      for (const e of incoming(rootId)) {
        if (typeOfId(e.source) === 'deal') addEdge(e);
      }
      for (const e of outgoing(rootId)) {
        if (typeOfId(e.target) === 'segment') addEdge(e);
      }
      return { nodeIds, edgeIds };
    }

    if (t === 'segment') {
      for (const e of incoming(rootId)) {
        if (typeOfId(e.source) === 'document') addEdge(e);
      }

      const visIds: string[] = [];
      for (const e of outgoing(rootId)) {
        const tt = typeOfId(e.target);
        if (tt === 'visual_asset' || tt === 'visual_group') {
          addEdge(e);
          visIds.push(e.target);
        }
      }

      for (const vid of visIds) {
        for (const e2 of outgoing(vid)) {
          const tt2 = typeOfId(e2.target);
          if (tt2 === 'evidence' || tt2 === 'evidence_group') addEdge(e2);
        }
      }

      return { nodeIds, edgeIds };
    }

    if (t === 'visual_asset' || t === 'visual_group') {
      for (const e of incoming(rootId)) {
        if (typeOfId(e.source) === 'segment') addEdge(e);
      }
      for (const e of outgoing(rootId)) {
        const tt = typeOfId(e.target);
        if (tt === 'evidence' || tt === 'evidence_group') addEdge(e);
      }
      return { nodeIds, edgeIds };
    }

    if (t === 'evidence' || t === 'evidence_group') {
      for (const e of incoming(rootId)) {
        const st = typeOfId(e.source);
        if (st === 'visual_asset' || st === 'visual_group') addEdge(e);
      }
      return { nodeIds, edgeIds };
    }

    return { nodeIds, edgeIds };
  };

  const handleNodeMouseEnter = (_event: any, node: Node) => {
    // Cancel any pending hover clear to prevent flicker when moving between nodes/inspector.
    if (hoverClearTimerRef.current != null) {
      window.clearTimeout(hoverClearTimerRef.current);
      hoverClearTimerRef.current = null;
    }
    hoverEpochRef.current += 1;

    const data = ((node as any)?.data ?? {}) as any;
    const nodeType = String((node as any)?.type ?? '').toLowerCase();
    const nodeId = String((node as any)?.id ?? '');
    const key = hoverMatchKey(nodeType, data, colorMode);

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

    if (hoverClearTimerRef.current != null) {
      window.clearTimeout(hoverClearTimerRef.current);
      hoverClearTimerRef.current = null;
    }

    const epoch = hoverEpochRef.current;
    hoverClearTimerRef.current = window.setTimeout(() => {
      // If another hover entered since scheduling, do nothing.
      if (hoverEpochRef.current !== epoch) return;
      setHoverNodeId(null);
      setHoverBranchKey(null);
      hoverClearTimerRef.current = null;
    }, 200);
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

  const nodeTypes = ANALYST_NODE_TYPES;

  const edgeTypes = ANALYST_EDGE_TYPES;


  const hasVisuals = useMemo(() => {
    return Boolean(
      lineage?.nodes?.some((n: any) => {
        const t = String(n?.type ?? '').toLowerCase();
        return t === 'visual_asset' || t === 'visual group' || t === 'visual_group';
      })
    );
  }, [lineage]);

  const summarizeVisualAsset = (asset: DealVisualAsset): string | null => {
    const t = asset.asset_type ? String(asset.asset_type) : '';
    const pageIndex = typeof asset.page_index === 'number' && Number.isFinite(asset.page_index) ? asset.page_index : null;
    const page = pageIndex != null ? pageIndex + 1 : null;

    const table = getTablePreviewModel(asset.structured_json, { maxRows: 6, maxCols: 6 });
    if (table) return `Table detected${page != null ? ` (p${page})` : ''}${t ? ` · ${t}` : ''}`;

    const chart = getBarChartPreviewModel(asset.structured_json, { maxBars: 8 });
    if (chart) return `Bar chart detected${page != null ? ` (p${page})` : ''}${t ? ` · ${t}` : ''}`;

    if (asset.ocr_text && asset.ocr_text.trim().length > 0) return `OCR text available${page != null ? ` (p${page})` : ''}${t ? ` · ${t}` : ''}`;

    return t || null;
  };

  const upsertAssetsIntoCache = (assets: DealVisualAsset[]) => {
    let didChange = false;
    const cache = visualAssetCacheRef.current;
    for (const a of assets) {
      if (!a?.visual_asset_id) continue;
      cache.set(a.visual_asset_id, a);
      didChange = true;
    }

    if (didChange) {
      const allAssets = Array.from(cache.values());
      setFullGraph((prev) => {
        if (!prev) return prev;
        const byVaId = new Map(allAssets.map((a) => [a.visual_asset_id, a] as const));
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

            const evidenceCount =
              existing.evidence_count ??
              existing.count ??
              (a.evidence?.count != null ? a.evidence.count : a.evidence?.evidence_count);
            const sampleSnippet = Array.isArray(a.evidence?.sample_snippets)
              ? a.evidence?.sample_snippets?.find((s) => typeof s === 'string' && s.trim().length > 0)
              : undefined;

            return {
              ...n,
              data: {
                ...(n.data ?? {}),
                image_uri: (n.data as any)?.image_uri ?? a.image_uri,
                confidence: (n.data as any)?.confidence ?? a.confidence,
                asset_type: (n.data as any)?.asset_type ?? a.asset_type,
                page_index: (n.data as any)?.page_index ?? a.page_index,
                segment_key:
                  (n.data as any)?.segment_key ??
                  (n.data as any)?.effective_segment ??
                  (n.data as any)?.segment ??
                  (n.data as any)?.persisted_segment_key ??
                  (n.data as any)?.computed_segment ??
                  (a as any)?.effective_segment ??
                  (a as any)?.segment ??
                  (a as any)?.persisted_segment_key ??
                  (a as any)?.computed_segment ??
                  (a as any)?.segment_key,
                quality_flags: (n.data as any)?.quality_flags ?? (a as any)?.quality_flags,
                structured_json: (n.data as any)?.structured_json ?? (a as any)?.structured_json,
                evidence_count: evidenceCount,
                ocr_text_snippet: existing.ocr_text_snippet ?? derivedOcrSnippet,
                structured_kind: existing.structured_kind ?? derivedStructuredKind,
                structured_summary: existing.structured_summary ?? (a as any)?.structured_summary ?? derivedStructuredSummary,
              },
            } as Node;
          }
          if (id.startsWith('evidence:')) {
            const vaId = id.slice('evidence:'.length);
            const a = byVaId.get(vaId);
            if (!a) return n;
            const snippet = Array.isArray(a.evidence?.sample_snippets)
              ? a.evidence.sample_snippets.find((s) => typeof s === 'string' && s.trim().length > 0)
              : undefined;
            const evidenceCount =
              a.evidence?.count != null
                ? a.evidence.count
                : a.evidence?.evidence_count != null
                  ? a.evidence.evidence_count
                  : undefined;
            return {
              ...n,
              data: {
                ...(n.data ?? {}),
                count: evidenceCount ?? (n.data as any)?.count,
                sample_snippet: typeof snippet === 'string' && snippet.trim().length > 0 ? snippet.trim() : undefined,
              },
            } as Node;
          }
          return n;
        });
        return { ...prev, nodes: updatedNodes };
      });
    }
  };

  const loadVisualDetails = async (documentId: string, visualAssetId: string) => {
    if (!dealId || !visualAssetId) return;

    setVisualDetailLoading(true);
    setVisualDetailError(null);
    setSelectedVisual(null);

    try {
      if (!dealAssetsFetchedRef.current) {
        try {
          const res = await apiGetDealVisualAssets(dealId);
          upsertAssetsIntoCache(Array.isArray(res?.visual_assets) ? res.visual_assets : []);
          dealAssetsFetchedRef.current = true;
        } catch (err) {
          // Defer to document-level fetch fallback
          dealAssetsFetchedRef.current = true;
          if (err instanceof Error) {
            setVisualDetailError(`Failed to load deal visual assets: ${err.message}`);
          }
        }
      }

      let match = visualAssetCacheRef.current.get(visualAssetId) ?? null;

      if (!match && documentId) {
        const resp = await apiGetDocumentVisualAssets(dealId, documentId);
        upsertAssetsIntoCache(resp.visual_assets ?? []);
        match = visualAssetCacheRef.current.get(visualAssetId) ?? null;
      }

      setSelectedVisual(match ?? null);
      if (!match) setVisualDetailError('Visual asset details not found for this selection.');
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
              onInit={(instance: ReactFlowInstance) => {
                setRfInstance(instance);
                if (typeof window !== 'undefined') {
                  (window as any).__rf = instance;
                }
              }}
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

                if (t === 'visual_asset_group') {
                  const fromPrefixGroup = (prefix: string) => (nodeId.startsWith(prefix) ? nodeId.slice(prefix.length) : '');
                  const groupIdFromNode = fromPrefixGroup('visual_asset_group:') || String((data as any).visual_asset_group_id ?? '');
                  const document_id = String(data.document_id ?? documentIdFromNode ?? (data as any).doc_id ?? '');
                  const memberIds = Array.isArray((data as any).member_visual_asset_ids)
                    ? ((data as any).member_visual_asset_ids as unknown[]).filter((x) => typeof x === 'string') as string[]
                    : undefined;
                  const countMembers =
                    typeof (data as any).count_members === 'number'
                      ? (data as any).count_members
                      : memberIds
                        ? memberIds.length
                        : undefined;

                  setSelection({
                    kind: 'visual_asset_group',
                    document_id,
                    visual_asset_group_id: groupIdFromNode,
                    page_label: typeof data.label === 'string' ? data.label : typeof (data as any).page_label === 'string' ? (data as any).page_label : undefined,
                    count_members: countMembers,
                    member_visual_asset_ids: memberIds,
                  });
                  setSelectedVisual(null);
                  setVisualDetailError(null);
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
                  <div className={`inline-flex items-center gap-2 text-xs ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                    <label className="inline-flex items-center gap-2 select-none">
                      <span>Segments</span>
                      <select
                        value={segmentViewMode}
                        onChange={(e) => {
                          const next = e.target.value as SegmentViewMode;
                          setSegmentViewMode(next);
                          didInitialFitRef.current = false;
                          lastFitViewNonceRef.current = null;
                          setLayoutNonce((v) => v + 1);
                        }}
                        className={`h-7 rounded border px-2 ${darkMode ? 'bg-gray-900 border-gray-700 text-gray-100' : 'bg-white border-gray-300 text-gray-800'}`}
                      >
                        <option value="effective">Effective</option>
                        <option value="computed">Computed</option>
                        <option value="persisted">Persisted</option>
                      </select>
                    </label>
                  </div>
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
                    const persisted = typeof rfData.persisted_segment_key === 'string' ? rfData.persisted_segment_key : null;
                    const computed = typeof rfData.computed_segment === 'string' ? rfData.computed_segment : null;
                    const effective = typeof rfData.effective_segment === 'string' ? rfData.effective_segment : typeof rfData.segment === 'string' ? rfData.segment : null;
                    const source = typeof rfData.segment_source === 'string' ? rfData.segment_source : null;
                    const reason = rfData.computed_reason as any;
                    if (!persisted && !computed && !effective) return null;

                    const isHumanOverride = typeof source === 'string' && source.toLowerCase().includes('human_override');

                    const formatScore = (v: unknown): string | null => {
                      if (typeof v !== 'number' || !Number.isFinite(v)) return null;
                      const pct = v <= 1 ? v * 100 : v;
                      return `${Math.round(pct)}%`;
                    };

                    const bestScore = formatScore(reason?.best_score);
                    const threshold = formatScore(reason?.threshold);

                    const topScores = (() => {
                      const raw = reason?.top_scores;
                      if (!Array.isArray(raw)) return [];
                      const cleaned = raw
                        .map((row: any) => {
                          const seg = typeof row?.segment === 'string' ? row.segment : typeof row?.key === 'string' ? row.key : null;
                          const score = formatScore(row?.score);
                          if (!seg || !score) return null;
                          return { seg, score };
                        })
                        .filter(Boolean) as Array<{ seg: string; score: string }>;
                      return cleaned.slice(0, 3);
                    })();

                    const unknownReasonCode =
                      computed === 'unknown' && typeof reason?.unknown_reason_code === 'string' ? reason.unknown_reason_code : null;

                    const diffLine =
                      persisted && computed && persisted !== computed ? `Persisted: ${persisted} ➜ Computed: ${computed}` : null;

                    return (
                      <div className={`rounded-md border p-2 ${darkMode ? 'border-white/10 bg-black/10' : 'border-gray-200 bg-white'}`}>
                        <div className={`text-sm font-medium ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>Segment provenance</div>

                        <div className={`mt-1 text-xs ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                          {effective ? <div className="font-medium">Effective: {effective}</div> : null}
                          {isHumanOverride ? (
                            <div className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${darkMode ? 'bg-emerald-500/15 text-emerald-200' : 'bg-emerald-50 text-emerald-700'}`}>
                              Human override
                            </div>
                          ) : null}
                          {source ? <div>Source: {source}</div> : null}
                          {persisted ? <div>Persisted: {persisted}</div> : null}
                          {computed ? <div>Computed: {computed}</div> : null}
                          {diffLine ? <div className="mt-1">{diffLine}</div> : null}
                        </div>

                        {isHumanOverride && isLiveBackend() ? (
                          <div className="mt-2">
                            <Button
                              size="sm"
                              variant={darkMode ? 'secondary' : 'outline'}
                              disabled={visualDetailLoading}
                              onClick={async () => {
                                try {
                                  setVisualDetailLoading(true);
                                  setVisualDetailError(null);
                                  await apiDeleteVisualAssetSegmentOverride(selection.visual_asset_id);
                                  await refresh();
                                } catch (e) {
                                  setVisualDetailError(e instanceof Error ? e.message : 'Failed to revert override');
                                } finally {
                                  setVisualDetailLoading(false);
                                }
                              }}
                            >
                              Revert to computed
                            </Button>
                          </div>
                        ) : null}

                        {(bestScore || threshold || topScores.length > 0 || unknownReasonCode) ? (
                          <div className={`mt-2 text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                            {bestScore ? <div>Best score: {bestScore}</div> : null}
                            {threshold ? <div>Threshold: {threshold}</div> : null}
                            {topScores.length > 0 ? (
                              <div>
                                Top scores: {topScores.map((t) => `${t.seg} ${t.score}`).join(' · ')}
                              </div>
                            ) : null}
                            {unknownReasonCode ? <div>Unknown reason: {unknownReasonCode}</div> : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  })()}

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
                          <button
                            type="button"
                            className="block"
                            onClick={() => setInspectorImageModal({ src: rfImgSrc, title: 'Lineage image' })}
                            aria-label="Open image"
                          >
                            <div className="w-[240px] max-w-full">
                              <img
                                src={rfImgSrc}
                                alt="Visual asset"
                                className={`w-full max-h-[160px] object-contain rounded-md border cursor-zoom-in ${darkMode ? 'border-white/10' : 'border-gray-200'}`}
                              />
                            </div>
                          </button>
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
                          const imgSrc = resolveApiAssetUrl(selectedVisual.image_uri ?? null);
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

                                  <div className="relative w-[240px] max-w-full">
                                    <button
                                      type="button"
                                      className="block w-full"
                                      onClick={() => setInspectorImageModal({ src: imgSrc, title: 'Evidence image' })}
                                      aria-label="Open image"
                                    >
                                      <img
                                        src={imgSrc}
                                        alt="Visual asset crop"
                                        className={`w-full max-h-[180px] object-contain rounded-md border cursor-zoom-in ${darkMode ? 'border-white/10' : 'border-gray-200'}`}
                                        onError={() => setImageLoadError(true)}
                                      />
                                    </button>
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
                                (() => {
                                  const extractorVersion = typeof selectedVisual.extractor_version === 'string' ? selectedVisual.extractor_version : '';
                                  const qfSource =
                                    typeof (selectedVisual as any)?.quality_flags?.source === 'string'
                                      ? String((selectedVisual as any).quality_flags.source)
                                      : '';
                                  const isStructuredNative =
                                    extractorVersion.toLowerCase() === 'structured_native_v1' ||
                                    qfSource.toLowerCase().startsWith('structured_') ||
                                    (selectedVisual.structured_json != null && !selectedVisual.image_uri);

                                  if (!isStructuredNative) {
                                    return (
                                      <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                                        No image crop available for this asset yet.
                                      </div>
                                    );
                                  }

                                  return (
                                    <div
                                      className={`rounded-md border px-3 py-2 text-xs ${
                                        darkMode
                                          ? 'border-white/10 bg-white/5 text-gray-300'
                                          : 'border-gray-200 bg-gray-50 text-gray-700'
                                      }`}
                                    >
                                      <div className={`font-medium ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                                        Structured item (no page crop)
                                      </div>
                                      <div className="mt-0.5 opacity-80">
                                        This asset was extracted from structured document content (e.g., Office tables/text), so it may not have an image crop.
                                      </div>
                                    </div>
                                  );
                                })()
                              )}

                              <div className={`mt-2 text-xs ${darkMode ? 'text-gray-400' : 'text-gray-700'}`}>
                                Page {selectedVisual.page_index != null ? selectedVisual.page_index + 1 : '—'} • {selectedVisual.asset_type ?? 'visual'}
                                {Number.isFinite(selectedVisual.confidence ?? null) ? ` • confidence ${Number(selectedVisual.confidence).toFixed(2)}` : ''}
                              </div>

                              <div className={`mt-1 text-[11px] ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                                Extractor: {selectedVisual.extractor_version || '—'}
                                {selectedVisual.created_at ? ` • extracted ${selectedVisual.created_at}` : ''}
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
                        Evidence: {selectedVisual.evidence?.evidence_count ?? selectedVisual.evidence?.count ?? 0}
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

              {selection.kind === 'visual_asset_group' ? (
                <div className="space-y-2">
                  <div className="text-xs opacity-70">Visual asset group</div>
                  <div className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Group ID: <span className="font-mono">{selection.visual_asset_group_id}</span>
                  </div>
                  {selection.page_label ? (
                    <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>{selection.page_label}</div>
                  ) : null}
                  <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    Members: {typeof selection.count_members === 'number' ? selection.count_members : '—'}
                  </div>

                  {(() => {
                    const rfData = ((selectedRfNode as any)?.data ?? {}) as any;
                    const persisted = typeof rfData.persisted_segment_key === 'string' ? rfData.persisted_segment_key : null;
                    const computed = typeof rfData.computed_segment === 'string' ? rfData.computed_segment : null;
                    const effective =
                      typeof rfData.effective_segment === 'string'
                        ? rfData.effective_segment
                        : typeof rfData.segment === 'string'
                          ? rfData.segment
                          : null;
                    const source =
                      typeof rfData.segment_source === 'string'
                        ? rfData.segment_source
                        : typeof rfData?.quality_flags?.segment_source === 'string'
                          ? rfData.quality_flags.segment_source
                          : null;
                    const reason = rfData.computed_reason as any;

                    const formatScore = (v: unknown): string | null => {
                      if (typeof v !== 'number' || !Number.isFinite(v)) return null;
                      const pct = v <= 1 ? v * 100 : v;
                      return `${Math.round(pct)}%`;
                    };

                    const topScores = (() => {
                      const raw = reason?.top_scores;
                      if (!Array.isArray(raw)) return [];
                      const cleaned = raw
                        .map((row: any) => {
                          const seg = typeof row?.segment === 'string' ? row.segment : typeof row?.key === 'string' ? row.key : null;
                          const score = formatScore(row?.score);
                          if (!seg || !score) return null;
                          return { seg, score };
                        })
                        .filter(Boolean) as Array<{ seg: string; score: string }>;
                      return cleaned.slice(0, 3);
                    })();

                    const isOcrInferred = typeof source === 'string' && source.toLowerCase().startsWith('inferred_ocr');

                    const summary = typeof rfData.structured_summary === 'string' ? rfData.structured_summary : null;
                    const evidenceSnippets = Array.isArray(rfData.evidence_snippets)
                      ? (rfData.evidence_snippets as unknown[]).filter((s) => typeof s === 'string' && s.trim().length > 0) as string[]
                      : [];
                    const rfUnderstanding = rfData.page_understanding as any;

                    if (!persisted && !computed && !effective && !summary && evidenceSnippets.length === 0 && rfData.structured_json == null) return null;

                    return (
                      <>
                        <div className="space-y-2">
                          <div className={`text-sm font-medium ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>Node Understanding</div>

                          {typeof rfUnderstanding?.summary === 'string' && rfUnderstanding.summary.trim() ? (
                            <div className={`text-xs ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{rfUnderstanding.summary}</div>
                          ) : (
                            <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>No summary available</div>
                          )}

                          {Array.isArray(rfUnderstanding?.key_points) && rfUnderstanding.key_points.length > 0 ? (
                            <div className="space-y-1">
                              <div className={`text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Key points</div>
                              <ul className={`list-disc pl-5 text-xs space-y-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                {rfUnderstanding.key_points.slice(0, 8).map((kp: any, idx: number) => (
                                  <li key={`g-kp-${idx}`}>{String(kp)}</li>
                                ))}
                              </ul>
                            </div>
                          ) : null}

                          {Array.isArray(rfUnderstanding?.extracted_signals) && rfUnderstanding.extracted_signals.length > 0 ? (
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
                                    {rfUnderstanding.extracted_signals.slice(0, 12).map((sig: any, idx: number) => (
                                      <tr key={`g-sig-${idx}`} className={darkMode ? 'border-t border-white/5' : 'border-t border-gray-100'}>
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
                            {Array.isArray(rfUnderstanding?.score_contributions) && rfUnderstanding.score_contributions.length > 0 ? (
                              <ul className={`list-disc pl-5 text-xs space-y-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                {rfUnderstanding.score_contributions.slice(0, 8).map((sc: any, idx: number) => (
                                  <li key={`g-sc-${idx}`}>
                                    <span className="font-medium">{String(sc?.driver ?? 'Driver')}</span>
                                    {typeof sc?.delta === 'number' ? ` · Δ ${sc.delta}` : ''}
                                    {sc?.rationale ? ` — ${String(sc.rationale)}` : ''}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>No scoring contribution yet</div>
                            )}
                          </div>
                        </div>

                        {persisted || computed || effective ? (
                          <div className={`rounded-md border p-2 ${darkMode ? 'border-white/10 bg-black/10' : 'border-gray-200 bg-white'}`}>
                            <div className={`text-sm font-medium ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>Segment provenance</div>
                            <div className={`mt-1 text-xs ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                              {effective ? <div className="font-medium">Effective: {effective}</div> : null}
                              {isOcrInferred ? (
                                <div className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${darkMode ? 'bg-amber-500/15 text-amber-200' : 'bg-amber-50 text-amber-700'}`}>
                                  OCR-inferred hint (not trusted)
                                </div>
                              ) : null}
                              {source ? <div>Source: {source}</div> : null}
                              {persisted ? <div>Persisted: {persisted}</div> : null}
                              {computed ? <div>Computed: {computed}</div> : null}
                              {(() => {
                                const best = formatScore(reason?.best_score);
                                const threshold = formatScore(reason?.threshold);
                                if (!best && !threshold) return null;
                                return <div className="mt-1">Best: {best ?? '—'} · Threshold: {threshold ?? '—'}</div>;
                              })()}
                              {topScores.length > 0 ? (
                                <div className={`mt-1 text-[11px] ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                  Top: {topScores.map((t) => `${t.seg} ${t.score}`).join(' · ')}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        ) : null}

                        {summary ? (
                          <details>
                            <summary className={`cursor-pointer text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Captured text</summary>
                            <pre className={`mt-2 whitespace-pre-wrap text-xs rounded-md p-2 border ${darkMode ? 'border-white/10 bg-black/20 text-gray-200' : 'border-gray-200 bg-gray-50 text-gray-800'}`}>
                              {summary}
                            </pre>
                          </details>
                        ) : null}

                        {evidenceSnippets.length > 0 ? (
                          <details>
                            <summary className={`cursor-pointer text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Evidence snippets</summary>
                            <ul className={`mt-2 list-disc pl-5 text-sm space-y-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                              {evidenceSnippets.slice(0, 8).map((s, idx) => (
                                <li key={`g-snip-${idx}`}>{s}</li>
                              ))}
                            </ul>
                          </details>
                        ) : null}

                        {rfData.structured_json != null ? (
                          <details>
                            <summary className={`cursor-pointer text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Structured JSON</summary>
                            <pre className={`mt-2 whitespace-pre-wrap text-xs rounded-md p-2 border ${darkMode ? 'border-white/10 bg-black/20 text-gray-200' : 'border-gray-200 bg-gray-50 text-gray-800'}`}>
                              {safeJson(rfData.structured_json)}
                            </pre>
                          </details>
                        ) : null}

                        {rfData.quality_flags != null ? (
                          <details>
                            <summary className={`cursor-pointer text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Quality flags</summary>
                            <pre className={`mt-2 whitespace-pre-wrap text-xs rounded-md p-2 border ${darkMode ? 'border-white/10 bg-black/20 text-gray-200' : 'border-gray-200 bg-gray-50 text-gray-800'}`}>
                              {safeJson(rfData.quality_flags)}
                            </pre>
                          </details>
                        ) : null}
                      </>
                    );
                  })()}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <Modal
        isOpen={inspectorImageModal != null}
        onClose={() => setInspectorImageModal(null)}
        title={inspectorImageModal?.title ?? 'Image'}
        size="xl"
        darkMode={darkMode}
      >
        {inspectorImageModal?.src ? (
          <div className="flex justify-center">
            <img
              src={inspectorImageModal.src}
              alt={inspectorImageModal.title ?? 'Image'}
              className="max-h-[80vh] max-w-full object-contain rounded-md"
            />
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
