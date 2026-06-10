'use client';

/**
 * The Tasks tab body — the project's tasks grouped into milestone sections.
 *
 * @remarks
 * Renders the project's tasks through the shared, aligned-column {@link TaskTable} — the same
 * surface a cycle's tasks and an entity roster use — so every task list in the app reads
 * identically: a leading status glyph, a flexing title, then aligned assignee / due-date /
 * estimate columns under a light header. Tasks are grouped by their `milestoneId` (resolved
 * per-task, since the list DTO omits it) into full-width milestone sections labeled by the
 * milestone name + target date, and within each section ordered by canonical workflow state so
 * the list still reads progress-down. Tasks with no milestone fall into an "Unscheduled" bucket
 * so nothing is dropped. Each milestone header shows a compact row count. Activating a task row
 * routes to its task detail. A composer at the top adds a task; the empty state invites the first
 * one.
 */
import type { TaskOut, TeamOut } from '@docket/types';
import { type EntityTableGroup } from '@docket/ui/components';
import { Button, Input } from '@docket/ui/primitives';
import type { JSX } from 'react';
import { useMemo, useState } from 'react';

import type { ActorDirectory } from './actor-directory';
import { TeamPicker } from '@/components/teams/team-picker';
import { buildTaskCatalog } from '@/components/views/task-catalog';
import { buildTaskColumns, TaskTable } from '@/components/views/task-table';
import { formatCalendarDate } from '@/lib/format-date';
import { STATE_GROUP_ORDER, stateTypeOf } from '@/lib/work-state';

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
  /** The org id, for building the per-row task-detail link target. */
  orgId: string;
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
  orgId,
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

  /** The shared aligned-column spec, derived from the task catalog (labels stay consistent). */
  const columns = useMemo(() => {
    const catalog = buildTaskCatalog({
      projectLabel: 'Project',
      programLabel: 'Program',
      resolveProject: (id) => id,
      resolveProgram: (id) => id,
      resolveAssignee: (id) => resolveActor(id).name,
      assigneeOptions: () => [],
      projectOptions: () => [],
      programOptions: () => [],
    });
    return buildTaskColumns({ catalog, resolveActor: (id) => resolveActor(id) });
  }, [resolveActor]);

  /** Tasks bucketed into milestone sections, ordered by milestone then canonical workflow state. */
  const groups = useMemo<EntityTableGroup<TaskOut>[]>(() => {
    const milestoneOf = (t: MilestoneTask): string => t.milestoneId ?? UNSCHEDULED_ID;
    const stateRank = (t: MilestoneTask): number =>
      STATE_GROUP_ORDER.indexOf(stateTypeOf(t.task.state));
    const ordered = [...tasks].sort((a, b) => {
      const ma = milestoneRank.get(milestoneOf(a)) ?? Number.MAX_SAFE_INTEGER;
      const mb = milestoneRank.get(milestoneOf(b)) ?? Number.MAX_SAFE_INTEGER;
      if (ma !== mb) return ma - mb;
      return stateRank(a) - stateRank(b);
    });

    // Bucket the (already milestone-then-state ordered) tasks into milestone sections, in the
    // order their milestone is first encountered (which is the milestone display order above).
    const byId = new Map<string, TaskOut[]>();
    const order: string[] = [];
    for (const entry of ordered) {
      const id = milestoneOf(entry);
      let bucket = byId.get(id);
      if (!bucket) {
        bucket = [];
        byId.set(id, bucket);
        order.push(id);
      }
      bucket.push(entry.task);
    }
    return order.map((id) => ({
      id,
      label: id === UNSCHEDULED_ID ? 'Unscheduled' : milestoneLabel(id),
      rows: byId.get(id) ?? [],
    }));
  }, [tasks, milestoneRank, milestoneLabel]);

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
          <p role="alert" className="text-destructive text-body">
            {createError}
          </p>
        ) : null}
      </form>

      {tasks.length === 0 ? (
        <div className="border-outline-variant text-on-surface-variant text-body rounded-xl border border-dashed p-8 text-center">
          No {taskNoun}s yet — add the first one above.
        </div>
      ) : (
        <TaskTable
          label="Project tasks by milestone"
          columns={columns}
          groups={groups}
          taskHref={(task) => `/orgs/${orgId}/tasks/${task.id}`}
          onOpenTask={(task) => {
            onOpenTask(task.id);
          }}
        />
      )}
    </div>
  );
}
