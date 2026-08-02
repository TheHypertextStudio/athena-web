'use client';

/**
 * The universal timer's client state: what is running, and the five things you can do to it.
 *
 * @remarks
 * There is exactly one tracker per person, so there is exactly one query key for it
 * (`queryKeys.timeActive()`) and every surface that shows or changes the timer reads through
 * this module. That is what makes the control in the sidebar, the control in the mobile bar, the
 * button on a task row and the analytics page agree without any of them knowing about each other.
 *
 * Elapsed time is **derived, never stored in React state**. The server sends the tracked total
 * and its own clock; this module adds the wall-clock time since that read only while a segment is
 * open. A reload therefore resumes the same number rather than restarting from zero, and a tab
 * left open overnight cannot drift from the ledger — the next poll corrects it.
 */
import type { TimeRecordOut } from '@docket/types';
import { useEffect, useState } from 'react';

import { api } from '@/lib/api';
import { STALE, apiQueryOptions, queryKeys, useApiMutation, useLiveApiQuery } from '@/lib/query';

/** How often the shell re-reads the tracker. Focus-gated by {@link useLiveApiQuery}. */
const TIMER_POLL_MS = 30_000;

/** The tracker as the interface needs it. */
export interface TimerState {
  /** The live record, or null when nothing is being tracked. */
  readonly record: TimeRecordOut | null;
  /** Whether a segment is currently open (as opposed to paused). */
  readonly running: boolean;
  /** Tracked milliseconds in the current session, ticking while running. */
  readonly elapsedMs: number;
  /** Whether the first read has not landed yet. */
  readonly loading: boolean;
}

/** What a surface may ask the timer to do. */
export interface TimerControls {
  /** Begin tracking. `taskId` tracks existing work; a bare `label` creates an ordinary task. */
  readonly start: (input: {
    label: string;
    taskId?: string;
    organizationId?: string;
  }) => Promise<void>;
  /** Close the open segment, keeping the session resumable. */
  readonly pause: () => Promise<void>;
  /** Open a new segment on the paused session (or continue the last one, under a minute). */
  readonly resume: () => Promise<void>;
  /** Finish the session. Refused by the server when the tracked task has no name. */
  readonly stop: () => Promise<void>;
  /** Rename the tracked session before finishing it. */
  readonly rename: (title: string) => Promise<void>;
  /** Whether a transition is in flight, so a control can disable itself rather than double-fire. */
  readonly busy: boolean;
}

/** Sum the open and closed segments of one record as of `now`. */
function trackedMs(record: TimeRecordOut | null, now: number): number {
  if (!record) return 0;
  let total = 0;
  for (const interval of record.intervals) {
    if (interval.supersededById !== null) continue;
    if (interval.mode !== 'human_active') continue;
    const start = Date.parse(interval.startedAt);
    const end = interval.endedAt ? Date.parse(interval.endedAt) : now;
    total += Math.max(0, end - start);
  }
  return total;
}

/**
 * Read the caller's one tracker.
 *
 * @remarks
 * Ticks once a second **only while a segment is open**, so an idle or paused timer costs no
 * renders at all. The tick drives a local `now`, which is fed back into the same pure sum used
 * for the server's own answer — one formula, so the displayed number cannot disagree with the
 * ledger by construction.
 *
 * @returns the current {@link TimerState}.
 */
export function useTimerState(): TimerState {
  const query = useLiveApiQuery(
    apiQueryOptions(
      queryKeys.timeActive(),
      () => api.v1.time.active.$get(),
      'Could not load your timer.',
      { staleTime: STALE.volatile },
    ),
    TIMER_POLL_MS,
  );
  const active = query.data;
  const record = active?.record ?? null;
  const running = record?.intervals.some((interval) => interval.endedAt === null) ?? false;

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return undefined;
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [running]);

  return {
    record,
    running,
    elapsedMs: trackedMs(record, running ? now : Date.now()),
    loading: query.isPending,
  };
}

/**
 * The five timer transitions, each invalidating the one `['me','time']` prefix on settle.
 *
 * @remarks
 * Deliberately NOT optimistic. Starting a timer can create a task, join a previous segment, or
 * switch away from other work — outcomes the client cannot predict, and each of which changes
 * what the control should say. Showing a guessed state and correcting it a moment later is worse
 * than a brief pending state, because the thing being guessed at is a durable record of a
 * person's day.
 *
 * @param recordId - The session to act on; transitions other than `start` no-op without one.
 * @returns the {@link TimerControls}.
 */
export function useTimerControls(recordId: string | null): TimerControls {
  const invalidateKeys = [queryKeys.timeActive(), ['me', 'time']] as const;

  const startMutation = useApiMutation({
    mutationFn: async (input: { label: string; taskId?: string; organizationId?: string }) => {
      const response = await api.v1.time.records.$post({
        json: {
          context: {
            label: input.label,
            ...(input.taskId ? { taskId: input.taskId } : {}),
            ...(input.organizationId ? { organizationId: input.organizationId } : {}),
          },
        },
      });
      if (!response.ok) throw await toUserError(response, 'Could not start the timer.');
      return await response.json();
    },
    invalidateKeys: [...invalidateKeys],
  });

  const transition = useApiMutation({
    mutationFn: async (input: { id: string; action: 'pause' | 'start' | 'stop' }) => {
      const response = await api.v1.time.records[':id'][input.action].$post({
        param: { id: input.id },
      });
      if (!response.ok) throw await toUserError(response, 'Could not update the timer.');
      return await response.json();
    },
    invalidateKeys: [...invalidateKeys],
  });

  const renameMutation = useApiMutation({
    mutationFn: async (input: { id: string; title: string }) => {
      const response = await api.v1.time.records[':id'].$patch({
        param: { id: input.id },
        json: { title: input.title },
      });
      if (!response.ok) throw await toUserError(response, 'Could not rename the task.');
      return await response.json();
    },
    invalidateKeys: [...invalidateKeys],
  });

  const act = async (action: 'pause' | 'start' | 'stop'): Promise<void> => {
    if (!recordId) return;
    await transition.mutateAsync({ id: recordId, action });
  };

  return {
    start: async (input) => {
      await startMutation.mutateAsync(input);
    },
    pause: () => act('pause'),
    resume: () => act('start'),
    stop: () => act('stop'),
    rename: async (title) => {
      if (!recordId) return;
      await renameMutation.mutateAsync({ id: recordId, title });
    },
    busy: startMutation.isPending || transition.isPending || renameMutation.isPending,
  };
}

/**
 * Turn a failed response into application-owned copy.
 *
 * @remarks
 * The server's Problem `title`/`detail` are never rendered — only its stable `code` is read, and
 * only to choose between sentences this file owns. That is the whole of the branch: an unnamed
 * task is the one condition a person can act on, and everything else is "it did not work".
 *
 * @param response - The failed RPC response.
 * @param fallback - The sentence to show when no specific condition applies.
 * @returns an `Error` carrying only copy this application wrote.
 */
async function toUserError(response: Response, fallback: string): Promise<Error> {
  let code: string | null = null;
  try {
    const body = (await response.json()) as { code?: unknown };
    if (typeof body.code === 'string') code = body.code;
  } catch {
    code = null;
  }
  if (code === 'validation_error') {
    return new Error('Give the task a name before finishing.');
  }
  if (response.status === 409) {
    return new Error('That timer has already moved on. Refresh to see where it stands.');
  }
  return new Error(fallback);
}
