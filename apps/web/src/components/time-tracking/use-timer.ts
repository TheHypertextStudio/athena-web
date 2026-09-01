'use client';

/**
 * The universal timer's client state: what is running, what to run next, and how to change it.
 *
 * @remarks
 * There is exactly one tracker per person, so there is exactly one query key for it
 * (`queryKeys.timeActive()`) and every surface that shows or changes the timer reads through
 * this module. That is what makes the Focus panel, the rail icon, the button on a task row and
 * the analytics page agree without any of them knowing about each other.
 *
 * Elapsed time is **derived, never stored in React state**. The server sends the tracked total
 * and its own clock; this module adds the wall-clock time since that read only while a segment is
 * open. A reload therefore resumes the same number rather than restarting from zero, and a tab
 * left open overnight cannot drift from the ledger — the next poll corrects it.
 *
 * The read is split in two on purpose. {@link useTimerStatus} answers "is anything running" and
 * changes only at real transitions; {@link useTimerState} adds the once-a-second tick. The app
 * shell consumes the former, because a shell that re-rendered every second while a timer ran would
 * re-render the entire application every second while a timer ran.
 */
import type { TimeActiveOut, TimeAnchorSuggestion, TimeRecordOut } from '../../lib/contracts/time';
import { writeStoredValue } from '@docket/ui/lib/browser-storage';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { api } from '@/lib/api';
import { userErrorMessage } from '@/lib/problem';
import { useNow } from '@/lib/use-now';
import { STALE, apiQueryOptions, queryKeys, useApiMutation, useLiveApiQuery } from '@/lib/query';

/** How often the shell re-reads the tracker. Focus-gated by {@link useLiveApiQuery}. */
/**
 * The timer state each control moves the record into.
 *
 * @remarks
 * The buttons are named for what pressing them does; the API is named for the state the record
 * ends up in. This is the one place those two vocabularies meet.
 */
const TIMER_STATE = { start: 'running', pause: 'paused', stop: 'stopped' } as const;

const TIMER_POLL_MS = 30_000;

/** Cross-window signal that one Focus surface changed the personal timer. */
export const FOCUS_TIMER_CHANGE_KEY = 'docket.focus.timer-change';

/**
 * How long after a planned block begins the suggestion still reads as "you should be on this".
 *
 * @remarks
 * Past this the block is simply something on the calendar rather than something just started, and
 * an indicator that kept pulsing for the whole hour would be nagging rather than informing.
 */
const NUDGE_WINDOW_MS = 15 * 60_000;

/** Whether anything is being tracked, and if so how. */
export type TimerPhase = 'idle' | 'running' | 'paused';

/** The tracker as the shell needs it: coarse, and unchanged between transitions. */
export interface TimerStatus {
  readonly phase: TimerPhase;
  /** The person's own words for the running session; `''` while it has none. */
  readonly title: string;
  /** True while a session is running with no task attached yet. */
  readonly unanchored: boolean;
  /** What the caller's own schedule says they should be on, when anything does. */
  readonly suggestion: TimeAnchorSuggestion | null;
  /** True when nothing is tracking and a planned block began within the last few minutes. */
  readonly nudging: boolean;
  /** Whether the first read has not landed yet. */
  readonly loading: boolean;
  /** Application-owned timer read failure, or null while the state is usable. */
  readonly error: string | null;
}

/** The tracker as the Focus panel needs it: everything in {@link TimerStatus}, plus the clock. */
export interface TimerState extends TimerStatus {
  /** The live record, or null when nothing is being tracked. */
  readonly record: TimeRecordOut | null;
  /** Tracked milliseconds in the current session, ticking while running. */
  readonly elapsedMs: number;
}

/** The work a timer start should attach to, when the caller already knows it. */
export interface TimerStartInput {
  /** Create and track a personal task with this title. */
  readonly label?: string;
  /** Track this existing task. */
  readonly taskId?: string;
  /** Create the task in this workspace when the caller supplies a label. */
  readonly organizationId?: string;
}

/** What a surface may ask the timer to do. */
export interface TimerControls {
  /**
   * Begin tracking.
   *
   * @remarks
   * Every argument is optional, and that is the point: a bare `start()` puts the clock on work
   * whose name nobody has decided yet. `taskId` tracks existing work; a bare `label` creates an
   * ordinary task from those words.
   */
  readonly start: (input?: TimerStartInput) => Promise<void>;
  /** Close the open segment, keeping the session resumable. */
  readonly pause: () => Promise<void>;
  /** Open a new segment on the paused session (or continue the last one, under a minute). */
  readonly resume: () => Promise<void>;
  /** Finish the session, naming it in the same request when it has no task yet. */
  readonly stop: (title?: string) => Promise<void>;
  /** Name the tracked session without stopping it; anchors an unanchored one. */
  readonly rename: (title: string) => Promise<void>;
  /** True while a start is in flight. */
  readonly starting: boolean;
  /** True while a pause, resume or stop is in flight. */
  readonly transitioning: boolean;
  /** True while a rename is in flight. */
  readonly renaming: boolean;
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

/** Derive the coarse status from one tracker read. */
function statusOf(active: TimeActiveOut | undefined, loading: boolean): TimerStatus {
  const record = active?.record ?? null;
  const running = record?.intervals.some((interval) => interval.endedAt === null) ?? false;
  const suggestion = active?.suggestion ?? null;
  const startedAt = suggestion?.startsAt ? Date.parse(suggestion.startsAt) : null;
  // Recomputed on each poll rather than on a timer of its own: a nudge that appears up to thirty
  // seconds late costs nothing, and a second interval running app-wide to make it prompt costs a
  // render of the whole shell every second.
  const serverNow = active?.serverNow ? Date.parse(active.serverNow) : Date.now();
  return {
    phase: record ? (running ? 'running' : 'paused') : 'idle',
    title: record?.title ?? '',
    unanchored: record !== null && record.taskId === null,
    suggestion,
    nudging: record === null && startedAt !== null && serverNow - startedAt < NUDGE_WINDOW_MS,
    loading,
    error: null,
  };
}

/** The one shared tracker query, so every consumer reads the same cache entry. */
function useActiveTimeQuery() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const receiveTimerChange = (event: StorageEvent): void => {
      if (event.key !== FOCUS_TIMER_CHANGE_KEY) return;
      void queryClient.invalidateQueries({ queryKey: ['me', 'time'] });
    };
    window.addEventListener('storage', receiveTimerChange);
    return () => {
      window.removeEventListener('storage', receiveTimerChange);
    };
  }, [queryClient]);

  return useLiveApiQuery(
    apiQueryOptions(
      queryKeys.timeActive(),
      () => api.v1.time.active.$get(),
      'Could not load your timer.',
      { staleTime: STALE.volatile },
    ),
    TIMER_POLL_MS,
  );
}

/**
 * Read the tracker without subscribing to its clock.
 *
 * @remarks
 * This is what the app shell uses. It re-renders only when the timer genuinely changes state —
 * start, pause, resume, stop, a new suggestion — so keeping a live indicator in the shell's
 * always-visible chrome costs nothing between transitions.
 *
 * @returns the coarse {@link TimerStatus}.
 */
export function useTimerStatus(): TimerStatus {
  const query = useActiveTimeQuery();
  return {
    ...statusOf(query.data, query.isPending),
    error: query.isError ? userErrorMessage(query.error, 'Could not load your timer.') : null,
  };
}

/**
 * Read the caller's one tracker, with the elapsed clock.
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
  const query = useActiveTimeQuery();
  const record = query.data?.record ?? null;
  const status: TimerStatus = {
    ...statusOf(query.data, query.isPending),
    error: query.isError ? userErrorMessage(query.error, 'Could not load your timer.') : null,
  };
  const running = status.phase === 'running';

  // The elapsed readout only moves while the timer does, so the clock is gated on `running`.
  const now = useNow(1_000, { enabled: running }).getTime();

  return {
    ...status,
    record,
    elapsedMs: trackedMs(record, running ? now : Date.now()),
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
 * The pending flags are reported **separately** rather than as one `busy`. A single flag meant
 * pausing greyed out the stop control and vice versa, so a person who changed their mind mid-click
 * found every control dead for the duration of a request they did not want.
 *
 * @param recordId - The session to act on; transitions other than `start` no-op without one.
 * @returns the {@link TimerControls}.
 */
export function useTimerControls(recordId: string | null): TimerControls {
  // Today chooses Now from the active timer, so every timer transition also refreshes any open
  // Today date. The prefix deliberately covers the viewer's configured local date.
  const invalidateKeys = [queryKeys.timeActive(), ['me', 'time'], ['me', 'today']] as const;
  const signalTimerChange = (): void => {
    writeStoredValue(
      FOCUS_TIMER_CHANGE_KEY,
      `${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
    );
  };

  const startMutation = useApiMutation({
    mutationFn: async (input: TimerStartInput) => {
      const response = await api.v1.time.records.$post({
        json: {
          context: {
            ...(input.label ? { label: input.label } : {}),
            ...(input.taskId ? { taskId: input.taskId } : {}),
            ...(input.organizationId ? { organizationId: input.organizationId } : {}),
          },
        },
      });
      if (!response.ok) throw await toUserError(response, 'Could not start the timer.');
      return await response.json();
    },
    invalidateKeys: [...invalidateKeys],
    onSuccess: signalTimerChange,
  });

  const transition = useApiMutation({
    mutationFn: async (input: {
      id: string;
      action: 'pause' | 'start' | 'stop';
      title?: string;
    }) => {
      // One address for the timer's state. `title` only matters on the way to `stopped`, where
      // it names a session that has no task of its own yet.
      const response = await api.v1.time.records[':id'].status.$put({
        param: { id: input.id },
        json: {
          status: TIMER_STATE[input.action],
          ...(input.action === 'stop' && input.title ? { title: input.title } : {}),
        },
      });
      if (!response.ok) throw await toUserError(response, 'Could not update the timer.');
      return await response.json();
    },
    invalidateKeys: [...invalidateKeys],
    onSuccess: signalTimerChange,
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
    onSuccess: signalTimerChange,
  });

  const act = async (action: 'pause' | 'start' | 'stop', title?: string): Promise<void> => {
    if (!recordId) return;
    await transition.mutateAsync({ id: recordId, action, ...(title ? { title } : {}) });
  };

  return {
    start: async (input = {}) => {
      await startMutation.mutateAsync(input);
    },
    pause: () => act('pause'),
    resume: () => act('start'),
    stop: (title) => act('stop', title),
    rename: async (title) => {
      if (!recordId) return;
      await renameMutation.mutateAsync({ id: recordId, title });
    },
    starting: startMutation.isPending,
    transitioning: transition.isPending,
    renaming: renameMutation.isPending,
  };
}

/**
 * Turn a failed response into application-owned copy.
 *
 * @remarks
 * The server's Problem `title`/`detail` are never rendered — only its stable `code` is read, and
 * only to choose between sentences this file owns. That is the whole of the branch: an unnamed
 * session is the one condition a person can act on, and everything else is "it did not work".
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
    return new Error('Name this before finishing.');
  }
  if (response.status === 409) {
    return new Error('That timer has already moved on. Refresh to see where it stands.');
  }
  return new Error(fallback);
}
