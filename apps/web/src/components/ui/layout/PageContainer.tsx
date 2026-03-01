import type { ReactNode } from 'react';
import { cn } from '../utils';

const MAX_W = {
  sm:   'max-w-sm',
  md:   'max-w-md',
  lg:   'max-w-lg',
  xl:   'max-w-xl',
  '2xl': 'max-w-2xl',
  '4xl': 'max-w-4xl',
  '6xl': 'max-w-6xl',
  '7xl': 'max-w-7xl',
  full: 'max-w-full',
} as const;

export type ContainerWidth = keyof typeof MAX_W;

export interface PageContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Max-width constraint. Default: '7xl' */
  maxWidth?: ContainerWidth;
  children?: ReactNode;
}

/**
 * Full-width page wrapper with centered max-width and standard horizontal padding.
 *
 * Horizontal padding uses `px-4` (mobile) → `sm:px-6` (small+), both TARGET keys.
 * Vertical rhythm is left to the caller (use `Section` or `Stack`).
 *
 * @example
 *   <PageContainer maxWidth="6xl">
 *     <Stack gap={8}>
 *       <PageHeader />
 *       <MainContent />
 *     </Stack>
 *   </PageContainer>
 */
export function PageContainer({ maxWidth = '7xl', className, children, ...rest }: PageContainerProps) {
  return (
    <div
      className={cn('mx-auto w-full px-4 sm:px-6', MAX_W[maxWidth], className)}
      {...rest}
    >
      {children}
    </div>
  );
}
