/**
 * The six query definitions the My Work screen composes (tasks, projects, members, agents, teams,
 * and sessions), in one place so the client hook and the SSR server entry read from one source.
 *
 * @remarks
 * Both {@link useMyWork} (browser client) and `my-work/page.tsx`'s SSR prefetch (server,
 * cookie-forwarding client) consume these, so the keys, fetchers, error messages, and staleTime
 * tiers can't drift between server and client — the def is parameterized by the RPC client exactly
 * like `fetch-cycles-with-stats` / the `*DetailDef` factories. Server-safe (no React, no
 * `'use client'`): `apiQueryOptions` comes from `query-core`.
 */
import type { api as ApiClient } from './api';
import {
  fetchAllAgents,
  fetchAllMembers,
  fetchAllProjects,
  fetchAllSessions,
  fetchAllTasks,
  fetchAllTeams,
} from './org-collection-pages';
import { STALE, apiQueryOptions } from './query-core';
import { queryKeys } from './query-keys';

/**
 * Build the My Work query definitions for an org.
 *
 * @param orgId - The active org id.
 * @param client - The RPC client: the browser singleton from `./api` for a client caller, or the
 *   SSR entry's cookie-forwarding server client. Required rather than defaulted so this module
 *   never imports `./api` itself — that import eagerly calls the client-only `withOfflineOutbox`,
 *   which fails the build the instant a Server Component pulls this file in (as `my-work/page.tsx`
 *   does).
 */
export function myWorkDefs(orgId: string, client: typeof ApiClient) {
  return {
    tasks: apiQueryOptions(
      queryKeys.tasks(orgId),
      () => fetchAllTasks(client, orgId),
      'Could not load your work.',
      { staleTime: STALE.volatile },
    ),
    projects: apiQueryOptions(
      queryKeys.projects(orgId),
      () => fetchAllProjects(client, orgId),
      'Could not load projects.',
      { staleTime: STALE.standard },
    ),
    members: apiQueryOptions(
      queryKeys.members(orgId),
      () => fetchAllMembers(client, orgId),
      'Could not load members.',
      { staleTime: STALE.static },
    ),
    agents: apiQueryOptions(
      queryKeys.agents(orgId),
      () => fetchAllAgents(client, orgId),
      'Could not load agents.',
      { staleTime: STALE.static },
    ),
    teams: apiQueryOptions(
      queryKeys.teams(orgId),
      () => fetchAllTeams(client, orgId),
      'Could not load teams.',
      { staleTime: STALE.static },
    ),
    sessions: apiQueryOptions(
      queryKeys.sessions(orgId),
      () => fetchAllSessions(client, orgId),
      'Could not load agent sessions.',
      { staleTime: STALE.volatile },
    ),
  };
}
