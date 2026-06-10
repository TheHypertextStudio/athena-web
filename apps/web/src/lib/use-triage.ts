import {
  type IntegrationDirectoryProvider,
  type IntegrationOut,
  type MemberOut,
  ProgramId,
  type ProgramOut,
  ProjectId,
  type ProjectOut,
  type TaskOut,
  type TeamOut,
} from '@docket/types';
import type { GroupKey } from '@docket/ui/components';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { buildProviderResolver } from '@/components/triage/provider-directory';
import type { TriageDestination } from '@/components/triage/triage-actions';
import type { TriageRowData } from '@/components/triage/triage-row';
import { api } from './api';
import { readError, readProblem } from './problem';
import { stateTypeOf } from './work-state';

function isUnsorted(task: TaskOut): boolean {
  return (task.projectId ?? null) === null && (task.programId ?? null) === null;
}

export interface TriageState {
  queue: readonly TaskOut[];
  loading: boolean;
  loadError: string | null;
  actionError: string | null;
  pending: ReadonlySet<string>;
  projectDestinations: readonly TriageDestination[];
  programDestinations: readonly TriageDestination[];
  providerName: (integrationId: string | null | undefined) => string;
  toRow: (task: TaskOut) => TriageRowData;
  groupBy: (task: TaskOut) => GroupKey;
  reload: () => void;
  sortToProject: (taskId: string, projectId: string) => Promise<void>;
  sortToProgram: (taskId: string, programId: string) => Promise<void>;
  dismiss: (taskId: string) => Promise<void>;
}

export function useTriage(orgId: string): TriageState {
  const [tasks, setTasks] = useState<readonly TaskOut[]>([]);
  const [teams, setTeams] = useState<readonly TeamOut[]>([]);
  const [members, setMembers] = useState<readonly MemberOut[]>([]);
  const [projects, setProjects] = useState<readonly ProjectOut[]>([]);
  const [programs, setPrograms] = useState<readonly ProgramOut[]>([]);
  const [integrations, setIntegrations] = useState<readonly IntegrationOut[]>([]);
  const [directory, setDirectory] = useState<readonly IntegrationDirectoryProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      const [tasksRes, teamsRes, membersRes, projectsRes, programsRes, integrationsRes, dirRes] =
        await Promise.all([
          api.v1.orgs[':orgId'].tasks.$get({ param: { orgId } }),
          api.v1.orgs[':orgId'].teams.$get({ param: { orgId } }),
          api.v1.orgs[':orgId'].members.$get({ param: { orgId } }),
          api.v1.orgs[':orgId'].projects.$get({ param: { orgId } }),
          api.v1.orgs[':orgId'].programs.$get({ param: { orgId } }),
          api.v1.orgs[':orgId'].integrations.$get({ param: { orgId } }),
          api.v1.orgs[':orgId'].integrations.directory.$get({ param: { orgId } }),
        ]);
      if (!tasksRes.ok) {
        setLoadError(await readProblem(tasksRes, 'Could not load the triage queue.'));
        return;
      }
      setTasks((await tasksRes.json()).items);
      if (teamsRes.ok) setTeams((await teamsRes.json()).items);
      if (membersRes.ok) setMembers((await membersRes.json()).items);
      if (projectsRes.ok) setProjects((await projectsRes.json()).items);
      if (programsRes.ok) setPrograms((await programsRes.json()).items);
      if (integrationsRes.ok) setIntegrations((await integrationsRes.json()).items);
      if (dirRes.ok) setDirectory((await dirRes.json()).providers);
    } catch (caught) {
      setLoadError(readError(caught, 'Something went wrong loading the triage queue.'));
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

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

  const dropTask = useCallback((taskId: string): void => {
    setTasks((current) => current.filter((task) => task.id !== taskId));
  }, []);

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
          setActionError(await readProblem(res, 'Could not move that item. Please try again.'));
          return;
        }
        dropTask(taskId);
      } catch (caught) {
        setActionError(readError(caught, 'Something went wrong moving that item.'));
      } finally {
        endPending(taskId);
      }
    },
    [orgId, beginPending, endPending, dropTask],
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
          setActionError(await readProblem(res, 'Could not send that item. Please try again.'));
          return;
        }
        dropTask(taskId);
      } catch (caught) {
        setActionError(readError(caught, 'Something went wrong sending that item.'));
      } finally {
        endPending(taskId);
      }
    },
    [orgId, beginPending, endPending, dropTask],
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
          setActionError(await readProblem(res, 'Could not dismiss that item. Please try again.'));
          return;
        }
        dropTask(taskId);
      } catch (caught) {
        setActionError(readError(caught, 'Something went wrong dismissing that item.'));
      } finally {
        endPending(taskId);
      }
    },
    [orgId, beginPending, endPending, dropTask],
  );

  return {
    queue,
    loading,
    loadError,
    actionError,
    pending,
    projectDestinations,
    programDestinations,
    providerName,
    toRow,
    groupBy,
    reload: () => {
      void load();
    },
    sortToProject,
    sortToProgram,
    dismiss,
  };
}
