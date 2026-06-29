/**
 * Async fetcher that composes the full project-detail payload from the typed RPC surface.
 *
 * @remarks
 * Runs 10 parallel API requests (projects list, progress, tasks, milestones, members, agents,
 * sessions, programs, initiatives, roles), then performs per-task and per-initiative waterfall
 * lookups to build the milestone-grouped task list and resolve the current initiative link.
 * Returns an {@link RpcResponse}-shaped result so it can be passed directly to
 * {@link useApiQuery}. Sub-reads degrade to benign defaults so the screen still renders when
 * optional data is unavailable.
 */
import type {
  AgentSessionOut,
  InitiativeOut,
  MemberOut,
  MilestoneOut,
  ProjectOut,
  ProjectProgress,
  ProgramOut,
  RoleOut,
  SessionActivityOut,
  TaskOut,
} from '@docket/types';
import { ProjectId } from '@docket/types';

import type { AgentHere } from '@/components/project-detail/agents-strip';
import type { AgentActivityEntry } from '@/components/project-detail/discussion';
import type { MilestoneTask } from '@/components/project-detail/milestone-tasks';
import {
  type ActorDirectory,
  buildActorDirectory,
} from '@/components/project-detail/actor-directory';
import { api } from './api';
import { type RpcResponse, apiQueryOptions, queryKeys } from './query';

/** The composite project-detail payload assembled from the typed RPC surface. */
export interface ProjectDetailData {
  readonly project: ProjectOut | null;
  readonly progress: ProjectProgress | null;
  readonly milestones: readonly MilestoneOut[];
  readonly milestoneTasks: readonly MilestoneTask[];
  readonly agentsHere: readonly AgentHere[];
  readonly agentActivity: readonly AgentActivityEntry[];
  readonly resolveActor: ActorDirectory;
  readonly members: readonly MemberOut[];
  readonly roles: readonly RoleOut[];
  readonly programs: readonly ProgramOut[];
  readonly initiatives: readonly InitiativeOut[];
  readonly currentInitiativeId: string | null;
}

function activitySummary(activity: SessionActivityOut): string {
  const body = activity.body;
  const action = body['action'];
  if (action && typeof action === 'object' && 'summary' in action) {
    const summary = (action as { summary?: unknown }).summary;
    if (typeof summary === 'string') return summary;
  }
  const text = body['text'];
  if (typeof text === 'string') return text;
  return activity.type;
}

/**
 * Typed query definition for the project detail — the single source the detail page reads with and
 * portfolio rows prefetch on hover, so they share one cache entry under `queryKeys.project`.
 *
 * @param orgId - The active org.
 * @param projectId - The project to load.
 * @param fallbackMessage - Shown if the composite read fails.
 */
export function projectDetailDef(
  orgId: string,
  projectId: string,
  fallbackMessage = 'Could not load this project.',
) {
  return apiQueryOptions(
    queryKeys.project(orgId, projectId),
    fetchProjectDetail(orgId, projectId),
    fallbackMessage,
  );
}

/**
 * Build the composite project-detail fetcher as a thunk for {@link useApiQuery}.
 *
 * @param orgId - The active organization id.
 * @param projectId - The project being viewed.
 */
export function fetchProjectDetail(
  orgId: string,
  projectId: string,
): () => Promise<RpcResponse<ProjectDetailData>> {
  return async () => {
    const [
      projectsRes,
      progressRes,
      tasksRes,
      milestonesRes,
      membersRes,
      agentsRes,
      sessionsRes,
      programsRes,
      initiativesRes,
      rolesRes,
      rollupRes,
    ] = await Promise.all([
      api.v1.orgs[':orgId'].projects.$get({ param: { orgId }, query: {} }),
      api.v1.orgs[':orgId'].projects[':id'].progress.$get({ param: { orgId, id: projectId } }),
      api.v1.orgs[':orgId'].tasks.$get({ param: { orgId }, query: {} }),
      api.v1.orgs[':orgId'].milestones.$get({
        param: { orgId },
        query: { projectId: ProjectId.parse(projectId) },
      }),
      api.v1.orgs[':orgId'].members.$get({ param: { orgId } }),
      api.v1.orgs[':orgId'].agents.$get({ param: { orgId } }),
      api.v1.orgs[':orgId'].sessions.$get({ param: { orgId }, query: {} }),
      api.v1.orgs[':orgId'].programs.$get({ param: { orgId }, query: {} }),
      api.v1.orgs[':orgId'].initiatives.$get({ param: { orgId }, query: {} }),
      api.v1.orgs[':orgId'].roles.$get({ param: { orgId } }),
      api.v1.orgs[':orgId'].projects[':id'].rollup.$get({ param: { orgId, id: projectId } }),
    ]);

    if (!projectsRes.ok) {
      return {
        ok: false,
        status: projectsRes.status,
        json: () => projectsRes.json() as unknown as Promise<ProjectDetailData>,
      };
    }

    const { items: projectItems } = await projectsRes.json();
    const found = projectItems.find((p) => p.id === projectId) ?? null;
    const progress = progressRes.ok ? await progressRes.json() : null;

    const memberItems: MemberOut[] = membersRes.ok ? (await membersRes.json()).items : [];
    const agents = agentsRes.ok ? (await agentsRes.json()).items : [];
    const agentActorByAgentId = new Map(agents.map((a) => [a.id, a.actorId]));
    const directory = buildActorDirectory({
      members: memberItems.map((m) => ({ actorId: m.actorId, displayName: m.displayName })),
      agents: agents.map((a) => ({ actorId: a.actorId, name: `Agent ${a.actorId.slice(0, 6)}` })),
    });
    const roles: RoleOut[] = rolesRes.ok ? (await rolesRes.json()).items : [];
    const programs: readonly ProgramOut[] = programsRes.ok ? (await programsRes.json()).items : [];
    const initiatives: readonly InitiativeOut[] = initiativesRes.ok
      ? (await initiativesRes.json()).items
      : [];
    const milestones = milestonesRes.ok ? (await milestonesRes.json()).items : [];

    const allTasks: readonly TaskOut[] = tasksRes.ok ? (await tasksRes.json()).items : [];
    const projectTasks = allTasks.filter((t) => t.projectId === projectId);

    // The project's task→milestone map and its initiative come from one roll-up read
    // (`…/projects/:id/rollup`), collapsing what were a per-task `tasks/:id` N+1 (only
    // `TaskDetail` carries `milestoneId`) and a per-initiative `initiatives/:id/timeline` M+1.
    // A failed roll-up degrades to no grouping / no initiative rather than failing the screen.
    const rollup = rollupRes.ok ? await rollupRes.json() : null;
    const milestoneByTaskId = new Map<string, string | null>(
      (rollup?.taskMilestones ?? []).map((tm) => [tm.taskId, tm.milestoneId]),
    );
    const milestoneTasks: readonly MilestoneTask[] = projectTasks.map((t) => ({
      task: t,
      milestoneId: milestoneByTaskId.get(t.id) ?? null,
    }));
    const currentInitiativeId = rollup?.currentInitiativeId ?? null;

    const projectTaskIds = new Set<string>(projectTasks.map((t) => t.id));
    const projectTaskTitle = new Map<string, string>(projectTasks.map((t) => [t.id, t.title]));
    const sessions: readonly AgentSessionOut[] = sessionsRes.ok
      ? (await sessionsRes.json()).items
      : [];
    const here = sessions.filter(
      (s): s is AgentSessionOut & { taskId: string } =>
        typeof s.taskId === 'string' && projectTaskIds.has(s.taskId),
    );
    const agentsHere: readonly AgentHere[] = here.map((s) => ({
      sessionId: s.id,
      agentName: directory(agentActorByAgentId.get(s.agentId) ?? null).name,
      taskTitle: s.taskId ? (projectTaskTitle.get(s.taskId) ?? 'a task') : 'a task',
      status: s.status,
    }));

    const activityLists = await Promise.all(
      here.slice(0, 5).map(async (s) => {
        const detailRes = await api.v1.orgs[':orgId'].sessions[':id'].$get({
          param: { orgId, id: s.id },
        });
        if (!detailRes.ok) return [];
        const detail = await detailRes.json();
        const agentName = directory(agentActorByAgentId.get(s.agentId) ?? null).name;
        return detail.activities.map(
          (a): AgentActivityEntry => ({
            id: a.id,
            agentName,
            type: a.type,
            summary: activitySummary(a),
            createdAt: a.createdAt,
          }),
        );
      }),
    );
    const agentActivity = activityLists
      .flat()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 8);

    const data: ProjectDetailData = {
      project: found,
      progress,
      milestones,
      milestoneTasks,
      agentsHere,
      agentActivity,
      resolveActor: directory,
      members: memberItems,
      roles,
      programs,
      initiatives,
      currentInitiativeId,
    };
    return { ok: true, status: projectsRes.status, json: () => Promise.resolve(data) };
  };
}
