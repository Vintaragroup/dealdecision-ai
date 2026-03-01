import type { HTMLAttributes, ElementType } from 'react';
import { cn } from '../utils';

export interface MutedTextProps extends HTMLAttributes<HTMLElement> {
  /** Render as a different element. Default: `p`. */
  as?: ElementType;
  darkMode?: boolean;
}

/**
 * Secondary / helper text in a muted tone.
 *
 * Default: `text-sm`
 * Colour: `text-gray-400` (dark) · `text-gray-600` (light)
 *
 * @example
 *   <MutedText darkMode={darkMode}>Stage 0 deterministic analysis</MutedText>
 *   <MutedText as="span" darkMode={darkMode} className="text-xs mt-1">Generated: …</MutedText>
 */
export function MutedText({ as: Tag = 'p', darkMode, className, children, ...rest }: MutedTextProps) {
  return (
    <Tag
      className={cn(
        'text-sm',
        darkMode !== undefined && (darkMode ? 'text-gray-400' : 'text-gray-600'),
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}
