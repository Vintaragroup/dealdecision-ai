import type { ReactNode } from 'react';
import { cn } from '../utils';

/**
 * Gap values constrained to the TARGET spacing scale.
 */
export type ClusterGap = 1 | 2 | 3 | 4 | 5 | 6 | 8;

const GAP: Record<ClusterGap, string> = {
  1: 'gap-1',
  2: 'gap-2',
  3: 'gap-3',
  4: 'gap-4',
  5: 'gap-5',
  6: 'gap-6',
  8: 'gap-8',
};

export interface ClusterProps extends React.HTMLAttributes<HTMLElement> {
  /** Gap between children. Must be a TARGET scale key. Default: 2 */
  gap?: ClusterGap;
  /** Render as a different element (e.g. 'ul'). Default: 'div' */
  as?: React.ElementType;
  children?: ReactNode;
}

/**
 * Horizontal flex-wrap layout for badges, chips, buttons, and tags.
 *
 * Accepted gap values are limited to the TARGET spacing scale.
 *
 * @example
 *   <Cluster gap={2}>
 *     <Badge>Series A</Badge>
 *     <Badge>SaaS</Badge>
 *   </Cluster>
 */
export function Cluster({ gap = 2, className, children, as: Tag = 'div', ...rest }: ClusterProps) {
  return (
    <Tag className={cn('flex flex-wrap items-center', GAP[gap], className)} {...rest}>
      {children}
    </Tag>
  );
}
