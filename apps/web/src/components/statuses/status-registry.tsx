'use client';

/**
 * The workspace's status sets, available to everything inside the app shell.
 *
 * @remarks
 * Most of the interface never needs this: a work row carries the category of its own status, so a
 * glyph reads that field directly with no lookup at all. What needs the *set* is smaller and
 * specific — a status picker, a filter menu's options, a settings list — and all of it sits well
 * inside the shell.
 *
 * So the sets are fetched once, beside the workspace record and team roster the shell already
 * loads, and read from memory after that. Fetching them per consumer would put a request behind
 * every picker open, which is exactly the waterfall the composer options used to have.
 */
import { createContext, useCallback, useContext, useMemo, type JSX, type ReactNode } from 'react';

import type { WorkStatusCategory, WorkStatusEntityType, WorkStatusOut } from '@docket/types';
import { compareWorkStatusOrder, DEFAULT_WORK_STATUSES } from '@docket/types';

import { useApiQuery } from '@/lib/query';

import { statusSetsDef } from './queries';

/** A status as the interface uses it. */
export type StatusLike = Pick<
  WorkStatusOut,
  'id' | 'key' | 'name' | 'description' | 'category' | 'position' | 'isDefault'
>;

/** What the registry answers. */
export interface StatusRegistry {
  /** Whether the workspace's own sets have arrived; seeded defaults stand in until they do. */
  readonly loaded: boolean;
  /** Application-owned error copy when the workspace status set failed to load. */
  readonly error: string | null;
  /** Retry the workspace status-set request. */
  readonly retry: () => void;
  /**
   * One kind of work's set, in board order.
   *
   * @remarks
   * Pass the owning team for a Task: a team that keeps its own statuses resolves to those, and
   * every other team follows the workspace's. Omitting it answers for the workspace.
   */
  statusesFor(entityType: WorkStatusEntityType, teamId?: string | null): readonly StatusLike[];
  /** One status by key, when the set holds it. */
  statusOf(
    entityType: WorkStatusEntityType,
    key: string,
    teamId?: string | null,
  ): StatusLike | undefined;
  /** The category a stored key belongs to, falling back to `backlog` for a key nobody kept. */
  categoryOf(
    entityType: WorkStatusEntityType,
    key: string,
    teamId?: string | null,
  ): WorkStatusCategory;
  /** Where new work of this kind starts. */
  defaultOf(entityType: WorkStatusEntityType, teamId?: string | null): StatusLike | undefined;
  /** The first status of a category, for an action that means "finish this". */
  firstOfCategory(
    entityType: WorkStatusEntityType,
    category: WorkStatusCategory,
    teamId?: string | null,
  ): StatusLike | undefined;
  /** Whether this team keeps its own Task statuses. */
  isForked(teamId: string): boolean;
}

/**
 * The sets a workspace starts with, standing in until its own arrive.
 *
 * @remarks
 * Rendering an empty picker for the first paint would be worse than rendering the defaults, which
 * are what most workspaces are still using. The ids are empty because a seeded stand-in names no
 * real row; anything that writes waits for {@link StatusRegistry.loaded}.
 */
const SEEDED: Record<WorkStatusEntityType, readonly StatusLike[]> = {
  task: seedOf('task'),
  project: seedOf('project'),
  program: seedOf('program'),
  initiative: seedOf('initiative'),
};

function seedOf(entityType: WorkStatusEntityType): readonly StatusLike[] {
  return [...DEFAULT_WORK_STATUSES[entityType]].sort(compareWorkStatusOrder).map((seed) => ({
    id: '' as StatusLike['id'],
    key: seed.key,
    name: seed.name,
    description: seed.description,
    category: seed.category,
    position: seed.position,
    isDefault: seed.isDefault === true,
  }));
}

const StatusRegistryContext = createContext<StatusRegistry | null>(null);

/** Props for {@link StatusRegistryProvider}. */
export interface StatusRegistryProviderProps {
  /** The workspace whose statuses to load, or null on the Hub. */
  orgId: string | null;
  /** The subtree that reads the registry. */
  children: ReactNode;
}

/**
 * Load the workspace's status sets once and provide them to the subtree.
 *
 * @remarks
 * Gated on a bound workspace, so the Hub — which spans workspaces and reads each item's own
 * category off the row — fetches nothing.
 *
 * @param props - The bound workspace and the subtree.
 * @returns the provider element.
 */
export function StatusRegistryProvider({
  orgId,
  children,
}: StatusRegistryProviderProps): JSX.Element {
  const query = useApiQuery(statusSetsDef(orgId ?? ''));
  const items = query.data?.items;
  const retry = useCallback((): void => {
    void query.refetch();
  }, [query]);

  const value = useMemo<StatusRegistry>(() => {
    const bySet = new Map<WorkStatusEntityType, readonly StatusLike[]>();
    // The read returns the workspace's four sets plus one entry per team that keeps its own Task
    // statuses, so a task on any team resolves without a second request.
    const byTeam = new Map<string, readonly StatusLike[]>();
    for (const set of items ?? []) {
      const ordered = [...set.statuses].sort(compareWorkStatusOrder);
      if (set.teamId === null) bySet.set(set.entityType, ordered);
      else byTeam.set(set.teamId, ordered);
    }
    const statusesFor = (
      entityType: WorkStatusEntityType,
      teamId?: string | null,
    ): readonly StatusLike[] => {
      if (entityType === 'task' && typeof teamId === 'string') {
        const forked = byTeam.get(teamId);
        if (forked !== undefined && forked.length > 0) return forked;
      }
      const own = bySet.get(entityType);
      return own !== undefined && own.length > 0 ? own : SEEDED[entityType];
    };
    const statusOf = (
      entityType: WorkStatusEntityType,
      key: string,
      teamId?: string | null,
    ): StatusLike | undefined =>
      statusesFor(entityType, teamId).find((status) => status.key === key);
    return {
      loaded: items !== undefined,
      error: query.isError ? 'Could not load statuses.' : null,
      retry,
      statusesFor,
      statusOf,
      categoryOf: (entityType, key, teamId) =>
        statusOf(entityType, key, teamId)?.category ?? 'backlog',
      defaultOf: (entityType, teamId) => {
        const set = statusesFor(entityType, teamId);
        return set.find((status) => status.isDefault) ?? set[0];
      },
      firstOfCategory: (entityType, category, teamId) =>
        statusesFor(entityType, teamId).find((status) => status.category === category),
      isForked: (teamId) => byTeam.has(teamId),
    };
  }, [items, query.isError, retry]);

  return <StatusRegistryContext.Provider value={value}>{children}</StatusRegistryContext.Provider>;
}

/**
 * Read the workspace's status sets.
 *
 * @remarks
 * Outside the app shell — and on the Hub, which has no single workspace — this answers from the
 * seeded defaults rather than throwing, so a component can render a plausible picker anywhere.
 *
 * @returns the registry.
 *
 * @example
 * ```tsx
 * const statuses = useStatusRegistry();
 * const options = statuses.statusesFor('task');
 * ```
 */
export function useStatusRegistry(): StatusRegistry {
  const value = useContext(StatusRegistryContext);
  return value ?? FALLBACK;
}

const FALLBACK: StatusRegistry = {
  loaded: false,
  error: null,
  retry: () => undefined,
  statusesFor: (entityType) => SEEDED[entityType],
  statusOf: (entityType, key) => SEEDED[entityType].find((status) => status.key === key),
  categoryOf: (entityType, key) =>
    SEEDED[entityType].find((status) => status.key === key)?.category ?? 'backlog',
  defaultOf: (entityType) =>
    SEEDED[entityType].find((status) => status.isDefault) ?? SEEDED[entityType][0],
  firstOfCategory: (entityType, category) =>
    SEEDED[entityType].find((status) => status.category === category),
  isForked: () => false,
};
