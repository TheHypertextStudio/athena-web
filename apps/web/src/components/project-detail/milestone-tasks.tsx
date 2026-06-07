'use client';

/**
 * The Tasks tab body — the project's tasks grouped into milestone sections.
 *
 * @remarks
 * Elevates the existing flat task list into milestone-scoped sections. Tasks are grouped by
 * their `milestoneId` (resolved per-task, since the list DTO omits it), with each milestone
 * rendered as a {@link ListView} top-level group labeled by the milestone name + target
 * date, and sub-grouped by canonical workflow state so the {@link StatusIcon} reads
 * correctly. Tasks with no milestone fall into an "Unscheduled" bucket so nothing is
 * dropped. Each milestone header also shows a compact done/total count. Activating a task
 * row routes to its task detail. A composer at the top adds a task; the empty state invites
 * the first one.
 */
import type { TaskOut, TeamOut } from '@docket/types';
import { type GroupKey, ListView, TaskRow, type TaskRowData } from '@docket/ui/components';
import { Button, Input } from '@docket/ui/primitives';
import type { JSX } from 'react';
import { useCallback, useMemo, useState } from 'react';

import type { ActorDirectory } from './actor-directory';
import { TeamPicker } from '@/components/teams/team-picker';
import { formatCalendarDate } from '@/lib/format-date';
import { STATE_GROUP_LABEL, STATE_GROUP_ORDER, stateTypeOf } from '@/lib/work-state';

/** A task enriched with its resolved milestone association. */
export interface MilestoneTask {
  /** The task DTO. */
  readonly task: TaskOut;
  /** The task's milestone id, or `null` when unscheduled. */
  readonly milestoneId: string | null;
}

/** The synthesized bucket id + label for tasks with no milestone. */
const UNSCHEDULED_ID = '__unscheduled__';

/** Props for {@link MilestoneTasks}. */
export interface MilestoneTasksProps {
  /** The project's tasks, each with its resolved milestone. */
  tasks: readonly MilestoneTask[];
  /** Ordered milestone metadata (id → name + target date), in display order. */
  milestones: readonly { id: string; name: string; targetDate: string | null | undefined }[];
  /** Resolve an assignee id to its display name + kind for the row avatar. */
  resolveActor: ActorDirectory;
  /** The (vocabulary-resolved) singular task noun, lowercased for inline copy. */
  taskNoun: string;
  /** Open a task's detail. */
  onOpenTask: (taskId: string) => void;
  /** Whether a task create is in flight. */
  creating: boolean;
  /** A create error to surface, if any. */
  createError: string | null;
  /** Create a task with the given title. */
  onCreate: (title: string) => void;
  /** The org's teams; a picker appears in the composer when there is more than one. */
  teams: readonly TeamOut[];
  /** The team new tasks land in (the org default or a user override). */
  teamId: string | null;
  /** Notify the parent that a different create-target team was chosen. */
  onTeamChange: (teamId: string) => void;
  /** Whether the org's teams are still loading (disables the create affordance). */
  teamsLoading: boolean;
}

/** Format an ISO date as a short day, or `null` when absent. */
function shortDate(value: string | null | undefined): string | null {
  return formatCalendarDate(value, { month: 'short', day: 'numeric' });
}

/**
 * The milestone-grouped task list.
 *
 * @param props - The {@link MilestoneTasksProps}.
 * @returns the rendered tab.
 */
export function MilestoneTasks({
  tasks,
  milestones,
  resolveActor,
  taskNoun,
  onOpenTask,
  creating,
  createError,
  onCreate,
  teams,
  teamId,
  onTeamChange,
  teamsLoading,
}: MilestoneTasksProps): JSX.Element {
  const [title, setTitle] = useState('');

  /** Milestone display order: declared milestones in `sort` order, then Unscheduled last. */
  const milestoneRank = useMemo(() => {
    const rank = new Map<string, number>();
    milestones.forEach((m, i) => rank.set(m.id, i));
    rank.set(UNSCHEDULED_ID, milestones.length);
    return rank;
  }, [milestones]);

  /** Milestone id → "Name · Mon D" label. */
  const milestoneLabel = useMemo(() => {
    const byId = new Map<string, string>();
    for (const m of milestones) {
      const date = shortDate(m.targetDate);
      byId.set(m.id, date ? `${m.name} · ${date}` : m.name);
    }
    return (id: string): string => byId.get(id) ?? 'Milestone';
  }, [milestones]);

  /** Tasks ordered by milestone, then canonical workflow state. */
  const orderedTasks = useMemo(() => {
    const milestoneOf = (t: MilestoneTask): string => t.milestoneId ?? UNSCHEDULED_ID;
    const stateRank = (t: MilestoneTask): number =>
      STATE_GROUP_ORDER.indexOf(stateTypeOf(t.task.state));
    return [...tasks].sort((a, b) => {
      const ma = milestoneRank.get(milestoneOf(a)) ?? Number.MAX_SAFE_INTEGER;
      const mb = milestoneRank.get(milestoneOf(b)) ?? Number.MAX_SAFE_INTEGER;
      if (ma !== mb) return ma - mb;
      return stateRank(a) - stateRank(b);
    });
  }, [tasks, milestoneRank]);

  /** Group a task into its milestone section (or the Unscheduled bucket). */
  const groupBy = useCallback(
    (t: MilestoneTask): GroupKey =>
      t.milestoneId
        ? { id: t.milestoneId, label: milestoneLabel(t.milestoneId) }
        : { id: UNSCHEDULED_ID, label: 'Unscheduled' },
    [milestoneLabel],
  );

  /** Sub-group a task by its canonical workflow-state type. */
  const subGroupBy = useCallback((t: MilestoneTask): GroupKey => {
    const stateType = stateTypeOf(t.task.state);
    return { id: stateType, label: STATE_GROUP_LABEL[stateType], stateType };
  }, []);

  /** Adapt an enriched task into the design-system row shape, with assignee resolved. */
  const toRowData = useCallback(
    (t: MilestoneTask): TaskRowData => {
      const assignee = t.task.assigneeId ? resolveActor(t.task.assigneeId) : null;
      return {
        id: t.task.id,
        title: t.task.title,
        stateType: stateTypeOf(t.task.state),
        assigneeName: assignee?.name ?? null,
        assigneeKind: assignee?.kind,
      };
    },
    [resolveActor],
  );

  function submit(event: React.SyntheticEvent): void {
    event.preventDefault();
    if (title.trim().length === 0) return;
    onCreate(title.trim());
    setTitle('');
  }

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={submit} className="flex flex-col gap-2">
        <div className="flex gap-2">
          <Input
            aria-label={`New ${taskNoun} title`}
            placeholder={`Add a ${taskNoun}…`}
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
            }}
          />
          <TeamPicker teams={teams} value={teamId} onChange={onTeamChange} disabled={creating} />
          <Button
            type="submit"
            disabled={creating || teamsLoading || teamId === null || title.trim().length === 0}
          >
            {creating ? 'Adding…' : `Add ${taskNoun}`}
          </Button>
        </div>
        {createError ? (
          <p role="alert" className="text-destructive text-sm">
            {createError}
          </p>
        ) : null}
      </form>

      <div className="border-border h-[calc(100vh-24rem)] min-h-80 overflow-hidden rounded-xl border">
        {tasks.length === 0 ? (
          <div className="text-muted-foreground p-8 text-center text-sm">
            No {taskNoun}s yet — add the first one above.
          </div>
        ) : (
          <ListView
            items={orderedTasks}
            label="Project tasks by milestone"
            getItemKey={(t) => t.task.id}
            groupBy={groupBy}
            subGroupBy={subGroupBy}
            renderRow={(t, ctx) => (
              <TaskRow task={toRowData(t)} active={ctx.active} onActivate={ctx.onActivate} />
            )}
            onActivateItem={(t) => {
              onOpenTask(t.task.id);
            }}
          />
        )}
      </div>
    </div>
  );
}
