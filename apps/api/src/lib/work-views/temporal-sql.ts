import type { ViewFieldKind } from '@docket/work/view-contract';

/** A scalar field shape used to choose date or timestamp transport values. */
export interface TemporalField {
  /** Operator family declared by the shared target contract. */
  readonly kind: Exclude<ViewFieldKind, 'relation-many'>;
}

/** Request-scoped inputs used to resolve symbolic temporal operands. */
export interface TemporalSqlContext {
  /** Frozen execution instant for relative operands. */
  readonly now?: Date;
  /** IANA timezone for calendar operands. */
  readonly timeZone?: string;
}

/** Half-open range produced from one symbolic temporal operand. */
export interface TemporalRange {
  /** Inclusive lower bound. */
  readonly start: unknown;
  /** Exclusive upper bound. */
  readonly end: unknown;
}

interface CalendarParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

interface LocalDateTimeParts extends CalendarParts {
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly millisecond: number;
}

function calendarParts(now: Date, timeZone: string): CalendarParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((item) => item.type === type)?.value);
  return { year: part('year'), month: part('month'), day: part('day') };
}

function shiftCalendar(
  date: CalendarParts,
  unit: 'day' | 'week' | 'month' | 'quarter' | 'year',
  offset: number,
): CalendarParts {
  const value = new Date(Date.UTC(date.year, date.month - 1, date.day));
  if (unit === 'day' || unit === 'week')
    value.setUTCDate(value.getUTCDate() + offset * (unit === 'week' ? 7 : 1));
  if (unit === 'month' || unit === 'quarter')
    value.setUTCMonth(value.getUTCMonth() + offset * (unit === 'quarter' ? 3 : 1), 1);
  if (unit === 'year') value.setUTCFullYear(value.getUTCFullYear() + offset, 0, 1);
  return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() };
}

function periodStart(
  date: CalendarParts,
  unit: 'day' | 'week' | 'month' | 'quarter' | 'year',
): CalendarParts {
  if (unit === 'day') return date;
  if (unit === 'week') {
    const weekday = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
    return shiftCalendar(date, 'day', -((weekday + 6) % 7));
  }
  if (unit === 'month') return { ...date, day: 1 };
  if (unit === 'quarter')
    return { year: date.year, month: Math.floor((date.month - 1) / 3) * 3 + 1, day: 1 };
  return { year: date.year, month: 1, day: 1 };
}

function dateString(date: CalendarParts): string {
  return `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}

function localDateTimeParts(value: Date, timeZone: string): LocalDateTimeParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
    hourCycle: 'h23',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((item) => item.type === type)?.value);
  return {
    year: part('year'),
    month: part('month'),
    day: part('day'),
    hour: part('hour'),
    minute: part('minute'),
    second: part('second'),
    millisecond: part('fractionalSecond'),
  };
}

function zonedDateTime(date: LocalDateTimeParts, timeZone: string): Date {
  const desired = localEpoch(date);
  let instant = desired;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const shown = localDateTimeParts(new Date(instant), timeZone);
    instant = desired - (localEpoch(shown) - instant);
  }
  return new Date(instant);
}

function zonedMidnight(date: CalendarParts, timeZone: string): Date {
  return resolveCalendarTarget(
    { ...date, hour: 0, minute: 0, second: 0, millisecond: 0 },
    timeZone,
  );
}

function localEpoch(parts: LocalDateTimeParts): number {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  );
}

function sameLocal(left: LocalDateTimeParts, right: LocalDateTimeParts): boolean {
  return localEpoch(left) === localEpoch(right);
}

function resolveCalendarTarget(
  target: LocalDateTimeParts,
  timeZone: string,
  sourceOffset?: number,
): Date {
  const targetEpoch = localEpoch(target);
  const offsets = new Set<number>();
  for (let hours = -48; hours <= 48; hours += 6) {
    const sample = new Date(targetEpoch + hours * 60 * 60 * 1000);
    offsets.add(localEpoch(localDateTimeParts(sample, timeZone)) - sample.getTime());
  }
  const candidates = [...offsets].map((offset) => {
    const instant = new Date(targetEpoch - offset);
    const local = localDateTimeParts(instant, timeZone);
    return { instant, local, offset, delta: localEpoch(local) - targetEpoch };
  });
  const exact = candidates.filter((candidate) => sameLocal(candidate.local, target));
  if (exact.length > 0) {
    const selected =
      exact.find((candidate) => sourceOffset !== undefined && candidate.offset === sourceOffset) ??
      exact.sort((left, right) => left.instant.getTime() - right.instant.getTime())[0];
    if (!selected) throw new TypeError('A calendar target unexpectedly lost its exact candidate.');
    return selected.instant;
  }
  const afterGap = candidates
    .filter((candidate) => candidate.delta > 0)
    .sort((left, right) => left.delta - right.delta)[0];
  return afterGap?.instant ?? zonedDateTime(target, timeZone);
}

function shiftRolling(
  instant: Date,
  timeZone: string,
  unit: 'day' | 'week' | 'month' | 'quarter' | 'year',
  offset: number,
): Date {
  if (offset === 0) return new Date(instant.getTime());
  const local = localDateTimeParts(instant, timeZone);
  const value = new Date(localEpoch(local));
  if (unit === 'day' || unit === 'week') {
    value.setUTCDate(value.getUTCDate() + offset * (unit === 'week' ? 7 : 1));
  } else {
    const day = value.getUTCDate();
    value.setUTCDate(1);
    if (unit === 'month' || unit === 'quarter') {
      value.setUTCMonth(value.getUTCMonth() + offset * (unit === 'quarter' ? 3 : 1));
    } else {
      value.setUTCFullYear(value.getUTCFullYear() + offset);
    }
    const lastDay = new Date(
      Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0),
    ).getUTCDate();
    value.setUTCDate(Math.min(day, lastDay));
  }
  const target = {
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate(),
    hour: value.getUTCHours(),
    minute: value.getUTCMinutes(),
    second: value.getUTCSeconds(),
    millisecond: value.getUTCMilliseconds(),
  };
  const sourceOffset = localEpoch(local) - instant.getTime();
  // Repeated wall times keep the source offset. Missing wall times move forward across the gap.
  return resolveCalendarTarget(target, timeZone, sourceOffset);
}

/**
 * Resolve a request-schema symbolic temporal operand into a half-open range.
 *
 * Rolling day and week operands use elapsed instant arithmetic. Calendar operands choose the
 * earliest instant during a fold and advance across a gap. Rolling month and year operands keep
 * the source offset when that offset remains valid.
 *
 * @param operand - Validated absolute, relative, or preset operand.
 * @param field - Field family that controls date versus timestamp output.
 * @param context - Frozen clock and viewer timezone.
 * @returns The resolved range, or null when the operand is not symbolic.
 */
export function resolveTemporalRange(
  operand: unknown,
  field: TemporalField,
  context: TemporalSqlContext,
): TemporalRange | null {
  if (operand === null || typeof operand !== 'object' || !('kind' in operand)) return null;
  const symbolic = operand as Record<string, unknown>;
  if (symbolic['kind'] !== 'relative' && symbolic['kind'] !== 'preset') return null;
  const now = context.now ?? new Date();
  const timeZone = context.timeZone ?? 'UTC';
  const today = calendarParts(now, timeZone);
  let unit: 'day' | 'week' | 'month' | 'quarter' | 'year';
  let offset: number;
  if (symbolic['kind'] === 'relative') {
    unit = symbolic['unit'] as typeof unit;
    offset = Number(symbolic['offset']);
    if (symbolic['anchor'] === 'now' && field.kind === 'datetime') {
      if (unit === 'day' || unit === 'week') {
        const duration = (unit === 'day' ? 1 : 7) * 24 * 60 * 60 * 1000;
        const start = new Date(now.getTime() + offset * duration);
        return { start, end: new Date(start.getTime() + duration) };
      }
      const start = shiftRolling(now, timeZone, unit, offset);
      return { start, end: shiftRolling(start, timeZone, unit, 1) };
    }
  } else {
    const presets = {
      today: ['day', 0],
      yesterday: ['day', -1],
      tomorrow: ['day', 1],
      'this-week': ['week', 0],
      'next-week': ['week', 1],
      'last-week': ['week', -1],
      'this-month': ['month', 0],
      'next-month': ['month', 1],
      'last-month': ['month', -1],
    } as const;
    [unit, offset] = presets[symbolic['value'] as keyof typeof presets];
  }
  const start = shiftCalendar(periodStart(today, unit), unit, offset);
  const end = shiftCalendar(start, unit, 1);
  return field.kind === 'date'
    ? { start: dateString(start), end: dateString(end) }
    : { start: zonedMidnight(start, timeZone), end: zonedMidnight(end, timeZone) };
}
