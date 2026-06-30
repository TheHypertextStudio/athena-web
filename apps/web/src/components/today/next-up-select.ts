/**
 * `today/next-up-select` — the pure selection logic behind the Today "Next up" list.
 *
 * @remarks
 * Split from the {@link NextUp} component so the choice of *what* shows next is testable against
 * fixed timestamps without rendering. The rule: prefer today's timeboxed calendar blocks whose end
 * is still in the future (so an in-progress block stays "next"), nearest-first; only when there are
 * none, fall back to tasks due today. Deterministic given `now`.
 */
import type { HubTaskItem, HubTodayOut } from '@docket/types';

/** A single timeboxed block from the Hub `today.calendar` array. */
export type CalendarBlock = HubTodayOut['calendar'][number];

/** How many items "Next up" shows at most. */
export const NEXT_UP_LIMIT = 3;

/** A chosen "Next up" entry — either an upcoming timeboxed block or a due-today task. */
export type NextUpPick =
  | { readonly kind: 'block'; readonly block: CalendarBlock }
  | { readonly kind: 'due'; readonly task: HubTaskItem };

/**
 * Choose the next few items to show, in time order.
 *
 * @param blocks - The day's timeboxed calendar blocks.
 * @param dueToday - Tasks due on the day, used as the fallback when nothing is timeboxed.
 * @param now - The reference instant for "upcoming".
 * @param limit - Max entries to return.
 * @returns Up to `limit` picks: upcoming blocks (start-ordered) if any, else due-today tasks.
 */
export function selectNextUp(
  blocks: readonly CalendarBlock[],
  dueToday: readonly HubTaskItem[],
  now: Date,
  limit: number = NEXT_UP_LIMIT,
): NextUpPick[] {
  const nowMs = now.getTime();
  const upcoming = [...blocks]
    .filter((b) => new Date(b.endsAt).getTime() > nowMs)
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
    .slice(0, limit)
    .map((block): NextUpPick => ({ kind: 'block', block }));
  if (upcoming.length > 0) return upcoming;
  return dueToday.slice(0, limit).map((task): NextUpPick => ({ kind: 'due', task }));
}
