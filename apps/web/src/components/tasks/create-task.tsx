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
import {
  ActorId,
  CycleId,
  LabelId,
  MilestoneId,
  type Priority,
  ProjectId,
  type TaskOut,
  TeamId,
  type TeamOut,
  type WorkflowState,
} from '@docket/types';
import { useVocabulary } from '@docket/ui/hooks';
import { type JSX, useCallback, useEffect, useMemo, useState } from 'react';

import { api } from '@/lib/api';
import { ComposerShell } from '@/components/composer/composer-shell';
import { ComposerTemplateControl } from '@/components/composer/template-menu';
import { templateMerge, useComposerDraft } from '@/components/composer/use-composer-draft';
import { withComposerReset } from '@/components/composer/reset-on-open';
import { workflowStateOptions } from '@/components/pickers/options';
import { useComposerOptions } from '@/components/pickers/use-composer-options';
import { templatePatch } from '@/components/templates/queries';
import { useEstimationScale } from '@/lib/use-estimation-scale';
import { userErrorMessage, readProblemError } from '@/lib/problem';

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
  defaultProjectId?: string | null;
  /** Pre-seed the assignee picker (e.g. opening from My Work's "Assigned to me" tab). */
  defaultAssigneeId?: string | null;
  /** A template to apply on open, from a `?template=` compose request. */
  defaultTemplateId?: string | null;
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
}: CreateTaskDialogProps): JSX.Element {
  const projectNoun = useVocabulary('project');
  const cycleNoun = useVocabulary('cycle');

  const options = useComposerOptions(orgId, COMPOSER_INCLUDE, open);
  const { scale: estimationScale } = useEstimationScale(orgId);
  const { draft, setField, updateDraft } = useComposerDraft<TaskDraft>({
    title: '',
    description: '',
    teamOverride: null,
    state: null,
    priority: 'none',
    assigneeId: defaultAssigneeId,
    projectId: defaultProjectId,
    milestoneId: null,
    cycleId: null,
    startDate: null,
    dueDate: null,
    labelIds: [],
    estimate: null,
  });

  const [workflowStates, setWorkflowStates] = useState<readonly WorkflowState[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const teamId = draft.teamOverride ?? defaultTeamId;
  // The breadcrumb shows the team the task will land in (its workflow + triage owner).
  const teamName = teams.find((team) => team.id === teamId)?.name;

  // Load the chosen team's workflow states, defaulting the status to its first (the create
  // default the API would pick) so the status chip is never blank.
  useEffect(() => {
    if (!open) return;
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
  }, [open, teamId, options, updateDraft]);

  // Cycles are org-wide; scope the picker to the chosen team's cadence. The label is the cycle's
  // server-derived `displayName` (its author name, else its window) — never the stored `number`,
  // which is the auto-roll idempotency key and reads as "Cycle 1000137".
  const cycleOptionsForTeam = useMemo(() => {
    return options.cycles
      .filter((cycle) => cycle.teamId === teamId)
      .map((cycle) => ({ value: cycle.id, label: cycle.displayName }));
  }, [options.cycles, teamId]);

  // A milestone always belongs to exactly one project, so the picker is scoped to whichever
  // project is currently chosen — same rule the task detail rail applies post-creation.
  const milestoneOptionsForProject = useMemo(() => {
    return options.milestones
      .filter((milestone) => milestone.projectId === draft.projectId)
      .map((milestone) => ({ value: milestone.id, label: milestone.name }));
  }, [options.milestones, draft.projectId]);

  /** Changing the project invalidates any milestone chosen under the previous one. */
  const changeProject = useCallback(
    (id: string | null): void => {
      updateDraft(() => ({ projectId: id, milestoneId: null }));
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

  const canSubmit = draft.title.trim().length > 0 && teamId !== null && !teamsLoading;

  /** Create the task with all set properties, then hand it to the parent. */
  const submit = useCallback(async (): Promise<void> => {
    const trimmed = draft.title.trim();
    if (trimmed.length === 0 || !teamId) return;
    setCreating(true);
    setError(null);
    try {
      const trimmedBody = draft.description.trim();
      const res = await api.v1.orgs[':orgId'].tasks.$post({
        param: { orgId },
        json: {
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
        },
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
      onOpenChange(false);
      onCreated(created);
    } catch (caught) {
      setError(userErrorMessage(caught, 'Something went wrong creating the task.'));
    } finally {
      setCreating(false);
    }
  }, [draft, teamId, orgId, onOpenChange, onCreated]);

  return (
    <ComposerShell
      open={open}
      onOpenChange={onOpenChange}
      heading="New task"
      context={teams.length > 1 ? teamName : undefined}
      templateSlot={
        <ComposerTemplateControl
          orgId={orgId}
          kind="task"
          open={open}
          autoApplyId={defaultTemplateId}
          onApply={(chosen) => {
            updateDraft((current) =>
              templateMerge(current, templatePatch(chosen.payload, 'task'), {
                document: 'description',
                labels: ['title'],
              }),
            );
          }}
          disabled={creating}
        />
      }
      title={draft.title}
      onTitleChange={(next) => {
        setField('title', next);
      }}
      titlePlaceholder="Task title"
      body={draft.description}
      onBodyChange={(next) => {
        setField('description', next);
      }}
      bodyPlaceholder="Add a description…"
      error={error}
      creating={creating}
      canSubmit={canSubmit}
      onSubmit={() => void submit()}
      submitLabel="Create task"
    >
      <TaskComposerPickers
        teams={teams}
        teamId={teamId}
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
        creating={creating}
        onTeamChange={(next) => {
          setField('teamOverride', next);
        }}
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
    </ComposerShell>
  );
});
