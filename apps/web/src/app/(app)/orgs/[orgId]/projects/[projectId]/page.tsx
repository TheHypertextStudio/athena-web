'use client';

import type { PickerOption } from '@docket/types';
import { useVocabulary } from '@docket/ui/hooks';
import { Badge, Skeleton } from '@docket/ui/primitives';
import { useParams, useRouter } from 'next/navigation';
import { type JSX, useMemo, useState } from 'react';

import type { ActorDirectory } from '@/components/project-detail/actor-directory';
import { AgentsStrip } from '@/components/project-detail/agents-strip';
import { Discussion } from '@/components/project-detail/discussion';
import { MilestoneTasks } from '@/components/project-detail/milestone-tasks';
import { OverviewSummary } from '@/components/project-detail/overview-summary';
import { HealthPill, WeightedProgress } from '@/components/project-detail/progress-bar';
import { PropertiesPanel } from '@/components/project-detail/properties-panel';
import {
  statusBadgeVariant,
  STATUS_LABEL,
  projectStatusOf,
} from '@/components/project-detail/project-config';
import { type TabItem, ProjectTabs } from '@/components/project-detail/tabs';
import { UpdatesTab } from '@/components/project-detail/updates-tab';
import { useActiveOrg } from '@/components/active-org';
import {
  initiativeOptions as toInitiativeOptions,
  memberActorOptions,
  programOptions as toProgramOptions,
} from '@/components/property-pickers/options';
import { api } from '@/lib/api';
import { fetchProjectDetail } from '@/lib/fetch-project-detail';
import { queryKeys, useApiQuery } from '@/lib/query';
import { useProjectMutations } from '@/lib/use-project-mutations';
import { useOrgCapability } from '@/lib/use-org-capability';

type TabId = 'overview' | 'tasks' | 'updates';

/**
 * The project detail view — overview, milestone-grouped tasks, and updates.
 *
 * @remarks
 * Data fetching is split across a composite fetcher ({@link fetchProjectDetail}) and two
 * subject-scoped queries (comments, updates). Writes are encapsulated in
 * {@link useProjectMutations}. The page assembles picker options, composes the tab layout,
 * and delegates content to existing sub-components.
 */
export default function ProjectDetailPage(): JSX.Element {
  const router = useRouter();
  const params = useParams<{ orgId: string; projectId: string }>();
  const { orgId, projectId } = params;
  const { teams, defaultTeamId, teamsLoading } = useActiveOrg();

  const projectLabel = useVocabulary('project');
  const taskNoun = useVocabulary('task').toLowerCase();
  const taskNounPlural = useVocabulary('task', { plural: true }).toLowerCase();

  const detailKey = queryKeys.project(orgId, projectId);
  const commentsKey = useMemo(() => [...detailKey, 'comments'] as const, [detailKey]);
  const updatesKey = useMemo(() => [...detailKey, 'updates'] as const, [detailKey]);

  const [tab, setTab] = useState<TabId>('overview');
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

  const {
    patchProject,
    setInitiative,
    postComment,
    postUpdate,
    createTask,
    propsPending,
    propsError,
    commentPosting,
    commentError,
    updatePosting,
    updateError,
    createTaskPending,
    createTaskError,
  } = useProjectMutations(orgId, projectId, teamId);

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

  const taskCount = milestoneTasks.length;
  const tabs: readonly TabItem[] = useMemo(
    () => [
      { id: 'overview', label: 'Overview' },
      { id: 'tasks', label: 'Tasks', count: taskCount },
      { id: 'updates', label: 'Updates', count: updates.length },
    ],
    [taskCount, updates.length],
  );

  if (detailQ.isPending) {
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

  if (detailQ.isError) {
    return (
      <div className="mx-auto w-full max-w-6xl p-4 @2xl:p-6 @4xl:p-8">
        <p
          role="alert"
          className="border-outline-variant text-destructive text-body rounded-xl border p-4"
        >
          {detailQ.error.message}
        </p>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="mx-auto w-full max-w-6xl p-4 @2xl:p-6 @4xl:p-8">
        <p className="border-outline-variant text-on-surface-variant text-body rounded-xl border border-dashed p-8 text-center">
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
          <h1 className="text-on-surface text-h1">{project.name}</h1>
          <Badge variant={statusBadgeVariant(project.status)}>
            {STATUS_LABEL[project.status] ?? project.status}
          </Badge>
          <HealthPill health={health} />
        </div>
        {project.description ? (
          <p className="text-on-surface-variant text-body max-w-2xl leading-relaxed">
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
                <p className="text-on-surface-variant text-body">Progress is unavailable.</p>
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
              posting={commentPosting}
              postError={commentError}
              onPost={(body) => {
                postComment(body);
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
                setInitiative(initiativeId);
              }}
            />
            {propsError ? (
              <p role="alert" className="text-destructive text-body px-1">
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
            creating={createTaskPending}
            createError={createTaskError}
            onCreate={(title) => {
              createTask(title);
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
            posting={updatePosting}
            postError={updateError}
            onPost={(body, postHealth) => {
              postUpdate(body, postHealth);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
