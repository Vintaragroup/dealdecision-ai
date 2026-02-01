import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Panel,
  ViewportPortal,
  useNodes,
  useStore,
  useStoreApi,
  type Edge,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react';

export type DevtoolsSelection = {
  enabled: boolean;
  selectedNodeId: string | null;
  selectedKind: string;
};

export function getReactFlowDevtoolsEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).get('devtools') === '1';
  } catch {
    return false;
  }
}

// Gates *console logging only* (overlay enablement is controlled separately).
export function getDevtoolsConsoleLoggingEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).get('rf_log') === '1';
  } catch {
    return false;
  }
}

export function useReactFlowChangeLogger(enabled: boolean): {
  lastNodesChange: string | null;
  lastEdgesChange: string | null;
  logNodesChange: (changes: NodeChange[]) => void;
  logEdgesChange: (changes: EdgeChange[]) => void;
} {
  const [lastNodesChange, setLastNodesChange] = useState<string | null>(null);
  const [lastEdgesChange, setLastEdgesChange] = useState<string | null>(null);

  const lastNodesConsolePayloadRef = useRef<string | null>(null);
  const lastEdgesConsolePayloadRef = useRef<string | null>(null);
  const lastNodesConsoleTsRef = useRef<number>(0);
  const lastEdgesConsoleTsRef = useRef<number>(0);

  const logNodesChange = (changes: NodeChange[]) => {
    if (!enabled) return;
    const payload = safeStringify(changes);
    setLastNodesChange(payload);

    if (!getDevtoolsConsoleLoggingEnabled()) return;
    const now = Date.now();
    if (payload === lastNodesConsolePayloadRef.current) return;
    if (now - lastNodesConsoleTsRef.current < 300) return;

    lastNodesConsolePayloadRef.current = payload;
    lastNodesConsoleTsRef.current = now;
    // eslint-disable-next-line no-console
    console.log('[reactflow devtools] onNodesChange', payload);
  };

  const logEdgesChange = (changes: EdgeChange[]) => {
    if (!enabled) return;
    const payload = safeStringify(changes);
    setLastEdgesChange(payload);

    if (!getDevtoolsConsoleLoggingEnabled()) return;
    const now = Date.now();
    if (payload === lastEdgesConsolePayloadRef.current) return;
    if (now - lastEdgesConsoleTsRef.current < 300) return;

    lastEdgesConsolePayloadRef.current = payload;
    lastEdgesConsoleTsRef.current = now;
    // eslint-disable-next-line no-console
    console.log('[reactflow devtools] onEdgesChange', payload);
  };

  return { lastNodesChange, lastEdgesChange, logNodesChange, logEdgesChange };
}

function safeStringify(value: unknown, maxLen = 2200): string {
  let s = '';
  try {
    s = JSON.stringify(value);
  } catch {
    s = String(value);
  }
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen)}…`;
}

function pruneForDisplay(value: unknown, depth: number, caps: { maxKeys: number; maxItems: number }): unknown {
  if (depth <= 0) {
    if (Array.isArray(value)) return `[Array(${value.length})]`;
    if (value && typeof value === 'object') return '[Object]';
    return value;
  }

  if (Array.isArray(value)) {
    const out: unknown[] = [];
    const n = Math.min(value.length, caps.maxItems);
    for (let i = 0; i < n; i++) out.push(pruneForDisplay(value[i], depth - 1, caps));
    if (value.length > n) out.push(`… +${value.length - n} more`);
    return out;
  }

  if (!value || typeof value !== 'object') return value;

  const entries = Object.entries(value as Record<string, unknown>);
  const out: Record<string, unknown> = {};
  const n = Math.min(entries.length, caps.maxKeys);
  for (let i = 0; i < n; i++) {
    const [k, v] = entries[i];
    out[k] = pruneForDisplay(v, depth - 1, caps);
  }
  if (entries.length > n) out.__more_keys__ = entries.length - n;
  return out;
}

function safePrettyJson(value: unknown, maxLen = 1800): string {
  let s = '';
  try {
    const pruned = pruneForDisplay(value, 3, { maxKeys: 80, maxItems: 50 });
    s = JSON.stringify(pruned, null, 2);
  } catch {
    s = String(value);
  }
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen)}\n… (truncated)`;
}

function formatTransform(transform: [number, number, number]): string {
  const [x, y, zoom] = transform;
  const f = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : String(n));
  return `x=${f(x)} y=${f(y)} zoom=${f(zoom)}`;
}

type OverlayProps = {
  enabled: boolean;
  darkMode: boolean;
  selection: DevtoolsSelection;
};

export function ReactFlowDevToolsOverlay(props: OverlayProps) {
  const { enabled, darkMode, selection } = props;

  const transform = useStore((s) => s.transform);
  const nodes = useNodes();
  const edges = useStore((s) => s.edges) as Edge[];
  const storeApi = useStoreApi();

  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; startOffsetX: number; startOffsetY: number } | null>(null);

  const selectedNode = useMemo(() => {
    if (!selection.selectedNodeId) return null;
    const fromPublic = nodes.find((n) => n.id === selection.selectedNodeId) ?? null;
    if (fromPublic) return fromPublic;
    const stateAny = storeApi.getState() as any;
    const fromStateArray = Array.isArray(stateAny?.nodes)
      ? (stateAny.nodes as any[]).find((n) => n?.id === selection.selectedNodeId) ?? null
      : null;
    return fromStateArray;
  }, [selection.selectedNodeId, nodes, storeApi]);

  const selectedNodeSummary = useMemo(() => {
    if (!selection.selectedNodeId) return null;

    // Prefer public node for type/data.
    const t = selectedNode ? String((selectedNode as any)?.type ?? (selectedNode as any)?.data?.__node_type ?? '') : '';
    const p = (selectedNode as any)?.position;

    const stateAny = storeApi.getState() as any;
    const internal = stateAny?.nodeLookup?.get?.(selection.selectedNodeId);
    const internalPos =
      internal?.internals?.positionAbsolute ??
      internal?.positionAbsolute ??
      internal?.internals?.position ??
      internal?.position;

    const x = (internalPos?.x ?? p?.x) as unknown;
    const y = (internalPos?.y ?? p?.y) as unknown;
    const w = internal?.measured?.width ?? internal?.width;
    const h = internal?.measured?.height ?? internal?.height;

    return {
      id: selection.selectedNodeId,
      type: t,
      pos: typeof x === 'number' && typeof y === 'number' ? `(${x.toFixed(1)}, ${y.toFixed(1)})` : null,
      size:
        typeof w === 'number' && typeof h === 'number'
          ? `(${Math.round(w)}×${Math.round(h)})`
          : null,
    };
  }, [selection.selectedNodeId, selectedNode, storeApi]);

  const selectedNodeDetailsText = useMemo(() => {
    if (!selection.selectedNodeId) return null;
    const stateAny = storeApi.getState() as any;
    const internal = stateAny?.nodeLookup?.get?.(selection.selectedNodeId);

    const positionAbsolute =
      internal?.internals?.positionAbsolute ??
      internal?.positionAbsolute ??
      internal?.internals?.position ??
      internal?.position;

    const details = {
      id: selection.selectedNodeId,
      // Always include public node details (most useful for debugging app state).
      public: selectedNode
        ? {
            id: (selectedNode as any)?.id,
            type: (selectedNode as any)?.type,
            position: (selectedNode as any)?.position,
            data: (selectedNode as any)?.data,
          }
        : null,
      // Include internal details when available (useful for measured sizes / absolute positions).
      internal: internal
        ? {
            id: internal?.id,
            type: internal?.type,
            selected: internal?.selected,
            positionAbsolute,
            measured: internal?.measured,
          }
        : null,
    };

    return safePrettyJson(details, 3200);
  }, [selection.selectedNodeId, selectedNode, storeApi]);

  // ViewportLogger pattern
  useEffect(() => {
    if (!enabled) return;
    if (!getDevtoolsConsoleLoggingEnabled()) return;
    // eslint-disable-next-line no-console
    console.log('[reactflow devtools] viewport', transform);
  }, [enabled, transform]);

  // Node/edge counts
  useEffect(() => {
    if (!enabled) return;
    if (!getDevtoolsConsoleLoggingEnabled()) return;
    // eslint-disable-next-line no-console
    console.log('[reactflow devtools] counts', { nodes: nodes.length, edges: edges.length });
  }, [enabled, nodes.length, edges.length]);

  // Selected (from external selection state)
  useEffect(() => {
    if (!enabled) return;
    if (!getDevtoolsConsoleLoggingEnabled()) return;
    // eslint-disable-next-line no-console
    console.log('[reactflow devtools] selection', {
      kind: selection.selectedKind,
      nodeId: selection.selectedNodeId,
    });
  }, [enabled, selection.selectedKind, selection.selectedNodeId]);

  if (!enabled) return null;

  const shell = darkMode
    ? 'bg-black/70 border-white/15 text-gray-100'
    : 'bg-white/90 border-gray-200 text-gray-900';

  const mono = darkMode ? 'text-gray-200' : 'text-gray-800';
  const subtle = darkMode ? 'text-gray-400' : 'text-gray-600';

  return (
    <Panel position="top-left" className="pointer-events-auto">
      <div
        className={`max-w-[240px] max-h-[300px] rounded-lg border overflow-hidden ${shell}`}
        style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
        onPointerDown={(e) => {
          // Prevent pane panning / node clicks from starting under the overlay.
          e.stopPropagation();
        }}
        onWheel={(e) => {
          // Prevent scroll-zoom when wheel is over the overlay.
          e.stopPropagation();
        }}
      >
        <div
          className={`flex items-center justify-between gap-2 px-3 py-2 border-b ${darkMode ? 'border-white/10' : 'border-gray-200'}`}
          onPointerDown={(e) => {
            // Drag handle (small header only).
            e.preventDefault();
            e.stopPropagation();
            (e.currentTarget as any).setPointerCapture?.(e.pointerId);
            dragRef.current = {
              startX: e.clientX,
              startY: e.clientY,
              startOffsetX: offset.x,
              startOffsetY: offset.y,
            };
          }}
          onPointerMove={(e) => {
            if (!dragRef.current) return;
            e.preventDefault();
            e.stopPropagation();
            const dx = e.clientX - dragRef.current.startX;
            const dy = e.clientY - dragRef.current.startY;
            setOffset({ x: dragRef.current.startOffsetX + dx, y: dragRef.current.startOffsetY + dy });
          }}
          onPointerUp={(e) => {
            if (!dragRef.current) return;
            e.preventDefault();
            e.stopPropagation();
            dragRef.current = null;
          }}
        >
          <div className={`text-xs font-semibold ${mono}`}>React Flow DevTools</div>
          <div className={`text-[10px] ${subtle}`}>drag</div>
        </div>

        <div className="px-3 py-2 space-y-2 max-h-[260px] overflow-auto">
          <div className={`text-[11px] ${subtle}`}>Viewport</div>
          <div className={`text-xs font-mono ${mono}`}>{formatTransform(transform)}</div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className={`text-[11px] ${subtle}`}>Nodes</div>
              <div className={`text-xs font-mono ${mono}`}>{nodes.length}</div>
            </div>
            <div>
              <div className={`text-[11px] ${subtle}`}>Edges</div>
              <div className={`text-xs font-mono ${mono}`}>{edges.length}</div>
            </div>
          </div>

          <div>
            <div className={`text-[11px] ${subtle}`}>Selected (app)</div>
            <div className={`text-xs font-mono ${mono}`}>{selection.selectedNodeId ?? '—'}</div>
            <div className={`text-[11px] ${subtle}`}>Kind</div>
            <div className={`text-xs font-mono ${mono}`}>{selection.selectedKind || '—'}</div>

            {selectedNodeSummary ? (
              <div className={`mt-1 text-[11px] ${subtle}`}>
                {selectedNodeSummary.type ? `type=${selectedNodeSummary.type} ` : ''}
                {selectedNodeSummary.pos ? `pos=${selectedNodeSummary.pos} ` : ''}
                {selectedNodeSummary.size ? `size=${selectedNodeSummary.size}` : ''}
              </div>
            ) : null}
          </div>

          <div>
            <div className={`text-[11px] ${subtle}`}>Selected node details</div>
            <pre className={`max-h-[120px] overflow-auto text-[10px] font-mono whitespace-pre-wrap break-words leading-snug ${mono}`}>{
              selectedNodeDetailsText ?? '—'
            }</pre>
          </div>

        </div>
      </div>
    </Panel>
  );
}

type ViewportBadgeProps = {
  enabled: boolean;
  darkMode: boolean;
  selectedNodeId: string | null;
};

// Renders a tiny in-viewport marker near the currently selected node.
export function ReactFlowViewportBadge(props: ViewportBadgeProps) {
  const { enabled, darkMode, selectedNodeId } = props;

  const pos = useStore(
    (s) => {
      if (!enabled || !selectedNodeId) return null;
      const stateAny = s as any;
      const internal = stateAny?.nodeLookup?.get?.(selectedNodeId);
      const p = internal?.internals?.positionAbsolute ?? internal?.positionAbsolute;
      const w = internal?.measured?.width ?? internal?.width;
      const h = internal?.measured?.height ?? internal?.height;
      if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') return null;
      return {
        x: p.x,
        y: p.y,
        w: typeof w === 'number' ? w : 0,
        h: typeof h === 'number' ? h : 0,
      };
    },
    (a, b) => {
      if (a === b) return true;
      if (!a || !b) return false;
      return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
    }
  );

  if (!enabled || !selectedNodeId || !pos) return null;

  const bg = darkMode ? 'bg-black/70 border-white/20 text-gray-100' : 'bg-white/90 border-gray-200 text-gray-900';

  return (
    <ViewportPortal>
      <div
        className={`pointer-events-none absolute rounded border px-2 py-1 text-[10px] font-mono ${bg}`}
        style={{
          transform: `translate(${Math.round(pos.x + pos.w + 8)}px, ${Math.round(pos.y - 4)}px)`,
        }}
      >
        {selectedNodeId}
      </div>
    </ViewportPortal>
  );
}
