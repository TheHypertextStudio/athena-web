'use client';

import type { CycleTaskGroupBy, TaskOut } from '@docket/types';
import { type EntityTableGroup } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { Badge, Button, Skeleton } from '@docket/ui/primitives';
import { useParams, useRouter } from 'next/navigation';
import { type JSX, useMemo, useState } from 'react';

import type { ActorDirectory } from '@/components/agents/actor-directory';
import { CloseCycleDialog } from '@/components/cycles/close-cycle-dialog';
import { CyclePropertiesPanel } from '@/components/cycles/properties-panel';
import { STATUS_LABEL, statusBadgeVariant } from '@/components/cycles/cycle-status';
import { formatWindow, windowProgress } from '@/components/cycles/format-window';
import { GroupByMenu } from '@/components/cycles/group-by-menu';
import { StatsBanner } from '@/components/cycles/stats-banner';
import { buildTaskCatalog } from '@/components/views/task-catalog';
import { buildTaskColumns, TaskTable } from '@/components/views/task-table';
import { fetchCycleDetail } from '@/lib/fetch-cycle-detail';
import { apiQueryOptions, queryKeys, useApiQuery } from '@/lib/query';
import { useCycleMutations } from '@/lib/use-cycle-mutations';
import { useOrgCapability } from '@/lib/use-org-capability';
import { STATE_GROUP_ORDER, stateTypeOf } from '@/lib/work-state';

const EMPTY_NAME_MAP: ReadonlyMap<string, string> = new Map();

/** CycleDetailPage renders the authenticated cycle page. */
export default function CycleDetailPage(): JSX.Element {
  const router = useRouter();
  const params = useParams<{ orgId: string; cycleId: string }>();
  const { orgId, cycleId } = params;

  const cycleNoun = useVocabulary('cycle');
  const cycleNounLower = cycleNoun.toLowerCase();
  const projectNoun = useVocabulary('project');
  const programNoun = useVocabulary('program');

  const detailKey = queryKeys.cycle(orgId, cycleId);

  const detailQ = useApiQuery(
    apiQueryOptions(
      detailKey,
      fetchCycleDetail(orgId, cycleId),
      `Could not load this ${cycleNounLower}.`,
    ),
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

  const [groupBy, setGroupBy] = useState<CycleTaskGroupBy>('project');
  const [bannerExpanded, setBannerExpanded] = useState(true);

  const {
    patchCycle,
    propsPending,
    propsError,
    dialogOpen,
    setDialogOpen,
    decisions,
    closeError,
    moveTargets,
    closing,
    openCloseDialog,
    onActionChange,
    onTargetChange,
    confirmClose,
  } = useCycleMutations(orgId, cycleId, cycleNounLower, tasks, otherCycles, detailKey);

  const canEditCycle = useOrgCapability(members, roles, 'contribute');

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

  const orderedTasks = useMemo(() => {
    const rank = (task: TaskOut): number => STATE_GROUP_ORDER.indexOf(stateTypeOf(task.state));
    return [...tasks].sort((a, b) => rank(a) - rank(b));
  }, [tasks]);

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
    order.sort((a, b) => (a === NONE_ID ? 1 : 0) - (b === NONE_ID ? 1 : 0));
    return order.map((id) => ({
      id,
      label: id === NONE_ID ? noneLabel : axisLabel(id),
      rows: byId.get(id) ?? [],
    }));
  }, [orderedTasks, groupBy, projectName, programName, projectNoun, programNoun]);

  if (detailQ.isPending) {
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

  if (detailQ.isError) {
    return (
      <div className="mx-auto w-full max-w-6xl p-4 @2xl:p-6 @4xl:p-8">
        <p
          role="alert"
          className="border-outline-variant text-destructive text-body rounded-xl border p-4"
        >
          {detailQ.error.message}
        </p>
      </div>
    );
  }

  if (!cycle) {
    return (
      <div className="mx-auto w-full max-w-6xl p-4 @2xl:p-6 @4xl:p-8">
        <p className="border-outline-variant text-on-surface-variant text-body rounded-xl border border-dashed p-8 text-center">
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
            <h1 className="text-on-surface text-h1">{title}</h1>
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
          <p role="alert" className="text-destructive text-body px-1">
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
          className="border-outline-variant text-on-surface-variant text-body min-h-[16rem] flex-1 rounded-xl border p-8 text-center"
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
