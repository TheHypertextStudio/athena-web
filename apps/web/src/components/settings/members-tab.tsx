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
import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useSession } from '@/lib/auth-client';
import { api } from '@/lib/api';
import { readError, readProblem } from '@/lib/problem';

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

  const [members, setMembers] = useState<readonly MemberOut[]>([]);
  const [roles, setRoles] = useState<readonly RoleOut[]>([]);
  const [invitations, setInvitations] = useState<readonly InvitationOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Per-action banner for guard/validation errors (e.g. the last-owner 409).
  const [actionError, setActionError] = useState<string | null>(null);

  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [savingRoleFor, setSavingRoleFor] = useState<string | null>(null);
  const [removingFor, setRemovingFor] = useState<string | null>(null);
  const [revokingFor, setRevokingFor] = useState<string | null>(null);

  /** Load members, roles, and pending invitations for the org. */
  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      const [membersRes, rolesRes, invitationsRes] = await Promise.all([
        api.v1.orgs[':orgId'].members.$get({ param: { orgId } }),
        api.v1.orgs[':orgId'].roles.$get({ param: { orgId } }),
        api.v1.orgs[':orgId'].members.invitations.$get({ param: { orgId } }),
      ]);
      if (!membersRes.ok) {
        setLoadError(await readProblem(membersRes, 'Could not load members.'));
        return;
      }
      setMembers((await membersRes.json()).items);
      if (rolesRes.ok) setRoles((await rolesRes.json()).items);
      if (invitationsRes.ok) setInvitations((await invitationsRes.json()).items);
    } catch (caught) {
      setLoadError(readError(caught, 'Something went wrong loading members.'));
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

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

  /** Send an invitation, then prepend it to the pending list. */
  const invite = useCallback(
    async ({ email, roleId, asGuest }: InvitePayload): Promise<void> => {
      setInviting(true);
      setInviteError(null);
      try {
        const res = await api.v1.orgs[':orgId'].members.invitations.$post({
          param: { orgId },
          json: { email, roleId: RoleId.parse(roleId), asGuest },
        });
        if (!res.ok) {
          setInviteError(await readProblem(res, 'Could not send the invitation.'));
          return;
        }
        const created = await res.json();
        setInvitations((current) => [created, ...current]);
      } catch (caught) {
        setInviteError(readError(caught, 'Something went wrong sending the invitation.'));
      } finally {
        setInviting(false);
      }
    },
    [orgId],
  );

  /** Change a member's role, replacing its row with the server's result. */
  const changeRole = useCallback(
    async (actorId: string, roleId: string): Promise<void> => {
      setSavingRoleFor(actorId);
      setActionError(null);
      try {
        const res = await api.v1.orgs[':orgId'].members[':actorId'].$patch({
          param: { orgId, actorId },
          json: { roleId: RoleId.parse(roleId) },
        });
        if (!res.ok) {
          setActionError(await readProblem(res, 'Could not change this member’s role.'));
          return;
        }
        const updated = await res.json();
        setMembers((current) => current.map((m) => (m.actorId === actorId ? updated : m)));
      } catch (caught) {
        setActionError(readError(caught, 'Something went wrong changing the role.'));
      } finally {
        setSavingRoleFor(null);
      }
    },
    [orgId],
  );

  /** Remove a member, dropping its row on success (last-owner 409 surfaces as a banner). */
  const removeMember = useCallback(
    async (actorId: string): Promise<void> => {
      setRemovingFor(actorId);
      setActionError(null);
      try {
        const res = await api.v1.orgs[':orgId'].members[':actorId'].$delete({
          param: { orgId, actorId },
        });
        if (!res.ok) {
          setActionError(await readProblem(res, 'Could not remove this member.'));
          return;
        }
        setMembers((current) => current.filter((m) => m.actorId !== actorId));
      } catch (caught) {
        setActionError(readError(caught, 'Something went wrong removing the member.'));
      } finally {
        setRemovingFor(null);
      }
    },
    [orgId],
  );

  /** Revoke a pending invitation, dropping its row on success. */
  const revokeInvitation = useCallback(
    async (invitationId: string): Promise<void> => {
      setRevokingFor(invitationId);
      setActionError(null);
      try {
        const res = await api.v1.orgs[':orgId'].members.invitations[':id'].$delete({
          param: { orgId, id: invitationId },
        });
        if (!res.ok) {
          setActionError(await readProblem(res, 'Could not revoke the invitation.'));
          return;
        }
        setInvitations((current) => current.filter((i) => i.id !== invitationId));
      } catch (caught) {
        setActionError(readError(caught, 'Something went wrong revoking the invitation.'));
      } finally {
        setRevokingFor(null);
      }
    },
    [orgId],
  );

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
            void invite(payload);
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
                      void changeRole(member.actorId, roleId);
                    }}
                    onRemove={() => {
                      void removeMember(member.actorId);
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
              void revokeInvitation(id);
            }}
          />
        </div>
      </section>
    </div>
  );
}
