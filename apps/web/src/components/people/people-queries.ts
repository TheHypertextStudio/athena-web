'use client';

/**
 * The People slice's data layer — every read and write the roster and profile surfaces make.
 *
 * @remarks
 * People are `actor.kind = 'human'` rows. Docket tracks two kinds and this module is deliberately
 * blind to the difference: someone who signs in carries a `userId`, someone who does not carries
 * `null`, and nothing here filters, partitions, sorts or badges on that field. The server already
 * returns one name-ordered list (`GET /v1/orgs/:orgId/members`), so the surfaces render exactly
 * what they are given.
 *
 * The profile key nests under the roster key (`['org', orgId, 'members', actorId, 'profile']`) so
 * every existing member mutation — invite, role change, removal — already invalidates it by
 * prefix, and no call site has to know profiles are cached.
 *
 * @see {@link file://../../../../../docs/engineering/specs/people.md}
 */
import { api } from '@/lib/api';
import { STALE, apiQueryOptions, queryKeys, unwrap, useApiMutation } from '@/lib/query';

/** The profile payload `GET /v1/orgs/:orgId/members/:actorId/profile` returns. */
export interface PersonProfile {
  readonly actorId: string;
  readonly organizationId: string;
  readonly displayName: string;
  readonly avatar: string | null;
  readonly status: 'active' | 'suspended';
  readonly roleId: string | null;
  readonly roleName: string | null;
  readonly createdAt: string;
  readonly assignedTasks: readonly {
    readonly id: string;
    readonly title: string;
    readonly state: string;
    readonly priority: 'none' | 'low' | 'medium' | 'high' | 'urgent';
    readonly dueDate: string | null;
    readonly projectId: string | null;
  }[];
  readonly ledProjects: readonly {
    readonly id: string;
    readonly name: string;
    readonly status: 'planned' | 'active' | 'completed' | 'canceled';
    readonly health: 'on_track' | 'at_risk' | 'off_track' | null;
  }[];
  readonly ownedInitiatives: readonly {
    readonly id: string;
    readonly name: string;
    readonly status: 'proposed' | 'active' | 'completed' | 'canceled';
  }[];
}

/** The cache key for one person's profile — a child of the workspace's roster key. */
export function personProfileKey(orgId: string, actorId: string): readonly string[] {
  return [...queryKeys.members(orgId), actorId, 'profile'];
}

/** Query definition for the workspace's people, in the server's name order. */
export function peopleQuery(orgId: string) {
  return apiQueryOptions(
    queryKeys.members(orgId),
    () => api.v1.orgs[':orgId'].members.$get({ param: { orgId } }),
    'Could not load the people in this workspace.',
    { staleTime: STALE.static },
  );
}

/** Query definition for the workspace's roles (resolves each person's role to a name). */
export function rolesQuery(orgId: string) {
  return apiQueryOptions(
    queryKeys.roles(orgId),
    () => api.v1.orgs[':orgId'].roles.$get({ param: { orgId } }),
    'Could not load workspace roles.',
    { staleTime: STALE.static },
  );
}

/** Query definition for one person's profile. */
export function personProfileQuery(orgId: string, actorId: string) {
  return apiQueryOptions(
    personProfileKey(orgId, actorId),
    () => api.v1.orgs[':orgId'].members[':actorId'].profile.$get({ param: { orgId, actorId } }),
    'Could not load this person.',
    { staleTime: STALE.static },
  );
}

/** What {@link useAddPerson} sends. */
export interface AddPersonInput {
  readonly displayName: string;
  readonly roleId: string | null;
}

/**
 * Add a person to the workspace who has no Docket account.
 *
 * @remarks
 * The counterpart to inviting someone by email: this records a volunteer, contractor or
 * collaborator the workspace tracks and assigns work to but who will never sign in. Both paths
 * produce the same `MemberOut`, which is why the roster needs no branch after either one.
 *
 * @returns the mutation handle; invalidates the roster on success.
 */
export function useAddPerson(orgId: string) {
  return useApiMutation({
    mutationFn: ({ displayName, roleId }: AddPersonInput) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].members.$post({
            param: { orgId },
            json: { displayName, ...(roleId === null ? {} : { roleId }) },
          }),
        'Could not add this person.',
      ),
    invalidateKeys: [queryKeys.members(orgId)],
  });
}

/** Rename a person (or re-point their avatar) in this workspace. */
export function useRenamePerson(orgId: string, actorId: string) {
  return useApiMutation({
    mutationFn: (displayName: string) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].members[':actorId'].profile.$patch({
            param: { orgId, actorId },
            json: { displayName },
          }),
        'Could not save this name.',
      ),
    invalidateKeys: [queryKeys.members(orgId)],
  });
}
