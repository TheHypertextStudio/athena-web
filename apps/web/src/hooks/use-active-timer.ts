/**
 * Active timer state management.
 *
 * This hook provides global state for time tracking. When a user starts a
 * timer (either on a specific task or just general time tracking), the
 * timer state is stored here and accessible throughout the app.
 *
 * The command palette uses timer state to:
 * 1. Show "Stop Timer" when a timer is running
 * 2. Show "Start Timer" when no timer is active
 * 3. Display the currently timed task in actions
 * 4. Pre-fill time entry forms with elapsed duration
 *
 * ## Timer States
 *
 * ```
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                      Timer State Machine                        │
 * │                                                                 │
 * │       ┌───────────────────────────────────────────────┐         │
 * │       │             timer: null                       │         │
 * │       │          (No timer running)                   │         │
 * │       └───────────────────┬───────────────────────────┘         │
 * │                           │                                     │
 * │                    startTimer()                                 │
 * │                           │                                     │
 * │                           ▼                                     │
 * │       ┌───────────────────────────────────────────────┐         │
 * │       │        timer: { isRunning: true, ... }        │         │
 * │       │          (Timer actively running)             │         │
 * │       │                                               │         │
 * │       │   elapsed increments every second via tick()  │         │
 * │       └───────────────────┬───────────────────────────┘         │
 * │                           │                                     │
 * │                    stopTimer()                                  │
 * │                           │                                     │
 * │                           ▼                                     │
 * │       ┌───────────────────────────────────────────────┐         │
 * │       │             timer: null                       │         │
 * │       │          (Timer stopped)                      │         │
 * │       │                                               │         │
 * │       │   Note: stopTimer returns elapsed time        │         │
 * │       │   so caller can create a time entry           │         │
 * │       └───────────────────────────────────────────────┘         │
 * └─────────────────────────────────────────────────────────────────┘
 * ```
 *
 * ## Real-Time Updates
 *
 * The `elapsed` field updates every second while the timer is running.
 * This is handled by an internal interval that calls `tick()`. Components
 * displaying elapsed time will re-render automatically.
 *
 * ## Task Association
 *
 * Timers can optionally be associated with a task:
 * - `taskId: null` - General time tracking (not tied to a task)
 * - `taskId: 'abc123'` - Tracking time on a specific task
 *
 * When stopping a timer with a task association, you'll typically want to
 * create a time entry for that task with the elapsed duration.
 *
 * ## Usage
 *
 * ```typescript
 * // Start a timer on a task
 * function TaskCard({ task }) {
 *   const { timer, startTimer } = useActiveTimer();
 *
 *   const handleStartTimer = () => {
 *     startTimer(task.id, task.title);
 *   };
 *
 *   const isTimingThisTask = timer?.taskId === task.id;
 *
 *   return (
 *     <div>
 *       <h3>{task.title}</h3>
 *       {isTimingThisTask ? (
 *         <span>Timing: {formatDuration(timer.elapsed)}</span>
 *       ) : (
 *         <button onClick={handleStartTimer}>Start Timer</button>
 *       )}
 *     </div>
 *   );
 * }
 *
 * // Stop timer and log time
 * function TimerDisplay() {
 *   const { timer, stopTimer } = useActiveTimer();
 *   const createTimeEntry = useCreateTimeEntry();
 *
 *   const handleStop = async () => {
 *     if (!timer) return;
 *
 *     const elapsed = stopTimer();
 *
 *     // Create time entry if timer was on a task
 *     if (timer.taskId && elapsed > 0) {
 *       await createTimeEntry.mutateAsync({
 *         taskId: timer.taskId,
 *         duration: elapsed,
 *         startedAt: timer.startedAt,
 *       });
 *     }
 *   };
 *
 *   if (!timer) return null;
 *
 *   return (
 *     <div>
 *       <span>{timer.taskTitle ?? 'General'}: {formatDuration(timer.elapsed)}</span>
 *       <button onClick={handleStop}>Stop</button>
 *     </div>
 *   );
 * }
 * ```
 *
 * @packageDocumentation
 */

import { create } from 'zustand';
import { useEffect } from 'react';
import type { TimerContext } from '@/lib/command-palette/types';

/**
 * Internal store state and actions for timer management.
 */
interface TimerStore {
  /**
   * The currently active timer, or null if no timer is running.
   *
   * Contains all information about the active time tracking session,
   * including optional task association and elapsed time.
   */
  timer: TimerContext | null;

  /**
   * Start a new timer.
   *
   * If a timer is already running, it will be stopped first (without
   * creating a time entry - the caller should handle that if needed).
   *
   * @param taskId - Optional task ID to associate with this timer
   * @param taskTitle - Optional task title for display purposes
   */
  startTimer: (taskId: string | null, taskTitle: string | null) => void;

  /**
   * Stop the current timer and return elapsed seconds.
   *
   * Clears the timer state and returns the final elapsed time. The caller
   * is responsible for creating a time entry if desired.
   *
   * @returns Elapsed seconds, or 0 if no timer was running
   */
  stopTimer: () => number;

  /**
   * Increment the elapsed time by one second.
   *
   * Called internally by the interval timer. You typically don't need
   * to call this directly - it's handled by the `useActiveTimer` hook.
   */
  tick: () => void;
}

/**
 * Zustand store for timer state.
 *
 * Note: Timer state is NOT persisted to localStorage. If the user
 * refreshes the page, the timer is lost. This is intentional - we don't
 * want to accidentally count time during periods when the user wasn't
 * actually working. A more sophisticated implementation might persist
 * to the server and sync.
 */
const useTimerStore = create<TimerStore>((set, get) => ({
  timer: null,

  startTimer: (taskId, taskTitle) => {
    set({
      timer: {
        isRunning: true,
        taskId,
        taskTitle,
        startedAt: new Date(),
        elapsed: 0,
      },
    });
  },

  stopTimer: () => {
    const { timer } = get();
    const elapsed = timer?.elapsed ?? 0;
    set({ timer: null });
    return elapsed;
  },

  tick: () => {
    const { timer } = get();
    if (timer?.isRunning) {
      set({
        timer: {
          ...timer,
          elapsed: timer.elapsed + 1,
        },
      });
    }
  },
}));

/**
 * Hook to access and control the active timer.
 *
 * This hook:
 * 1. Provides access to timer state
 * 2. Provides functions to start/stop the timer
 * 3. Automatically ticks every second when a timer is running
 *
 * The automatic ticking is handled by a `useEffect` that sets up an
 * interval when `timer.isRunning` is true. This ensures components
 * displaying elapsed time update in real-time.
 *
 * @returns Object with timer state and control functions
 *
 * @example
 * // Display current timer status
 * function TimerStatus() {
 *   const { timer } = useActiveTimer();
 *
 *   if (!timer) {
 *     return <span>No active timer</span>;
 *   }
 *
 *   const minutes = Math.floor(timer.elapsed / 60);
 *   const seconds = timer.elapsed % 60;
 *
 *   return (
 *     <span>
 *       {timer.taskTitle ?? 'Tracking'}: {minutes}:{seconds.toString().padStart(2, '0')}
 *     </span>
 *   );
 * }
 *
 * @example
 * // Command palette integration
 * const stopTimerAction: ExecutableAction = {
 *   id: 'stop-timer',
 *   label: 'Stop Timer',
 *   icon: Square,
 *   category: 'time',
 *   // Only show when timer is running
 *   isAvailable: (ctx) => ctx.timer?.isRunning ?? false,
 *   execute: async ({ context }) => {
 *     const { stopTimer, timer } = useTimerStore.getState();
 *     const elapsed = stopTimer();
 *
 *     if (timer?.taskId) {
 *       await timeEntriesApi.create({
 *         taskId: timer.taskId,
 *         duration: elapsed,
 *         startedAt: timer.startedAt,
 *       });
 *     }
 *
 *     return {
 *       success: true,
 *       message: `Logged ${Math.round(elapsed / 60)} minutes`,
 *       invalidate: ['time-entries'],
 *     };
 *   },
 * };
 */
export function useActiveTimer(): TimerStore {
  const timer = useTimerStore((s) => s.timer);
  const startTimer = useTimerStore((s) => s.startTimer);
  const stopTimer = useTimerStore((s) => s.stopTimer);
  const tick = useTimerStore((s) => s.tick);

  // Set up interval to tick every second when timer is running
  useEffect(() => {
    if (!timer?.isRunning) return;
    const interval = setInterval(tick, 1000);
    return () => {
      clearInterval(interval);
    };
  }, [timer?.isRunning, tick]);

  return { timer, startTimer, stopTimer, tick };
}

/**
 * Direct access to get timer state outside of React components.
 *
 * Use this for synchronous access in non-React code, such as:
 * - Action execution functions
 * - API interceptors
 * - Utility functions
 *
 * **Important**: This returns a snapshot of state at call time.
 * It does NOT set up the automatic ticking interval. For real-time
 * updates, use the `useActiveTimer()` hook in React components.
 *
 * @returns Current timer state snapshot
 *
 * @example
 * // In a command palette action
 * execute: async () => {
 *   const { timer, stopTimer } = getTimerState();
 *   if (!timer) {
 *     return { success: false, message: 'No timer running' };
 *   }
 *   const elapsed = stopTimer();
 *   // ... create time entry
 * };
 */
export function getTimerState(): Pick<TimerStore, 'timer' | 'startTimer' | 'stopTimer'> {
  const state = useTimerStore.getState();
  return {
    timer: state.timer,
    startTimer: state.startTimer,
    stopTimer: state.stopTimer,
  };
}

/**
 * Format elapsed seconds as a human-readable duration.
 *
 * A utility function for displaying timer duration in a consistent format.
 * Returns format like "0:00", "1:30", "10:00", "1:00:00".
 *
 * @param seconds - Total elapsed seconds
 * @returns Formatted duration string
 *
 * @example
 * formatDuration(0)      // "0:00"
 * formatDuration(30)     // "0:30"
 * formatDuration(90)     // "1:30"
 * formatDuration(3600)   // "1:00:00"
 * formatDuration(3661)   // "1:01:01"
 */
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${String(hours)}:${minutes.toString().padStart(2, '0')}:${secs
      .toString()
      .padStart(2, '0')}`;
  }

  return `${String(minutes)}:${secs.toString().padStart(2, '0')}`;
}
