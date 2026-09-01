import { workViewGroupPathKey } from './renderer-types';
import type { WorkViewGroup } from '@docket/types';

/** The continuation state owned by one root or server group path. */
export interface WorkViewPageState<TRow extends { readonly id: string }> {
  readonly path: readonly string[];
  readonly rows: readonly TRow[];
  readonly nextCursor: string | null;
  readonly retryCursor: string | null;
  readonly loading: boolean;
  readonly error: unknown;
}

/** Continuation pages indexed by the canonical serialized group path. */
export type WorkViewPages<TRow extends { readonly id: string }> = Readonly<
  Record<string, WorkViewPageState<TRow>>
>;

/** An empty root or grouped continuation page collection. */
export function emptyWorkViewPages<TRow extends { readonly id: string }>(): WorkViewPages<TRow> {
  return {};
}

/** Return the continuation state for one group path. */
export function workViewPageForPath<TRow extends { readonly id: string }>(
  pages: WorkViewPages<TRow>,
  path: readonly string[],
): WorkViewPageState<TRow> | undefined {
  return pages[workViewGroupPathKey(path)];
}

/** One transition for an independently paginated root or group page. */
export type WorkViewPagesAction<TRow extends { readonly id: string }> =
  | { readonly type: 'request'; readonly path: readonly string[]; readonly cursor: string | null }
  | {
      readonly type: 'success';
      readonly path: readonly string[];
      readonly cursor: string | null;
      readonly rows: readonly TRow[];
      readonly nextCursor: string | null;
    }
  | {
      readonly type: 'failure';
      readonly path: readonly string[];
      readonly cursor: string | null;
      readonly error: unknown;
    };

function mergeRows<TRow extends { readonly id: string }>(
  existing: readonly TRow[],
  next: readonly TRow[],
): readonly TRow[] {
  const rows = new Map(existing.map((row) => [row.id, row]));
  for (const row of next) rows.set(row.id, row);
  return [...rows.values()];
}

/** Apply one path-scoped continuation request, result, or failure. */
export function reduceWorkViewPages<TRow extends { readonly id: string }>(
  pages: WorkViewPages<TRow>,
  action: WorkViewPagesAction<TRow>,
): WorkViewPages<TRow> {
  const key = workViewGroupPathKey(action.path);
  const current = pages[key];
  const base: WorkViewPageState<TRow> = current ?? {
    path: action.path,
    rows: [],
    nextCursor: null,
    retryCursor: null,
    loading: false,
    error: null,
  };
  if (action.type === 'request') {
    return {
      ...pages,
      [key]: { ...base, path: action.path, loading: true, error: null, retryCursor: action.cursor },
    };
  }
  if (action.type === 'success') {
    return {
      ...pages,
      [key]: {
        path: action.path,
        rows: action.cursor === null ? action.rows : mergeRows(base.rows, action.rows),
        nextCursor: action.nextCursor,
        retryCursor: null,
        loading: false,
        error: null,
      },
    };
  }
  return {
    ...pages,
    [key]: {
      ...base,
      path: action.path,
      loading: false,
      error: action.error,
      retryCursor: action.cursor,
    },
  };
}

/** Return loaded group pages in the exact order supplied by the server summaries. */
export function orderedWorkViewPages<TRow extends { readonly id: string }>(
  groups: readonly WorkViewGroup[],
  pages: WorkViewPages<TRow>,
): readonly WorkViewPageState<TRow>[] {
  return groups.flatMap((group) => {
    const page = workViewPageForPath(pages, group.path);
    return page ? [page] : [];
  });
}
