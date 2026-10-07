'use client';

import type { DailyPlanSnapshot } from '@docket/planning/daily-plan-flow';
import { useEffect, useMemo, useRef, useState } from 'react';
import { UserFacingError } from '@/lib/problem';
import type { Stage } from './daily-planning-controller';
import { useSaveDailyDraft } from './daily-planning-queries';

function resumeStep(stage: Stage): 'review_yesterday' | 'review_plan' | 'plan_today' {
  return stage === 'yesterday'
    ? 'review_yesterday'
    : stage === 'review'
      ? 'review_plan'
      : 'plan_today';
}

/** Serialize revision-aware saves and retain local state after a conflict. */
export function useGuardedPersistence(date: string, initialRevision: number | undefined) {
  const { mutateAsync } = useSaveDailyDraft(date);
  const dateEntry = useMemo(() => ({ date }), [date]);
  const serverRevision = useRef(initialRevision ?? 0);
  const initializedDate = useRef(initialRevision === undefined ? null : dateEntry);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const saveGeneration = useRef(0);
  const conflictFailure = useRef<Error | null>(null);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (initializedDate.current === dateEntry) return;
    initializedDate.current = initialRevision === undefined ? null : dateEntry;
    if (initialRevision !== undefined) serverRevision.current = initialRevision;
    queue.current = Promise.resolve();
    conflictFailure.current = null;
    setConflict(false);
  }, [dateEntry, initialRevision]);
  const persist = (
    draft: DailyPlanSnapshot,
    stage: Stage,
    _localRevision: number,
  ): Promise<void> => {
    const generation = saveGeneration.current;
    const next = queue.current
      .catch(() => undefined)
      .then(async () => {
        if (initializedDate.current !== dateEntry || generation !== saveGeneration.current) return;
        if (conflictFailure.current) throw conflictFailure.current;
        try {
          const result = await mutateAsync({
            draft,
            resumeStep: resumeStep(stage),
            expectedRevision: serverRevision.current,
          });
          if (initializedDate.current !== dateEntry) return;
          serverRevision.current = result.revision;
          setError(null);
        } catch (failure) {
          if (initializedDate.current !== dateEntry) throw failure;
          if (failure instanceof UserFacingError && failure.status === 409) {
            conflictFailure.current = failure;
            setConflict(true);
            setError(
              'This plan changed on another device. Your edits are still here. Review the saved plan before choosing which version to use.',
            );
          } else setError('Your edits are still here. Save failed.');
          throw failure;
        }
      });
    queue.current = next;
    return next;
  };
  const invalidateQueuedSaves = (): void => {
    saveGeneration.current += 1;
  };
  const flush = (): Promise<unknown> => queue.current;
  const acceptServerRevision = async (value: number): Promise<void> => {
    await queue.current.catch(() => undefined);
    if (initializedDate.current !== dateEntry) return;
    serverRevision.current = value;
    conflictFailure.current = null;
    setConflict(false);
    setError(null);
    queue.current = Promise.resolve();
  };
  return {
    persist,
    flush,
    acceptServerRevision,
    invalidateQueuedSaves,
    conflict,
    error,
    setError,
    serverRevision,
  };
}
