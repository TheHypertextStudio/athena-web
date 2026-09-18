'use client';

/**
 * `lib/drafts/defs` — typed reads and writes for the composer drafting system.
 *
 * @remarks
 * A composer draft is the unsent state of a create composer, kept on the server so it survives a
 * close, a reload, and a change of device. There is one list query for every draft the person
 * has, across workspaces: the sidebar's Drafts entry, the composer's Drafts chip, and the Drafts
 * page all read it, so the three can never disagree about what exists. Writes update that list in
 * place and are made against the revision the writer last saw; a stale-revision refusal is
 * rebased once by reading the draft again and writing the whole payload over it.
 *
 * The resume-drafts preference lives in the caller's Hub preferences under `composer`. It is read
 * through the shared `hubPreferences` key so the Profile settings row and every composer see the
 * same cached value and the same invalidation after a PATCH.
 */
import { OrganizationId } from '@docket/identity-access/ids';
import type {
  ComposerDraftKind,
  ComposerDraftListOut,
  ComposerDraftOut,
  ComposerDraftPayload,
} from '@docket/work/composer-draft-contract';
import { type QueryClient, type UseQueryResult, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { api } from '@/lib/api';
import { UserFacingError, readProblemError } from '@/lib/problem';
import { STALE, apiQueryOptions, unwrap } from '@/lib/query-core';
import { queryKeys, useApiListQuery, useLiveApiQuery } from '@/lib/query';

/** How often the preference read refreshes while a subscribed surface is on screen. */
const HUB_PREFERENCES_POLL_MS = 15_000;

/**
 * Whether opening a create composer should reopen the newest pending draft of that kind.
 *
 * @returns `true` only when the preference is stored as `true`; absent, loading, or failed reads
 * resolve to `false`, so the composer opens empty until the preference is known.
 */
export function useResumeDraftsPreference(): boolean {
  const preferencesQ = useLiveApiQuery(
    apiQueryOptions(
      queryKeys.hubPreferences(),
      () => api.v1.hub.preferences.$get(),
      'Could not load your preferences.',
    ),
    HUB_PREFERENCES_POLL_MS,
  );
  return preferencesQ.data?.composer?.resumeDrafts === true;
}

/**
 * Definition for `GET /v1/me/drafts`: every draft the person can return to.
 *
 * @param enabled - `false` while the caller has no signed-in identity to read drafts for.
 */
export function draftsDef(enabled = true) {
  return apiQueryOptions<ComposerDraftListOut>(
    queryKeys.drafts(),
    () => api.v1.me.drafts.$get({ query: {} }),
    'Could not load your drafts.',
    { staleTime: STALE.volatile, enabled },
  );
}

/** Read every draft the person has, as a list query. */
export function useComposerDrafts(enabled = true): UseQueryResult<ComposerDraftListOut> {
  return useApiListQuery(draftsDef(enabled));
}

/** How many drafts the person can return to; zero until the list has loaded. */
export function useDraftCount(enabled = true): number {
  return useComposerDrafts(enabled).data?.items.length ?? 0;
}

/** Fetch one draft, bypassing the cache. */
export async function fetchComposerDraft(draftId: string): Promise<ComposerDraftOut> {
  return unwrap(
    () => api.v1.me.drafts[':id'].$get({ param: { id: draftId } }),
    'Could not load that draft.',
  );
}

/** Where a new draft is created. */
export interface ComposerDraftCreation {
  readonly organizationId: string;
  readonly kind: ComposerDraftKind;
  readonly payload: ComposerDraftPayload;
}

/** Create a draft row for a composer that has just become worth keeping. */
export async function createComposerDraft(
  creation: ComposerDraftCreation,
): Promise<ComposerDraftOut> {
  return unwrap(
    () =>
      api.v1.me.drafts.$post({
        json: {
          organizationId: OrganizationId.parse(creation.organizationId),
          kind: creation.kind,
          payload: creation.payload,
        },
      }),
    'Could not save your draft.',
  );
}

async function patchComposerDraftOnce(
  draftId: string,
  revision: number,
  payload: ComposerDraftPayload,
): Promise<ComposerDraftOut> {
  return unwrap(
    () =>
      api.v1.me.drafts[':id'].$patch({
        param: { id: draftId },
        json: { revision, payload },
      }),
    'Could not save your draft.',
  );
}

/** Whether a failure is the API refusing a write made against an old revision. */
function isStaleRevision(error: unknown): boolean {
  return error instanceof UserFacingError && error.status === 412;
}

/**
 * Write a draft's whole payload against the revision last seen, rebasing once on a stale refusal.
 *
 * @remarks
 * A composer holds the whole draft, so the rebase is a replay of the same payload over whatever
 * the server has now: last writer wins, which is the right answer for one person's own draft open
 * in two tabs.
 */
export async function patchComposerDraft(
  draftId: string,
  revision: number,
  payload: ComposerDraftPayload,
): Promise<ComposerDraftOut> {
  try {
    return await patchComposerDraftOnce(draftId, revision, payload);
  } catch (caught) {
    if (!isStaleRevision(caught)) throw caught;
    const fresh = await fetchComposerDraft(draftId);
    return patchComposerDraftOnce(draftId, fresh.revision, payload);
  }
}

/** Delete a draft the person no longer wants; a draft already gone is not an error. */
export async function deleteComposerDraft(draftId: string): Promise<void> {
  // A delete answers 204 with no body, so it cannot go through `unwrap`, which parses one. The
  // typed client only names the 204, so the response is read as a plain `Response` to see a 404.
  const response: Response = await api.v1.me.drafts[':id'].$delete({ param: { id: draftId } });
  if (response.ok) return;
  const error = await readProblemError(response, 'Could not delete that draft.');
  if (error.status === 404) return;
  throw error;
}

/** Put a draft the server just returned into the list cache, replacing any older copy. */
export function upsertDraftInCache(queryClient: QueryClient, draft: ComposerDraftOut): void {
  queryClient.setQueryData<ComposerDraftListOut>(queryKeys.drafts(), (current) => {
    const others = (current?.items ?? []).filter((item) => item.id !== draft.id);
    return { items: [draft, ...others] };
  });
}

/** Take a deleted draft out of the list cache. */
export function removeDraftFromCache(queryClient: QueryClient, draftId: string): void {
  queryClient.setQueryData<ComposerDraftListOut>(queryKeys.drafts(), (current) => {
    if (!current) return current;
    return { items: current.items.filter((item) => item.id !== draftId) };
  });
}

/** The list-cache writers, bound to the ambient query client. */
export interface DraftCacheWriters {
  readonly upsert: (draft: ComposerDraftOut) => void;
  readonly remove: (draftId: string) => void;
}

/** The list-cache writers, bound to the ambient query client. */
export function useDraftCacheWriters(): DraftCacheWriters {
  const queryClient = useQueryClient();
  const upsert = useCallback(
    (draft: ComposerDraftOut) => {
      upsertDraftInCache(queryClient, draft);
    },
    [queryClient],
  );
  const remove = useCallback(
    (draftId: string) => {
      removeDraftFromCache(queryClient, draftId);
    },
    [queryClient],
  );
  return { upsert, remove };
}
