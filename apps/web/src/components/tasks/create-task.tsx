'use client';

/**
 * The robust "New task" create composer.
 *
 * @remarks
 * A Linear-grade task composer: an autofocused title, a description body, and an inline strip of
 * compact property pickers — workflow status, priority, assignee, {@link useVocabulary | project},
 * milestone, cycle, anticipated start, and due date — so a task can be fully shaped at creation
 * without a follow-up trip to its detail screen. Sensible defaults keep it fast: the status
 * defaults to the team's first workflow state, the priority to "No priority", and the team to the
 * org's default; everything else is optional. The composer reuses the shared {@link ComposerShell}
 * for its chrome and the `@docket/ui` compact pickers for its properties.
 *
 * Milestone mirrors the task detail rail: it's scoped to the chosen project (disabled with a
 * prompt until one is picked) since a milestone always belongs to exactly one project. A parent
 * task is deliberately NOT offered here — that relationship is created the other direction, via
 * "Add subtask" on the parent's own detail screen, so a redundant picker here would just be a
 * second, disconnected way to do the same thing.
 *
 * Creating a task is *team-scoped* (each team owns its workflow), so the composer offers a
 * {@link TeamPicker} when the org has more than one team and reloads the status options whenever
 * the chosen team changes. It may be opened pre-scoped — `defaultProjectId` (e.g. from a
 * project's Tasks tab) and `defaultAssigneeId` (e.g. from My Work's "Assigned to me" tab) seed the
 * matching pickers. The dialog is *controlled* by the host: the page owns `open` and is handed the
 * created {@link TaskOut} through {@link CreateTaskDialogProps.onCreated} to prepend + route.
 *
 * Every field lives in one {@link useComposerDraft} value so a template can fill them together and
 * that action can be undone in one step.
 *
 * @see {@link useComposerOptions} for the assignee / project / cycle / label option sources.
 */
import { ActorId, TeamId } from '@docket/identity-access/ids';
import { CycleId, LabelId, MilestoneId, ProjectId } from '@docket/work/ids';
import { type TaskOut } from '@docket/work/task-model';
import { type TeamOut } from '../../lib/contracts/team';
import { type WorkflowState } from '@docket/work/workflow';
import type { Priority } from '@docket/work/task-contract';
import { todayIso } from '@docket/ui/components';
import { VocabularyProvider, useVocabulary } from '@docket/ui/hooks';
import { ChevronRight } from '@docket/ui/icons';
import { useQueryClient } from '@tanstack/react-query';
import { type JSX, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAppRouter } from '@/lib/interactions/navigation';
import { api } from '@/lib/api';
import { ComposerShell } from '@/components/composer/composer-shell';
import { useComposerContinuation } from '@/components/composer/use-composer-continuation';
import { ComposerTemplateControl } from '@/components/composer/template-menu';
import type { EditorContribution } from '@/components/editor/editor-contribution';
import { useComposerDraft } from '@/components/composer/use-composer-draft';
import { templateMerge } from '@/components/templates/merge';
import { withComposerReset } from '@/components/composer/reset-on-open';
import { completeCreateObject } from '@/components/create-object/create-object-completion';
import {
  type CreateTaskRequest,
  useCreateObject,
} from '@/components/create-object/create-object-provider';
import { useCreationContext } from '@/components/create-object/creation-context';
import { WorkspacePicker } from '@/components/create-object/workspace-picker';
import { EntityMetadataItem } from '@/components/views/entity-detail-layout';
import { cycleOptions, milestoneOptions, workflowStateOptions } from '@/components/pickers/options';
import { formatWindow } from '@/components/cycles/format-window';
import { useComposerOptions } from '@/components/pickers/use-composer-options';
import { templatePatch } from '@/components/templates/queries';
import { TeamPicker } from '@/components/teams/team-picker';
import { useSession } from '@/lib/auth-client';
import { useEstimationScale } from '@/lib/use-estimation-scale';
import { userErrorMessage, readProblemError } from '@/lib/problem';
import { seedTaskRecord } from '@/lib/entity-records';
import { queryKeys } from '@/lib/query';
import {
  RepeatTaskControl,
  type TaskRepeatDraft,
} from '@/components/recurrence/repeat-task-control';

import { TaskComposerPickers } from './task-form-pickers';

/** The lists this composer's pickers draw from. */
const COMPOSER_INCLUDE = ['actors', 'projects', 'cycles', 'labels', 'milestones'] as const;

/** Every field the task composer holds, as one value. */
export interface TaskDraft {
  title: string;
  description: string;
  /** The team chosen in the picker, or null to follow the org default. */
  teamOverride: string | null;
  state: string | null;
  priority: Priority;
  assigneeId: string | null;
  projectId: string | null;
  milestoneId: string | null;
  cycleId: string | null;
  startDate: string | null;
  dueDate: string | null;
  labelIds: readonly string[];
  /** Coarse effort estimate in the workspace's scale, or null for none. */
  estimate: number | null;
  /** Whether and how Docket should create future copies of this task. */
  repeat: TaskRepeatDraft;
}

/** Workspace references carried with a successful task create for precise cache invalidation. */
export interface TaskCreationReferences {
  /** The project relation selected when the task was submitted, if any. */
  readonly projectId: string | null;
  /** The milestone relation selected when the task was submitted, if any. */
  readonly milestoneId: string | null;
  /** The cycle relation selected when the task was submitted, if any. */
  readonly cycleId: string | null;
}

/** Destination facts supplied by the global create host. */
export interface TaskGlobalCreation {
  /** The destination selected in the global composer, independent of the background shell. */
  readonly targetWorkspaceId: string | null;
  /** The workspace selected when the request opened, which scopes contextual request defaults. */
  readonly initialWorkspaceId: string | null;
  /** Whether the destination workspace and its required creation data are ready. */
  readonly ready: boolean;
  /** Application-owned copy for a failed destination read. */
  readonly loadError: string | null;
  /** Whether the signed-in member may create tasks in the target workspace. */
  readonly canContribute: boolean;
  /** The target-workspace Actor id for scoping personal templates. */
  readonly currentActorId: string | null;
  /**
   * Complete a successful create against the selected destination.
   *
   * @remarks
   * The host owns invalidation, navigation, and the origin request callback. `continueCreating`
   * distinguishes a persistent Create-more submit from the normal completion path.
   */
  readonly onCreated: (
    task: TaskOut,
    references: TaskCreationReferences,
    continueCreating: boolean,
  ) => void | Promise<void>;
  /** Open a committed Task when destination-independent completion work could not finish. */
  readonly onOpenCreated?: ((task: TaskOut) => void) | undefined;
}

/** Props for {@link CreateTaskDialog}. */
export interface CreateTaskDialogProps {
  /** The org the task is created in (from the route). */
  orgId: string;
  /** The teams a task may be created in (the active org's teams). */
  teams: readonly TeamOut[];
  /** The team id new tasks default to, or `null` before teams resolve. */
  defaultTeamId: string | null;
  /** Whether the active org's teams are still loading. */
  teamsLoading: boolean;
  /** Whether the dialog is open (the host page owns this state). */
  open: boolean;
  /** Notify the parent that the open state changed (Esc, backdrop, X, Cancel, or success). */
  onOpenChange: (open: boolean) => void;
  /** Notify the parent that a task was created, so it can prepend + route. */
  onCreated: (task: TaskOut) => void;
  /** Pre-seed the project picker (e.g. opening from a project's Tasks tab). */
  defaultProjectId?: string | null | undefined;
  /** Pre-seed the assignee picker (e.g. opening from My Work's "Assigned to me" tab). */
  defaultAssigneeId?: string | null | undefined;
  /** A template to apply on open, from a `?template=` compose request. */
  defaultTemplateId?: string | null | undefined;
  /** Destination facts when this dialog is mounted by the global creation host. */
  globalCreation?: TaskGlobalCreation | undefined;
}

/**
 * The robust task-create composer dialog.
 *
 * @param props - The {@link CreateTaskDialogProps}.
 * @returns the rendered composer.
 */
export const CreateTaskDialog = withComposerReset(function CreateTaskComposer({
  orgId,
  teams,
  defaultTeamId,
  teamsLoading,
  open,
  onOpenChange,
  onCreated,
  defaultProjectId = null,
  defaultAssigneeId = null,
  defaultTemplateId = null,
  globalCreation,
}: CreateTaskDialogProps): JSX.Element {
  const projectNoun = useVocabulary('project');
  const cycleNoun = useVocabulary('cycle');
  const previousWorkspaceId = useRef(globalCreation?.targetWorkspaceId ?? null);
  const contextualRequestDefaultsApply =
    globalCreation === undefined ||
    globalCreation.targetWorkspaceId === globalCreation.initialWorkspaceId;
  const destinationReady = globalCreation?.ready ?? true;

  const options = useComposerOptions(orgId, COMPOSER_INCLUDE, open && destinationReady);
  const { scale: estimationScale } = useEstimationScale(orgId, open && destinationReady);
  const { draft, setField, updateDraft } = useComposerDraft<TaskDraft>({
    title: '',
    description: '',
    teamOverride: null,
    state: null,
    priority: 'none',
    assigneeId: contextualRequestDefaultsApply ? defaultAssigneeId : null,
    projectId: contextualRequestDefaultsApply ? defaultProjectId : null,
    milestoneId: null,
    cycleId: null,
    startDate: null,
    dueDate: null,
    labelIds: [],
    estimate: null,
    repeat: { kind: 'none' },
  });

  const [workflowStates, setWorkflowStates] = useState<readonly WorkflowState[]>([]);
  const [creating, setCreating] = useState(false);
  const [completionFailed, setCompletionFailed] = useState(false);
  const [completedTask, setCompletedTask] = useState<TaskOut | null>(null);
  const [error, setError] = useState<string | null>(null);
  const continuation = useComposerContinuation({
    creating,
    successMessage: 'Task created. Ready to create another.',
  });

  const teamId = draft.teamOverride ?? defaultTeamId;
  const templateContribution = useMemo<EditorContribution>(
    () => ({
      id: 'composer-description-templates-task',
      renderEmptyAction: () => (
        <ComposerTemplateControl
          orgId={orgId}
          kind="task"
          open={open && destinationReady}
          autoApplyId={contextualRequestDefaultsApply ? defaultTemplateId : null}
          currentActorId={globalCreation?.currentActorId}
          teamId={globalCreation === undefined ? undefined : teamId}
          inline
          onManage={
            globalCreation === undefined
              ? undefined
              : () => {
                  onOpenChange(false);
                }
          }
          onApply={(chosen) => {
            updateDraft((current) =>
              templateMerge(current, templatePatch(chosen.payload, 'task'), {
                document: 'description',
                labels: ['title'],
              }),
            );
          }}
          disabled={creating || completedTask !== null || !destinationReady}
        />
      ),
    }),
    [
      completedTask,
      contextualRequestDefaultsApply,
      creating,
      defaultTemplateId,
      destinationReady,
      globalCreation,
      onOpenChange,
      open,
      orgId,
      teamId,
      updateDraft,
    ],
  );

  // A destination change retains portable text and generic task values, but a reference to a
  // member, team, project, milestone, cycle, or label in the prior workspace is never valid in
  // the next one. The effective team immediately falls back to that workspace's default team.
  useEffect(() => {
    if (globalCreation === undefined) return;
    const previousTargetWorkspaceId = previousWorkspaceId.current;
    if (previousTargetWorkspaceId === globalCreation.targetWorkspaceId) return;
    previousWorkspaceId.current = globalCreation.targetWorkspaceId;
    // Resolving an initially-null shell workspace to its immutable opening destination is not a
    // retarget. The contextual Project and assignee defaults were already seeded for that same
    // workspace and must survive this provider-resolution frame.
    if (
      previousTargetWorkspaceId === null &&
      globalCreation.targetWorkspaceId !== null &&
      globalCreation.targetWorkspaceId === globalCreation.initialWorkspaceId
    ) {
      return;
    }
    setWorkflowStates([]);
    setError(null);
    updateDraft(() => ({
      teamOverride: null,
      state: null,
      assigneeId: null,
      projectId: null,
      milestoneId: null,
      cycleId: null,
      labelIds: [],
    }));
  }, [globalCreation, updateDraft]);

  // Load the chosen team's workflow states, defaulting the status to its first (the create
  // default the API would pick) so the status chip is never blank.
  useEffect(() => {
    if (!open || !destinationReady) return;
    const live = { current: true };
    void (async () => {
      const states = await options.workflowStatesFor(teamId);
      if (!live.current) return;
      setWorkflowStates(states);
      updateDraft((current) => (current.state === null ? { state: states[0]?.key ?? null } : {}));
    })();
    return () => {
      live.current = false;
    };
  }, [destinationReady, open, teamId, options, updateDraft]);

  // Cycles are org-wide; scope the picker to the chosen team's cadence. The label is the cycle's
  // server-derived `displayName` (its author name, else its window) — never the stored `number`,
  // which is the auto-roll idempotency key and reads as "Cycle 1000137".
  const cycleOptionsForTeam = useMemo(() => {
    return cycleOptions(
      options.cycles.filter((cycle) => cycle.teamId === teamId),
      formatWindow,
      options.cycleDisplays,
    );
  }, [options.cycleDisplays, options.cycles, teamId]);

  // A milestone always belongs to exactly one project, so the picker is scoped to whichever
  // project is currently chosen — same rule the task detail rail applies post-creation.
  const milestoneOptionsForProject = useMemo(() => {
    return milestoneOptions(
      options.milestones.filter((milestone) => milestone.projectId === draft.projectId),
      options.milestoneDisplays,
    );
  }, [options.milestoneDisplays, options.milestones, draft.projectId]);

  /** Changing the project invalidates any milestone chosen under the previous one. */
  const changeProject = useCallback(
    (id: string | null): void => {
      updateDraft(() => ({ projectId: id, milestoneId: null }));
    },
    [updateDraft],
  );

  /** Select a team and clear every field whose validity depends on that team's workflow. */
  const changeTeam = useCallback(
    (next: string | null): void => {
      setWorkflowStates([]);
      updateDraft(() => ({ teamOverride: next, state: null, cycleId: null }));
    },
    [updateDraft],
  );

  const statusOptions = useMemo(() => workflowStateOptions(workflowStates), [workflowStates]);

  /** Toggle a label id in/out of the selected set. */
  const toggleLabel = useCallback(
    (id: string): void => {
      updateDraft((current) => ({
        labelIds: current.labelIds.includes(id)
          ? current.labelIds.filter((value) => value !== id)
          : [...current.labelIds, id],
      }));
    },
    [updateDraft],
  );

  const canSubmit =
    draft.title.trim().length > 0 &&
    teamId !== null &&
    !teamsLoading &&
    destinationReady &&
    !completionFailed &&
    (globalCreation?.canContribute ?? true);

  /** Create the task with all set properties, optionally continuing into a fresh text draft. */
  const submit = useCallback(
    async (continueCreating = false): Promise<void> => {
      if (completedTask !== null) {
        globalCreation?.onOpenCreated?.(completedTask);
        return;
      }
      const trimmed = draft.title.trim();
      if (trimmed.length === 0 || !teamId || !canSubmit || !continuation.beginSubmission()) return;
      setCreating(true);
      setError(null);
      let createdTask: TaskOut | null = null;
      try {
        const trimmedBody = draft.description.trim();
        const taskBody = {
          title: trimmed,
          teamId: TeamId.parse(teamId),
          priority: draft.priority,
          ...(trimmedBody.length > 0 ? { description: trimmedBody } : {}),
          ...(draft.state ? { state: draft.state } : {}),
          ...(draft.assigneeId ? { assigneeId: ActorId.parse(draft.assigneeId) } : {}),
          ...(draft.projectId ? { projectId: ProjectId.parse(draft.projectId) } : {}),
          ...(draft.milestoneId ? { milestoneId: MilestoneId.parse(draft.milestoneId) } : {}),
          ...(draft.cycleId ? { cycleId: CycleId.parse(draft.cycleId) } : {}),
          ...(draft.startDate ? { startDate: draft.startDate } : {}),
          ...(draft.dueDate ? { dueDate: draft.dueDate } : {}),
          ...(draft.labelIds.length > 0
            ? { labels: draft.labelIds.map((id) => LabelId.parse(id)) }
            : {}),
          ...(draft.estimate !== null ? { estimate: draft.estimate } : {}),
        };
        const res =
          draft.repeat.kind === 'none'
            ? await api.v1.orgs[':orgId'].tasks.$post({ param: { orgId }, json: taskBody })
            : await api.v1.orgs[':orgId']['recurring-tasks'].$post({
                param: { orgId },
                json:
                  draft.repeat.kind === 'calendar'
                    ? {
                        task: taskBody,
                        schedule: draft.repeat.schedule,
                        missedPolicy: draft.repeat.missedPolicy,
                        materialization: draft.repeat.materialization,
                      }
                    : { task: taskBody, schedule: draft.repeat.schedule },
              });
        if (!res.ok) {
          setError(
            userErrorMessage(
              await readProblemError(res, 'Could not create the task.'),
              'Could not create the task.',
            ),
          );
          return;
        }
        const created = await res.json();
        createdTask = 'firstTask' in created ? created.firstTask : created;
        const references: TaskCreationReferences = {
          projectId: draft.projectId,
          milestoneId: draft.milestoneId,
          cycleId: draft.cycleId,
        };
        if (globalCreation !== undefined) {
          await globalCreation.onCreated(createdTask, references, continueCreating);
        }
        if (continueCreating) {
          continuation.completeContinuation(() => {
            updateDraft(() => ({ title: '', description: '' }));
          });
          return;
        }
        onOpenChange(false);
        if (globalCreation === undefined) onCreated(createdTask);
      } catch (caught) {
        if (createdTask !== null && globalCreation !== undefined) {
          setCompletionFailed(true);
          setCompletedTask(createdTask);
        }
        setError(userErrorMessage(caught, 'Something went wrong creating the task.'));
      } finally {
        continuation.finishSubmission();
        setCreating(false);
      }
    },
    [
      canSubmit,
      completedTask,
      continuation,
      draft,
      globalCreation,
      onCreated,
      onOpenChange,
      orgId,
      teamId,
      updateDraft,
    ],
  );

  return (
    <ComposerShell
      open={open}
      onOpenChange={onOpenChange}
      heading="New task"
      propertyAriaLabel="Task properties"
      contextRow={
        globalCreation ? (
          <>
            <EntityMetadataItem priority={0} className="max-w-none">
              <WorkspacePicker disabled={creating || completedTask !== null} />
            </EntityMetadataItem>
            {teams.length > 1 ? (
              <EntityMetadataItem priority={1} className="flex max-w-none gap-2">
                <ChevronRight aria-hidden className="text-on-surface-variant size-4 shrink-0" />
                <TeamPicker
                  teams={teams}
                  value={teamId}
                  onChange={changeTeam}
                  disabled={creating || completedTask !== null}
                />
              </EntityMetadataItem>
            ) : null}
          </>
        ) : undefined
      }
      context={
        globalCreation === undefined && teams.length > 1 ? (
          <TeamPicker teams={teams} value={teamId} onChange={changeTeam} disabled={creating} />
        ) : undefined
      }
      continuation={
        completedTask === null
          ? {
              checked: continuation.createMore,
              onCheckedChange: continuation.setCreateMore,
              onSubmit: () => {
                void submit(true);
              },
            }
          : undefined
      }
      title={draft.title}
      onTitleChange={(next) => {
        setField('title', next);
      }}
      titleInputRef={continuation.titleInputRef}
      titlePlaceholder="Task title"
      body={draft.description}
      bodyResetKey={continuation.bodyResetGeneration}
      onBodyChange={(next) => {
        setField('description', next);
      }}
      bodyPlaceholder="Add a description"
      bodyContributions={[templateContribution]}
      mentionOrgId={orgId}
      error={error ?? globalCreation?.loadError ?? null}
      statusMessage={continuation.statusMessage}
      draftCommitted={completedTask !== null}
      contentDisabled={completedTask !== null}
      creating={creating}
      canSubmit={completedTask !== null || canSubmit}
      onSubmit={() => void submit(continuation.createMore)}
      submitLabel={
        completedTask !== null
          ? 'Open created task'
          : draft.repeat.kind === 'none'
            ? 'Create task'
            : 'Create repeating task'
      }
    >
      <TaskComposerPickers
        statusOptions={statusOptions}
        state={draft.state}
        priority={draft.priority}
        assigneeId={draft.assigneeId}
        actorOptions={options.actorOptions}
        projectId={draft.projectId}
        projectOptions={options.projectOptions}
        projectNoun={projectNoun}
        milestoneId={draft.milestoneId}
        milestoneOptionsForProject={milestoneOptionsForProject}
        cycleId={draft.cycleId}
        cycleOptionsForTeam={cycleOptionsForTeam}
        cycleNoun={cycleNoun}
        startDate={draft.startDate}
        dueDate={draft.dueDate}
        labelIds={draft.labelIds}
        labelOptions={options.labelOptions}
        estimationScale={estimationScale}
        estimate={draft.estimate}
        creating={creating || completedTask !== null}
        onStateChange={(next) => {
          setField('state', next);
        }}
        onPriorityChange={(next) => {
          setField('priority', next);
        }}
        onAssigneeChange={(next) => {
          setField('assigneeId', next);
        }}
        onProjectChange={changeProject}
        onMilestoneChange={(next) => {
          setField('milestoneId', next);
        }}
        onCycleChange={(next) => {
          setField('cycleId', next);
        }}
        onStartDateChange={(next) => {
          setField('startDate', next);
        }}
        onDueDateChange={(next) => {
          setField('dueDate', next);
        }}
        onLabelToggle={toggleLabel}
        onEstimateChange={(next) => {
          setField('estimate', next);
        }}
      />
      <RepeatTaskControl
        value={draft.repeat}
        onChange={(next) => {
          setField('repeat', next);
        }}
        today={todayIso()}
        timezone={Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'}
        disabled={creating}
      />
    </ComposerShell>
  );
});

/**
 * Mount the Task body for the shell-global creation request.
 *
 * @remarks
 * The host binds every task-specific read and write to the selected target. Completion is shared
 * with the other global composers, so changing the modal destination never rebinds the page
 * behind it or delivers destination data to an origin-page callback.
 *
 * @returns the global Task composer, or `null` while another kind is requested.
 */
export function GlobalTaskComposer(): JSX.Element | null {
  const { request, closeCreate } = useCreateObject();

  if (request?.kind !== 'task') return null;

  return <GlobalTaskComposerDialog request={request} closeCreate={closeCreate} />;
}

/** Props for the request-bound body rendered by {@link GlobalTaskComposer}. */
interface GlobalTaskComposerDialogProps {
  /** The Task-specific global creation request. */
  readonly request: CreateTaskRequest;
  /** Close the shell-global create request. */
  readonly closeCreate: () => void;
}

/** Resolve the active Task request only while the global provider has one open. */
function GlobalTaskComposerDialog({
  request,
  closeCreate,
}: GlobalTaskComposerDialogProps): JSX.Element {
  const creation = useCreationContext();
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  // The responsive seam rather than Next's router: it publishes the requested destination
  // immediately, which is what lets the shell acknowledge the click while the route payload
  // is still in flight. Navigation itself is unchanged.
  const router = useAppRouter();

  const targetWorkspaceId = creation.targetWorkspaceId;
  const initialWorkspaceId = request.initialWorkspaceId ?? null;
  const currentActorId =
    creation.members.find((member) => member.userId === session?.user.id)?.actorId ?? null;
  const destinationReady =
    initialWorkspaceId !== null &&
    targetWorkspaceId !== null &&
    creation.workspace !== null &&
    !creation.loading &&
    !creation.permissions.loading &&
    creation.loadError === null;
  // `initialWorkspaceId` is normalized by the provider when a request opens, so it is the shell
  // workspace snapshot that makes same-workspace completion meaningful even if the user retargets
  // the composer before submitting.
  const targetIsOriginalWorkspace = targetWorkspaceId === initialWorkspaceId;
  const taskOrgId = targetWorkspaceId ?? initialWorkspaceId ?? '';

  return (
    <VocabularyProvider skin={creation.vocabulary}>
      <CreateTaskDialog
        orgId={taskOrgId}
        teams={creation.teams}
        defaultTeamId={creation.defaultTeamId}
        teamsLoading={creation.loading || creation.permissions.loading}
        open
        onOpenChange={(next) => {
          if (!next) closeCreate();
        }}
        onCreated={() => undefined}
        defaultProjectId={targetIsOriginalWorkspace ? request.defaultProjectId : null}
        defaultAssigneeId={targetIsOriginalWorkspace ? request.defaultAssigneeId : null}
        defaultTemplateId={targetIsOriginalWorkspace ? request.defaultTemplateId : null}
        globalCreation={{
          targetWorkspaceId,
          initialWorkspaceId,
          ready: destinationReady,
          loadError: creation.loadError,
          canContribute: creation.permissions.canContribute,
          currentActorId,
          onCreated: async (task, references, continueCreating) => {
            const invalidationKeys: (readonly unknown[])[] = [
              queryKeys.tasks(taskOrgId),
              // `queryKeys.taskGraph` documents this raw prefix as the canonical all-scopes key.
              ['org', taskOrgId, 'task-graph'],
            ];
            if (references.projectId !== null || references.milestoneId !== null) {
              invalidationKeys.push(queryKeys.projects(taskOrgId));
            }
            if (references.cycleId !== null) {
              invalidationKeys.push(queryKeys.cycles(taskOrgId));
            }
            const invalidate = (queryKey: readonly unknown[]): void => {
              void queryClient.invalidateQueries({ queryKey });
            };
            try {
              await request.afterCreate?.(task);
            } catch (caught) {
              for (const queryKey of invalidationKeys) invalidate(queryKey);
              throw caught;
            }
            completeCreateObject({
              created: task,
              initialWorkspaceId,
              targetWorkspaceId,
              sameWorkspaceCompletion: request.sameWorkspaceCompletion,
              onCreated: request.onCreated,
              invalidationKeys,
              invalidate,
              navigationEnabled: !continueCreating,
              seed: () => {
                seedTaskRecord(queryClient, taskOrgId, task, references);
              },
              openDestination: () => {
                router.push(`/orgs/${taskOrgId}/tasks/${task.id}`);
              },
            });
          },
          onOpenCreated: (task) => {
            closeCreate();
            router.push(`/orgs/${task.organizationId}/tasks/${task.id}`);
          },
        }}
      />
    </VocabularyProvider>
  );
}
