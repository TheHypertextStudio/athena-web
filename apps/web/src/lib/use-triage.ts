import {
  type IntegrationDirectoryProvider,
  type IntegrationOut,
  type MemberOut,
  ProgramId,
  type ProgramOut,
  ProjectId,
  type ProjectOut,
  type RoleOut,
  type TaskOut,
  type TeamOut,
} from '@docket/types';
import type { GroupKey } from '@docket/ui/components';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';

import { buildProviderResolver } from '@/components/triage/provider-directory';
import type { TriageDestination } from '@/components/triage/triage-actions';
import type { TriageRowData } from '@/components/triage/triage-row';
import { api } from './api';
import { userErrorMessage, readProblemError } from './problem';
import { STALE, apiQueryOptions, queryKeys, useApiQuery } from './query';
import { useOrgCapability } from './use-org-capability';
import { useRenameTask } from './use-rename-task';
import { stateTypeOf } from './work-state';

function isUnsorted(task: TaskOut): boolean {
  return (task.projectId ?? null) === null && (task.programId ?? null) === null;
}

/** TriageState describes the use triage data contract shared by the hook or component. */
export interface TriageState {
  queue: readonly TaskOut[];
  loading: boolean;
  loadError: string | null;
  actionError: string | null;
  pending: ReadonlySet<string>;
  projectDestinations: readonly TriageDestination[];
  programDestinations: readonly TriageDestination[];
  providerName: (integrationId: string | null | undefined) => string;
  /** Whether the viewer may rename queued tasks in place (the org `contribute` capability). */
  canEdit: boolean;
  /** Rename a task by id, reconciling the triage queue on settle. */
  rename: (taskId: string, title: string) => void;
  toRow: (task: TaskOut) => TriageRowData;
  groupBy: (task: TaskOut) => GroupKey;
  sortToProject: (taskId: string, projectId: string) => Promise<void>;
  sortToProgram: (taskId: string, programId: string) => Promise<void>;
  dismiss: (taskId: string) => Promise<void>;
}

/**
 * Coordinates the Triage screen via the shared {@link useApiQuery} layer.
 *
 * @remarks
 * Each of the seven data slices is its own query keyed off the standard {@link queryKeys}, so the
 * cache is shared with the rest of the app (e.g. moving a task elsewhere already invalidates
 * `tasks(orgId)`, which refreshes the queue here too) and every slice auto-refetches on window
 * focus — no manual Refresh control. Sorting / dismissing a task invalidates `tasks(orgId)` so the
 * server-side state (the task is no longer unsorted, or is gone) drops it from the queue.
 */
export function useTriage(orgId: string): TriageState {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);

  // The queue itself is volatile (tasks get sorted/dismissed out of it); the supporting rosters and
  // the integration vocabulary are static within a triage session.
  const tasksQ = useApiQuery(
    apiQueryOptions(
      queryKeys.tasks(orgId),
      () => api.v1.orgs[':orgId'].tasks.$get({ param: { orgId }, query: {} }),
      'Could not load the triage queue.',
      { staleTime: STALE.volatile },
    ),
  );
  const teamsQ = useApiQuery(
    apiQueryOptions(
      queryKeys.teams(orgId),
      () => api.v1.orgs[':orgId'].teams.$get({ param: { orgId } }),
      'Could not load teams.',
      { staleTime: STALE.static },
    ),
  );
  const membersQ = useApiQuery(
    apiQueryOptions(
      queryKeys.members(orgId),
      () => api.v1.orgs[':orgId'].members.$get({ param: { orgId } }),
      'Could not load members.',
      { staleTime: STALE.static },
    ),
  );
  const rolesQ = useApiQuery(
    apiQueryOptions(
      queryKeys.roles(orgId),
      () => api.v1.orgs[':orgId'].roles.$get({ param: { orgId } }),
      'Could not load roles.',
      { staleTime: STALE.static },
    ),
  );
  const projectsQ = useApiQuery(
    apiQueryOptions(
      queryKeys.projects(orgId),
      () => api.v1.orgs[':orgId'].projects.$get({ param: { orgId }, query: {} }),
      'Could not load projects.',
      { staleTime: STALE.static },
    ),
  );
  const programsQ = useApiQuery(
    apiQueryOptions(
      queryKeys.programs(orgId),
      () => api.v1.orgs[':orgId'].programs.$get({ param: { orgId }, query: {} }),
      'Could not load programs.',
      { staleTime: STALE.static },
    ),
  );
  const integrationsQ = useApiQuery(
    apiQueryOptions(
      queryKeys.integrations(orgId),
      () => api.v1.orgs[':orgId'].integrations.$get({ param: { orgId } }),
      'Could not load integrations.',
      { staleTime: STALE.static },
    ),
  );
  const directoryQ = useApiQuery(
    apiQueryOptions(
      queryKeys.integrationsDirectory(orgId),
      () => api.v1.orgs[':orgId'].integrations.directory.$get({ param: { orgId } }),
      'Could not load the integration directory.',
      { staleTime: STALE.static },
    ),
  );

  const tasks = useMemo<readonly TaskOut[]>(() => tasksQ.data?.items ?? [], [tasksQ.data]);
  const teams = useMemo<readonly TeamOut[]>(() => teamsQ.data?.items ?? [], [teamsQ.data]);
  const members = useMemo<readonly MemberOut[]>(() => membersQ.data?.items ?? [], [membersQ.data]);
  const roles = useMemo<readonly RoleOut[]>(() => rolesQ.data?.items ?? [], [rolesQ.data]);

  const canEdit = useOrgCapability(members, roles, 'contribute');
  const rename = useRenameTask(orgId, [queryKeys.tasks(orgId)]);
  const projects = useMemo<readonly ProjectOut[]>(
    () => projectsQ.data?.items ?? [],
    [projectsQ.data],
  );
  const programs = useMemo<readonly ProgramOut[]>(
    () => programsQ.data?.items ?? [],
    [programsQ.data],
  );
  const integrations = useMemo<readonly IntegrationOut[]>(
    () => integrationsQ.data?.items ?? [],
    [integrationsQ.data],
  );
  const directory = useMemo<readonly IntegrationDirectoryProvider[]>(
    () => directoryQ.data?.providers ?? [],
    [directoryQ.data],
  );

  const triageTeamIds = useMemo(
    () => new Set(teams.filter((team) => team.triageEnabled).map((team) => team.id)),
    [teams],
  );

  const teamName = useMemo(() => {
    const byId = new Map<string, string>(teams.map((team) => [team.id, team.name]));
    return (teamId: string): string => byId.get(teamId) ?? 'Team';
  }, [teams]);

  const memberByActor = useMemo(
    () => new Map<string, MemberOut>(members.map((member) => [member.actorId, member])),
    [members],
  );

  const providerName = useMemo(
    () => buildProviderResolver(integrations, directory),
    [integrations, directory],
  );

  const projectDestinations = useMemo<readonly TriageDestination[]>(
    () => projects.map((project) => ({ id: project.id, name: project.name })),
    [projects],
  );

  const programDestinations = useMemo<readonly TriageDestination[]>(
    () => programs.map((program) => ({ id: program.id, name: program.name })),
    [programs],
  );

  const queue = useMemo(() => {
    const inTriage = tasks.filter((task) => isUnsorted(task) && triageTeamIds.has(task.teamId));
    return [...inTriage].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [tasks, triageTeamIds]);

  const toRow = useCallback(
    (task: TaskOut): TriageRowData => {
      const member = task.assigneeId ? memberByActor.get(task.assigneeId) : undefined;
      return {
        id: task.id,
        title: task.title,
        stateType: stateTypeOf(task.state),
        provenance: task.provenance,
        assigneeName: member?.displayName ?? null,
        assigneeAvatarUrl: member?.avatar ?? null,
      };
    },
    [memberByActor],
  );

  const groupBy = useCallback(
    (task: TaskOut): GroupKey => ({ id: task.teamId, label: teamName(task.teamId) }),
    [teamName],
  );

  const beginPending = useCallback((taskId: string): void => {
    setPending((current) => new Set(current).add(taskId));
  }, []);

  const endPending = useCallback((taskId: string): void => {
    setPending((current) => {
      const next = new Set(current);
      next.delete(taskId);
      return next;
    });
  }, []);

  /** Re-sync the task list so a sorted/dismissed task leaves the queue. */
  const refreshTasks = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.tasks(orgId) }),
    [queryClient, orgId],
  );

  const sortToProject = useCallback(
    async (taskId: string, projectId: string): Promise<void> => {
      setActionError(null);
      beginPending(taskId);
      try {
        const res = await api.v1.orgs[':orgId'].tasks[':id'].$patch({
          param: { orgId, id: taskId },
          json: { projectId: ProjectId.parse(projectId) },
        });
        if (!res.ok) {
          setActionError(
            userErrorMessage(
              await readProblemError(res, 'Could not move that item. Please try again.'),
              'Could not move that item. Please try again.',
            ),
          );
          return;
        }
        await refreshTasks();
      } catch (caught) {
        setActionError(userErrorMessage(caught, 'Something went wrong moving that item.'));
      } finally {
        endPending(taskId);
      }
    },
    [orgId, beginPending, endPending, refreshTasks],
  );

  const sortToProgram = useCallback(
    async (taskId: string, programId: string): Promise<void> => {
      setActionError(null);
      beginPending(taskId);
      try {
        const res = await api.v1.orgs[':orgId'].tasks[':id'].$patch({
          param: { orgId, id: taskId },
          json: { programId: ProgramId.parse(programId) },
        });
        if (!res.ok) {
          setActionError(
            userErrorMessage(
              await readProblemError(res, 'Could not send that item. Please try again.'),
              'Could not send that item. Please try again.',
            ),
          );
          return;
        }
        await refreshTasks();
      } catch (caught) {
        setActionError(userErrorMessage(caught, 'Something went wrong sending that item.'));
      } finally {
        endPending(taskId);
      }
    },
    [orgId, beginPending, endPending, refreshTasks],
  );

  const dismiss = useCallback(
    async (taskId: string): Promise<void> => {
      setActionError(null);
      beginPending(taskId);
      try {
        const res = await api.v1.orgs[':orgId'].tasks[':id'].$delete({
          param: { orgId, id: taskId },
        });
        if (!res.ok) {
          setActionError(
            userErrorMessage(
              await readProblemError(res, 'Could not dismiss that item. Please try again.'),
              'Could not dismiss that item. Please try again.',
            ),
          );
          return;
        }
        await refreshTasks();
      } catch (caught) {
        setActionError(userErrorMessage(caught, 'Something went wrong dismissing that item.'));
      } finally {
        endPending(taskId);
      }
    },
    [orgId, beginPending, endPending, refreshTasks],
  );

  return {
    queue,
    loading: tasksQ.isPending,
    loadError: tasksQ.error
      ? userErrorMessage(tasksQ.error, 'Could not load the triage queue.')
      : null,
    actionError,
    pending,
    projectDestinations,
    programDestinations,
    providerName,
    canEdit,
    rename,
    toRow,
    groupBy,
    sortToProject,
    sortToProgram,
    dismiss,
  };
}
