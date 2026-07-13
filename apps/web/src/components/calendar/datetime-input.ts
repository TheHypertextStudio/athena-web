/**
 * `calendar/datetime-input` — conversion helpers between an ISO instant and a native
 * `<input type="datetime-local">` value.
 *
 * @remarks
 * `datetime-local` inputs read/write a zone-less local string (`YYYY-MM-DDTHH:mm`); the wire
 * format is always a zoned ISO instant. Shared by the item workspace drawer's core-fields form and
 * the create-native-block form so both edit times the same way.
 */

import { Temporal } from '@js-temporal/polyfill';

import {
  resolveScheduleWallTime,
  type ScheduleWallTimeCandidate,
  type ScheduleWallTimeResolution,
  scheduleWallPositionForInstant,
} from '@/components/scheduling';

/** Explicit occurrence choice for a repeated native datetime-local value. */
export type LocalInputOccurrence = ScheduleWallTimeCandidate['occurrence'];

interface ParsedLocalInputValue {
  readonly date: string;
  readonly wallMinutes: number;
}

/** Parse one native datetime-local value without assigning it a timezone. */
function parseLocalInputValue(value: string): ParsedLocalInputValue | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  const date = match[1];
  if (!date || hours > 23 || minutes > 59) return null;
  return { date, wallMinutes: hours * 60 + minutes };
}

/** Convert an ISO instant to a `datetime-local` value in the required display timezone. */
export function toLocalInputValue(iso: string, displayTimezone: string): string {
  const position = scheduleWallPositionForInstant(iso, displayTimezone);
  if (!position) return '';
  const pad = (n: number): string => String(n).padStart(2, '0');
  const hours = Math.floor(position.wallMinutes / 60);
  const minutes = position.wallMinutes % 60;
  return `${position.date}T${pad(hours)}:${pad(minutes)}`;
}

/** Resolve one native datetime-local value without discarding its DST transition state. */
export function resolveLocalInputValue(
  value: string,
  displayTimezone: string,
): ScheduleWallTimeResolution | null {
  const parsed = parseLocalInputValue(value);
  return parsed ? resolveScheduleWallTime(parsed.date, parsed.wallMinutes, displayTimezone) : null;
}

/** Convert a display-zone wall value to an exact instant with an explicit repeated-time choice. */
export function fromLocalInputValue(
  value: string,
  displayTimezone: string,
  occurrence?: LocalInputOccurrence | null,
): string | null {
  const resolution = resolveLocalInputValue(value, displayTimezone);
  if (!resolution || resolution.kind === 'skipped') return null;
  if (resolution.kind === 'normal') return resolution.instant;
  return (
    resolution.candidates.find((candidate) => candidate.occurrence === occurrence)?.instant ?? null
  );
}

/** Identify which repeated occurrence an existing canonical instant represents, when applicable. */
export function localInputOccurrenceForInstant(
  instant: string,
  displayTimezone: string,
): LocalInputOccurrence | null {
  const position = scheduleWallPositionForInstant(instant, displayTimezone);
  if (!position) return null;
  const resolution = resolveScheduleWallTime(position.date, position.wallMinutes, displayTimezone);
  if (resolution?.kind !== 'repeated') return null;
  try {
    const offset = Temporal.Instant.from(instant).toZonedDateTimeISO(displayTimezone).offset;
    return (
      resolution.candidates.find((candidate) => candidate.offset === offset)?.occurrence ?? null
    );
  } catch {
    return null;
  }
}

/** Return application-owned guidance for an unresolved edited datetime-local field. */
export function localInputResolutionError(
  value: string,
  displayTimezone: string,
  occurrence: LocalInputOccurrence | null,
  fieldLabel: 'start' | 'end',
): string | null {
  const resolution = resolveLocalInputValue(value, displayTimezone);
  if (!resolution) return `Choose a valid ${fieldLabel} time.`;
  if (resolution.kind === 'skipped') {
    return `That ${fieldLabel} time does not exist because clocks change.`;
  }
  if (resolution.kind === 'repeated' && occurrence === null) {
    return `Choose Earlier or Later for the repeated ${fieldLabel} time.`;
  }
  return null;
}
