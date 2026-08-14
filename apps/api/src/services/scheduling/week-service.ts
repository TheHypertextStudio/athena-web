/**
 * `@docket/api` — the one entry point that turns "plan my week" into a planned week.
 *
 * @remarks
 * This is the whole "extremely little input" claim in one function. {@link generateWeek} takes a
 * Hub id and, optionally, which week; everything else — availability, standing commitments,
 * measured durations, what is already booked — it reads for itself. There is no per-item prompt
 * anywhere in the call path and no confirmation step: one invocation in, a placed week out, with
 * an honest list of anything it could not place.
 */
import type { Database } from '@docket/db';
import { genId } from '@docket/db';
import type { WeekCoverageOut, WeekPlanOut } from '@docket/types';
import { workShapeProfile } from '@docket/types';
import type { z } from 'zod';

import {
  clearSchedulerBlocks,
  loadActuals,
  loadBusyItems,
  loadOrganizationNames,
  loadSchedulingPreferences,
  persistPlannedBlocks,
  recordScheduleRun,
  weekBounds,
} from './repository';
import type { ResolvedSchedulingPreferences } from './repository';
import type { PlanWeekResult, PlannedBlock } from './week-planner';
import { planWeek, shapesPresent } from './week-planner';
import { addDays, localDateString, weekStartOf } from './zoned-time';

/**
 * The pre-brand wire shape of a generated week.
 *
 * @remarks
 * `z.input` rather than `z.output`: the service produces plain database strings, and `ok()`
 * brands them when it validates on the way out.
 */
export type WeekPlanBody = z.input<typeof WeekPlanOut>;

/** How far back the duration model looks for measured sessions. */
const ACTUALS_LOOKBACK_DAYS = 120;

/** Options for {@link generateWeek}. */
export interface GenerateWeekInput {
  readonly hubId: string;
  readonly userId: string;
  readonly weekStartDate?: string;
  readonly dryRun?: boolean;
  readonly replaceExisting?: boolean;
  /** Injected so a run is reproducible in a test rather than dependent on the wall clock. */
  readonly now?: Date;
}

/** Resolve which local Monday a run covers. */
function resolveWeekStart(explicit: string | undefined, timezone: string, now: Date): string {
  if (explicit !== undefined) return weekStartOf(explicit);
  return weekStartOf(localDateString(now, timezone));
}

/**
 * Generate (and, unless this is a dry run, persist) one week.
 *
 * @param db - The database client.
 * @param input - Whose week, which week, and whether to write it.
 * @returns the placed week, its coverage report, and everything that could not be placed.
 */
export async function generateWeek(db: Database, input: GenerateWeekInput): Promise<WeekPlanBody> {
  const now = input.now ?? new Date();
  const preferences = await loadSchedulingPreferences(db, input.hubId);
  const weekStartDate = resolveWeekStart(input.weekStartDate, preferences.timezone, now);
  const bounds = weekBounds(weekStartDate, preferences.timezone);

  // A regeneration clears only the scheduler's own previous blocks — never a person's.
  if (input.dryRun !== true && input.replaceExisting !== false) {
    await clearSchedulerBlocks(db, input.userId, bounds);
  }

  const busy = await loadBusyItems(db, input.userId, bounds);
  const actuals = await loadActuals(
    db,
    input.hubId,
    new Date(now.getTime() - ACTUALS_LOOKBACK_DAYS * 86_400_000),
  );

  const result = planWeek({
    weekStartDate,
    timezone: preferences.timezone,
    windows: preferences.windows,
    commitments: preferences.commitments,
    busy,
    actuals,
    reflectionForMeetings: preferences.reflectionForMeetings,
    backfillShapes: preferences.backfillShapes,
    maxUnplannedGapMinutes: preferences.maxUnplannedGapMinutes,
    minTransitGapMinutes: preferences.minTransitGapMinutes,
    maxTransitGapMinutes: preferences.maxTransitGapMinutes,
  });

  let runId: string | null = null;
  let persistedIds = new Map<string, string>();
  if (input.dryRun !== true) {
    runId = await recordScheduleRun(db, {
      hubId: input.hubId,
      weekStartDate,
      timezone: preferences.timezone,
      blockCount: result.blocks.length,
      availableMinutes: result.availableMinutes,
      scheduledMinutes: result.scheduledMinutes,
      protectedMinutes: result.protectedMinutes,
      largestGapMinutes: result.largestGapMinutes,
      unplaced: result.unplaced.map((u) => ({ ...u })),
    });
    const persisted = await persistPlannedBlocks(db, {
      userId: input.userId,
      runId,
      blocks: result.blocks,
    });
    persistedIds = new Map(persisted.map((p) => [p.key, p.calendarItemId]));
  }

  const orgNames = await loadOrganizationNames(
    db,
    result.blocks.flatMap((b) => (b.organizationId === null ? [] : [b.organizationId])),
  );

  return toWeekPlan({
    runId,
    weekStartDate,
    preferences,
    result,
    persistedIds,
    orgNames,
    generatedAt: now,
    dryRun: input.dryRun === true,
  });
}

/** Assemble the wire shape from a planning result. */
export function toWeekPlan(input: {
  readonly runId: string | null;
  readonly weekStartDate: string;
  readonly preferences: ResolvedSchedulingPreferences;
  readonly result: PlanWeekResult;
  readonly persistedIds: ReadonlyMap<string, string>;
  readonly orgNames: ReadonlyMap<string, string>;
  readonly generatedAt: Date;
  readonly dryRun: boolean;
}): WeekPlanBody {
  const { result, preferences } = input;
  const coverage: z.input<typeof WeekCoverageOut> = {
    availableMinutes: result.availableMinutes,
    scheduledMinutes: result.scheduledMinutes,
    coveragePercent:
      result.availableMinutes === 0
        ? 0
        : Math.round((result.scheduledMinutes / result.availableMinutes) * 1000) / 10,
    protectedMinutes: result.protectedMinutes,
    largestGapMinutes: result.largestGapMinutes,
    gaps: result.gaps.map((g) => ({
      date: g.date,
      startsAt: new Date(g.start).toISOString(),
      endsAt: new Date(g.end).toISOString(),
      minutes: g.minutes,
      windowKind: g.kind,
    })),
    withinThreshold: result.largestGapMinutes <= preferences.maxUnplannedGapMinutes,
  };

  return {
    runId: input.runId,
    weekStartDate: input.weekStartDate,
    weekEndDate: addDays(input.weekStartDate, 6),
    timezone: preferences.timezone,
    generatedAt: input.generatedAt.toISOString(),
    dryRun: input.dryRun,
    blocks: result.blocks.map((b) => serializeBlock(b, input.persistedIds, input.orgNames)),
    unplaced: result.unplaced.map((u) => ({ ...u })),
    coverage,
    shapesPresent: shapesPresent(result.blocks),
    // One invocation, no per-item confirmations. The number is recorded rather than asserted so
    // a future flow that does ask something has to say so here.
    userInputCount: 1,
  };
}

/** One planned block on the wire. */
function serializeBlock(
  block: PlannedBlock,
  persistedIds: ReadonlyMap<string, string>,
  orgNames: ReadonlyMap<string, string>,
): WeekPlanBody['blocks'][number] {
  const anchorId =
    block.anchorCalendarItemId ??
    (block.anchorKey === null ? null : (persistedIds.get(block.anchorKey) ?? null));
  return {
    calendarItemId: persistedIds.get(block.key) ?? null,
    shape: block.shape,
    shapeLabel: workShapeProfile(block.shape).label,
    title: block.title,
    startsAt: new Date(block.start).toISOString(),
    endsAt: new Date(block.end).toISOString(),
    date: block.date,
    minutes: Math.round((block.end - block.start) / 60_000),
    organizationId: block.organizationId,
    organizationName:
      block.organizationId === null ? null : (orgNames.get(block.organizationId) ?? null),
    location: block.location,
    workPlaceId: block.workPlaceId,
    attendees: [...block.attendees],
    origin: 'scheduler',
    anchorCalendarItemId: anchorId,
    commitmentId: block.commitmentId,
    durationSource: block.durationSource,
  };
}

/** Mint an id for a new commitment. */
export function newCommitmentId(): string {
  return genId();
}
