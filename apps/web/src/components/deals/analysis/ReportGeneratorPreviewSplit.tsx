/**
 * ReportGeneratorPreviewSplit
 *
 * Inline split-view used in the AI Analysis tab when the user clicks "Export Report".
 * No modals, no routes — renders directly inside the tab panel.
 *
 * Layout:
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │ Back row                                                         │
 *   ├────────────────────────┬─────────────────────────────────────────┤
 *   │ Left panel (~380px)    │ Right panel (flex-1)                    │
 *   │  Presets               │  Sticky header: title + Export PDF stub │
 *   │  Section checklist     ├─────────────────────────────────────────┤
 *   │                        │  ScrollArea → OrchestratorFullReportView│
 *   └────────────────────────┴─────────────────────────────────────────┘
 */

import { useState, useCallback, useRef } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  FileText,
  Scale,
  TrendingUp,
  DollarSign,
  AlertTriangle,
  BookOpen,
  Target,
  Download,
  LayoutTemplate,
} from 'lucide-react';
import { Button } from '../../ui/button';
import { ScrollArea } from '../../ui/scroll-area';
import { OrchestratorFullReportView } from '../../workspace/OrchestratorFullReportView';
import { apiPostExportPdf, apiGetExportPdfStatus } from '../../../lib/apiClient';
import type { ReportSectionKey, ReportPresetId } from './ReportViewConfigModal';

// ─────────────────────────────────────────────────────────────────────────────
// Export config shape (exported so callers can type-reference it)
// ─────────────────────────────────────────────────────────────────────────────

export type ReportExportFormat = 'standard' | 'pdf' | 'word';

export interface ReportExportConfig {
  preset: ReportPresetId;
  format: ReportExportFormat;
  sections: ReportSectionKey[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Section catalogue (mirrors ReportViewConfigModal — co-located for isolation)
// ─────────────────────────────────────────────────────────────────────────────

interface SectionDef {
  key: ReportSectionKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const SECTION_DEFS: SectionDef[] = [
  { key: 'decision_overlay', label: 'Go/No-Go Decision', icon: Target },
  { key: 'executive_summary', label: 'Executive Summary', icon: FileText },
  { key: 'deal_terms', label: 'Deal Terms', icon: Scale },
  { key: 'market_analysis', label: 'Market Analysis', icon: TrendingUp },
  { key: 'financial_analysis', label: 'Financial Analysis', icon: DollarSign },
  { key: 'risk_verification', label: 'Risk & Verification', icon: AlertTriangle },
  { key: 'evidence_appendix', label: 'Evidence Appendix', icon: BookOpen },
];

const ALL_KEYS = SECTION_DEFS.map((s) => s.key);

// ─────────────────────────────────────────────────────────────────────────────
// Presets
// ─────────────────────────────────────────────────────────────────────────────

interface PresetDef {
  id: ReportPresetId;
  label: string;
  shortDescription: string;
  sections: ReportSectionKey[];
}

const PRESETS: PresetDef[] = [
  {
    id: 'complete',
    label: 'Complete Package',
    shortDescription: 'All 7 sections',
    sections: ALL_KEYS,
  },
  {
    id: 'investor',
    label: 'Investor Summary',
    shortDescription: '6 core sections',
    sections: ['decision_overlay', 'executive_summary', 'deal_terms', 'market_analysis', 'financial_analysis', 'risk_verification'],
  },
  {
    id: 'quick',
    label: 'Quick Overview',
    shortDescription: 'Decision + summary only',
    sections: ['decision_overlay', 'executive_summary'],
  },
  {
    id: 'custom',
    label: 'Custom',
    shortDescription: 'You choose',
    sections: ALL_KEYS,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Default configs
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_INVESTOR_SECTIONS: ReportSectionKey[] = [
  'decision_overlay',
  'executive_summary',
  'deal_terms',
  'market_analysis',
  'financial_analysis',
  'risk_verification',
];

export const DEFAULT_EXPORT_CONFIG: ReportExportConfig = {
  preset: 'investor',
  format: 'standard',
  sections: DEFAULT_INVESTOR_SECTIONS,
};

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

export interface ReportGeneratorPreviewSplitProps {
  dealId: string;
  darkMode?: boolean;
  dealName?: string;
  onBack: () => void;
  onRunAnalysis?: () => Promise<void> | void;
  /** Seeded from the upstream context. Defaults to investor preset. */
  initialConfig?: Partial<ReportExportConfig>;
  /** Optional callback invoked when an export is triggered (e.g. for analytics). The component handles the API call internally. */
  onExportPdf?: (config: ReportExportConfig) => void;
}

type ExportState = 'idle' | 'submitting' | 'polling' | 'done' | 'error';

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function ReportGeneratorPreviewSplit({
  dealId,
  darkMode = false,
  dealName,
  onBack,
  onRunAnalysis,
  initialConfig,
  onExportPdf,
}: ReportGeneratorPreviewSplitProps) {
  const [exportConfig, setExportConfig] = useState<ReportExportConfig>({
    ...DEFAULT_EXPORT_CONFIG,
    ...initialConfig,
  });

  // ── Export job state ────────────────────────────────────────────────────
  const [exportState, setExportState] = useState<ExportState>('idle');
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Preset selection ────────────────────────────────────────────────────────
  const applyPreset = useCallback((presetId: ReportPresetId) => {
    const preset = PRESETS.find((p) => p.id === presetId);
    setExportConfig((prev) => ({
      ...prev,
      preset: presetId,
      sections: preset ? [...preset.sections] : [...ALL_KEYS],
    }));
  }, []);

  // ── Section toggle (custom) ─────────────────────────────────────────────────
  const toggleSection = useCallback((key: ReportSectionKey) => {
    setExportConfig((prev) => {
      const next = prev.sections.includes(key)
        ? prev.sections.filter((k) => k !== key)
        : [...prev.sections, key];
      return { ...prev, preset: 'custom', sections: next };
    });
  }, []);

  // ── Jump to anchor in preview panel ────────────────────────────────────────
  const jumpToSection = useCallback((key: ReportSectionKey) => {
    // Anchor IDs set by OrchestratorFullReportView: section-{key}
    const el = document.getElementById(`section-${key}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  // ── Export PDF ─────────────────────────────────────────────────────────────
  const handleExportPdf = useCallback(async () => {
    // Optional override (e.g. for tests / storybook)
    if (onExportPdf) {
      onExportPdf(exportConfig);
      return;
    }

    setExportState('submitting');
    setDownloadUrl(null);
    setExportError(null);

    try {
      // Cast local type to contracts shape (identical string union, structurally compatible)
      const apiConfig = exportConfig as unknown as import('@dealdecision/contracts').ReportExportConfig;
      const res = await apiPostExportPdf(dealId, apiConfig);
      const exportId = res.export_id;

      // Poll every 2s for up to 2 minutes
      setExportState('polling');
      let attempts = 0;
      const MAX_ATTEMPTS = 60;

      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      pollTimerRef.current = setInterval(async () => {
        attempts++;
        try {
          const status = await apiGetExportPdfStatus(dealId, exportId);
          if (status.status === 'completed') {
            clearInterval(pollTimerRef.current!);
            pollTimerRef.current = null;
            setDownloadUrl((status as any).download_url ?? null);
            setExportState('done');
          } else if (status.status === 'failed') {
            clearInterval(pollTimerRef.current!);
            pollTimerRef.current = null;
            setExportError((status as any).error_message ?? 'Export failed');
            setExportState('error');
          } else if (attempts >= MAX_ATTEMPTS) {
            clearInterval(pollTimerRef.current!);
            pollTimerRef.current = null;
            setExportError('Export timed out. Please try again.');
            setExportState('error');
          }
        } catch {
          // Don't abort polling on transient fetch errors
        }
      }, 2000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Export request failed';
      setExportError(msg);
      setExportState('error');
    }
  }, [dealId, exportConfig, onExportPdf]);

  const selectedCount = exportConfig.sections.length;

  // ─────────────────────────────────────────────────────────────────────────
  // Style tokens (dark/light)
  // ─────────────────────────────────────────────────────────────────────────
  const bg = darkMode ? 'bg-[#0a0a0a]' : 'bg-gray-50';
  const surface = darkMode ? 'bg-[#141414]' : 'bg-white';
  const border = darkMode ? 'border-white/10' : 'border-gray-200';
  const text = darkMode ? 'text-white' : 'text-gray-900';
  const subText = darkMode ? 'text-gray-400' : 'text-gray-500';
  const cardActive = darkMode
    ? 'border-[#6366f1]/60 bg-[#6366f1]/10 text-[#a5b4fc]'
    : 'border-[#6366f1] bg-[#6366f1]/5 text-[#6366f1]';
  const cardInactive = darkMode
    ? 'border-white/10 bg-white/3 text-gray-300 hover:border-white/20'
    : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-gray-300';

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className={`flex flex-col h-full ${bg}`}>
      {/* ── Back header row ── */}
      <div
        className={`shrink-0 flex items-center justify-between px-4 py-3 border-b ${border} ${surface}`}
      >
        <button
          type="button"
          onClick={onBack}
          className={`flex items-center gap-2 text-sm font-medium transition-colors ${
            darkMode
              ? 'text-gray-400 hover:text-white'
              : 'text-gray-500 hover:text-gray-900'
          }`}
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </button>
        <div className="flex items-center gap-2">
          <LayoutTemplate className={`w-4 h-4 ${subText}`} />
          <span className={`text-sm font-medium ${text}`}>Due Diligence Report</span>
          {dealName && (
            <span
              className={`text-xs px-2 py-0.5 rounded-full ${
                darkMode ? 'bg-white/8 text-gray-400' : 'bg-gray-100 text-gray-500'
              }`}
            >
              {dealName}
            </span>
          )}
        </div>
      </div>

      {/* ── Split body ── */}
      <div className="flex-1 min-h-0 flex overflow-hidden">

        {/* ── Left panel: controls ── */}
        <div
          className={`w-[380px] shrink-0 flex flex-col border-r ${border} ${surface} overflow-y-auto`}
        >
          <div className="p-5 space-y-6">

            {/* Presets */}
            <div>
              <p className={`text-xs font-semibold uppercase tracking-wide mb-3 ${subText}`}>
                Presets
              </p>
              <div className="grid grid-cols-2 gap-2">
                {PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => applyPreset(p.id)}
                    className={`rounded-xl border p-3 text-left transition-all duration-150 text-sm ${
                      exportConfig.preset === p.id ? cardActive : cardInactive
                    }`}
                  >
                    <p className="font-medium leading-tight">{p.label}</p>
                    <p
                      className={`text-xs mt-0.5 ${
                        exportConfig.preset === p.id ? 'opacity-80' : subText
                      }`}
                    >
                      {p.shortDescription}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            {/* Format selection */}
            <div>
              <p className={`text-xs font-semibold uppercase tracking-wide mb-3 ${subText}`}>
                Format
              </p>
              <div className="flex gap-2">
                {(['standard', 'pdf', 'word'] as ReportExportFormat[]).map((fmt) => (
                  <button
                    key={fmt}
                    type="button"
                    onClick={() => setExportConfig((prev) => ({ ...prev, format: fmt }))}
                    className={`flex-1 rounded-lg border py-2 text-xs font-medium transition-colors capitalize ${
                      exportConfig.format === fmt ? cardActive : cardInactive
                    }`}
                  >
                    {fmt === 'standard' ? 'Web' : fmt.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {/* Section checklist */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className={`text-xs font-semibold uppercase tracking-wide ${subText}`}>
                  Sections
                </p>
                <span
                  className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    darkMode
                      ? 'bg-[#6366f1]/20 text-[#a5b4fc]'
                      : 'bg-[#6366f1]/10 text-[#6366f1]'
                  }`}
                >
                  {selectedCount} / {SECTION_DEFS.length}
                </span>
              </div>
              <div className="space-y-1.5">
                {SECTION_DEFS.map(({ key, label, icon: Icon }) => {
                  const isChecked = exportConfig.sections.includes(key);
                  return (
                    <div
                      key={key}
                      className={`flex items-center gap-3 rounded-lg border transition-colors ${
                        isChecked
                          ? darkMode
                            ? 'border-[#6366f1]/30 bg-[#6366f1]/8'
                            : 'border-[#6366f1]/25 bg-[#6366f1]/5'
                          : darkMode
                          ? 'border-white/8 bg-transparent'
                          : 'border-gray-200 bg-transparent'
                      }`}
                    >
                      {/* Checkbox */}
                      <button
                        type="button"
                        onClick={() => toggleSection(key)}
                        className="pl-3 py-2.5 flex items-center"
                        aria-label={`Toggle ${label}`}
                      >
                        <span
                          className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                            isChecked
                              ? 'border-[#6366f1] bg-[#6366f1]'
                              : darkMode
                              ? 'border-white/30 bg-transparent'
                              : 'border-gray-300 bg-transparent'
                          }`}
                        >
                          {isChecked && <CheckCircle2 className="w-2.5 h-2.5 text-white" />}
                        </span>
                      </button>
                      {/* Icon + label — clicking scrolls to section */}
                      <button
                        type="button"
                        onClick={() => {
                          if (isChecked) jumpToSection(key);
                        }}
                        disabled={!isChecked}
                        className={`flex-1 flex items-center gap-2.5 py-2.5 pr-3 text-left transition-colors ${
                          isChecked
                            ? darkMode
                              ? 'text-white cursor-pointer hover:text-[#a5b4fc]'
                              : 'text-gray-900 cursor-pointer hover:text-[#6366f1]'
                            : `${subText} cursor-default`
                        }`}
                      >
                        <Icon
                          className={`w-3.5 h-3.5 shrink-0 ${
                            isChecked
                              ? darkMode
                                ? 'text-[#a5b4fc]'
                                : 'text-[#6366f1]'
                              : darkMode
                              ? 'text-gray-600'
                              : 'text-gray-400'
                          }`}
                        />
                        <span className="text-xs font-medium leading-tight">{label}</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Export button + status */}
            <div className={`pt-2 border-t ${border}`}>
              {/* Done state: show download + copy-link */}
              {exportState === 'done' && downloadUrl ? (
                <div className="space-y-2">
                  <a
                    href={downloadUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={`flex items-center justify-center gap-2 w-full rounded-lg py-2 text-sm font-medium border transition-colors ${
                      darkMode
                        ? 'bg-green-500/15 border-green-500/40 text-green-400 hover:bg-green-500/25'
                        : 'bg-green-50 border-green-300 text-green-700 hover:bg-green-100'
                    }`}
                  >
                    <Download className="w-4 h-4" />
                    Download PDF
                  </a>
                  <Button
                    variant="outline"
                    size="sm"
                    darkMode={darkMode}
                    onClick={() => { navigator.clipboard.writeText(downloadUrl).catch(() => undefined); }}
                    className="w-full justify-center text-xs"
                  >
                    Copy share link
                  </Button>
                  <button
                    type="button"
                    onClick={() => { setExportState('idle'); setDownloadUrl(null); }}
                    className={`w-full text-xs text-center ${subText} hover:underline`}
                  >
                    Export again
                  </button>
                </div>
              ) : exportState === 'error' ? (
                <div>
                  <p className="text-xs text-red-500 text-center mb-2">
                    {exportError ?? 'Export failed'}
                  </p>
                  <Button
                    variant="outline"
                    darkMode={darkMode}
                    icon={<Download className="w-4 h-4" />}
                    onClick={() => { setExportState('idle'); setExportError(null); handleExportPdf(); }}
                    className="w-full justify-center"
                  >
                    Retry Export
                  </Button>
                </div>
              ) : (
                <>
                  <Button
                    variant="primary"
                    darkMode={darkMode}
                    icon={
                      exportState === 'idle'
                        ? <Download className="w-4 h-4" />
                        : <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin inline-block" />
                    }
                    onClick={handleExportPdf}
                    disabled={selectedCount === 0 || exportState !== 'idle'}
                    className="w-full justify-center"
                  >
                    {exportState === 'submitting'
                      ? 'Requesting…'
                      : exportState === 'polling'
                      ? 'Generating PDF…'
                      : 'Export PDF'}
                  </Button>
                  <p className={`text-xs text-center mt-2 ${subText}`}>
                    {selectedCount === 0
                      ? 'Select at least one section'
                      : `${selectedCount} section${selectedCount !== 1 ? 's' : ''} · ${exportConfig.format.toUpperCase()} format`}
                  </p>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── Right panel: preview ── */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {/* Sticky right header */}
          <div
            className={`shrink-0 flex items-center justify-between px-6 py-3.5 border-b ${border} ${surface}`}
          >
            <div>
              <p className={`text-sm font-semibold ${text}`}>Due Diligence Report Preview</p>
              {dealName && (
                <p className={`text-xs mt-0.5 ${subText}`}>{dealName}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`text-xs px-2 py-1 rounded-md border ${
                  darkMode
                    ? 'border-white/15 bg-white/5 text-gray-400'
                    : 'border-gray-200 bg-gray-50 text-gray-500'
                }`}
              >
                {selectedCount} of {SECTION_DEFS.length} sections
              </span>
              {exportState === 'done' && downloadUrl ? (
                <a
                  href={downloadUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded border ${
                    darkMode
                      ? 'border-green-600 text-green-400 hover:bg-green-900/30'
                      : 'border-green-600 text-green-700 hover:bg-green-50'
                  }`}
                >
                  <Download className="w-3.5 h-3.5" />
                  Download PDF
                </a>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  darkMode={darkMode}
                  icon={
                    exportState === 'idle'
                      ? <Download className="w-3.5 h-3.5" />
                      : <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin inline-block" />
                  }
                  onClick={handleExportPdf}
                  disabled={selectedCount === 0 || exportState !== 'idle'}
                >
                  {exportState === 'submitting'
                    ? 'Requesting…'
                    : exportState === 'polling'
                    ? 'Generating…'
                    : 'Export PDF'}
                </Button>
              )}
            </div>
          </div>

          {/* Scrollable preview */}
          <ScrollArea className="flex-1">
            <div className="p-6">
              {selectedCount === 0 ? (
                <div className="flex items-center justify-center h-64">
                  <p className={`text-sm ${subText}`}>
                    Select at least one section from the left panel to preview.
                  </p>
                </div>
              ) : (
                <OrchestratorFullReportView
                  dealId={dealId}
                  darkMode={darkMode}
                  dealName={dealName}
                  onRunAnalysis={onRunAnalysis}
                  visibleSections={exportConfig.sections}
                />
              )}
            </div>
          </ScrollArea>
        </div>

      </div>
    </div>
  );
}
