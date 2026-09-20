/** Hub-owned persistence for versioned default work schedules and place reconciliation. */
import {
  calendarConnection,
  hub,
  workLocationExternalBinding,
  workLocationSyncAccount,
  workPlaceAlias,
  workScheduleChange,
  workScheduleException,
  workSchedulePlan,
  type Database,
} from '@docket/db';
import {
  WorkScheduleChangeListOut,
  WorkScheduleConflictPayload,
  WorkScheduleExceptionCreate,
  WorkSchedulePlanCreate,
  type WorkScheduleExceptionOut,
  type WorkScheduleOut,
  type WorkSchedulePlanOut,
} from '@docket/planning/work-location-contract';
import { and, asc, desc, eq, gte, isNull, lte, or } from 'drizzle-orm';

import { ConflictError, NotFoundError } from '../../error';
import {
  readConditionalWorkSchedule,
  writeConditionalWorkSchedule,
  type WorkScheduleConditionalRead,
} from '../../lib/work-schedule-conditional';
import { migrateLegacyWorkSchedule } from './legacy-schedule-migration';
import { enqueueWorkLocationProjection, listWorkLocationAssertions } from './repository';
import {
  insertWorkSchedulePlanVersion,
  orderedScheduleSegments,
  readStoredWorkSchedule,
  referencedSchedulePlaceIds,
  requireScheduleHub,
  requireSchedulePlaces,
  scheduleExceptionOut,
  schedulePlanOut,
} from './schedule-storage';

/** Require the row that a successful persistence operation must return. */
function persisted<T>(value: T | undefined, operation: string): T {
  if (value === undefined) throw new Error(`Work-schedule persistence failed: ${operation}`);
  return value;
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
  await requireScheduleHub(database, hubId);
  await migrateLegacyWorkSchedule(database, hubId);
  return readStoredWorkSchedule(database, hubId);
}

/**
 * Read the public default schedule and its resource-bound strong validator atomically.
 *
 * @param database - The database connection.
 * @param hubId - The caller-owned personal Hub.
 * @returns The schedule and the exact validator accepted by conditional schedule writes.
 */
export async function readVersionedWorkSchedule(
  database: Database,
  hubId: string,
): Promise<WorkScheduleConditionalRead<WorkScheduleOut>> {
  await requireScheduleHub(database, hubId);
  await migrateLegacyWorkSchedule(database, hubId);
  return readConditionalWorkSchedule(database, hubId, (transaction) =>
    readStoredWorkSchedule(transaction, hubId),
  );
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
  await requireScheduleHub(database, hubId);
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
 * @param ifMatch - Optional strong validator from the last schedule read.
 * @returns The newly created plan version.
 */
export async function replaceWorkSchedulePlan(
  database: Database,
  hubId: string,
  input: WorkSchedulePlanCreate,
  ifMatch?: string,
): Promise<WorkSchedulePlanOut> {
  const parsed = WorkSchedulePlanCreate.parse(input);
  await requireScheduleHub(database, hubId);
  await requireSchedulePlaces(database, hubId, referencedSchedulePlaceIds(parsed.cycleDays));
  const created = await writeConditionalWorkSchedule(
    database,
    hubId,
    ifMatch,
    (transaction) => readStoredWorkSchedule(transaction, hubId),
    (transaction) => insertWorkSchedulePlanVersion(transaction, hubId, parsed),
  );
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
  return schedulePlanOut(created);
}

/**
 * Replace every generated segment on one date governed by the current plan history.
 *
 * @param database - The database connection.
 * @param hubId - The caller-owned personal Hub.
 * @param input - The date and its complete replacement segment list.
 * @param ifMatch - Optional strong validator from the last schedule read.
 * @returns The created or updated dated replacement.
 */
export async function setWorkScheduleException(
  database: Database,
  hubId: string,
  input: WorkScheduleExceptionCreate,
  ifMatch?: string,
): Promise<WorkScheduleExceptionOut> {
  const parsed = WorkScheduleExceptionCreate.parse(input);
  await requireScheduleHub(database, hubId);
  await requireSchedulePlaces(
    database,
    hubId,
    referencedSchedulePlaceIds([{ segments: parsed.segments }]),
  );
  const row = await writeConditionalWorkSchedule(
    database,
    hubId,
    ifMatch,
    (transaction) => readStoredWorkSchedule(transaction, hubId),
    async (transaction) => {
      const plan = (
        await transaction
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
      return persisted(
        (
          await transaction
            .insert(workScheduleException)
            .values({
              hubId,
              planVersionId: plan.id,
              date: parsed.date,
              segments: orderedScheduleSegments(parsed.segments),
              origin: 'docket',
            })
            .onConflictDoUpdate({
              target: [workScheduleException.planVersionId, workScheduleException.date],
              set: {
                segments: orderedScheduleSegments(parsed.segments),
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
    },
  );
  return scheduleExceptionOut(row);
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
  await requireScheduleHub(database, options.hubId);
  await requireSchedulePlaces(
    database,
    options.hubId,
    referencedSchedulePlaceIds([{ segments: parsed.segments }]),
  );
  const row = await writeConditionalWorkSchedule(
    database,
    options.hubId,
    undefined,
    (transaction) => readStoredWorkSchedule(transaction, options.hubId),
    async (transaction) => {
      const plan = (
        await transaction
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
      return persisted(
        (
          await transaction
            .insert(workScheduleException)
            .values({
              hubId: options.hubId,
              planVersionId: plan.id,
              date: parsed.date,
              segments: orderedScheduleSegments(parsed.segments),
              origin: 'provider',
              originProvider: options.provider,
              originConnectionId: options.connectionId,
              sourceUpdatedAt: options.sourceUpdatedAt,
            })
            .onConflictDoUpdate({
              target: [workScheduleException.planVersionId, workScheduleException.date],
              set: {
                segments: orderedScheduleSegments(parsed.segments),
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
    },
  );
  return row ? scheduleExceptionOut(row) : null;
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
  await requireSchedulePlaces(database, hubId, [placeId]);
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
