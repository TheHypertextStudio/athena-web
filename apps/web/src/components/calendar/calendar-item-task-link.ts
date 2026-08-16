/**
 * `calendar/calendar-item-task-link` — resolve the one task a calendar item's own scheduled block
 * represents.
 *
 * @remarks
 * A calendar item can carry several linked tasks with different {@link CalendarItemTaskRole}s
 * (`prep`, `agenda`, `follow_up`, `outcome`, `related`, `contained`) — only `'contained'` means
 * "this block IS the scheduled work on this task", the same meaning the scheduling surface itself
 * assigns when a task is dropped onto empty grid time (see `onDropObjectOnGrid` in
 * `calendar-scheduling-surface.tsx`, which links with `role: 'contained'` after creating the
 * block). A `prep`/`agenda`/`follow_up`/`outcome`/`related` link is a looser association — a task
 * to review before a meeting, say — not the thing the block itself represents doing.
 *
 * `'timebox'` is the first-class kind that flow produces and is what the live personal calendar
 * (`dateAxis`, backed by `GET /v1/me/calendar/items`) actually returns for a task-linked block —
 * `'task_timebox'` is a separate, legacy/derived kind that only the shared-calendar read path
 * (`calendar-shared.ts`) still synthesizes. Both are "this block is about doing a task" in the
 * same sense, so both are eligible here; checking only `'task_timebox'` (as an earlier version of
 * this logic did) meant the start-timer affordance never matched a single block created
 * through the app's own drag-a-task-onto-the-grid flow, only the legacy kind no live write path
 * produces anymore.
 */
import type { CalendarItemLinkedTaskOut, CalendarItemOut } from '@docket/types';

/** Kinds whose block can represent "doing" a specific task. */
const TASK_SHAPED_KINDS: ReadonlySet<CalendarItemOut['kind']> = new Set([
  'timebox',
  'task_timebox',
]);

/**
 * Return the linked task a calendar item's block itself represents, or `null` when the item is
 * not task-shaped or carries no `'contained'` link.
 *
 * @param item - The calendar item to inspect.
 */
export function containedTaskLink(item: CalendarItemOut): CalendarItemLinkedTaskOut | null {
  if (!TASK_SHAPED_KINDS.has(item.kind)) return null;
  return item.linkedTasks.find((link) => link.role === 'contained') ?? null;
}
