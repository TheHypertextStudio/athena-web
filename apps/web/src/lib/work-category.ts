/**
 * The five status categories, as the interface reads them.
 *
 * @remarks
 * A workspace names its own statuses, so a status *key* means something only inside the workspace
 * that chose it. The category is fixed, and it is what a glyph, a colour token, a sub-group
 * header, and any ordering across workspaces read.
 *
 * This module holds only what is true everywhere. Anything that needs a workspace's actual
 * statuses — a picker, a settings list, a label for a specific status — reads them through
 * {@link import('@/components/statuses/status-registry').useStatusRegistry}.
 */
import { WORK_STATUS_CATEGORIES, type WorkStatusCategory } from '@docket/work/work-status-contract';

/** The canonical category ordering, from not-started to ended. */
export const CATEGORY_ORDER: readonly WorkStatusCategory[] = WORK_STATUS_CATEGORIES;

/**
 * The header label for each category.
 *
 * @remarks
 * Used where a list groups by category rather than by status — a view spanning several teams,
 * where the statuses themselves are named differently in each. These are the vocabulary-neutral
 * bucket names; a workspace's own status names are shown wherever a single set is in scope.
 */
export const CATEGORY_LABEL: Record<WorkStatusCategory, string> = {
  backlog: 'Backlog',
  unstarted: 'Todo',
  started: 'In Progress',
  completed: 'Done',
  canceled: 'Canceled',
};

/** What each category means, shown where someone is choosing one. */
export const CATEGORY_DESCRIPTION: Record<WorkStatusCategory, string> = {
  backlog: 'Captured, waiting to be picked up.',
  unstarted: 'Committed to and ready to start.',
  started: 'Being worked on now.',
  completed: 'Finished. Counts towards progress.',
  canceled: 'Dropped without being finished.',
};

/**
 * The sort rank of a category, with anything unrecognized sorting last.
 *
 * @param category - The category to rank.
 * @returns its index in {@link CATEGORY_ORDER}.
 *
 * @example
 * ```ts
 * rows.sort((a, b) => categoryRank(a.stateType) - categoryRank(b.stateType));
 * ```
 */
export function categoryRank(category: WorkStatusCategory | undefined): number {
  const index = category === undefined ? -1 : CATEGORY_ORDER.indexOf(category);
  return index === -1 ? CATEGORY_ORDER.length : index;
}

/** Whether work in this category has ended, one way or the other. */
export function isEnded(category: WorkStatusCategory): boolean {
  return category === 'completed' || category === 'canceled';
}

/**
 * Resolve a stored status key to the category it behaves as.
 *
 * @remarks
 * The parameter type the screen-level hooks and the pure helpers take instead of reaching for the
 * status registry themselves. A key means something only against one workspace's set, so the
 * component that already has that set in hand hands the answer down — which keeps these modules
 * free of React context and readable in a test with no registry mounted.
 *
 * @example
 * ```tsx
 * const statuses = useStatusRegistry();
 * const categoryOf = useCallback(
 *   (state: string) => statuses.categoryOf('task', state),
 *   [statuses],
 * );
 * ```
 */
export type CategoryOfState = (state: string) => WorkStatusCategory;
