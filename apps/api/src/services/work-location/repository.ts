/** Hub-owned persistence for canonical work location. */
import {
  calendarConnection,
  calendarItem,
  db,
  hub,
  timeContext,
  timeInterval,
  timeRecord,
  workLocationAssertion,
  workLocationException,
  workLocationObservation,
  workLocationProfile,
  workLocationSyncAccount,
  workLocationWrite,
  workPlace,
  workPlaceProviderMapping,
  type Database,
} from '@docket/db';
import {
  WorkLocationAssertionListOut,
  WorkLocationAssertionOut,
  WorkLocationOccurrenceException,
  WorkLocationProfileOut,
  WorkLocationProjectionOut,
  WorkLocationSyncOut,
  WorkPlaceCreate,
  WorkPlaceListOut,
  WorkPlaceOut,
  type WorkLocationAssertionCreate,
  type WorkLocationCurrentUpdate,
  type WorkLocationObservationCreate,
  type WorkLocationProfileUpdate,
  type WorkLocationSchedule,
  type WorkPlaceUpdate,
} from '@docket/types';
import { and, asc, desc, eq, inArray, isNull, lte, ne } from 'drizzle-orm';

import { ConflictError, NotFoundError } from '../../error';
import { addCalendarDays, mondayWeekdayIndex } from '../../lib/recurrence/calendar-date';
import { instantAt, localDateString } from '../scheduling/zoned-time';
import {
  GOOGLE_WORK_LOCATION_CAPABILITIES,
  MICROSOFT_WORK_LOCATION_CAPABILITIES,
} from './provider-contract';
import type { WorkLocationResolutionState } from './resolver';

/** Require the row/result that a successful persistence operation must return. */
function persisted<T>(value: T | undefined, operation: string): T {
  if (value === undefined) throw new Error(`Work-location persistence failed: ${operation}`);
  return value;
}

/** Resolve one Hub and its owner without accepting either from a public DTO. */
async function ownedHub(
  database: Database,
  hubId: string,
): Promise<{ userId: string; timezone: string }> {
  const row = (
    await database
      .select({ userId: hub.userId, preferences: hub.preferences })
      .from(hub)
      .where(eq(hub.id, hubId))
      .limit(1)
  )[0];
  if (!row) throw new NotFoundError('Hub not found');
  return { userId: row.userId, timezone: row.preferences.timezone ?? 'UTC' };
}

/** Require an active saved place owned by the Hub. */
async function requirePlace(database: Database, hubId: string, placeId: string) {
  const row = (
    await database
      .select()
      .from(workPlace)
      .where(
        and(eq(workPlace.hubId, hubId), eq(workPlace.id, placeId), isNull(workPlace.archivedAt)),
      )
      .limit(1)
  )[0];
  if (!row) throw new NotFoundError('Work place not found');
  return row;
}

/** Require an active assertion owned by the Hub. */
async function requireAssertion(database: Database, hubId: string, assertionId: string) {
  const row = (
    await database
      .select()
      .from(workLocationAssertion)
      .where(
        and(
          eq(workLocationAssertion.hubId, hubId),
          eq(workLocationAssertion.id, assertionId),
          isNull(workLocationAssertion.archivedAt),
        ),
      )
      .limit(1)
  )[0];
  if (!row) throw new NotFoundError('Work location assertion not found');
  return row;
}

/** Validate that every provider mapping belongs to the Hub owner's linked accounts. */
async function requireOwnedMappings(
  database: Database,
  hubId: string,
  mappings: NonNullable<WorkPlaceCreate['providerMappings']>,
): Promise<void> {
  if (mappings.length === 0) return;
  const { userId } = await ownedHub(database, hubId);
  const ids = [...new Set(mappings.map((mapping) => mapping.connectionId))];
  const rows = await database
    .select({ id: calendarConnection.id })
    .from(calendarConnection)
    .where(and(eq(calendarConnection.userId, userId), inArray(calendarConnection.id, ids)));
  if (rows.length !== ids.length) throw new NotFoundError('Calendar connection not found');
}

/** Load account-aware mappings for a set of places. */
async function mappingsByPlace(database: Database, hubId: string, placeIds: readonly string[]) {
  const grouped = new Map<string, WorkPlaceOut['providerMappings']>();
  if (placeIds.length === 0) return grouped;
  const rows = await database
    .select()
    .from(workPlaceProviderMapping)
    .where(
      and(
        eq(workPlaceProviderMapping.hubId, hubId),
        inArray(workPlaceProviderMapping.placeId, [...placeIds]),
      ),
    );
  for (const row of rows) {
    const mapping = {
      provider: row.provider,
      connectionId: row.connectionId,
      classification: row.classification,
      providerPlaceId: row.providerPlaceId,
      metadata: row.metadata,
    } as WorkPlaceOut['providerMappings'][number];
    grouped.set(row.placeId, [...(grouped.get(row.placeId) ?? []), mapping]);
  }
  return grouped;
}

/** Project one database place row onto its owner-visible DTO. */
function placeOut(
  row: typeof workPlace.$inferSelect,
  providerMappings: WorkPlaceOut['providerMappings'],
): WorkPlaceOut {
  const hasGeofence =
    row.geofenceLatitude !== null &&
    row.geofenceLongitude !== null &&
    row.geofenceRadiusMeters !== null;
  return WorkPlaceOut.parse({
    id: row.id,
    name: row.name,
    address: row.address,
    geofence: hasGeofence
      ? {
          latitude: row.geofenceLatitude,
          longitude: row.geofenceLongitude,
          radiusMeters: row.geofenceRadiusMeters,
        }
      : null,
    providerMappings,
    sort: row.sort,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

/** Return every active saved place and the independent home designation. */
export async function listWorkPlaces(database: Database, hubId: string): Promise<WorkPlaceListOut> {
  await ownedHub(database, hubId);
  const [rows, profileRows] = await Promise.all([
    database
      .select()
      .from(workPlace)
      .where(and(eq(workPlace.hubId, hubId), isNull(workPlace.archivedAt)))
      .orderBy(asc(workPlace.sort), asc(workPlace.createdAt)),
    database
      .select({ homePlaceId: workLocationProfile.homePlaceId })
      .from(workLocationProfile)
      .where(eq(workLocationProfile.hubId, hubId))
      .limit(1),
  ]);
  const mappings = await mappingsByPlace(
    database,
    hubId,
    rows.map((row) => row.id),
  );
  return WorkPlaceListOut.parse({
    items: rows.map((row) => placeOut(row, mappings.get(row.id) ?? [])),
    profile: { homePlaceId: profileRows[0]?.homePlaceId ?? null },
  });
}

/** Create one arbitrary saved place and any explicitly supplied provider mappings. */
export async function createWorkPlace(
  database: Database,
  hubId: string,
  input: WorkPlaceCreate,
): Promise<WorkPlaceOut> {
  const parsed = WorkPlaceCreate.parse(input);
  const providerMappings = parsed.providerMappings;
  await requireOwnedMappings(database, hubId, providerMappings);
  const row = await database.transaction(async (tx) => {
    const created = persisted(
      await tx
        .insert(workPlace)
        .values({
          hubId,
          name: parsed.name,
          address: parsed.address,
          geofenceLatitude: parsed.geofence?.latitude ?? null,
          geofenceLongitude: parsed.geofence?.longitude ?? null,
          geofenceRadiusMeters: parsed.geofence?.radiusMeters ?? null,
          sort: parsed.sort,
        })
        .returning()
        .then((rows) => rows[0]),
      'create place',
    );
    if (providerMappings.length > 0) {
      await tx.insert(workPlaceProviderMapping).values(
        providerMappings.map((mapping) => ({
          hubId,
          placeId: created.id,
          connectionId: mapping.connectionId,
          provider: mapping.provider,
          classification: mapping.classification,
          providerPlaceId: mapping.providerPlaceId,
          metadata: mapping.metadata,
        })),
      );
    }
    return created;
  });
  return placeOut(row, providerMappings);
}

/** Replace only the supplied saved-place fields and account mappings. */
export async function updateWorkPlace(
  database: Database,
  hubId: string,
  placeId: string,
  input: WorkPlaceUpdate,
): Promise<WorkPlaceOut> {
  await requirePlace(database, hubId, placeId);
  if (input.providerMappings) await requireOwnedMappings(database, hubId, input.providerMappings);
  await database.transaction(async (tx) => {
    await tx
      .update(workPlace)
      .set({
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.address === undefined ? {} : { address: input.address }),
        ...(input.sort === undefined ? {} : { sort: input.sort }),
        ...(input.geofence === undefined
          ? {}
          : {
              geofenceLatitude: input.geofence?.latitude ?? null,
              geofenceLongitude: input.geofence?.longitude ?? null,
              geofenceRadiusMeters: input.geofence?.radiusMeters ?? null,
            }),
        updatedAt: new Date(),
      })
      .where(and(eq(workPlace.hubId, hubId), eq(workPlace.id, placeId)));
    if (input.providerMappings) {
      await tx
        .delete(workPlaceProviderMapping)
        .where(
          and(
            eq(workPlaceProviderMapping.hubId, hubId),
            eq(workPlaceProviderMapping.placeId, placeId),
          ),
        );
      if (input.providerMappings.length > 0) {
        await tx.insert(workPlaceProviderMapping).values(
          input.providerMappings.map((mapping) => ({
            hubId,
            placeId,
            connectionId: mapping.connectionId,
            provider: mapping.provider,
            classification: mapping.classification,
            providerPlaceId: mapping.providerPlaceId,
            metadata: mapping.metadata,
          })),
        );
      }
    }
  });
  const result = await listWorkPlaces(database, hubId);
  return persisted(
    result.items.find((place) => place.id === placeId),
    'read updated place',
  );
}

/** Whether an assertion still describes now or any future instant. */
function scheduleHasCurrentOrFuture(schedule: WorkLocationSchedule, now: Date): boolean {
  switch (schedule.type) {
    case 'one_off_timed':
      return new Date(schedule.endsAt) > now;
    case 'one_off_all_day':
      return instantAt(addCalendarDays(schedule.date, 1), 0, schedule.timezone) > now;
    case 'weekly_all_day':
    case 'weekly_timed':
      return (
        schedule.effectiveUntil === null ||
        instantAt(addCalendarDays(schedule.effectiveUntil, 1), 0, schedule.timezone) > now
      );
  }
}

/** Soft-retire a place unless designations or active/future assertions still refer to it. */
export async function archiveWorkPlace(
  database: Database,
  hubId: string,
  placeId: string,
  now = new Date(),
): Promise<void> {
  await requirePlace(database, hubId, placeId);
  const profile = (
    await database
      .select({ homePlaceId: workLocationProfile.homePlaceId })
      .from(workLocationProfile)
      .where(eq(workLocationProfile.hubId, hubId))
      .limit(1)
  )[0];
  if (profile?.homePlaceId === placeId) {
    throw new ConflictError('Remove the home designation before retiring this place');
  }
  const assertions = await database
    .select({
      id: workLocationAssertion.id,
      placeId: workLocationAssertion.placeId,
      schedule: workLocationAssertion.schedule,
    })
    .from(workLocationAssertion)
    .where(and(eq(workLocationAssertion.hubId, hubId), isNull(workLocationAssertion.archivedAt)));
  const relevant = assertions.filter(
    (assertion) =>
      assertion.placeId === placeId && scheduleHasCurrentOrFuture(assertion.schedule, now),
  );
  if (relevant.length > 0) {
    throw new ConflictError('Retire or move active and future work-location assertions first');
  }
  if (assertions.length > 0) {
    const replacements = await database
      .select({ assertionId: workLocationException.assertionId, date: workLocationException.date })
      .from(workLocationException)
      .where(
        and(
          eq(workLocationException.hubId, hubId),
          eq(workLocationException.replacementPlaceId, placeId),
          inArray(
            workLocationException.assertionId,
            assertions.map((assertion) => assertion.id),
          ),
        ),
      );
    if (replacements.some((replacement) => replacement.date >= now.toISOString().slice(0, 10))) {
      throw new ConflictError('Move future work-location occurrence replacements first');
    }
  }
  await database
    .update(workPlace)
    .set({ archivedAt: now, updatedAt: now })
    .where(and(eq(workPlace.hubId, hubId), eq(workPlace.id, placeId)));
}

/** Replace the optional singular home designation with an owned active place or null. */
export async function updateWorkLocationProfile(
  database: Database,
  hubId: string,
  input: WorkLocationProfileUpdate,
): Promise<WorkLocationProfileOut> {
  await ownedHub(database, hubId);
  if (input.homePlaceId !== null) await requirePlace(database, hubId, input.homePlaceId);
  const row = persisted(
    await database
      .insert(workLocationProfile)
      .values({ hubId, homePlaceId: input.homePlaceId })
      .onConflictDoUpdate({
        target: workLocationProfile.hubId,
        set: { homePlaceId: input.homePlaceId, updatedAt: new Date() },
      })
      .returning({ homePlaceId: workLocationProfile.homePlaceId })
      .then((rows) => rows[0]),
    'update profile',
  );
  return WorkLocationProfileOut.parse(row);
}

/** Load all occurrence exceptions for a set of assertions. */
async function exceptionsByAssertion(
  database: Database,
  hubId: string,
  assertionIds: readonly string[],
): Promise<Map<string, WorkLocationOccurrenceException[]>> {
  const grouped = new Map<string, WorkLocationOccurrenceException[]>();
  if (assertionIds.length === 0) return grouped;
  const rows = await database
    .select()
    .from(workLocationException)
    .where(
      and(
        eq(workLocationException.hubId, hubId),
        inArray(workLocationException.assertionId, [...assertionIds]),
      ),
    )
    .orderBy(asc(workLocationException.date));
  for (const row of rows) {
    const exception = WorkLocationOccurrenceException.parse(
      row.action === 'cancel'
        ? { action: 'cancel', date: row.date }
        : {
            action: 'replace',
            date: row.date,
            placeId: row.replacementPlaceId,
            schedule: row.replacementSchedule,
          },
    );
    grouped.set(row.assertionId, [...(grouped.get(row.assertionId) ?? []), exception]);
  }
  return grouped;
}

/** Project one assertion row and its exceptions onto the public canonical DTO. */
function assertionOut(
  row: typeof workLocationAssertion.$inferSelect,
  exceptions: readonly WorkLocationOccurrenceException[],
): WorkLocationAssertionOut {
  return WorkLocationAssertionOut.parse({
    id: row.id,
    placeId: row.placeId,
    schedule: row.schedule,
    exceptions,
    origin: row.origin,
    originProvider: row.originProvider,
    originConnectionId: row.originConnectionId,
    revision: row.revision,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

/** Return every active explicit assertion owned by a Hub. */
export async function listWorkLocationAssertions(
  database: Database,
  hubId: string,
): Promise<WorkLocationAssertionListOut> {
  await ownedHub(database, hubId);
  const rows = await database
    .select()
    .from(workLocationAssertion)
    .where(and(eq(workLocationAssertion.hubId, hubId), isNull(workLocationAssertion.archivedAt)))
    .orderBy(asc(workLocationAssertion.createdAt));
  const exceptions = await exceptionsByAssertion(
    database,
    hubId,
    rows.map((row) => row.id),
  );
  return WorkLocationAssertionListOut.parse({
    items: rows.map((row) => assertionOut(row, exceptions.get(row.id) ?? [])),
  });
}

/** Create one explicit one-off or weekly canonical assertion. */
export async function createWorkLocationAssertion(
  database: Database,
  hubId: string,
  input: WorkLocationAssertionCreate,
): Promise<WorkLocationAssertionOut> {
  await requirePlace(database, hubId, input.placeId);
  const row = persisted(
    await database
      .insert(workLocationAssertion)
      .values({ hubId, placeId: input.placeId, schedule: input.schedule })
      .returning()
      .then((rows) => rows[0]),
    'create assertion',
  );
  return assertionOut(row, []);
}

/** Patch one owned assertion and advance its canonical revision. */
export async function updateWorkLocationAssertion(
  database: Database,
  hubId: string,
  assertionId: string,
  input: {
    readonly placeId?: string | undefined;
    readonly schedule?: WorkLocationSchedule | undefined;
  },
): Promise<WorkLocationAssertionOut> {
  const existing = await requireAssertion(database, hubId, assertionId);
  if (input.placeId) await requirePlace(database, hubId, input.placeId);
  await database
    .update(workLocationAssertion)
    .set({
      placeId: input.placeId ?? existing.placeId,
      schedule: input.schedule ?? existing.schedule,
      revision: existing.revision + 1,
      updatedAt: new Date(),
    })
    .where(and(eq(workLocationAssertion.hubId, hubId), eq(workLocationAssertion.id, assertionId)));
  return persisted(
    (await listWorkLocationAssertions(database, hubId)).items.find(
      (assertion) => assertion.id === assertionId,
    ),
    'read updated assertion',
  );
}

/** Soft-delete one owned assertion so bound provider deletes may be fanned out. */
export async function archiveWorkLocationAssertion(
  database: Database,
  hubId: string,
  assertionId: string,
): Promise<WorkLocationAssertionOut> {
  const existing = await requireAssertion(database, hubId, assertionId);
  const now = new Date();
  const updated = persisted(
    await database
      .update(workLocationAssertion)
      .set({ archivedAt: now, updatedAt: now, revision: existing.revision + 1 })
      .where(and(eq(workLocationAssertion.hubId, hubId), eq(workLocationAssertion.id, assertionId)))
      .returning()
      .then((rows) => rows[0]),
    'archive assertion',
  );
  const exceptions = await exceptionsByAssertion(database, hubId, [assertionId]);
  return assertionOut(updated, exceptions.get(assertionId) ?? []);
}

/** Create or replace one weekly occurrence exception and advance the series revision. */
export async function setWorkLocationOccurrence(
  database: Database,
  hubId: string,
  assertionId: string,
  date: string,
  exception: WorkLocationOccurrenceException,
): Promise<WorkLocationAssertionOut> {
  const assertion = await requireAssertion(database, hubId, assertionId);
  if (assertion.schedule.type !== 'weekly_all_day' && assertion.schedule.type !== 'weekly_timed') {
    throw new ConflictError('Only weekly assertions have occurrence exceptions');
  }
  if (date !== exception.date) throw new ConflictError('Occurrence date does not match the route');
  if (
    date < assertion.schedule.effectiveFrom ||
    (assertion.schedule.effectiveUntil !== null && date > assertion.schedule.effectiveUntil) ||
    !assertion.schedule.weekdays.includes(mondayWeekdayIndex(date))
  ) {
    throw new ConflictError('That date is not an occurrence of this weekly assertion');
  }
  if (exception.action === 'replace') {
    await requirePlace(database, hubId, exception.placeId);
    // `date` names the original weekly occurrence. The one-off replacement owns its target date,
    // which may differ when a person drags that occurrence to another day. The DTO has already
    // validated the replacement as one finite one-off schedule, while the checks above prove that
    // the exception key still identifies a real occurrence in this series.
  }
  await database.transaction(async (tx) => {
    await tx
      .insert(workLocationException)
      .values({
        hubId,
        assertionId,
        date,
        action: exception.action,
        replacementPlaceId: exception.action === 'replace' ? exception.placeId : null,
        replacementSchedule: exception.action === 'replace' ? exception.schedule : null,
      })
      .onConflictDoUpdate({
        target: [workLocationException.assertionId, workLocationException.date],
        set: {
          action: exception.action,
          replacementPlaceId: exception.action === 'replace' ? exception.placeId : null,
          replacementSchedule: exception.action === 'replace' ? exception.schedule : null,
          updatedAt: new Date(),
        },
      });
    await tx
      .update(workLocationAssertion)
      .set({ revision: assertion.revision + 1, updatedAt: new Date() })
      .where(
        and(eq(workLocationAssertion.hubId, hubId), eq(workLocationAssertion.id, assertionId)),
      );
  });
  return persisted(
    (await listWorkLocationAssertions(database, hubId)).items.find(
      (candidate) => candidate.id === assertionId,
    ),
    'read occurrence update',
  );
}

/** Remove one occurrence exception and advance the owning series revision. */
export async function clearWorkLocationOccurrence(
  database: Database,
  hubId: string,
  assertionId: string,
  date: string,
): Promise<WorkLocationAssertionOut> {
  const assertion = await requireAssertion(database, hubId, assertionId);
  const removed = await database
    .delete(workLocationException)
    .where(
      and(
        eq(workLocationException.hubId, hubId),
        eq(workLocationException.assertionId, assertionId),
        eq(workLocationException.date, date),
      ),
    )
    .returning({ id: workLocationException.id });
  if (!removed[0]) throw new NotFoundError('Work location occurrence exception not found');
  await database
    .update(workLocationAssertion)
    .set({ revision: assertion.revision + 1, updatedAt: new Date() })
    .where(and(eq(workLocationAssertion.hubId, hubId), eq(workLocationAssertion.id, assertionId)));
  return persisted(
    (await listWorkLocationAssertions(database, hubId)).items.find(
      (candidate) => candidate.id === assertionId,
    ),
    'read restored occurrence',
  );
}

/** Insert a coordinate-free, server-stamped foreground-device observation. */
export async function recordDeviceWorkLocation(
  database: Database,
  hubId: string,
  input: WorkLocationObservationCreate,
  now = new Date(),
): Promise<void> {
  await requirePlace(database, hubId, input.placeId);
  await database.delete(workLocationObservation).where(lte(workLocationObservation.expiresAt, now));
  await database.insert(workLocationObservation).values({
    hubId,
    placeId: input.placeId,
    source: 'device',
    accuracyMeters: input.accuracyMeters,
    observedAt: now,
    expiresAt: new Date(now.getTime() + 15 * 60_000),
  });
}

/** Replace the Hub's manual current-location override. */
export async function setManualCurrentWorkLocation(
  database: Database,
  hubId: string,
  input: WorkLocationCurrentUpdate,
  now = new Date(),
): Promise<void> {
  await requirePlace(database, hubId, input.placeId);
  const { timezone } = await ownedHub(database, hubId);
  const expiresAt = input.expiresAt
    ? new Date(input.expiresAt)
    : instantAt(addCalendarDays(localDateString(now, timezone), 1), 0, timezone);
  if (expiresAt <= now) throw new ConflictError('Current-location override must end in the future');
  await database.transaction(async (tx) => {
    await tx
      .delete(workLocationObservation)
      .where(
        and(eq(workLocationObservation.hubId, hubId), eq(workLocationObservation.source, 'manual')),
      );
    await tx.insert(workLocationObservation).values({
      hubId,
      placeId: input.placeId,
      source: 'manual',
      accuracyMeters: null,
      observedAt: now,
      expiresAt,
    });
  });
}

/** Clear the Hub's manual current-location override. */
export async function clearManualCurrentWorkLocation(
  database: Database,
  hubId: string,
): Promise<void> {
  await ownedHub(database, hubId);
  await database
    .delete(workLocationObservation)
    .where(
      and(eq(workLocationObservation.hubId, hubId), eq(workLocationObservation.source, 'manual')),
    );
}

/** Load all active canonical evidence required by the pure resolver. */
export async function loadWorkLocationResolutionState(
  database: Database,
  hubId: string,
  now = new Date(),
): Promise<WorkLocationResolutionState> {
  const { userId, timezone } = await ownedHub(database, hubId);
  await database.delete(workLocationObservation).where(lte(workLocationObservation.expiresAt, now));
  const [placeRows, assertionList, observations, itemRows, timeRows] = await Promise.all([
    database
      .select({ id: workPlace.id, name: workPlace.name })
      .from(workPlace)
      .where(and(eq(workPlace.hubId, hubId), isNull(workPlace.archivedAt))),
    listWorkLocationAssertions(database, hubId),
    database
      .select()
      .from(workLocationObservation)
      .where(eq(workLocationObservation.hubId, hubId))
      .orderBy(desc(workLocationObservation.observedAt)),
    database
      .select({
        id: calendarItem.id,
        placeId: calendarItem.workPlaceId,
        startsAt: calendarItem.startsAt,
        endsAt: calendarItem.endsAt,
        allDayStartDate: calendarItem.allDayStartDate,
        allDayEndDate: calendarItem.allDayEndDate,
        timezone: calendarItem.timezone,
      })
      .from(calendarItem)
      .where(
        and(
          eq(calendarItem.userId, userId),
          isNull(calendarItem.archivedAt),
          ne(calendarItem.status, 'cancelled'),
        ),
      ),
    database
      .select({
        placeId: calendarItem.workPlaceId,
        startsAt: timeInterval.startedAt,
        endsAt: timeInterval.endedAt,
      })
      .from(timeInterval)
      .innerJoin(timeRecord, eq(timeRecord.id, timeInterval.timeRecordId))
      .innerJoin(timeContext, eq(timeContext.timeRecordId, timeRecord.id))
      .innerJoin(calendarItem, eq(calendarItem.id, timeContext.docketEntityId))
      .where(
        and(
          eq(timeInterval.hubId, hubId),
          eq(timeInterval.mode, 'human_active'),
          isNull(timeInterval.endedAt),
          isNull(timeInterval.supersededById),
          eq(timeContext.role, 'planning_context'),
          eq(calendarItem.userId, userId),
        ),
      ),
  ]);

  return {
    timezone,
    places: placeRows,
    assertions: assertionList.items.map((assertion) => ({
      id: assertion.id,
      placeId: assertion.placeId,
      schedule: assertion.schedule,
      exceptions: assertion.exceptions,
      revision: assertion.revision,
      updatedAt: new Date(assertion.updatedAt),
      tieBreaker: assertion.originConnectionId ?? assertion.id,
    })),
    observations: observations.map((observation) => ({
      source: observation.source as 'manual' | 'device',
      placeId: observation.placeId,
      accuracyMeters: observation.accuracyMeters,
      observedAt: observation.observedAt,
      expiresAt: observation.expiresAt,
    })),
    workBlocks: itemRows.flatMap((item) => {
      if (!item.placeId) return [];
      if (item.startsAt && item.endsAt) {
        return [
          { id: item.id, placeId: item.placeId, startsAt: item.startsAt, endsAt: item.endsAt },
        ];
      }
      if (item.allDayStartDate && item.allDayEndDate) {
        const zone = item.timezone ?? timezone;
        return [
          {
            id: item.id,
            placeId: item.placeId,
            startsAt: instantAt(item.allDayStartDate, 0, zone),
            endsAt: instantAt(item.allDayEndDate, 0, zone),
          },
        ];
      }
      return [];
    }),
    activeTimeContexts: timeRows.flatMap((row) =>
      row.placeId ? [{ placeId: row.placeId, startsAt: row.startsAt, endsAt: row.endsAt }] : [],
    ),
  };
}

/** Resolve an authenticated user's personal Hub id for the public route layer. */
export async function resolveWorkLocationHubId(
  userId: string,
  database: Database = db,
): Promise<string> {
  const row = (
    await database.select({ id: hub.id }).from(hub).where(eq(hub.userId, userId)).limit(1)
  )[0];
  if (!row) throw new NotFoundError('Hub not found');
  return row.id;
}

/** Materialize one location-sync state row for every linked calendar account. */
async function ensureWorkLocationSyncAccounts(database: Database, hubId: string): Promise<void> {
  const { userId } = await ownedHub(database, hubId);
  const connections = await database
    .select()
    .from(calendarConnection)
    .where(
      and(eq(calendarConnection.userId, userId), ne(calendarConnection.status, 'disconnected')),
    );
  if (connections.length === 0) return;
  await database
    .insert(workLocationSyncAccount)
    .values(
      connections.map((connection) => {
        const supported = connection.provider === 'google';
        const capabilities =
          connection.provider === 'microsoft'
            ? MICROSOFT_WORK_LOCATION_CAPABILITIES
            : GOOGLE_WORK_LOCATION_CAPABILITIES;
        const missingWriteScope =
          connection.scopeState !== null && !connection.scopeState.calendarWrite;
        const needsReauth = connection.status === 'reauth_required';
        return {
          hubId,
          connectionId: connection.id,
          provider: connection.provider,
          state: !supported
            ? 'unsupported'
            : needsReauth || missingWriteScope
              ? 'action_required'
              : 'pending',
          reason: !supported
            ? 'unsupported_account'
            : needsReauth
              ? 'reauth_required'
              : missingWriteScope
                ? 'missing_scope'
                : null,
          capabilities,
        };
      }),
    )
    .onConflictDoNothing({ target: workLocationSyncAccount.connectionId });

  // Reauthorization and scope changes are account facts, not sticky sync outcomes. Refresh those
  // states without disturbing healthy cursors or an unsupported-recurrence decision that still
  // needs the user to choose a conversion.
  for (const connection of connections) {
    const supported = connection.provider === 'google';
    const missingWriteScope =
      connection.scopeState !== null && !connection.scopeState.calendarWrite;
    const needsReauth = connection.status === 'reauth_required';
    if (!supported || missingWriteScope || needsReauth) {
      await database
        .update(workLocationSyncAccount)
        .set({
          state: supported ? 'action_required' : 'unsupported',
          reason: !supported
            ? 'unsupported_account'
            : needsReauth
              ? 'reauth_required'
              : 'missing_scope',
          updatedAt: new Date(),
        })
        .where(eq(workLocationSyncAccount.connectionId, connection.id));
      continue;
    }
  }
}

/** Return capability, bootstrap, delivery, and action-required state for every linked account. */
export async function listWorkLocationSync(
  database: Database,
  hubId: string,
): Promise<WorkLocationSyncOut> {
  await ensureWorkLocationSyncAccounts(database, hubId);
  const { userId } = await ownedHub(database, hubId);
  const [accounts, writes] = await Promise.all([
    database
      .select({
        connectionId: workLocationSyncAccount.connectionId,
        provider: workLocationSyncAccount.provider,
        accountEmail: calendarConnection.accountEmail,
        accountName: calendarConnection.accountName,
        state: workLocationSyncAccount.state,
        reason: workLocationSyncAccount.reason,
        capabilities: workLocationSyncAccount.capabilities,
        bootstrapCompletedAt: workLocationSyncAccount.bootstrapCompletedAt,
        lastSucceededAt: workLocationSyncAccount.lastSucceededAt,
      })
      .from(workLocationSyncAccount)
      .innerJoin(
        calendarConnection,
        eq(calendarConnection.id, workLocationSyncAccount.connectionId),
      )
      .where(
        and(
          eq(workLocationSyncAccount.hubId, hubId),
          eq(calendarConnection.userId, userId),
          ne(calendarConnection.status, 'disconnected'),
        ),
      )
      .orderBy(asc(calendarConnection.createdAt)),
    database
      .select({ connectionId: workLocationWrite.connectionId, status: workLocationWrite.status })
      .from(workLocationWrite)
      .where(eq(workLocationWrite.hubId, hubId)),
  ]);
  const ready = accounts.every(
    (account) =>
      account.state === 'unsupported' ||
      account.state === 'action_required' ||
      (account.state === 'healthy' && account.bootstrapCompletedAt !== null),
  );
  return WorkLocationSyncOut.parse({
    ready,
    accounts: accounts.map((account) => ({
      connectionId: account.connectionId,
      provider: account.provider,
      accountLabel: account.accountEmail ?? account.accountName,
      state: account.state,
      reason: account.reason,
      capabilities: account.capabilities,
      bootstrapCompletedAt: account.bootstrapCompletedAt?.toISOString() ?? null,
      lastSucceededAt: account.lastSucceededAt?.toISOString() ?? null,
      pendingWrites: writes.filter(
        (write) => write.connectionId === account.connectionId && write.status !== 'applied',
      ).length,
    })),
  });
}

/** Compact mutation-facing projection state derived from the account sync read model. */
export async function workLocationProjectionStates(
  database: Database,
  hubId: string,
): Promise<WorkLocationProjectionOut[]> {
  const sync = await listWorkLocationSync(database, hubId);
  return sync.accounts.map((account) =>
    WorkLocationProjectionOut.parse({
      connectionId: account.connectionId,
      provider: account.provider,
      state: account.state,
      reason: account.reason,
    }),
  );
}

/** Queue one canonical assertion revision for every writable linked provider account. */
export async function enqueueWorkLocationProjection(
  database: Database,
  hubId: string,
  assertion: WorkLocationAssertionOut,
  operation: 'create' | 'update' | 'delete',
  exceptionDate: string | null = null,
  excludeConnectionId: string | null = null,
): Promise<WorkLocationProjectionOut[]> {
  await ensureWorkLocationSyncAccounts(database, hubId);
  const accounts = await database
    .select({ sync: workLocationSyncAccount })
    .from(workLocationSyncAccount)
    .innerJoin(calendarConnection, eq(calendarConnection.id, workLocationSyncAccount.connectionId))
    .where(
      and(eq(workLocationSyncAccount.hubId, hubId), ne(calendarConnection.status, 'disconnected')),
    );
  const writable = accounts.filter(
    ({ sync: account }) =>
      account.capabilities.writes &&
      account.state !== 'unsupported' &&
      account.state !== 'action_required' &&
      account.connectionId !== excludeConnectionId,
  );
  if (writable.length > 0) {
    await database.insert(workLocationWrite).values(
      writable.map(({ sync: account }) => ({
        hubId,
        assertionId: assertion.id,
        exceptionDate,
        connectionId: account.connectionId,
        provider: account.provider,
        operation,
        canonicalRevision: assertion.revision,
        payload: { assertionId: assertion.id, revision: assertion.revision },
      })),
    );
  }
  return workLocationProjectionStates(database, hubId);
}

/** Re-project active assertions using a place whose name or provider mapping changed. */
export async function enqueuePlaceWorkLocationProjections(
  database: Database,
  hubId: string,
  placeId: string,
): Promise<WorkLocationProjectionOut[]> {
  const assertions = (await listWorkLocationAssertions(database, hubId)).items.filter(
    (assertion) => assertion.placeId === placeId,
  );
  for (const assertion of assertions) {
    await enqueueWorkLocationProjection(database, hubId, assertion, 'update');
  }
  return workLocationProjectionStates(database, hubId);
}

/** Re-project active assertions after the independent home designation changes. */
export async function enqueueProfileWorkLocationProjections(
  database: Database,
  hubId: string,
): Promise<WorkLocationProjectionOut[]> {
  const assertions = (await listWorkLocationAssertions(database, hubId)).items;
  for (const assertion of assertions) {
    await enqueueWorkLocationProjection(database, hubId, assertion, 'update');
  }
  return workLocationProjectionStates(database, hubId);
}
