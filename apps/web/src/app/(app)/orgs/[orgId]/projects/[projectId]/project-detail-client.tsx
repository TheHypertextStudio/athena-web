'use client';

import type {
  AttachmentOut,
  Health,
  LabelOut,
  ObjectCommandReceipt,
  ObjectCommandRequest,
  ObjectCommandResult,
  UpdateOut,
} from '@docket/types';
import { ProjectSubjectRef } from '@docket/types';
import type { PickerOption } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { Ellipsis, RefreshCw, Trash2, Undo } from '@docket/ui/icons';
import {
  Button,
  ControlGroup,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Surface,
  Tabs,
  menuDestructiveItem,
} from '@docket/ui/primitives';
import {
  type FetchQueryOptions,
  type QueryClient,
  type QueryKey,
  useQueryClient,
} from '@tanstack/react-query';
import { type JSX, useEffect, useMemo, useState } from 'react';

import TaskGraphPanel from '@/components/canvas/task-graph-panel';
import { useCreateLabel } from '@/components/labels/queries';
import { ConfirmDestructiveDialog } from '@/components/confirm-destructive-dialog';
import { TemplateAwareEntityDocument } from '@/components/editor/apply-description-template';
import { EditableSubtitle } from '@/components/editor/editable-subtitle';
import { EditableTitle } from '@/components/editor/editable-title';
import { EntityIconPicker } from '@/components/entity-display/entity-icon-picker';
import { useEntityDisplay } from '@/components/entity-display/use-entity-display';
import { LatestUpdateSummary } from '@/components/entity-detail/latest-update-summary';
import {
  AgentActivityFeed,
  type AgentActivityEntry,
} from '@/components/project-detail/agent-activity-feed';
import { AgentsStrip, type AgentHere } from '@/components/project-detail/agents-strip';
import { MilestoneTasks } from '@/components/project-detail/milestone-tasks';
import { ProjectMilestonesPanel } from '@/components/project-detail/project-milestones';
import { ProjectDependenciesPanel } from '@/components/project-detail/project-dependencies';
import { OverviewSummary } from '@/components/project-detail/overview-summary';
import { ResourcesTab } from '@/components/entity-detail/resources-tab';
import { UpdatesPanel } from '@/components/entity-detail/updates-panel';
import { memberActorOptions } from '@/components/pickers/options';
import { ProjectPeopleRow } from '@/components/project-detail/project-people-row';
import { PropertiesPanel } from '@/components/project-detail/properties-panel';
import { PublishAction } from '@/components/publishing/publish-action';
import { RepeatProjectDialog } from '@/components/recurrence/repeat-project-dialog';
import { EntityDetailSkeleton } from '@/components/views/entity-detail-skeleton';
import { DetailPrintSummary } from '@/components/views/detail-print-summary';
import { useDetailTab } from '@/components/views/use-detail-tab';
import { EntityDetailLayout, EntityMetadataRow } from '@/components/views/entity-detail-layout';
import { useDocumentTitle } from '@/components/tabs/use-document-title';
import { useRegisterTabTitle } from '@/components/tabs/use-register-tab-title';
import { api } from '@/lib/api';
import { useTypedRoute } from '@/lib/app-location';
import {
  aggregateLoadState,
  projectDetailAggregateDef,
  terminalDetailFailure,
} from '@/lib/detail-aggregate';
import { useEntityMentions } from '@/lib/use-entity-mentions';
import { projectWorkSectionsDef } from '@/lib/fetch-project-sections';
import { useFiscalYearStartMonth } from '@/lib/use-fiscal-year-start-month';
import { useAppRouter } from '@/lib/interactions/navigation';
import { openTaskRecord } from '@/lib/local-first-navigation';
import { labelsDef } from '@/components/labels/queries';
import {
  removeNavigationSnapshot,
  seedNavigationSnapshot,
} from '@/lib/navigation-snapshot-runtime';
import { useNavigationSnapshot } from '@/lib/use-navigation-snapshot';
import { userErrorMessage } from '@/lib/problem';
import { apiQueryOptions, queryKeys, unwrap, useApiMutation, useApiQuery } from '@/lib/query';
import { orgMembersDef } from '@/lib/use-org-membership';
import { useProjectMutations } from '@/lib/use-project-mutations';
import { invalidateWorkTargetQueries } from '@/lib/work-target-invalidation';

type TabId = 'overview' | 'tasks' | 'updates' | 'resources';
const PROJECT_TABS = ['overview', 'tasks', 'updates', 'resources'] as const;

export function ProjectRestorePrimaryAction({
  refreshState,
  restorePending,
  onRetryRefresh,
  onUndo,
}: {
  readonly refreshState: 'ready' | 'pending' | 'error';
  readonly restorePending: boolean;
  readonly onRetryRefresh: () => void;
  readonly onUndo: () => void;
}): JSX.Element {
  if (refreshState === 'error')
    return (
      <Button type="button" variant="default" onClick={onRetryRefresh}>
        <RefreshCw className="size-4" /> Retry refresh
      </Button>
    );
  if (refreshState === 'pending')
    return (
      <Button type="button" variant="default" aria-label="Refreshing project" disabled>
        <RefreshCw className="size-4 animate-spin" /> Refreshing…
      </Button>
    );
  return (
    <Button type="button" variant="default" disabled={restorePending} onClick={onUndo}>
      <Undo className="size-4" /> Undo
    </Button>
  );
}

export async function refreshRestoredProject<TData, TQueryKey extends QueryKey>(input: {
  readonly queryClient: QueryClient;
  readonly aggregateQuery: FetchQueryOptions<TData, Error, TData, TQueryKey>;
  readonly ownerOrganizationId: string;
}): Promise<'ready' | 'not-found' | 'cache-error'> {
  void invalidateWorkTargetQueries(input.queryClient, {
    target: 'project',
    ownerOrganizationId: input.ownerOrganizationId,
  }).catch(() => undefined);
  try {
    await input.queryClient.fetchQuery({ ...input.aggregateQuery, staleTime: 0 });
    return 'ready';
  } catch (error) {
    return terminalDetailFailure(error) === 'not-found' ? 'not-found' : 'cache-error';
  }
}

/** Convert an agent activity payload into its one-line project activity summary. */
function activitySummary(activity: { body: Record<string, unknown>; type: string }): string {
  const action = activity.body['action'];
  if (action && typeof action === 'object' && 'summary' in action) {
    const summary = (action as { summary?: unknown }).summary;
    if (typeof summary === 'string') return summary;
  }
  const text = activity.body['text'];
  return typeof text === 'string' ? text : activity.type;
}

/** Render a Project from its local snapshot before one bounded aggregate reconciles it. */
export default function ProjectDetailPage(): JSX.Element {
  const { params } = useTypedRoute('/orgs/[orgId]/projects/[projectId]');
  const { orgId, projectId } = params;
  const router = useAppRouter();
  const queryClient = useQueryClient();
  const projectNoun = useVocabulary('project');
  const taskNounPlural = useVocabulary('task', { plural: true }).toLowerCase();
  const subject = ProjectSubjectRef.parse({ subjectType: 'project', subjectId: projectId });
  const navigationSnapshot = useNavigationSnapshot('project', projectId);
  const aggregateDef = projectDetailAggregateDef(orgId, projectId);
  const aggregateKey = aggregateDef.queryKey;
  const [aggregateEnabled, setAggregateEnabled] = useState(true);
  const [terminalState, setTerminalState] = useState<'forbidden' | 'not-found' | null>(null);
  const aggregateQ = useApiQuery({ ...aggregateDef, enabled: aggregateEnabled });
  const terminalFailure = terminalDetailFailure(aggregateQ.error);
  const aggregate = aggregateQ.data ?? null;
  const projectLead = aggregate?.references.lead ?? null;
  const initiativeNames =
    aggregate?.references.initiatives.map((initiative) => initiative.name) ?? [];
  const entityDisplay = useEntityDisplay({
    organizationId: orgId,
    subjectType: 'project',
    subjectId: projectId,
    errorMessage: `Could not customize this ${projectNoun.toLowerCase()}.`,
    enabled: aggregate !== null,
  });
  const project = aggregate?.defaultView.project ?? null;
  const aggregateState = aggregateLoadState(
    aggregateQ.data,
    aggregateQ.isPending,
    aggregateQ.isError,
  );
  const { tab, setTab } = useDetailTab<TabId>(PROJECT_TABS);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [trashedReceipt, setTrashedReceipt] = useState<ObjectCommandReceipt | null>(null);
  const [restoreFailure, setRestoreFailure] = useState<string | null>(null);
  const [repeatProjectOpen, setRepeatProjectOpen] = useState(false);
  const [ownerPickerOpen, setOwnerPickerOpen] = useState(false);
  const [timelinePickerOpen, setTimelinePickerOpen] = useState(false);
  const [programPickerOpen, setProgramPickerOpen] = useState(false);
  const [initiativesPickerOpen, setInitiativesPickerOpen] = useState(false);
  const [labelsPickerOpen, setLabelsPickerOpen] = useState(false);

  useEffect(() => {
    setTerminalState(null);
    setTrashedReceipt(null);
    setRestoreFailure(null);
  }, [projectId]);

  useEffect(() => {
    if (trashedReceipt !== null || terminalFailure === null) return;
    setTerminalState(terminalFailure);
    setAggregateEnabled(false);
    void removeNavigationSnapshot('project', projectId);
    queryClient.removeQueries({ queryKey: aggregateKey, exact: true });
  }, [aggregateKey, projectId, queryClient, terminalFailure, trashedReceipt]);

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
  const updatesKey = [...aggregateKey, 'updates'] as const;
  const updatesQ = useApiQuery(
    apiQueryOptions(
      updatesKey,
      () => api.v1.orgs[':orgId'].updates.$get({ param: { orgId }, query: subject }),
      'Could not load updates.',
      { enabled: aggregate !== null && (tab === 'overview' || tab === 'updates') },
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
    enabled: aggregate !== null && (tab === 'overview' || tab === 'tasks' || repeatProjectOpen),
  });
  const overviewRollupQ = useApiQuery(
    apiQueryOptions(
      [...aggregateKey, 'overview-rollup'] as const,
      () => api.v1.orgs[':orgId'].projects[':id'].rollup.$get({ param: { orgId, id: projectId } }),
      'Could not load Project agent activity.',
      { enabled: aggregate !== null && tab === 'overview' },
    ),
  );
  const sessionsQ = useApiQuery(
    apiQueryOptions(
      queryKeys.sessions(orgId),
      () => api.v1.orgs[':orgId'].sessions.$get({ param: { orgId }, query: {} }),
      'Could not load Project agent sessions.',
      { enabled: aggregate !== null && tab === 'overview' },
    ),
  );
  const entityMentions = useEntityMentions(
    orgId,
    subject,
    aggregate !== null && tab === 'resources',
  );
  const mutations = useProjectMutations(orgId, projectId);
  const createLabel = useCreateLabel(orgId);
  const canEdit = aggregate?.capabilities.contribute ?? false;
  const canDelete = aggregate?.capabilities.manage ?? false;
  const projectTaskCount = aggregate?.defaultView.progress.taskCount ?? 0;
  const linkedInitiativeIds =
    aggregate?.references.initiatives.map((initiative) => initiative.id) ?? [];
  const display = entityDisplay.display;
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
  const initiativeOptions = useMemo<readonly PickerOption[]>(() => {
    const current = aggregate?.references.initiatives ?? [];
    const fetched = (initiativesQ.data?.items ?? []).map((initiative) => ({
      value: initiative.id,
      label: initiative.name,
    }));
    const known = new Set(fetched.map((initiative) => initiative.value));
    return [
      ...current
        .filter((initiative) => !known.has(initiative.id))
        .map((initiative) => ({ value: initiative.id, label: initiative.name })),
      ...fetched,
    ];
  }, [aggregate?.references.initiatives, initiativesQ.data?.items]);
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
  const taskTitleById = useMemo(
    () => new Map((workQ.data?.tasks ?? []).map((task) => [task.id, task.title])),
    [workQ.data?.tasks],
  );
  const agentsHere = useMemo<readonly AgentHere[]>(
    () =>
      (sessionsQ.data?.items ?? []).flatMap((session) => {
        if (session.executorKind !== 'registered_agent' || !session.taskId) return [];
        const taskTitle = taskTitleById.get(session.taskId);
        if (!taskTitle) return [];
        return [
          {
            sessionId: session.id,
            agentName: `Agent ${session.agentId.slice(0, 6)}`,
            taskTitle,
            status: session.status,
          },
        ];
      }),
    [sessionsQ.data?.items, taskTitleById],
  );
  const agentActivity = useMemo<readonly AgentActivityEntry[]>(
    () =>
      (overviewRollupQ.data?.recentActivity ?? []).map((activity) => ({
        id: activity.id,
        agentName: `Agent ${activity.agentId.slice(0, 6)}`,
        type: activity.type,
        summary: activitySummary(activity),
        createdAt: activity.createdAt,
      })),
    [overviewRollupQ.data?.recentActivity],
  );

  useEffect(() => {
    if (aggregate) seedNavigationSnapshot(aggregate.snapshot);
  }, [aggregate]);
  useRegisterTabTitle('project', orgId, projectId, project?.name ?? navigationSnapshot?.name);
  useDocumentTitle(project?.name ?? navigationSnapshot?.name);

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
  const moveProjectToTrash = useApiMutation<ObjectCommandResult, ObjectCommandRequest>({
    mutationFn: (request) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId']['object-commands'].$post(
            { param: { orgId }, json: request },
            { headers: { 'Idempotency-Key': request.commandId } },
          ),
        `Could not move this ${projectNoun.toLowerCase()} to trash.`,
      ),
    invalidateKeys: [queryKeys.projects(orgId)],
    onSuccess: (result) => {
      setTrashedReceipt(result.receipt);
      setRestoreFailure(null);
      setConfirmDeleteOpen(false);
    },
  });
  const restoreProject = useApiMutation<ObjectCommandResult, ObjectCommandRequest>({
    mutationFn: (request) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId']['object-commands'].$post(
            { param: { orgId }, json: request },
            { headers: { 'Idempotency-Key': request.commandId } },
          ),
        `Could not restore this ${projectNoun.toLowerCase()}.`,
      ),
    onSuccess: async (result) => {
      if (!result.appliedIds.includes(projectId)) {
        setRestoreFailure(
          `This ${projectNoun.toLowerCase()} could not be restored because it changed elsewhere or you no longer have permission.`,
        );
        return;
      }
      setAggregateEnabled(true);
      await queryClient.refetchQueries({ queryKey: aggregateKey, exact: true, type: 'active' });
      if (queryClient.getQueryState(aggregateKey)?.error != null) {
        setRestoreFailure(
          `This ${projectNoun.toLowerCase()} was restored, but its page could not refresh. Try again or return to Projects.`,
        );
        return;
      }
      setTrashedReceipt(null);
      setRestoreFailure(null);
      setTerminalState(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects(orgId) });
    },
  });

  if (trashedReceipt !== null) {
    return (
      <div className="mx-auto flex min-h-80 max-w-3xl items-center p-6">
        <Surface tone="card" pad="roomy" className="w-full space-y-4">
          <div role="status" className="space-y-1">
            <h1 className="text-on-surface text-headline-small">{projectNoun} moved to trash</h1>
            <p className="text-on-surface-variant text-body-medium">
              {projectTaskCount > 0
                ? `${String(projectTaskCount)} ${projectTaskCount === 1 ? 'Task remains' : 'Tasks remain'} linked to this ${projectNoun.toLowerCase()}. Restoring it returns the same Tasks and relationships to active views.`
                : `This ${projectNoun.toLowerCase()} is hidden from active views and can be restored.`}
            </p>
          </div>
          {(restoreFailure ?? restoreProject.error) ? (
            <p role="alert" className="text-error text-body-medium">
              {restoreFailure ??
                userErrorMessage(
                  restoreProject.error,
                  `Could not restore this ${projectNoun.toLowerCase()}.`,
                )}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="default"
              disabled={restoreProject.isPending}
              onClick={() => {
                setRestoreFailure(null);
                restoreProject.mutate({
                  commandId: crypto.randomUUID(),
                  direction: 'undo',
                  receipt: trashedReceipt,
                });
              }}
            >
              <Undo className="size-4" /> Undo
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push(`/orgs/${orgId}/projects`)}
            >
              Back to Projects
            </Button>
          </div>
        </Surface>
      </div>
    );
  }

  if (terminalState !== null) {
    return (
      <p role="alert" className="text-on-surface-variant mx-auto max-w-7xl p-6">
        {terminalState === 'forbidden'
          ? `You no longer have access to this ${projectNoun.toLowerCase()}.`
          : `This ${projectNoun.toLowerCase()} no longer exists.`}
      </p>
    );
  }
  if (aggregateState === 'loading') {
    return (
      <>
        <EntityDetailSkeleton
          entityName={projectNoun}
          title={navigationSnapshot?.name}
          snapshotMetadata={
            navigationSnapshot ? (
              <span className="text-on-surface-variant text-body-small">
                {navigationSnapshot.status} · {navigationSnapshot.priority}
                {navigationSnapshot.health ? ` · ${navigationSnapshot.health}` : ''}
              </span>
            ) : undefined
          }
        />
        {aggregateQ.isError ? (
          <p role="alert" className="text-error text-body-medium mx-auto max-w-7xl px-6 pb-6">
            Could not refresh this {projectNoun.toLowerCase()}.
          </p>
        ) : null}
      </>
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
      printSummary={
        <DetailPrintSummary
          title={project.name}
          summary={project.summary}
          description={project.description}
          properties={[
            { label: 'Status', value: project.status.replace('_', ' ') },
            { label: 'Health', value: project.health ? project.health.replace('_', ' ') : '—' },
            { label: 'Owner', value: aggregate?.references.lead?.displayName ?? '—' },
            { label: 'Program', value: aggregate?.references.program?.name ?? '—' },
            {
              label: 'Initiatives',
              value: initiativeNames.length === 0 ? '—' : initiativeNames.join(', '),
            },
            { label: 'Tasks', value: String(aggregate?.defaultView.progress.taskCount ?? 0) },
          ]}
        />
      }
      icon={
        <EntityIconPicker
          display={display}
          entityName={project.name}
          editable={canEdit}
          pending={entityDisplay.mutation.isPending}
          loading={entityDisplay.loading}
          size={48}
          onChange={(iconKey, colorKey, customColor) => {
            entityDisplay.mutation.mutate({ iconKey, colorKey, customColor });
          }}
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
              initiativeIds={linkedInitiativeIds}
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
              onInitiativesChange={(initiativeIds) => {
                mutations.setInitiatives(initiativeIds, initiativeOptions);
              }}
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
                      moveProjectToTrash.reset();
                      setConfirmDeleteOpen(true);
                    }}
                  >
                    <Trash2 className="size-4" />
                    Move {projectNoun.toLowerCase()} to trash
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
          overflow={{ menuLabel: 'More Project sections' }}
          items={[
            { value: 'overview', label: 'Overview', priority: 0 },
            { value: 'tasks', label: 'Tasks', priority: 1 },
            { value: 'updates', label: 'Updates', priority: 2 },
            { value: 'resources', label: 'Resources', priority: 3 },
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
        <section
          role="tabpanel"
          id="tabpanel-overview"
          aria-labelledby="tab-overview"
          className="flex min-w-0 flex-col gap-8"
        >
          <LatestUpdateSummary
            updates={updatesQ.data?.items ?? []}
            loading={updatesQ.isPending}
            resolveActor={(actorId) => ({
              name:
                projectLead !== null && projectLead.actorId === actorId
                  ? projectLead.displayName
                  : 'Unknown',
              kind: 'human',
            })}
          />
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
          {workQ.isError ? (
            <p role="alert" className="text-error text-sm">
              Could not load Project work.
            </p>
          ) : null}
          <OverviewSummary
            tasks={milestoneTasks}
            milestones={(workQ.data?.milestones ?? []).map((milestone) => ({
              id: milestone.id,
              name: milestone.name,
            }))}
            taskNounPlural={taskNounPlural}
          />
          <ProjectMilestonesPanel
            orgId={orgId}
            projectId={projectId}
            projectDetailKey={workDef.queryKey}
            milestones={workQ.data?.milestones ?? []}
            milestoneTasks={milestoneTasks}
            canEdit={canEdit}
          />
          <AgentsStrip agents={agentsHere} />
          <AgentActivityFeed activities={agentActivity} />
          <ProjectDependenciesPanel
            orgId={orgId}
            projectId={projectId}
            projectDetailKey={workDef.queryKey}
            canEdit={canEdit}
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
            onOpenTask={(task) => {
              openTaskRecord(task);
            }}
            onCreate={() => {
              router.push(`/orgs/${orgId}/tasks?projectId=${projectId}`);
            }}
            onQuickAdd={async () => undefined}
            onRename={() => undefined}
            canEdit={false}
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
          if (!next) moveProjectToTrash.reset();
          setConfirmDeleteOpen(next);
        }}
        title={`Move this ${projectNoun.toLowerCase()} to trash?`}
        description={
          projectTaskCount > 0
            ? `This ${projectNoun.toLowerCase()} contains ${String(projectTaskCount)} ${projectTaskCount === 1 ? 'Task' : 'Tasks'}. Its Tasks and relationships stay linked, so Undo restores the same work.`
            : `“${project.name}” will leave active views. You can restore it with Undo.`
        }
        confirmLabel="Move to trash"
        pending={moveProjectToTrash.isPending}
        error={
          moveProjectToTrash.error
            ? userErrorMessage(
                moveProjectToTrash.error,
                `Could not move this ${projectNoun.toLowerCase()} to trash.`,
              )
            : null
        }
        onConfirm={() => {
          moveProjectToTrash.mutate({
            commandId: crypto.randomUUID(),
            objectKind: 'project',
            objectIds: [projectId],
            operation: { type: 'trash' },
          });
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
