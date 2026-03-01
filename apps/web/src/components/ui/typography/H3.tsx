import type { HTMLAttributes } from 'react';
import { cn } from '../utils';

export interface H3Props extends HTMLAttributes<HTMLHeadingElement> {
  darkMode?: boolean;
}

/**
 * Card/subsection heading.
 *
 * Default: `font-semibold` — no fixed size so callers can combine with `text-sm`,
 * `text-base`, `text-lg`, etc. as needed.
 *
 * @example
 *   <H3 darkMode={darkMode} className="mb-1">ROI & Savings</H3>
 *   <H3 darkMode={darkMode} className="text-lg">Investor Insights</H3>
 *   <H3 className="text-sm text-zinc-300 mb-5">Score Understanding</H3>
 */
export function H3({ darkMode, className, children, ...rest }: H3Props) {
  return (
    <h3
      className={cn(
        'font-semibold',
        darkMode !== undefined && (darkMode ? 'text-white' : 'text-gray-900'),
        className,
      )}
      {...rest}
    >
      {children}
    </h3>
  );
}
