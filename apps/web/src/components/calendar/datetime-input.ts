/**
 * `calendar/datetime-input` — conversion helpers between an ISO instant and a native
 * `<input type="datetime-local">` value.
 *
 * @remarks
 * `datetime-local` inputs read/write a zone-less local string (`YYYY-MM-DDTHH:mm`); the wire
 * format is always a zoned ISO instant. Shared by the item workspace drawer's core-fields form and
 * the create-native-block form so both edit times the same way.
 */

import { scheduleInstantAt, scheduleWallPositionForInstant } from '@/components/scheduling';

/** Convert an ISO instant to a `datetime-local` value in the required display timezone. */
export function toLocalInputValue(iso: string, displayTimezone: string): string {
  const position = scheduleWallPositionForInstant(iso, displayTimezone);
  if (!position) return '';
  const pad = (n: number): string => String(n).padStart(2, '0');
  const hours = Math.floor(position.wallMinutes / 60);
  const minutes = position.wallMinutes % 60;
  return `${position.date}T${pad(hours)}:${pad(minutes)}`;
}

/** Convert a display-timezone wall value to an exact instant, rejecting invalid local times. */
export function fromLocalInputValue(value: string, displayTimezone: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  if (hours > 23 || minutes > 59) return null;
  const date = match[1];
  if (!date) return null;
  const wallMinutes = hours * 60 + minutes;
  const instant = scheduleInstantAt(date, wallMinutes, displayTimezone, 'reject');
  if (!instant) return null;
  const roundTrip = scheduleWallPositionForInstant(instant, displayTimezone);
  return roundTrip !== null && roundTrip.date === date && roundTrip.wallMinutes === wallMinutes
    ? instant
    : null;
}
