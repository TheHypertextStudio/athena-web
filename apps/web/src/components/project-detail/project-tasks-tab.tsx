'use client';

/**
 * The project Tasks tab: one set of tasks, shown as a milestone list or as the dependency graph.
 *
 * @remarks
 * The list and the graph are two lenses on the same tasks (docs/core/mvp-plan.md §8.4), so the tab
 * renders exactly one of them at a time behind a segmented choice. Rendering both stacked showed
 * every task twice.
 *
 * Assignees resolve through the org roster, read only while this tab is open. The list used to
 * pass a resolver that answered `Unknown` for every id, which is how a task assigned to the
 * signed-in person rendered as `Unknown` with a `UN` avatar.
 */
import type { TaskOut } from '@docket/work/task-model';
import { Tabs } from '@docket/ui/primitives';
import { type JSX, useCallback, useState } from 'react';

import TaskGraphPanel from '@/components/canvas/task-graph-panel';
import { PartialLoadBanner } from '@/components/feedback';
import { RESOLVING_LABEL } from '@/components/views/field-catalog';
import { api } from '@/lib/api';
import { useAppRouter } from '@/lib/interactions/navigation';
import { apiQueryOptions, queryKeys, useApiQuery } from '@/lib/query';
import { orgMembersDef } from '@/lib/use-org-membership';

import type { ActorDirectory, ActorInfo } from './actor-directory';
import { type MilestoneTask, MilestoneTasks } from './milestone-tasks';

/** The two lenses the Tasks tab offers. */
export type ProjectTasksLens = 'task-list' | 'task-graph';

/** A milestone as the Tasks tab needs it. */
export interface ProjectTasksMilestone {
  /** Milestone id. */
  readonly id: string;
  /** Milestone name. */
  readonly name: string;
  /** Target date, when set. */
  readonly targetDate: string | null;
}

/** A failed read of the project's work, as the tab reports it. */
export interface ProjectWorkFailure {
  /** Application-owned banner title naming what did not load. */
  readonly title: string;
  /** Re-issue the work read. */
  readonly onRetry: () => void;
}

/** Props for {@link ProjectTasksTab}. */
export interface ProjectTasksTabProps {
  /** The owning org. */
  readonly orgId: string;
  /** The project whose tasks are shown. */
  readonly projectId: string;
  /** The project's tasks with their milestone. */
  readonly tasks: readonly MilestoneTask[];
  /** The project's milestones, in display order. */
  readonly milestones: readonly ProjectTasksMilestone[];
  /** The project's failed work read — its banner title and retry — or `null` when it loaded. */
  readonly workFailure: ProjectWorkFailure | null;
  /** Pending proposal sentences keyed by task id. */
  readonly proposedByTaskId?: ReadonlyMap<string, string> | undefined;
  /** Task ids to tint with the hover-highlight tone. */
  readonly highlightedIds?: ReadonlySet<string> | undefined;
  /** Open a task's record. */
  readonly onOpenTask: (task: TaskOut) => void;
}

/** A member row as the directory reads it. */
interface DirectoryMember {
  readonly actorId: string;
  readonly displayName: string;
}

/** An agent row as the directory reads it. */
interface DirectoryAgent {
  readonly actorId: string;
}

/** What {@link resolveProjectActor} needs to answer. */
export interface ProjectActorDirectoryInput {
  /** Loaded members, or `undefined` while the roster is pending. */
  readonly members: readonly DirectoryMember[] | undefined;
  /** Loaded agents, or `undefined` while the agent list is pending. */
  readonly agents: readonly DirectoryAgent[] | undefined;
}

/**
 * Resolve an actor id against the org roster.
 *
 * @param input - The loaded members and agents.
 * @param actorId - The actor to resolve.
 * @returns The member's name, `Agent` for an agent, a loading label while the roster is pending, or
 *   a short-id fallback for an actor the roster does not contain.
 */
export function resolveProjectActor(
  input: ProjectActorDirectoryInput,
  actorId: string | null | undefined,
): ActorInfo {
  if (!actorId) return { name: 'Unassigned', kind: 'human' };
  const member = input.members?.find((row) => row.actorId === actorId);
  if (member) return { name: member.displayName, kind: 'human' };
  if (input.agents?.some((row) => row.actorId === actorId)) return { name: 'Agent', kind: 'agent' };
  if (input.members === undefined || input.agents === undefined) {
    return { name: RESOLVING_LABEL, kind: 'human' };
  }
  return { name: `Member ${actorId.slice(0, 6)}`, kind: 'human' };
}

/**
 * Read the org roster and return a resolver for task assignees.
 *
 * @param orgId - The org whose roster to read.
 * @returns A resolver from actor id to display name and kind.
 */
function useProjectActorDirectory(orgId: string): ActorDirectory {
  const membersQ = useApiQuery(orgMembersDef(orgId));
  const agentsQ = useApiQuery(
    apiQueryOptions(
      queryKeys.agents(orgId),
      () => api.v1.orgs[':orgId'].agents.$get({ param: { orgId } }),
      'Could not load agents.',
    ),
  );
  const members = membersQ.data?.items;
  const agents = agentsQ.data?.items;
  return useCallback(
    (actorId: string | null | undefined) => resolveProjectActor({ members, agents }, actorId),
    [members, agents],
  );
}

const LENS_ITEMS = [
  { value: 'task-list', label: 'List' },
  { value: 'task-graph', label: 'Graph' },
] as const;

/**
 * The project Tasks tab body.
 *
 * @param props - See {@link ProjectTasksTabProps}.
 * @returns The tab panel with its lens choice and the selected lens.
 */
export function ProjectTasksTab({
  orgId,
  projectId,
  tasks,
  milestones,
  workFailure,
  proposedByTaskId,
  highlightedIds,
  onOpenTask,
}: ProjectTasksTabProps): JSX.Element {
  const router = useAppRouter();
  const [lens, setLens] = useState<ProjectTasksLens>('task-list');
  const resolveActor = useProjectActorDirectory(orgId);

  return (
    <section
      role="tabpanel"
      id="tabpanel-tasks"
      aria-labelledby="tab-tasks"
      className="flex flex-col gap-3"
    >
      {workFailure ? (
        <PartialLoadBanner title={workFailure.title} onRetry={workFailure.onRetry} />
      ) : null}
      <Tabs
        label="Task layout"
        value={lens}
        onValueChange={(value) => {
          setLens(value === 'task-graph' ? 'task-graph' : 'task-list');
        }}
        items={LENS_ITEMS}
        className="self-start"
      />
      {lens === 'task-list' ? (
        <div role="tabpanel" id="tabpanel-task-list" aria-labelledby="tab-task-list">
          <MilestoneTasks
            orgId={orgId}
            tasks={tasks}
            milestones={milestones}
            resolveActor={resolveActor}
            taskNoun="task"
            onOpenTask={onOpenTask}
            onCreate={() => {
              router.push(`/orgs/${orgId}/tasks?projectId=${projectId}`);
            }}
            onQuickAdd={async () => undefined}
            onRename={() => undefined}
            canEdit={false}
            proposedByTaskId={proposedByTaskId}
            highlightedIds={highlightedIds}
          />
        </div>
      ) : (
        <div
          role="tabpanel"
          id="tabpanel-task-graph"
          aria-labelledby="tab-task-graph"
          className="bg-surface-container h-[32rem] overflow-hidden rounded-xl"
        >
          <TaskGraphPanel
            scope={{ orgId, projectId }}
            density="compact"
            onExpand={() => {
              router.push(`/orgs/${orgId}/graph?projectId=${projectId}`);
            }}
          />
        </div>
      )}
    </section>
  );
}
