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
  const wallAsUtc = Date.UTC(parts.y, parts.mo - 1, parts.d, 0, 0);
  // Two passes, because one is wrong on DST-transition days. The offset has to be sampled *at the
  // instant being solved for*, and the first sample can only be taken at the wall clock read as UTC —
  // which sits up to a day away from local midnight and so can fall on the other side of a
  // transition. Re-solving with the offset that actually applies at the candidate converges.
  //
  // Concretely: for 2026-04-05 in Pacific/Auckland the single pass returned 12:00Z on the 4th, an
  // hour after local midnight, because it sampled +12 (NZST) when local midnight was still +13
  // (NZDT). Sydney lands an hour late the same way and Santiago an hour early, so the error runs in
  // both directions and no fixed correction absorbs it.
  const firstPass = wallAsUtc - tzOffsetMs(new Date(wallAsUtc), tz);
  return new Date(wallAsUtc - tzOffsetMs(new Date(firstPass), tz));
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
  const parts = parseLocalDate(localDate);
  return parts === null ? null : localDayStartUtc(parts, tz);
}

/** Parse an ISO calendar date into midnight {@link ZonedParts}, or null when it is not one. */
function parseLocalDate(localDate: string): ZonedParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (!match) return null;
  const [, y, mo, d] = match;
  return { y: Number(y), mo: Number(mo), d: Number(d), h: 0, mi: 0 };
}

/**
 * The instant the day *after* `localDate` begins in `tz` — that day's exclusive end.
 *
 * @remarks
 * Not `start + 24h`. A local day is 23 or 25 hours long on the two DST transition days a year, so a
 * fixed duration ends an hour early on one and an hour late on the other: the short day silently omits
 * an hour of work, and the long one pulls in the first hour of the next day and files it under the
 * wrong date. Advancing the calendar date and re-solving midnight gets the real boundary, whatever
 * the zone did in between.
 *
 * @param localDate - An ISO calendar date (`YYYY-MM-DD`).
 * @param tz - An IANA timezone.
 * @returns the next local midnight, or `null` when the date is unparseable.
 */
export function nextLocalDayStart(localDate: string, tz: string): Date | null {
  const parts = parseLocalDate(localDate);
  if (parts === null) return null;
  // Calendar arithmetic in UTC, which is only being used to roll the date over month and year ends;
  // the instant it produces is discarded and only its Y/M/D reach `localDayStartUtc`.
  const next = new Date(Date.UTC(parts.y, parts.mo - 1, parts.d + 1));
  return localDayStartUtc(
    {
      y: next.getUTCFullYear(),
      mo: next.getUTCMonth() + 1,
      d: next.getUTCDate(),
      h: 0,
      mi: 0,
    },
    tz,
  );
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
