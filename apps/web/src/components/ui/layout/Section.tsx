import type { ReactNode } from 'react';
import { cn } from '../utils';

/**
 * Vertical padding values constrained to the TARGET spacing scale.
 */
export type SectionPad = 0 | 2 | 4 | 6 | 8 | 10 | 12 | 16 | 20 | 24;

const PY: Record<SectionPad, string> = {
  0:  'py-0',
  2:  'py-2',
  4:  'py-4',
  6:  'py-6',
  8:  'py-8',
  10: 'py-10',
  12: 'py-12',
  16: 'py-16',
  20: 'py-20',
  24: 'py-24',
};

export interface SectionProps extends React.HTMLAttributes<HTMLElement> {
  /** Vertical padding. Must be a TARGET scale key. Default: 6 */
  py?: SectionPad;
  children?: ReactNode;
}

/**
 * Semantic `<section>` block with controlled vertical padding.
 * Combine with `Stack` for inner content spacing.
 *
 * @example
 *   <Section py={12}>
 *     <Stack gap={6}>
 *       <Heading />
 *       <Body />
 *     </Stack>
 *   </Section>
 */
export function Section({ py = 6, className, children, ...rest }: SectionProps) {
  return (
    <section className={cn(PY[py], className)} {...rest}>
      {children}
    </section>
  );
}
