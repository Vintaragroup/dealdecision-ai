import type { ReactNode } from 'react';
import { cn } from '../utils';

/**
 * Gap values constrained to the TARGET spacing scale.
 * See docs/Active/webapp-ui/DESIGN_SYSTEM.md for the full allowlist.
 */
export type StackGap = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 8 | 10 | 12 | 16 | 20 | 24;

// Explicit literal map so Tailwind's class scanner captures every class name.
const GAP: Record<StackGap, string> = {
  0:  'gap-0',
  1:  'gap-1',
  2:  'gap-2',
  3:  'gap-3',
  4:  'gap-4',
  5:  'gap-5',
  6:  'gap-6',
  8:  'gap-8',
  10: 'gap-10',
  12: 'gap-12',
  16: 'gap-16',
  20: 'gap-20',
  24: 'gap-24',
};

export interface StackProps extends React.HTMLAttributes<HTMLElement> {
  /** Gap between children. Must be a TARGET scale key. Default: 4 */
  gap?: StackGap;
  /** Render as a different element (e.g. 'ul', 'section'). Default: 'div' */
  as?: React.ElementType;
  children?: ReactNode;
}

/**
 * Vertical flex-column layout with constrained gap.
 *
 * Accepted gap values are limited to the TARGET spacing scale so that
 * off-scale values cannot enter the codebase through layout primitives.
 *
 * @example
 *   <Stack gap={6}>
 *     <Header />
 *     <Body />
 *   </Stack>
 */
export function Stack({ gap = 4, className, children, as: Tag = 'div', ...rest }: StackProps) {
  return (
    <Tag className={cn('flex flex-col', GAP[gap], className)} {...rest}>
      {children}
    </Tag>
  );
}
