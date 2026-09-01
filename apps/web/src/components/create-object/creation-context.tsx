'use client';

import type { MemberOut } from '@docket/identity-access/member-contract';
import type { OrgOut, OrgSummary } from '../../lib/contracts/organization';
import type { RoleOut } from '../../lib/contracts/role';
import type { TeamOut } from '../../lib/contracts/team';
import type { VocabularySkin } from '@docket/work/vocabulary';
import { createContext, type JSX, type ReactNode, useContext, useMemo } from 'react';

import { api } from '@/lib/api';
import { useSession } from '@/lib/auth-client';
import { STALE, apiQueryOptions, queryKeys, useApiQuery } from '@/lib/query';
import { useOrgCapability } from '@/lib/use-org-capability';

import type { CreateObjectRequest } from './create-object-provider';

/** Key assigned to the seeded default team in every new workspace. */
const DEFAULT_TEAM_KEY = 'GEN';

/** Permission facts derived for the selected destination workspace. */
export interface CreationPermissions {
  /** Whether the signed-in member may create ordinary work in the workspace. */
  readonly canContribute: boolean;
  /** Whether the signed-in member may create structural objects in the workspace. */
  readonly canManage: boolean;
  /** Whether the member may create the kind named by the active request. */
  readonly canCreate: boolean;
  /** Whether the member and role records required to decide permission are still loading. */
  readonly loading: boolean;
}

/** Selected destination data shared by every kind-specific composer. */
export interface CreationContextValue {
  /** Every workspace the signed-in user may choose as a destination. */
  readonly workspaces: readonly OrgSummary[];
  /** The currently selected destination id, independent of the shell's active workspace. */
  readonly targetWorkspaceId: string | null;
  /** Select a different destination without navigating or rebinding the background shell. */
  readonly setTargetWorkspaceId: (workspaceId: string) => void;
  /** The selected workspace's full detail, or `null` before it resolves. */
  readonly workspace: OrgOut | null;
  /** The selected workspace's teams. */
  readonly teams: readonly TeamOut[];
  /** The selected workspace's human members. */
  readonly members: readonly MemberOut[];
  /** The selected workspace's roles. */
  readonly roles: readonly RoleOut[];
  /** The selected workspace's vocabulary skin. */
  readonly vocabulary: VocabularySkin | null;
  /** The seeded General team's id, falling back to the first team when necessary. */
  readonly defaultTeamId: string | null;
  /** The selected workspace's derived create permissions. */
  readonly permissions: CreationPermissions;
  /** Whether any required destination query is still pending. */
  readonly loading: boolean;
  /** Application-owned copy for a failed destination read, or `null`. */
  readonly loadError: string | null;
}

const CreationContext = createContext<CreationContextValue | null>(null);

/** Props for the destination-data provider. */
export interface CreationContextProviderProps {
  /** Workspaces offered by the shell's membership query. */
  readonly workspaces: readonly OrgSummary[];
  /** Kind currently being created, or `null` while the global composer is closed. */
  readonly requestKind: CreateObjectRequest['kind'] | null;
  /** Selected destination id. */
  readonly targetWorkspaceId: string | null;
  /** Update the selected destination. */
  readonly onTargetWorkspaceChange: (workspaceId: string) => void;
  /** The global composer subtree. */
  readonly children: ReactNode;
}

/** A closed or destination-less context that performs no workspace reads. */
function IdleCreationContext({
  workspaces,
  targetWorkspaceId,
  onTargetWorkspaceChange,
  children,
}: Omit<CreationContextProviderProps, 'requestKind'>): JSX.Element {
  const value = useMemo<CreationContextValue>(
    () => ({
      workspaces,
      targetWorkspaceId,
      setTargetWorkspaceId: onTargetWorkspaceChange,
      workspace: null,
      teams: [],
      members: [],
      roles: [],
      vocabulary: null,
      defaultTeamId: null,
      permissions: { canContribute: false, canManage: false, canCreate: false, loading: false },
      loading: false,
      loadError: null,
    }),
    [workspaces, targetWorkspaceId, onTargetWorkspaceChange],
  );
  return <CreationContext.Provider value={value}>{children}</CreationContext.Provider>;
}

/** Props for the query-bearing destination context. */
interface ResolvedCreationContextProps extends Omit<CreationContextProviderProps, 'requestKind'> {
  readonly requestKind: CreateObjectRequest['kind'];
  readonly targetWorkspaceId: string;
}

/** Resolve all creation dependencies for one concrete workspace target. */
function ResolvedCreationContext({
  workspaces,
  requestKind,
  targetWorkspaceId,
  onTargetWorkspaceChange,
  children,
}: ResolvedCreationContextProps): JSX.Element {
  const workspaceQ = useApiQuery(
    apiQueryOptions(
      queryKeys.organization(targetWorkspaceId),
      () => api.v1.orgs[':orgId'].$get({ param: { orgId: targetWorkspaceId } }),
      'Could not load the workspace.',
      { staleTime: STALE.static },
    ),
  );
  const teamsQ = useApiQuery(
    apiQueryOptions(
      queryKeys.teams(targetWorkspaceId),
      () => api.v1.orgs[':orgId'].teams.$get({ param: { orgId: targetWorkspaceId } }),
      'Could not load teams.',
      { staleTime: STALE.static },
    ),
  );
  const membersQ = useApiQuery(
    apiQueryOptions(
      queryKeys.members(targetWorkspaceId),
      () => api.v1.orgs[':orgId'].members.$get({ param: { orgId: targetWorkspaceId } }),
      'Could not load members.',
      { staleTime: STALE.static },
    ),
  );
  const rolesQ = useApiQuery(
    apiQueryOptions(
      queryKeys.roles(targetWorkspaceId),
      () => api.v1.orgs[':orgId'].roles.$get({ param: { orgId: targetWorkspaceId } }),
      'Could not load roles.',
      { staleTime: STALE.static },
    ),
  );

  const teams = useMemo<readonly TeamOut[]>(() => teamsQ.data?.items ?? [], [teamsQ.data]);
  const members = useMemo<readonly MemberOut[]>(() => membersQ.data?.items ?? [], [membersQ.data]);
  const roles = useMemo<readonly RoleOut[]>(() => rolesQ.data?.items ?? [], [rolesQ.data]);
  const { isPending: identityLoading } = useSession();
  const resolvedCanContribute = useOrgCapability(members, roles, 'contribute');
  const resolvedCanManage = useOrgCapability(members, roles, 'manage');
  const canContribute = !identityLoading && resolvedCanContribute;
  const canManage = !identityLoading && resolvedCanManage;
  const permissionsLoading = identityLoading || membersQ.isPending || rolesQ.isPending;
  const canCreate = requestKind === 'program' || requestKind === 'team' ? canManage : canContribute;
  const defaultTeam = teams.find((team) => team.key === DEFAULT_TEAM_KEY) ?? teams[0] ?? null;
  const loading =
    workspaceQ.isPending || teamsQ.isPending || membersQ.isPending || rolesQ.isPending;
  const loadError =
    workspaceQ.isError || teamsQ.isError || membersQ.isError || rolesQ.isError
      ? 'Could not load creation options for this workspace.'
      : null;

  const value = useMemo<CreationContextValue>(
    () => ({
      workspaces,
      targetWorkspaceId,
      setTargetWorkspaceId: onTargetWorkspaceChange,
      workspace: workspaceQ.data ?? null,
      teams,
      members,
      roles,
      vocabulary: workspaceQ.data?.vocabulary ?? null,
      defaultTeamId: defaultTeam?.id ?? null,
      permissions: {
        canContribute,
        canManage,
        canCreate,
        loading: permissionsLoading,
      },
      loading,
      loadError,
    }),
    [
      workspaces,
      targetWorkspaceId,
      onTargetWorkspaceChange,
      workspaceQ.data,
      teams,
      members,
      roles,
      defaultTeam,
      canContribute,
      canManage,
      canCreate,
      permissionsLoading,
      loading,
      loadError,
    ],
  );

  return <CreationContext.Provider value={value}>{children}</CreationContext.Provider>;
}

/**
 * Provide the destination workspace model, loading it only while a create request is active.
 *
 * @remarks
 * Four independently keyed TanStack queries resolve the workspace detail (including vocabulary),
 * teams, members, and roles. Permission and default-team facts are derived from those typed
 * results. Keeping the closed state query-free lets the provider remain mounted around the global
 * composers without adding background traffic to every page.
 */
export function CreationContextProvider({
  workspaces,
  requestKind,
  targetWorkspaceId,
  onTargetWorkspaceChange,
  children,
}: CreationContextProviderProps): JSX.Element {
  if (requestKind === null || targetWorkspaceId === null) {
    return (
      <IdleCreationContext
        workspaces={workspaces}
        targetWorkspaceId={targetWorkspaceId}
        onTargetWorkspaceChange={onTargetWorkspaceChange}
      >
        {children}
      </IdleCreationContext>
    );
  }

  return (
    <ResolvedCreationContext
      workspaces={workspaces}
      requestKind={requestKind}
      targetWorkspaceId={targetWorkspaceId}
      onTargetWorkspaceChange={onTargetWorkspaceChange}
    >
      {children}
    </ResolvedCreationContext>
  );
}

/**
 * Read the active creation destination and its supporting data.
 *
 * @returns The selected workspace, rosters, vocabulary, permissions, and loading state.
 * @throws {Error} when called outside a {@link CreationContextProvider}.
 */
export function useCreationContext(): CreationContextValue {
  const value = useContext(CreationContext);
  if (value === null) {
    throw new Error('useCreationContext must be used within a <CreationContextProvider>.');
  }
  return value;
}
