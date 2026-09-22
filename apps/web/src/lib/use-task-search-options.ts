'use client';

/**
 * Server-searched task choices for a relation picker: blocker, blocked task, related task, subtask,
 * or parent.
 *
 * @remarks
 * Relation pickers used to read every task in the workspace and filter on the client. This reads
 * the org search route with `kinds=task` instead, so the list stays fast in a large workspace and
 * an empty box browses recently touched tasks. The caller names the tasks it must not offer (the
 * task itself, and whatever it is already linked to); the server does the narrowing, so the
 * picker is used with `filter="none"`.
 */
import type { PickerOption } from '@docket/ui/components';
import { ProjectId, TaskId } from '@docket/work/ids';
import type { TaskRef } from '@docket/work/task-model';
import { useCallback, useMemo, useState } from 'react';

import { api } from './api';
import { type SearchOut, type SearchResult, searchFacetString } from './contracts/search';
import { queryKeys, STALE } from './query';
import { useRemoteSearch } from './use-remote-search';

/** A browse-or-match page size: enough to scroll, small enough to answer quickly. */
const SEARCH_LIMIT = 20;

/** The search route's largest page. */
const MAX_LIMIT = 100;

/** Quiet period before a term reaches the server; the org route is an indexed local read. */
const DEBOUNCE_MS = 120;

/** How often an open picker with nothing to browse asks again, while the index catches up. */
const EMPTY_RETRY_MS = 2_000;

/** How many answers an empty browse waits through before it stops asking. */
const EMPTY_RETRIES = 5;

/** What {@link useTaskSearchOptions} needs. */
export interface TaskSearchOptionsInput {
  readonly orgId: string;
  /** Issue requests only while the picker is open. */
  readonly enabled: boolean;
  /** Task ids never offered: the subject task and every task already in the relation. */
  readonly exclude: ReadonlySet<string>;
  /** Build a row's leading glyph from the task's workflow-state key. */
  readonly iconFor: (state: string | null) => PickerOption['icon'];
  /** Name a project id for the row's trailing hint; return `null` to show none. */
  readonly projectName?: ((projectId: string) => string | null) | undefined;
}

/** What a relation picker renders from. */
export interface TaskSearchOptions {
  readonly options: readonly PickerOption[];
  /** The task each offered row stands for, so a choice can be shown before the server answers. */
  readonly refFor: (taskId: string) => TaskRef | null;
  readonly query: string;
  readonly setQuery: (query: string) => void;
  readonly loading: boolean;
  /** Application-owned copy when the search failed, else `null`. */
  readonly error: string | null;
}

/**
 * Turn search hits into picker rows, dropping non-tasks and excluded ids.
 *
 * @param hits - The search page.
 * @param input - The exclusions and row decorations.
 * @returns the rows, in search rank order.
 */
export function taskSearchOptions(
  hits: readonly SearchResult[],
  input: Pick<TaskSearchOptionsInput, 'exclude' | 'iconFor' | 'projectName'>,
): readonly PickerOption[] {
  const options: PickerOption[] = [];
  for (const hit of hits) {
    if (hit.kind !== 'task' || input.exclude.has(hit.entityId)) continue;
    const projectId = searchFacetString(hit, 'projectId');
    const hint = projectId && input.projectName ? input.projectName(projectId) : null;
    options.push({
      value: hit.entityId,
      label: hit.title,
      icon: input.iconFor(searchFacetString(hit, 'state')),
      ...(hint ? { hint } : {}),
    });
  }
  return options;
}

/**
 * Search the workspace's tasks for a relation picker.
 *
 * @param input - See {@link TaskSearchOptionsInput}.
 * @returns the rows and the search box state.
 */
export function useTaskSearchOptions(input: TaskSearchOptionsInput): TaskSearchOptions {
  const { orgId, enabled, exclude, iconFor, projectName } = input;
  const [query, setQuery] = useState('');
  const browsing = query.trim().length === 0;
  // Excluded tasks are dropped after the answer arrives, so ask for enough to fill a page anyway.
  const limit = String(Math.min(MAX_LIMIT, SEARCH_LIMIT + exclude.size));
  const search = useRemoteSearch<SearchOut>({
    query,
    debounceMs: DEBOUNCE_MS,
    enabled: enabled && orgId.length > 0,
    key: (term) => [...queryKeys.search('org', term, orgId), 'task'],
    fetch: (term) =>
      api.v1.orgs[':orgId'].search.$get({
        param: { orgId },
        // The default (`page`) surface: an empty box browses every task, newest first.
        query: { ...(term.length > 0 ? { q: term } : {}), kinds: 'task', limit },
      }),
    fallbackMessage: 'Could not search tasks.',
    // Read afresh each time a picker opens. While an empty box has nothing to browse, ask again a
    // few times: the search index trails a write by a moment, so a workspace's first tasks may not
    // be searchable yet the first time someone looks.
    options: {
      staleTime: STALE.realtime,
      refetchInterval: (cached) =>
        browsing &&
        (cached.state.data?.items.length ?? 0) === 0 &&
        cached.state.dataUpdateCount < EMPTY_RETRIES
          ? EMPTY_RETRY_MS
          : false,
    },
  });
  const hits = search.data?.items;
  const options = useMemo(
    () => taskSearchOptions(hits ?? [], { exclude, iconFor, projectName }),
    [exclude, hits, iconFor, projectName],
  );
  const refs = useMemo(
    () => new Map((hits ?? []).map((hit) => [hit.entityId, taskRefOf(hit)])),
    [hits],
  );
  const refFor = useCallback((taskId: string): TaskRef | null => refs.get(taskId) ?? null, [refs]);
  return { options, refFor, query, setQuery, loading: search.pending, error: search.error };
}

/**
 * The task a search hit stands for.
 *
 * @param hit - A `task` search hit.
 * @returns its reference, with the state and project the hit's facets carry.
 */
export function taskRefOf(hit: SearchResult): TaskRef {
  const projectId = searchFacetString(hit, 'projectId');
  return {
    id: TaskId.parse(hit.entityId),
    title: hit.title,
    state: searchFacetString(hit, 'state') ?? '',
    projectId: projectId === null ? null : ProjectId.parse(projectId),
  };
}
