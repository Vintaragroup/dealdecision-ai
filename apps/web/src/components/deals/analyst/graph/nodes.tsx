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
  extractor_version?: string;
  structured_kind?: string;
  structured_summary?: any;
  ocr_text_snippet?: string;
  slide_title?: string | null;
  slide_title_source?: string | null;
  evidence_count?: number;
  evidence_snippets?: string[];
  extraction_confidence?: number;

  // Raw fields sometimes present in lineage payloads
  quality_flags?: any;
  structured_json?: any;

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

  // Visual group enrichment
  count_slides?: number;
  evidence_count_total?: number;
  avg_confidence?: number | null;
  sample_summaries?: string[];
  segment_label?: string;

  // Analyst segment enrichment
  segment?: string;
  segment_confidence?: number;

  // Segment rescore audit enrichment (present only in debug lineage mode)
  persisted_segment_key?: string;
  computed_segment?: string;

  // Slide title enrichment
  slide_title_confidence?: number | null;
  slide_title_warnings?: string[];
  slide_title_debug?: any;
};

function formatConfidencePercent(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  const pct = value <= 1 ? value * 100 : value;
  return `${Math.round(pct)}%`;
}

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
      <div className="px-3 py-2" style={{ width: 320, maxWidth: 320, minWidth: 260 }}>
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

export function VisualGroupNode({ data, selected }: NodeProps) {
  const d = (data ?? {}) as BaseNodeData;
  const darkMode = Boolean(d.__darkMode);
  const label = typeof d.segment_label === 'string' && d.segment_label.trim().length > 0
    ? d.segment_label
    : typeof d.label === 'string'
      ? d.label
      : 'Visual group';

  const slideCount = Number.isFinite(d.count_slides) ? Math.max(0, Math.round(d.count_slides ?? 0)) : null;
  const evidenceTotal = Number.isFinite(d.evidence_count_total)
    ? Math.max(0, Math.round(d.evidence_count_total ?? 0))
    : null;
  const avgConfDisplay = formatConfidencePercent(d.avg_confidence);

  const summaries = Array.isArray(d.sample_summaries)
    ? d.sample_summaries.filter((s) => typeof s === 'string' && s.trim().length > 0).slice(0, 3)
    : [];

  return (
    <NodeShell
      darkMode={darkMode}
      selected={selected}
      isIntersecting={Boolean(d.isIntersecting)}
      accentColor={d.__accentColor}
      accentTint={d.__accentTint}
    >
      <div className="px-3 py-2" style={{ minWidth: 300 }}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wide opacity-70">Visual group</div>
            <div className="text-sm font-medium leading-snug line-clamp-2">{label}</div>
            <div className="text-xs opacity-70 mt-1">
              Slides: {slideCount != null ? slideCount : '—'} · Evidence: {evidenceTotal != null ? evidenceTotal : '—'} · Avg conf: {avgConfDisplay}
            </div>
          </div>
          <ExpandToggle data={d} darkMode={darkMode} />
        </div>

        {summaries.length > 0 ? (
          <div className="mt-2 space-y-1">
            <div className="text-xs font-medium opacity-80">Sample summaries</div>
            <ul className="list-disc pl-4 text-xs space-y-0.5 opacity-80">
              {summaries.map((s, idx) => (
                <li key={`vg-s-${idx}`}>{s}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </NodeShell>
  );
}

export function VisualAssetNode({ id, data, selected }: NodeProps) {
  const d = (data ?? {}) as BaseNodeData;
  const darkMode = Boolean(d.__darkMode);
  const thumb = resolveApiAssetUrl(typeof d.image_uri === 'string' ? d.image_uri : null);

  const persistedSegment = typeof (d as any)?.persisted_segment_key === 'string' ? String((d as any).persisted_segment_key) : null;
  const computedSegment = typeof (d as any)?.computed_segment === 'string' ? String((d as any).computed_segment) : null;
  const computedSegmentsModeEnabled =
    typeof window !== 'undefined' && window.localStorage.getItem('analystUseComputedSegmentsDebug') === '1';
  const computedSegmentsToggleVisibleOverride =
    typeof window !== 'undefined' && window.localStorage.getItem('ddai:showComputedSegmentsToggle') === '1';
  const showSegmentDiff =
    (import.meta.env.DEV || computedSegmentsToggleVisibleOverride) &&
    computedSegmentsModeEnabled &&
    Boolean(persistedSegment && computedSegment && persistedSegment !== computedSegment);

  const extractorVersion =
    typeof d.extractor_version === 'string'
      ? d.extractor_version
      : typeof (d as any)?.extractor_version === 'string'
        ? String((d as any).extractor_version)
        : null;
  const qualityFlags = (d as any)?.quality_flags ?? d.quality_flags;
  const qfSource = typeof qualityFlags?.source === 'string' ? qualityFlags.source : null;

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
  const structuredJson = (d as any)?.structured_json ?? d.structured_json;

  const isStructuredNative = (() => {
    if (extractorVersion && extractorVersion.toLowerCase() === 'structured_native_v1') return true;
    if (qfSource && qfSource.toLowerCase().startsWith('structured_')) return true;
    // Heuristic fallback: if we have structured payload but no image crop, present as structured.
    if (!thumb && structuredJson != null) return true;
    return false;
  })();
  const structuredSummary = cleanSnippet((d as any)?.structured_summary ?? structuredJson?.structured_summary ?? structuredJson?.summary, 220);
  const structuredTitle = cleanSnippet(structuredJson?.title, 160);
  const structuredTextSnippet = cleanSnippet(structuredJson?.text_snippet, 200);
  const structuredParagraphs = (() => {
    const paras = structuredJson?.paragraphs;
    if (!Array.isArray(paras)) return null;
    const clean = paras
      .filter((p) => typeof p === 'string')
      .map((p) => cleanSnippet(p, 200))
      .filter(Boolean) as string[];
    return clean.length ? clean : null;
  })();
  const structuredSheetHint = (() => {
    const kind = typeof structuredJson?.kind === 'string' ? structuredJson.kind : '';
    if (!kind.toLowerCase().includes('excel')) return null;
    const sheet = cleanSnippet(structuredJson?.sheet_name, 80);
    const headers = Array.isArray(structuredJson?.headers)
      ? (structuredJson.headers as unknown[])
          .filter((h) => typeof h === 'string')
          .map((h) => cleanSnippet(h, 40))
          .filter(Boolean)
          .slice(0, 4)
      : [];
    const headerLine = headers.length ? `Headers: ${headers.join(' · ')}` : null;
    const parts = [sheet ? `Sheet: ${sheet}` : null, headerLine].filter(Boolean);
    if (!parts.length) return null;
    return cleanSnippet(parts.join(' • '), 220);
  })();
  const structuredBullets = (() => {
    const bullets = structuredJson?.bullets;
    if (!Array.isArray(bullets)) return null;
    const clean = bullets
      .filter((b) => typeof b === 'string')
      .map((b) => cleanSnippet(b, 160))
      .filter(Boolean) as string[];
    return clean.length ? clean : null;
  })();

  const isBadObjectString = (s: string | null) => !!s && /\[object Object\]/i.test(s);
  const firstEvidence = (() => {
    const evidenceSnippets = (d as any)?.evidence_snippets;
    if (!Array.isArray(evidenceSnippets)) return null;
    return cleanSnippet(evidenceSnippets.find((s) => typeof s === 'string' && s.trim().length > 0), 160);
  })();

  const summaryLine = (() => {
    if (isStructuredNative) {
      // Structured items: avoid implying a page image exists.
      if (structuredTitle && !isBadObjectString(structuredTitle)) return structuredTitle;
      if (structuredTextSnippet && !isBadObjectString(structuredTextSnippet)) return structuredTextSnippet;
      if (structuredBullets?.length) {
        const joined = cleanSnippet(structuredBullets.slice(0, 2).join(' • '), 200);
        if (joined && !isBadObjectString(joined)) return joined;
      }
      if (structuredParagraphs?.length) {
        const joined = cleanSnippet(structuredParagraphs.slice(0, 2).join(' '), 200);
        if (joined && !isBadObjectString(joined)) return joined;
      }
      if (structuredSheetHint && !isBadObjectString(structuredSheetHint)) return structuredSheetHint;
      if (structuredSummary && !isBadObjectString(structuredSummary)) return structuredSummary;
      if (firstEvidence && !isBadObjectString(firstEvidence)) return firstEvidence;
      return 'No structured snippet available yet';
    }

    // Page visuals: lead with OCR/understanding.
    const summary = cleanSnippet(pageUnderstanding?.summary, 200);
    if (summary && !isBadObjectString(summary)) return summary;

    const ocr = cleanSnippet(
      (d as any)?.ocr_text_snippet ?? (d as any)?.ocr_text ?? (d as any)?.image_text ?? (d as any)?.text,
      200
    );
    if (ocr && !isBadObjectString(ocr)) return ocr;

    if (firstEvidence && !isBadObjectString(firstEvidence)) return firstEvidence;

    // If it’s actually structured but we failed the earlier detection, fall back gracefully.
    if (structuredSummary && !isBadObjectString(structuredSummary)) return structuredSummary;

    return 'No summary available yet';
  })();

  const title = isStructuredNative ? structuredTitle || slideTitle || titleFallback : slideTitle || titleFallback;

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
            <div className="text-xs uppercase tracking-wide opacity-70">{isStructuredNative ? 'Structured item' : 'Page visual'}</div>
            <div className="text-sm font-medium leading-snug line-clamp-1">{title}</div>
            {showSegmentDiff ? (
              <div className="mt-1 text-[11px] opacity-70">
                    Persisted: {persistedSegment} ➔ Computed: {computedSegment}
              </div>
            ) : null}
          </div>
          <ExpandToggle data={d} darkMode={darkMode} />
        </div>

        <div className="mt-2 flex gap-2">
          {thumb && !isStructuredNative ? (
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

export function EvidenceGroupNode({ data, selected }: NodeProps) {
  const d = (data ?? {}) as BaseNodeData;
  const darkMode = Boolean(d.__darkMode);
  const label = typeof d.label === 'string' && d.label.trim().length > 0 ? d.label : 'Evidence group';

  const evidenceTotal = Number.isFinite(d.evidence_count_total)
    ? Math.max(0, Math.round(d.evidence_count_total ?? 0))
    : typeof d.count === 'number'
      ? d.count
      : null;
  const avgConfDisplay = formatConfidencePercent(d.avg_confidence ?? d.confidence);

  const snippets = (() => {
    if (Array.isArray(d.sample_summaries)) return d.sample_summaries.filter((s) => typeof s === 'string' && s.trim().length > 0);
    if (typeof d.sample_snippet === 'string' && d.sample_snippet.trim().length > 0) return [d.sample_snippet];
    return [];
  })().slice(0, 3);

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
            <div className="text-xs uppercase tracking-wide opacity-70">Evidence group</div>
            <div className="text-sm font-medium leading-snug line-clamp-2">{label}</div>
            <div className="text-xs opacity-70 mt-1">Items: {evidenceTotal != null ? evidenceTotal : '—'} · Avg conf: {avgConfDisplay}</div>
          </div>
          <ExpandToggle data={d} darkMode={darkMode} />
        </div>
        {snippets.length > 0 ? (
          <div className="mt-2 text-xs opacity-80 space-y-1">
            {snippets.map((s, idx) => (
              <div key={`eg-s-${idx}`} className="line-clamp-2">
                “{s}”
              </div>
            ))}
          </div>
        ) : null}
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

  VISUAL_GROUP: VisualGroupNode,
  visual_group: VisualGroupNode,

  SEGMENT: SegmentNode,
  segment: SegmentNode,

  EVIDENCE: EvidenceNode,
  evidence: EvidenceNode,

  EVIDENCE_GROUP: EvidenceGroupNode,
  evidence_group: EvidenceGroupNode,

  default: DefaultNode,
} as const;
