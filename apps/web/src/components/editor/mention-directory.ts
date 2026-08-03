'use client';

/**
 * The workspace's first-class objects, indexed for `@` mention search *and* for keeping already
 * inserted mentions showing their object's current title.
 *
 * @remarks
 * One hook serves both jobs on purpose. A mention stores an id, not a title, so something has to
 * answer "what is `project:01J…` called *right now*" every time a document renders — and that is
 * exactly the same question the autocomplete asks while someone types. Splitting them would mean
 * two sources of truth for the same fact, and the one that lagged would be the one people saw.
 *
 * The lists come from the workspace's ordinary list endpoints through the typed query layer, so
 * they are shared with (and invalidated by) every other surface: rename a project anywhere and
 * the cache entry these read is already refreshed. Nothing here fetches on its own schedule.
 *
 * Fetching is gated on `enabled` so an editor that has never seen an `@` and holds no mentions
 * costs nothing.
 */
import { useMemo } from 'react';

import { useApiListQuery } from '@/lib/query';
import { api } from '@/lib/api';
import { STALE, apiQueryOptions } from '@/lib/query-core';
import { queryKeys } from '@/lib/query-keys';

import { mentionKeyOf } from './mention-key';
import { publishMentionLabels } from './mention-labels';
import type { MentionKind } from './mention-node';

/** One mentionable object. */
export interface MentionEntry {
  /** The object kind. */
  readonly kind: MentionKind;
  /** The object id. */
  readonly id: string;
  /** The object's title as of the latest fetch. */
  readonly label: string;
  /** A quieter second line for disambiguation (e.g. a task's project). */
  readonly hint: string | null;
}

/** What {@link useMentionDirectory} returns. */
export interface MentionDirectory {
  /** Every mentionable object, in a stable order (kind, then title). */
  readonly entries: readonly MentionEntry[];
  /** `kind:id` → entry, for resolving an already-inserted mention's current title. */
  readonly byKey: ReadonlyMap<string, MentionEntry>;
  /** True while any of the underlying lists is still loading for the first time. */
  readonly isPending: boolean;
}

/** Order kinds appear in the menu — the things people reference most, first. */
const KIND_ORDER: readonly MentionKind[] = [
  'task',
  'project',
  'initiative',
  'program',
  'cycle',
  'person',
];

/**
 * Load and index every object a person may `@`-mention in a workspace.
 *
 * @param organizationId - The workspace to index, or `null` outside one.
 * @param enabled - Whether to fetch at all. Pass `false` until an editor needs it.
 * @returns The {@link MentionDirectory}.
 */
export function useMentionDirectory(
  organizationId: string | null,
  enabled: boolean,
): MentionDirectory {
  const orgId = organizationId ?? '';
  const on = enabled && orgId !== '';

  const tasks = useApiListQuery({
    ...apiQueryOptions(
      queryKeys.tasks(orgId),
      () => api.v1.orgs[':orgId'].tasks.$get({ param: { orgId }, query: {} }),
      'Could not load tasks to mention.',
      { staleTime: STALE.volatile },
    ),
    enabled: on,
  });
  const projects = useApiListQuery({
    ...apiQueryOptions(
      queryKeys.projects(orgId),
      () => api.v1.orgs[':orgId'].projects.$get({ param: { orgId }, query: {} }),
      'Could not load projects to mention.',
      { staleTime: STALE.standard },
    ),
    enabled: on,
  });
  const initiatives = useApiListQuery({
    ...apiQueryOptions(
      queryKeys.initiatives(orgId),
      () => api.v1.orgs[':orgId'].initiatives.$get({ param: { orgId }, query: {} }),
      'Could not load initiatives to mention.',
      { staleTime: STALE.standard },
    ),
    enabled: on,
  });
  const programs = useApiListQuery({
    ...apiQueryOptions(
      queryKeys.programs(orgId),
      () => api.v1.orgs[':orgId'].programs.$get({ param: { orgId }, query: {} }),
      'Could not load programs to mention.',
      { staleTime: STALE.standard },
    ),
    enabled: on,
  });
  const members = useApiListQuery({
    ...apiQueryOptions(
      queryKeys.members(orgId),
      () => api.v1.orgs[':orgId'].members.$get({ param: { orgId } }),
      'Could not load people to mention.',
      { staleTime: STALE.static },
    ),
    enabled: on,
  });

  const taskItems = tasks.data?.items;
  const projectItems = projects.data?.items;
  const initiativeItems = initiatives.data?.items;
  const programItems = programs.data?.items;
  const memberItems = members.data?.items;

  return useMemo<MentionDirectory>(() => {
    const projectNames = new Map<string, string>(
      (projectItems ?? []).map((project) => [project.id, project.name]),
    );
    const entries: MentionEntry[] = [
      ...(taskItems ?? []).map<MentionEntry>((task) => ({
        kind: 'task',
        id: task.id,
        label: task.title,
        hint: task.projectId ? (projectNames.get(task.projectId) ?? null) : null,
      })),
      ...(projectItems ?? []).map<MentionEntry>((project) => ({
        kind: 'project',
        id: project.id,
        label: project.name,
        hint: null,
      })),
      ...(initiativeItems ?? []).map<MentionEntry>((initiative) => ({
        kind: 'initiative',
        id: initiative.id,
        label: initiative.name,
        hint: null,
      })),
      ...(programItems ?? []).map<MentionEntry>((program) => ({
        kind: 'program',
        id: program.id,
        label: program.name,
        hint: null,
      })),
      // A person is referenced by their *actor* id, which is what every other assignment in the
      // product points at — a member row's own id is an org-membership record, not the actor.
      ...(memberItems ?? []).map<MentionEntry>((member) => ({
        kind: 'person',
        id: member.actorId,
        label: member.displayName,
        hint: null,
      })),
    ];
    entries.sort((a, b) => {
      const byKind = KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
      return byKind !== 0 ? byKind : a.label.localeCompare(b.label);
    });
    // Every already-inserted mention of these objects repaints with the title just loaded, so a
    // rename anywhere in the app reaches documents written months ago.
    publishMentionLabels(
      entries.map((entry) => [mentionKeyOf(entry.kind, entry.id), entry.label] as const),
    );
    return {
      entries,
      byKey: new Map(entries.map((entry) => [mentionKeyOf(entry.kind, entry.id), entry])),
      isPending:
        on &&
        (tasks.isPending || projects.isPending || initiatives.isPending || programs.isPending),
    };
  }, [
    on,
    taskItems,
    projectItems,
    initiativeItems,
    programItems,
    memberItems,
    tasks.isPending,
    projects.isPending,
    initiatives.isPending,
    programs.isPending,
  ]);
}

/**
 * Rank directory entries against a typed query.
 *
 * @remarks
 * A prefix match on the title beats a word-start match, which beats a bare substring — so typing
 * "la" puts "Launch" above "Backlog cleanup" rather than sorting alphabetically and burying the
 * thing you meant. An empty query returns the head of the directory unchanged.
 *
 * @param entries - The directory entries.
 * @param query - What the person has typed after the trigger.
 * @param limit - Most rows to return.
 * @returns The matching entries, best first.
 */
export function rankMentions(
  entries: readonly MentionEntry[],
  query: string,
  limit = 8,
): readonly MentionEntry[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return entries.slice(0, limit);
  const scored: { entry: MentionEntry; score: number }[] = [];
  for (const entry of entries) {
    const haystack = entry.label.toLowerCase();
    const index = haystack.indexOf(needle);
    if (index === -1) continue;
    const wordStart = index === 0 || /\s/.test(haystack.charAt(index - 1));
    scored.push({ entry, score: index === 0 ? 0 : wordStart ? 1 : 2 });
  }
  scored.sort((a, b) => a.score - b.score || a.entry.label.length - b.entry.label.length);
  return scored.slice(0, limit).map((row) => row.entry);
}
