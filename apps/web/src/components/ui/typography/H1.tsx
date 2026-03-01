import type { HTMLAttributes } from 'react';
import { cn } from '../utils';

export interface H1Props extends HTMLAttributes<HTMLHeadingElement> {
  /**
   * When provided, applies the standard light/dark foreground colour.
   * Omit when the caller supplies a custom colour via `className`.
   */
  darkMode?: boolean;
}

/**
 * Page-level heading.
 *
 * Default: `text-3xl font-semibold leading-tight`
 * Colour: controlled by `darkMode` prop or caller's `className`.
 *
 * @example
 *   <H1 darkMode={darkMode} className="mb-2">Settings</H1>
 */
export function H1({ darkMode, className, children, ...rest }: H1Props) {
  return (
    <h1
      className={cn(
        'text-3xl font-semibold leading-tight',
        darkMode !== undefined && (darkMode ? 'text-white' : 'text-gray-900'),
        className,
      )}
      {...rest}
    >
      {children}
    </h1>
  );
}
