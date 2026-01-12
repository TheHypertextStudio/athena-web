/**
 * Page container component for consistent content width constraints.
 *
 * Provides a standardized wrapper that enforces responsive width limits
 * across different page types, preventing content from stretching to
 * unusable widths on large screens.
 *
 * @packageDocumentation
 */

import { cn } from '@/lib/utils';

const widthClasses = {
  narrow: 'max-w-2xl', // 672px - forms, single-column content
  medium: 'max-w-3xl', // 768px - detail views
  standard: 'max-w-4xl', // 896px - lists, most pages (default)
  wide: 'max-w-6xl', // 1152px - dashboards, calendars
  full: '', // no constraint
} as const;

type MaxWidth = keyof typeof widthClasses;

export interface PageContainerProps {
  /** Content to render within the container */
  children: React.ReactNode;
  /** Maximum width tier for the content */
  maxWidth?: MaxWidth;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Container component that enforces consistent page content widths.
 *
 * @example
 * ```tsx
 * // Standard list page (896px max)
 * <PageContainer>
 *   <TaskListView />
 * </PageContainer>
 *
 * // Wide dashboard (1152px max)
 * <PageContainer maxWidth="wide">
 *   <DashboardGrid />
 * </PageContainer>
 *
 * // Narrow form (672px max)
 * <PageContainer maxWidth="narrow">
 *   <TaskForm />
 * </PageContainer>
 * ```
 */
export function PageContainer({ children, maxWidth = 'standard', className }: PageContainerProps) {
  return <div className={cn('mx-auto w-full', widthClasses[maxWidth], className)}>{children}</div>;
}
