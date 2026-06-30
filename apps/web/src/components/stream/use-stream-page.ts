'use client';

/**
 * `stream` — the shared data hook behind both stream routes.
 *
 * @remarks
 * One hook for the cross-org personal feed (`scope: 'me'`) and the per-workspace firehose
 * (`scope: 'org'`): it holds the filter {@link useViewState} (URL-persisted), derives the
 * server query params from it, runs the cursor-paginated live read (`useLiveInfiniteApiQuery` —
 * the polling-now/SSE-later seam), and flattens the pages into rows. It returns exactly the data
 * half of {@link StreamViewProps}; the page supplies the drawer `onSelect` + row `actions`.
 */
import type { StreamPageOut } from '@docket/types';
import { useMemo } from 'react';

import { useActiveOrg } from '@/components/active-org';
import type { FieldOption } from '@/components/views/field-catalog';
import { useViewState } from '@/components/views/use-view-state';
import { api } from '@/lib/api';
import { apiInfiniteQueryOptions, queryKeys, STALE, useLiveInfiniteApiQuery } from '@/lib/query';

import { buildStreamCatalog } from './stream-catalog';
import { toRow } from './stream-meta';
import { streamQueryFromViewState, streamQueryKeyPart } from './stream-query';
import type { StreamViewProps } from './stream-view';

/** Focus-gated poll interval (ms) — matches the inbox cadence; SSE later replaces it. */
const STREAM_POLL_MS = 15_000;

/** Arguments for {@link useStreamPage}. */
export interface UseStreamPageArgs {
  /** `me` = cross-org personal feed; `org` = a single workspace's firehose. */
  readonly scope: 'me' | 'org';
  /** The workspace id when `scope === 'org'`. */
  readonly orgId?: string;
}

/** The data half of {@link StreamViewProps} the page spreads into `<StreamView>`. */
type StreamPageData = Omit<StreamViewProps, 'actions' | 'onSelect' | 'saveSlot' | 'now'>;

/** Wire the filter state + live cursor read for a stream scope. */
export function useStreamPage(args: UseStreamPageArgs): StreamPageData {
  const { state, setFilters, setGroupBy, setSort } = useViewState();
  const { orgs } = useActiveOrg();

  const resolveOrgName = useMemo(() => {
    const byId = new Map<string, string>(orgs.map((o) => [o.id, o.name]));
    return (id: string): string => byId.get(id) ?? 'Workspace';
  }, [orgs]);
  const orgOptions = useMemo(
    () => (): readonly FieldOption[] => orgs.map((o) => ({ value: o.id, label: o.name })),
    [orgs],
  );

  const catalog = useMemo(
    () => buildStreamCatalog({ scope: args.scope, resolveOrgName, orgOptions }),
    [args.scope, resolveOrgName, orgOptions],
  );

  const params = useMemo(() => streamQueryFromViewState(state), [state]);
  const keyPart = streamQueryKeyPart(params);
  const orgId = args.orgId ?? '';

  const def = useMemo(() => {
    const query = (cursor: string | undefined) => ({
      order: params.order,
      limit: '50',
      ...(params.filter ? { filter: params.filter } : {}),
      ...(cursor ? { cursor } : {}),
    });
    return args.scope === 'me'
      ? apiInfiniteQueryOptions<StreamPageOut>(
          queryKeys.streamMe(keyPart),
          (cursor) => api.v1.hub.stream.$get({ query: query(cursor) }),
          (last) => last.nextCursor,
          'Could not load your stream.',
          { staleTime: STALE.volatile },
        )
      : apiInfiniteQueryOptions<StreamPageOut>(
          queryKeys.streamOrg(orgId, keyPart),
          (cursor) => api.v1.orgs[':orgId'].stream.$get({ param: { orgId }, query: query(cursor) }),
          (last) => last.nextCursor,
          'Could not load the stream.',
          { staleTime: STALE.volatile },
        );
  }, [args.scope, orgId, keyPart, params]);

  const q = useLiveInfiniteApiQuery(def, STREAM_POLL_MS);
  const events = useMemo(
    () => (q.data?.pages ?? []).flatMap((page) => page.items.map(toRow)),
    [q.data],
  );

  return {
    scope: args.scope,
    catalog,
    state,
    onFiltersChange: setFilters,
    onGroupByChange: setGroupBy,
    onSortChange: setSort,
    events,
    loading: q.isLoading,
    error: q.isError ? q.error.message : null,
    onRetry: () => void q.refetch(),
    hasNextPage: q.hasNextPage,
    isFetchingNextPage: q.isFetchingNextPage,
    fetchNextPage: () => void q.fetchNextPage(),
    resolveOrgName,
  };
}
