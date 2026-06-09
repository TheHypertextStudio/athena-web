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
 * - **List** — the cycle's committed tasks (`…/cycles/:id/tasks`) in the shared, aligned-column
 *   {@link TaskTable} (the same surface every task list uses): a leading status glyph, a flexing
 *   title, then aligned assignee / due-date / estimate columns under a light header. The tasks are
 *   grouped by {@link useVocabulary | project} or {@link useVocabulary | program} (toggled by a
 *   styled {@link GroupByMenu}) into full-width sections, ordered within each section by canonical
 *   workflow state so the list reads progress-down. Rows open the task detail.
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
  type CycleStatus,
  type CycleTaskGroupBy,
  type MemberOut,
  type ProgramOut,
  type ProjectOut,
  type RoleOut,
  TaskId,
  type TaskOut,
} from '@docket/types';
import { type EntityTableGroup } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { Badge, Button, Skeleton } from '@docket/ui/primitives';
import { useParams, useRouter } from 'next/navigation';
import { type JSX, useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { buildActorDirectory, type ActorDirectory } from '@/components/agents/actor-directory';
import { CloseCycleDialog } from '@/components/cycles/close-cycle-dialog';
import { type CarryoverItem, type CarryoverTarget } from '@/components/cycles/carryover-row';
import { CyclePropertiesPanel } from '@/components/cycles/properties-panel';
import { STATUS_LABEL, statusBadgeVariant } from '@/components/cycles/cycle-status';
import { formatWindow, windowProgress } from '@/components/cycles/format-window';
import { GroupByMenu } from '@/components/cycles/group-by-menu';
import { StatsBanner } from '@/components/cycles/stats-banner';
import { buildTaskCatalog } from '@/components/views/task-catalog';
import { buildTaskColumns, TaskTable } from '@/components/views/task-table';
import { api } from '@/lib/api';
import { type RpcResponse, queryKeys, unwrap, useApiMutation, useApiQuery } from '@/lib/query';
import { useOrgCapability } from '@/lib/use-org-capability';
import { STATE_GROUP_ORDER, stateTypeOf } from '@/lib/work-state';

/** A stable empty name map, used as the default before the detail lands. */
const EMPTY_NAME_MAP: ReadonlyMap<string, string> = new Map();

/** The composite cycle-detail payload assembled from the typed RPC surface. */
interface CycleDetailData {
  readonly cycle: CycleDetail;
  readonly burnup: CycleBurnupOut | null;
  readonly tasks: readonly TaskOut[];
  readonly projectName: ReadonlyMap<string, string>;
  readonly programName: ReadonlyMap<string, string>;
  /** Open cycles on the same team — the only valid "move to" targets at close. */
  readonly otherCycles: readonly CycleOut[];
  readonly members: readonly MemberOut[];
  readonly roles: readonly RoleOut[];
  readonly resolveActor: ActorDirectory['resolve'];
}

/**
 * Build the composite cycle-detail fetcher, returning a {@link RpcResponse}-shaped result so it can
 * drive {@link useApiQuery} directly.
 *
 * @remarks
 * Composes the cycle, its burn-up, its committed tasks, the naming directories (projects/programs/
 * members/agents), and the sibling cycles in parallel. The composite resolves `ok`/`status` from
 * the gating cycle read; sub-reads degrade to benign defaults.
 */
function fetchCycleDetail(
  orgId: string,
  cycleId: string,
): () => Promise<RpcResponse<CycleDetailData>> {
  return async () => {
    const [
      cycleRes,
      burnupRes,
      tasksRes,
      projectsRes,
      programsRes,
      membersRes,
      agentsRes,
      cyclesRes,
      rolesRes,
    ] = await Promise.all([
      api.v1.orgs[':orgId'].cycles[':id'].$get({ param: { orgId, id: cycleId } }),
      api.v1.orgs[':orgId'].cycles[':id'].burnup.$get({ param: { orgId, id: cycleId } }),
      api.v1.orgs[':orgId'].cycles[':id'].tasks.$get({ param: { orgId, id: cycleId }, query: {} }),
      api.v1.orgs[':orgId'].projects.$get({ param: { orgId } }),
      api.v1.orgs[':orgId'].programs.$get({ param: { orgId } }),
      api.v1.orgs[':orgId'].members.$get({ param: { orgId } }),
      api.v1.orgs[':orgId'].agents.$get({ param: { orgId } }),
      api.v1.orgs[':orgId'].cycles.$get({ param: { orgId } }),
      api.v1.orgs[':orgId'].roles.$get({ param: { orgId } }),
    ]);

    if (!cycleRes.ok) {
      return {
        ok: false,
        status: cycleRes.status,
        json: () => cycleRes.json() as unknown as Promise<CycleDetailData>,
      };
    }
    const cycle = await cycleRes.json();
    const burnup = burnupRes.ok ? await burnupRes.json() : null;

    // The grouped read carries the cycle's committed tasks; flatten both axes' groups into a single
    // task list and let the task table re-group client-side as the axis toggles.
    const tasks: readonly TaskOut[] = tasksRes.ok
      ? (await tasksRes.json()).groups.flatMap((group) => group.tasks)
      : [];

    const projects: readonly ProjectOut[] = projectsRes.ok ? (await projectsRes.json()).items : [];
    const programs: readonly ProgramOut[] = programsRes.ok ? (await programsRes.json()).items : [];
    const memberItems = membersRes.ok ? (await membersRes.json()).items : [];
    const agents = agentsRes.ok ? (await agentsRes.json()).items : [];
    const directory = buildActorDirectory(memberItems, agents);
    const roles = rolesRes.ok ? (await rolesRes.json()).items : [];

    // Other cycles on the SAME team are the only valid "move to" targets at close (cycles are
    // team-scoped), and only open ones make sense to roll into.
    const allCycles: readonly CycleOut[] = cyclesRes.ok ? (await cyclesRes.json()).items : [];
    const otherCycles = allCycles.filter(
      (c) => c.id !== cycleId && c.teamId === cycle.teamId && c.status !== 'completed',
    );

    const data: CycleDetailData = {
      cycle,
      burnup,
      tasks,
      projectName: new Map(projects.map((p) => [p.id, p.name])),
      programName: new Map(programs.map((p) => [p.id, p.name])),
      otherCycles,
      members: memberItems,
      roles,
      resolveActor: directory.resolve,
    };
    return { ok: true, status: cycleRes.status, json: () => Promise.resolve(data) };
  };
}

/**
 * The cycle detail page.
 */
export default function CycleDetailPage(): JSX.Element {
  const router = useRouter();
  const params = useParams<{ orgId: string; cycleId: string }>();
  const { orgId, cycleId } = params;
  const queryClient = useQueryClient();

  const cycleNoun = useVocabulary('cycle');
  const cycleNounLower = cycleNoun.toLowerCase();
  const projectNoun = useVocabulary('project');
  const programNoun = useVocabulary('program');

  const detailKey = queryKeys.cycle(orgId, cycleId);

  const detailQ = useApiQuery(
    detailKey,
    fetchCycleDetail(orgId, cycleId),
    `Could not load this ${cycleNounLower}.`,
  );
  const data = detailQ.data ?? null;
  const cycle = data?.cycle ?? null;
  const burnup = data?.burnup ?? null;
  const tasks = useMemo(() => data?.tasks ?? [], [data]);
  const projectName = data?.projectName ?? EMPTY_NAME_MAP;
  const programName = data?.programName ?? EMPTY_NAME_MAP;
  const otherCycles = useMemo(() => data?.otherCycles ?? [], [data]);
  const members = data?.members ?? [];
  const roles = data?.roles ?? [];
  const resolveActor = useMemo<ActorDirectory['resolve']>(
    () => data?.resolveActor ?? (() => ({ name: 'Someone', kind: 'human' as const })),
    [data],
  );

  const loading = detailQ.isPending;
  const error = detailQ.isError ? detailQ.error.message : null;

  const [groupBy, setGroupBy] = useState<CycleTaskGroupBy>('project');
  const [bannerExpanded, setBannerExpanded] = useState(true);

  // Close-cycle flow state.
  const [dialogOpen, setDialogOpen] = useState(false);
  const [decisions, setDecisions] = useState<readonly CarryoverItem[]>([]);
  const [closeError, setCloseError] = useState<string | null>(null);

  /** The shared aligned-column spec, derived from the task catalog (labels stay consistent). */
  const columns = useMemo(() => {
    const catalog = buildTaskCatalog({
      projectLabel: projectNoun,
      programLabel: programNoun,
      resolveProject: (id) => projectName.get(id) ?? id,
      resolveProgram: (id) => programName.get(id) ?? id,
      resolveAssignee: (id) => resolveActor(id).name,
      assigneeOptions: () => [],
      projectOptions: () => [],
      programOptions: () => [],
    });
    return buildTaskColumns({ catalog, resolveActor: (id) => resolveActor(id) });
  }, [projectNoun, programNoun, projectName, programName, resolveActor]);

  /** The committed tasks ordered by canonical workflow state (so the list reads progress-down). */
  const orderedTasks = useMemo(() => {
    const rank = (task: TaskOut): number => STATE_GROUP_ORDER.indexOf(stateTypeOf(task.state));
    return [...tasks].sort((a, b) => rank(a) - rank(b));
  }, [tasks]);

  /**
   * The committed tasks bucketed under the active grouping axis (project or program) — full-width
   * group sections spanning every column — with each bucket's tasks in canonical workflow-state
   * order. Tasks with no value for the axis fall into a synthesized "No {axis}" bucket, last.
   */
  const taskGroups = useMemo<EntityTableGroup<TaskOut>[]>(() => {
    const axisValue = (task: TaskOut): string | null =>
      groupBy === 'project' ? (task.projectId ?? null) : (task.programId ?? null);
    const axisLabel = (id: string): string =>
      groupBy === 'project'
        ? (projectName.get(id) ?? projectNoun)
        : (programName.get(id) ?? programNoun);
    const NONE_ID = '__none__';
    const noneLabel = groupBy === 'project' ? `No ${projectNoun}` : `No ${programNoun}`;

    const byId = new Map<string, TaskOut[]>();
    const order: string[] = [];
    for (const task of orderedTasks) {
      const id = axisValue(task) ?? NONE_ID;
      let bucket = byId.get(id);
      if (!bucket) {
        bucket = [];
        byId.set(id, bucket);
        order.push(id);
      }
      bucket.push(task);
    }
    // The synthesized "no axis" bucket always trails the named groups.
    order.sort((a, b) => (a === NONE_ID ? 1 : 0) - (b === NONE_ID ? 1 : 0));
    return order.map((id) => ({
      id,
      label: id === NONE_ID ? noneLabel : axisLabel(id),
      rows: byId.get(id) ?? [],
    }));
  }, [orderedTasks, groupBy, projectName, programName, projectNoun, programNoun]);

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

  /**
   * Submit the reviewed carryover decisions, then refetch the (now-closed) cycle. A close moves
   * tasks between cycles and rolls this one, so it also refreshes the org cycle roster.
   */
  const closeM = useApiMutation({
    mutationFn: (items: readonly CarryoverItem[]) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].cycles[':id'].close.$post({
            param: { orgId, id: cycleId },
            json: {
              carryover: items.map((item) => ({
                taskId: TaskId.parse(item.taskId),
                action: item.action,
                ...(item.action === 'move' && item.targetCycleId
                  ? { targetCycleId: CycleId.parse(item.targetCycleId) }
                  : {}),
              })),
            },
          }),
        `Could not close this ${cycleNounLower}.`,
      ),
    onSuccess: () => {
      setDialogOpen(false);
    },
    onError: (err) => {
      // Mirror the failure into the dialog's local error so reopening (which clears it) resets it.
      setCloseError(err.message);
    },
    invalidateKeys: [queryKeys.cycles(orgId)],
  });
  const confirmClose = useCallback((): void => {
    setCloseError(null);
    closeM.mutate(decisions);
  }, [closeM, decisions]);
  const closing = closeM.isPending;

  /**
   * Optimistically patch the cycle's status / window: apply to the cached payload, fire the PATCH,
   * roll back on failure, and reconcile on settle. A Cycle's window bounds are mandatory, so a
   * window patch only sends the bounds that are set — clearing a bound in the picker leaves the
   * prior value untouched. Editing a Cycle requires `contribute` (gated by {@link canEditCycle}).
   * The PATCH read-back is the base cycle shape, so success preserves the detail-only stats roll-up.
   */
  const patch = useApiMutation<
    CycleOut,
    { status?: CycleStatus; startsAt?: string; endsAt?: string },
    { previous?: CycleDetailData }
  >({
    mutationFn: (patchBody) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].cycles[':id'].$patch({
            param: { orgId, id: cycleId },
            json: patchBody,
          }),
        `Could not update this ${cycleNounLower}.`,
      ),
    onMutate: async (patchBody) => {
      await queryClient.cancelQueries({ queryKey: detailKey });
      const previous = queryClient.getQueryData<CycleDetailData>(detailKey);
      queryClient.setQueryData<CycleDetailData>(detailKey, (cur) =>
        cur ? { ...cur, cycle: { ...cur.cycle, ...patchBody } } : cur,
      );
      return { previous };
    },
    onError: (_err, _body, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(detailKey, ctx.previous);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<CycleDetailData>(detailKey, (cur) =>
        cur ? { ...cur, cycle: { ...cur.cycle, ...updated, stats: cur.cycle.stats } } : cur,
      );
    },
    invalidateKeys: [detailKey, queryKeys.cycles(orgId)],
  });
  const patchCycle = patch.mutate;
  const propsPending = patch.isPending;
  const propsError = patch.error?.message ?? null;

  // Editing a cycle requires `contribute`; gate the panel's affordances on it.
  const canEditCycle = useOrgCapability(members, roles, 'contribute');

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

      <div className="flex flex-col gap-2 @2xl:max-w-sm">
        <CyclePropertiesPanel
          status={cycle.status}
          startsAt={cycle.startsAt.slice(0, 10)}
          endsAt={cycle.endsAt.slice(0, 10)}
          canEdit={canEditCycle && !isCompleted}
          pending={propsPending}
          onStatusChange={(status) => {
            patchCycle({ status });
          }}
          onWindowChange={({ start, end }) => {
            patchCycle({
              ...(start ? { startsAt: start } : {}),
              ...(end ? { endsAt: end } : {}),
            });
          }}
        />
        {propsError ? (
          <p role="alert" className="text-destructive px-1 text-sm">
            {propsError}
          </p>
        ) : null}
      </div>

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

      {orderedTasks.length === 0 ? (
        <section
          aria-label={`${cycleNounLower} tasks`}
          className="border-outline-variant text-on-surface-variant min-h-[16rem] flex-1 rounded-xl border p-8 text-center text-sm"
        >
          Nothing is committed to this {cycleNounLower} yet.
        </section>
      ) : (
        <TaskTable
          label={`${title} tasks`}
          columns={columns}
          groups={taskGroups}
          taskHref={(task) => `/orgs/${orgId}/tasks/${task.id}`}
          onOpenTask={(task) => {
            router.push(`/orgs/${orgId}/tasks/${task.id}`);
          }}
          className="min-h-[16rem] flex-1"
        />
      )}

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
          confirmClose();
        }}
      />
    </div>
  );
}
