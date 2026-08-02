/**
 * `@docket/api` — the weekly planner.
 *
 * @remarks
 * One pure function, {@link planWeek}, turns a person's standing commitments and declared
 * availability into a placed week. It is deliberately deterministic and has no I/O, no clock of
 * its own and no model call: the same inputs always produce the same week, which is what makes
 * "does the scheduler ever put work in protected time?" a question a test can answer across a
 * hundred generated weeks instead of a question of trust.
 *
 * **The passes, in order, and why that order.**
 *
 * 1. *Anchored commitments first* — filming sessions and community meetings are the least
 *    movable things in the week (a location, a crew, other people's calendars), and they are the
 *    longest. First-fit-decreasing over them wastes the least field time.
 * 2. *Contiguous desk work* — writing and architecture, longest first, never split.
 * 3. *Reflection* — every meeting-shaped commitment in the week, whether the planner placed it
 *    or it was already on the calendar, gets a debrief placed after it on the same day and
 *    linked back to it. This is derived, never asked for: it is the single largest source of
 *    "and a debrief after each of those" input the person would otherwise have to supply.
 * 4. *Interstitial reading* — only into travel/waiting gaps. If there is no travel that week
 *    there is no reading, and the run says so rather than putting a paperback at a desk.
 * 5. *Backfill* — the remaining holes, largest first, absorbed by whichever shapes the person
 *    allowed to absorb slack, until no hole exceeds the configured threshold.
 *
 * Protected time never enters the pool at all (see `availability.ts`), so no pass can reach it.
 */
import type {
  AvailabilityWindow,
  AvailabilityWindowKind,
  SchedulingCommitment,
  UnplacedDemandOut,
  WorkShape,
} from '@docket/types';
import { WORK_SHAPES, workShapeProfile } from '@docket/types';

import type { BusyItem } from './availability';
import { detectTransitGaps, expandAvailability } from './availability';
import type { ActualsIndex, DurationSource } from './duration-model';
import { estimateSessionMinutes } from './duration-model';
import type { Interval, Span } from './intervals';
import { SpanPool, spanMinutes, subtractIntervals } from './intervals';
import { localDateString } from './zoned-time';

/** One block the planner decided to place. */
export interface PlannedBlock {
  /** Stable within a run; becomes the block's identity before it has a database id. */
  readonly key: string;
  readonly shape: WorkShape;
  readonly title: string;
  readonly date: string;
  readonly start: number;
  readonly end: number;
  readonly organizationId: string | null;
  readonly location: string | null;
  readonly attendees: readonly string[];
  readonly commitmentId: string | null;
  /** The planned block this one is anchored to, when both come from this run. */
  readonly anchorKey: string | null;
  /** The already-existing calendar item this one is anchored to, when it predates the run. */
  readonly anchorCalendarItemId: string | null;
  readonly durationSource: DurationSource;
}

/** Everything {@link planWeek} needs, and nothing it does not. */
export interface PlanWeekInput {
  readonly weekStartDate: string;
  readonly timezone: string;
  readonly windows: readonly AvailabilityWindow[];
  readonly commitments: readonly SchedulingCommitment[];
  readonly busy: readonly BusyItem[];
  readonly actuals: ActualsIndex;
  readonly reflectionForMeetings: boolean;
  readonly backfillShapes: readonly WorkShape[];
  readonly maxUnplannedGapMinutes: number;
  readonly minTransitGapMinutes: number;
  readonly maxTransitGapMinutes: number;
}

/** A remaining hole in the week, reported honestly rather than hidden. */
export interface PlannedGap {
  readonly date: string;
  readonly kind: AvailabilityWindowKind;
  readonly start: number;
  readonly end: number;
  readonly minutes: number;
}

/** The planner's complete answer. */
export interface PlanWeekResult {
  readonly blocks: readonly PlannedBlock[];
  readonly unplaced: readonly UnplacedDemandOut[];
  readonly availableMinutes: number;
  readonly scheduledMinutes: number;
  readonly protectedMinutes: number;
  readonly gaps: readonly PlannedGap[];
  readonly largestGapMinutes: number;
}

/** A single session to place, expanded from a commitment. */
interface Demand {
  readonly commitment: SchedulingCommitment;
  readonly index: number;
  readonly minutes: number;
  readonly durationSource: DurationSource;
}

/** Blocks whose presence in the week earns a debrief afterwards. */
const MEETING_SHAPES: ReadonlySet<WorkShape> = new Set<WorkShape>([
  'filming_session',
  'community_meeting',
]);

/**
 * Check a commitment can produce a well-formed block of its shape.
 *
 * @returns the reason it cannot, or null when it can.
 */
function unmetRequirement(commitment: SchedulingCommitment): UnplacedDemandOut['reason'] | null {
  const profile = workShapeProfile(commitment.shape);
  for (const requirement of profile.requires) {
    if (requirement === 'location' && (commitment.location ?? '').trim() === '') {
      return 'missing_location';
    }
    if (requirement === 'attendees' && commitment.attendees.length === 0) {
      return 'missing_attendees';
    }
  }
  return null;
}

/** The window kinds a shape will accept, preferred first. */
function acceptableKinds(shape: WorkShape): readonly AvailabilityWindowKind[] {
  const profile = workShapeProfile(shape);
  return [profile.windowKind, ...profile.fallbackWindowKinds];
}

/**
 * Plan one week.
 *
 * @param input - Availability, commitments, existing commitments, and measured durations.
 * @returns the placed blocks, everything that could not be placed and why, and the coverage
 *   numbers computed from what actually remained free.
 */
export function planWeek(input: PlanWeekInput): PlanWeekResult {
  const busyIntervals = input.busy.map((b) => ({ start: b.start, end: b.end }));
  const availability = expandAvailability({
    weekStartDate: input.weekStartDate,
    timezone: input.timezone,
    windows: input.windows,
    busy: busyIntervals,
  });

  // Travel windows are discovered from the day's own located commitments, then held to the same
  // protection rules as any declared window.
  const inferredTransit = detectTransitGaps({
    busy: input.busy,
    timezone: input.timezone,
    minMinutes: input.minTransitGapMinutes,
    maxMinutes: input.maxTransitGapMinutes,
  });
  // Protection outranks discovery: a gap that lands in protected time is not travel time, and a
  // gap overlapping something already booked is not free.
  const transit = subtractDeclared(inferredTransit, [
    ...availability.protectedIntervals,
    ...busyIntervals,
  ]);
  // Discovery *reclassifies* rather than adds: you cannot be at a desk while you are on the bus,
  // so minutes an inferred gap shares with a declared desk window become transit, not a second
  // copy of the same minute in two pools.
  const nonTransitFree = subtractIntervals(
    availability.free,
    transit.map((s) => ({ start: s.start, end: s.end })),
  );

  const pool = new SpanPool([...nonTransitFree, ...transit]);
  // What the week offered before anything was placed: everything allocatable, plus the minutes
  // already spoken for by commitments that sit inside declared windows — those are scheduled
  // time, not missing time.
  const busyInsideWindows = Math.max(
    0,
    availability.availableMinutes - availability.free.reduce((sum, s) => sum + spanMinutes(s), 0),
  );
  const totalAvailableMinutes = pool.remainingMinutes() + busyInsideWindows;

  const blocks: PlannedBlock[] = [];
  const unplaced: UnplacedDemandOut[] = [];

  const active = input.commitments.filter((c) => c.active && c.sessionsPerWeek > 0);

  // Requirement failures are reported before any placement runs, so a missing location is never
  // reported as "the week was full".
  const placeable: SchedulingCommitment[] = [];
  for (const commitment of active) {
    const unmet = unmetRequirement(commitment);
    if (unmet !== null) {
      unplaced.push({
        commitmentId: commitment.id,
        shape: commitment.shape,
        title: commitment.title,
        requestedSessions: commitment.sessionsPerWeek,
        placedSessions: 0,
        reason: unmet,
      });
      continue;
    }
    placeable.push(commitment);
  }

  const demands: Demand[] = [];
  for (const commitment of placeable) {
    const estimate = estimateSessionMinutes({
      shape: commitment.shape,
      taskId: commitment.taskId,
      requestedMinutes: commitment.minutesPerSession,
      actuals: input.actuals,
    });
    for (let i = 0; i < commitment.sessionsPerWeek; i += 1) {
      demands.push({
        commitment,
        index: i,
        minutes: estimate.minutes,
        durationSource: estimate.source,
      });
    }
  }

  // First-fit-decreasing: the longest, least-movable sessions claim their windows first.
  // Interstitial shapes are held back to their own pass; they only ever consume travel time,
  // which nothing else competes for.
  const scheduledDemands = demands
    .filter((d) => workShapeProfile(d.commitment.shape).placement === 'contiguous')
    .sort((a, b) => b.minutes - a.minutes);

  const placedDatesByCommitment = new Map<string, Set<string>>();
  const placedCountByCommitment = new Map<string, number>();

  const reflectionProfile = workShapeProfile('reflection_debrief');
  const reflectionMinutes = input.reflectionForMeetings ? reflectionProfile.defaultMinutes : 0;

  /** Place a debrief immediately after `anchor`, on the same day; null when nothing fits. */
  const placeDebrief = (anchor: {
    readonly key: string | null;
    readonly calendarItemId: string | null;
    readonly title: string;
    readonly end: number;
    readonly date: string;
    readonly organizationId: string | null;
  }): PlannedBlock | null => {
    for (const kind of acceptableKinds('reflection_debrief')) {
      const span = pool.take(reflectionProfile.defaultMinutes, {
        kind,
        notBefore: anchor.end,
        date: anchor.date,
      });
      if (span === null) continue;
      const block: PlannedBlock = {
        key: `plan-${String(blocks.length)}`,
        shape: 'reflection_debrief',
        title: `Debrief: ${anchor.title}`,
        date: span.date,
        start: span.start,
        end: span.end,
        organizationId: anchor.organizationId,
        location: null,
        attendees: [],
        commitmentId: null,
        anchorKey: anchor.key,
        anchorCalendarItemId: anchor.calendarItemId,
        durationSource: 'shape_default',
      };
      blocks.push(block);
      return block;
    }
    return null;
  };

  for (const demand of scheduledDemands) {
    const profile = workShapeProfile(demand.commitment.shape);
    const used = placedDatesByCommitment.get(demand.commitment.id) ?? new Set<string>();
    // A meeting-shaped block that leaves no room to debrief has not really been scheduled, so
    // the first attempts insist the debrief fits too; only if the week is genuinely that tight
    // does the block land somewhere it cannot be followed.
    const needsDebrief = reflectionMinutes > 0 && MEETING_SHAPES.has(demand.commitment.shape);
    const attempts: { trailing: number; spread: boolean }[] = needsDebrief
      ? [
          { trailing: reflectionMinutes, spread: true },
          { trailing: reflectionMinutes, spread: false },
          { trailing: 0, spread: true },
          { trailing: 0, spread: false },
        ]
      : [
          { trailing: 0, spread: true },
          { trailing: 0, spread: false },
        ];

    let span: Span | null = null;
    outer: for (const attempt of attempts) {
      for (const kind of acceptableKinds(demand.commitment.shape)) {
        span = pool.take(demand.minutes, {
          kind,
          reserveAfterMinutes: profile.bufferAfterMinutes,
          ...(attempt.trailing > 0 ? { requireTrailingMinutes: attempt.trailing } : {}),
          ...(attempt.spread ? { excludeDates: used } : {}),
        });
        if (span !== null) break outer;
      }
    }
    if (span === null) continue;
    used.add(span.date);
    placedDatesByCommitment.set(demand.commitment.id, used);
    placedCountByCommitment.set(
      demand.commitment.id,
      (placedCountByCommitment.get(demand.commitment.id) ?? 0) + 1,
    );
    const block = toBlock(demand, span, blocks.length);
    blocks.push(block);
    if (
      needsDebrief &&
      placeDebrief({
        key: block.key,
        calendarItemId: null,
        title: block.title,
        end: block.end,
        date: block.date,
        organizationId: block.organizationId,
      }) === null
    ) {
      unplaced.push({
        commitmentId: null,
        shape: 'reflection_debrief',
        title: `Debrief: ${block.title}`,
        requestedSessions: 1,
        placedSessions: 0,
        reason: 'no_matching_window',
      });
    }
  }

  // Pre-existing calendar events with attendees earn a debrief too — the week is debriefed as it
  // actually is, not only as the planner built it.
  if (input.reflectionForMeetings) {
    const existingAnchors = input.busy
      .filter((item) => item.attendees.length > 0)
      .map((item) => ({
        key: null,
        calendarItemId: item.id,
        title: item.title,
        end: item.end,
        date: localDateString(new Date(item.start), input.timezone),
        organizationId: null,
      }))
      .sort((a, b) => a.end - b.end);
    for (const anchor of existingAnchors) {
      if (placeDebrief(anchor) !== null) continue;
      unplaced.push({
        commitmentId: null,
        shape: 'reflection_debrief',
        title: `Debrief: ${anchor.title}`,
        requestedSessions: 1,
        placedSessions: 0,
        reason: 'no_matching_window',
      });
    }
  }

  // Interstitial: travel time only, and reported as unplaced when there is no travel that week.
  const interstitialDemands = demands.filter(
    (d) => workShapeProfile(d.commitment.shape).placement === 'interstitial',
  );
  for (const demand of interstitialDemands) {
    const profile = workShapeProfile(demand.commitment.shape);
    // Longest-first, not earliest-first: the value of interstitial time scales with how long the
    // stretch is. A 60-minute bus ride is where a chapter actually gets read; a 10-minute walk to
    // the stop is where a bookmark gets moved. Taking the longest remaining stretch each time also
    // spreads reading across distinct rides rather than stacking it into one morning commute.
    const span =
      pool.takeLongest(demand.minutes, Math.min(demand.minutes, profile.minMinutes), {
        kind: profile.windowKind,
      }) ?? pool.take(profile.minMinutes, { kind: profile.windowKind });
    if (span === null) continue;
    placedCountByCommitment.set(
      demand.commitment.id,
      (placedCountByCommitment.get(demand.commitment.id) ?? 0) + 1,
    );
    blocks.push(toBlock(demand, span, blocks.length));
  }

  // Backfill: attack the largest hole until none exceeds the threshold or nothing can absorb it.
  backfill({
    pool,
    blocks,
    backfillShapes: input.backfillShapes,
    maxUnplannedGapMinutes: input.maxUnplannedGapMinutes,
  });

  for (const commitment of placeable) {
    const placed = placedCountByCommitment.get(commitment.id) ?? 0;
    if (placed >= commitment.sessionsPerWeek) continue;
    unplaced.push({
      commitmentId: commitment.id,
      shape: commitment.shape,
      title: commitment.title,
      requestedSessions: commitment.sessionsPerWeek,
      placedSessions: placed,
      reason:
        workShapeProfile(commitment.shape).placement === 'interstitial'
          ? 'no_matching_window'
          : 'week_full',
    });
  }

  const remaining = pool.spans;
  const remainingMinutes = remaining.reduce((sum, s) => sum + spanMinutes(s), 0);
  const largestGapMinutes = remaining.reduce((max, s) => Math.max(max, spanMinutes(s)), 0);
  const gaps: PlannedGap[] = remaining
    .filter((s) => spanMinutes(s) > input.maxUnplannedGapMinutes)
    .map((s) => ({
      date: s.date,
      kind: s.kind,
      start: s.start,
      end: s.end,
      minutes: spanMinutes(s),
    }));

  return {
    blocks: blocks.sort((a, b) => a.start - b.start),
    unplaced,
    availableMinutes: totalAvailableMinutes,
    scheduledMinutes: Math.max(0, totalAvailableMinutes - remainingMinutes),
    protectedMinutes: availability.protectedMinutes,
    gaps,
    largestGapMinutes,
  };
}

/** Turn one satisfied demand into a block. */
function toBlock(demand: Demand, span: Span, ordinal: number): PlannedBlock {
  return {
    key: `plan-${String(ordinal)}`,
    shape: demand.commitment.shape,
    title: demand.commitment.title,
    date: span.date,
    start: span.start,
    end: span.end,
    organizationId: demand.commitment.organizationId,
    location: demand.commitment.location,
    attendees: demand.commitment.attendees,
    commitmentId: demand.commitment.id,
    anchorKey: null,
    anchorCalendarItemId: null,
    durationSource: demand.durationSource,
  };
}

/**
 * Absorb the largest remaining holes with the shapes the person allowed to absorb slack.
 *
 * @remarks
 * Bounded by an iteration cap rather than trusting the pool to shrink: a shape whose minimum
 * exceeds every remaining hole would otherwise spin. Each pass takes the single longest hole of
 * a kind some eligible shape accepts; when no shape accepts the longest hole's kind, that kind
 * is retired and the pass moves on, so a field-only gap never blocks desk backfill.
 */
function backfill(input: {
  readonly pool: SpanPool;
  readonly blocks: PlannedBlock[];
  readonly backfillShapes: readonly WorkShape[];
  readonly maxUnplannedGapMinutes: number;
}): void {
  const eligible = input.backfillShapes.filter((s) => workShapeProfile(s).backfillEligible);
  if (eligible.length === 0) return;

  const retiredKinds = new Set<AvailabilityWindowKind>();
  let rotation = 0;
  for (let guard = 0; guard < 500; guard += 1) {
    const candidate = input.pool.spans
      .filter((s) => !retiredKinds.has(s.kind))
      .reduce<Span | null>(
        (best, s) => (best === null || spanMinutes(s) > spanMinutes(best) ? s : best),
        null,
      );
    if (candidate === null) return;
    const candidateMinutes = spanMinutes(candidate);
    if (candidateMinutes <= input.maxUnplannedGapMinutes) return;

    const shapesForKind = eligible.filter((shape) =>
      acceptableKinds(shape).includes(candidate.kind),
    );
    if (shapesForKind.length === 0) {
      retiredKinds.add(candidate.kind);
      continue;
    }
    // Rotate so a week of leftovers is not one enormous writing block.
    const shape = shapesForKind[rotation % shapesForKind.length];
    rotation += 1;
    /* v8 ignore next -- @preserve defensive: the modulo index is always in range */
    if (shape === undefined) return;
    const profile = workShapeProfile(shape);
    if (candidateMinutes < profile.minMinutes) {
      retiredKinds.add(candidate.kind);
      continue;
    }
    const span = input.pool.takeLongest(profile.maxMinutes, profile.minMinutes, {
      kind: candidate.kind,
    });
    if (span === null) {
      retiredKinds.add(candidate.kind);
      continue;
    }
    input.blocks.push({
      key: `plan-${String(input.blocks.length)}`,
      shape,
      title: profile.label,
      date: span.date,
      start: span.start,
      end: span.end,
      organizationId: null,
      location: null,
      attendees: [],
      commitmentId: null,
      anchorKey: null,
      anchorCalendarItemId: null,
      durationSource: 'fitted',
    });
  }
}

/**
 * Keep only the parts of inferred travel gaps that are not already declared availability.
 *
 * @remarks
 * Without this an inferred gap that happens to sit inside a declared desk window would be added
 * to the pool a second time, and the same minute could be handed out twice.
 */
function subtractDeclared(inferred: readonly Span[], declared: readonly Interval[]): Span[] {
  if (inferred.length === 0) return [];
  const blockers = declared.map((s) => ({ start: s.start, end: s.end }));
  const out: Span[] = [];
  for (const span of inferred) {
    let cursor = span.start;
    const cuts = blockers
      .filter((b) => b.start < span.end && b.end > span.start)
      .sort((a, b) => a.start - b.start);
    for (const cut of cuts) {
      if (cut.start > cursor) out.push({ ...span, start: cursor, end: cut.start });
      cursor = Math.max(cursor, cut.end);
      if (cursor >= span.end) break;
    }
    if (cursor < span.end) out.push({ ...span, start: cursor, end: span.end });
  }
  return out.filter((s) => s.end > s.start);
}

/** The distinct shapes present in a set of blocks, in taxonomy order. */
export function shapesPresent(blocks: readonly PlannedBlock[]): WorkShape[] {
  const present = new Set(blocks.map((b) => b.shape));
  return WORK_SHAPES.filter((s) => present.has(s));
}
