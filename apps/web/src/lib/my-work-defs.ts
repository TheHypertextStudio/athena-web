/**
 * The five query definitions the My Work screen composes (tasks, projects, members, agents,
 * sessions), in one place so the client hook and the SSR server entry read from a single source.
 *
 * @remarks
 * Both {@link useMyWork} (browser client) and `my-work/page.tsx`'s SSR prefetch (server,
 * cookie-forwarding client) consume these, so the keys, fetchers, error messages, and staleTime
 * tiers can't drift between server and client — the def is parameterized by the RPC client exactly
 * like `fetch-cycles-with-stats` / the `*DetailDef` factories. Server-safe (no React, no
 * `'use client'`): `apiQueryOptions` comes from `query-core`.
 */
import { api } from './api';
import { STALE, apiQueryOptions } from './query-core';
import { queryKeys } from './query-keys';

/**
 * Build the My Work query definitions for an org.
 *
 * @param orgId - The active org id.
 * @param client - The RPC client; defaults to the browser client. The SSR entry passes its
 *   cookie-forwarding server client.
 */
export function myWorkDefs(orgId: string, client: typeof api = api) {
  return {
    tasks: apiQueryOptions(
      queryKeys.tasks(orgId),
      () => client.v1.orgs[':orgId'].tasks.$get({ param: { orgId }, query: {} }),
      'Could not load your work.',
      { staleTime: STALE.volatile },
    ),
    projects: apiQueryOptions(
      queryKeys.projects(orgId),
      () => client.v1.orgs[':orgId'].projects.$get({ param: { orgId }, query: {} }),
      'Could not load projects.',
      { staleTime: STALE.standard },
    ),
    members: apiQueryOptions(
      queryKeys.members(orgId),
      () => client.v1.orgs[':orgId'].members.$get({ param: { orgId } }),
      'Could not load members.',
      { staleTime: STALE.static },
    ),
    agents: apiQueryOptions(
      queryKeys.agents(orgId),
      () => client.v1.orgs[':orgId'].agents.$get({ param: { orgId } }),
      'Could not load agents.',
      { staleTime: STALE.static },
    ),
    sessions: apiQueryOptions(
      queryKeys.sessions(orgId),
      () => client.v1.orgs[':orgId'].sessions.$get({ param: { orgId }, query: {} }),
      'Could not load agent sessions.',
      { staleTime: STALE.volatile },
    ),
  };
}
