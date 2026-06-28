/**
 * Agenda route helpers.
 *
 * @packageDocumentation
 */

export function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const START_OF_DAY = [0, 0, 0, 0] as const;
const SUNDAY_INDEX = 0;
const SUNDAY_OFFSET = -6;
const WEEK_START_MONDAY = 1;

export function getWeekStart(date: Date): Date {
  const startDate = new Date(date);
  const day = startDate.getDay();
  const diff =
    startDate.getDate() - day + (day === SUNDAY_INDEX ? SUNDAY_OFFSET : WEEK_START_MONDAY);
  startDate.setDate(diff);
  startDate.setHours(...START_OF_DAY);
  return startDate;
}
