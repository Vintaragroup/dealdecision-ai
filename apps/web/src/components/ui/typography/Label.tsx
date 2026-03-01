import type { HTMLAttributes, ElementType } from 'react';
import { cn } from '../utils';

export interface LabelProps extends HTMLAttributes<HTMLElement> {
  /** Render as a different element. Default: `span`. */
  as?: ElementType;
  darkMode?: boolean;
}

/**
 * Small UI label / metadata chip text.
 *
 * Default: `text-xs font-medium`
 * Colour: `text-gray-500` (both modes — intentionally neutral)
 *
 * @example
 *   <Label darkMode={darkMode} className="uppercase tracking-wider">Section</Label>
 */
export function Label({ as: Tag = 'span', darkMode, className, children, ...rest }: LabelProps) {
  return (
    <Tag
      className={cn(
        'text-xs font-medium',
        darkMode !== undefined ? 'text-gray-500' : undefined,
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}
