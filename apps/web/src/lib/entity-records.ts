/**
 * An entity's own row, read and cached apart from its composite detail payload.
 *
 * @remarks
 * Opening a Project fires thirteen requests, an Initiative eight, a Program six. Almost none of
 * that is the masthead: the icon, name, summary and property row come from a single row, while
 * the rest fills tab panels the reader has not looked at yet. Because both lived under one cache
 * key, the page had nothing to render until the slowest of them returned, so every navigation —
 * including one straight from the composer that was just handed the whole record — showed a
 * full-page skeleton.
 *
 * These definitions give the row its own key. That is what lets identity arrive by whichever
 * route is fastest: seeded from a create response, warmed by a list the reader came from, primed
 * on the server, or fetched as one cheap read. The composite still loads exactly as before and
 * still owns the body; it simply stops being the gate on the page's title.
 *
 * Nested under each entity's detail key (see `queryKeys`), so every existing coarse invalidation
 * reaches the row without a single call site having to learn it exists.
 *
 * That nesting is also what makes seeding safe. Every create already invalidates its collection
 * (`queryKeys.projects(orgId)` and friends), and a record key sits underneath it, so a seeded
 * entry is marked stale in the same breath it is written and refetched as the page mounts. The
 * seed therefore only has to be *true*, not complete: it buys the first paint, and the read that
 * is already in flight fills in whatever the create response did not carry.
 */
import type { InitiativeOut } from '@docket/work/initiative-contract';
import type { ProgramOut } from '@docket/work/program-contract';
import type { ProjectOut } from './contracts/project';
import type { TaskOut } from '@docket/work/task-model';
import type { QueryClient } from '@tanstack/react-query';

import { api } from './api';
import { STALE, apiQueryOptions, queryKeys } from './query';

/**
 * Typed definition for a Project's own row.
 *
 * @param orgId - The active org.
 * @param projectId - The project to read.
 * @returns The query definition the masthead reads and a create seeds.
 */
export function projectRecordDef(orgId: string, projectId: string) {
  return apiQueryOptions(
    queryKeys.projectRecord(orgId, projectId),
    () => api.v1.orgs[':orgId'].projects[':id'].$get({ param: { orgId, id: projectId } }),
    'Could not load this project.',
    { staleTime: STALE.volatile },
  );
}

/**
 * Typed definition for a Program's own row.
 *
 * @param orgId - The active org.
 * @param programId - The program to read.
 * @returns The query definition the masthead reads and a create seeds.
 *
 * @remarks
 * The endpoint answers `ProgramDetail` — the row plus a child-work roll-up — so a seed has to
 * supply that roll-up too. For a program that did not exist a moment ago the correct value is
 * zero of each, which is also what the server will confirm.
 */
export function programRecordDef(orgId: string, programId: string) {
  return apiQueryOptions(
    queryKeys.programRecord(orgId, programId),
    () => api.v1.orgs[':orgId'].programs[':id'].$get({ param: { orgId, id: programId } }),
    'Could not load this program.',
    { staleTime: STALE.volatile },
  );
}

/**
 * Typed definition for an Initiative's own row.
 *
 * @param orgId - The active org.
 * @param initiativeId - The initiative to read.
 * @returns The query definition the masthead reads and a create seeds.
 */
export function initiativeRecordDef(orgId: string, initiativeId: string) {
  return apiQueryOptions(
    queryKeys.initiativeRecord(orgId, initiativeId),
    () => api.v1.orgs[':orgId'].initiatives[':id'].$get({ param: { orgId, id: initiativeId } }),
    'Could not load this initiative.',
    { staleTime: STALE.volatile },
  );
}

/**
 * Write a freshly created Project into the cache its detail page reads from.
 *
 * @param queryClient - The active client.
 * @param orgId - The workspace the project was created in.
 * @param created - The record the create endpoint returned.
 */
export function seedProjectRecord(
  queryClient: QueryClient,
  orgId: string,
  created: ProjectOut,
): void {
  queryClient.setQueryData(projectRecordDef(orgId, created.id).queryKey, created);
}

/**
 * Write a freshly created Task into the cache its detail page reads from.
 *
 * @param queryClient - The active client.
 * @param orgId - The workspace the task was created in.
 * @param created - The record the create endpoint returned.
 * @param references - Associations the composer set that the create response does not echo.
 *
 * @remarks
 * Tasks need no separate record key: `queryKeys.task` already holds the single-row read the
 * detail page opens with. The create response is a `TaskOut`, one field short of the
 * `TaskDetail` the page reads, so the composer supplies the milestone and cycle it just chose
 * rather than letting them render as unset for the length of a round trip.
 */
export function seedTaskRecord(
  queryClient: QueryClient,
  orgId: string,
  created: TaskOut,
  references: { readonly milestoneId: string | null; readonly cycleId: string | null },
): void {
  queryClient.setQueryData(queryKeys.task(orgId, created.id), {
    ...created,
    milestoneId: references.milestoneId,
    cycleId: references.cycleId,
  });
}

/**
 * Write a freshly created Program into the cache its detail page reads from.
 *
 * @param queryClient - The active client.
 * @param orgId - The workspace the program was created in.
 * @param created - The record the create endpoint returned.
 */
export function seedProgramRecord(
  queryClient: QueryClient,
  orgId: string,
  created: ProgramOut,
): void {
  queryClient.setQueryData(programRecordDef(orgId, created.id).queryKey, {
    ...created,
    // Nothing can hang off a program this new. The refetch will say the same thing.
    rollup: { projects: 0, tasks: 0 },
  });
}

/**
 * Write a freshly created Initiative into the cache its detail page reads from.
 *
 * @param queryClient - The active client.
 * @param orgId - The workspace the initiative was created in.
 * @param created - The record the create endpoint returned.
 */
export function seedInitiativeRecord(
  queryClient: QueryClient,
  orgId: string,
  created: InitiativeOut,
): void {
  queryClient.setQueryData(initiativeRecordDef(orgId, created.id).queryKey, {
    ...created,
    // An initiative is created with no associations, so its roll-up is empty rather
    // than merely unknown — and `rolledUpHealth` is null precisely because no child carries a
    // verdict, which is what the server will report on the refetch.
    childMix: { programs: 0, projects: 0 },
    distribution: { onTrack: 0, atRisk: 0, offTrack: 0, unknown: 0 },
    rolledUpHealth: null,
  });
}
