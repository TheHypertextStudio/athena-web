import type { EntityTableContinuation, EntityTableGroup } from '@docket/ui/components';
import type { ViewTarget } from '@docket/work/view-contract';

import {
  type WorkViewGroupPage,
  type WorkViewGroupSummary,
  type WorkViewRowFor,
  workViewGroupPathKey,
} from './renderer-types';
import { orderInitiativeTreeNodes, type InitiativeRailNode } from './initiative-rails';

/** One path-scoped occurrence of a work-view row. */
export interface ListMembership<TTarget extends ViewTarget> {
  /** Full path-scoped identity. */
  readonly key: string;
  /** Server group path that owns this occurrence. */
  readonly path: readonly string[];
  /** The projected entity row. */
  readonly row: WorkViewRowFor<TTarget>;
}

/** Rows and groups ready for the shared EntityTable. */
export interface WorkListRoster<TTarget extends ViewTarget> {
  /** All visible memberships in rendered server-summary order. */
  readonly memberships: readonly ListMembership<TTarget>[];
  /** Flat rows for an ungrouped roster. */
  readonly rows: readonly ListMembership<TTarget>[] | undefined;
  /** Nested groups for a grouped roster. */
  readonly groups: readonly EntityTableGroup<ListMembership<TTarget>>[] | undefined;
}

/** Inputs needed to adapt one server work-view response to EntityTable. */
export interface BuildWorkListRosterOptions<TTarget extends ViewTarget> {
  readonly target: TTarget;
  readonly grouped: boolean;
  readonly rows: readonly WorkViewRowFor<TTarget>[];
  readonly summaries: readonly WorkViewGroupSummary[];
  readonly pages: readonly WorkViewGroupPage<TTarget>[];
  readonly onLoadMore?: ((path: readonly string[]) => void) | undefined;
}

const TARGET_PLURAL = {
  task: 'Tasks',
  project: 'Projects',
  program: 'Programs',
  initiative: 'Initiatives',
} as const;

/**
 * Return one stable full-path membership key without collapsing entity identity across groups.
 *
 * @param path - Exact server group path that owns the row occurrence.
 * @param rowId - Stable entity id shared by any duplicate context occurrence.
 * @returns the path-scoped membership key.
 */
export function workListMembershipKey(path: readonly string[], rowId: string): string {
  const owner = workViewGroupPathKey(path) || 'root';
  return `${owner}:${encodeURIComponent(rowId)}`;
}

/**
 * Return the flattened EntityTable key for one path-scoped membership.
 *
 * @param membership - Visible row occurrence and its full server path.
 * @returns the key emitted by EntityTable for that occurrence.
 */
export function workListEntityTableEntryKey<TTarget extends ViewTarget>(
  membership: ListMembership<TTarget>,
): string {
  const encodedMembership = encodeURIComponent(membership.key);
  const group = workViewGroupPathKey(membership.path);
  return group.length === 0 ? `r:${encodedMembership}` : `r:${group}:${encodedMembership}`;
}

/** Convert rows from one exact path into membership rows in visible Initiative hierarchy order. */
function membershipsForPath<TTarget extends ViewTarget>(
  target: TTarget,
  path: readonly string[],
  rows: readonly WorkViewRowFor<TTarget>[],
): readonly ListMembership<TTarget>[] {
  const memberships = rows.map((row) => ({
    key: workListMembershipKey(path, row.id),
    path,
    row,
  }));
  if (target !== 'initiative') return memberships;

  const byEntityId = new Map(memberships.map((membership) => [membership.row.id, membership]));
  const nodes: InitiativeRailNode[] = memberships.map((membership) => {
    const row = membership.row as WorkViewRowFor<'initiative'>;
    return {
      key: membership.key,
      parentKey:
        row.parent !== null && byEntityId.has(row.parent)
          ? workListMembershipKey(path, row.parent)
          : null,
    };
  });
  const byMembershipKey = new Map(memberships.map((membership) => [membership.key, membership]));
  return orderInitiativeTreeNodes(nodes).flatMap((node) => {
    const membership = byMembershipKey.get(node.key);
    return membership === undefined ? [] : [membership];
  });
}

/** Resolve one typed continuation from the state owned by its exact group page. */
function groupContinuation<TTarget extends ViewTarget>(
  label: string,
  page: WorkViewGroupPage<TTarget> | undefined,
  onLoadMore: ((path: readonly string[]) => void) | undefined,
): EntityTableContinuation | undefined {
  if (page === undefined) return undefined;
  const id = `work-list-continuation:${workViewGroupPathKey(page.path)}`;
  if (page.loading) return { id, label: `Loading ${label}`, state: 'loading' };
  if (page.error !== undefined && page.error !== null && onLoadMore !== undefined) {
    return {
      id,
      label: `Retry ${label}`,
      state: 'error',
      onActivate: () => {
        onLoadMore(page.path);
      },
    };
  }
  if (page.nextCursor !== null && onLoadMore !== undefined) {
    return {
      id,
      label: `Load more ${label}`,
      state: 'idle',
      onActivate: () => {
        onLoadMore(page.path);
      },
    };
  }
  return undefined;
}

/** Flatten membership rows from nested groups without deriving any server counts. */
function membershipsFromGroups<TTarget extends ViewTarget>(
  groups: readonly EntityTableGroup<ListMembership<TTarget>>[],
): readonly ListMembership<TTarget>[] {
  return groups.flatMap((group) => group.rows ?? membershipsFromGroups(group.children));
}

/** Build nested groups in root-summary order and subgroup-summary order. */
function nestedGroups<TTarget extends ViewTarget>(
  target: TTarget,
  summaries: readonly WorkViewGroupSummary[],
  pages: readonly WorkViewGroupPage<TTarget>[],
  onLoadMore: ((path: readonly string[]) => void) | undefined,
): readonly EntityTableGroup<ListMembership<TTarget>>[] {
  const pageByPath = new Map(pages.map((page) => [workViewGroupPathKey(page.path), page]));
  const rootSummaries = summaries.filter(({ path }) => path.length === 1);

  return rootSummaries.map((summary) => {
    const id = workViewGroupPathKey(summary.path);
    const page = pageByPath.get(id);
    const continuation = groupContinuation(summary.label, page, onLoadMore);
    const children = summaries.filter(
      ({ path }) => path.length === 2 && path[0] === summary.path[0],
    );
    const base = {
      id,
      label: summary.label,
      count: summary.count,
      ...(continuation === undefined ? {} : { continuation }),
    };
    if (children.length > 0) {
      return {
        ...base,
        children: children.map((child) => {
          const childId = workViewGroupPathKey(child.path);
          const childPage = pageByPath.get(childId);
          const childContinuation = groupContinuation(child.label, childPage, onLoadMore);
          return {
            id: childId,
            label: child.label,
            count: child.count,
            rows: membershipsForPath(target, child.path, childPage?.rows ?? []),
            ...(childContinuation === undefined ? {} : { continuation: childContinuation }),
          };
        }),
      };
    }
    return {
      ...base,
      rows: membershipsForPath(target, summary.path, page?.rows ?? []),
    };
  });
}

/**
 * Adapt direct rows and group pages without recomputing counts or cursor ownership.
 *
 * @param options - Direct response rows, ordered summaries, and path-scoped pages.
 * @returns EntityTable rows or groups plus their visible membership order.
 */
export function buildWorkListRoster<TTarget extends ViewTarget>({
  target,
  grouped,
  rows,
  summaries,
  pages,
  onLoadMore,
}: BuildWorkListRosterOptions<TTarget>): WorkListRoster<TTarget> {
  if (!grouped) {
    const memberships = membershipsForPath(target, [], rows);
    return { memberships, rows: memberships, groups: undefined };
  }
  const groups = nestedGroups(target, summaries, pages, onLoadMore);
  return { memberships: membershipsFromGroups(groups), rows: undefined, groups };
}

/**
 * Build the typed root-page continuation that replaces the old absolute button.
 *
 * @param target - Entity target whose plural appears in the application-owned label.
 * @param hasMoreRows - Whether the root response owns a next cursor.
 * @param loadingMoreRows - Whether that cursor is in flight.
 * @param rootContinuationError - Application-owned failure marker for the exact root cursor.
 * @param onLoadMoreRows - Root continuation activation callback.
 * @returns one typed continuation when root pagination needs a visible table entry.
 */
export function buildWorkListRootContinuation(
  target: ViewTarget,
  hasMoreRows: boolean,
  loadingMoreRows: boolean,
  rootContinuationError: unknown,
  onLoadMoreRows: (() => void) | undefined,
): EntityTableContinuation | undefined {
  if (
    onLoadMoreRows === undefined ||
    (!hasMoreRows && !loadingMoreRows && !rootContinuationError)
  ) {
    return undefined;
  }
  const id = `work-list-continuation:root:${target}`;
  if (loadingMoreRows) {
    return { id, label: `Loading more ${TARGET_PLURAL[target]}`, state: 'loading' };
  }
  if (rootContinuationError) {
    return {
      id,
      label: `Retry ${TARGET_PLURAL[target]}`,
      state: 'error',
      onActivate: onLoadMoreRows,
    };
  }
  return {
    id,
    label: `Load more ${TARGET_PLURAL[target]}`,
    state: 'idle',
    onActivate: onLoadMoreRows,
  };
}
