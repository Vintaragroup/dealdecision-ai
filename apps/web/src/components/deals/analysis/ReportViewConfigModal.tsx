/**
 * ReportViewConfigModal
 *
 * Pre-screen that lets the user choose which sections to include
 * before opening the full OrchestratorFullReportView modal.
 *
 * This is purely a VIEW-configuration UI — it does not generate
 * anything or fetch data. It is shared by both "View Full Report"
 * and "Export Report" flows.
 */

import { useState } from 'react';
import {
  X,
  FileText,
  Scale,
  TrendingUp,
  DollarSign,
  AlertTriangle,
  BookOpen,
  Target,
  CheckCircle2,
  ChevronRight,
} from 'lucide-react';
import { Button } from '../../ui/button';

// ─────────────────────────────────────────────────────────────────────────────
// Types (exported for use in OrchestratorFullReportView + AnalysisTab)
// ─────────────────────────────────────────────────────────────────────────────

export type ReportSectionKey =
  | 'decision_overlay'
  | 'executive_summary'
  | 'deal_terms'
  | 'market_analysis'
  | 'financial_analysis'
  | 'risk_verification'
  | 'evidence_appendix';

export type ReportPresetId = 'complete' | 'investor' | 'quick' | 'custom';

export interface ReportViewConfig {
  presetId: ReportPresetId;
  visibleSections: ReportSectionKey[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Section catalogue
// ─────────────────────────────────────────────────────────────────────────────

interface SectionDef {
  key: ReportSectionKey;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}

const SECTIONS: SectionDef[] = [
  {
    key: 'decision_overlay',
    label: 'Go/No-Go Recommendation',
    description: 'AI-generated investment decision with confidence band',
    icon: Target,
  },
  {
    key: 'executive_summary',
    label: 'Executive Summary',
    description: 'Headline narrative, strengths, risks, and open questions',
    icon: FileText,
  },
  {
    key: 'deal_terms',
    label: 'Deal Terms',
    description: 'Funding ask, valuation, stage, and structure details',
    icon: Scale,
  },
  {
    key: 'market_analysis',
    label: 'Market Analysis',
    description: 'TAM/SAM/SOM, competitive landscape, and positioning',
    icon: TrendingUp,
  },
  {
    key: 'financial_analysis',
    label: 'Financial Analysis',
    description: 'Revenue, burn, runway, unit economics, and projections',
    icon: DollarSign,
  },
  {
    key: 'risk_verification',
    label: 'Risk & Verification',
    description: 'Key risks, data integrity flags, and checklist status',
    icon: AlertTriangle,
  },
  {
    key: 'evidence_appendix',
    label: 'Evidence Appendix',
    description: 'Document coverage, OCR confidence, and data provenance',
    icon: BookOpen,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Preset definitions
// ─────────────────────────────────────────────────────────────────────────────

const ALL_KEYS: ReportSectionKey[] = SECTIONS.map((s) => s.key);

const PRESET_SECTIONS: Record<ReportPresetId, ReportSectionKey[]> = {
  complete: ALL_KEYS,
  investor: [
    'decision_overlay',
    'executive_summary',
    'deal_terms',
    'market_analysis',
    'financial_analysis',
    'risk_verification',
  ],
  quick: ['decision_overlay', 'executive_summary'],
  custom: ALL_KEYS, // custom starts as complete then user edits
};

const PRESET_LABELS: Record<ReportPresetId, string> = {
  complete: 'Complete Package',
  investor: 'Investor Summary',
  quick: 'Quick Overview',
  custom: 'Custom Selection',
};

const PRESET_DESCRIPTIONS: Record<ReportPresetId, string> = {
  complete: 'All 7 sections',
  investor: 'Core 6 investor-focused sections',
  quick: 'Decision + executive summary only',
  custom: 'You choose which sections appear',
};

// ─────────────────────────────────────────────────────────────────────────────
// Default configs (exported for convenience)
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_REPORT_VIEW_CONFIG: ReportViewConfig = {
  presetId: 'investor',
  visibleSections: PRESET_SECTIONS.investor,
};

export const COMPLETE_REPORT_VIEW_CONFIG: ReportViewConfig = {
  presetId: 'complete',
  visibleSections: ALL_KEYS,
};

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

export interface ReportViewConfigModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Config to seed the modal with (default: investor preset). */
  initialConfig?: ReportViewConfig;
  darkMode?: boolean;
  /** Called when the user confirms the selection and wants to proceed. */
  onContinue: (config: ReportViewConfig) => void;
  /** Label for the CTA button ("View Report", "Export Report", etc.). */
  continueLabel?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function ReportViewConfigModal({
  open,
  onOpenChange,
  initialConfig = DEFAULT_REPORT_VIEW_CONFIG,
  darkMode = false,
  onContinue,
  continueLabel = 'View Report',
}: ReportViewConfigModalProps) {
  const [preset, setPreset] = useState<ReportPresetId>(initialConfig.presetId);
  const [selected, setSelected] = useState<Set<ReportSectionKey>>(
    new Set(initialConfig.visibleSections)
  );

  if (!open) return null;

  const applyPreset = (p: ReportPresetId) => {
    setPreset(p);
    if (p !== 'custom') {
      setSelected(new Set(PRESET_SECTIONS[p]));
    }
  };

  const toggleSection = (key: ReportSectionKey) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
    setPreset('custom');
  };

  const handleContinue = () => {
    onContinue({ presetId: preset, visibleSections: Array.from(selected) as ReportSectionKey[] });
  };

  const selectedCount = selected.size;

  // ── Styles (matching ExportReportModal pattern) ───────────────────────────
  const surface = darkMode
    ? 'bg-[#0f0f0f] border-white/10 text-white'
    : 'bg-white border-gray-200 text-gray-900';
  const subText = darkMode ? 'text-gray-400' : 'text-gray-500';
  const divider = darkMode ? 'border-white/10' : 'border-gray-200';
  const cardBase = `rounded-xl border p-4 cursor-pointer transition-all duration-150`;
  const cardActive = darkMode
    ? 'border-[#6366f1]/60 bg-[#6366f1]/10'
    : 'border-[#6366f1] bg-[#6366f1]/5';
  const cardInactive = darkMode ? 'border-white/10 bg-white/3' : 'border-gray-200 bg-gray-50';
  const checkboxBase = `w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors`;
  const checkboxChecked = 'border-[#6366f1] bg-[#6366f1]';
  const checkboxUnchecked = darkMode ? 'border-white/30 bg-transparent' : 'border-gray-300 bg-transparent';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div
        className={`w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-2xl border shadow-2xl flex flex-col ${surface}`}
      >
        {/* Header */}
        <div className={`flex items-center justify-between px-6 py-5 border-b ${divider} shrink-0`}>
          <div>
            <h2 className="text-lg font-semibold">Configure Report View</h2>
            <p className={`text-sm mt-0.5 ${subText}`}>
              Choose which sections to include — applies to both viewing and export
            </p>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className={`p-2 rounded-lg transition-colors ${
              darkMode ? 'hover:bg-white/10 text-gray-400' : 'hover:bg-gray-100 text-gray-500'
            }`}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-6">
          {/* Presets */}
          <div>
            <p className={`text-xs font-semibold uppercase tracking-wide mb-3 ${subText}`}>
              Presets
            </p>
            <div className="grid grid-cols-2 gap-3">
              {(Object.keys(PRESET_LABELS) as ReportPresetId[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => applyPreset(p)}
                  className={`${cardBase} text-left ${preset === p ? cardActive : cardInactive}`}
                >
                  <p
                    className={`text-sm font-medium ${
                      preset === p
                        ? darkMode
                          ? 'text-[#a5b4fc]'
                          : 'text-[#6366f1]'
                        : darkMode
                        ? 'text-white'
                        : 'text-gray-900'
                    }`}
                  >
                    {PRESET_LABELS[p]}
                  </p>
                  <p className={`text-xs mt-0.5 ${subText}`}>{PRESET_DESCRIPTIONS[p]}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Section list */}
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
                {selectedCount} / {SECTIONS.length} selected
              </span>
            </div>
            <div className="space-y-2">
              {SECTIONS.map(({ key, label, description, icon: Icon }) => {
                const isChecked = selected.has(key);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggleSection(key)}
                    className={`w-full flex items-start gap-3 p-3 rounded-lg border text-left transition-colors ${
                      isChecked
                        ? darkMode
                          ? 'border-[#6366f1]/30 bg-[#6366f1]/8'
                          : 'border-[#6366f1]/25 bg-[#6366f1]/5'
                        : cardInactive
                    }`}
                  >
                    {/* Checkbox */}
                    <span
                      className={`mt-0.5 ${checkboxBase} ${
                        isChecked ? checkboxChecked : checkboxUnchecked
                      }`}
                    >
                      {isChecked && <CheckCircle2 className="w-2.5 h-2.5 text-white" />}
                    </span>
                    {/* Icon */}
                    <Icon
                      className={`w-4 h-4 mt-0.5 shrink-0 ${
                        isChecked
                          ? darkMode
                            ? 'text-[#a5b4fc]'
                            : 'text-[#6366f1]'
                          : darkMode
                          ? 'text-gray-500'
                          : 'text-gray-400'
                      }`}
                    />
                    {/* Label */}
                    <div className="min-w-0">
                      <p
                        className={`text-sm font-medium leading-tight ${
                          isChecked
                            ? darkMode
                              ? 'text-white'
                              : 'text-gray-900'
                            : darkMode
                            ? 'text-gray-300'
                            : 'text-gray-600'
                        }`}
                      >
                        {label}
                      </p>
                      <p className={`text-xs mt-0.5 ${subText}`}>{description}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className={`flex items-center justify-between px-6 py-4 border-t ${divider} shrink-0`}>
          <p className={`text-xs ${subText}`}>
            {selectedCount === 0 ? (
              <span className={darkMode ? 'text-amber-400' : 'text-amber-600'}>
                Select at least one section
              </span>
            ) : (
              `${selectedCount} section${selectedCount !== 1 ? 's' : ''} will be shown`
            )}
          </p>
          <div className="flex gap-3">
            <Button
              variant="outline"
              size="sm"
              darkMode={darkMode}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              darkMode={darkMode}
              disabled={selectedCount === 0}
              onClick={handleContinue}
              icon={<ChevronRight className="w-4 h-4" />}
            >
              {continueLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
