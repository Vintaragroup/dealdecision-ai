/**
 * Layout primitives for apps/web.
 *
 * All spacing values within these components are constrained to the TARGET
 * spacing scale defined in DESIGN_SYSTEM.md. Arbitrary values and off-scale
 * numbers are rejected at the TypeScript type level.
 *
 * Import from this barrel:
 *   import { Stack, Cluster, Section, PageContainer } from '../ui/layout';
 */
export { Stack } from './Stack';
export type { StackProps, StackGap } from './Stack';

export { Cluster } from './Cluster';
export type { ClusterProps, ClusterGap } from './Cluster';

export { Section } from './Section';
export type { SectionProps, SectionPad } from './Section';

export { PageContainer } from './PageContainer';
export type { PageContainerProps, ContainerWidth } from './PageContainer';
