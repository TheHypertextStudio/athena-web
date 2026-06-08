'use client';

import {
  ActorId,
  type AgentSessionOut,
  type CommentOut,
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
  type RoleOut,
  type SessionActivityOut,
  type TaskOut,
  TeamId,
  type UpdateOut,
} from '@docket/types';
import type { PickerOption } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { Badge, Skeleton } from '@docket/ui/primitives';
import { useParams, useRouter } from 'next/navigation';
import { type JSX, useCallback, useEffect, useMemo, useState } from 'react';

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
import { readError, readProblem } from '@/lib/problem';

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

/**
 * The project detail view — overview, milestone-grouped tasks, and updates.
 *
 * @remarks
 * A Client Component reached at `/orgs/[orgId]/projects/[projectId]`. It composes the
 * project's depth from the typed RPC surface:
 *
 * - **Overview** — leads with a weighted-progress bar (`…/projects/:id/progress`, which fills
 *   by estimate so bigger tasks count for more) and a health pill, an "agents here" strip
 *   (agent sessions whose task lives in this project), a properties panel
 *   (lead/timeline/program/initiative), and the comments + recent-agent-activity discussion.
 * - **Tasks** — the project's tasks grouped into milestone sections (`…/milestones`), then by
 *   workflow state; task milestones are resolved per-task since the list DTO omits them.
 * - **Updates** — the project's status updates (`…/updates?subject=project`) with a composer;
 *   posting a health verdict also updates the project's current health, so the overview
 *   refreshes.
 *
 * Entity nouns route through {@link useVocabulary}; data is fetched at runtime so the
 * production build needs no running server.
 */
export default function ProjectDetailPage(): JSX.Element {
  const router = useRouter();
  const params = useParams<{ orgId: string; projectId: string }>();
  const { orgId, projectId } = params;
  const { teams, defaultTeamId, teamsLoading } = useActiveOrg();
  const projectLabel = useVocabulary('project');
  const taskNoun = useVocabulary('task').toLowerCase();
  const taskNounPlural = useVocabulary('task', { plural: true }).toLowerCase();

  const [project, setProject] = useState<ProjectOut | null>(null);
  const [progress, setProgress] = useState<ProjectProgress | null>(null);
  const [milestones, setMilestones] = useState<readonly MilestoneOut[]>([]);
  const [milestoneTasks, setMilestoneTasks] = useState<readonly MilestoneTask[]>([]);
  const [agentsHere, setAgentsHere] = useState<readonly AgentHere[]>([]);
  const [agentActivity, setAgentActivity] = useState<readonly AgentActivityEntry[]>([]);
  const [resolveActor, setResolveActor] = useState<ActorDirectory>(() => () => ({
    name: 'System',
    kind: 'human' as const,
  }));
  const [members, setMembers] = useState<readonly MemberOut[]>([]);
  const [roles, setRoles] = useState<readonly RoleOut[]>([]);
  const [programs, setPrograms] = useState<readonly ProgramOut[]>([]);
  const [initiatives, setInitiatives] = useState<readonly InitiativeOut[]>([]);
  // Which initiative this project is associated with (resolved from initiative timelines, since
  // the association is an m2m edge rather than a column on the project).
  const [currentInitiativeId, setCurrentInitiativeId] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Properties-panel mutation state (optimistic PATCH + association link/unlink).
  const [propsPending, setPropsPending] = useState(false);
  const [propsError, setPropsError] = useState<string | null>(null);

  const [tab, setTab] = useState<TabId>('overview');

  // Comments
  const [comments, setComments] = useState<readonly CommentOut[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [commentsError, setCommentsError] = useState<string | null>(null);
  const [postingComment, setPostingComment] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);

  // Updates
  const [updates, setUpdates] = useState<readonly UpdateOut[]>([]);
  const [updatesLoading, setUpdatesLoading] = useState(true);
  const [updatesError, setUpdatesError] = useState<string | null>(null);
  const [postingUpdate, setPostingUpdate] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  // Task creation
  const [creatingTask, setCreatingTask] = useState(false);
  const [createTaskError, setCreateTaskError] = useState<string | null>(null);
  // The team new tasks land in: a user override (via the picker) or the org's default team.
  const [teamOverride, setTeamOverride] = useState<string | null>(null);
  const teamId = teamOverride ?? defaultTeamId;

  /** Resolve which initiative id (if any) this project is associated with, via timelines. */
  const resolveInitiativeId = useCallback(
    async (candidates: readonly InitiativeOut[]): Promise<string | null> => {
      const matches = await Promise.all(
        candidates.map(async (init): Promise<string | null> => {
          const res = await api.v1.orgs[':orgId'].initiatives[':id'].timeline.$get({
            param: { orgId, id: init.id },
            query: {},
          });
          if (!res.ok) return null;
          const { projects } = await res.json();
          return projects.some((p) => p.id === projectId) ? init.id : null;
        }),
      );
      return matches.find((id) => id !== null) ?? null;
    },
    [orgId, projectId],
  );

  /** Load the project, its progress, milestones, tasks, related entities, and agents. */
  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
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
        setError(await readProblem(projectsRes, 'Could not load this project.'));
        return;
      }
      const { items: projectItems } = await projectsRes.json();
      const found = projectItems.find((p) => p.id === projectId) ?? null;
      setProject(found);
      if (!found) return;

      if (progressRes.ok) setProgress(await progressRes.json());

      // Member + agent directory (shared by lead, authors, agent rows).
      const memberItems = membersRes.ok ? (await membersRes.json()).items : [];
      const agents = agentsRes.ok ? (await agentsRes.json()).items : [];
      // The agent's display name lives on its Actor, which the RPC surface does not expose a
      // name for; fall back to a short, stable label keyed off the agent's actor id.
      const agentActorByAgentId = new Map(agents.map((a) => [a.id, a.actorId]));
      const directory = buildActorDirectory({
        members: memberItems.map((m) => ({ actorId: m.actorId, displayName: m.displayName })),
        agents: agents.map((a) => ({
          actorId: a.actorId,
          name: `Agent ${a.actorId.slice(0, 6)}`,
        })),
      });
      setResolveActor(() => directory);
      setMembers(memberItems);
      if (rolesRes.ok) setRoles((await rolesRes.json()).items);

      // Program + initiative option sources for the (now-interactive) properties panel.
      const programItems: readonly ProgramOut[] = programsRes.ok
        ? (await programsRes.json()).items
        : [];
      setPrograms(programItems);
      const initiativeItems: readonly InitiativeOut[] = initiativesRes.ok
        ? (await initiativesRes.json()).items
        : [];
      setInitiatives(initiativeItems);
      setCurrentInitiativeId(
        initiativeItems.length > 0 ? await resolveInitiativeId(initiativeItems) : null,
      );

      // Milestones for this project (ordered by sort from the API).
      const milestoneItems = milestonesRes.ok ? (await milestonesRes.json()).items : [];
      setMilestones(milestoneItems);

      // This project's tasks, then resolve each task's milestone (the list DTO omits it).
      const allTasks: readonly TaskOut[] = tasksRes.ok ? (await tasksRes.json()).items : [];
      const projectTasks = allTasks.filter((t) => t.projectId === projectId);

      const enriched = await Promise.all(
        projectTasks.map(async (t): Promise<MilestoneTask> => {
          const detailRes = await api.v1.orgs[':orgId'].tasks[':id'].$get({
            param: { orgId, id: t.id },
          });
          if (!detailRes.ok) return { task: t, milestoneId: null };
          const detail = await detailRes.json();
          return { task: t, milestoneId: detail.milestoneId ?? null };
        }),
      );
      setMilestoneTasks(enriched);

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
      setAgentsHere(
        here.map((s) => ({
          sessionId: s.id,
          agentName: directory(agentActorByAgentId.get(s.agentId) ?? null).name,
          taskTitle: s.taskId ? (projectTaskTitle.get(s.taskId) ?? 'a task') : 'a task',
          status: s.status,
        })),
      );

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
      const flatActivity = activityLists
        .flat()
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 8);
      setAgentActivity(flatActivity);
    } catch (caught) {
      setError(readError(caught, 'Something went wrong loading this project.'));
    } finally {
      setLoading(false);
    }
  }, [orgId, projectId, resolveInitiativeId]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Optimistically patch the project: apply the change locally, fire the PATCH, and roll back
   * to the prior snapshot on failure (surfacing the problem). Disables the panel while pending.
   */
  const patchProject = useCallback(
    async (patch: {
      leadId?: string | null;
      status?: ProjectStatus;
      health?: Health | null;
      startDate?: string | null;
      targetDate?: string | null;
      programId?: string | null;
    }): Promise<void> => {
      if (!project) return;
      const previous = project;
      // One branded patch body, reused for the optimistic snapshot AND the request, so the wire
      // shape and the local mirror never drift.
      const body = {
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
      setProject({ ...project, ...body });
      setPropsPending(true);
      setPropsError(null);
      try {
        const res = await api.v1.orgs[':orgId'].projects[':id'].$patch({
          param: { orgId, id: projectId },
          json: body,
        });
        if (!res.ok) {
          setProject(previous);
          setPropsError(await readProblem(res, 'Could not update the project.'));
          return;
        }
        setProject(await res.json());
      } catch (caught) {
        setProject(previous);
        setPropsError(readError(caught, 'Something went wrong updating the project.'));
      } finally {
        setPropsPending(false);
      }
    },
    [project, orgId, projectId],
  );

  /**
   * Change the project's associated initiative: unlink the old association, then link the new
   * one (the association is an m2m edge, not a project column). Optimistic with rollback.
   */
  const setProjectInitiative = useCallback(
    async (nextInitiativeId: string | null): Promise<void> => {
      const previous = currentInitiativeId;
      if (previous === nextInitiativeId) return;
      setCurrentInitiativeId(nextInitiativeId);
      setPropsPending(true);
      setPropsError(null);
      try {
        if (previous) {
          const unlinkRes = await api.v1.orgs[':orgId'].initiatives[':id'].projects[
            ':projectId'
          ].$delete({ param: { orgId, id: previous, projectId } });
          if (!unlinkRes.ok) {
            setCurrentInitiativeId(previous);
            setPropsError(await readProblem(unlinkRes, 'Could not update the association.'));
            return;
          }
        }
        if (nextInitiativeId) {
          const linkRes = await api.v1.orgs[':orgId'].initiatives[':id'].projects.$post({
            param: { orgId, id: nextInitiativeId },
            json: { projectId: ProjectId.parse(projectId) },
          });
          if (!linkRes.ok) {
            setCurrentInitiativeId(previous);
            setPropsError(await readProblem(linkRes, 'Could not update the association.'));
            return;
          }
        }
      } catch (caught) {
        setCurrentInitiativeId(previous);
        setPropsError(readError(caught, 'Something went wrong updating the association.'));
      } finally {
        setPropsPending(false);
      }
    },
    [currentInitiativeId, orgId, projectId],
  );

  /** Re-fetch only the weighted-progress roll-up (after a task mutation). */
  const refreshProgress = useCallback(async (): Promise<void> => {
    const res = await api.v1.orgs[':orgId'].projects[':id'].progress.$get({
      param: { orgId, id: projectId },
    });
    if (res.ok) setProgress(await res.json());
  }, [orgId, projectId]);

  /** Load the project's comments (subjectType=project). */
  const loadComments = useCallback(async (): Promise<void> => {
    setCommentsLoading(true);
    setCommentsError(null);
    try {
      const res = await api.v1.orgs[':orgId'].comments.$get({
        param: { orgId },
        query: { subjectType: 'project', subjectId: projectId },
      });
      if (!res.ok) {
        setCommentsError(await readProblem(res, 'Could not load comments.'));
        return;
      }
      setComments((await res.json()).items);
    } catch (caught) {
      setCommentsError(readError(caught, 'Something went wrong loading comments.'));
    } finally {
      setCommentsLoading(false);
    }
  }, [orgId, projectId]);

  /** Load the project's status updates (subjectType=project). */
  const loadUpdates = useCallback(async (): Promise<void> => {
    setUpdatesLoading(true);
    setUpdatesError(null);
    try {
      const res = await api.v1.orgs[':orgId'].updates.$get({
        param: { orgId },
        query: { subjectType: 'project', subjectId: projectId },
      });
      if (!res.ok) {
        setUpdatesError(await readProblem(res, 'Could not load updates.'));
        return;
      }
      setUpdates((await res.json()).items);
    } catch (caught) {
      setUpdatesError(readError(caught, 'Something went wrong loading updates.'));
    } finally {
      setUpdatesLoading(false);
    }
  }, [orgId, projectId]);

  useEffect(() => {
    void loadComments();
    void loadUpdates();
  }, [loadComments, loadUpdates]);

  /** Post a new root comment, then prepend it (after a reload to keep order canonical). */
  const postComment = useCallback(
    async (body: string): Promise<void> => {
      setPostingComment(true);
      setCommentError(null);
      try {
        const res = await api.v1.orgs[':orgId'].comments.$post({
          param: { orgId },
          json: { subjectType: 'project', subjectId: projectId, body },
        });
        if (!res.ok) {
          setCommentError(await readProblem(res, 'Could not post your comment.'));
          return;
        }
        const created = await res.json();
        setComments((current) => [...current, created]);
      } catch (caught) {
        setCommentError(readError(caught, 'Something went wrong posting your comment.'));
      } finally {
        setPostingComment(false);
      }
    },
    [orgId, projectId],
  );

  /** Post a status update; a health verdict also moves the project's current health. */
  const postUpdate = useCallback(
    async (body: string, health: Health | undefined): Promise<void> => {
      setPostingUpdate(true);
      setUpdateError(null);
      try {
        const res = await api.v1.orgs[':orgId'].updates.$post({
          param: { orgId },
          json: {
            subjectType: 'project',
            subjectId: projectId,
            body,
            ...(health ? { health } : {}),
          },
        });
        if (!res.ok) {
          setUpdateError(await readProblem(res, 'Could not post your update.'));
          return;
        }
        const created = await res.json();
        setUpdates((current) => [created, ...current]);
        // The newest health becomes the project's current health — reflect it locally.
        if (health) setProject((current) => (current ? { ...current, health } : current));
      } catch (caught) {
        setUpdateError(readError(caught, 'Something went wrong posting your update.'));
      } finally {
        setPostingUpdate(false);
      }
    },
    [orgId, projectId],
  );

  /** Create a task on the project's team; reload so its milestone bucket resolves. */
  const createTask = useCallback(
    async (title: string): Promise<void> => {
      if (!teamId) {
        setCreateTaskError('No team is available yet to create a task in.');
        return;
      }
      setCreatingTask(true);
      setCreateTaskError(null);
      try {
        const res = await api.v1.orgs[':orgId'].tasks.$post({
          param: { orgId },
          json: { title, teamId: TeamId.parse(teamId), projectId: ProjectId.parse(projectId) },
        });
        if (!res.ok) {
          setCreateTaskError(await readProblem(res, 'Could not create the task.'));
          return;
        }
        const created = await res.json();
        setMilestoneTasks((current) => [...current, { task: created, milestoneId: null }]);
        // The weighted roll-up shifts with a new task; re-fetch the authoritative value.
        void refreshProgress();
      } catch (caught) {
        setCreateTaskError(readError(caught, 'Something went wrong creating the task.'));
      } finally {
        setCreatingTask(false);
      }
    },
    [orgId, projectId, teamId, refreshProgress],
  );

  // One canonical task-count definition shared by the Tasks-tab badge AND the Overview
  // breakdown: every task that belongs to this project (subtasks included, matching the
  // `…/progress` denominator). Previously the badge showed only the open count while the
  // progress card showed the total, so the same project read with two different totals.
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
              loading={commentsLoading}
              error={commentsError}
              resolveActor={resolveActor}
              agentActivity={agentActivity}
              posting={postingComment}
              postError={commentError}
              onPost={(body) => {
                void postComment(body);
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
                void patchProject({ leadId });
              }}
              onStatusChange={(status) => {
                void patchProject({ status });
              }}
              onHealthChange={(next) => {
                void patchProject({ health: next });
              }}
              onTimelineChange={({ start, end }) => {
                void patchProject({ startDate: start, targetDate: end });
              }}
              onProgramChange={(programId) => {
                void patchProject({ programId });
              }}
              onInitiativeChange={(initiativeId) => {
                void setProjectInitiative(initiativeId);
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
            creating={creatingTask}
            createError={createTaskError}
            onCreate={(title) => {
              void createTask(title);
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
            loading={updatesLoading}
            error={updatesError}
            resolveActor={resolveActor}
            posting={postingUpdate}
            postError={updateError}
            onPost={(body, postHealth) => {
              void postUpdate(body, postHealth);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
