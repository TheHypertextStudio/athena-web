/** Canonical Google work-location import, convergence, and retryable projection drain. */
import { createHash } from 'node:crypto';

import {
  calendarConnection,
  workLocationAssertion,
  workLocationException,
  workLocationExternalBinding,
  workLocationProfile,
  workLocationSyncAccount,
  workLocationWrite,
  workPlace,
  workPlaceAlias,
  workPlaceProviderMapping,
  workScheduleChange,
  workScheduleException,
  workSchedulePlan,
  type Database,
} from '@docket/db';
import {
  WorkScheduleConflictPayload,
  WorkScheduleExceptionCreate,
  type WorkLocationAssertionOut,
  type WorkLocationSchedule,
} from '@docket/planning/work-location-contract';
import { WorkPlaceId } from '@docket/planning/ids';
import {
  instantAt,
  localDateString,
  localMinuteOfDay,
  minutesBetween,
} from '@docket/planning/zoned-time';
import { and, asc, desc, eq, gte, isNull, lte, ne, or } from 'drizzle-orm';

import {
  archiveWorkLocationAssertion,
  enqueueWorkLocationProjection,
  listWorkLocationAssertions,
  listWorkLocationSync,
  resolveWorkLocationHubId,
} from './repository';
import { setProviderWorkScheduleException } from './schedule-repository';
import { refreshWorkScheduleProjectionAssertions } from './schedule-projection';
import {
  mapGoogleWorkingLocationAssertion,
  normalizeGoogleWorkingLocationEvent,
  type GoogleImportedPlace,
  type GoogleWorkingLocationEvent,
  type NormalizedGoogleWorkingLocation,
} from './google';

/** Google transport used by the canonical engine; production and fixtures share this seam. */
export interface GoogleWorkLocationTransport {
  pull(input: {
    readonly connectionId: string;
    readonly userId: string;
    readonly externalAccountId: string;
    readonly cursor: string | null;
  }): Promise<{
    readonly events: readonly GoogleWorkingLocationEvent[];
    readonly nextCursor: string | null;
  }>;
  upsert(input: {
    readonly connectionId: string;
    readonly userId: string;
    readonly externalAccountId: string;
    readonly externalEventId: string;
    readonly externalEtag: string | null;
    readonly body: Readonly<Record<string, unknown>>;
  }): Promise<GoogleWorkingLocationEvent>;
  delete(input: {
    readonly connectionId: string;
    readonly userId: string;
    readonly externalAccountId: string;
    readonly externalEventId: string;
    readonly externalEtag: string | null;
  }): Promise<void>;
  findInstance(input: {
    readonly connectionId: string;
    readonly userId: string;
    readonly externalAccountId: string;
    readonly masterExternalEventId: string;
    readonly occurrenceDate: string;
    readonly timezone: string;
  }): Promise<GoogleWorkingLocationEvent | null>;
  startWatch?(input: {
    readonly connectionId: string;
    readonly userId: string;
    readonly externalAccountId: string;
    readonly callbackUrl: string;
    readonly channelId: string;
    readonly token: string;
  }): Promise<{ readonly resourceId: string; readonly expiresAt: Date }>;
}

/** Per-user import result suitable for sweep observability without place labels. */
export interface WorkLocationSyncTally {
  readonly accounts: number;
  readonly imported: number;
  readonly adopted: number;
  readonly deleted: number;
  readonly unsupported: number;
  readonly errors: number;
}

/** Per-user outbox result suitable for sweep observability without payload data. */
export interface WorkLocationDrainTally {
  readonly applied: number;
  readonly retried: number;
  readonly failed: number;
}

/** Require the row/result that a successful sync persistence operation must return. */
function persisted<T>(value: T | undefined, operation: string): T {
  if (value === undefined) throw new Error(`Work-location sync persistence failed: ${operation}`);
  return value;
}

/** Map stable Google HTTP status classes to product-owned account states. */
function classifyGoogleSyncFailure(error: unknown): {
  readonly state: 'retrying' | 'unsupported' | 'action_required';
  readonly reason: 'provider_unavailable' | 'unsupported_account' | 'reauth_required';
} {
  const status =
    typeof error === 'object' && error !== null && 'status' in error
      ? (error as { readonly status?: unknown }).status
      : null;
  if (status === 401) return { state: 'action_required', reason: 'reauth_required' };
  if (status === 400 || status === 403 || status === 404) {
    return { state: 'unsupported', reason: 'unsupported_account' };
  }
  return { state: 'retrying', reason: 'provider_unavailable' };
}

/** Stable hash of canonical content used to recognize projected provider echoes. */
function canonicalHash(input: {
  readonly schedule: WorkLocationSchedule;
  readonly place: GoogleImportedPlace;
}): string {
  return createHash('sha256')
    .update(JSON.stringify({ schedule: input.schedule, place: input.place }))
    .digest('hex');
}

type WorkLocationOneOffSchedule = Extract<
  WorkLocationSchedule,
  { readonly type: 'one_off_all_day' | 'one_off_timed' }
>;

/** Narrow a provider occurrence replacement to the schedules the exception schema permits. */
function oneOffExceptionSchedule(
  schedule: WorkLocationSchedule,
): WorkLocationOneOffSchedule | null {
  return schedule.type === 'one_off_all_day' || schedule.type === 'one_off_timed' ? schedule : null;
}

/** Render one weekly occurrence as the one-off schedule required by provider instance writes. */
function scheduleForOccurrence(
  schedule: WorkLocationSchedule,
  date: string,
): WorkLocationOneOffSchedule | null {
  if (schedule.type === 'weekly_all_day') {
    return { type: 'one_off_all_day', date, timezone: schedule.timezone };
  }
  if (schedule.type === 'weekly_timed') {
    return {
      type: 'one_off_timed',
      startsAt: instantAt(date, schedule.startMinute, schedule.timezone).toISOString(),
      endsAt: instantAt(date, schedule.endMinute, schedule.timezone).toISOString(),
      timezone: schedule.timezone,
    };
  }
  return null;
}

/** Convert one dated provider schedule into the complete plan-day replacement it represents. */
function providerDatedReplacement(
  schedule: WorkLocationSchedule,
  placeId: string,
): WorkScheduleExceptionCreate | null {
  const parsedPlaceId = WorkPlaceId.parse(placeId);
  if (schedule.type === 'one_off_all_day') {
    return {
      date: schedule.date,
      segments: [
        {
          startMinute: 0,
          durationMinutes: 1_440,
          location: { type: 'saved_place', placeId: parsedPlaceId },
        },
      ],
    };
  }
  if (schedule.type !== 'one_off_timed') return null;
  const start = new Date(schedule.startsAt);
  const end = new Date(schedule.endsAt);
  return {
    date: localDateString(start, schedule.timezone),
    segments: [
      {
        startMinute: localMinuteOfDay(start, schedule.timezone),
        durationMinutes: minutesBetween(start, end),
        location: { type: 'saved_place', placeId: parsedPlaceId },
      },
    ],
  };
}

/** Provider-safe deterministic event id for idempotent individual creates. */
function googleEventId(assertionId: string, exceptionDate: string | null): string {
  return `dkt${createHash('sha256')
    .update(`${assertionId}:${exceptionDate ?? 'master'}`)
    .digest('hex')
    .slice(0, 32)}`;
}

/** Normalize provider labels for conservative punctuation-insensitive place matching. */
export function normalizeProviderPlaceLabel(value: string): string {
  return value
    .normalize('NFKD')
    .toLocaleLowerCase('en-US')
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Resolve one provider place without turning an untrusted free-form label into saved-place data. */
async function resolveImportedPlace(
  database: Database,
  input: {
    readonly hubId: string;
    readonly connectionId: string;
    readonly place: GoogleImportedPlace;
    readonly externalEventId: string;
    readonly trustedPlaceId?: string;
  },
): Promise<string | null> {
  const normalizedLabel = normalizeProviderPlaceLabel(input.place.suggestedName);
  const [mappings, places, profileRows, aliases] = await Promise.all([
    database
      .select()
      .from(workPlaceProviderMapping)
      .where(eq(workPlaceProviderMapping.connectionId, input.connectionId)),
    database
      .select()
      .from(workPlace)
      .where(and(eq(workPlace.hubId, input.hubId), isNull(workPlace.archivedAt))),
    database
      .select()
      .from(workLocationProfile)
      .where(eq(workLocationProfile.hubId, input.hubId))
      .limit(1),
    database
      .select()
      .from(workPlaceAlias)
      .where(
        and(
          eq(workPlaceAlias.connectionId, input.connectionId),
          eq(workPlaceAlias.normalizedLabel, normalizedLabel),
        ),
      )
      .limit(1),
  ]);
  const profile = profileRows[0];
  const mapped = mappings.find((mapping) => {
    if (
      input.place.providerPlaceId &&
      mapping.providerPlaceId === input.place.providerPlaceId &&
      mapping.classification === input.place.classification
    ) {
      return true;
    }
    if (input.place.classification === 'homeOffice' && mapping.placeId === profile?.homePlaceId) {
      return true;
    }
    const place = places.find((candidate) => candidate.id === mapping.placeId);
    return (
      mapping.classification === input.place.classification &&
      place?.name === input.place.suggestedName
    );
  });
  const trusted = input.trustedPlaceId
    ? places.find(
        (place) =>
          place.id === input.trustedPlaceId &&
          normalizeProviderPlaceLabel(place.name) === normalizedLabel,
      )
    : undefined;
  const placeId = mapped?.placeId ?? aliases[0]?.placeId ?? trusted?.id ?? null;
  if (!placeId) {
    await database
      .insert(workScheduleChange)
      .values({
        hubId: input.hubId,
        connectionId: input.connectionId,
        provider: 'google',
        kind: 'unmatched_place',
        state: 'pending',
        dedupeKey: `google:event:${input.externalEventId}`,
        payload: {
          kind: 'unmatched_place',
          label: input.place.suggestedName,
          normalizedLabel,
          externalEventId: input.externalEventId,
        },
      })
      .onConflictDoUpdate({
        target: [workScheduleChange.connectionId, workScheduleChange.dedupeKey],
        set: {
          payload: {
            kind: 'unmatched_place',
            label: input.place.suggestedName,
            normalizedLabel,
            externalEventId: input.externalEventId,
          },
          updatedAt: new Date(),
        },
      });
    return null;
  }
  if (!aliases[0]) {
    await database
      .insert(workPlaceAlias)
      .values({
        hubId: input.hubId,
        connectionId: input.connectionId,
        provider: 'google',
        normalizedLabel,
        displayLabel: input.place.suggestedName,
        placeId,
      })
      .onConflictDoNothing({
        target: [workPlaceAlias.connectionId, workPlaceAlias.normalizedLabel],
      });
  }
  await database
    .insert(workPlaceProviderMapping)
    .values({
      hubId: input.hubId,
      placeId,
      connectionId: input.connectionId,
      provider: 'google',
      classification: input.place.classification,
      providerPlaceId: input.place.providerPlaceId,
      metadata: input.place.metadata,
    })
    .onConflictDoUpdate({
      target: [workPlaceProviderMapping.placeId, workPlaceProviderMapping.connectionId],
      set: {
        classification: input.place.classification,
        providerPlaceId: input.place.providerPlaceId,
        metadata: input.place.metadata,
        updatedAt: new Date(),
      },
    });
  if (input.place.classification === 'homeOffice' && !profile?.homePlaceId) {
    await database
      .insert(workLocationProfile)
      .values({ hubId: input.hubId, homePlaceId: placeId })
      .onConflictDoUpdate({
        target: workLocationProfile.hubId,
        set: { homePlaceId: placeId, updatedAt: new Date() },
      });
  }
  return placeId;
}

/** Resolve one binding by the remote event id that changed. */
async function bindingForRemote(database: Database, connectionId: string, externalEventId: string) {
  return (
    (
      await database
        .select()
        .from(workLocationExternalBinding)
        .where(
          and(
            eq(workLocationExternalBinding.connectionId, connectionId),
            eq(workLocationExternalBinding.externalEventId, externalEventId),
          ),
        )
        .limit(1)
    )[0] ?? null
  );
}

/** Insert or refresh a provider binding after import or delivery acknowledgement. */
async function saveBinding(
  database: Database,
  input: {
    readonly hubId: string;
    readonly assertionId: string;
    readonly exceptionDate: string | null;
    readonly connectionId: string;
    readonly event: Extract<NormalizedGoogleWorkingLocation, { kind: 'assertion' | 'exception' }>;
    readonly payloadHash: string;
    readonly lastProjectedRevision: number | null;
  },
): Promise<void> {
  await database
    .insert(workLocationExternalBinding)
    .values({
      hubId: input.hubId,
      assertionId: input.assertionId,
      exceptionDate: input.exceptionDate,
      connectionId: input.connectionId,
      provider: 'google',
      externalEventId: input.event.externalEventId,
      parentExternalEventId: input.event.parentExternalEventId,
      occurrenceKey: input.event.occurrenceKey,
      externalEtag: input.event.etag,
      remoteUpdatedAt: input.event.updatedAt,
      payloadHash: input.payloadHash,
      lastProjectedRevision: input.lastProjectedRevision,
    })
    .onConflictDoUpdate({
      target: [
        workLocationExternalBinding.connectionId,
        workLocationExternalBinding.externalEventId,
      ],
      set: {
        assertionId: input.assertionId,
        exceptionDate: input.exceptionDate,
        parentExternalEventId: input.event.parentExternalEventId,
        occurrenceKey: input.event.occurrenceKey,
        externalEtag: input.event.etag,
        remoteUpdatedAt: input.event.updatedAt,
        payloadHash: input.payloadHash,
        lastProjectedRevision: input.lastProjectedRevision,
        updatedAt: new Date(),
      },
    });
}

/** Queue a decision when a provider edit targets a newer Docket-owned dated replacement. */
async function queueScheduleConflict(
  database: Database,
  input: {
    readonly hubId: string;
    readonly connectionId: string;
    readonly event: Extract<
      NormalizedGoogleWorkingLocation,
      { kind: 'assertion' | 'delete' | 'exception' }
    >;
    readonly binding: NonNullable<Awaited<ReturnType<typeof bindingForRemote>>>;
    readonly replacement: WorkScheduleExceptionCreate;
  },
): Promise<string | null> {
  const plan = (
    await database
      .select({ id: workSchedulePlan.id })
      .from(workSchedulePlan)
      .where(
        and(
          eq(workSchedulePlan.hubId, input.hubId),
          lte(workSchedulePlan.effectiveFrom, input.replacement.date),
          or(
            isNull(workSchedulePlan.effectiveUntil),
            gte(workSchedulePlan.effectiveUntil, input.replacement.date),
          ),
        ),
      )
      .orderBy(desc(workSchedulePlan.effectiveFrom))
      .limit(1)
  )[0];
  if (!plan) return null;
  const current = (
    await database
      .select()
      .from(workScheduleException)
      .where(
        and(
          eq(workScheduleException.planVersionId, plan.id),
          eq(workScheduleException.date, input.replacement.date),
        ),
      )
      .limit(1)
  )[0];
  const providerBaseline = input.binding.remoteUpdatedAt;
  const conflicts =
    current?.origin === 'docket' &&
    JSON.stringify(current.segments) !== JSON.stringify(input.replacement.segments) &&
    (providerBaseline === null || current.updatedAt > providerBaseline);
  if (!conflicts) return null;
  const payload = WorkScheduleConflictPayload.parse({
    kind: 'schedule_conflict',
    date: input.replacement.date,
    externalEventId: input.event.externalEventId,
    docketSegments: current.segments,
    providerSegments: input.replacement.segments,
  });
  await database
    .insert(workScheduleChange)
    .values({
      hubId: input.hubId,
      connectionId: input.connectionId,
      provider: 'google',
      kind: 'schedule_conflict',
      state: 'pending',
      dedupeKey: `google:schedule-conflict:${input.event.externalEventId}:${input.replacement.date}`,
      payload,
      providerUpdatedAt: input.event.updatedAt,
    })
    .onConflictDoUpdate({
      target: [workScheduleChange.connectionId, workScheduleChange.dedupeKey],
      set: {
        state: 'pending',
        payload,
        providerUpdatedAt: input.event.updatedAt,
        resolvedAt: null,
        updatedAt: new Date(),
      },
    });
  return plan.id;
}

/** Materialize and return the first active generated assertion for one canonical plan date. */
async function materializedAssertionForDate(
  database: Database,
  hubId: string,
  planVersionId: string,
  date: string,
): Promise<typeof workLocationAssertion.$inferSelect | null> {
  await refreshWorkScheduleProjectionAssertions(database, hubId, {
    startDate: date,
    endDate: date,
  });
  const rows = await database
    .select()
    .from(workLocationAssertion)
    .where(
      and(
        eq(workLocationAssertion.hubId, hubId),
        eq(workLocationAssertion.originProvider, 'schedule_plan'),
        eq(workLocationAssertion.sourcePlanVersionId, planVersionId),
        isNull(workLocationAssertion.archivedAt),
      ),
    )
    .orderBy(asc(workLocationAssertion.sourcePlanKey));
  return rows.find((row) => row.sourcePlanKey?.startsWith(`${planVersionId}:${date}:`)) ?? null;
}

/** Apply a remote edit to a generated dated assertion back to its canonical plan date. */
async function adoptProjectedPlanEdit(
  database: Database,
  input: {
    readonly hubId: string;
    readonly connectionId: string;
    readonly event: Extract<NormalizedGoogleWorkingLocation, { kind: 'assertion' | 'exception' }>;
    readonly binding: NonNullable<Awaited<ReturnType<typeof bindingForRemote>>>;
    readonly assertion: typeof workLocationAssertion.$inferSelect;
    readonly placeId: string;
    readonly payloadHash: string;
  },
): Promise<'adopted' | 'acknowledged' | null> {
  if (!input.assertion.sourcePlanVersionId) return null;
  const replacement = providerDatedReplacement(input.event.schedule, input.placeId);
  const conflictPlanId = replacement
    ? await queueScheduleConflict(database, {
        ...input,
        replacement,
      })
    : null;
  if (replacement && conflictPlanId) {
    const projected = await materializedAssertionForDate(
      database,
      input.hubId,
      conflictPlanId,
      replacement.date,
    );
    await saveBinding(database, {
      ...input,
      assertionId: projected?.id ?? input.assertion.id,
      exceptionDate: projected ? null : input.binding.exceptionDate,
      payloadHash: input.payloadHash,
      lastProjectedRevision: null,
    });
    return 'acknowledged';
  }
  const applied = replacement
    ? await setProviderWorkScheduleException(database, {
        hubId: input.hubId,
        connectionId: input.connectionId,
        provider: 'google',
        input: replacement,
        sourceUpdatedAt: input.event.updatedAt,
      })
    : null;
  if (!applied) return 'acknowledged';
  const projected = await materializedAssertionForDate(
    database,
    input.hubId,
    applied.planVersionId,
    applied.date,
  );
  await saveBinding(database, {
    hubId: input.hubId,
    connectionId: input.connectionId,
    event: input.event,
    assertionId: projected?.id ?? input.assertion.id,
    exceptionDate: projected ? null : input.binding.exceptionDate,
    payloadHash: input.payloadHash,
    lastProjectedRevision: null,
  });
  return 'adopted';
}

type RemoteScheduleEvent = Extract<
  NormalizedGoogleWorkingLocation,
  { kind: 'assertion' | 'exception' }
>;
type RemoteBinding = NonNullable<Awaited<ReturnType<typeof bindingForRemote>>>;
type RemoteAdoptionOutcome = 'imported' | 'adopted' | 'acknowledged' | 'unmatched';

/** Load the assertion that gives one provider binding its canonical identity. */
async function assertionForBinding(
  database: Database,
  binding: RemoteBinding | null,
): Promise<typeof workLocationAssertion.$inferSelect | undefined> {
  if (!binding) return undefined;
  return (
    await database
      .select()
      .from(workLocationAssertion)
      .where(eq(workLocationAssertion.id, binding.assertionId))
      .limit(1)
  )[0];
}

/** Adopt a recognized standalone provider date into the governing canonical plan. */
async function adoptUnboundDatedPlanEvent(
  database: Database,
  input: {
    readonly hubId: string;
    readonly connectionId: string;
    readonly event: RemoteScheduleEvent;
    readonly placeId: string;
    readonly payloadHash: string;
  },
): Promise<'adopted' | null> {
  if (input.event.kind !== 'assertion') return null;
  const replacement = providerDatedReplacement(input.event.schedule, input.placeId);
  if (!replacement) return null;
  const applied = await setProviderWorkScheduleException(database, {
    hubId: input.hubId,
    connectionId: input.connectionId,
    provider: 'google',
    input: replacement,
    sourceUpdatedAt: input.event.updatedAt,
  });
  if (!applied) return null;
  const assertion = await materializedAssertionForDate(
    database,
    input.hubId,
    applied.planVersionId,
    applied.date,
  );
  if (!assertion) throw new Error('Canonical provider date projection was not materialized');
  await saveBinding(database, {
    ...input,
    assertionId: assertion.id,
    exceptionDate: null,
    lastProjectedRevision: null,
  });
  return 'adopted';
}

/** Adopt a provider edit whose event already has a stable local binding. */
async function adoptBoundRemoteEvent(
  database: Database,
  input: {
    readonly hubId: string;
    readonly connectionId: string;
    readonly event: RemoteScheduleEvent;
    readonly binding: RemoteBinding;
    readonly assertion: typeof workLocationAssertion.$inferSelect | undefined;
    readonly placeId: string;
    readonly payloadHash: string;
  },
): Promise<'adopted' | 'acknowledged'> {
  if (input.assertion?.hubId !== input.hubId) return 'acknowledged';
  const assertion = input.assertion;
  const stale =
    input.binding.remoteUpdatedAt !== null &&
    input.event.updatedAt !== null &&
    input.event.updatedAt <= input.binding.remoteUpdatedAt;
  const projectedEcho =
    input.binding.payloadHash === input.payloadHash &&
    input.binding.lastProjectedRevision === assertion.revision;
  if (stale || projectedEcho) {
    await saveBinding(database, {
      ...input,
      assertionId: assertion.id,
      exceptionDate: input.binding.exceptionDate,
      lastProjectedRevision: input.binding.lastProjectedRevision,
    });
    return 'acknowledged';
  }

  const planEdit = await adoptProjectedPlanEdit(database, { ...input, assertion });
  if (planEdit) return planEdit;

  if (input.event.kind === 'exception' && input.binding.exceptionDate) {
    const replacementSchedule = oneOffExceptionSchedule(input.event.schedule);
    if (!replacementSchedule) return 'acknowledged';
    await database
      .insert(workLocationException)
      .values({
        hubId: input.hubId,
        assertionId: assertion.id,
        date: input.binding.exceptionDate,
        action: 'replace',
        replacementPlaceId: input.placeId,
        replacementSchedule,
      })
      .onConflictDoUpdate({
        target: [workLocationException.assertionId, workLocationException.date],
        set: {
          action: 'replace',
          replacementPlaceId: input.placeId,
          replacementSchedule,
          updatedAt: new Date(),
        },
      });
  } else {
    await database
      .update(workLocationAssertion)
      .set({
        placeId: input.placeId,
        schedule: input.event.schedule,
        revision: assertion.revision + 1,
        sourceUpdatedAt: input.event.updatedAt,
        updatedAt: input.event.updatedAt ?? new Date(),
        archivedAt: null,
      })
      .where(eq(workLocationAssertion.id, assertion.id));
  }
  const current = persisted(
    (await listWorkLocationAssertions(database, input.hubId)).items.find(
      (candidate) => candidate.id === assertion.id,
    ),
    'read adopted assertion',
  );
  await saveBinding(database, {
    ...input,
    assertionId: assertion.id,
    exceptionDate: input.binding.exceptionDate,
    lastProjectedRevision: null,
  });
  await enqueueWorkLocationProjection(
    database,
    input.hubId,
    current,
    'update',
    input.binding.exceptionDate,
    input.connectionId,
  );
  return 'adopted';
}

/** Adopt the first provider edit to one recurring instance through its master binding. */
async function adoptUnboundRecurringInstance(
  database: Database,
  input: {
    readonly hubId: string;
    readonly connectionId: string;
    readonly event: RemoteScheduleEvent;
    readonly parentBinding: RemoteBinding | null;
    readonly assertion: typeof workLocationAssertion.$inferSelect | undefined;
    readonly placeId: string;
    readonly payloadHash: string;
  },
): Promise<'imported' | 'adopted' | 'acknowledged' | null> {
  if (input.event.kind !== 'exception' || !input.event.parentExternalEventId) return null;
  if (!input.parentBinding) return 'acknowledged';
  const date = input.event.occurrenceKey?.slice(0, 10);
  const replacementSchedule = oneOffExceptionSchedule(input.event.schedule);
  if (!date || !replacementSchedule || !input.assertion || input.assertion.archivedAt) {
    return 'acknowledged';
  }
  const assertion = input.assertion;
  const planEdit = await adoptProjectedPlanEdit(database, {
    ...input,
    binding: input.parentBinding,
    assertion,
  });
  if (planEdit) return planEdit;
  await database.insert(workLocationException).values({
    hubId: input.hubId,
    assertionId: assertion.id,
    date,
    action: 'replace',
    replacementPlaceId: input.placeId,
    replacementSchedule,
  });
  await database
    .update(workLocationAssertion)
    .set({ revision: assertion.revision + 1, updatedAt: input.event.updatedAt ?? new Date() })
    .where(eq(workLocationAssertion.id, assertion.id));
  await saveBinding(database, {
    ...input,
    assertionId: assertion.id,
    exceptionDate: date,
    lastProjectedRevision: null,
  });
  const current = persisted(
    (await listWorkLocationAssertions(database, input.hubId)).items.find(
      (candidate) => candidate.id === assertion.id,
    ),
    'read imported exception',
  );
  await enqueueWorkLocationProjection(
    database,
    input.hubId,
    current,
    'update',
    date,
    input.connectionId,
  );
  return 'imported';
}

/** Import a provider schedule through the compatibility assertion model. */
async function importLegacyRemoteEvent(
  database: Database,
  input: {
    readonly hubId: string;
    readonly connectionId: string;
    readonly event: RemoteScheduleEvent;
    readonly placeId: string;
    readonly payloadHash: string;
  },
): Promise<'imported'> {
  const existing = (await listWorkLocationAssertions(database, input.hubId)).items.find(
    (assertion) =>
      assertion.placeId === input.placeId &&
      JSON.stringify(assertion.schedule) === JSON.stringify(input.event.schedule),
  );
  let assertionId: string | undefined = existing?.id;
  if (!assertionId) {
    const remoteTime = input.event.updatedAt ?? new Date();
    const created = persisted(
      await database
        .insert(workLocationAssertion)
        .values({
          hubId: input.hubId,
          placeId: input.placeId,
          schedule: input.event.schedule,
          origin: 'provider',
          originProvider: 'google',
          originConnectionId: input.connectionId,
          revision: 1,
          sourceUpdatedAt: input.event.updatedAt,
          createdAt: remoteTime,
          updatedAt: remoteTime,
        })
        .returning({ id: workLocationAssertion.id })
        .then((rows) => rows[0]),
      'create imported assertion',
    );
    assertionId = created.id;
  }
  await saveBinding(database, {
    ...input,
    assertionId,
    exceptionDate: null,
    lastProjectedRevision: null,
  });
  const current = persisted(
    (await listWorkLocationAssertions(database, input.hubId)).items.find(
      (candidate) => candidate.id === assertionId,
    ),
    'read imported assertion',
  );
  await enqueueWorkLocationProjection(
    database,
    input.hubId,
    current,
    existing ? 'update' : 'create',
    null,
    input.connectionId,
  );
  return 'imported';
}

/** Adopt one supported master/exception, or acknowledge it as our own projected echo. */
async function adoptRemoteEvent(
  database: Database,
  input: {
    readonly hubId: string;
    readonly connectionId: string;
    readonly event: Extract<NormalizedGoogleWorkingLocation, { kind: 'assertion' | 'exception' }>;
  },
): Promise<RemoteAdoptionOutcome> {
  const binding = await bindingForRemote(database, input.connectionId, input.event.externalEventId);
  const parentBinding =
    !binding && input.event.parentExternalEventId
      ? await bindingForRemote(database, input.connectionId, input.event.parentExternalEventId)
      : null;
  const boundAssertion = binding ?? parentBinding;
  const trustedAssertion = await assertionForBinding(database, boundAssertion);
  const placeId = await resolveImportedPlace(database, {
    hubId: input.hubId,
    connectionId: input.connectionId,
    place: input.event.place,
    externalEventId: input.event.externalEventId,
    ...(trustedAssertion?.hubId === input.hubId
      ? { trustedPlaceId: trustedAssertion.placeId }
      : {}),
  });
  if (!placeId) return 'unmatched';
  const payloadHash = canonicalHash({ schedule: input.event.schedule, place: input.event.place });
  const branchInput = { ...input, placeId, payloadHash };
  const datedPlan = binding ? null : await adoptUnboundDatedPlanEvent(database, branchInput);
  if (datedPlan) return datedPlan;
  if (binding) {
    return adoptBoundRemoteEvent(database, {
      ...branchInput,
      binding,
      assertion: trustedAssertion,
    });
  }
  const recurring = await adoptUnboundRecurringInstance(database, {
    ...branchInput,
    parentBinding,
    assertion: trustedAssertion,
  });
  if (recurring) return recurring;
  return importLegacyRemoteEvent(database, branchInput);
}

/** Insert or refresh the minimal binding carried by one provider tombstone. */
async function saveDeletedBinding(
  database: Database,
  input: {
    readonly hubId: string;
    readonly assertionId: string;
    readonly exceptionDate: string | null;
    readonly connectionId: string;
    readonly event: Extract<NormalizedGoogleWorkingLocation, { kind: 'delete' }>;
  },
): Promise<void> {
  await database
    .insert(workLocationExternalBinding)
    .values({
      hubId: input.hubId,
      assertionId: input.assertionId,
      exceptionDate: input.exceptionDate,
      connectionId: input.connectionId,
      provider: 'google',
      externalEventId: input.event.externalEventId,
      parentExternalEventId: input.event.parentExternalEventId,
      occurrenceKey: input.event.occurrenceKey,
      externalEtag: input.event.etag,
      remoteUpdatedAt: input.event.updatedAt,
      payloadHash: null,
      lastProjectedRevision: null,
    })
    .onConflictDoUpdate({
      target: [
        workLocationExternalBinding.connectionId,
        workLocationExternalBinding.externalEventId,
      ],
      set: {
        assertionId: input.assertionId,
        exceptionDate: input.exceptionDate,
        parentExternalEventId: input.event.parentExternalEventId,
        occurrenceKey: input.event.occurrenceKey,
        externalEtag: input.event.etag,
        remoteUpdatedAt: input.event.updatedAt,
        payloadHash: null,
        lastProjectedRevision: null,
        updatedAt: new Date(),
      },
    });
}

/** Apply a provider occurrence deletion to the canonical dated schedule model. */
async function adoptProjectedPlanDelete(
  database: Database,
  input: {
    readonly hubId: string;
    readonly connectionId: string;
    readonly event: Extract<NormalizedGoogleWorkingLocation, { kind: 'delete' }>;
    readonly binding: NonNullable<Awaited<ReturnType<typeof bindingForRemote>>>;
    readonly assertion: typeof workLocationAssertion.$inferSelect;
    readonly date: string;
  },
): Promise<boolean | null> {
  if (!input.assertion.sourcePlanVersionId) return null;
  const replacement = WorkScheduleExceptionCreate.parse({ date: input.date, segments: [] });
  const conflictPlanId = await queueScheduleConflict(database, { ...input, replacement });
  if (conflictPlanId) {
    const projected = await materializedAssertionForDate(
      database,
      input.hubId,
      conflictPlanId,
      input.date,
    );
    await saveDeletedBinding(database, {
      ...input,
      assertionId: projected?.id ?? input.assertion.id,
      exceptionDate: projected ? null : input.date,
    });
    return true;
  }
  const applied = await setProviderWorkScheduleException(database, {
    hubId: input.hubId,
    connectionId: input.connectionId,
    provider: 'google',
    input: replacement,
    sourceUpdatedAt: input.event.updatedAt,
  });
  if (!applied) return false;
  await materializedAssertionForDate(database, input.hubId, applied.planVersionId, applied.date);
  await saveDeletedBinding(database, {
    ...input,
    assertionId: input.assertion.id,
    exceptionDate: input.date,
  });
  return true;
}

/** Apply a provider tombstone to its canonical master or recurring occurrence. */
async function adoptRemoteDelete(
  database: Database,
  input: {
    readonly hubId: string;
    readonly connectionId: string;
    readonly event: Extract<NormalizedGoogleWorkingLocation, { kind: 'delete' }>;
  },
): Promise<boolean> {
  const binding = await bindingForRemote(database, input.connectionId, input.event.externalEventId);
  if (
    binding?.remoteUpdatedAt &&
    input.event.updatedAt &&
    input.event.updatedAt <= binding.remoteUpdatedAt
  ) {
    return false;
  }
  const parentBinding =
    !binding && input.event.parentExternalEventId
      ? await bindingForRemote(database, input.connectionId, input.event.parentExternalEventId)
      : null;
  const assertionId = binding?.assertionId ?? parentBinding?.assertionId;
  if (!assertionId) return false;
  const assertion = (
    await database
      .select()
      .from(workLocationAssertion)
      .where(eq(workLocationAssertion.id, assertionId))
      .limit(1)
  )[0];
  if (assertion?.hubId !== input.hubId) return false;
  const exceptionDate = binding?.exceptionDate ?? input.event.occurrenceKey?.slice(0, 10) ?? null;
  if (assertion.archivedAt && (!assertion.sourcePlanVersionId || !exceptionDate)) return false;
  if (exceptionDate) {
    const projected = await adoptProjectedPlanDelete(database, {
      ...input,
      binding: binding ?? persisted(parentBinding ?? undefined, 'read provider parent binding'),
      assertion,
      date: exceptionDate,
    });
    if (projected !== null) return projected;
    const existing = (
      await database
        .select({ action: workLocationException.action })
        .from(workLocationException)
        .where(
          and(
            eq(workLocationException.assertionId, assertion.id),
            eq(workLocationException.date, exceptionDate),
          ),
        )
        .limit(1)
    )[0];
    if (existing?.action === 'cancel') {
      await saveDeletedBinding(database, {
        ...input,
        assertionId: assertion.id,
        exceptionDate,
      });
      return false;
    }
    if (binding) {
      if (!existing) return false;
      await database
        .delete(workLocationException)
        .where(
          and(
            eq(workLocationException.assertionId, assertion.id),
            eq(workLocationException.date, exceptionDate),
          ),
        );
    } else {
      await database.insert(workLocationException).values({
        hubId: input.hubId,
        assertionId: assertion.id,
        date: exceptionDate,
        action: 'cancel',
        replacementPlaceId: null,
        replacementSchedule: null,
      });
    }
    await database
      .update(workLocationAssertion)
      .set({ revision: assertion.revision + 1, updatedAt: new Date() })
      .where(eq(workLocationAssertion.id, assertion.id));
    await saveDeletedBinding(database, {
      ...input,
      assertionId: assertion.id,
      exceptionDate,
    });
    const current = persisted(
      (await listWorkLocationAssertions(database, input.hubId)).items.find(
        (candidate) => candidate.id === assertion.id,
      ),
      'read cancelled provider occurrence',
    );
    await enqueueWorkLocationProjection(
      database,
      input.hubId,
      current,
      'update',
      exceptionDate,
      input.connectionId,
    );
  } else {
    const archived = await archiveWorkLocationAssertion(database, input.hubId, assertion.id);
    await enqueueWorkLocationProjection(
      database,
      input.hubId,
      archived,
      'delete',
      null,
      input.connectionId,
    );
  }
  return true;
}

/** Pull and converge every supported linked Google account for one user. */
export async function syncUserWorkLocations(
  database: Database,
  input: {
    readonly userId: string;
    readonly transport: GoogleWorkLocationTransport;
    readonly now?: Date;
  },
): Promise<WorkLocationSyncTally> {
  const hubId = await resolveWorkLocationHubId(input.userId, database);
  await listWorkLocationSync(database, hubId);
  const accounts = await database
    .select({
      connectionId: workLocationSyncAccount.connectionId,
      state: workLocationSyncAccount.state,
      reason: workLocationSyncAccount.reason,
      connectionUserId: calendarConnection.userId,
      externalAccountId: calendarConnection.externalAccountId,
      scopeState: calendarConnection.scopeState,
      syncToken: workLocationSyncAccount.syncToken,
    })
    .from(workLocationSyncAccount)
    .innerJoin(calendarConnection, eq(calendarConnection.id, workLocationSyncAccount.connectionId))
    .where(
      and(
        eq(workLocationSyncAccount.hubId, hubId),
        eq(workLocationSyncAccount.provider, 'google'),
        eq(calendarConnection.userId, input.userId),
        ne(calendarConnection.status, 'disconnected'),
      ),
    )
    .orderBy(asc(calendarConnection.id));
  const tally = { accounts: 0, imported: 0, adopted: 0, deleted: 0, unsupported: 0, errors: 0 };
  for (const account of accounts) {
    if (
      account.state === 'unsupported' ||
      (account.state === 'action_required' && account.reason !== 'unsupported_recurrence')
    ) {
      continue;
    }
    if (account.scopeState && !account.scopeState.calendarWrite) {
      await database
        .update(workLocationSyncAccount)
        .set({
          state: 'action_required',
          reason: 'missing_scope',
          updatedAt: input.now ?? new Date(),
        })
        .where(eq(workLocationSyncAccount.connectionId, account.connectionId));
      tally.errors += 1;
      continue;
    }
    try {
      const pulled = await input.transport.pull({
        connectionId: account.connectionId,
        userId: account.connectionUserId,
        externalAccountId: account.externalAccountId,
        cursor: account.syncToken,
      });
      let unsupported = false;
      for (const raw of pulled.events) {
        const event = normalizeGoogleWorkingLocationEvent(raw);
        if (event.kind === 'ignored') continue;
        if (event.kind === 'unsupported') {
          unsupported = true;
          tally.unsupported += 1;
          continue;
        }
        if (event.kind === 'delete') {
          if (
            await adoptRemoteDelete(database, { hubId, connectionId: account.connectionId, event })
          ) {
            tally.deleted += 1;
          }
          continue;
        }
        const outcome = await adoptRemoteEvent(database, {
          hubId,
          connectionId: account.connectionId,
          event,
        });
        if (outcome === 'imported') tally.imported += 1;
        if (outcome === 'adopted') tally.adopted += 1;
      }
      const now = input.now ?? new Date();
      await database
        .update(workLocationSyncAccount)
        .set({
          state: unsupported ? 'action_required' : 'healthy',
          reason: unsupported ? 'unsupported_recurrence' : null,
          syncToken: pulled.nextCursor,
          bootstrapCompletedAt: now,
          lastSucceededAt: now,
          lastErrorCode: null,
          updatedAt: now,
        })
        .where(eq(workLocationSyncAccount.connectionId, account.connectionId));
      tally.accounts += 1;
    } catch (error) {
      const now = input.now ?? new Date();
      const failure = classifyGoogleSyncFailure(error);
      await database
        .update(workLocationSyncAccount)
        .set({
          state: failure.state,
          reason: failure.reason,
          lastErrorCode: failure.reason,
          updatedAt: now,
        })
        .where(eq(workLocationSyncAccount.connectionId, account.connectionId));
      tally.errors += 1;
    }
  }
  return tally;
}

/** Build the provider assertion snapshot used by one outbox delivery. */
async function providerAssertionForWrite(
  database: Database,
  input: {
    readonly assertion: typeof workLocationAssertion.$inferSelect;
    readonly exceptionDate: string | null;
    readonly connectionId: string;
  },
): Promise<{
  readonly assertion: WorkLocationAssertionOut;
  readonly providerAssertion: Parameters<typeof mapGoogleWorkingLocationAssertion>[0];
  readonly place: GoogleImportedPlace;
} | null> {
  let placeId = input.assertion.placeId;
  let schedule = input.assertion.schedule;
  if (input.exceptionDate) {
    const exception = (
      await database
        .select()
        .from(workLocationException)
        .where(
          and(
            eq(workLocationException.assertionId, input.assertion.id),
            eq(workLocationException.date, input.exceptionDate),
          ),
        )
        .limit(1)
    )[0];
    if (exception?.action === 'cancel') return null;
    if (exception?.action === 'replace') {
      if (!exception.replacementPlaceId || !exception.replacementSchedule) return null;
      placeId = exception.replacementPlaceId;
      schedule = exception.replacementSchedule;
    } else {
      const occurrenceSchedule = scheduleForOccurrence(schedule, input.exceptionDate);
      if (!occurrenceSchedule) return null;
      schedule = occurrenceSchedule;
    }
  }
  const [placeRow, profileRows, mappingRows] = await Promise.all([
    database.select().from(workPlace).where(eq(workPlace.id, placeId)).limit(1),
    database
      .select()
      .from(workLocationProfile)
      .where(eq(workLocationProfile.hubId, input.assertion.hubId))
      .limit(1),
    database
      .select()
      .from(workPlaceProviderMapping)
      .where(
        and(
          eq(workPlaceProviderMapping.placeId, placeId),
          eq(workPlaceProviderMapping.connectionId, input.connectionId),
        ),
      )
      .limit(1),
  ]);
  const placeRowValue = placeRow[0];
  if (!placeRowValue) return null;
  const mapping = mappingRows[0];
  const classification =
    mapping?.classification === 'homeOffice' ||
    mapping?.classification === 'officeLocation' ||
    mapping?.classification === 'customLocation'
      ? mapping.classification
      : null;
  const place: GoogleImportedPlace = {
    suggestedName: placeRowValue.name,
    classification:
      classification ?? (profileRows[0]?.homePlaceId === placeId ? 'homeOffice' : 'customLocation'),
    providerPlaceId: mapping?.providerPlaceId ?? null,
    metadata: mapping?.metadata ?? {},
  };
  const publicAssertion = (
    await listWorkLocationAssertions(database, input.assertion.hubId)
  ).items.find((candidate) => candidate.id === input.assertion.id);
  if (!publicAssertion) return null;
  return {
    assertion: publicAssertion,
    providerAssertion: {
      assertionId: input.assertion.id,
      revision: input.assertion.revision,
      placeId,
      placeName: placeRowValue.name,
      homeDesignated: profileRows[0]?.homePlaceId === placeId,
      classification,
      providerPlaceId: mapping?.providerPlaceId ?? null,
      providerPlaceMetadata: mapping?.metadata ?? {},
      schedule,
    },
    place,
  };
}

/** Drain due canonical projection writes with bounded retry/backoff and no batch calls. */
export async function drainWorkLocationWrites(
  database: Database,
  input: {
    readonly userId: string;
    readonly transport: GoogleWorkLocationTransport;
    readonly now?: Date;
  },
): Promise<WorkLocationDrainTally> {
  const hubId = await resolveWorkLocationHubId(input.userId, database);
  const now = input.now ?? new Date();
  const writes = await database
    .select({ write: workLocationWrite, connection: calendarConnection })
    .from(workLocationWrite)
    .innerJoin(calendarConnection, eq(calendarConnection.id, workLocationWrite.connectionId))
    .where(
      and(
        eq(workLocationWrite.hubId, hubId),
        eq(calendarConnection.userId, input.userId),
        ne(calendarConnection.status, 'disconnected'),
        or(
          eq(workLocationWrite.status, 'pending'),
          and(eq(workLocationWrite.status, 'failed'), lte(workLocationWrite.nextAttemptAt, now)),
        ),
      ),
    )
    .orderBy(asc(workLocationWrite.createdAt));
  const tally = { applied: 0, retried: 0, failed: 0 };
  for (const row of writes) {
    const write = row.write;
    await database
      .update(workLocationWrite)
      .set({ status: 'processing', updatedAt: now })
      .where(eq(workLocationWrite.id, write.id));
    try {
      const assertion = (
        await database
          .select()
          .from(workLocationAssertion)
          .where(eq(workLocationAssertion.id, write.assertionId))
          .limit(1)
      )[0];
      if (assertion?.hubId !== hubId) throw new Error('canonical_assertion_missing');
      const existingBinding = (
        await database
          .select()
          .from(workLocationExternalBinding)
          .where(
            and(
              eq(workLocationExternalBinding.assertionId, assertion.id),
              eq(workLocationExternalBinding.connectionId, write.connectionId),
              write.exceptionDate === null
                ? isNull(workLocationExternalBinding.exceptionDate)
                : eq(workLocationExternalBinding.exceptionDate, write.exceptionDate),
            ),
          )
          .limit(1)
      )[0];
      let instance: GoogleWorkingLocationEvent | null = null;
      if (write.exceptionDate !== null && !existingBinding) {
        const masterBinding = (
          await database
            .select()
            .from(workLocationExternalBinding)
            .where(
              and(
                eq(workLocationExternalBinding.assertionId, assertion.id),
                eq(workLocationExternalBinding.connectionId, write.connectionId),
                isNull(workLocationExternalBinding.exceptionDate),
              ),
            )
            .limit(1)
        )[0];
        if (!masterBinding) throw new Error('provider_parent_missing');
        instance = await input.transport.findInstance({
          connectionId: write.connectionId,
          userId: row.connection.userId,
          externalAccountId: row.connection.externalAccountId,
          masterExternalEventId: masterBinding.externalEventId,
          occurrenceDate: write.exceptionDate,
          timezone: assertion.schedule.timezone,
        });
        if (!instance?.id) throw new Error('provider_instance_missing');
      }
      const externalEventId =
        existingBinding?.externalEventId ??
        instance?.id ??
        googleEventId(assertion.id, write.exceptionDate);
      const externalEtag = existingBinding?.externalEtag ?? instance?.etag ?? null;
      if (write.operation === 'delete') {
        if (existingBinding) {
          await input.transport.delete({
            connectionId: write.connectionId,
            userId: row.connection.userId,
            externalAccountId: row.connection.externalAccountId,
            externalEventId,
            externalEtag,
          });
        }
      } else {
        const resolved = await providerAssertionForWrite(database, {
          assertion,
          exceptionDate: write.exceptionDate,
          connectionId: write.connectionId,
        });
        if (!resolved && write.exceptionDate !== null) {
          await input.transport.delete({
            connectionId: write.connectionId,
            userId: row.connection.userId,
            externalAccountId: row.connection.externalAccountId,
            externalEventId,
            externalEtag,
          });
        } else if (resolved) {
          const projection = mapGoogleWorkingLocationAssertion(resolved.providerAssertion);
          const remote = await input.transport.upsert({
            connectionId: write.connectionId,
            userId: row.connection.userId,
            externalAccountId: row.connection.externalAccountId,
            externalEventId,
            externalEtag,
            body: {
              id: externalEventId,
              ...(write.exceptionDate === null ? {} : { status: 'confirmed' }),
              ...projection.body,
            },
          });
          const normalized = normalizeGoogleWorkingLocationEvent(remote);
          if (normalized.kind !== 'assertion' && normalized.kind !== 'exception') {
            throw new Error('provider_payload_invalid');
          }
          await saveBinding(database, {
            hubId,
            assertionId: assertion.id,
            exceptionDate: write.exceptionDate,
            connectionId: write.connectionId,
            event: normalized,
            payloadHash: canonicalHash({
              schedule: resolved.providerAssertion.schedule,
              place: resolved.place,
            }),
            lastProjectedRevision: write.canonicalRevision,
          });
        }
      }
      await database
        .update(workLocationWrite)
        .set({
          status: 'applied',
          attempts: write.attempts + 1,
          lastErrorCode: null,
          updatedAt: now,
        })
        .where(eq(workLocationWrite.id, write.id));
      await database
        .update(workLocationSyncAccount)
        .set({ lastSucceededAt: now, lastErrorCode: null, updatedAt: now })
        .where(eq(workLocationSyncAccount.connectionId, write.connectionId));
      await database
        .update(workLocationSyncAccount)
        .set({ state: 'healthy', reason: null, updatedAt: now })
        .where(
          and(
            eq(workLocationSyncAccount.connectionId, write.connectionId),
            eq(workLocationSyncAccount.state, 'retrying'),
          ),
        );
      tally.applied += 1;
    } catch {
      const attempts = write.attempts + 1;
      const permanent = attempts >= 8;
      await database
        .update(workLocationWrite)
        .set({
          status: 'failed',
          attempts,
          nextAttemptAt: permanent
            ? null
            : new Date(now.getTime() + Math.min(60, 2 ** attempts) * 60_000),
          lastErrorCode: permanent ? 'delivery_failed' : 'provider_unavailable',
          updatedAt: now,
        })
        .where(eq(workLocationWrite.id, write.id));
      await database
        .update(workLocationSyncAccount)
        .set({
          state: permanent ? 'action_required' : 'retrying',
          reason: 'provider_unavailable',
          lastErrorCode: permanent ? 'delivery_failed' : 'provider_unavailable',
          updatedAt: now,
        })
        .where(eq(workLocationSyncAccount.connectionId, write.connectionId));
      if (permanent) tally.failed += 1;
      else tally.retried += 1;
    }
  }
  return tally;
}

/** Register or renew independent primary-calendar watches for work-location feeds. */
export async function registerWorkLocationWatches(
  database: Database,
  input: {
    readonly userId: string;
    readonly transport: GoogleWorkLocationTransport;
    readonly callbackUrl: string | null;
    readonly now?: Date;
  },
): Promise<number> {
  if (!input.callbackUrl || !input.transport.startWatch) return 0;
  const hubId = await resolveWorkLocationHubId(input.userId, database);
  await listWorkLocationSync(database, hubId);
  const now = input.now ?? new Date();
  const accounts = await database
    .select({ sync: workLocationSyncAccount, connection: calendarConnection })
    .from(workLocationSyncAccount)
    .innerJoin(calendarConnection, eq(calendarConnection.id, workLocationSyncAccount.connectionId))
    .where(
      and(
        eq(workLocationSyncAccount.hubId, hubId),
        eq(workLocationSyncAccount.provider, 'google'),
        eq(workLocationSyncAccount.state, 'healthy'),
        eq(calendarConnection.userId, input.userId),
        ne(calendarConnection.status, 'disconnected'),
      ),
    );
  let registered = 0;
  for (const account of accounts) {
    if (
      account.sync.watchExpiresAt &&
      account.sync.watchExpiresAt > new Date(now.getTime() + 24 * 60 * 60_000)
    ) {
      continue;
    }
    const channelId = `work-location-${account.sync.id}-${String(now.getTime())}`;
    const token = createHash('sha256')
      .update(`${channelId}:${account.connection.id}`)
      .digest('hex');
    const watch = await input.transport.startWatch({
      connectionId: account.connection.id,
      userId: account.connection.userId,
      externalAccountId: account.connection.externalAccountId,
      callbackUrl: input.callbackUrl,
      channelId,
      token,
    });
    await database
      .update(workLocationSyncAccount)
      .set({
        watchChannelId: channelId,
        watchResourceId: watch.resourceId,
        watchToken: token,
        watchExpiresAt: watch.expiresAt,
        updatedAt: now,
      })
      .where(eq(workLocationSyncAccount.id, account.sync.id));
    registered += 1;
  }
  return registered;
}
