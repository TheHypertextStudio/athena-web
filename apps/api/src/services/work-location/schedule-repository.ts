/** Hub-owned persistence for versioned default work schedules and place reconciliation. */
import {
  calendarConnection,
  hub,
  workLocationExternalBinding,
  workLocationSyncAccount,
  workPlace,
  workPlaceAlias,
  workScheduleChange,
  workScheduleException,
  workSchedulePlan,
  type Database,
} from '@docket/db';
import { addCalendarDays } from '@docket/planning/calendar-date';
import {
  WorkScheduleChangeListOut,
  WorkScheduleConflictPayload,
  WorkScheduleExceptionCreate,
  WorkScheduleExceptionOut,
  WorkScheduleOut,
  WorkSchedulePlanCreate,
  WorkSchedulePlanOut,
  type WorkScheduleCycleDay,
  type WorkScheduleSegment,
} from '@docket/planning/work-location-contract';
import { and, asc, desc, eq, gt, gte, inArray, isNull, lte, or } from 'drizzle-orm';

import { ConflictError, NotFoundError } from '../../error';
import { migrateLegacyWorkSchedule } from './legacy-schedule-migration';
import { enqueueWorkLocationProjection, listWorkLocationAssertions } from './repository';

/** Require the row that a successful persistence operation must return. */
function persisted<T>(value: T | undefined, operation: string): T {
  if (value === undefined) throw new Error(`Work-schedule persistence failed: ${operation}`);
  return value;
}

/** Require an existing Hub without exposing a caller-selected Hub through the HTTP contract. */
async function requireHub(database: Database, hubId: string): Promise<void> {
  const row = (
    await database.select({ id: hub.id }).from(hub).where(eq(hub.id, hubId)).limit(1)
  )[0];
  if (!row) throw new NotFoundError('Hub not found');
}

/** Return every saved-place id referenced by a plan or replacement. */
function referencedPlaceIds(cycleDays: readonly WorkScheduleCycleDay[]): string[] {
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
function orderedSegments(segments: readonly WorkScheduleSegment[]): WorkScheduleSegment[] {
  return [...segments].sort((left, right) => left.startMinute - right.startMinute);
}

/** Normalize every cycle day before it becomes a canonical plan version. */
function orderedCycleDays(cycleDays: readonly WorkScheduleCycleDay[]): WorkScheduleCycleDay[] {
  return cycleDays.map((day) => ({ segments: orderedSegments(day.segments) }));
}

/** Require every referenced saved place to be active and owned by the same Hub. */
async function requirePlaces(database: Database, hubId: string, placeIds: string[]): Promise<void> {
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
function planOut(row: typeof workSchedulePlan.$inferSelect): WorkSchedulePlanOut {
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
function exceptionOut(row: typeof workScheduleException.$inferSelect): WorkScheduleExceptionOut {
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

/**
 * List every plan version and dated replacement owned by one Hub.
 *
 * @param database - The database connection or transaction.
 * @param hubId - The caller-owned personal Hub.
 * @returns The complete versioned work schedule in date order.
 */
export async function listWorkSchedule(
  database: Database,
  hubId: string,
): Promise<WorkScheduleOut> {
  await requireHub(database, hubId);
  await migrateLegacyWorkSchedule(database, hubId);
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
    plans: plans.map(planOut),
    exceptions: exceptions.map(exceptionOut),
  });
}

/**
 * List the unresolved provider and migration changes that still need an owner decision.
 *
 * @param database - The database connection.
 * @param hubId - The caller-owned personal Hub.
 * @returns Pending changes in oldest-first order with their connected-account label.
 */
export async function listWorkScheduleChanges(
  database: Database,
  hubId: string,
): Promise<WorkScheduleChangeListOut> {
  await requireHub(database, hubId);
  const rows = await database
    .select({
      id: workScheduleChange.id,
      connectionId: workScheduleChange.connectionId,
      provider: workScheduleChange.provider,
      accountLabel: calendarConnection.accountEmail,
      kind: workScheduleChange.kind,
      payload: workScheduleChange.payload,
      createdAt: workScheduleChange.createdAt,
      updatedAt: workScheduleChange.updatedAt,
    })
    .from(workScheduleChange)
    .leftJoin(calendarConnection, eq(calendarConnection.id, workScheduleChange.connectionId))
    .where(and(eq(workScheduleChange.hubId, hubId), eq(workScheduleChange.state, 'pending')))
    .orderBy(asc(workScheduleChange.createdAt));
  return WorkScheduleChangeListOut.parse({
    items: rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
  });
}

/**
 * Dismiss one pending schedule change without changing saved places or the default plan.
 *
 * @param database - The database connection.
 * @param hubId - The caller-owned personal Hub.
 * @param changeId - Pending change to dismiss.
 */
export async function ignoreWorkScheduleChange(
  database: Database,
  hubId: string,
  changeId: string,
): Promise<void> {
  const ignored = await database
    .update(workScheduleChange)
    .set({ state: 'ignored', resolvedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(workScheduleChange.id, changeId),
        eq(workScheduleChange.hubId, hubId),
        eq(workScheduleChange.state, 'pending'),
      ),
    )
    .returning({ id: workScheduleChange.id });
  if (!ignored[0]) throw new NotFoundError('Work-schedule change not found');
}

/** Resolve a provider-versus-Docket date conflict with one explicit source choice. */
export async function resolveWorkScheduleConflict(
  database: Database,
  hubId: string,
  changeId: string,
  action: 'keep_docket' | 'use_provider',
): Promise<void> {
  const change = (
    await database
      .select()
      .from(workScheduleChange)
      .where(
        and(
          eq(workScheduleChange.id, changeId),
          eq(workScheduleChange.hubId, hubId),
          eq(workScheduleChange.kind, 'schedule_conflict'),
          eq(workScheduleChange.state, 'pending'),
        ),
      )
      .limit(1)
  )[0];
  if (!change?.connectionId || !change.provider) {
    throw new NotFoundError('Work-schedule conflict not found');
  }
  const payload = WorkScheduleConflictPayload.parse(change.payload);
  if (action === 'use_provider') {
    const applied = await setProviderWorkScheduleException(database, {
      hubId,
      connectionId: change.connectionId,
      provider: change.provider,
      input: { date: payload.date, segments: payload.providerSegments },
      sourceUpdatedAt: change.providerUpdatedAt,
    });
    if (!applied) throw new ConflictError('No work-schedule plan governs that date');
  } else {
    const binding = (
      await database
        .select({ assertionId: workLocationExternalBinding.assertionId })
        .from(workLocationExternalBinding)
        .where(
          and(
            eq(workLocationExternalBinding.hubId, hubId),
            eq(workLocationExternalBinding.connectionId, change.connectionId),
            eq(workLocationExternalBinding.externalEventId, payload.externalEventId),
          ),
        )
        .limit(1)
    )[0];
    const assertion = binding
      ? (await listWorkLocationAssertions(database, hubId)).items.find(
          (candidate) => candidate.id === binding.assertionId,
        )
      : undefined;
    if (!assertion) throw new ConflictError('The Docket schedule projection is unavailable');
    await enqueueWorkLocationProjection(database, hubId, assertion, 'update');
  }
  const resolved = await database
    .update(workScheduleChange)
    .set({ state: 'resolved', resolvedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(workScheduleChange.id, changeId),
        eq(workScheduleChange.hubId, hubId),
        eq(workScheduleChange.state, 'pending'),
      ),
    )
    .returning({ id: workScheduleChange.id });
  if (!resolved[0]) throw new NotFoundError('Work-schedule conflict not found');
}

/**
 * Start a new default plan version and close the version that governed the preceding date.
 *
 * @param database - The database connection.
 * @param hubId - The caller-owned personal Hub.
 * @param input - The complete new plan version.
 * @returns The newly created plan version.
 */
export async function replaceWorkSchedulePlan(
  database: Database,
  hubId: string,
  input: WorkSchedulePlanCreate,
): Promise<WorkSchedulePlanOut> {
  const parsed = WorkSchedulePlanCreate.parse(input);
  await requireHub(database, hubId);
  await requirePlaces(database, hubId, referencedPlaceIds(parsed.cycleDays));
  const created = await database.transaction(async (tx) => {
    const future = await tx
      .select({ id: workSchedulePlan.id })
      .from(workSchedulePlan)
      .where(
        and(
          eq(workSchedulePlan.hubId, hubId),
          gt(workSchedulePlan.effectiveFrom, parsed.effectiveFrom),
        ),
      )
      .limit(1);
    if (future[0]) {
      throw new ConflictError('A later work-schedule version already exists');
    }
    const governing = await tx
      .select()
      .from(workSchedulePlan)
      .where(
        and(
          eq(workSchedulePlan.hubId, hubId),
          lte(workSchedulePlan.effectiveFrom, parsed.effectiveFrom),
          or(
            isNull(workSchedulePlan.effectiveUntil),
            gt(workSchedulePlan.effectiveUntil, parsed.effectiveFrom),
            eq(workSchedulePlan.effectiveUntil, parsed.effectiveFrom),
          ),
        ),
      )
      .limit(1);
    const current = governing[0];
    if (current?.effectiveFrom === parsed.effectiveFrom) {
      throw new ConflictError('A work-schedule version already starts on that date');
    }
    if (current) {
      await tx
        .update(workSchedulePlan)
        .set({
          effectiveUntil: addCalendarDays(parsed.effectiveFrom, -1),
          updatedAt: new Date(),
        })
        .where(eq(workSchedulePlan.id, current.id));
    }
    const next = persisted(
      (
        await tx
          .insert(workSchedulePlan)
          .values({ hubId, ...parsed, cycleDays: orderedCycleDays(parsed.cycleDays) })
          .returning()
      )[0],
      'create plan version',
    );
    if (current) {
      await tx
        .update(workScheduleException)
        .set({ planVersionId: next.id, updatedAt: new Date() })
        .where(
          and(
            eq(workScheduleException.planVersionId, current.id),
            gte(workScheduleException.date, parsed.effectiveFrom),
          ),
        );
    }
    return next;
  });
  await database
    .update(workScheduleChange)
    .set({ state: 'resolved', resolvedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(workScheduleChange.hubId, hubId),
        eq(workScheduleChange.kind, 'legacy_conflict'),
        eq(workScheduleChange.state, 'pending'),
      ),
    );
  return planOut(created);
}

/**
 * Replace every generated segment on one date governed by the current plan history.
 *
 * @param database - The database connection.
 * @param hubId - The caller-owned personal Hub.
 * @param input - The date and its complete replacement segment list.
 * @returns The created or updated dated replacement.
 */
export async function setWorkScheduleException(
  database: Database,
  hubId: string,
  input: WorkScheduleExceptionCreate,
): Promise<WorkScheduleExceptionOut> {
  const parsed = WorkScheduleExceptionCreate.parse(input);
  await requireHub(database, hubId);
  await requirePlaces(database, hubId, referencedPlaceIds([{ segments: parsed.segments }]));
  const plan = (
    await database
      .select()
      .from(workSchedulePlan)
      .where(
        and(
          eq(workSchedulePlan.hubId, hubId),
          lte(workSchedulePlan.effectiveFrom, parsed.date),
          or(
            isNull(workSchedulePlan.effectiveUntil),
            gte(workSchedulePlan.effectiveUntil, parsed.date),
          ),
        ),
      )
      .orderBy(desc(workSchedulePlan.effectiveFrom))
      .limit(1)
  )[0];
  if (!plan) throw new ConflictError('No work-schedule plan governs that date');
  const row = persisted(
    (
      await database
        .insert(workScheduleException)
        .values({
          hubId,
          planVersionId: plan.id,
          date: parsed.date,
          segments: orderedSegments(parsed.segments),
          origin: 'docket',
        })
        .onConflictDoUpdate({
          target: [workScheduleException.planVersionId, workScheduleException.date],
          set: {
            segments: orderedSegments(parsed.segments),
            origin: 'docket',
            originProvider: null,
            originConnectionId: null,
            sourceUpdatedAt: null,
            updatedAt: new Date(),
          },
        })
        .returning()
    )[0],
    'save dated replacement',
  );
  return exceptionOut(row);
}

/**
 * Apply a recognized provider event as a complete dated schedule replacement.
 *
 * @param database - The database connection.
 * @param options - Hub, provider source, replacement, and provider revision timestamp.
 * @returns The replacement, or null when no canonical plan governs the provider date.
 */
export async function setProviderWorkScheduleException(
  database: Database,
  options: {
    readonly hubId: string;
    readonly connectionId: string;
    readonly provider: string;
    readonly input: WorkScheduleExceptionCreate;
    readonly sourceUpdatedAt: Date | null;
  },
): Promise<WorkScheduleExceptionOut | null> {
  const parsed = WorkScheduleExceptionCreate.parse(options.input);
  await requireHub(database, options.hubId);
  await requirePlaces(database, options.hubId, referencedPlaceIds([{ segments: parsed.segments }]));
  const plan = (
    await database
      .select()
      .from(workSchedulePlan)
      .where(
        and(
          eq(workSchedulePlan.hubId, options.hubId),
          lte(workSchedulePlan.effectiveFrom, parsed.date),
          or(
            isNull(workSchedulePlan.effectiveUntil),
            gte(workSchedulePlan.effectiveUntil, parsed.date),
          ),
        ),
      )
      .orderBy(desc(workSchedulePlan.effectiveFrom))
      .limit(1)
  )[0];
  if (!plan) return null;
  const row = persisted(
    (
      await database
        .insert(workScheduleException)
        .values({
          hubId: options.hubId,
          planVersionId: plan.id,
          date: parsed.date,
          segments: orderedSegments(parsed.segments),
          origin: 'provider',
          originProvider: options.provider,
          originConnectionId: options.connectionId,
          sourceUpdatedAt: options.sourceUpdatedAt,
        })
        .onConflictDoUpdate({
          target: [workScheduleException.planVersionId, workScheduleException.date],
          set: {
            segments: orderedSegments(parsed.segments),
            origin: 'provider',
            originProvider: options.provider,
            originConnectionId: options.connectionId,
            sourceUpdatedAt: options.sourceUpdatedAt,
            updatedAt: new Date(),
          },
        })
        .returning()
    )[0],
    'save provider dated replacement',
  );
  return exceptionOut(row);
}

/**
 * Link an unmatched provider label to one existing saved place and resolve its change item.
 *
 * @param database - The database connection.
 * @param hubId - The caller-owned personal Hub.
 * @param changeId - Pending unmatched-place change id.
 * @param placeId - Existing saved place that the provider label means.
 */
export async function linkWorkPlaceAlias(
  database: Database,
  hubId: string,
  changeId: string,
  placeId: string,
): Promise<void> {
  await requirePlaces(database, hubId, [placeId]);
  const change = (
    await database
      .select()
      .from(workScheduleChange)
      .where(
        and(
          eq(workScheduleChange.id, changeId),
          eq(workScheduleChange.hubId, hubId),
          eq(workScheduleChange.kind, 'unmatched_place'),
          eq(workScheduleChange.state, 'pending'),
        ),
      )
      .limit(1)
  )[0];
  if (!change?.connectionId || !change.provider) {
    throw new NotFoundError('Unmatched work-place name not found');
  }
  const payload = change.payload as {
    readonly kind?: unknown;
    readonly label?: unknown;
    readonly normalizedLabel?: unknown;
  };
  if (
    payload.kind !== 'unmatched_place' ||
    typeof payload.label !== 'string' ||
    typeof payload.normalizedLabel !== 'string'
  ) {
    throw new ConflictError('Unmatched work-place name is malformed');
  }
  const owner = (
    await database.select({ userId: hub.userId }).from(hub).where(eq(hub.id, hubId)).limit(1)
  )[0];
  const connection = owner
    ? (
        await database
          .select({ id: calendarConnection.id })
          .from(calendarConnection)
          .where(
            and(
              eq(calendarConnection.id, change.connectionId),
              eq(calendarConnection.userId, owner.userId),
            ),
          )
          .limit(1)
      )[0]
    : undefined;
  if (!connection) throw new NotFoundError('Calendar connection not found');
  const connectionId = change.connectionId;
  const provider = change.provider;
  if (!connectionId || !provider) throw new NotFoundError('Unmatched work-place name not found');

  await database.transaction(async (tx) => {
    await tx
      .insert(workPlaceAlias)
      .values({
        hubId,
        connectionId,
        provider,
        normalizedLabel: payload.normalizedLabel as string,
        displayLabel: payload.label as string,
        placeId,
      })
      .onConflictDoUpdate({
        target: [workPlaceAlias.connectionId, workPlaceAlias.normalizedLabel],
        set: { placeId, displayLabel: payload.label as string, updatedAt: new Date() },
      });
    await tx
      .update(workScheduleChange)
      .set({ state: 'resolved', resolvedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(workScheduleChange.id, changeId), eq(workScheduleChange.state, 'pending')));
    await tx
      .update(workLocationSyncAccount)
      .set({ state: 'pending', reason: null, syncToken: null, updatedAt: new Date() })
      .where(eq(workLocationSyncAccount.connectionId, connectionId));
  });
}
