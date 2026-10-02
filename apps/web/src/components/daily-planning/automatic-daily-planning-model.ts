import type { SchedulingPreferencesOut } from '@docket/planning/scheduling-contract';
import { localDateString, localMinuteOfDay } from '@docket/planning/zoned-time';

const enteredDays = new Set<string>();

/** Identify browser entry by account, Hub timezone, and local date. */
export function dailyPlanningEntryKey(userId: string, timezone: string, date: string): string {
  return `docket.daily-planning.entry:${JSON.stringify([userId, timezone, date])}`;
}

/** Read the shared browser marker, retaining a fallback when browser storage is unavailable. */
export function hasEnteredDailyPlanning(key: string): boolean {
  if (enteredDays.has(key)) return true;
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

/** Record only a committed daily-planner destination. */
export function recordDailyPlanningEntry(key: string): void {
  enteredDays.add(key);
  try {
    window.localStorage.setItem(key, '1');
  } catch {
    // Private browser settings must not turn an unavailable marker into repeated redirects.
  }
}

/** Evaluate the current weekday's outer non-personal availability bounds in the Hub timezone. */
export function isDailyPlanningWorkday(
  now: Date,
  preferences: Pick<SchedulingPreferencesOut, 'timezone' | 'windows'>,
): boolean {
  const date = localDateString(now, preferences.timezone);
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const windows = preferences.windows.filter(
    (window) => window.weekday === weekday && window.kind !== 'personal',
  );
  const minute = localMinuteOfDay(now, preferences.timezone);
  return (
    windows.length > 0 &&
    minute >= Math.min(...windows.map((window) => window.startMinute)) &&
    minute < Math.max(...windows.map((window) => window.endMinute))
  );
}

/** Do not replace an active editor or another modal with the planning announcement. */
export function dailyPlanningOwnsInput(): boolean {
  const active = document.activeElement;
  return (
    Boolean(
      document.querySelector(
        '[role="dialog"][data-state="open"]:not([data-daily-planning-entry]), [role="alertdialog"]',
      ),
    ) ||
    (active instanceof HTMLElement &&
      Boolean(
        active.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'),
      ))
  );
}
