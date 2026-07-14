'use client';

import type {
  AttachmentOut,
  EntityDisplayColorKey,
  EntityDisplayIconKey,
  EntityDisplayOut,
} from '@docket/types';
import { ActorAvatar } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { Calendar, Target, TuneRounded } from '@docket/ui/icons';
import { Popover, PopoverContent, PopoverTrigger, Skeleton } from '@docket/ui/primitives';
import { useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { type JSX, useMemo, useState } from 'react';

import TaskGraphPanel from '@/components/canvas/task-graph-panel';
import { EditableFreeformText, FreeformText } from '@/components/editor/freeform-text';
import { InitiativeDocument } from '@/components/initiatives/initiative-document';
import { InitiativeIconPicker } from '@/components/initiatives/initiative-icon-picker';
import { AgentActivityFeed } from '@/components/project-detail/agent-activity-feed';
import { AgentsStrip } from '@/components/project-detail/agents-strip';
import { MilestoneTasks } from '@/components/project-detail/milestone-tasks';
import { ProjectDependenciesPanel } from '@/components/project-detail/project-dependencies';
import { PropertiesPanel } from '@/components/project-detail/properties-panel';
import { WeightedProgress } from '@/components/project-detail/progress-bar';
import { ProjectResourcesTab } from '@/components/project-detail/resources-tab';
import { projectStatusOf } from '@/components/project-detail/project-config';
import { type TabItem, ProjectTabs } from '@/components/project-detail/tabs';
import { UpdatesTab } from '@/components/project-detail/updates-tab';
import { useActiveOrg } from '@/components/active-org';
import { CreateTaskDialog } from '@/components/tasks/create-task';
import { api } from '@/lib/api';
import { formatCalendarDate } from '@/lib/format-date';
import { queryKeys, unwrap, useApiMutation } from '@/lib/query';
import { useProjectDetailPage } from '@/lib/use-project-detail-page';
import { userErrorMessage } from '@/lib/problem';

type TabId = 'overview' | 'tasks' | 'updates' | 'resources';

const HEALTH_LABEL = {
  on_track: 'On track',
  at_risk: 'At risk',
  off_track: 'Off track',
} as const;
const HEALTH_CLASS = {
  on_track: 'text-state-completed',
  at_risk: 'text-state-canceled',
  off_track: 'text-destructive',
} as const;

/** Operational Project detail with progressive properties and dedicated working tabs. */
export default function ProjectDetailPage(): JSX.Element {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { orgId, projectId } = useParams<{ orgId: string; projectId: string }>();
  const { teams, defaultTeamId, teamsLoading } = useActiveOrg();
  const projectNoun = useVocabulary('project');
  const taskNoun = useVocabulary('task').toLowerCase();
  const [tab, setTab] = useState<TabId>('overview');
  const [taskComposerOpen, setTaskComposerOpen] = useState(false);
  const [propertiesOpen, setPropertiesOpen] = useState(false);

  const {
    detailKey,
    detailQ,
    updatesQ,
    resourcesQ,
    detail,
    project,
    updates,
    resources,
    milestones,
    milestoneTasks,
    resolveActor,
    canEdit,
    programOptions,
    initiativeOptions,
    progress,
    agentsHere,
    agentActivity,
    initiativeIds,
    labels,
    availableLabels,
    patchProject,
    setInitiatives,
    postUpdate,
    propsPending,
    propsError,
    updatePosting,
    updateError,
  } = useProjectDetailPage(orgId, projectId);

  const resourceKey = [...detailKey, 'resources'] as const;
  const displayMutation = useApiMutation<
    EntityDisplayOut,
    { iconKey: EntityDisplayIconKey; colorKey: EntityDisplayColorKey },
    { previous?: typeof detail }
  >({
    mutationFn: (json) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].display[':subjectType'][':subjectId'].$put({
            param: { orgId, subjectType: 'project', subjectId: projectId },
            json,
          }),
        'Could not customize this project.',
      ),
    onMutate: async ({ iconKey, colorKey }) => {
      await queryClient.cancelQueries({ queryKey: detailKey });
      const previous = queryClient.getQueryData<typeof detail>(detailKey);
      queryClient.setQueryData(detailKey, (current: typeof detail) =>
        current
          ? {
              ...current,
              display: {
                subjectType: 'project',
                subjectId: projectId,
                iconKey,
                colorKey,
                customized: true,
              },
            }
          : current,
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(detailKey, context.previous);
    },
    invalidateKeys: [detailKey, [...queryKeys.projects(orgId), 'overview']],
  });
  const addResource = useApiMutation<AttachmentOut, { title: string; url: string }>({
    mutationFn: (json) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].projects[':id'].resources.$post({
            param: { orgId, id: projectId },
            json,
          }),
        'Could not add the resource.',
      ),
    invalidateKeys: [resourceKey],
  });
  const removeResource = useApiMutation<{ id: string; removed: true }, string>({
    mutationFn: (resourceId) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].projects[':id'].resources[':resourceId'].$delete({
            param: { orgId, id: projectId, resourceId },
          }),
        'Could not remove the resource.',
      ),
    invalidateKeys: [resourceKey],
  });

  const participantIds = useMemo(() => {
    if (!project) return [];
    const ids = new Set<string>();
    if (project.leadId) ids.add(project.leadId);
    for (const { task } of milestoneTasks) {
      if (task.assigneeId) ids.add(task.assigneeId);
      if (task.delegateId) ids.add(task.delegateId);
    }
    return [...ids];
  }, [milestoneTasks, project]);
  const participants = useMemo(
    () => participantIds.map((actorId) => ({ actorId, ...resolveActor(actorId) })),
    [participantIds, resolveActor],
  );
  const latestUpdate = updates[0];
  const tabs: readonly TabItem[] = useMemo(
    () => [
      { id: 'overview', label: 'Overview' },
      { id: 'tasks', label: 'Tasks', count: milestoneTasks.length },
      { id: 'updates', label: 'Updates', count: updates.length },
      { id: 'resources', label: 'Resources', count: resources.length },
    ],
    [milestoneTasks.length, resources.length, updates.length],
  );

  if (detailQ.isPending) {
    return (
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-5 p-4 @2xl:p-6 @4xl:p-8">
        <Skeleton className="h-5 w-72" />
        <Skeleton className="h-14 w-3/4" />
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </main>
    );
  }
  if (detailQ.isError || !project) {
    return (
      <p role="alert" className="text-destructive mx-auto max-w-7xl p-6">
        {detailQ.isError
          ? userErrorMessage(detailQ.error, 'Could not load this project.')
          : `${projectNoun} not found.`}
      </p>
    );
  }

  const health = project.health ?? null;

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-5 p-4 @2xl:p-6 @4xl:p-8">
      <header className="flex flex-col gap-4">
        <div className="flex flex-col items-start gap-2">
          <InitiativeIconPicker
            display={
              detail?.display ?? {
                subjectType: 'project',
                subjectId: projectId,
                iconKey: 'folder',
                colorKey: 'neutral',
                customized: false,
              }
            }
            initiativeName={project.name}
            editable={canEdit}
            pending={displayMutation.isPending}
            onChange={(iconKey, colorKey) => {
              displayMutation.mutate({ iconKey, colorKey });
            }}
          />
          <h1 className="text-headline-large text-on-surface max-w-[32ch] font-medium">
            {project.name}
          </h1>
        </div>

        <EditableFreeformText
          value={project.summary}
          placeholder="Add a concise outcome summary…"
          canEdit={canEdit}
          saving={propsPending}
          onSave={(summary) => {
            patchProject({ summary });
          }}
          className="text-on-surface-variant text-body-large max-w-4xl font-normal"
        />

        <Popover open={propertiesOpen} onOpenChange={setPropertiesOpen}>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {participants.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5" aria-label="Project people">
                {participants.map((participant) => (
                  <span key={participant.actorId} className="flex h-8 items-center gap-1.5 pr-2">
                    <ActorAvatar kind={participant.kind} name={participant.name} size={24} />
                    <span className="text-on-surface text-label-medium">{participant.name}</span>
                  </span>
                ))}
              </div>
            ) : null}
            {health ? (
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="Edit project health"
                  className={`${HEALTH_CLASS[health]} bg-surface-container-low hover:bg-surface-container-high focus-visible:ring-ring text-label-large flex min-h-10 items-center gap-1.5 rounded-full px-3 transition-colors focus-visible:ring-2 focus-visible:outline-none`}
                >
                  <Target aria-hidden className="size-4" /> {HEALTH_LABEL[health]}
                </button>
              </PopoverTrigger>
            ) : project.targetDate ? (
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="Edit project target date"
                  className="text-on-surface-variant bg-surface-container-low hover:bg-surface-container-high focus-visible:ring-ring text-label-large flex min-h-10 items-center gap-1.5 rounded-full px-3 tabular-nums transition-colors focus-visible:ring-2 focus-visible:outline-none"
                >
                  <Calendar aria-hidden className="size-4" />{' '}
                  {formatCalendarDate(project.targetDate)}
                </button>
              </PopoverTrigger>
            ) : (
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="text-on-surface-variant hover:bg-surface-container-low focus-visible:ring-ring text-label-large flex min-h-10 items-center gap-1.5 rounded-full px-3 transition-colors focus-visible:ring-2 focus-visible:outline-none"
                >
                  <TuneRounded aria-hidden className="size-4" /> Add health or target
                </button>
              </PopoverTrigger>
            )}
            {health && project.targetDate ? (
              <button
                type="button"
                aria-label="Edit project target date"
                onClick={() => {
                  setPropertiesOpen(true);
                }}
                className="text-on-surface-variant bg-surface-container-low hover:bg-surface-container-high focus-visible:ring-ring text-label-large flex min-h-10 items-center gap-1.5 rounded-full px-3 tabular-nums transition-colors focus-visible:ring-2 focus-visible:outline-none"
              >
                <Calendar aria-hidden className="size-4" /> {formatCalendarDate(project.targetDate)}
              </button>
            ) : null}
          </div>
          <PopoverContent align="start" className="w-[min(21rem,calc(100vw-2rem))] p-4">
            <h2 className="text-on-surface text-title-medium mb-2">Properties</h2>
            <PropertiesPanel
              health={health}
              status={projectStatusOf(project.status)}
              startDate={project.startDate ?? null}
              targetDate={project.targetDate ?? null}
              programId={project.programId ?? null}
              programOptions={programOptions}
              initiativeIds={initiativeIds}
              initiativeOptions={initiativeOptions}
              labels={labels}
              availableLabels={availableLabels}
              canEdit={canEdit}
              pending={propsPending}
              onHealthChange={(next) => {
                patchProject({ health: next });
              }}
              onStatusChange={(status) => {
                patchProject({ status });
              }}
              onTimelineChange={({ start, end }) => {
                patchProject({ startDate: start, targetDate: end });
              }}
              onProgramChange={(programId) => {
                patchProject({ programId });
              }}
              onInitiativesChange={setInitiatives}
              onLabelsChange={(labelIds) => {
                patchProject({ labelIds });
              }}
            />
            {propsError ? (
              <p role="alert" className="text-destructive mt-2 text-sm">
                {propsError}
              </p>
            ) : null}
          </PopoverContent>
        </Popover>
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
          className="flex flex-col gap-8"
        >
          {latestUpdate ? (
            <section className="bg-surface-container-low rounded-xl p-4" aria-label="Latest update">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h2 className="text-on-surface-variant text-xs font-medium">Latest update</h2>
                <span className="text-on-surface-variant text-xs">
                  {new Date(latestUpdate.createdAt).toLocaleDateString()}
                </span>
              </div>
              <FreeformText
                value={latestUpdate.body}
                emptyText=""
                className="text-on-surface text-sm leading-relaxed"
              />
            </section>
          ) : null}

          <section aria-label="Project document">
            <InitiativeDocument
              value={project.description}
              canEdit={canEdit}
              saving={propsPending}
              onSave={(description) => {
                patchProject({ description });
              }}
              placeholder="Add the Project brief…"
            />
          </section>

          <div className="grid gap-6 @4xl:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="flex min-w-0 flex-col gap-6">
              {progress ? (
                <section className="bg-surface-container-low rounded-xl p-4" aria-label="Progress">
                  <WeightedProgress progress={progress} />
                </section>
              ) : null}
              <AgentsStrip agents={agentsHere} />
              <AgentActivityFeed activities={agentActivity} />
            </div>
            <ProjectDependenciesPanel
              orgId={orgId}
              projectId={projectId}
              projectDetailKey={detailKey}
              canEdit={canEdit}
            />
          </div>
        </div>
      ) : null}

      {tab === 'tasks' ? (
        <div
          role="tabpanel"
          id="tabpanel-tasks"
          aria-labelledby="tab-tasks"
          className="flex flex-col gap-6"
        >
          <section className="flex flex-col gap-2">
            <h2 className="text-on-surface text-title-small font-medium">Task dependencies</h2>
            <div className="bg-surface-container-low h-96 overflow-hidden rounded-xl">
              <TaskGraphPanel
                scope={{ orgId, projectId }}
                density="compact"
                onExpand={() => {
                  router.push(`/orgs/${orgId}/graph?projectId=${projectId}`);
                }}
              />
            </div>
          </section>
          <MilestoneTasks
            orgId={orgId}
            tasks={milestoneTasks}
            milestones={milestones.map((milestone) => ({
              id: milestone.id,
              name: milestone.name,
              targetDate: milestone.targetDate,
            }))}
            resolveActor={resolveActor}
            taskNoun={taskNoun}
            onOpenTask={(taskId) => {
              router.push(`/orgs/${orgId}/tasks/${taskId}`);
            }}
            onCreate={() => {
              setTaskComposerOpen(true);
            }}
          />
        </div>
      ) : null}

      {tab === 'updates' ? (
        <div role="tabpanel" id="tabpanel-updates" aria-labelledby="tab-updates">
          <UpdatesTab
            updates={updates}
            loading={updatesQ.isPending}
            error={
              updatesQ.isError ? userErrorMessage(updatesQ.error, 'Could not load updates.') : null
            }
            resolveActor={resolveActor}
            posting={updatePosting}
            postError={updateError}
            onPost={postUpdate}
          />
        </div>
      ) : null}

      {tab === 'resources' ? (
        <div role="tabpanel" id="tabpanel-resources" aria-labelledby="tab-resources">
          <ProjectResourcesTab
            resources={resources}
            canEdit={canEdit}
            pending={addResource.isPending || removeResource.isPending}
            error={
              resourcesQ.isError
                ? userErrorMessage(resourcesQ.error, 'Could not load resources.')
                : addResource.error
                  ? userErrorMessage(addResource.error, 'Could not add the resource.')
                  : removeResource.error
                    ? userErrorMessage(removeResource.error, 'Could not remove the resource.')
                    : null
            }
            onAdd={addResource.mutate}
            onRemove={removeResource.mutate}
          />
        </div>
      ) : null}

      <CreateTaskDialog
        orgId={orgId}
        teams={teams}
        defaultTeamId={defaultTeamId}
        teamsLoading={teamsLoading}
        open={taskComposerOpen}
        onOpenChange={setTaskComposerOpen}
        defaultProjectId={projectId}
        onCreated={() => {
          void detailQ.refetch();
        }}
      />
      {displayMutation.error ? (
        <p role="alert" className="text-destructive text-sm">
          {userErrorMessage(displayMutation.error, 'Could not customize this project.')}
        </p>
      ) : null}
    </main>
  );
}
