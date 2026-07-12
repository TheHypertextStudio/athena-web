import {
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
import { stateTypeOf } from '@/lib/work-state';
import { api } from './api';
import type { CycleDetailData } from './fetch-cycle-detail';
import { userErrorMessage } from './problem';
import { queryKeys, unwrap, useApiMutation } from './query';

/** CycleMutations describes the use cycle mutations data contract shared by the hook or component. */
export interface CycleMutations {
  patchCycle: (patch: { status?: CycleStatus; startsAt?: string; endsAt?: string }) => void;
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
}

/** useCycleMutations coordinates use cycle mutations state, loading, and mutations for its screen. */
export function useCycleMutations(
  orgId: string,
  cycleId: string,
  cycleNounLower: string,
  tasks: readonly TaskOut[],
  otherCycles: readonly CycleOut[],
  detailKey: readonly string[],
): CycleMutations {
  const queryClient = useQueryClient();
  const cyclesKey = useMemo(() => queryKeys.cycles(orgId), [orgId]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [decisions, setDecisions] = useState<readonly CarryoverItem[]>([]);
  const [closeError, setCloseError] = useState<string | null>(null);

  const incompleteTasks = useMemo(
    () => tasks.filter((task) => stateTypeOf(task.state) !== 'completed'),
    [tasks],
  );

  const moveTargets = useMemo<readonly CarryoverTarget[]>(
    () =>
      otherCycles.map((c) => ({
        id: c.id,
        label: `${c.name ?? `${cycleNounLower} ${String(c.number)}`} · ${formatWindow(c.startsAt, c.endsAt)}`,
      })),
    [otherCycles, cycleNounLower],
  );

  const openCloseDialog = useCallback(() => {
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
      await queryClient.cancelQueries({ queryKey: detailKey as string[] });
      const previous = queryClient.getQueryData<CycleDetailData>(detailKey);
      queryClient.setQueryData<CycleDetailData>(detailKey, (cur) =>
        cur ? { ...cur, cycle: { ...cur.cycle, ...patchBody } } : cur,
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
  };
}
