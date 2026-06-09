'use client';

/**
 * `settings` — the Members & Access tab (the primary Settings sub-area).
 *
 * @remarks
 * Owns its own data: the org's human members, its seeded roles (to resolve plain-language role
 * options and the default "member" role), and its pending invitations. It renders:
 *
 * - an {@link InviteForm} (email + plain-language role + "invite as guest") that posts an
 *   invitation and prepends it to the pending list;
 * - the member list, each row carrying an {@link ActorAvatar}, name, a "Guest" badge for guests,
 *   an editable plain-language {@link RoleControl}, and a remove action;
 * - the {@link InvitationsList} of pending invitations with per-row revoke.
 *
 * Mutations are optimistic-with-rollback only where safe; role changes and removals re-read the
 * affected entity's server result. The org's last-owner guard is enforced server-side — its
 * `409` is surfaced verbatim as a banner so the owner understands why the action was refused.
 * Whether the caller can manage is derived from the caller's own role (`owner`/`admin` ⇒ manage);
 * non-managers see a read-only list.
 *
 * Data is fetched at runtime, so the production build needs no running server.
 */
import type { InvitationOut, MemberOut, RoleOut } from '@docket/types';
import { RoleId } from '@docket/types';
import { Skeleton } from '@docket/ui/primitives';
import { Users } from '@docket/ui/icons';
import { useQueryClient } from '@tanstack/react-query';
import type { JSX } from 'react';
import { useCallback, useMemo } from 'react';

import { useSession } from '@/lib/auth-client';
import { api } from '@/lib/api';
import { queryKeys, unwrap, useApiMutation, useApiQuery } from '@/lib/query';

import { InviteForm, type InvitePayload } from './invite-form';
import { InvitationsList } from './invitations-list';
import { MemberRow } from './member-row';
import type { RoleOption } from './role-control';
import { asRoleKey, ROLE_KEY_ORDER, ROLE_PLAIN_LANGUAGE } from './roles';

/** Props for {@link MembersTab}. */
export interface MembersTabProps {
  /** The active organization id. */
  orgId: string;
}

/** The role keys that confer member-management ability in the product surface. */
const MANAGER_ROLE_KEYS = new Set(['owner', 'admin']);

/**
 * The Members & Access tab.
 *
 * @param props - The {@link MembersTabProps}.
 * @returns the rendered tab panel body.
 */
export function MembersTab({ orgId }: MembersTabProps): JSX.Element {
  const { data: authSession } = useSession();
  const userId = authSession?.user.id ?? null;
  const queryClient = useQueryClient();

  const membersKey = queryKeys.members(orgId);
  const invitationsKey = queryKeys.invitations(orgId);

  // Members governs whether the tab can render; roles + invitations are best-effort overlays.
  const membersQ = useApiQuery(
    membersKey,
    () => api.v1.orgs[':orgId'].members.$get({ param: { orgId } }),
    'Could not load members.',
  );
  const rolesQ = useApiQuery(
    queryKeys.roles(orgId),
    () => api.v1.orgs[':orgId'].roles.$get({ param: { orgId } }),
    'Could not load roles.',
  );
  const invitationsQ = useApiQuery(
    invitationsKey,
    () => api.v1.orgs[':orgId'].members.invitations.$get({ param: { orgId } }),
    'Could not load invitations.',
  );

  const members: readonly MemberOut[] = membersQ.data?.items ?? [];
  const roles: readonly RoleOut[] = rolesQ.data?.items ?? [];
  const invitations: readonly InvitationOut[] = invitationsQ.data?.items ?? [];
  const loading = membersQ.isPending;
  const loadError = membersQ.isError ? membersQ.error.message : null;

  // The cache stores the FULL list bodies (`{ items, nextCursor?, total? }`), so optimistic
  // writes map over `.items` while preserving the rest of the body.
  type MembersBody = NonNullable<typeof membersQ.data>;
  type InvitationsBody = NonNullable<typeof invitationsQ.data>;

  /** Send an invitation; on success the invitations list invalidates + refetches. */
  const inviteMutation = useApiMutation({
    mutationFn: ({ email, roleId, asGuest }: InvitePayload) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].members.invitations.$post({
            param: { orgId },
            json: { email, roleId: RoleId.parse(roleId), asGuest },
          }),
        'Could not send the invitation.',
      ),
    onSuccess: (created) => {
      // Prepend the created invitation so the row appears instantly, then the invalidation below
      // reconciles with the server's authoritative list.
      queryClient.setQueryData<InvitationsBody>(invitationsKey, (current) =>
        current ? { ...current, items: [created, ...current.items] } : { items: [created] },
      );
    },
    invalidateKeys: [invitationsKey],
  });

  /** Change a member's role; optimistically swaps the row, rolls back on failure. */
  const roleMutation = useApiMutation({
    mutationFn: ({ actorId, roleId }: { actorId: string; roleId: string }) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].members[':actorId'].$patch({
            param: { orgId, actorId },
            json: { roleId: RoleId.parse(roleId) },
          }),
        'Could not change this member’s role.',
      ),
    onMutate: async ({ actorId, roleId }) => {
      await queryClient.cancelQueries({ queryKey: membersKey });
      const previous = queryClient.getQueryData<MembersBody>(membersKey);
      queryClient.setQueryData<MembersBody>(membersKey, (current) =>
        current
          ? {
              ...current,
              items: current.items.map((m) =>
                m.actorId === actorId ? { ...m, roleId: RoleId.parse(roleId) } : m,
              ),
            }
          : current,
      );
      return { previous };
    },
    onSuccess: (updated, { actorId }) => {
      // Replace the optimistic row with the server's authoritative result.
      queryClient.setQueryData<MembersBody>(membersKey, (current) =>
        current
          ? { ...current, items: current.items.map((m) => (m.actorId === actorId ? updated : m)) }
          : current,
      );
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(membersKey, context.previous);
    },
    invalidateKeys: [membersKey],
  });

  /** Remove a member; optimistically drops the row, rolls back on failure (last-owner 409). */
  const removeMutation = useApiMutation({
    mutationFn: (actorId: string) =>
      unwrap(
        () => api.v1.orgs[':orgId'].members[':actorId'].$delete({ param: { orgId, actorId } }),
        'Could not remove this member.',
      ),
    onMutate: async (actorId) => {
      await queryClient.cancelQueries({ queryKey: membersKey });
      const previous = queryClient.getQueryData<MembersBody>(membersKey);
      queryClient.setQueryData<MembersBody>(membersKey, (current) =>
        current
          ? { ...current, items: current.items.filter((m) => m.actorId !== actorId) }
          : current,
      );
      return { previous };
    },
    onError: (_error, _actorId, context) => {
      if (context?.previous) queryClient.setQueryData(membersKey, context.previous);
    },
    invalidateKeys: [membersKey],
  });

  /** Revoke a pending invitation; optimistically drops the row, rolls back on failure. */
  const revokeMutation = useApiMutation({
    mutationFn: (invitationId: string) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].members.invitations[':id'].$delete({
            param: { orgId, id: invitationId },
          }),
        'Could not revoke the invitation.',
      ),
    onMutate: async (invitationId) => {
      await queryClient.cancelQueries({ queryKey: invitationsKey });
      const previous = queryClient.getQueryData<InvitationsBody>(invitationsKey);
      queryClient.setQueryData<InvitationsBody>(invitationsKey, (current) =>
        current
          ? { ...current, items: current.items.filter((i) => i.id !== invitationId) }
          : current,
      );
      return { previous };
    },
    onError: (_error, _invitationId, context) => {
      if (context?.previous) queryClient.setQueryData(invitationsKey, context.previous);
    },
    invalidateKeys: [invitationsKey],
  });

  const inviting = inviteMutation.isPending;
  const inviteError = inviteMutation.isError ? inviteMutation.error.message : null;
  // The shared "action" banner reflects whichever guard/validation write last failed (e.g. the
  // last-owner 409 from a role change or removal).
  const actionError =
    (roleMutation.isError ? roleMutation.error.message : null) ??
    (removeMutation.isError ? removeMutation.error.message : null) ??
    (revokeMutation.isError ? revokeMutation.error.message : null);
  // Which row is mid-write: while pending, the mutation's `variables` identify the targeted
  // actor/id (TanStack narrows them to defined in the pending state).
  const savingRoleFor = roleMutation.isPending ? roleMutation.variables.actorId : null;
  const removingFor = removeMutation.isPending ? removeMutation.variables : null;
  const revokingFor = revokeMutation.isPending ? revokeMutation.variables : null;

  /** The assignable role options, ordered most-privileged first. */
  const roleOptions = useMemo<readonly RoleOption[]>(() => {
    const byKey = new Map(roles.map((role) => [role.key, role]));
    const ordered: RoleOption[] = [];
    for (const key of ROLE_KEY_ORDER) {
      const role = byKey.get(key);
      if (role) ordered.push({ id: role.id, key: role.key });
    }
    // Append any non-system roles after the four canonical ones.
    for (const role of roles) {
      if (!asRoleKey(role.key)) ordered.push({ id: role.id, key: role.key });
    }
    return ordered;
  }, [roles]);

  /** The guest role id (used to detect guests + default the guest toggle's effect). */
  const guestRoleId = useMemo(
    () => roles.find((role) => role.key === 'guest')?.id ?? null,
    [roles],
  );
  /** The member role id (the default invite role). */
  const memberRoleId = useMemo(
    () => roles.find((role) => role.key === 'member')?.id ?? null,
    [roles],
  );

  /** Resolve a role id to its plain-language label. */
  const roleLabel = useCallback(
    (roleId: string): string => {
      const role = roles.find((r) => r.id === roleId);
      const key = role ? asRoleKey(role.key) : null;
      return key ? ROLE_PLAIN_LANGUAGE[key].label : (role?.name ?? 'Member');
    },
    [roles],
  );

  /** The caller's own actor + whether they can manage members. */
  const myActorId = useMemo(
    () => (userId ? (members.find((m) => m.userId === userId)?.actorId ?? null) : null),
    [members, userId],
  );
  const canManage = useMemo(() => {
    if (!myActorId) return false;
    const me = members.find((m) => m.actorId === myActorId);
    const myRole = me?.roleId ? roles.find((r) => r.id === me.roleId) : null;
    return myRole ? MANAGER_ROLE_KEYS.has(myRole.key) : false;
  }, [members, myActorId, roles]);

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (loadError) {
    return (
      <p
        role="alert"
        className="border-outline-variant text-destructive rounded-lg border p-4 text-sm"
      >
        {loadError}
      </p>
    );
  }

  const pendingInvitations = invitations.map((invitation) => ({
    id: invitation.id,
    email: invitation.email,
    roleId: invitation.roleId,
    asGuest: invitation.asGuest,
    expiresAt: invitation.expiresAt,
  }));

  return (
    <div className="flex flex-col gap-6">
      {canManage ? (
        <InviteForm
          roleOptions={roleOptions}
          defaultRoleId={memberRoleId}
          sending={inviting}
          error={inviteError}
          onInvite={(payload) => {
            inviteMutation.mutate(payload);
          }}
        />
      ) : null}

      {actionError ? (
        <p
          role="alert"
          className="border-destructive/40 text-destructive bg-destructive/5 rounded-lg border p-3 text-sm"
        >
          {actionError}
        </p>
      ) : null}

      <section aria-label="Members" className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-on-surface flex items-center gap-2 text-base font-semibold">
            <Users aria-hidden="true" className="size-4" />
            Members
            <span className="text-on-surface-variant font-normal tabular-nums">
              ({members.length})
            </span>
          </h2>
        </div>
        <div className="border-outline-variant bg-surface-container-low overflow-hidden rounded-xl border">
          {members.length === 0 ? (
            <p className="text-on-surface-variant p-6 text-center text-sm">
              No members yet — invite someone above to get started.
            </p>
          ) : (
            <ul className="divide-outline-variant divide-y">
              {members.map((member) => {
                const isGuest = guestRoleId !== null && member.roleId === guestRoleId;
                return (
                  <MemberRow
                    key={member.actorId}
                    actorId={member.actorId}
                    displayName={member.displayName}
                    avatarUrl={member.avatar}
                    roleId={member.roleId ?? null}
                    isSelf={member.actorId === myActorId}
                    isGuest={isGuest}
                    roleOptions={roleOptions}
                    canManage={canManage}
                    savingRole={savingRoleFor === member.actorId}
                    removing={removingFor === member.actorId}
                    onChangeRole={(roleId) => {
                      roleMutation.mutate({ actorId: member.actorId, roleId });
                    }}
                    onRemove={() => {
                      removeMutation.mutate(member.actorId);
                    }}
                  />
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <section aria-label="Pending invitations" className="flex flex-col gap-3">
        <h2 className="text-on-surface text-base font-semibold">Pending invitations</h2>
        <div className="border-outline-variant bg-surface-container-low overflow-hidden rounded-xl border">
          <InvitationsList
            invitations={pendingInvitations}
            roleLabel={roleLabel}
            canManage={canManage}
            revokingId={revokingFor}
            onRevoke={(id) => {
              revokeMutation.mutate(id);
            }}
          />
        </div>
      </section>
    </div>
  );
}
