'use client';

import { addDays } from '@docket/planning/zoned-time';
import { useEffect, useRef, useState } from 'react';
import { useDeferDailyTask } from './daily-planning-queries';

/** Move work only after the server succeeds, preserving edits made during the request. */
export function useDailyPlanningMove(input: {
  date: string;
  confirming: boolean;
  removeTask: (taskId: string, sourceDate?: string) => void;
  setError: (error: string | null) => void;
}) {
  const { mutateAsync } = useDeferDailyTask(input.date);
  const latest = useRef(input);
  useEffect(() => {
    latest.current = input;
  }, [input]);
  const moving = useRef(false);
  const [deferPending, setDeferPending] = useState(false);
  const moveTaskToTomorrow = async (taskId: string, organizationId: string): Promise<void> => {
    if (moving.current || latest.current.confirming) return;
    const sourceDate = input.date;
    moving.current = true;
    setDeferPending(true);
    try {
      await mutateAsync({ taskId, organizationId, targetDate: addDays(sourceDate, 1) });
      latest.current.removeTask(taskId, sourceDate);
    } catch {
      if (latest.current.date === sourceDate)
        latest.current.setError('Could not move this task. Your plan is unchanged.');
    } finally {
      moving.current = false;
      setDeferPending(false);
    }
  };
  return { deferPending, moveTaskToTomorrow, isMovingTask: (): boolean => moving.current };
}
