import type { HTMLAttributes, ElementType } from 'react';
import { cn } from '../utils';

export interface BadgeLabelProps extends HTMLAttributes<HTMLElement> {
  /** Render as a different element. Default: `span`. */
  as?: ElementType;
}

/**
 * Micro text for badge / pill / chip labels.
 *
 * Default: `text-xs leading-none font-medium`
 *
 * Does NOT include padding, border, or colour — supply those via `className`.
 * This replaces arbitrary `text-[10px]` / `text-[11px]` usage in badge contexts.
 *
 * @example
 *   <BadgeLabel className={`px-2 py-0.5 rounded-full border ${statusTone}`}>
 *     {statusLabel}
 *   </BadgeLabel>
 *
 * @example
 *   // Micro annotation label (supply your own colour class)
 *   <BadgeLabel as="div" className={darkMode ? 'text-white/60' : 'text-black/60'}>
 *     Version
 *   </BadgeLabel>
 */
export function BadgeLabel({ as: Tag = 'span', className, children, ...rest }: BadgeLabelProps) {
  return (
    <Tag
      className={cn('text-xs leading-none font-medium', className)}
      {...rest}
    >
      {children}
    </Tag>
  );
}
