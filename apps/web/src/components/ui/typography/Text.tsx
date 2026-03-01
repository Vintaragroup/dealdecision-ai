import type { HTMLAttributes, ElementType } from 'react';
import { cn } from '../utils';

export interface TextProps extends HTMLAttributes<HTMLElement> {
  /** Render as a different element. Default: `p`. */
  as?: ElementType;
  darkMode?: boolean;
}

/**
 * Body / default text.
 *
 * Default: `text-sm leading-relaxed`
 *
 * @example
 *   <Text darkMode={darkMode}>Manage your account settings and preferences</Text>
 */
export function Text({ as: Tag = 'p', darkMode, className, children, ...rest }: TextProps) {
  return (
    <Tag
      className={cn(
        'text-sm leading-relaxed',
        darkMode !== undefined && (darkMode ? 'text-gray-300' : 'text-gray-700'),
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}
