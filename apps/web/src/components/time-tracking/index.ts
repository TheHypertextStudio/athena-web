/**
 * The universal timer's public surface for the rest of the app.
 *
 * @remarks
 * Everything a screen needs is here, and nothing else is exported: the Focus rail panel and the
 * status it lends its rail icon, the per-task affordance, and the state hooks behind both.
 * Surfaces import from this barrel so the timer can be rearranged internally without a rename
 * rippling through the app shell, the task table and the detail page at once.
 */
export { default as FocusPanel } from './focus-panel';
export { focusRailStatus } from './focus-rail-status';
export { TaskTimerButton, type TaskTimerButtonProps } from './task-timer-button';
export { TimeAnalytics } from './time-analytics';
export { TimeSharePanel } from './time-share-panel';
export { formatClock, formatDuration, spokenDuration } from './format-duration';
export {
  type TimerControls,
  type TimerPhase,
  type TimerState,
  type TimerStatus,
  useTimerControls,
  useTimerState,
  useTimerStatus,
} from './use-timer';
