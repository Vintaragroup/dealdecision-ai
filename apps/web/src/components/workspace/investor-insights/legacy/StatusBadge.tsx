/**
 * StatusBadge — standardised coloured pill used throughout the Investor
 * Insights decision surface.  Replaces ad-hoc inline badge classes.
 *
 * Variants:
 *   green  → positive / computable / GO
 *   amber  → caution / partial / INVESTIGATE
 *   gray   → neutral / missing / not assessed
 *   red    → risk / fail / PASS-filter
 *   blue   → informational / running
 */

import React from 'react';

export type StatusBadgeVariant = 'green' | 'amber' | 'gray' | 'red' | 'blue';

export interface StatusBadgeProps {
  variant: StatusBadgeVariant;
  label: string;
  icon?: React.ReactNode;
  size?: 'sm' | 'md';
  darkMode?: boolean;
}

const DARK: Record<StatusBadgeVariant, string> = {
  green: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300',
  amber: 'bg-amber-500/15  border-amber-500/30  text-amber-300',
  gray:  'bg-white/5       border-white/15       text-gray-400',
  red:   'bg-red-500/15    border-red-500/30    text-red-300',
  blue:  'bg-blue-500/15   border-blue-500/30   text-blue-300',
};

const LIGHT: Record<StatusBadgeVariant, string> = {
  green: 'bg-emerald-50 border-emerald-200 text-emerald-700',
  amber: 'bg-amber-50   border-amber-200   text-amber-700',
  gray:  'bg-gray-100   border-gray-200    text-gray-500',
  red:   'bg-red-50     border-red-200     text-red-700',
  blue:  'bg-blue-50    border-blue-200    text-blue-700',
};

export function StatusBadge({
  variant,
  label,
  icon,
  size = 'sm',
  darkMode = true,
}: StatusBadgeProps) {
  const palette = darkMode ? DARK : LIGHT;
  const cls = palette[variant] ?? palette.gray;
  const sizeClass = size === 'md' ? 'px-2.5 py-1 text-xs' : 'px-2 py-0.5 text-xs';

  return (
    <span
      className={`inline-flex items-center gap-1 ${sizeClass} rounded-full font-medium border ${cls}`}
    >
      {icon && <span className="shrink-0 leading-none">{icon}</span>}
      {label}
    </span>
  );
}
