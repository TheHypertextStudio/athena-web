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
import type { MemberOut, RoleOut } from '@docket/types';
import { Skeleton } from '@docket/ui/primitives';
import { Users } from '@docket/ui/icons';
import type { JSX } from 'react';
import { useCallback, useMemo } from 'react';

import { useSession } from '@/lib/auth-client';
import { api } from '@/lib/api';
import { STALE, apiQueryOptions, queryKeys, useApiListQuery } from '@/lib/query';

import { InviteForm } from './invite-form';
import { InvitationsList } from './invitations-list';
import { MemberRow } from './member-row';
import type { RoleOption } from './role-control';
import { asRoleKey, ROLE_KEY_ORDER, ROLE_PLAIN_LANGUAGE } from './roles';
import { useMembersMutations } from './use-members-mutations';
import { userErrorMessage } from '@/lib/problem';

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

  const membersKey = queryKeys.members(orgId);
  const invitationsKey = queryKeys.invitations(orgId);

  // Members + roles rarely change within a session (and their mutations invalidate these keys),
  // so they ride the static tier; invitations likewise reconcile via invalidation on send/revoke.
  const membersQ = useApiListQuery(
    apiQueryOptions(
      membersKey,
      () => api.v1.orgs[':orgId'].members.$get({ param: { orgId } }),
      'Could not load members.',
      { staleTime: STALE.static },
    ),
  );
  const rolesQ = useApiListQuery(
    apiQueryOptions(
      queryKeys.roles(orgId),
      () => api.v1.orgs[':orgId'].roles.$get({ param: { orgId } }),
      'Could not load roles.',
      { staleTime: STALE.static },
    ),
  );
  const invitationsQ = useApiListQuery(
    apiQueryOptions(
      invitationsKey,
      () => api.v1.orgs[':orgId'].members.invitations.$get({ param: { orgId } }),
      'Could not load invitations.',
      { staleTime: STALE.static },
    ),
  );

  const members: readonly MemberOut[] = membersQ.data?.items ?? [];
  const roles: readonly RoleOut[] = rolesQ.data?.items ?? [];
  const invitations = invitationsQ.data?.items ?? [];
  const loading = membersQ.isPending;
  const loadError = membersQ.isError
    ? userErrorMessage(membersQ.error, 'Could not load workspace members.')
    : null;

  const {
    invite,
    changeRole,
    remove,
    revoke,
    inviting,
    inviteError,
    actionError,
    savingRoleFor,
    removingFor,
    revokingFor,
  } = useMembersMutations(orgId, membersKey, invitationsKey);

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
        className="border-outline-variant text-destructive text-body rounded-lg border p-4"
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
            invite(payload);
          }}
        />
      ) : null}

      {actionError ? (
        <p
          role="alert"
          className="border-destructive/40 text-destructive bg-destructive/5 text-body rounded-lg border p-3"
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
            <p className="text-on-surface-variant text-body p-6 text-center">
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
                      changeRole(member.actorId, roleId);
                    }}
                    onRemove={() => {
                      remove(member.actorId);
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
              revoke(id);
            }}
          />
        </div>
      </section>
    </div>
  );
}
