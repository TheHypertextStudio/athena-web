'use client';

/**
 * Run the picker's result waves so the menu never blanks between keystrokes.
 *
 * @remarks
 * Two queries, two debounce values, one merged list.
 *
 * The local wave debounces at 90ms rather than the command palette's 180ms, and the difference is
 * measured rather than stylistic: the palette protects a cross-org fan-out at page scale, while
 * this is one org, eight rows, against an indexed table. 90ms keeps the whole round trip inside
 * the ~100ms window that reads as instantaneous, and still collapses a keystroke burst into one
 * request.
 *
 * The external wave debounces at 280ms and only runs once there are two characters to work with,
 * because each request costs a real OAuth round trip to somebody else's server.
 *
 * Both waves use `useApiListQuery`, whose `keepPreviousData` is what stops the list collapsing to
 * skeletons and re-expanding as the query narrows. Combined with the merge rules, the visible list
 * only ever narrows — it never blanks.
 */
import { useMemo } from 'react';
import type { MentionExternalOut, MentionItem, MentionSearchOut } from '@docket/types';

import { api } from '@/lib/api';
import { STALE } from '@/lib/query';
import { queryKeys } from '@/lib/query-keys';
import { useRemoteSearch } from '@/lib/use-remote-search';

import { buildMentionGroups, flattenMentionGroups, type MentionGroup } from './mention-merge';

/** Fast enough to feel like no wait at all, slow enough to collapse a burst of keystrokes. */
const LOCAL_DEBOUNCE_MS = 90;

/** Slower, because each of these is a round trip to someone else's server. */
const EXTERNAL_DEBOUNCE_MS = 280;

/** Below this, a provider query matches so much that it is noise rather than a result. */
const MIN_EXTERNAL_CHARS = 2;

/** What the menu needs to render. */
export interface MentionSearchState {
  readonly groups: readonly MentionGroup[];
  readonly items: readonly MentionItem[];
  /** True while the typed term has not yet reached the server. Drives the quiet trailing hint. */
  readonly localPending: boolean;
  /** True while provider results are still expected, which is what reserves their skeleton rows. */
  readonly externalPending: boolean;
  /** Set when the local wave failed; the menu shows app-owned copy, never this value. */
  readonly localFailed: boolean;
  /** Set when every provider failed; local rows stay, and the Files heading degrades. */
  readonly externalFailed: boolean;
}

/** What the picker is searching for, and whether it should search at all. */
export interface MentionSearchInput {
  /** The workspace whose entities and connections are in scope. */
  readonly orgId: string;
  /** What has been typed after the `@`. */
  readonly query: string;
  /** False while the menu is closed, which keeps both queries idle. */
  readonly enabled: boolean;
}

/**
 * Search both waves for the current query.
 *
 * @param input - The org, the typed query, and whether the menu is open at all.
 * @returns Grouped rows plus the pending and failure flags the menu renders from.
 */
export function useMentionSearch(input: MentionSearchInput): MentionSearchState {
  const trimmed = input.query.trim();

  // Two waves over one set of keystrokes, each with its own delay and its own idea of what is
  // worth asking for. `useRemoteSearch` covers one wave, so this calls it twice and merges below.
  const localQ = useRemoteSearch<MentionSearchOut>({
    query: input.query,
    debounceMs: LOCAL_DEBOUNCE_MS,
    enabled: input.enabled,
    key: (term) => queryKeys.mentionLocal(input.orgId, term),
    fetch: (term) =>
      api.v1.orgs[':orgId'].mentions.search.$get({
        param: { orgId: input.orgId },
        query: { q: term, limit: '8' },
      }),
    fallbackMessage: 'Could not search this workspace.',
    options: { staleTime: STALE.volatile },
  });

  const externalQ = useRemoteSearch<MentionExternalOut>({
    query: input.query,
    debounceMs: EXTERNAL_DEBOUNCE_MS,
    minChars: MIN_EXTERNAL_CHARS,
    enabled: input.enabled,
    key: (term) => queryKeys.mentionExternal(input.orgId, term),
    fetch: (term) =>
      api.v1.orgs[':orgId'].mentions.external.$get({
        param: { orgId: input.orgId },
        query: { q: term, limit: '6' },
      }),
    fallbackMessage: 'Could not search your connected apps.',
    options: { staleTime: STALE.standard },
  });

  const local = localQ.data?.items;
  const external = externalQ.data?.items;

  const groups = useMemo(
    () =>
      buildMentionGroups({
        local: local ?? [],
        external: external ?? [],
        hasQuery: trimmed.length > 0,
      }),
    [local, external, trimmed],
  );

  return {
    groups,
    items: flattenMentionGroups(groups),
    localPending: localQ.pending,
    externalPending: externalQ.pending,
    localFailed: localQ.failed,
    externalFailed: externalQ.failed,
  };
}
