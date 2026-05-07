/**
 * EvidenceChip — compact evidence reference badge.
 *
 * Renders a small clickable chip showing the count of backing evidence refs.
 * Clicking opens the Evidence Trace Drawer to resolve IDs to citations.
 *
 * Design intent: institutional audit-trace layer, not annotation noise.
 * Chips only render when `evidenceRefs` is non-empty.
 */

import React from 'react';

export type EvidenceChipProps = {
  evidenceRefs: string[];
  /** Optional short label override (e.g. "XLSX", "Deck p14"). Defaults to "N sources". */
  label?: string;
  /** Context label shown in the drawer title (e.g. "Revenue burn rate", "Market size claim"). */
  context?: string;
  darkMode?: boolean;
  onOpen: (refs: string[], context?: string) => void;
  className?: string;
};

export function EvidenceChip({
  evidenceRefs,
  label,
  context,
  darkMode = true,
  onOpen,
  className = '',
}: EvidenceChipProps) {
  if (!evidenceRefs || evidenceRefs.length === 0) return null;

  const displayLabel = label ?? `${evidenceRefs.length} source${evidenceRefs.length === 1 ? '' : 's'}`;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen(evidenceRefs, context);
      }}
      title={`View evidence: ${displayLabel}`}
      className={[
        'inline-flex items-center gap-1',
        'rounded-md',
        'border',
        'px-1.5 py-0.5',
        'text-[10px] font-medium leading-none',
        'transition-colors',
        darkMode
          ? 'border-white/[0.12] bg-white/[0.04] text-gray-400 hover:bg-white/[0.08] hover:text-gray-300'
          : 'border-gray-200 bg-gray-50 text-gray-500 hover:bg-gray-100 hover:text-gray-700',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {/* source icon: small dot */}
      <span
        className={`h-1.5 w-1.5 rounded-full shrink-0 ${
          darkMode ? 'bg-sky-500/60' : 'bg-sky-500/70'
        }`}
      />
      {displayLabel}
    </button>
  );
}

/**
 * EvidenceChipRow — renders a horizontal strip of chips with a minimal gap.
 * Renders nothing if all arrays are empty.
 */
export type EvidenceChipRowProps = {
  evidenceRefs: string[];
  context?: string;
  darkMode?: boolean;
  onOpen: (refs: string[], context?: string) => void;
};

export function EvidenceChipRow({ evidenceRefs, context, darkMode, onOpen }: EvidenceChipRowProps) {
  if (!evidenceRefs || evidenceRefs.length === 0) return null;
  return (
    <span className="ml-1.5 inline-flex items-center gap-1">
      <EvidenceChip
        evidenceRefs={evidenceRefs}
        context={context}
        darkMode={darkMode}
        onOpen={onOpen}
      />
    </span>
  );
}
