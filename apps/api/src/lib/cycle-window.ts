/**
 * `@docket/api` — pure cycle auto-roll math (no DB, no Hono).
 *
 * @remarks
 * DECISION (product): cycles auto-roll on a configurable cadence
 * (`team.cycle_cadence_weeks`, default 1 = weekly; weekly for personal) so the user
 * never creates cycles by hand. This module computes the week-aligned, cadence-stepped
 * windows around a given instant and derives which window is "current" (today within
 * `[startsAt, endsAt]`). It is deterministic and side-effect free so the route layer
 * can lazily ensure-and-persist these windows idempotently and so the math is unit-
 * testable in isolation.
 *
 * @see {@link ensureCycleWindow} (in `routes/cycles.ts`) for the persistence wrapper.
 */

/** Milliseconds in one calendar day. */
const DAY_MS = 86_400_000;
/** Milliseconds in one week (7 days). */
const WEEK_MS = 7 * DAY_MS;

/**
 * The absolute week-aligned epoch every team's cadence steps from: Monday
 * 2024-01-01 00:00:00 UTC (a Monday).
 *
 * @remarks
 * Anchoring every window to one shared epoch (rather than to "now") is what makes a
 * window's sequential `number` stable: a given calendar window always maps to the
 * same index regardless of when the rolling window is (re)computed, so re-running the
 * ensure pass never renumbers or duplicates an existing cycle.
 */
const EPOCH_MS = Date.UTC(2024, 0, 1, 0, 0, 0, 0);

/** How many cadence windows to keep behind today in the rolling window. */
export const WINDOW_PAST = 4;
/** How many cadence windows to keep ahead of today in the rolling window. */
export const WINDOW_FUTURE = 4;

/**
 * A single auto-rolled cycle window: a closed `[startsAt, endsAt]` interval (the two
 * stored timestamps) and the stable sequential `number` derived from its offset from
 * {@link EPOCH_MS}.
 *
 * @remarks
 * Consecutive windows tile the timeline without overlapping: `endsAt` is one
 * millisecond before the next window's `startsAt`, so for any instant exactly one
 * window is "current".
 */
export interface CycleWindowSlot {
  /** Stable sequential cycle number (1-based index of this window from the epoch). */
  readonly number: number;
  /** Inclusive window start (week-aligned, Monday 00:00 UTC of a cadence boundary). */
  readonly startsAt: Date;
  /** Inclusive window end: one millisecond before the next window opens. */
  readonly endsAt: Date;
}

/** Normalize a cadence to a sane positive integer week count (defaults/guards to 1). */
export function normalizeCadenceWeeks(weeks: number): number {
  if (!Number.isFinite(weeks)) return 1;
  const w = Math.floor(weeks);
  return w >= 1 ? w : 1;
}

/**
 * The cadence-window index that contains `instant` (0-based, counted from
 * {@link EPOCH_MS}). May be negative for instants before the epoch.
 */
function windowIndexFor(instant: Date, cadenceWeeks: number): number {
  const cadenceMs = cadenceWeeks * WEEK_MS;
  return Math.floor((instant.getTime() - EPOCH_MS) / cadenceMs);
}

/** Build the {@link CycleWindowSlot} for a given (epoch-relative) window index + cadence. */
function slotForIndex(index: number, cadenceWeeks: number): CycleWindowSlot {
  const cadenceMs = cadenceWeeks * WEEK_MS;
  const startMs = EPOCH_MS + index * cadenceMs;
  return {
    // Window indices are epoch-relative and can be negative; the cycle `number` is the
    // 1-based sequential count, kept positive by offsetting past the earliest window we
    // would ever generate. The offset is large enough that any realistic date stays > 0.
    number: index + NUMBER_OFFSET,
    startsAt: new Date(startMs),
    // One ms before the next window opens, so consecutive windows never overlap and
    // exactly one window contains any given instant.
    endsAt: new Date(startMs + cadenceMs - 1),
  };
}

/**
 * Offset added to the epoch-relative window index to produce the stored cycle
 * `number`.
 *
 * @remarks
 * Window indices are 0 at the epoch (2024-01-01) and negative before it; the DB
 * `number` column is a plain integer with a per-team uniqueness constraint, so any
 * stable bijection works. Offsetting by a large constant keeps numbers positive for
 * every plausible date (the epoch itself becomes #1,000,001) while preserving the
 * monotonic, gap-free sequence the UI expects.
 */
const NUMBER_OFFSET = 1_000_001;

/**
 * Compute the rolling window of cycle slots around `now`: {@link WINDOW_PAST} windows
 * behind, the current window, and {@link WINDOW_FUTURE} windows ahead, week-aligned and
 * stepping by `cadenceWeeks`.
 *
 * @param now - The reference instant ("today").
 * @param cadenceWeeks - The team's cadence in weeks (normalized to >= 1).
 * @returns The ordered (ascending by start) list of window slots.
 */
export function rollingWindow(now: Date, cadenceWeeks: number): CycleWindowSlot[] {
  const cadence = normalizeCadenceWeeks(cadenceWeeks);
  const center = windowIndexFor(now, cadence);
  const slots: CycleWindowSlot[] = [];
  for (let i = center - WINDOW_PAST; i <= center + WINDOW_FUTURE; i += 1) {
    slots.push(slotForIndex(i, cadence));
  }
  return slots;
}

/**
 * Whether `now` falls within a window `[startsAt, endsAt]` (inclusive on both ends).
 *
 * @remarks
 * The auto-rolled windows tile the timeline without overlap (`endsAt` is one ms before
 * the next window opens), so for an auto-rolled team exactly one window contains a given
 * instant. Inclusivity on both ends matches the product's "today is in this cycle"
 * intuition and is also applied to manually-created cycles; if two manual cycles overlap,
 * the route resolves `current` deterministically (it picks the earliest-starting match).
 */
export function isWithinWindow(now: Date, startsAt: Date, endsAt: Date): boolean {
  const t = now.getTime();
  return t >= startsAt.getTime() && t <= endsAt.getTime();
}
