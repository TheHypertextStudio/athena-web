/** Shared storage operations for the versioned personal work schedule aggregate. */
import { hub, workPlace, workScheduleException, workSchedulePlan, type Database } from '@docket/db';
import { addCalendarDays } from '@docket/planning/calendar-date';
import {
  WorkScheduleExceptionOut,
  WorkScheduleOut,
  WorkSchedulePlanOut,
  type WorkScheduleCycleDay,
  type WorkSchedulePlanCreate,
  type WorkScheduleSegment,
} from '@docket/planning/work-location-contract';
import { and, asc, eq, gt, gte, inArray, isNull, lte, or } from 'drizzle-orm';

import { ConflictError, NotFoundError } from '../../error';

/** Require the row that a successful persistence operation must return. */
function persisted<T>(value: T | undefined, operation: string): T {
  if (value === undefined) throw new Error(`Work-schedule persistence failed: ${operation}`);
  return value;
}

/** Require an existing Hub without exposing a caller-selected Hub through the HTTP contract. */
export async function requireScheduleHub(database: Database, hubId: string): Promise<void> {
  const row = (
    await database.select({ id: hub.id }).from(hub).where(eq(hub.id, hubId)).limit(1)
  )[0];
  if (!row) throw new NotFoundError('Hub not found');
}

/** Return every saved-place id referenced by a plan or replacement. */
export function referencedSchedulePlaceIds(cycleDays: readonly WorkScheduleCycleDay[]): string[] {
  return [
    ...new Set(
      cycleDays.flatMap((day) =>
        day.segments.flatMap((segment) =>
          segment.location.type === 'saved_place' ? [segment.location.placeId] : [],
        ),
      ),
    ),
  ];
}

/** Store schedule segments in chronological order regardless of client edit order. */
export function orderedScheduleSegments(
  segments: readonly WorkScheduleSegment[],
): WorkScheduleSegment[] {
  return [...segments].sort((left, right) => left.startMinute - right.startMinute);
}

function orderedCycleDays(cycleDays: readonly WorkScheduleCycleDay[]): WorkScheduleCycleDay[] {
  return cycleDays.map((day) => ({ segments: orderedScheduleSegments(day.segments) }));
}

/** Require every referenced saved place to be active and owned by the same Hub. */
export async function requireSchedulePlaces(
  database: Database,
  hubId: string,
  placeIds: string[],
): Promise<void> {
  if (placeIds.length === 0) return;
  const rows = await database
    .select({ id: workPlace.id })
    .from(workPlace)
    .where(
      and(
        eq(workPlace.hubId, hubId),
        inArray(workPlace.id, placeIds),
        isNull(workPlace.archivedAt),
      ),
    );
  if (rows.length !== placeIds.length) throw new NotFoundError('Work place not found');
}

/** Project one stored plan row onto the public contract. */
export function schedulePlanOut(row: typeof workSchedulePlan.$inferSelect): WorkSchedulePlanOut {
  return WorkSchedulePlanOut.parse({
    id: row.id,
    anchorDate: row.anchorDate,
    timezone: row.timezone,
    effectiveFrom: row.effectiveFrom,
    effectiveUntil: row.effectiveUntil,
    cycleDays: row.cycleDays,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

/** Project one stored dated replacement onto the public contract. */
export function scheduleExceptionOut(
  row: typeof workScheduleException.$inferSelect,
): WorkScheduleExceptionOut {
  return WorkScheduleExceptionOut.parse({
    id: row.id,
    planVersionId: row.planVersionId,
    date: row.date,
    segments: row.segments,
    origin: row.origin,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

/** Read schedule rows without starting migration or another transaction. */
export async function readStoredWorkSchedule(
  database: Database,
  hubId: string,
): Promise<WorkScheduleOut> {
  const [plans, exceptions] = await Promise.all([
    database
      .select()
      .from(workSchedulePlan)
      .where(eq(workSchedulePlan.hubId, hubId))
      .orderBy(asc(workSchedulePlan.effectiveFrom)),
    database
      .select()
      .from(workScheduleException)
      .where(eq(workScheduleException.hubId, hubId))
      .orderBy(asc(workScheduleException.date)),
  ]);
  return WorkScheduleOut.parse({
    plans: plans.map(schedulePlanOut),
    exceptions: exceptions.map(scheduleExceptionOut),
  });
}

/** Insert one plan version while preserving the aggregate's effective-date invariants. */
export async function insertWorkSchedulePlanVersion(
  transaction: Database,
  hubId: string,
  input: WorkSchedulePlanCreate,
): Promise<typeof workSchedulePlan.$inferSelect> {
  const future = await transaction
    .select({ id: workSchedulePlan.id })
    .from(workSchedulePlan)
    .where(
      and(
        eq(workSchedulePlan.hubId, hubId),
        gt(workSchedulePlan.effectiveFrom, input.effectiveFrom),
      ),
    )
    .limit(1);
  if (future[0]) throw new ConflictError('A later work-schedule version already exists');
  const current = (
    await transaction
      .select()
      .from(workSchedulePlan)
      .where(
        and(
          eq(workSchedulePlan.hubId, hubId),
          lte(workSchedulePlan.effectiveFrom, input.effectiveFrom),
          or(
            isNull(workSchedulePlan.effectiveUntil),
            gt(workSchedulePlan.effectiveUntil, input.effectiveFrom),
            eq(workSchedulePlan.effectiveUntil, input.effectiveFrom),
          ),
        ),
      )
      .limit(1)
  )[0];
  if (current?.effectiveFrom === input.effectiveFrom) {
    throw new ConflictError('A work-schedule version already starts on that date');
  }
  if (current) {
    await transaction
      .update(workSchedulePlan)
      .set({ effectiveUntil: addCalendarDays(input.effectiveFrom, -1), updatedAt: new Date() })
      .where(eq(workSchedulePlan.id, current.id));
  }
  const next = persisted(
    (
      await transaction
        .insert(workSchedulePlan)
        .values({ hubId, ...input, cycleDays: orderedCycleDays(input.cycleDays) })
        .returning()
    )[0],
    'create plan version',
  );
  if (current) {
    await transaction
      .update(workScheduleException)
      .set({ planVersionId: next.id, updatedAt: new Date() })
      .where(
        and(
          eq(workScheduleException.planVersionId, current.id),
          gte(workScheduleException.date, input.effectiveFrom),
        ),
      );
  }
  return next;
}
