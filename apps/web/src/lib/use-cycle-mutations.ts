import {
  type CycleBackfillOut,
  type CycleCarryoverAction,
  CycleId,
  type CycleOut,
  type CycleStatus,
  TaskId,
  type TaskOut,
} from '@docket/types';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';

import type { CarryoverItem, CarryoverTarget } from '@/components/cycles/carryover-row';
import { formatWindow } from '@/components/cycles/format-window';

import { api } from './api';
import type { CycleDetailData } from './fetch-cycle-detail';
import { userErrorMessage } from './problem';
import { queryKeys, unwrap, useApiMutation } from './query';
import type { CategoryOfState } from './work-category';

/** CycleMutations describes the use cycle mutations data contract shared by the hook or component. */
export interface CycleMutations {
  patchCycle: (patch: {
    status?: CycleStatus | undefined;
    startsAt?: string | undefined;
    endsAt?: string | undefined;
    name?: string | undefined;
  }) => void;
  propsPending: boolean;
  propsError: string | null;
  dialogOpen: boolean;
  setDialogOpen: (open: boolean) => void;
  decisions: readonly CarryoverItem[];
  closeError: string | null;
  moveTargets: readonly CarryoverTarget[];
  opening: boolean;
  closing: boolean;
  openCloseDialog: () => void;
  onActionChange: (taskId: string, action: CycleCarryoverAction) => void;
  onTargetChange: (taskId: string, targetCycleId: string) => void;
  confirmClose: () => void;
  backfillCycle: () => void;
  backfilling: boolean;
  backfillResult: number | null;
  backfillError: string | null;
}

/**
 * useCycleMutations coordinates use cycle mutations state, loading, and mutations for its screen.
 *
 * @param orgId - The workspace in view.
 * @param cycleId - The cycle being closed or edited.
 * @param cycleNounLower - The workspace's word for a cycle, lower-cased, for copy.
 * @param tasks - The cycle's tasks.
 * @param otherCycles - The cycles unfinished work can be carried into.
 * @param detailKey - The query key for the cycle detail read.
 * @param categoryOf - Resolves a task's status key to its category, from the status registry.
 * @returns the screen's mutation contract.
 */
export function useCycleMutations(
  orgId: string,
  cycleId: string,
  cycleNounLower: string,
  tasks: readonly TaskOut[],
  otherCycles: readonly CycleOut[],
  detailKey: readonly string[],
  categoryOf: CategoryOfState,
): CycleMutations {
  const queryClient = useQueryClient();
  const cyclesKey = useMemo(() => queryKeys.cycles(orgId), [orgId]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [decisions, setDecisions] = useState<readonly CarryoverItem[]>([]);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [backfillResult, setBackfillResult] = useState<number | null>(null);
  const [backfillError, setBackfillError] = useState<string | null>(null);

  const incompleteTasks = useMemo(
    () => tasks.filter((task) => categoryOf(task.state) !== 'completed'),
    [tasks, categoryOf],
  );

  // A destination is identified by what a reader recognizes: the author's name when there is one,
  // qualified by the window it covers. An unnamed cycle's `displayName` *is* its window, so naming
  // it and then appending the window again would say the same thing twice. The stored `number` is
  // an epoch-anchored sequence ("cycle 1000137") and is never shown.
  const moveTargets = useMemo<readonly CarryoverTarget[]>(
    () =>
      otherCycles.map((c) => ({
        id: c.id,
        label: c.name ? `${c.name} · ${formatWindow(c.startsAt, c.endsAt)}` : c.displayName,
      })),
    [otherCycles],
  );

  const openCloseDialog = useCallback(() => {
    const defaultTarget = moveTargets[0]?.id ?? null;
    const defaultAction: CycleCarryoverAction = defaultTarget ? 'move' : 'keep';
    setDecisions(
      incompleteTasks.map((task) => ({
        taskId: task.id,
        organizationId: task.organizationId,
        title: task.title,
        stateType: categoryOf(task.state),
        action: defaultAction,
        targetCycleId: defaultAction === 'move' ? defaultTarget : null,
      })),
    );
    setCloseError(null);
    setDialogOpen(true);
  }, [incompleteTasks, moveTargets, categoryOf]);

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

  const onTargetChange = useCallback((taskId: string, targetCycleId: string) => {
    setDecisions((current) =>
      current.map((item) => (item.taskId === taskId ? { ...item, targetCycleId } : item)),
    );
  }, []);

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
      setCloseError(userErrorMessage(err, `Could not close this ${cycleNounLower}.`));
    },
    invalidateKeys: [cyclesKey],
  });

  const confirmClose = useCallback((): void => {
    setCloseError(null);
    closeM.mutate(decisions);
  }, [closeM, decisions]);

  // Assigns the team's still-unscoped, open tasks to this cycle — idempotent, so a repeat click
  // only ever picks up whatever is still missing a cycle.
  const backfillM = useApiMutation<CycleBackfillOut, undefined>({
    mutationFn: () =>
      unwrap(
        () => api.v1.orgs[':orgId'].cycles[':id'].backfill.$post({ param: { orgId, id: cycleId } }),
        `Could not assign backlog tasks to this ${cycleNounLower}.`,
      ),
    onSuccess: (result) => {
      setBackfillResult(result.assignedCount);
    },
    onError: (err) => {
      setBackfillError(
        userErrorMessage(err, `Could not assign backlog tasks to this ${cycleNounLower}.`),
      );
    },
    invalidateKeys: [detailKey, cyclesKey],
  });

  const backfillCycle = useCallback((): void => {
    setBackfillError(null);
    setBackfillResult(null);
    backfillM.mutate(undefined);
  }, [backfillM]);

  const patch = useApiMutation<
    CycleOut,
    {
      status?: CycleStatus | undefined;
      startsAt?: string | undefined;
      endsAt?: string | undefined;
      name?: string | undefined;
    },
    { previous?: CycleDetailData | undefined }
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
      await queryClient.cancelQueries({ queryKey: detailKey as string[] });
      const previous = queryClient.getQueryData<CycleDetailData>(detailKey);
      queryClient.setQueryData<CycleDetailData>(detailKey, (cur) =>
        cur ? { ...cur, cycle: Object.assign({}, cur.cycle, patchBody) } : cur,
      );
      return { previous };
    },
    onError: (_err, _body, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(detailKey as string[], ctx.previous);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<CycleDetailData>(detailKey, (cur) =>
        cur ? { ...cur, cycle: { ...cur.cycle, ...updated, stats: cur.cycle.stats } } : cur,
      );
    },
    invalidateKeys: [detailKey, cyclesKey],
  });

  return {
    patchCycle: patch.mutate,
    propsPending: patch.isPending,
    propsError: patch.error
      ? userErrorMessage(patch.error, `Could not update this ${cycleNounLower}.`)
      : null,
    dialogOpen,
    setDialogOpen,
    decisions,
    closeError,
    moveTargets,
    opening: false,
    closing: closeM.isPending,
    openCloseDialog,
    onActionChange,
    onTargetChange,
    confirmClose,
    backfillCycle,
    backfilling: backfillM.isPending,
    backfillResult,
    backfillError,
  };
}
