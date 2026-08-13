/**
 * `@docket/api` — the wall-clock arithmetic a person's local day needs.
 *
 * @remarks
 * Extracted from the digest generator so the activity poll and the digest agree on where a day
 * begins. They must: the poll decides which window to fetch and the digest decides which events
 * belong to a date, and two implementations of "midnight" would put activity in one day and read it
 * out of another — at exactly the hours around midnight when a person is most likely to be looking.
 *
 * `now` is always passed in, never read from module scope.
 */

/** The wall-clock parts of an instant in a timezone. */
export interface ZonedParts {
  readonly y: number;
  readonly mo: number;
  readonly d: number;
  readonly h: number;
  readonly mi: number;
}

/**
 * Cached `Intl.DateTimeFormat` per timezone.
 *
 * @remarks
 * Formatter construction loads locale/tz data and is relatively expensive; a sweep calls
 * {@link zonedParts} several times per user, with users heavily sharing timezones — so one formatter
 * per zone is reused across the whole sweep.
 */
const PARTS_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(tz: string): Intl.DateTimeFormat {
  let fmt = PARTS_FORMATTERS.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    PARTS_FORMATTERS.set(tz, fmt);
  }
  return fmt;
}

/**
 * The wall-clock parts of an instant in a timezone (`hourCycle: h23`).
 *
 * @param instant - The instant to read.
 * @param tz - An IANA timezone.
 * @returns the local year, month, day, hour and minute.
 */
export function zonedParts(instant: Date, tz: string): ZonedParts {
  const parts = partsFormatter(tz).formatToParts(instant);
  const pick = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? '0');
  return {
    y: pick('year'),
    mo: pick('month'),
    d: pick('day'),
    h: pick('hour'),
    mi: pick('minute'),
  };
}

/** The zone's UTC offset (ms) at `instant`: the wall-clock-as-UTC minus the instant. */
function tzOffsetMs(instant: Date, tz: string): number {
  const p = zonedParts(instant, tz);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi) - instant.getTime();
}

/**
 * The UTC instant of the local midnight that begins the day described by `parts`.
 *
 * @param parts - The local date to find the start of.
 * @param tz - An IANA timezone.
 * @returns the instant local midnight occurred at.
 */
export function localDayStartUtc(parts: ZonedParts, tz: string): Date {
  const midnightGuess = Date.UTC(parts.y, parts.mo - 1, parts.d, 0, 0);
  return new Date(midnightGuess - tzOffsetMs(new Date(midnightGuess), tz));
}

/** Format {@link ZonedParts} as an ISO calendar date (`YYYY-MM-DD`). */
export function localDateOf(parts: ZonedParts): string {
  return `${String(parts.y)}-${String(parts.mo).padStart(2, '0')}-${String(parts.d).padStart(2, '0')}`;
}

/** One person's local day: its date label and the UTC instant it began. */
export interface LocalDay {
  readonly localDate: string;
  readonly timezone: string;
  readonly startsAt: Date;
}

/**
 * Resolve the local day an instant falls in.
 *
 * @param instant - The reference instant.
 * @param tz - An IANA timezone.
 * @returns the day's date label, zone, and starting instant.
 */
export function localDayFor(instant: Date, tz: string): LocalDay {
  const parts = zonedParts(instant, tz);
  return { localDate: localDateOf(parts), timezone: tz, startsAt: localDayStartUtc(parts, tz) };
}

/**
 * Resolve a named local date's starting instant.
 *
 * @param localDate - An ISO calendar date (`YYYY-MM-DD`).
 * @param tz - An IANA timezone.
 * @returns the day's starting instant, or `null` when the date is unparseable.
 */
export function localDayStartOf(localDate: string, tz: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (!match) return null;
  const [, y, mo, d] = match;
  return localDayStartUtc({ y: Number(y), mo: Number(mo), d: Number(d), h: 0, mi: 0 }, tz);
}

/**
 * Whether a named local date is still in the future for someone in `tz`.
 *
 * @remarks
 * A pure predicate rather than a guard that throws, so the HTTP route and the agent tool can refuse
 * in their own vocabularies while agreeing on the question. Both need to: a future day answered as
 * "nothing happened" is the same conflation of *quiet* with *unknowable* that the per-source states
 * exist to prevent.
 *
 * @param localDate - An ISO calendar date (`YYYY-MM-DD`).
 * @param now - The reference instant.
 * @param tz - An IANA timezone.
 * @returns `true` when the date has not begun yet.
 */
export function isFutureLocalDate(localDate: string, now: Date, tz: string): boolean {
  return localDate > localDateOf(zonedParts(now, tz));
}
