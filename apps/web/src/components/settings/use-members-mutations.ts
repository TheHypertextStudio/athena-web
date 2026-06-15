import type { InvitationOut, MemberOut } from '@docket/types';
import { RoleId } from '@docket/types';
import { useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { unwrap, useApiMutation } from '@/lib/query';

import type { InvitePayload } from './invite-form';

/** MembersMutationState describes the settings data contract shared by the hook or component. */
export interface MembersMutationState {
  invite: (payload: InvitePayload) => void;
  changeRole: (actorId: string, roleId: string) => void;
  remove: (actorId: string) => void;
  revoke: (invitationId: string) => void;
  inviting: boolean;
  inviteError: string | null;
  actionError: string | null;
  savingRoleFor: string | null;
  removingFor: string | null;
  revokingFor: string | null;
}

interface MembersBody {
  items: MemberOut[];
  nextCursor?: string;
  total?: number;
}
interface InvitationsBody {
  items: InvitationOut[];
  nextCursor?: string;
  total?: number;
}

/** useMembersMutations coordinates settings state, loading, and mutations for its screen. */
export function useMembersMutations(
  orgId: string,
  membersKey: readonly string[],
  invitationsKey: readonly string[],
): MembersMutationState {
  const queryClient = useQueryClient();

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
      queryClient.setQueryData<InvitationsBody>(invitationsKey, (current) =>
        current ? { ...current, items: [created, ...current.items] } : { items: [created] },
      );
    },
    invalidateKeys: [invitationsKey],
  });

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
      await queryClient.cancelQueries({ queryKey: membersKey as string[] });
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
      queryClient.setQueryData<MembersBody>(membersKey, (current) =>
        current
          ? { ...current, items: current.items.map((m) => (m.actorId === actorId ? updated : m)) }
          : current,
      );
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(membersKey as string[], context.previous);
    },
    invalidateKeys: [membersKey],
  });

  const removeMutation = useApiMutation({
    mutationFn: (actorId: string) =>
      unwrap(
        () => api.v1.orgs[':orgId'].members[':actorId'].$delete({ param: { orgId, actorId } }),
        'Could not remove this member.',
      ),
    onMutate: async (actorId) => {
      await queryClient.cancelQueries({ queryKey: membersKey as string[] });
      const previous = queryClient.getQueryData<MembersBody>(membersKey);
      queryClient.setQueryData<MembersBody>(membersKey, (current) =>
        current
          ? { ...current, items: current.items.filter((m) => m.actorId !== actorId) }
          : current,
      );
      return { previous };
    },
    onError: (_error, _actorId, context) => {
      if (context?.previous) queryClient.setQueryData(membersKey as string[], context.previous);
    },
    invalidateKeys: [membersKey],
  });

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
      await queryClient.cancelQueries({ queryKey: invitationsKey as string[] });
      const previous = queryClient.getQueryData<InvitationsBody>(invitationsKey);
      queryClient.setQueryData<InvitationsBody>(invitationsKey, (current) =>
        current
          ? { ...current, items: current.items.filter((i) => i.id !== invitationId) }
          : current,
      );
      return { previous };
    },
    onError: (_error, _invitationId, context) => {
      if (context?.previous) queryClient.setQueryData(invitationsKey as string[], context.previous);
    },
    invalidateKeys: [invitationsKey],
  });

  const inviting = inviteMutation.isPending;
  const inviteError = inviteMutation.isError ? inviteMutation.error.message : null;
  const actionError =
    (roleMutation.isError ? roleMutation.error.message : null) ??
    (removeMutation.isError ? removeMutation.error.message : null) ??
    (revokeMutation.isError ? revokeMutation.error.message : null);
  const savingRoleFor = roleMutation.isPending ? roleMutation.variables.actorId : null;
  const removingFor = removeMutation.isPending ? removeMutation.variables : null;
  const revokingFor = revokeMutation.isPending ? revokeMutation.variables : null;

  return {
    invite: (payload) => {
      inviteMutation.mutate(payload);
    },
    changeRole: (actorId, roleId) => {
      roleMutation.mutate({ actorId, roleId });
    },
    remove: (actorId) => {
      removeMutation.mutate(actorId);
    },
    revoke: (invitationId) => {
      revokeMutation.mutate(invitationId);
    },
    inviting,
    inviteError,
    actionError,
    savingRoleFor,
    removingFor,
    revokingFor,
  };
}
