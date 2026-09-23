/**
 * Parsing typed time estimates: the inverse of {@link formatEstimate} in `./format-estimate`.
 *
 * @remarks
 * People type estimates the way they say them: `45`, `45m`, `90 min`, `1h`, `1.5`, `1.5h`, `1h30`,
 * `1h 30m`, `1:30`. A bare whole number is minutes and a bare decimal is hours, as time entry reads
 * them. Results are whole minutes from 0 (a real estimate: no time) to {@link MAX_ESTIMATE_MINUTES};
 * anything else is `null`, so a picker offers nothing to commit.
 */

/** The longest estimate accepted: 99:59, the widest value the `h:mm` display is sized for. */
export const MAX_ESTIMATE_MINUTES = 99 * 60 + 59;

/** Minutes in one hour. */
const MINUTES_PER_HOUR = 60;

/** `1:30` — hours and two-digit minutes. */
const CLOCK_PATTERN = /^(\d{1,2}):([0-5]\d)$/;

/** `1.5` — a bare decimal, read as hours. */
const DECIMAL_HOURS_PATTERN = /^\d*\.\d+$/;

/** `1h 30m`, `1.5h`, `1h30`, `90 min`, `45` — an optional hours part, then an optional minutes part. */
const UNIT_PATTERN =
  /^(?:(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours))?\s*(?:(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes)?)?$/;

/** A `~` token in a title: `~30m`, `~1h30`, `~1:30`. */
const TITLE_TOKEN_PATTERN = /(^|\s)~(\S+)/g;

/** A title token with no unit or colon (`~5`), which reads as "about five", not as a time. */
const UNITLESS_TOKEN_PATTERN = /^[\d.]+$/;

/** Whole minutes within range, or `null`. */
function inRange(minutes: number): number | null {
  const total = Math.round(minutes);
  return total >= 0 && total <= MAX_ESTIMATE_MINUTES ? total : null;
}

/**
 * Parse a typed time estimate.
 *
 * @param text - What the person typed.
 * @returns whole minutes, or `null` when the text is not a time from 0:00 to 99:59.
 */
export function parseEstimate(text: string): number | null {
  const input = text.trim().toLowerCase();
  if (input === '') return null;
  const clock = CLOCK_PATTERN.exec(input);
  if (clock) return inRange(Number(clock[1]) * MINUTES_PER_HOUR + Number(clock[2]));
  if (DECIMAL_HOURS_PATTERN.test(input)) return inRange(Number(input) * MINUTES_PER_HOUR);
  const units = UNIT_PATTERN.exec(input);
  if (!units || (units[1] === undefined && units[2] === undefined)) return null;
  const hours = Number(units[1] ?? 0);
  const minutes = Number(units[2] ?? 0);
  return inRange(hours * MINUTES_PER_HOUR + minutes);
}

/** A title with its `~` estimate token taken out. */
export interface TitleEstimate {
  /** The estimate the token named, in whole minutes. */
  readonly minutes: number;
  /** The title without the token. */
  readonly title: string;
}

/**
 * Read a `~` estimate token from a task title, as in `Draft the brief ~45m`.
 *
 * @remarks
 * The token needs a unit or a colon, so `Invite ~5 people` keeps its meaning.
 *
 * @param title - The typed title.
 * @returns the first valid token's minutes and the title without it, or `null` when there is none.
 */
export function parseTitleEstimate(title: string): TitleEstimate | null {
  for (const match of title.matchAll(TITLE_TOKEN_PATTERN)) {
    const token = match[2] ?? '';
    const minutes = UNITLESS_TOKEN_PATTERN.test(token) ? null : parseEstimate(token);
    if (minutes === null) continue;
    const start = match.index + (match[1]?.length ?? 0);
    const rest = `${title.slice(0, start)}${title.slice(start + 1 + token.length)}`;
    return { minutes, title: rest.replace(/\s{2,}/g, ' ').trim() };
  }
  return null;
}
