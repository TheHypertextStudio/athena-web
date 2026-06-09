'use client';

import {
  ActorId,
  type AgentSessionOut,
  type Health,
  type InitiativeOut,
  type MemberOut,
  type MilestoneOut,
  ProgramId,
  type ProgramOut,
  ProjectId,
  type ProjectOut,
  type ProjectProgress,
  type ProjectStatus,
  type ProjectUpdate,
  type RoleOut,
  type SessionActivityOut,
  type TaskOut,
  TeamId,
} from '@docket/types';
import type { PickerOption } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { Badge, Skeleton } from '@docket/ui/primitives';
import { useParams, useRouter } from 'next/navigation';
import { type JSX, useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import {
  type ActorDirectory,
  buildActorDirectory,
} from '@/components/project-detail/actor-directory';
import {
  initiativeOptions as toInitiativeOptions,
  memberActorOptions,
  programOptions as toProgramOptions,
} from '@/components/property-pickers/options';
import { useOrgCapability } from '@/lib/use-org-capability';
import { type AgentHere, AgentsStrip } from '@/components/project-detail/agents-strip';
import { type AgentActivityEntry, Discussion } from '@/components/project-detail/discussion';
import { type MilestoneTask, MilestoneTasks } from '@/components/project-detail/milestone-tasks';
import { OverviewSummary } from '@/components/project-detail/overview-summary';
import { HealthPill, WeightedProgress } from '@/components/project-detail/progress-bar';
import { PropertiesPanel } from '@/components/project-detail/properties-panel';
import { type TabItem, ProjectTabs } from '@/components/project-detail/tabs';
import { UpdatesTab } from '@/components/project-detail/updates-tab';
import { useActiveOrg } from '@/components/active-org';
import { api } from '@/lib/api';
import { type RpcResponse, queryKeys, unwrap, useApiMutation, useApiQuery } from '@/lib/query';

/** Human label for each project lifecycle status. */
const STATUS_LABEL: Record<string, string> = {
  planned: 'Planned',
  active: 'Active',
  completed: 'Completed',
  canceled: 'Canceled',
};

/** Statuses that count as terminal/quiet, rendered with the muted badge. */
function statusBadgeVariant(status: string): 'default' | 'secondary' {
  return status === 'active' ? 'default' : 'secondary';
}

/** The known project lifecycle statuses, used to narrow the wire `string` to a {@link ProjectStatus}. */
const PROJECT_STATUSES = new Set<ProjectStatus>(['planned', 'active', 'completed', 'canceled']);

/** Narrow a project's wire `status` string to a {@link ProjectStatus}, defaulting to `planned`. */
function projectStatusOf(status: string): ProjectStatus {
  return PROJECT_STATUSES.has(status as ProjectStatus) ? (status as ProjectStatus) : 'planned';
}

/** The three top-level tabs of the project-detail screen. */
type TabId = 'overview' | 'tasks' | 'updates';

/** The unbranded properties-panel patch surface. */
interface ProjectPatch {
  leadId?: string | null;
  status?: ProjectStatus;
  health?: Health | null;
  startDate?: string | null;
  targetDate?: string | null;
  programId?: string | null;
}

/**
 * Build the branded project PATCH body from a {@link ProjectPatch}, omitting untouched fields.
 *
 * @remarks
 * One branded body, reused for the optimistic cache snapshot AND the request, so the wire shape
 * and the local mirror never drift. Returns the validated {@link ProjectUpdate} body, whose fields
 * are a subset of {@link ProjectOut} so it can be spread onto the cached project without widening
 * its branded fields.
 */
function toProjectPatchBody(patch: ProjectPatch): ProjectUpdate {
  return {
    ...(patch.leadId !== undefined
      ? { leadId: patch.leadId === null ? null : ActorId.parse(patch.leadId) }
      : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.health !== undefined ? { health: patch.health } : {}),
    ...(patch.startDate !== undefined ? { startDate: patch.startDate } : {}),
    ...(patch.targetDate !== undefined ? { targetDate: patch.targetDate } : {}),
    ...(patch.programId !== undefined
      ? { programId: patch.programId === null ? null : ProgramId.parse(patch.programId) }
      : {}),
  };
}

/** Pull a short human summary out of a session-activity body (action vs text shapes). */
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

/** The composite project-detail payload assembled from the typed RPC surface. */
interface ProjectDetailData {
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
  /**
   * The initiative this project is associated with, resolved from initiative timelines (the
   * association is an m2m edge rather than a column on the project).
   */
  readonly currentInitiativeId: string | null;
}

/**
 * Build the composite project-detail fetcher, returning a {@link RpcResponse}-shaped result so it
 * can drive {@link useApiQuery} directly.
 *
 * @remarks
 * Composes the project's depth from the typed RPC surface in parallel — the projects roster (to
 * find this project), its progress roll-up, its tasks (enriched with each task's milestone, which
 * the list DTO omits), its milestones, members/agents (for the actor directory + "agents here"),
 * the agent sessions whose task lives in this project, and the program/initiative/role option
 * sources for the properties panel. The composite resolves `ok`/`status` from the gating projects
 * read; sub-reads degrade to benign defaults so the screen still renders.
 */
function fetchProjectDetail(
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
    ] = await Promise.all([
      api.v1.orgs[':orgId'].projects.$get({ param: { orgId } }),
      api.v1.orgs[':orgId'].projects[':id'].progress.$get({ param: { orgId, id: projectId } }),
      api.v1.orgs[':orgId'].tasks.$get({ param: { orgId } }),
      api.v1.orgs[':orgId'].milestones.$get({
        param: { orgId },
        query: { projectId: ProjectId.parse(projectId) },
      }),
      api.v1.orgs[':orgId'].members.$get({ param: { orgId } }),
      api.v1.orgs[':orgId'].agents.$get({ param: { orgId } }),
      api.v1.orgs[':orgId'].sessions.$get({ param: { orgId }, query: {} }),
      api.v1.orgs[':orgId'].programs.$get({ param: { orgId } }),
      api.v1.orgs[':orgId'].initiatives.$get({ param: { orgId } }),
      api.v1.orgs[':orgId'].roles.$get({ param: { orgId } }),
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

    // Member + agent directory (shared by lead, authors, agent rows).
    const memberItems = membersRes.ok ? (await membersRes.json()).items : [];
    const agents = agentsRes.ok ? (await agentsRes.json()).items : [];
    // The agent's display name lives on its Actor, which the RPC surface does not expose a name
    // for; fall back to a short, stable label keyed off the agent's actor id.
    const agentActorByAgentId = new Map(agents.map((a) => [a.id, a.actorId]));
    const directory = buildActorDirectory({
      members: memberItems.map((m) => ({ actorId: m.actorId, displayName: m.displayName })),
      agents: agents.map((a) => ({ actorId: a.actorId, name: `Agent ${a.actorId.slice(0, 6)}` })),
    });
    const roles = rolesRes.ok ? (await rolesRes.json()).items : [];

    // Program + initiative option sources for the (interactive) properties panel.
    const programs: readonly ProgramOut[] = programsRes.ok ? (await programsRes.json()).items : [];
    const initiatives: readonly InitiativeOut[] = initiativesRes.ok
      ? (await initiativesRes.json()).items
      : [];

    // Milestones for this project (ordered by sort from the API).
    const milestones = milestonesRes.ok ? (await milestonesRes.json()).items : [];

    // This project's tasks, then resolve each task's milestone (the list DTO omits it).
    const allTasks: readonly TaskOut[] = tasksRes.ok ? (await tasksRes.json()).items : [];
    const projectTasks = allTasks.filter((t) => t.projectId === projectId);

    const milestoneTasks = await Promise.all(
      projectTasks.map(async (t): Promise<MilestoneTask> => {
        const detailRes = await api.v1.orgs[':orgId'].tasks[':id'].$get({
          param: { orgId, id: t.id },
        });
        if (!detailRes.ok) return { task: t, milestoneId: null };
        const detail = await detailRes.json();
        return { task: t, milestoneId: detail.milestoneId ?? null };
      }),
    );

    // Which initiative this project is associated with (resolved from initiative timelines).
    const initiativeMatches = await Promise.all(
      initiatives.map(async (init): Promise<string | null> => {
        const res = await api.v1.orgs[':orgId'].initiatives[':id'].timeline.$get({
          param: { orgId, id: init.id },
          query: {},
        });
        if (!res.ok) return null;
        const { projects } = await res.json();
        return projects.some((p) => p.id === projectId) ? init.id : null;
      }),
    );
    const currentInitiativeId = initiativeMatches.find((id) => id !== null) ?? null;

    // Agents here: sessions whose task belongs to this project.
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

    // Recent agent activity from those sessions (newest-first, capped).
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

/**
 * The project detail view — overview, milestone-grouped tasks, and updates.
 *
 * @remarks
 * A Client Component reached at `/orgs/[orgId]/projects/[projectId]`. It composes the project's
 * depth from the typed RPC surface through the dynamic-data layer:
 *
 * - **Overview** — leads with a weighted-progress bar (`…/projects/:id/progress`, which fills by
 *   estimate so bigger tasks count for more) and a health pill, an "agents here" strip (agent
 *   sessions whose task lives in this project), a properties panel
 *   (lead/timeline/program/initiative), and the comments + recent-agent-activity discussion.
 * - **Tasks** — the project's tasks grouped into milestone sections (`…/milestones`), then by
 *   workflow state; task milestones are resolved per-task since the list DTO omits them.
 * - **Updates** — the project's status updates (`…/updates?subject=project`) with a composer;
 *   posting a health verdict also updates the project's current health, so the overview refreshes.
 *
 * The detail, comments, and updates each stay live (auto-refetch on focus) without a manual
 * refresh control, and every property edit / comment / update / task create runs as an optimistic
 * mutation that reconciles against the server on settle. Entity nouns route through
 * {@link useVocabulary}; data is fetched at runtime so the production build needs no running server.
 */
export default function ProjectDetailPage(): JSX.Element {
  const router = useRouter();
  const params = useParams<{ orgId: string; projectId: string }>();
  const { orgId, projectId } = params;
  const queryClient = useQueryClient();
  const { teams, defaultTeamId, teamsLoading } = useActiveOrg();
  const projectLabel = useVocabulary('project');
  const taskNoun = useVocabulary('task').toLowerCase();
  const taskNounPlural = useVocabulary('task', { plural: true }).toLowerCase();

  const detailKey = queryKeys.project(orgId, projectId);
  const commentsKey = useMemo(() => [...detailKey, 'comments'] as const, [detailKey]);
  const updatesKey = useMemo(() => [...detailKey, 'updates'] as const, [detailKey]);

  const [tab, setTab] = useState<TabId>('overview');
  // The team new tasks land in: a user override (via the picker) or the org's default team.
  const [teamOverride, setTeamOverride] = useState<string | null>(null);
  const teamId = teamOverride ?? defaultTeamId;

  const detailQ = useApiQuery(
    detailKey,
    fetchProjectDetail(orgId, projectId),
    'Could not load this project.',
  );
  const detail = detailQ.data ?? null;
  const project = detail?.project ?? null;

  const commentsQ = useApiQuery(
    commentsKey,
    () =>
      api.v1.orgs[':orgId'].comments.$get({
        param: { orgId },
        query: { subjectType: 'project', subjectId: projectId },
      }),
    'Could not load comments.',
  );
  const updatesQ = useApiQuery(
    updatesKey,
    () =>
      api.v1.orgs[':orgId'].updates.$get({
        param: { orgId },
        query: { subjectType: 'project', subjectId: projectId },
      }),
    'Could not load updates.',
  );

  const comments = useMemo(() => commentsQ.data?.items ?? [], [commentsQ.data]);
  const updates = useMemo(() => updatesQ.data?.items ?? [], [updatesQ.data]);

  /** Apply a partial change to the cached project, preserving the rest of the composite payload. */
  const patchCachedProject = useCallback(
    (apply: (project: ProjectOut) => ProjectOut): ProjectDetailData | undefined => {
      const previous = queryClient.getQueryData<ProjectDetailData>(detailKey);
      queryClient.setQueryData<ProjectDetailData>(detailKey, (cur) =>
        cur && cur.project ? { ...cur, project: apply(cur.project) } : cur,
      );
      return previous;
    },
    [queryClient, detailKey],
  );

  /**
   * Optimistically patch the project: apply the change to the cached composite payload, fire the
   * PATCH, roll back to the prior snapshot on failure, and reconcile against the server on settle.
   */
  const patch = useApiMutation<ProjectOut, ProjectPatch, { previous?: ProjectDetailData }>({
    mutationFn: (patchBody) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].projects[':id'].$patch({
            param: { orgId, id: projectId },
            json: toProjectPatchBody(patchBody),
          }),
        'Could not update the project.',
      ),
    onMutate: async (patchBody) => {
      await queryClient.cancelQueries({ queryKey: detailKey });
      const body = toProjectPatchBody(patchBody);
      const previous = patchCachedProject((cur) => ({ ...cur, ...body }));
      return { previous };
    },
    onError: (_err, _body, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(detailKey, ctx.previous);
    },
    onSuccess: (updated) => {
      patchCachedProject(() => updated);
    },
    invalidateKeys: [detailKey, queryKeys.projects(orgId)],
  });
  const patchProject = patch.mutate;
  const patchError = patch.error?.message ?? null;

  /**
   * Change the project's associated initiative: unlink the old association, then link the new one
   * (the association is an m2m edge, not a project column). Optimistic with rollback.
   */
  const setInitiative = useApiMutation<undefined, string | null, { previous?: ProjectDetailData }>({
    mutationFn: async (nextInitiativeId) => {
      const current =
        queryClient.getQueryData<ProjectDetailData>(detailKey)?.currentInitiativeId ?? null;
      if (current === nextInitiativeId) return undefined;
      if (current) {
        await unwrap(
          () =>
            api.v1.orgs[':orgId'].initiatives[':id'].projects[':projectId'].$delete({
              param: { orgId, id: current, projectId },
            }),
          'Could not update the association.',
        );
      }
      if (nextInitiativeId) {
        await unwrap(
          () =>
            api.v1.orgs[':orgId'].initiatives[':id'].projects.$post({
              param: { orgId, id: nextInitiativeId },
              json: { projectId: ProjectId.parse(projectId) },
            }),
          'Could not update the association.',
        );
      }
      return undefined;
    },
    onMutate: async (nextInitiativeId) => {
      await queryClient.cancelQueries({ queryKey: detailKey });
      const previous = queryClient.getQueryData<ProjectDetailData>(detailKey);
      queryClient.setQueryData<ProjectDetailData>(detailKey, (cur) =>
        cur ? { ...cur, currentInitiativeId: nextInitiativeId } : cur,
      );
      return { previous };
    },
    onError: (_err, _next, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(detailKey, ctx.previous);
    },
    invalidateKeys: [detailKey],
  });
  const propsPending = patch.isPending || setInitiative.isPending;
  const propsError = patchError ?? setInitiative.error?.message ?? null;

  /** Post a new root comment; append it optimistically and reconcile on settle. */
  const postCommentM = useApiMutation({
    mutationFn: (body: string) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].comments.$post({
            param: { orgId },
            json: { subjectType: 'project', subjectId: projectId, body },
          }),
        'Could not post your comment.',
      ),
    invalidateKeys: [commentsKey],
  });

  /** Post a status update; a health verdict also moves the project's current health. */
  const postUpdateM = useApiMutation({
    mutationFn: ({ body, health }: { body: string; health: Health | undefined }) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].updates.$post({
            param: { orgId },
            json: {
              subjectType: 'project',
              subjectId: projectId,
              body,
              ...(health ? { health } : {}),
            },
          }),
        'Could not post your update.',
      ),
    onSuccess: (_created, { health }) => {
      // The newest health becomes the project's current health — reflect it locally.
      if (health) patchCachedProject((cur) => ({ ...cur, health }));
    },
    invalidateKeys: [updatesKey, detailKey],
  });

  /** Create a task on the project's team; the milestone bucket resolves on the detail refetch. */
  const createTaskM = useApiMutation({
    mutationFn: (title: string) => {
      if (!teamId)
        return Promise.reject(new Error('No team is available yet to create a task in.'));
      return unwrap(
        () =>
          api.v1.orgs[':orgId'].tasks.$post({
            param: { orgId },
            json: { title, teamId: TeamId.parse(teamId), projectId: ProjectId.parse(projectId) },
          }),
        'Could not create the task.',
      );
    },
    // A new task shifts the milestone buckets AND the weighted-progress roll-up; refetch the
    // composite detail (which recomputes both) and the org task list.
    invalidateKeys: [detailKey, queryKeys.tasks(orgId)],
  });

  const loading = detailQ.isPending;
  const error = detailQ.isError ? detailQ.error.message : null;

  const members = detail?.members ?? [];
  const roles = detail?.roles ?? [];
  const programs = detail?.programs ?? [];
  const initiatives = detail?.initiatives ?? [];
  const milestones = detail?.milestones ?? [];
  const milestoneTasks = useMemo(() => detail?.milestoneTasks ?? [], [detail]);
  const resolveActor = useMemo<ActorDirectory>(
    () => detail?.resolveActor ?? (() => ({ name: 'System', kind: 'human' as const })),
    [detail],
  );

  // One canonical task-count definition shared by the Tasks-tab badge AND the Overview breakdown:
  // every task that belongs to this project (subtasks included, matching the `…/progress`
  // denominator).
  const taskCount = milestoneTasks.length;

  const tabs: readonly TabItem[] = useMemo(
    () => [
      { id: 'overview', label: 'Overview' },
      { id: 'tasks', label: 'Tasks', count: taskCount },
      { id: 'updates', label: 'Updates', count: updates.length },
    ],
    [taskCount, updates.length],
  );

  // Editing a project property requires `contribute`; gate the panel's affordances on it.
  const canEdit = useOrgCapability(members, roles, 'contribute');
  const memberOptions = useMemo<readonly PickerOption[]>(
    () => memberActorOptions(members),
    [members],
  );
  const programOptions = useMemo<readonly PickerOption[]>(
    () => toProgramOptions(programs),
    [programs],
  );
  const initiativeOptions = useMemo<readonly PickerOption[]>(
    () => toInitiativeOptions(initiatives),
    [initiatives],
  );

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 @2xl:p-6 @4xl:p-8">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-4 w-full max-w-xl" />
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-1 gap-6 @4xl:grid-cols-[minmax(0,1fr)_18rem]">
          <Skeleton className="h-64 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto w-full max-w-6xl p-4 @2xl:p-6 @4xl:p-8">
        <p
          role="alert"
          className="border-outline-variant text-destructive rounded-xl border p-4 text-sm"
        >
          {error}
        </p>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="mx-auto w-full max-w-6xl p-4 @2xl:p-6 @4xl:p-8">
        <p className="border-outline-variant text-on-surface-variant rounded-xl border border-dashed p-8 text-center text-sm">
          This {projectLabel.toLowerCase()} could not be found.
        </p>
      </div>
    );
  }

  const health = project.health ?? null;
  const progress = detail?.progress ?? null;
  const agentsHere = detail?.agentsHere ?? [];
  const agentActivity = detail?.agentActivity ?? [];
  const currentInitiativeId = detail?.currentInitiativeId ?? null;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 @2xl:p-6 @4xl:p-8">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-on-surface text-xl font-semibold tracking-tight">{project.name}</h1>
          <Badge variant={statusBadgeVariant(project.status)}>
            {STATUS_LABEL[project.status] ?? project.status}
          </Badge>
          <HealthPill health={health} />
        </div>
        {project.description ? (
          <p className="text-on-surface-variant max-w-2xl text-sm leading-relaxed">
            {project.description}
          </p>
        ) : null}
      </header>

      <ProjectTabs
        tabs={tabs}
        value={tab}
        onValueChange={(id) => {
          setTab(id as TabId);
        }}
        label="Project sections"
      />

      {tab === 'overview' ? (
        <div
          role="tabpanel"
          id="tabpanel-overview"
          aria-labelledby="tab-overview"
          className="grid grid-cols-1 gap-6 @4xl:grid-cols-[minmax(0,1fr)_18rem]"
        >
          <div className="flex min-w-0 flex-col gap-6">
            <section
              aria-label="Progress"
              className="border-outline-variant bg-surface-container-low rounded-xl border p-4"
            >
              {progress ? (
                <WeightedProgress progress={progress} health={health} />
              ) : (
                <p className="text-on-surface-variant text-sm">Progress is unavailable.</p>
              )}
            </section>

            <OverviewSummary
              tasks={milestoneTasks}
              milestones={milestones.map((m) => ({ id: m.id, name: m.name }))}
              taskNounPlural={taskNounPlural}
            />

            <AgentsStrip agents={agentsHere} />

            <Discussion
              comments={comments}
              loading={commentsQ.isPending}
              error={commentsQ.isError ? commentsQ.error.message : null}
              resolveActor={resolveActor}
              agentActivity={agentActivity}
              posting={postCommentM.isPending}
              postError={postCommentM.error?.message ?? null}
              onPost={(body) => {
                postCommentM.mutate(body);
              }}
            />
          </div>

          <aside className="flex flex-col gap-4">
            <PropertiesPanel
              leadId={project.leadId ?? null}
              memberOptions={memberOptions}
              status={projectStatusOf(project.status)}
              health={health}
              startDate={project.startDate ?? null}
              targetDate={project.targetDate ?? null}
              programId={project.programId ?? null}
              programOptions={programOptions}
              initiativeId={currentInitiativeId}
              initiativeOptions={initiativeOptions}
              canEdit={canEdit}
              pending={propsPending}
              onLeadChange={(leadId) => {
                patchProject({ leadId });
              }}
              onStatusChange={(status) => {
                patchProject({ status });
              }}
              onHealthChange={(next) => {
                patchProject({ health: next });
              }}
              onTimelineChange={({ start, end }) => {
                patchProject({ startDate: start, targetDate: end });
              }}
              onProgramChange={(programId) => {
                patchProject({ programId });
              }}
              onInitiativeChange={(initiativeId) => {
                setInitiative.mutate(initiativeId);
              }}
            />
            {propsError ? (
              <p role="alert" className="text-destructive px-1 text-sm">
                {propsError}
              </p>
            ) : null}
          </aside>
        </div>
      ) : null}

      {tab === 'tasks' ? (
        <div role="tabpanel" id="tabpanel-tasks" aria-labelledby="tab-tasks">
          <MilestoneTasks
            orgId={orgId}
            tasks={milestoneTasks}
            milestones={milestones.map((m) => ({
              id: m.id,
              name: m.name,
              targetDate: m.targetDate,
            }))}
            resolveActor={resolveActor}
            taskNoun={taskNoun}
            onOpenTask={(taskId) => {
              router.push(`/orgs/${orgId}/tasks/${taskId}`);
            }}
            creating={createTaskM.isPending}
            createError={createTaskM.error?.message ?? null}
            onCreate={(title) => {
              createTaskM.mutate(title);
            }}
            teams={teams}
            teamId={teamId}
            onTeamChange={setTeamOverride}
            teamsLoading={teamsLoading}
          />
        </div>
      ) : null}

      {tab === 'updates' ? (
        <div role="tabpanel" id="tabpanel-updates" aria-labelledby="tab-updates">
          <UpdatesTab
            updates={updates}
            loading={updatesQ.isPending}
            error={updatesQ.isError ? updatesQ.error.message : null}
            resolveActor={resolveActor}
            posting={postUpdateM.isPending}
            postError={postUpdateM.error?.message ?? null}
            onPost={(body, postHealth) => {
              postUpdateM.mutate({ body, health: postHealth });
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
