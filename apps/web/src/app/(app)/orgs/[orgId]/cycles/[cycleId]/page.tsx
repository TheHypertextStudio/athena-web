'use client';

/**
 * The Cycle detail view (product §8.5).
 *
 * @remarks
 * A Client Component reached at `/orgs/[orgId]/cycles/[cycleId]`. It is a committed-task
 * **list** topped by a collapsible **stats banner**, the cycle's "are we on pace?" header:
 *
 * - **Banner** — the {@link StatsBanner}, fed by the burn-up report (`…/cycles/:id/burnup`):
 *   a planned-vs-completed burn-up line over the window, capacity, scope creep, and carryover,
 *   plus the window runway. It collapses to a dense summary strip so the list can take the
 *   height.
 * - **List** — the cycle's committed tasks (`…/cycles/:id/tasks`) in the design-system
 *   {@link ListView}, grouped by {@link useVocabulary | project} or {@link useVocabulary | program}
 *   (toggled by a styled {@link GroupByMenu}) and sub-grouped by canonical workflow state so
 *   the {@link StatusIcon} reads correctly. Rows open the task detail.
 * - **Close flow** — "Close {cycle}" opens the {@link CloseCycleDialog}, which reviews every
 *   still-open task (keep / move-to-next / return-to-triage) *before* it rolls, then
 *   `POST …/cycles/:id/close`. An already-completed cycle shows its final stats read-only.
 *
 * Group labels resolve project/program names from the org's lists; assignee avatars resolve
 * through the members/agents directory. Data is fetched at runtime, so the production build
 * needs no running server.
 */
import {
  type CycleBurnupOut,
  type CycleCarryoverAction,
  type CycleDetail,
  CycleId,
  type CycleOut,
  type CycleTaskGroupBy,
  type ProgramOut,
  type ProjectOut,
  TaskId,
  type TaskOut,
} from '@docket/types';
import { type GroupKey, ListView, TaskRow, type TaskRowData } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { Badge, Button, Skeleton } from '@docket/ui/primitives';
import { useParams, useRouter } from 'next/navigation';
import { type JSX, useCallback, useEffect, useMemo, useState } from 'react';

import { buildActorDirectory, type ActorDirectory } from '@/components/agents/actor-directory';
import { CloseCycleDialog } from '@/components/cycles/close-cycle-dialog';
import { type CarryoverItem, type CarryoverTarget } from '@/components/cycles/carryover-row';
import { STATUS_LABEL, statusBadgeVariant } from '@/components/cycles/cycle-status';
import { formatWindow, windowProgress } from '@/components/cycles/format-window';
import { GroupByMenu } from '@/components/cycles/group-by-menu';
import { StatsBanner } from '@/components/cycles/stats-banner';
import { api } from '@/lib/api';
import { readError, readProblem } from '@/lib/problem';
import { STATE_GROUP_LABEL, STATE_GROUP_ORDER, stateTypeOf } from '@/lib/work-state';

/**
 * The cycle detail page.
 */
export default function CycleDetailPage(): JSX.Element {
  const router = useRouter();
  const params = useParams<{ orgId: string; cycleId: string }>();
  const { orgId, cycleId } = params;

  const cycleNoun = useVocabulary('cycle');
  const cycleNounLower = cycleNoun.toLowerCase();
  const projectNoun = useVocabulary('project');
  const programNoun = useVocabulary('program');

  const [cycle, setCycle] = useState<CycleDetail | null>(null);
  const [burnup, setBurnup] = useState<CycleBurnupOut | null>(null);
  const [tasks, setTasks] = useState<readonly TaskOut[]>([]);
  const [projectName, setProjectName] = useState<ReadonlyMap<string, string>>(new Map());
  const [programName, setProgramName] = useState<ReadonlyMap<string, string>>(new Map());
  const [otherCycles, setOtherCycles] = useState<readonly CycleOut[]>([]);
  const [resolveActor, setResolveActor] = useState<ActorDirectory['resolve']>(() => () => ({
    name: 'Someone',
    kind: 'human' as const,
  }));

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [groupBy, setGroupBy] = useState<CycleTaskGroupBy>('project');
  const [bannerExpanded, setBannerExpanded] = useState(true);

  // Close-cycle flow state.
  const [dialogOpen, setDialogOpen] = useState(false);
  const [decisions, setDecisions] = useState<readonly CarryoverItem[]>([]);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  /** Load the cycle, its burn-up, its committed tasks, and the naming directories. */
  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [
        cycleRes,
        burnupRes,
        tasksRes,
        projectsRes,
        programsRes,
        membersRes,
        agentsRes,
        cyclesRes,
      ] = await Promise.all([
        api.v1.orgs[':orgId'].cycles[':id'].$get({ param: { orgId, id: cycleId } }),
        api.v1.orgs[':orgId'].cycles[':id'].burnup.$get({ param: { orgId, id: cycleId } }),
        api.v1.orgs[':orgId'].cycles[':id'].tasks.$get({
          param: { orgId, id: cycleId },
          query: {},
        }),
        api.v1.orgs[':orgId'].projects.$get({ param: { orgId } }),
        api.v1.orgs[':orgId'].programs.$get({ param: { orgId } }),
        api.v1.orgs[':orgId'].members.$get({ param: { orgId } }),
        api.v1.orgs[':orgId'].agents.$get({ param: { orgId } }),
        api.v1.orgs[':orgId'].cycles.$get({ param: { orgId } }),
      ]);

      if (!cycleRes.ok) {
        setError(await readProblem(cycleRes, `Could not load this ${cycleNounLower}.`));
        return;
      }
      const detail = await cycleRes.json();
      setCycle(detail);

      if (burnupRes.ok) setBurnup(await burnupRes.json());

      // The grouped read carries the cycle's committed tasks; flatten both axes' groups into a
      // single task list and let the ListView re-group client-side as the axis toggles.
      if (tasksRes.ok) {
        const { groups } = await tasksRes.json();
        setTasks(groups.flatMap((group) => group.tasks));
      }

      const projects: readonly ProjectOut[] = projectsRes.ok
        ? (await projectsRes.json()).items
        : [];
      setProjectName(new Map(projects.map((p) => [p.id, p.name])));
      const programs: readonly ProgramOut[] = programsRes.ok
        ? (await programsRes.json()).items
        : [];
      setProgramName(new Map(programs.map((p) => [p.id, p.name])));

      const members = membersRes.ok ? (await membersRes.json()).items : [];
      const agents = agentsRes.ok ? (await agentsRes.json()).items : [];
      const directory = buildActorDirectory(members, agents);
      setResolveActor(() => directory.resolve);

      // Other cycles on the SAME team are the only valid "move to" targets at close (cycles are
      // team-scoped), and only open ones make sense to roll into.
      if (cyclesRes.ok) {
        const { items } = await cyclesRes.json();
        setOtherCycles(
          items.filter(
            (c) => c.id !== cycleId && c.teamId === detail.teamId && c.status !== 'completed',
          ),
        );
      }
    } catch (caught) {
      setError(readError(caught, `Something went wrong loading this ${cycleNounLower}.`));
    } finally {
      setLoading(false);
    }
  }, [orgId, cycleId, cycleNounLower]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Adapt a task DTO to the design-system task-row view-model (state glyph + assignee). */
  const toRow = useCallback(
    (task: TaskOut): TaskRowData => {
      const actor = task.assigneeId ? resolveActor(task.assigneeId) : null;
      return {
        id: task.id,
        title: task.title,
        stateType: stateTypeOf(task.state),
        assigneeName: actor?.name ?? null,
        assigneeKind: actor?.kind ?? 'human',
        assigneeAvatarUrl: actor?.avatarUrl,
      };
    },
    [resolveActor],
  );

  /** Group a task by the active axis (project or program), or the synthesized no-group bucket. */
  const groupForTask = useCallback(
    (task: TaskOut): GroupKey | null => {
      if (groupBy === 'project') {
        return task.projectId
          ? { id: task.projectId, label: projectName.get(task.projectId) ?? projectNoun }
          : null;
      }
      return task.programId
        ? { id: task.programId, label: programName.get(task.programId) ?? programNoun }
        : null;
    },
    [groupBy, projectName, programName, projectNoun, programNoun],
  );

  /** Sub-group a task by its canonical workflow-state type (for the state status header). */
  const subGroupForTask = useCallback((task: TaskOut): GroupKey => {
    const stateType = stateTypeOf(task.state);
    return { id: stateType, label: STATE_GROUP_LABEL[stateType], stateType };
  }, []);

  /** The committed tasks ordered by canonical workflow state (so the list reads progress-down). */
  const orderedTasks = useMemo(() => {
    const rank = (task: TaskOut): number => STATE_GROUP_ORDER.indexOf(stateTypeOf(task.state));
    return [...tasks].sort((a, b) => rank(a) - rank(b));
  }, [tasks]);

  /** The still-incomplete committed tasks — the ones a close must review. */
  const incompleteTasks = useMemo(
    () => tasks.filter((task) => stateTypeOf(task.state) !== 'completed'),
    [tasks],
  );

  /** The valid "move to" targets at close: open cycles on the same team, window-labeled. */
  const moveTargets = useMemo<readonly CarryoverTarget[]>(
    () =>
      otherCycles.map((c) => ({
        id: c.id,
        label: `${c.name ?? `${cycleNoun} ${String(c.number)}`} · ${formatWindow(c.startsAt, c.endsAt)}`,
      })),
    [otherCycles, cycleNoun],
  );

  /** Open the close dialog, seeding one decision per incomplete task. */
  const openCloseDialog = useCallback(() => {
    // Default to "move to next" when a target exists (the common roll-forward), else "keep".
    const defaultTarget = moveTargets[0]?.id ?? null;
    const defaultAction: CycleCarryoverAction = defaultTarget ? 'move' : 'keep';
    setDecisions(
      incompleteTasks.map((task) => ({
        taskId: task.id,
        title: task.title,
        stateType: stateTypeOf(task.state),
        action: defaultAction,
        targetCycleId: defaultAction === 'move' ? defaultTarget : null,
      })),
    );
    setCloseError(null);
    setDialogOpen(true);
  }, [incompleteTasks, moveTargets]);

  /** Update one task's chosen carryover action (clearing the target unless still moving). */
  const onActionChange = useCallback(
    (taskId: string, action: CycleCarryoverAction) => {
      setDecisions((current) =>
        current.map((item) =>
          item.taskId === taskId
            ? {
                ...item,
                action,
                targetCycleId:
                  action === 'move' ? (item.targetCycleId ?? moveTargets[0]?.id ?? null) : null,
              }
            : item,
        ),
      );
    },
    [moveTargets],
  );

  /** Update one task's chosen destination cycle. */
  const onTargetChange = useCallback((taskId: string, targetCycleId: string) => {
    setDecisions((current) =>
      current.map((item) => (item.taskId === taskId ? { ...item, targetCycleId } : item)),
    );
  }, []);

  /** Submit the reviewed carryover decisions, then reload the (now-closed) cycle. */
  const confirmClose = useCallback(async (): Promise<void> => {
    setClosing(true);
    setCloseError(null);
    try {
      const res = await api.v1.orgs[':orgId'].cycles[':id'].close.$post({
        param: { orgId, id: cycleId },
        json: {
          carryover: decisions.map((item) => ({
            taskId: TaskId.parse(item.taskId),
            action: item.action,
            ...(item.action === 'move' && item.targetCycleId
              ? { targetCycleId: CycleId.parse(item.targetCycleId) }
              : {}),
          })),
        },
      });
      if (!res.ok) {
        setCloseError(await readProblem(res, `Could not close this ${cycleNounLower}.`));
        return;
      }
      setDialogOpen(false);
      await load();
    } catch (caught) {
      setCloseError(readError(caught, `Something went wrong closing this ${cycleNounLower}.`));
    } finally {
      setClosing(false);
    }
  }, [orgId, cycleId, decisions, cycleNounLower, load]);

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 @2xl:p-6 @4xl:p-8">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-44 w-full rounded-xl" />
        <Skeleton className="h-10 w-48" />
        <div className="border-outline-variant flex flex-col gap-2 rounded-xl border p-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto w-full max-w-6xl p-4 @2xl:p-6 @4xl:p-8">
        <p
          role="alert"
          className="border-outline-variant text-destructive rounded-xl border p-4 text-sm"
        >
          {error}
        </p>
      </div>
    );
  }

  if (!cycle) {
    return (
      <div className="mx-auto w-full max-w-6xl p-4 @2xl:p-6 @4xl:p-8">
        <p className="border-outline-variant text-on-surface-variant rounded-xl border border-dashed p-8 text-center text-sm">
          This {cycleNounLower} could not be found.
        </p>
      </div>
    );
  }

  const title = cycle.name ?? `${cycleNoun} ${String(cycle.number)}`;
  const win = windowProgress(cycle.startsAt, cycle.endsAt);
  const isCompleted = cycle.status === 'completed';

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-6 p-4 @2xl:p-6 @4xl:p-8">
      <header className="flex flex-col gap-3 @2xl:flex-row @2xl:flex-wrap @2xl:items-center @2xl:justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-on-surface text-xl font-semibold tracking-tight">{title}</h1>
            {cycle.name ? (
              <span className="text-on-surface-variant text-xs tabular-nums">
                {cycleNoun} {cycle.number}
              </span>
            ) : null}
            <Badge variant={statusBadgeVariant(cycle.status)}>{STATUS_LABEL[cycle.status]}</Badge>
          </div>
          <p className="text-on-surface-variant text-xs">
            {formatWindow(cycle.startsAt, cycle.endsAt)}
          </p>
        </div>

        {!isCompleted ? (
          <Button variant="outline" size="sm" onClick={openCloseDialog}>
            Close {cycleNounLower}
          </Button>
        ) : null}
      </header>

      {burnup ? (
        <StatsBanner
          burnup={burnup}
          window={win}
          expanded={bannerExpanded}
          onToggleExpanded={() => {
            setBannerExpanded((open) => !open);
          }}
          cycleNoun={cycleNounLower}
        />
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <GroupByMenu
          value={groupBy}
          onChange={setGroupBy}
          projectNoun={projectNoun}
          programNoun={programNoun}
        />
        <p className="text-on-surface-variant text-xs tabular-nums">
          {orderedTasks.length} {orderedTasks.length === 1 ? 'task' : 'tasks'}
        </p>
      </div>

      <section
        aria-label={`${cycleNounLower} tasks`}
        className="border-outline-variant min-h-[16rem] flex-1 overflow-hidden rounded-xl border"
      >
        {orderedTasks.length === 0 ? (
          <p className="text-on-surface-variant p-8 text-center text-sm">
            Nothing is committed to this {cycleNounLower} yet.
          </p>
        ) : (
          <ListView
            items={orderedTasks}
            label={`${title} tasks`}
            getItemKey={(task) => task.id}
            groupBy={groupForTask}
            subGroupBy={subGroupForTask}
            rowHeight={40}
            renderRow={(task, ctx) => (
              <TaskRow task={toRow(task)} active={ctx.active} onActivate={ctx.onActivate} />
            )}
            onActivateItem={(task) => {
              router.push(`/orgs/${orgId}/tasks/${task.id}`);
            }}
          />
        )}
      </section>

      <CloseCycleDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        cycleName={title}
        cycleNoun={cycleNounLower}
        items={decisions}
        targets={moveTargets}
        closing={closing}
        closeError={closeError}
        onActionChange={onActionChange}
        onTargetChange={onTargetChange}
        onConfirm={() => {
          void confirmClose();
        }}
      />
    </div>
  );
}
