'use client';

import type {
  AttachmentOut,
  EntityDisplayColorKey,
  EntityDisplayIconKey,
  EntityDisplayOut,
  ProjectOut,
  TaskOut,
} from '@docket/types';
import { ProjectId, TeamId } from '@docket/types';
import { ActorAvatar } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { Ellipsis, Trash2 } from '@docket/ui/icons';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Skeleton,
  Tabs,
  type TabsItem,
} from '@docket/ui/primitives';
import { useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { type JSX, useMemo, useState } from 'react';

import TaskGraphPanel from '@/components/canvas/task-graph-panel';
import { ConfirmDeleteDialog } from '@/components/confirm-delete-dialog';
import { EditableFreeformText, FreeformText } from '@/components/editor/freeform-text';
import { EditableTitle } from '@/components/editor/editable-title';
import { EntityDocument } from '@/components/editor/entity-document';
import { InitiativeIconPicker } from '@/components/initiatives/initiative-icon-picker';
import { AgentActivityFeed } from '@/components/project-detail/agent-activity-feed';
import { AgentsStrip } from '@/components/project-detail/agents-strip';
import { MilestoneTasks } from '@/components/project-detail/milestone-tasks';
import { ProjectDependenciesPanel } from '@/components/project-detail/project-dependencies';
import { PropertiesPanel } from '@/components/project-detail/properties-panel';
import { WeightedProgress } from '@/components/project-detail/progress-bar';
import { ResourcesTab } from '@/components/entity-detail/resources-tab';
import { UpdatesPanel } from '@/components/entity-detail/updates-panel';
import { projectStatusOf } from '@/components/project-detail/project-config';
import { EntityDetailLayout, EntityMetadataRow } from '@/components/views/entity-detail-layout';
import { useActiveOrg } from '@/components/active-org';
import { CreateTaskDialog } from '@/components/tasks/create-task';
import { api } from '@/lib/api';
import { queryKeys, unwrap, useApiMutation } from '@/lib/query';
import { useOrgCapability } from '@/lib/use-org-capability';
import { useProjectDetailPage } from '@/lib/use-project-detail-page';
import { useRenameTask } from '@/lib/use-rename-task';
import { userErrorMessage } from '@/lib/problem';

type TabId = 'overview' | 'tasks' | 'updates' | 'resources';

/** Operational Project detail composed from the shared entity-detail shell. */
export default function ProjectDetailPage(): JSX.Element {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { orgId, projectId } = useParams<{ orgId: string; projectId: string }>();
  const { teams, defaultTeamId, teamsLoading } = useActiveOrg();
  const projectNoun = useVocabulary('project');
  const taskNoun = useVocabulary('task').toLowerCase();
  const [tab, setTab] = useState<TabId>('overview');
  const [taskComposerOpen, setTaskComposerOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

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

  // Deleting a project hits `capabilityGuard('manage')` server-side, so the affordance is gated on
  // `manage` — a strictly stronger bar than the `contribute`-level `canEdit` used for field edits.
  const canDelete = useOrgCapability(detail?.members ?? [], detail?.roles ?? [], 'manage');

  const resourceKey = [...detailKey, 'resources'] as const;
  const displayMutation = useApiMutation<
    EntityDisplayOut,
    { iconKey: EntityDisplayIconKey; colorKey: EntityDisplayColorKey; customColor: string | null },
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
    onMutate: async ({ iconKey, colorKey, customColor }) => {
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
                customColor,
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
  const deleteProject = useApiMutation<ProjectOut, undefined>({
    mutationFn: () =>
      unwrap(
        () => api.v1.orgs[':orgId'].projects[':id'].$delete({ param: { orgId, id: projectId } }),
        'Could not delete this project.',
      ),
    invalidateKeys: [queryKeys.projects(orgId)],
    onSuccess: () => {
      router.push(`/orgs/${orgId}/projects`);
    },
  });

  // Inline quick-add: create a task in this project from just a typed title (no modal, no redirect).
  const createTaskInline = useApiMutation<TaskOut, string>({
    mutationFn: (title) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].tasks.$post({
            param: { orgId },
            json: {
              title,
              teamId: TeamId.parse(defaultTeamId ?? ''),
              priority: 'none',
              projectId: ProjectId.parse(projectId),
            },
          }),
        `Could not add the ${taskNoun}.`,
      ),
    invalidateKeys: [detailKey],
  });
  const renameTask = useRenameTask(orgId, [detailKey]);

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
  const tabItems = useMemo<readonly TabsItem[]>(
    () => [
      { value: 'overview', label: 'Overview' },
      { value: 'tasks', label: 'Tasks', count: milestoneTasks.length },
      { value: 'updates', label: 'Updates', count: updates.length },
      { value: 'resources', label: 'Resources', count: resources.length },
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
    <EntityDetailLayout
      icon={
        <InitiativeIconPicker
          display={
            detail?.display ?? {
              subjectType: 'project',
              subjectId: projectId,
              iconKey: 'folder',
              colorKey: 'neutral',
              customColor: null,
              customized: false,
            }
          }
          initiativeName={project.name}
          editable={canEdit}
          pending={displayMutation.isPending}
          onChange={(iconKey, colorKey, customColor) => {
            displayMutation.mutate({ iconKey, colorKey, customColor });
          }}
        />
      }
      title={
        <EditableTitle
          value={project.name}
          onSave={(name) => {
            patchProject({ name });
          }}
          canEdit={canEdit}
          saving={propsPending}
          ariaLabel={`${projectNoun} name`}
        />
      }
      subtitle={
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
      }
      metadata={
        <>
          <EntityMetadataRow ariaLabel="Project properties">
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
          </EntityMetadataRow>
          {propsError ? (
            <p role="alert" className="text-destructive text-sm">
              {propsError}
            </p>
          ) : null}
        </>
      }
      actions={
        canDelete ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0"
                aria-label={`${projectNoun} actions`}
              >
                <Ellipsis className="size-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={() => {
                  deleteProject.reset();
                  setConfirmDeleteOpen(true);
                }}
              >
                <Trash2 className="size-4" /> Delete {projectNoun.toLowerCase()}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null
      }
      tabs={
        <Tabs
          value={tab}
          onValueChange={(value) => {
            setTab(value as TabId);
          }}
          label="Project sections"
          items={tabItems}
        />
      }
    >
      {tab === 'overview' ? (
        <div
          role="tabpanel"
          id="tabpanel-overview"
          aria-labelledby="tab-overview"
          className="flex flex-col gap-8"
        >
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
            <EntityDocument
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
            onQuickAdd={(title) =>
              defaultTeamId
                ? createTaskInline.mutateAsync(title).then(() => undefined)
                : Promise.resolve()
            }
            onRename={renameTask}
            canEdit={canEdit}
          />
          <section className="flex flex-col gap-2">
            <h2 className="text-on-surface text-title-small font-medium">Task dependencies</h2>
            <div className="bg-surface-container h-96 overflow-hidden rounded-xl">
              <TaskGraphPanel
                scope={{ orgId, projectId }}
                density="compact"
                onExpand={() => {
                  router.push(`/orgs/${orgId}/graph?projectId=${projectId}`);
                }}
              />
            </div>
          </section>
        </div>
      ) : null}

      {tab === 'updates' ? (
        <div role="tabpanel" id="tabpanel-updates" aria-labelledby="tab-updates">
          <UpdatesPanel
            updates={updates}
            loading={updatesQ.isPending}
            error={
              updatesQ.isError ? userErrorMessage(updatesQ.error, 'Could not load updates.') : null
            }
            resolveActor={resolveActor}
            posting={updatePosting}
            postError={updateError}
            onPost={(body) => {
              postUpdate(body);
            }}
            showHealthComposer={false}
          />
        </div>
      ) : null}

      {tab === 'resources' ? (
        <div role="tabpanel" id="tabpanel-resources" aria-labelledby="tab-resources">
          <ResourcesTab
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

      <ConfirmDeleteDialog
        open={confirmDeleteOpen}
        onOpenChange={(next) => {
          // Clear a prior failure's message so it never lingers on the next open (or after close).
          if (!next) deleteProject.reset();
          setConfirmDeleteOpen(next);
        }}
        title={`Delete this ${projectNoun.toLowerCase()}?`}
        description={`This permanently removes “${project.name}” along with its milestones and tasks. This can't be undone.`}
        confirmLabel={`Delete ${projectNoun.toLowerCase()}`}
        pending={deleteProject.isPending}
        error={
          deleteProject.error
            ? userErrorMessage(deleteProject.error, 'Could not delete this project.')
            : null
        }
        onConfirm={() => {
          // Keep the dialog open on failure so the in-dialog error stays visible; the mutation's
          // own onSuccess navigates away, so only close here after a confirmed success.
          deleteProject.mutate(undefined, {
            onSuccess: () => {
              setConfirmDeleteOpen(false);
            },
          });
        }}
      />
    </EntityDetailLayout>
  );
}
