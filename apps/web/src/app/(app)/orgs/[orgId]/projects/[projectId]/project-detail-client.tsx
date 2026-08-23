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
import { useVocabulary } from '@docket/ui/hooks';
import { Ellipsis, RefreshCw, Trash2 } from '@docket/ui/icons';
import {
  Button,
  ControlGroup,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tabs,
  menuDestructiveItem,
  type TabsItem,
} from '@docket/ui/primitives';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useAppParams, useAppSearchParams } from '@/lib/app-location';
import { type JSX, useEffect, useMemo, useState } from 'react';

import TaskGraphPanel from '@/components/canvas/task-graph-panel';
import { ConfirmDestructiveDialog } from '@/components/confirm-destructive-dialog';
import { TemplateAwareEntityDocument } from '@/components/editor/apply-description-template';
import { FreeformText } from '@/components/editor/freeform-text';
import { EditableSubtitle } from '@/components/editor/editable-subtitle';
import { EditableTitle } from '@/components/editor/editable-title';
import { EntityIconPicker } from '@/components/entity-display/entity-icon-picker';
import { AgentActivityFeed } from '@/components/project-detail/agent-activity-feed';
import { AgentsStrip } from '@/components/project-detail/agents-strip';
import { MilestoneTasks } from '@/components/project-detail/milestone-tasks';
import { ProjectDependenciesPanel } from '@/components/project-detail/project-dependencies';
import { ProjectMilestonesPanel } from '@/components/project-detail/project-milestones';
import { ProjectPeopleRow } from '@/components/project-detail/project-people-row';
import { PropertiesPanel } from '@/components/project-detail/properties-panel';
import { ResourcesTab } from '@/components/entity-detail/resources-tab';
import { useEntityMentions } from '@/lib/use-entity-mentions';
import { UpdatesPanel } from '@/components/entity-detail/updates-panel';
import { EntityDetailSkeleton } from '@/components/views/entity-detail-skeleton';
import { EntityDetailLayout, EntityMetadataRow } from '@/components/views/entity-detail-layout';
import { useDocumentTitle } from '@/components/tabs/use-document-title';
import { useRegisterTabTitle } from '@/components/tabs/use-register-tab-title';
import { useActiveOrg } from '@/components/active-org';
import { useCreateObject } from '@/components/create-object/create-object-provider';
import { PublishAction } from '@/components/publishing/publish-action';
import { RepeatProjectDialog } from '@/components/recurrence/repeat-project-dialog';
import { ProjectRepeatingWorkBacklink } from '@/components/recurrence/repeating-work-backlink';
import { api } from '@/lib/api';
import { queryKeys, unwrap, useApiMutation } from '@/lib/query';
import { useCreateLabel } from '@/components/labels/queries';
import { useOrgCapability } from '@/lib/use-org-capability';
import { useProjectDetailPage } from '@/lib/use-project-detail-page';
import { useRenameTask } from '@/lib/use-rename-task';
import { userErrorMessage } from '@/lib/problem';
import { useSession } from '@/lib/auth-client';
import { useFiscalYearStartMonth } from '@/lib/use-fiscal-year-start-month';

type TabId = 'overview' | 'tasks' | 'updates' | 'resources';

/** Operational Project detail composed from the shared entity-detail shell. */
export default function ProjectDetailPage(): JSX.Element {
  const router = useRouter();
  const searchParams = useAppSearchParams();
  const queryClient = useQueryClient();
  const { orgId, projectId } = useAppParams<{ orgId: string; projectId: string }>();
  const { defaultTeamId } = useActiveOrg();
  const { openCreate } = useCreateObject();
  const highlightMilestoneId = searchParams.get('milestoneId');
  const projectNoun = useVocabulary('project');
  const taskNoun = useVocabulary('task').toLowerCase();
  const [tab, setTab] = useState<TabId>('overview');
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [repeatProjectOpen, setRepeatProjectOpen] = useState(false);
  const entityMentions = useEntityMentions(orgId, 'project', projectId);
  const planningCalendar = useFiscalYearStartMonth(orgId);

  const {
    detailKey,
    detailQ,
    identityPending,
    members,
    roles,
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
    memberOptions,
    programOptions,
    initiativeOptions,
    agentsHere,
    agentActivity,
    initiativeIds,
    labels,
    availableLabels,
    patchProject,
    setInitiatives,
    postUpdate,
    propsError,
    updatePosting,
    updateError,
  } = useProjectDetailPage(orgId, projectId);

  const { data: session } = useSession();
  const currentActorId =
    members.find((member) => member.userId === session?.user.id)?.actorId ?? null;

  // The tab bar and the browser tab both follow the name on screen, including through a rename.
  useRegisterTabTitle('project', orgId, projectId, project?.name);
  useDocumentTitle(project?.name);

  // Deleting a project hits `capabilityGuard('manage')` server-side, so the affordance is gated on
  // `manage` — a strictly stronger bar than the `contribute`-level `canEdit` used for field edits.
  // Read from the same roster the hook uses, not from the composite: taking it from `detail` alone
  // hid the action for the length of that read, which is indistinguishable from lacking `manage`.
  const canDelete = useOrgCapability(members, roles, 'manage');
  const createLabel = useCreateLabel(orgId);

  // A `?milestoneId=` deep link (e.g. from search results) always resolves on the Overview tab,
  // where the Milestones panel lives — force it active, then scroll to and highlight the row once
  // the panel has rendered (re-runs once `milestones` arrives, since the row doesn't exist yet).
  useEffect(() => {
    if (highlightMilestoneId) setTab('overview');
  }, [highlightMilestoneId]);
  useEffect(() => {
    if (!highlightMilestoneId || tab !== 'overview') return;
    document
      .getElementById(`milestone-${highlightMilestoneId}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlightMilestoneId, tab, milestones]);

  const resourceKey = [...detailKey, 'resources'] as const;
  const displayMutation = useApiMutation<
    EntityDisplayOut,
    { iconKey: EntityDisplayIconKey; colorKey: EntityDisplayColorKey; customColor: string | null },
    { previous?: typeof detail | undefined }
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
    invalidateKeys: [
      detailKey,
      [...queryKeys.projects(orgId), 'overview'],
      queryKeys.entityDisplays(orgId, 'project'),
    ],
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
    const ids = new Set<string>();
    for (const { task } of milestoneTasks) {
      if (task.assigneeId) ids.add(task.assigneeId);
      if (task.delegateId) ids.add(task.delegateId);
    }
    return [...ids];
  }, [milestoneTasks]);
  const participants = useMemo(
    () => participantIds.map((actorId) => ({ actorId, ...resolveActor(actorId) })),
    [participantIds, resolveActor],
  );
  const latestUpdate = updates[0];
  const tabItems: readonly TabsItem[] = [
    { value: 'overview', label: 'Overview' },
    { value: 'tasks', label: 'Tasks' },
    { value: 'updates', label: 'Updates' },
    { value: 'resources', label: 'Resources' },
  ];

  if (identityPending) {
    // placeholder: the project's own record — its breadcrumb trail, name, summary, and the
    // milestone-grouped tasks, updates and resources beneath it.
    // The route carries only a project id, so none of this has a value to render before the read.
    //
    // Reached only on a cold open. Arriving from a list, or straight from the composer
    // that just created the project, the record is already cached and the page renders its real
    // masthead immediately with only the body still loading.
    return <EntityDetailSkeleton label={`Loading ${projectNoun.toLowerCase()}`} />;
  }
  if (detailQ.isError || !project) {
    return (
      <p role="alert" className="text-error mx-auto max-w-7xl p-6">
        {detailQ.isError
          ? userErrorMessage(detailQ.error, 'Could not load this project.')
          : `${projectNoun} not found.`}
      </p>
    );
  }

  const health = project.health ?? null;

  return (
    <EntityDetailLayout
      object={{
        kind: 'project',
        id: projectId,
        organizationId: orgId,
        title: project.name,
      }}
      icon={
        <EntityIconPicker
          display={
            detail?.display ?? {
              subjectType: 'project',
              subjectId: projectId,
              iconKey: 'folder',
              colorKey: 'neutral',
              customColor: null,
              coverImage: null,
              customized: false,
            }
          }
          entityName={project.name}
          editable={canEdit}
          pending={displayMutation.isPending}
          size={48}
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
          ariaLabel={`${projectNoun} name`}
        />
      }
      subtitle={
        <EditableSubtitle
          value={project.summary}
          placeholder="Add a concise outcome summary…"
          canEdit={canEdit}
          ariaLabel={`${projectNoun} summary`}
          onSave={(summary) => {
            patchProject({ summary });
          }}
          className="text-on-surface-variant text-body-large font-normal"
        />
      }
      metadata={
        <div className="flex min-w-0 flex-col gap-2">
          <ProjectPeopleRow
            ownerId={project.leadId ?? null}
            ownerOptions={memberOptions}
            assignedPeople={participants}
            canEdit={canEdit}
            onOwnerChange={(leadId) => {
              patchProject({ leadId });
            }}
          />
          <EntityMetadataRow ariaLabel="Project properties">
            <PropertiesPanel
              health={health}
              status={project.status}
              startDate={project.startDate ?? null}
              startDateResolution={project.startDateResolution}
              startDateFiscalYearStartMonth={project.startDateFiscalYearStartMonth}
              targetDate={project.targetDate ?? null}
              targetDateResolution={project.targetDateResolution}
              targetDateFiscalYearStartMonth={project.targetDateFiscalYearStartMonth}
              fiscalYearStartMonth={planningCalendar.fiscalYearStartMonth}
              planningCalendarLoading={planningCalendar.loading}
              programId={project.programId ?? null}
              programOptions={programOptions}
              initiativeIds={initiativeIds}
              initiativeOptions={initiativeOptions}
              labels={labels}
              availableLabels={availableLabels}
              canEdit={canEdit}
              onHealthChange={(next) => {
                patchProject({ health: next });
              }}
              onStatusChange={(status) => {
                patchProject({ status });
              }}
              onTimelineChange={({ start, target }) => {
                patchProject({
                  startDate: start?.date ?? null,
                  startDateResolution: start?.resolution ?? null,
                  targetDate: target?.date ?? null,
                  targetDateResolution: target?.resolution ?? null,
                });
              }}
              onProgramChange={(programId) => {
                patchProject({ programId });
              }}
              onInitiativesChange={setInitiatives}
              onLabelsChange={(labelIds) => {
                patchProject({ labelIds });
              }}
              onCreateLabel={(name) => {
                // Create and attach in one go: the name was typed into *this* project's picker,
                // so making the user then find and tick it would be a step nobody asked for.
                createLabel.mutate(
                  { name },
                  {
                    onSuccess: (created) => {
                      patchProject({ labelIds: [...labels.map((l) => l.id), created.id] });
                    },
                  },
                );
              }}
            />
          </EntityMetadataRow>
          {propsError || planningCalendar.error ? (
            <p role="alert" className="text-error text-sm">
              {propsError ?? planningCalendar.error}
            </p>
          ) : null}
        </div>
      }
      actions={
        // One ControlGroup at the row level, and no control inside it declares a height. That is
        // what makes the publish icon and the overflow icon provably the same size
        // rather than the same size until someone edits one of them.
        <ControlGroup controlSize="xl">
          <PublishAction
            orgId={orgId}
            subjectKind="project"
            subjectId={projectId}
            title={project.name}
            noun={projectNoun}
            canPublish={canEdit}
          />
          {canEdit || canDelete ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" iconOnly aria-label={`${projectNoun} actions`}>
                  <Ellipsis />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canEdit ? (
                  <DropdownMenuItem
                    onSelect={() => {
                      setRepeatProjectOpen(true);
                    }}
                  >
                    <RefreshCw className="size-4" /> Repeat {projectNoun.toLowerCase()}
                  </DropdownMenuItem>
                ) : null}
                {canEdit && canDelete ? <DropdownMenuSeparator /> : null}
                {canDelete ? (
                  <DropdownMenuItem
                    className={menuDestructiveItem()}
                    onSelect={() => {
                      deleteProject.reset();
                      setConfirmDeleteOpen(true);
                    }}
                  >
                    <Trash2 className="size-4" /> Delete {projectNoun.toLowerCase()}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </ControlGroup>
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
          <ProjectRepeatingWorkBacklink orgId={orgId} entityId={projectId} />

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
            <TemplateAwareEntityDocument
              orgId={orgId}
              kind="project"
              currentActorId={currentActorId}
              teamId={project.teamId ?? null}
              value={project.description}
              canEdit={canEdit}
              onSave={(description) => {
                patchProject({ description });
              }}
              placeholder="Describe this project…"
            />
          </section>

          <ProjectMilestonesPanel
            orgId={orgId}
            projectId={projectId}
            projectDetailKey={detailKey}
            milestones={milestones}
            milestoneTasks={milestoneTasks}
            canEdit={canEdit}
            highlightId={highlightMilestoneId}
          />

          <AgentsStrip agents={agentsHere} />
          <AgentActivityFeed activities={agentActivity} />

          <ProjectDependenciesPanel
            orgId={orgId}
            projectId={projectId}
            projectDetailKey={detailKey}
            canEdit={canEdit}
          />
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
              openCreate({
                kind: 'task',
                initialWorkspaceId: orgId,
                defaultProjectId: projectId,
                sameWorkspaceCompletion: 'stay',
                onCreated: () => {
                  void detailQ.refetch();
                },
              });
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
            onPost={(body) => postUpdate(body)}
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
            subject={{ type: 'project', id: projectId, organizationId: orgId }}
            mentionedExternal={entityMentions.external}
            mentionedEntities={entityMentions.entities}
            mentionsPending={entityMentions.isPending}
            hasProse={(project.description ?? '').trim().length > 0}
          />
        </div>
      ) : null}

      {displayMutation.error ? (
        <p role="alert" className="text-error text-sm">
          {userErrorMessage(displayMutation.error, 'Could not customize this project.')}
        </p>
      ) : null}

      <ConfirmDestructiveDialog
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
      <RepeatProjectDialog
        open={repeatProjectOpen}
        onOpenChange={setRepeatProjectOpen}
        orgId={orgId}
        project={project}
        milestones={milestones}
        tasks={milestoneTasks}
        projectNoun={projectNoun}
        onCreated={(seriesId) => {
          router.push(`/orgs/${orgId}/recurrence-series/${seriesId}`);
        }}
      />
    </EntityDetailLayout>
  );
}
