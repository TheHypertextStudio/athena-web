'use client';

import type {
  AttachmentOut,
  EntityDisplayColorKey,
  EntityDisplayIconKey,
  EntityDisplayOut,
  Health,
  LabelOut,
  ProjectOut,
  UpdateOut,
} from '@docket/types';
import { defaultEntityDisplay, ProjectSubjectRef } from '@docket/types';
import type { PickerOption } from '@docket/ui/components';
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
} from '@docket/ui/primitives';
import { useQueryClient } from '@tanstack/react-query';
import { type JSX, useEffect, useMemo, useState } from 'react';

import TaskGraphPanel from '@/components/canvas/task-graph-panel';
import { useCreateLabel } from '@/components/labels/queries';
import { ConfirmDestructiveDialog } from '@/components/confirm-destructive-dialog';
import { TemplateAwareEntityDocument } from '@/components/editor/apply-description-template';
import { EditableSubtitle } from '@/components/editor/editable-subtitle';
import { EditableTitle } from '@/components/editor/editable-title';
import { EntityIconPicker } from '@/components/entity-display/entity-icon-picker';
import { MilestoneTasks } from '@/components/project-detail/milestone-tasks';
import { ProjectMilestonesPanel } from '@/components/project-detail/project-milestones';
import { ProjectDependenciesPanel } from '@/components/project-detail/project-dependencies';
import { ResourcesTab } from '@/components/entity-detail/resources-tab';
import { UpdatesPanel } from '@/components/entity-detail/updates-panel';
import { memberActorOptions } from '@/components/pickers/options';
import { ProjectPeopleRow } from '@/components/project-detail/project-people-row';
import { PropertiesPanel } from '@/components/project-detail/properties-panel';
import { PublishAction } from '@/components/publishing/publish-action';
import { RepeatProjectDialog } from '@/components/recurrence/repeat-project-dialog';
import { EntityDetailSkeleton } from '@/components/views/entity-detail-skeleton';
import { EntityDetailLayout, EntityMetadataRow } from '@/components/views/entity-detail-layout';
import { useDocumentTitle } from '@/components/tabs/use-document-title';
import { useRegisterTabTitle } from '@/components/tabs/use-register-tab-title';
import { api } from '@/lib/api';
import { useTypedRoute } from '@/lib/app-location';
import { aggregateLoadState, projectDetailAggregateDef } from '@/lib/detail-aggregate';
import { useEntityMentions } from '@/lib/use-entity-mentions';
import { projectWorkSectionsDef } from '@/lib/fetch-project-sections';
import { useFiscalYearStartMonth } from '@/lib/use-fiscal-year-start-month';
import { useAppRouter } from '@/lib/interactions/navigation';
import { labelsDef } from '@/components/labels/queries';
import { seedNavigationSnapshot } from '@/lib/navigation-snapshot-runtime';
import { useNavigationSnapshot } from '@/lib/use-navigation-snapshot';
import { userErrorMessage } from '@/lib/problem';
import { apiQueryOptions, queryKeys, unwrap, useApiMutation, useApiQuery } from '@/lib/query';
import { orgMembersDef } from '@/lib/use-org-membership';
import { useProjectMutations } from '@/lib/use-project-mutations';

type TabId = 'overview' | 'tasks' | 'updates' | 'resources';

/** Render a Project from its local snapshot before one bounded aggregate reconciles it. */
export default function ProjectDetailPage(): JSX.Element {
  const { params } = useTypedRoute('/orgs/[orgId]/projects/[projectId]');
  const { orgId, projectId } = params;
  const router = useAppRouter();
  const queryClient = useQueryClient();
  const projectNoun = useVocabulary('project');
  const subject = ProjectSubjectRef.parse({ subjectType: 'project', subjectId: projectId });
  const navigationSnapshot = useNavigationSnapshot('project', projectId);
  const aggregateDef = projectDetailAggregateDef(orgId, projectId);
  const aggregateKey = aggregateDef.queryKey;
  const aggregateQ = useApiQuery(aggregateDef);
  const aggregate = aggregateQ.data ?? null;
  const project = aggregate?.defaultView.project ?? null;
  const aggregateState = aggregateLoadState(
    aggregateQ.data,
    navigationSnapshot !== null,
    aggregateQ.isPending,
    aggregateQ.isError,
  );
  const [tab, setTab] = useState<TabId>('overview');
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [repeatProjectOpen, setRepeatProjectOpen] = useState(false);
  const [ownerPickerOpen, setOwnerPickerOpen] = useState(false);
  const [timelinePickerOpen, setTimelinePickerOpen] = useState(false);
  const [programPickerOpen, setProgramPickerOpen] = useState(false);
  const [initiativesPickerOpen, setInitiativesPickerOpen] = useState(false);
  const [labelsPickerOpen, setLabelsPickerOpen] = useState(false);
  const [displayPickerOpen, setDisplayPickerOpen] = useState(false);

  const membersQ = useApiQuery({ ...orgMembersDef(orgId), enabled: ownerPickerOpen });
  const programsQ = useApiQuery(
    apiQueryOptions(
      [...queryKeys.programs(orgId), 'picker'] as const,
      () => api.v1.orgs[':orgId'].programs.$get({ param: { orgId }, query: {} }),
      'Could not load Programs.',
      { enabled: programPickerOpen },
    ),
  );
  const initiativesQ = useApiQuery(
    apiQueryOptions(
      [...queryKeys.initiatives(orgId), 'picker'] as const,
      () => api.v1.orgs[':orgId'].initiatives.$get({ param: { orgId }, query: {} }),
      'Could not load Initiatives.',
      { enabled: initiativesPickerOpen },
    ),
  );
  const labelsQ = useApiQuery({ ...labelsDef(orgId), enabled: labelsPickerOpen });
  const selectedLabelsQ = useApiQuery(
    apiQueryOptions(
      [...aggregateKey, 'labels'] as const,
      () => api.v1.orgs[':orgId'].projects[':id'].rollup.$get({ param: { orgId, id: projectId } }),
      'Could not load Project labels.',
      { enabled: labelsPickerOpen },
    ),
  );
  const planningCalendar = useFiscalYearStartMonth(orgId, timelinePickerOpen);
  const displayKey = [...aggregateKey, 'display'] as const;
  const displayQ = useApiQuery(
    apiQueryOptions(
      displayKey,
      () =>
        api.v1.orgs[':orgId'].display[':subjectType'][':subjectId'].$get({
          param: { orgId, ...subject },
        }),
      'Could not load display settings.',
      { enabled: displayPickerOpen },
    ),
  );
  const updatesKey = [...aggregateKey, 'updates'] as const;
  const updatesQ = useApiQuery(
    apiQueryOptions(
      updatesKey,
      () => api.v1.orgs[':orgId'].updates.$get({ param: { orgId }, query: subject }),
      'Could not load updates.',
      { enabled: aggregate !== null && tab === 'updates' },
    ),
  );
  const resourcesKey = [...aggregateKey, 'resources'] as const;
  const resourcesQ = useApiQuery(
    apiQueryOptions(
      resourcesKey,
      () =>
        api.v1.orgs[':orgId'].projects[':id'].resources.$get({
          param: { orgId, id: projectId },
        }),
      'Could not load resources.',
      { enabled: aggregate !== null && tab === 'resources' },
    ),
  );
  const workDef = projectWorkSectionsDef(orgId, projectId);
  const workQ = useApiQuery({
    ...workDef,
    enabled: aggregate !== null && (tab === 'tasks' || repeatProjectOpen),
  });
  const entityMentions = useEntityMentions(
    orgId,
    subject,
    aggregate !== null && tab === 'resources',
  );
  const mutations = useProjectMutations(orgId, projectId);
  const createLabel = useCreateLabel(orgId);
  const canEdit = aggregate?.capabilities.contribute ?? false;
  const canDelete = aggregate?.capabilities.manage ?? false;
  const display = displayQ.data ?? defaultEntityDisplay('project', projectId);
  const memberOptions = useMemo<readonly PickerOption[]>(() => {
    const options = memberActorOptions(membersQ.data?.items ?? []);
    const lead = aggregate?.references.lead;
    if (!lead || options.some((option) => option.value === lead.actorId)) return options;
    return [{ value: lead.actorId, label: lead.displayName }, ...options];
  }, [aggregate?.references.lead, membersQ.data?.items]);
  const programOptions = useMemo<readonly PickerOption[]>(
    () =>
      (programsQ.data?.items ?? []).map((program) => ({ value: program.id, label: program.name })),
    [programsQ.data?.items],
  );
  const initiativeOptions = useMemo<readonly PickerOption[]>(
    () =>
      (initiativesQ.data?.items ?? []).map((initiative) => ({
        value: initiative.id,
        label: initiative.name,
      })),
    [initiativesQ.data?.items],
  );
  const labels = selectedLabelsQ.data?.labels ?? [];
  const availableLabels = useMemo<readonly LabelOut[]>(
    () => (labelsQ.data?.items ?? []).filter((label) => label.teamId === null),
    [labelsQ.data?.items],
  );
  const milestoneTasks = useMemo(
    () =>
      (workQ.data?.tasks ?? []).map((task) => ({
        task,
        milestoneId:
          workQ.data?.taskMilestones.find((entry) => entry.taskId === task.id)?.milestoneId ?? null,
      })),
    [workQ.data],
  );

  useEffect(() => {
    if (aggregate) seedNavigationSnapshot(aggregate.snapshot);
  }, [aggregate]);
  useRegisterTabTitle('project', orgId, projectId, project?.name ?? navigationSnapshot?.name);
  useDocumentTitle(project?.name ?? navigationSnapshot?.name);

  const displayMutation = useApiMutation<
    EntityDisplayOut,
    { iconKey: EntityDisplayIconKey; colorKey: EntityDisplayColorKey; customColor: string | null },
    { previous?: EntityDisplayOut | undefined }
  >({
    mutationFn: (json) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].display[':subjectType'][':subjectId'].$put({
            param: { orgId, ...subject },
            json,
          }),
        `Could not customize this ${projectNoun.toLowerCase()}.`,
      ),
    onMutate: async ({ iconKey, colorKey, customColor }) => {
      await queryClient.cancelQueries({ queryKey: displayKey });
      const previous = queryClient.getQueryData<EntityDisplayOut>(displayKey);
      queryClient.setQueryData<EntityDisplayOut>(displayKey, {
        ...subject,
        iconKey,
        colorKey,
        customColor,
        coverImage: previous?.coverImage ?? null,
        customized: true,
      });
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(displayKey, context.previous);
    },
    invalidateKeys: [
      displayKey,
      queryKeys.projects(orgId),
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
    invalidateKeys: [resourcesKey],
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
    invalidateKeys: [resourcesKey],
  });
  const postUpdate = useApiMutation<UpdateOut, { body: string; health?: Health }>({
    mutationFn: (input) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].updates.$post({
            param: { orgId },
            json: { ...subject, ...input },
          }),
        'Could not post the update.',
      ),
    invalidateKeys: [updatesKey, aggregateKey],
  });
  const deleteProject = useApiMutation<ProjectOut, undefined>({
    mutationFn: () =>
      unwrap(
        () => api.v1.orgs[':orgId'].projects[':id'].$delete({ param: { orgId, id: projectId } }),
        `Could not delete this ${projectNoun.toLowerCase()}.`,
      ),
    invalidateKeys: [queryKeys.projects(orgId)],
    onSuccess: () => {
      router.push(`/orgs/${orgId}/projects`);
    },
  });

  if (aggregateState === 'loading' || aggregateState === 'snapshot') {
    return (
      <EntityDetailSkeleton
        label={`Loading ${projectNoun.toLowerCase()}`}
        title={navigationSnapshot?.name}
      />
    );
  }
  if (aggregateState === 'error') {
    return (
      <p role="alert" className="text-error mx-auto max-w-7xl p-6">
        {userErrorMessage(aggregateQ.error, `Could not load this ${projectNoun.toLowerCase()}.`)}
      </p>
    );
  }
  if (!project) return <p className="mx-auto max-w-7xl p-6">{projectNoun} not found.</p>;

  return (
    <EntityDetailLayout
      object={{ kind: 'project', id: projectId, organizationId: orgId, title: project.name }}
      icon={
        <EntityIconPicker
          display={display}
          entityName={project.name}
          editable={canEdit}
          pending={displayMutation.isPending}
          loading={displayPickerOpen && displayQ.isPending}
          size={48}
          onChange={(iconKey, colorKey, customColor) => {
            if (displayQ.data === undefined) return;
            displayMutation.mutate({ iconKey, colorKey, customColor });
          }}
          onOpenChange={setDisplayPickerOpen}
        />
      }
      title={
        <EditableTitle
          value={project.name}
          onSave={(name) => {
            mutations.patchProject({ name });
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
            mutations.patchProject({ summary });
          }}
          className="text-on-surface-variant text-body-large font-normal"
        />
      }
      metadata={
        <div className="flex min-w-0 flex-col gap-2">
          <ProjectPeopleRow
            ownerId={project.leadId ?? null}
            ownerOptions={memberOptions}
            assignedPeople={[]}
            canEdit={canEdit}
            ownerLoading={ownerPickerOpen && membersQ.isPending}
            onOwnerPickerOpenChange={setOwnerPickerOpen}
            onOwnerChange={(leadId) => {
              mutations.patchProject({ leadId });
            }}
          />
          <EntityMetadataRow ariaLabel="Project properties">
            <PropertiesPanel
              health={project.health ?? null}
              status={project.status}
              startDate={project.startDate ?? null}
              startDateResolution={project.startDateResolution}
              startDateFiscalYearStartMonth={project.startDateFiscalYearStartMonth}
              targetDate={project.targetDate ?? null}
              targetDateResolution={project.targetDateResolution}
              targetDateFiscalYearStartMonth={project.targetDateFiscalYearStartMonth}
              fiscalYearStartMonth={planningCalendar.fiscalYearStartMonth}
              planningCalendarLoading={timelinePickerOpen && planningCalendar.loading}
              onTimelinePickerOpenChange={setTimelinePickerOpen}
              programId={project.programId ?? null}
              programOptions={programOptions}
              programLoading={programPickerOpen && programsQ.isPending}
              onProgramPickerOpenChange={setProgramPickerOpen}
              initiativeIds={[]}
              initiativeOptions={initiativeOptions}
              initiativesLoading={initiativesPickerOpen && initiativesQ.isPending}
              onInitiativesPickerOpenChange={setInitiativesPickerOpen}
              labels={labels}
              availableLabels={availableLabels}
              labelsLoading={labelsPickerOpen && (selectedLabelsQ.isPending || labelsQ.isPending)}
              onLabelsPickerOpenChange={setLabelsPickerOpen}
              canEdit={canEdit}
              onHealthChange={(health) => {
                mutations.patchProject({ health });
              }}
              onStatusChange={(status) => {
                mutations.patchProject({ status });
              }}
              onTimelineChange={({ start, target }) => {
                mutations.patchProject({
                  startDate: start?.date ?? null,
                  startDateResolution: start?.resolution ?? null,
                  targetDate: target?.date ?? null,
                  targetDateResolution: target?.resolution ?? null,
                });
              }}
              onProgramChange={(programId) => {
                mutations.patchProject({ programId });
              }}
              onInitiativesChange={mutations.setInitiatives}
              onLabelsChange={(labelIds) => {
                mutations.patchProject({ labelIds });
              }}
              onCreateLabel={(name) => {
                createLabel.mutate(
                  { name },
                  {
                    onSuccess: (created) => {
                      mutations.patchProject({
                        labelIds: [...labels.map((label) => label.id), created.id],
                      });
                    },
                  },
                );
              }}
            />
          </EntityMetadataRow>
          {mutations.propsError || (ownerPickerOpen && membersQ.isError) ? (
            <p role="alert" className="text-error text-sm">
              {mutations.propsError ?? 'Could not load members.'}
            </p>
          ) : null}
        </div>
      }
      actions={
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
                    <RefreshCw className="size-4" />
                    Repeat {projectNoun.toLowerCase()}
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
                    <Trash2 className="size-4" />
                    Delete {projectNoun.toLowerCase()}
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
          items={[
            { value: 'overview', label: 'Overview' },
            { value: 'tasks', label: 'Tasks' },
            { value: 'updates', label: 'Updates' },
            { value: 'resources', label: 'Resources' },
          ]}
        />
      }
    >
      {aggregateQ.isError ? (
        <p role="alert" className="text-error text-sm">
          Could not refresh this {projectNoun.toLowerCase()}.
        </p>
      ) : null}
      {tab === 'overview' ? (
        <section role="tabpanel" id="tabpanel-overview" aria-labelledby="tab-overview">
          <TemplateAwareEntityDocument
            orgId={orgId}
            kind="project"
            currentActorId={aggregate?.viewer.actorId ?? null}
            teamId={project.teamId ?? null}
            value={project.description}
            canEdit={canEdit}
            onSave={(description) => {
              mutations.patchProject({ description });
            }}
            placeholder="Add the Project brief…"
          />
        </section>
      ) : null}
      {tab === 'tasks' ? (
        <section
          role="tabpanel"
          id="tabpanel-tasks"
          aria-labelledby="tab-tasks"
          className="flex flex-col gap-2"
        >
          <h2 className="text-on-surface text-title-small font-medium">Task dependencies</h2>
          {workQ.isError ? (
            <p role="alert" className="text-error text-sm">
              Could not load Project work.
            </p>
          ) : null}
          <MilestoneTasks
            orgId={orgId}
            tasks={milestoneTasks}
            milestones={(workQ.data?.milestones ?? []).map((milestone) => ({
              id: milestone.id,
              name: milestone.name,
              targetDate: milestone.targetDate ?? null,
            }))}
            resolveActor={() => ({ name: 'Unknown', kind: 'human' as const })}
            taskNoun="task"
            onOpenTask={(taskId) => {
              router.push(`/orgs/${orgId}/tasks/${taskId}`);
            }}
            onCreate={() => {
              router.push(`/orgs/${orgId}/tasks?projectId=${projectId}`);
            }}
            onQuickAdd={async () => undefined}
            onRename={() => undefined}
            canEdit={false}
          />
          <ProjectMilestonesPanel
            orgId={orgId}
            projectId={projectId}
            projectDetailKey={workDef.queryKey}
            milestones={workQ.data?.milestones ?? []}
            milestoneTasks={milestoneTasks}
            canEdit={canEdit}
          />
          <ProjectDependenciesPanel
            orgId={orgId}
            projectId={projectId}
            projectDetailKey={workDef.queryKey}
            canEdit={canEdit}
          />
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
      ) : null}
      {tab === 'updates' ? (
        <div role="tabpanel" id="tabpanel-updates" aria-labelledby="tab-updates">
          <UpdatesPanel
            updates={updatesQ.data?.items ?? []}
            loading={updatesQ.isPending}
            error={updatesQ.isError ? 'Could not load updates.' : null}
            resolveActor={(actorId) => ({
              name:
                aggregate?.references.lead?.actorId === actorId
                  ? (aggregate?.references.lead?.displayName ?? 'Unknown')
                  : 'Unknown',
              kind: 'human' as const,
            })}
            posting={postUpdate.isPending}
            postError={postUpdate.error ? 'Could not post the update.' : null}
            onPost={async (body) => {
              await postUpdate.mutateAsync({ body });
            }}
            showHealthComposer={false}
          />
        </div>
      ) : null}
      {tab === 'resources' ? (
        <div role="tabpanel" id="tabpanel-resources" aria-labelledby="tab-resources">
          <ResourcesTab
            resources={resourcesQ.data?.items ?? []}
            loading={resourcesQ.isPending}
            canEdit={canEdit}
            pending={addResource.isPending || removeResource.isPending}
            error={
              resourcesQ.isError
                ? 'Could not load resources.'
                : addResource.error
                  ? 'Could not add the resource.'
                  : removeResource.error
                    ? 'Could not remove the resource.'
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
      <ConfirmDestructiveDialog
        open={confirmDeleteOpen}
        onOpenChange={(next) => {
          if (!next) deleteProject.reset();
          setConfirmDeleteOpen(next);
        }}
        title={`Delete this ${projectNoun.toLowerCase()}?`}
        description={`This permanently removes “${project.name}” along with its milestones and tasks. This can't be undone.`}
        confirmLabel={`Delete ${projectNoun.toLowerCase()}`}
        pending={deleteProject.isPending}
        error={
          deleteProject.error
            ? userErrorMessage(
                deleteProject.error,
                `Could not delete this ${projectNoun.toLowerCase()}.`,
              )
            : null
        }
        onConfirm={() => {
          deleteProject.mutate(undefined);
        }}
      />
      <RepeatProjectDialog
        open={repeatProjectOpen}
        onOpenChange={setRepeatProjectOpen}
        orgId={orgId}
        project={project}
        milestones={workQ.data?.milestones ?? []}
        tasks={milestoneTasks}
        projectNoun={projectNoun}
        onCreated={(seriesId) => {
          router.push(`/orgs/${orgId}/recurrence-series/${seriesId}`);
        }}
      />
    </EntityDetailLayout>
  );
}
