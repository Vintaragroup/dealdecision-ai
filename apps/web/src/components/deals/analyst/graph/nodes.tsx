import { ChevronDown, ChevronRight } from 'lucide-react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { resolveApiAssetUrl } from '../../../../lib/apiClient';
import { getDevtoolsConsoleLoggingEnabled } from '../../tabs/reactflow-devtools';

const __isVitest = Boolean((import.meta as any)?.env?.VITEST);

if (import.meta.env.DEV && typeof window !== 'undefined' && !__isVitest) {
  // DEV-only: prove which file provides the VisualAssetNode renderer.
  // eslint-disable-next-line no-console
  console.log('[VISUAL ASSET RENDERER]', 'apps/web/src/components/deals/analyst/graph/nodes.tsx', import.meta.url);
}

const didLogVisualAssetNodeData = new Set<string>();

type BaseNodeData = {
  label?: string;
  __darkMode?: boolean;
  __node_type?: string;
  __accentColor?: string;
  __accentTint?: string;

  expanded?: boolean;
  descendantCount?: number;
  onToggleExpand?: () => void;

  isIntersecting?: boolean;

  // Optional fields used by the card renderers
  title?: string;
  page_count?: number;
  status?: string;
  lifecycle_status?: string;
  score?: number;
  confidence?: number;
  image_uri?: string;
  summary?: string;
  count?: number;
  sample_snippet?: string;

  // Visual asset enrichment fields (from lineage endpoint)
  page_index?: number;
  asset_type?: string;
  structured_kind?: string;
  structured_summary?: any;
  ocr_text_snippet?: string;
  slide_title?: string | null;
  slide_title_source?: string | null;
  evidence_count?: number;
  evidence_snippets?: string[];
  extraction_confidence?: number;

  // Page understanding enrichment
  page_understanding?: {
    summary?: string | null;
    key_points?: string[];
    extracted_signals?: Array<{ type: string; value: string; unit?: string | null; confidence?: number | null }>;
    score_contributions?: Array<{
      driver: string;
      delta: number;
      rationale: string;
      evidence_ref_ids: string[];
    }>;
  } | null;

  // Analyst segment enrichment
  segment?: string;
  segment_confidence?: number;

  // Slide title enrichment
  slide_title_confidence?: number | null;
  slide_title_warnings?: string[];
  slide_title_debug?: any;
};

function NodeShell(props: {
  darkMode: boolean;
  selected: boolean;
  isIntersecting: boolean;
  accentColor?: string;
  accentTint?: string;
  children: React.ReactNode;
}) {
  const { darkMode, selected, isIntersecting, accentColor, accentTint, children } = props;

  const base = darkMode
    ? 'bg-white/5 border-white/10 text-gray-200'
    : 'bg-white border-gray-200 text-gray-800';

  const selectedCls = selected ? (darkMode ? 'border-white/30' : 'border-gray-400') : '';
  const intersectCls = isIntersecting ? 'ring-2 ring-red-500/70 border-red-500/60' : '';

  const accentBorderStyle = accentColor ? { borderColor: accentColor } : undefined;

  return (
    <div
      className={`relative rounded-lg border shadow-sm overflow-hidden ${base} ${selectedCls} ${intersectCls}`}
      style={accentBorderStyle}
    >
      {accentColor ? (
        <div
          className="absolute inset-y-0 left-0 w-1.5"
          style={{ backgroundColor: accentTint ?? accentColor }}
          aria-hidden
        />
      ) : null}
      {accentColor ? (
        <div
          className="absolute top-1.5 left-2 h-2 w-2 rounded-full"
          style={{ backgroundColor: accentColor }}
          aria-hidden
        />
      ) : null}
      {children}
      {/* Hidden handles so React Flow can attach edges deterministically */}
      <Handle type="target" position={Position.Top} style={{ opacity: 0, pointerEvents: 'none' }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0, pointerEvents: 'none' }} />
    </div>
  );
}

function ExpandToggle(props: { data: BaseNodeData; darkMode: boolean }) {
  const { data, darkMode } = props;
  const hasToggle = typeof data.onToggleExpand === 'function';
  // Some graph states may not provide descendantCount yet; allow toggling whenever a toggle handler exists.
  const canToggle = hasToggle && (data.descendantCount == null || (data.descendantCount ?? 0) > 0);
  if (!canToggle) return null;

  const expanded = Boolean(data.expanded);
  const count = Math.max(0, Math.floor(data.descendantCount ?? 0));

  return (
    <button
      type="button"
      onPointerDown={(e) => {
        // Stop React Flow / pane gestures from capturing the interaction.
        e.stopPropagation();
      }}
      onMouseDown={(e) => {
        e.stopPropagation();
      }}
      onTouchStart={(e) => {
        e.stopPropagation();
      }}
      onClick={(e) => {
        e.stopPropagation();
        data.onToggleExpand?.();
      }}
      className={`nodrag nopan pointer-events-auto relative z-[1000] inline-flex items-center gap-1 rounded-md text-xs select-none px-2 py-1 cursor-pointer ${
        darkMode ? 'bg-white/5 hover:bg-white/10 text-gray-200' : 'bg-gray-50 hover:bg-gray-100 text-gray-700'
      }`}
      style={{ minWidth: 44, minHeight: 36 }}
      aria-label={expanded ? 'Collapse' : 'Expand'}
      title={expanded ? 'Collapse' : 'Expand'}
    >
      {expanded ? (
        <ChevronDown className="w-3.5 h-3.5 pointer-events-none" />
      ) : (
        <ChevronRight className="w-3.5 h-3.5 pointer-events-none" />
      )}
      {!expanded && count > 0 ? <span className="opacity-80">+{count}</span> : null}
    </button>
  );
}

export function DealNode({ data, selected }: NodeProps) {
  const d = (data ?? {}) as BaseNodeData;
  const darkMode = Boolean(d.__darkMode);
  const label = typeof d.label === 'string' ? d.label : 'Deal';

  const lifecycle = typeof d.lifecycle_status === 'string' ? String(d.lifecycle_status) : null;
  const score = typeof d.score === 'number' && Number.isFinite(d.score) ? d.score : null;

  return (
    <NodeShell
      darkMode={darkMode}
      selected={selected}
      isIntersecting={Boolean(d.isIntersecting)}
      accentColor={d.__accentColor}
      accentTint={d.__accentTint}
    >
      <div className="px-3 py-2" style={{ minWidth: 240 }}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-xs uppercase tracking-wide opacity-70">Deal</div>
            <div className="text-sm font-medium leading-snug line-clamp-2">{label}</div>
            <div className="text-xs opacity-70 mt-1">
              {lifecycle ? lifecycle : '—'}
              {score != null ? ` · score ${score}` : ''}
            </div>
          </div>
          <ExpandToggle data={d} darkMode={darkMode} />
        </div>
      </div>
    </NodeShell>
  );
}

export function DocumentNode({ data, selected }: NodeProps) {
  const d = (data ?? {}) as BaseNodeData;
  const darkMode = Boolean(d.__darkMode);
  const label = typeof d.title === 'string' ? d.title : typeof d.label === 'string' ? d.label : 'Document';
  const pages = typeof d.page_count === 'number' ? d.page_count : null;
  const status = typeof d.status === 'string' ? String(d.status) : null;

  return (
    <NodeShell
      darkMode={darkMode}
      selected={selected}
      isIntersecting={Boolean(d.isIntersecting)}
      accentColor={d.__accentColor}
      accentTint={d.__accentTint}
    >
      <div className="px-3 py-2" style={{ minWidth: 260 }}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wide opacity-70">Document</div>
            <div className="text-sm font-medium leading-snug line-clamp-2">{label}</div>
            <div className="text-xs opacity-70 mt-1">
              {pages != null ? `${pages} pages` : '—'}
              {status ? ` · ${status}` : ''}
            </div>
          </div>
          <ExpandToggle data={d} darkMode={darkMode} />
        </div>
      </div>
    </NodeShell>
  );
}

export function SegmentNode({ data, selected }: NodeProps) {
  const d = (data ?? {}) as BaseNodeData;
  const darkMode = Boolean(d.__darkMode);
  const label = typeof d.label === 'string' ? d.label : 'Segment';
  const conf = typeof d.segment_confidence === 'number' && Number.isFinite(d.segment_confidence)
    ? `${Math.round(d.segment_confidence * 100)}%`
    : '—';

  return (
    <NodeShell
      darkMode={darkMode}
      selected={selected}
      isIntersecting={Boolean(d.isIntersecting)}
      accentColor={d.__accentColor}
      accentTint={d.__accentTint}
    >
      <div className="px-3 py-2" style={{ minWidth: 220 }}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wide opacity-70">Segment</div>
            <div className="text-sm font-medium leading-snug line-clamp-2">{label}</div>
            <div className="text-xs opacity-70 mt-1">Confidence: {conf}</div>
          </div>
          <ExpandToggle data={d} darkMode={darkMode} />
        </div>
      </div>
    </NodeShell>
  );
}

export function VisualAssetNode({ id, data, selected }: NodeProps) {
  const d = (data ?? {}) as BaseNodeData;
  const darkMode = Boolean(d.__darkMode);
  const thumb = resolveApiAssetUrl(typeof d.image_uri === 'string' ? d.image_uri : null);

  if (import.meta.env.DEV && getDevtoolsConsoleLoggingEnabled()) {
    const nodeId = typeof id === 'string' ? id : String(id ?? '');
    if (nodeId && !didLogVisualAssetNodeData.has(nodeId)) {
      didLogVisualAssetNodeData.add(nodeId);
      // eslint-disable-next-line no-console
      console.log('[DEV VisualAssetNode data]', {
        node_id: nodeId,
        visual_asset_id: (d as any)?.visual_asset_id,
        structured_kind: (d as any)?.structured_kind,
        structured_summary: (d as any)?.structured_summary,
        evidence0: (d as any)?.evidence_snippets?.[0],
        ocr_text_snippet: (d as any)?.ocr_text_snippet,
      });
    }
  }

  const cleanSnippet = (value: unknown, maxLen = 200): string | null => {
    if (typeof value !== 'string') return null;
    // Preserve newlines but collapse excessive whitespace per line.
    const normalized = value
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join('\n');
    if (!normalized) return null;
    return normalized.length > maxLen ? `${normalized.slice(0, maxLen).trimEnd()}…` : normalized;
  };

  const pageIndex = typeof d.page_index === 'number' && Number.isFinite(d.page_index) ? d.page_index : null;
  const assetType = typeof d.asset_type === 'string' && d.asset_type.trim() ? d.asset_type.trim() : 'unknown';
  const titleFallback = `Page ${pageIndex != null ? pageIndex + 1 : '—'} • ${assetType}`;

  const evidenceCount = typeof d.evidence_count === 'number' && Number.isFinite(d.evidence_count) ? d.evidence_count : 0;
  const confValueRaw =
    typeof d.extraction_confidence === 'number' && Number.isFinite(d.extraction_confidence)
      ? d.extraction_confidence
      : typeof d.confidence === 'number' && Number.isFinite(d.confidence)
        ? d.confidence
        : null;
  const confPercent =
    confValueRaw == null
      ? null
      : // Most pipelines report 0..1; if it looks like percent already, keep it.
        confValueRaw <= 1
        ? confValueRaw * 100
        : confValueRaw;
  const confDisplay = confPercent != null ? `${Math.round(confPercent)}%` : '—';

  const slideTitle = cleanSnippet((d as any)?.slide_title, 160);
  const pageUnderstanding = (d as any)?.page_understanding;
  const firstEvidence = (() => {
    const evidenceSnippets = (d as any)?.evidence_snippets;
    if (!Array.isArray(evidenceSnippets)) return null;
    return cleanSnippet(evidenceSnippets.find((s) => typeof s === 'string' && s.trim().length > 0), 160);
  })();

  const summaryLine = (() => {
    const summary = cleanSnippet(pageUnderstanding?.summary, 200);
    if (summary) return summary;
    if (firstEvidence) return firstEvidence;
    const ocr = cleanSnippet((d as any)?.ocr_text_snippet, 200);
    if (ocr) return ocr;
    return 'No summary available yet';
  })();

  const title = slideTitle || titleFallback;

  return (
    <NodeShell
      darkMode={darkMode}
      selected={selected}
      isIntersecting={Boolean(d.isIntersecting)}
      accentColor={d.__accentColor}
      accentTint={d.__accentTint}
    >
      <div className="px-3 py-2" style={{ width: 280, maxWidth: 280 }}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wide opacity-70">Visual</div>
            <div className="text-sm font-medium leading-snug line-clamp-1">{title}</div>
          </div>
          <ExpandToggle data={d} darkMode={darkMode} />
        </div>

        <div className="mt-2 flex gap-2">
          {thumb ? (
            <div
              className={`h-14 w-14 rounded border overflow-hidden ${
                darkMode ? 'border-white/10 bg-black/20' : 'border-gray-200 bg-gray-50'
              }`}
            >
              <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
            </div>
          ) : null}

          <div className="min-w-0 flex-1">
            <div className="space-y-1">
              <div className="text-xs opacity-90 line-clamp-1 whitespace-pre-line">
                {summaryLine ? summaryLine.slice(0, 120) : ''}
              </div>
            </div>
            <div className="mt-2 flex items-center gap-3 text-xs opacity-70">
              <div>Evidence: {evidenceCount}</div>
              <div>Conf: {confDisplay}</div>
            </div>
          </div>
        </div>
      </div>
    </NodeShell>
  );
}

export function EvidenceNode({ data, selected }: NodeProps) {
  const d = (data ?? {}) as BaseNodeData;
  const darkMode = Boolean(d.__darkMode);
  const label = typeof d.label === 'string' ? d.label : 'Evidence';
  const count = typeof d.count === 'number' ? d.count : null;
  const snippet = typeof d.sample_snippet === 'string' ? d.sample_snippet : null;

  return (
    <NodeShell
      darkMode={darkMode}
      selected={selected}
      isIntersecting={Boolean(d.isIntersecting)}
      accentColor={d.__accentColor}
      accentTint={d.__accentTint}
    >
      <div className="px-3 py-2" style={{ minWidth: 220 }}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wide opacity-70">Evidence</div>
            <div className="text-sm font-medium leading-snug line-clamp-1">{label}</div>
            <div className="text-xs opacity-70 mt-1">{count != null ? `${count} items` : '—'}</div>
          </div>
          <ExpandToggle data={d} darkMode={darkMode} />
        </div>
        {snippet ? <div className="mt-2 text-xs opacity-80 line-clamp-3">“{snippet}”</div> : null}
      </div>
    </NodeShell>
  );
}

export function DefaultNode({ data, selected }: NodeProps) {
  const d = (data ?? {}) as BaseNodeData;
  const darkMode = Boolean(d.__darkMode);
  const label = typeof d.label === 'string' ? d.label : 'Node';

  return (
    <NodeShell darkMode={darkMode} selected={selected} isIntersecting={Boolean(d.isIntersecting)}>
      <div className="px-3 py-2" style={{ minWidth: 200 }}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wide opacity-70">Node</div>
            <div className="text-sm font-medium leading-snug line-clamp-2">{label}</div>
          </div>
          <ExpandToggle data={d} darkMode={darkMode} />
        </div>
      </div>
    </NodeShell>
  );
}

export const analystNodeTypes = {
  // Support both legacy UPPERCASE and current lowercase node.type values.
  DEAL: DealNode,
  deal: DealNode,

  DOCUMENT: DocumentNode,
  document: DocumentNode,

  VISUAL_ASSET: VisualAssetNode,
  visual_asset: VisualAssetNode,

  SEGMENT: SegmentNode,
  segment: SegmentNode,

  EVIDENCE: EvidenceNode,
  evidence: EvidenceNode,

  default: DefaultNode,
} as const;
