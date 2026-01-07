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
import {
  DealNode,
  DefaultNode,
  DocumentNode,
  EvidenceNode,
  SegmentNode,
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
  | { kind: 'evidence'; visual_asset_id: string; count?: number };

type StructuredViewMode = 'preview' | 'raw';

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

function normalizeLineageNodeType(raw: any): 'deal' | 'document' | 'segment' | 'visual_asset' | 'evidence' | 'default' {
  const t0 = String(raw?.type ?? raw?.node_type ?? '').trim();
  const t = t0.toLowerCase();
  if (t === 'deal') return 'deal';
  if (t === 'document') return 'document';
  if (t === 'segment') return 'segment';
  if (t === 'visual_asset' || t === 'visual asset') return 'visual_asset';
  if (t === 'evidence') return 'evidence';
  return 'default';
}

function getLineageNodeId(raw: any): string {
  const id = raw?.node_id ?? raw?.id;
  return typeof id === 'string' && id.trim().length > 0 ? id : '';
}

let didLogVisualAssetNodeTypes = false;

function buildFullGraphFromLineage(lineage: DealLineageResponse): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // DEV-only: verify lineage-enriched visual_asset fields survive mapping into React Flow nodes.
  let didLogLineageVisualAssetMapping = false;

  for (let idx = 0; idx < (lineage.nodes || []).length; idx++) {
    const raw = (lineage.nodes || [])[idx] as any;
    const nodeType = normalizeLineageNodeType(raw);
    const id = getLineageNodeId(raw) || `unknown:${nodeType}:${idx}`;
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
    } as Edge);
  }

  return { nodes, edges };
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

  const [nodes, setNodes, onNodesChange] = useNodesState([] as Node[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[]);

  const { logNodesChange, logEdgesChange } = useReactFlowChangeLogger(devtoolsEnabled);

  const relayoutScheduledRef = useRef(false);
  const hasMeasuredDimensionsRef = useRef(false);
  const lastFitCountsRef = useRef({ nodes: 0, edges: 0 });

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

  const renderedEdges = useMemo(() => {
    return visible.visibleEdges.map((e) => ({
      ...e,
      type: 'floating',
      animated: false,
      style: darkMode ? { stroke: 'rgba(255,255,255,0.2)' } : { stroke: 'rgba(17,24,39,0.25)' },
    } as Edge));
  }, [visible.visibleEdges, darkMode]);

  const renderedNodesUnlaid = useMemo(() => {
    const toggle = (id: string) => {
      setExpandedById((prev) => {
        const node = fullGraph?.nodes.find((n) => n.id === id);
        const cur = prev[id] ?? (node ? defaultExpandedForNode(node) : true);
        return { ...prev, [id]: !cur };
      });
    };

    return visible.visibleNodes.map((n) => {
      const baseNode = fullGraph?.nodes.find((bn) => bn.id === n.id);
      const stableType = String((baseNode as any)?.type ?? (n as any)?.type ?? 'default').trim().toLowerCase();
      const expanded = expandedById[n.id] ?? defaultExpandedForNode(n);
      const descendantCount = visible.descendantCountsById[n.id] ?? 0;
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
        },
      } as Node;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible.visibleNodes, visible.descendantCountsById, expandedById, darkMode, fullGraph]);

  const renderedNodes = useMemo(() => {
    // Re-run layout when lineage loads, when expansion changes, or on explicit re-layout.
    void layoutNonce;
    // Switch to left-to-right layout (LR) to avoid vertical cascading. Slightly tighten rank spacing for horizontal flow.
    return layoutGraph(renderedNodesUnlaid, renderedEdges, { direction: 'LR', ranksep: 140, nodesep: 120 });
  }, [renderedNodesUnlaid, renderedEdges, layoutNonce]);

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

  // After collapse/expand changes the visible graph, keep something on-screen.
  useEffect(() => {
    if (!rfInstance) return;
    const counts = { nodes: visible.visibleNodes.length, edges: visible.visibleEdges.length };
    const prev = lastFitCountsRef.current;
    const shouldFit = (prev.nodes === 0 && counts.nodes > 0) || counts.nodes !== prev.nodes || counts.edges !== prev.edges;
    if (!shouldFit) return;
    lastFitCountsRef.current = counts;

    const t = setTimeout(() => {
      try {
        rfInstance.fitView({ padding: 0.2, duration: 120 });
      } catch {
        // ignore
      }
    }, 40);
    return () => clearTimeout(t);
  }, [rfInstance, visible.visibleNodes.length, visible.visibleEdges.length]);

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
      visual_asset: AnalystVisualAssetNode,
      evidence: EvidenceNode,
      default: DefaultNode,
    }),
    []
  );

  const edgeTypes = useMemo(() => ({ floating: FloatingEdge }), []);

  const hasVisuals = useMemo(() => {
    return Boolean(lineage?.nodes?.some((n) => n.type === 'visual_asset'));
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
              nodes={nodes}
              edges={edges}
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
                    onClick={() => setLayoutNonce((v) => v + 1)}
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
                </div>
              </Panel>
              <MiniMap
                pannable
                zoomable
                nodeColor={(n) => {
                  const t = String((n as any)?.type ?? '');
                  if (darkMode) {
                    if (t === 'deal') return 'rgba(255,255,255,0.6)';
                    if (t === 'document') return 'rgba(255,255,255,0.35)';
                    if (t === 'visual_asset') return 'rgba(99,102,241,0.6)';
                    if (t === 'evidence') return 'rgba(16,185,129,0.55)';
                    return 'rgba(255,255,255,0.25)';
                  }
                  if (t === 'deal') return 'rgba(17,24,39,0.7)';
                  if (t === 'document') return 'rgba(17,24,39,0.35)';
                  if (t === 'visual_asset') return 'rgba(99,102,241,0.6)';
                  if (t === 'evidence') return 'rgba(16,185,129,0.55)';
                  return 'rgba(17,24,39,0.25)';
                }}
              />
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
