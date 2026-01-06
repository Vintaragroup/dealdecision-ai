import { useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type NodeProps,
} from 'reactflow';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '../../ui/button';
import {
  apiGetDealLineage,
  apiGetDocumentVisualAssets,
  isLiveBackend,
  type DealLineageResponse,
  type DocumentVisualAsset,
} from '../../../lib/apiClient';

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

function resolveImageSrc(imageUri: string | null): string | null {
  if (!imageUri) return null;
  const trimmed = imageUri.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  if (trimmed.startsWith('/')) {
    const apiBase = import.meta.env.VITE_API_BASE_URL || 'http://localhost:9000';
    return `${apiBase}${trimmed}`;
  }
  return null;
}

function buildLayout(lineage: DealLineageResponse, darkMode: boolean): { nodes: Node[]; edges: Edge[] } {
  const byId = new Map<string, any>();
  for (const n of lineage.nodes || []) byId.set(n.id, n);

  const edges: Edge[] = (lineage.edges || []).map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    animated: false,
    style: darkMode ? { stroke: 'rgba(255,255,255,0.2)' } : { stroke: 'rgba(17,24,39,0.25)' },
  }));

  const dealNode = (lineage.nodes || []).find((n) => n.type === 'deal') ?? lineage.nodes?.[0];
  const dealNodeId = typeof dealNode?.id === 'string' ? dealNode.id : `deal:${lineage.deal_id}`;

  const docEdgeTargets = edges
    .filter((e) => e.source === dealNodeId)
    .map((e) => e.target);

  const docIds = docEdgeTargets.length > 0
    ? docEdgeTargets
    : (lineage.nodes || []).filter((n) => n.type === 'document').map((n) => n.id);

  const visualByDoc = new Map<string, string[]>();
  for (const e of edges) {
    const src = byId.get(e.source);
    const tgt = byId.get(e.target);
    if (src?.type === 'document' && tgt?.type === 'visual_asset') {
      const list = visualByDoc.get(e.source) ?? [];
      list.push(e.target);
      visualByDoc.set(e.source, list);
    }
  }

  const evidenceByVa = new Map<string, string[]>();
  for (const e of edges) {
    const src = byId.get(e.source);
    const tgt = byId.get(e.target);
    if (src?.type === 'visual_asset' && tgt?.type === 'evidence') {
      const list = evidenceByVa.get(e.source) ?? [];
      list.push(e.target);
      evidenceByVa.set(e.source, list);
    }
  }

  const positioned = new Map<string, { x: number; y: number }>();

  positioned.set(dealNodeId, { x: 0, y: 0 });

  const docX = 260;
  const vaX = 560;
  const evX = 820;
  const docGapY = 170;
  const vaGapY = 130;

  let globalMaxY = 0;
  for (let i = 0; i < docIds.length; i++) {
    const docId = docIds[i];
    const docY = i * docGapY;
    positioned.set(docId, { x: docX, y: docY });
    globalMaxY = Math.max(globalMaxY, docY);

    const vaIds = visualByDoc.get(docId) ?? [];
    for (let j = 0; j < vaIds.length; j++) {
      const vaId = vaIds[j];
      const vaY = docY + j * vaGapY;
      positioned.set(vaId, { x: vaX, y: vaY });
      globalMaxY = Math.max(globalMaxY, vaY);

      const evIds = evidenceByVa.get(vaId) ?? [];
      for (let k = 0; k < evIds.length; k++) {
        const evId = evIds[k];
        positioned.set(evId, { x: evX, y: vaY });
        globalMaxY = Math.max(globalMaxY, vaY);
      }
    }
  }

  const nodes: Node[] = (lineage.nodes || []).map((raw) => {
    const pos = positioned.get(raw.id) ?? { x: docX, y: globalMaxY + docGapY };
    return {
      id: raw.id,
      type: raw.type || 'default',
      position: pos,
      data: {
        ...(raw.data ?? {}),
        label: (raw.data as any)?.label ?? raw.id,
        __node_type: raw.type ?? 'unknown',
        __darkMode: darkMode,
      },
      draggable: false,
      selectable: true,
    };
  });

  return { nodes, edges };
}

function AnalystNode({ data, selected }: NodeProps) {
  const darkMode = Boolean((data as any)?.__darkMode);
  const nodeType = String((data as any)?.__node_type ?? '');

  const base = darkMode
    ? 'bg-white/5 border-white/10 text-gray-200'
    : 'bg-white border-gray-200 text-gray-800';

  const selectedCls = selected
    ? (darkMode ? 'border-white/30' : 'border-gray-400')
    : '';

  const label = typeof (data as any)?.label === 'string' ? (data as any).label : String((data as any)?.label ?? 'Node');

  const meta = (() => {
    if (nodeType === 'document') {
      const pages = typeof (data as any)?.page_count === 'number' ? (data as any).page_count : null;
      return pages != null ? `${pages} pages` : null;
    }
    if (nodeType === 'visual_asset') {
      const conf = typeof (data as any)?.confidence === 'number' ? (data as any).confidence : null;
      return conf != null ? `conf ${(conf * 100).toFixed(0)}%` : null;
    }
    if (nodeType === 'evidence') {
      const c = typeof (data as any)?.count === 'number' ? (data as any).count : null;
      return c != null ? `${c} items` : null;
    }
    return null;
  })();

  return (
    <div className={`rounded-lg border px-3 py-2 shadow-sm ${base} ${selectedCls}`} style={{ minWidth: 180 }}>
      <div className="text-xs uppercase tracking-wide opacity-70">{nodeType || 'node'}</div>
      <div className="text-sm font-medium leading-snug">{label}</div>
      {meta ? <div className="text-xs opacity-70 mt-1">{meta}</div> : null}
    </div>
  );
}

export function DealAnalystTab({ dealId, darkMode }: DealAnalystTabProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [lineage, setLineage] = useState<DealLineageResponse | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const [selection, setSelection] = useState<InspectorSelection>({ kind: 'none' });
  const [visualDetailLoading, setVisualDetailLoading] = useState(false);
  const [visualDetailError, setVisualDetailError] = useState<string | null>(null);
  const [selectedVisual, setSelectedVisual] = useState<DocumentVisualAsset | null>(null);

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

  const docAssetCacheRef = useRef(new Map<string, DocumentVisualAsset[]>());

  const refresh = async () => {
    if (!dealId || !isLiveBackend()) return;

    setLoading(true);
    setError(null);
    setVisualDetailError(null);
    setSelectedVisual(null);

    try {
      const res = await apiGetDealLineage(dealId);
      setLineage(res);
      setWarnings(Array.isArray(res?.warnings) ? res.warnings : []);
      setSelection({ kind: 'none' });
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

  const rf = useMemo(() => {
    if (!lineage) return { nodes: [] as Node[], edges: [] as Edge[] };
    return buildLayout(lineage, darkMode);
  }, [lineage, darkMode]);

  const nodeTypes = useMemo(
    () => ({
      deal: AnalystNode,
      document: AnalystNode,
      visual_asset: AnalystNode,
      evidence: AnalystNode,
      default: AnalystNode,
    }),
    []
  );

  const hasVisuals = useMemo(() => {
    return Boolean(lineage?.nodes?.some((n) => n.type === 'visual_asset'));
  }, [lineage]);

  const loadVisualDetails = async (documentId: string, visualAssetId: string) => {
    if (!dealId || !documentId || !visualAssetId) return;

    setVisualDetailLoading(true);
    setVisualDetailError(null);
    setSelectedVisual(null);

    try {
      const cached = docAssetCacheRef.current.get(documentId);
      const assets = cached ?? (await apiGetDocumentVisualAssets(dealId, documentId)).visual_assets;
      if (!cached) docAssetCacheRef.current.set(documentId, assets);

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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className={`lg:col-span-2 rounded-lg border overflow-hidden ${darkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-white'}`}>
          <div className="h-[600px]">
            <ReactFlow
              nodes={rf.nodes}
              edges={rf.edges}
              nodeTypes={nodeTypes as any}
              fitView
              onNodeClick={(_, node) => {
                const data = (node as any)?.data ?? {};
                const t = String(data.__node_type ?? node.type ?? '');

                if (t === 'deal') {
                  setSelection({ kind: 'deal', deal_id: String(data.deal_id ?? dealId), name: (data.name as any) ?? null });
                  setSelectedVisual(null);
                  setVisualDetailError(null);
                  return;
                }

                if (t === 'document') {
                  setSelection({
                    kind: 'document',
                    document_id: String(data.document_id ?? ''),
                    title: typeof data.title === 'string' ? data.title : undefined,
                    type: typeof data.type === 'string' ? data.type : undefined,
                    page_count: typeof data.page_count === 'number' ? data.page_count : undefined,
                  });
                  setSelectedVisual(null);
                  setVisualDetailError(null);
                  return;
                }

                if (t === 'visual_asset') {
                  const document_id = String(data.document_id ?? '');
                  const visual_asset_id = String(data.visual_asset_id ?? '');
                  setSelection({ kind: 'visual_asset', document_id, visual_asset_id });
                  loadVisualDetails(document_id, visual_asset_id);
                  return;
                }

                if (t === 'evidence') {
                  const visual_asset_id = String(data.visual_asset_id ?? '');
                  const count = typeof data.count === 'number' ? data.count : undefined;
                  setSelection({ kind: 'evidence', visual_asset_id, count });
                  setSelectedVisual(null);
                  setVisualDetailError(null);
                  return;
                }

                setSelection({ kind: 'none' });
              }}
            >
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

        <div className={`rounded-lg border p-4 ${darkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-white'}`}>
          <div className={`text-sm font-medium mb-2 ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>Inspector</div>

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

              {visualDetailLoading ? (
                <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Loading details…</div>
              ) : null}
              {visualDetailError ? (
                <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>{visualDetailError}</div>
              ) : null}

              {selectedVisual ? (
                <>
                  {resolveImageSrc(selectedVisual.image_uri) ? (
                    <img
                      src={resolveImageSrc(selectedVisual.image_uri) as string}
                      alt="Visual asset"
                      className={`w-full rounded-md border ${darkMode ? 'border-white/10' : 'border-gray-200'}`}
                    />
                  ) : (
                    <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                      Preview not available (image_uri: {selectedVisual.image_uri ?? '—'}).
                    </div>
                  )}

                  <div className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Page: {selectedVisual.page_index + 1} · Type: {selectedVisual.asset_type}
                    {Number.isFinite(selectedVisual.confidence) ? ` · Confidence: ${(selectedVisual.confidence * 100).toFixed(0)}%` : ''}
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
      </div>
    </div>
  );
}
