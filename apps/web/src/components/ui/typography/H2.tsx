import type { HTMLAttributes } from 'react';
import { cn } from '../utils';

export interface H2Props extends HTMLAttributes<HTMLHeadingElement> {
  darkMode?: boolean;
}

/**
 * Section-level heading.
 *
 * Default: `text-xl font-semibold leading-snug`
 *
 * @example
 *   <H2 darkMode={darkMode} className="mb-4">Financial Health</H2>
 */
export function H2({ darkMode, className, children, ...rest }: H2Props) {
  return (
    <h2
      className={cn(
        'text-xl font-semibold leading-snug',
        darkMode !== undefined && (darkMode ? 'text-white' : 'text-gray-900'),
        className,
      )}
      {...rest}
    >
      {children}
    </h2>
  );
}
