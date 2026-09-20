/**
 * `@docket/api` — the calendar-item write service.
 *
 * @remarks
 * Covers CRUD for `calendar_item` rows: `native_block` (focus, travel, do-not-schedule,
 * holds — created directly in Docket, no provider account) is a direct write with
 * `syncState` always `'clean'`; `task_timebox`/`availability_block` are derived views and
 * reject edits outright; `provider_event` is local-first — a PATCH/DELETE applies
 * immediately to the local row, then enqueues a `calendar_item_write` outbox row (see
 * `calendar-outbox.ts`) and attempts the provider push in the foreground. Task-link
 * mutations live in `calendar-task-links.ts`.
 */
import { randomBytes } from 'node:crypto';

import { and, asc, eq, isNull } from 'drizzle-orm';

import {
  calendarConnection,
  calendarItem,
  calendarItemWrite,
  calendarLayer,
  hub,
  type Database,
  workPlace,
} from '@docket/db';
import {
  CalendarItemKind,
  type CalendarItemCreate,
  type CalendarItemPermission,
  type CalendarItemUpdate,
  type CalendarItemWritePatch,
  type CalendarProvider,
} from '@docket/planning/calendar-contract';

import type { ApiError } from '../error';
import {
  CapabilityError,
  ConflictError,
  InsufficientScopeError,
  NotFoundError,
  ValidationError,
} from '../error';
import type { CalendarProviderSyncModule } from '../routes/calendar-sync-engine';

import { attemptCalendarItemWrite } from './calendar-outbox';
import { resolveTimeShapePatch, toWritePatch } from './calendar-write-patch';
import { resolveItemPermissions } from './calendar-permissions';
import { loadOwnedCalendarItem } from './calendar-read';

type CalendarItemRow = typeof calendarItem.$inferSelect;
type CalendarLayerRow = typeof calendarLayer.$inferSelect;
type CalendarConnectionRow = typeof calendarConnection.$inferSelect;

/** The provider → sync-module map an outbox-touching write optionally attempts through. */
type SyncModules = Partial<Record<CalendarProvider, CalendarProviderSyncModule>>;

/** Select a user's native-blocks layer(s), earliest first. */
function selectNativeLayers(db: Database, userId: string) {
  return db
    .select()
    .from(calendarLayer)
    .where(and(eq(calendarLayer.userId, userId), eq(calendarLayer.sourceKind, 'native_blocks')))
    .orderBy(asc(calendarLayer.createdAt))
    .limit(1);
}

/**
 * Resolve (creating lazily on first use) the user's single default native-blocks layer.
 *
 * @remarks
 * Enforced by a SELECT-before-INSERT check: only insert when the user has no
 * `native_blocks` layer yet. The existing `calendar_layer_connection_external_uq` unique
 * index on `(connectionId, externalLayerId)` does NOT guard this — every native layer has
 * both columns `null`, and Postgres treats `null = null` as distinct for uniqueness, so
 * two concurrent first-use calls can each pass the SELECT check and insert their own row.
 * Rather than adding a new partial-unique index (out of scope here), this tolerates that
 * rare race the simple way: after inserting, re-SELECT ordered by `createdAt` and return
 * the earliest row. Both racing callers converge on the same canonical layer; a loser's
 * extra row is orphaned (unused, since every later call also resolves to the earliest
 * row) rather than causing a duplicate-layer bug visible to the user.
 *
 * @param db - The database client.
 * @param userId - The owning Docket user id.
 * @returns the user's canonical native-blocks layer row.
 */
export async function ensureNativeLayer(db: Database, userId: string): Promise<CalendarLayerRow> {
  const existing = await selectNativeLayers(db, userId);
  const existingLayer = existing[0];
  if (existingLayer !== undefined) return existingLayer;

  await db.insert(calendarLayer).values({
    userId,
    connectionId: null,
    provider: 'docket',
    sourceKind: 'native_blocks',
    title: 'Docket blocks',
    selected: true,
    visibleByDefault: true,
    editableCore: true,
    primary: false,
  });

  const afterInsert = await selectNativeLayers(db, userId);
  const canonical = afterInsert[0];
  /* v8 ignore next -- @preserve defensive: the insert above guarantees at least one row */
  if (canonical === undefined) throw new Error('native layer insert returned no row');
  return canonical;
}

/** Resolve an explicit `layerId` input to one of the caller's own native-block layers. */
async function requireOwnedNativeLayer(
  db: Database,
  userId: string,
  layerId: string,
): Promise<CalendarLayerRow> {
  const rows = await db
    .select()
    .from(calendarLayer)
    .where(and(eq(calendarLayer.id, layerId), eq(calendarLayer.userId, userId)))
    .limit(1);
  const layer = rows[0];
  if (layer?.sourceKind !== 'native_blocks') {
    throw new ValidationError([
      { path: ['layerId'], message: 'layerId must reference one of your native-block layers' },
    ]);
  }
  return layer;
}

/**
 * Verify that a saved-place binding belongs to the caller's personal Hub.
 *
 * @remarks
 * Calendar DTOs never carry a Hub id. Looking the place up through the Hub owner both enforces
 * that boundary and intentionally makes another user's place indistinguishable from a missing one.
 */
async function requireOwnedWorkPlace(
  db: Database,
  userId: string,
  workPlaceId: string | null | undefined,
): Promise<void> {
  if (workPlaceId === undefined || workPlaceId === null) return;
  const rows = await db
    .select({ id: workPlace.id })
    .from(workPlace)
    .innerJoin(hub, eq(hub.id, workPlace.hubId))
    .where(and(eq(workPlace.id, workPlaceId), eq(hub.userId, userId), isNull(workPlace.archivedAt)))
    .limit(1);
  if (rows[0] === undefined) throw new NotFoundError('Work place not found');
}

/**
 * Validate a create body's time bounds beyond the DTO refine: exactly one complete shape
 * (the DTO's "either shape is complete" refine also passes a body carrying BOTH complete
 * shapes, which would violate the row's timed-XOR-all-day invariant) with strict ordering.
 */
function validateCreateBounds(input: CalendarItemCreate): void {
  const hasTimedShape = input.startsAt !== undefined && input.endsAt !== undefined;
  const hasAllDayShape = input.allDayStartDate !== undefined && input.allDayEndDate !== undefined;
  if (hasTimedShape && hasAllDayShape) {
    throw new ValidationError([
      {
        path: ['startsAt'],
        message: 'A block is either timed or all-day — provide exactly one shape',
      },
    ]);
  }
  if (input.startsAt !== undefined && input.endsAt !== undefined) {
    if (new Date(input.endsAt) <= new Date(input.startsAt)) {
      throw new ValidationError([
        { path: ['endsAt'], message: '`endsAt` must be after `startsAt`' },
      ]);
    }
  }
  if (input.allDayStartDate !== undefined && input.allDayEndDate !== undefined) {
    if (input.allDayEndDate <= input.allDayStartDate) {
      throw new ValidationError([
        {
          path: ['allDayEndDate'],
          message: '`allDayEndDate` must be after `allDayStartDate` (exclusive end)',
        },
      ]);
    }
  }
}

/**
 * Create a Docket-native calendar block.
 *
 * @remarks
 * Always inserts `kind: 'native_block'`, `provider: 'docket'`, `syncState: 'clean'`,
 * `connectionId: null` — native blocks never enter the provider write outbox.
 *
 * @param db - The database client.
 * @param input.userId - The owning Docket user id.
 * @param input.input - The validated create body.
 * @throws {ValidationError} When an explicit `layerId` does not belong to the caller's
 *   own native-block layers, or the time bounds are out of order.
 */
export async function createNativeBlock(
  db: Database,
  input: { userId: string; input: CalendarItemCreate },
): Promise<CalendarItemRow> {
  const { userId, input: body } = input;

  await requireOwnedWorkPlace(db, userId, body.workPlaceId);

  const layer =
    body.layerId !== undefined
      ? await requireOwnedNativeLayer(db, userId, body.layerId)
      : await ensureNativeLayer(db, userId);

  validateCreateBounds(body);

  const inserted = await db
    .insert(calendarItem)
    .values({
      userId,
      layerId: layer.id,
      kind: 'native_block',
      provider: 'docket',
      // Documented default, not a hidden fallback: the DTO declares `status` as
      // "omitted defaults server-side (typically 'confirmed')" — `body.status` is never null.
      status: body.status ?? 'confirmed',
      syncState: 'clean',
      connectionId: null,
      ...authoredColumns(body),
    })
    .returning();
  const row = inserted[0];
  /* v8 ignore next -- @preserve defensive: insert always returns a row */
  if (row === undefined) throw new Error('native block insert returned no row');
  return row;
}

/**
 * The columns a create body authors, with every omitted field left out.
 *
 * @remarks
 * Every insert path — native block, timebox, Docket-owned event, provider event — writes exactly
 * these, so stating them once is what keeps the four from drifting apart as fields are added.
 *
 * @param body - The validated create body.
 * @returns The column values to spread into the insert.
 */
function authoredColumns(body: CalendarItemCreate) {
  return {
    title: body.title,
    ...(body.workPlaceId !== undefined ? { workPlaceId: body.workPlaceId } : {}),
    ...(body.description !== undefined ? { description: body.description } : {}),
    ...(body.location !== undefined ? { location: body.location } : {}),
    ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
    ...(body.endTimezone !== undefined ? { endTimezone: body.endTimezone } : {}),
    ...(body.startsAt !== undefined ? { startsAt: new Date(body.startsAt) } : {}),
    ...(body.endsAt !== undefined ? { endsAt: new Date(body.endsAt) } : {}),
    ...(body.allDayStartDate !== undefined ? { allDayStartDate: body.allDayStartDate } : {}),
    ...(body.allDayEndDate !== undefined ? { allDayEndDate: body.allDayEndDate } : {}),
  };
}

/** Build the complete provider write payload for a newly-created event. */
function createWritePatch(body: CalendarItemCreate): CalendarItemWritePatch {
  return {
    title: body.title,
    ...(body.description !== undefined ? { description: body.description } : {}),
    ...(body.location !== undefined ? { location: body.location } : {}),
    ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
    ...(body.endTimezone !== undefined ? { endTimezone: body.endTimezone } : {}),
    ...(body.startsAt !== undefined ? { startsAt: body.startsAt } : {}),
    ...(body.endsAt !== undefined ? { endsAt: body.endsAt } : {}),
    ...(body.allDayStartDate !== undefined ? { allDayStartDate: body.allDayStartDate } : {}),
    ...(body.allDayEndDate !== undefined ? { allDayEndDate: body.allDayEndDate } : {}),
  };
}

/**
 * Create an event or first-class timebox from the fluid scheduling canvas.
 *
 * @remarks
 * Timeboxes and destination-less events are Docket-owned direct writes. An event targeting a
 * writable provider layer is inserted locally first with a stable provider id, then enqueued as a
 * `create` write and attempted once. This local-first boundary keeps the item visible through
 * provider outages and makes every retry idempotent.
 */
export async function createCalendarItem(
  db: Database,
  input: { userId: string; input: CalendarItemCreate; syncModules?: SyncModules },
): Promise<CalendarItemRow> {
  const { userId, input: body } = input;
  if ('kind' in body && body.kind === 'native_block') {
    return createNativeBlock(db, { userId, input: body });
  }

  validateCreateBounds(body);
  await requireOwnedWorkPlace(db, userId, body.workPlaceId);
  const requestedLayer = await resolveRequestedLayer(db, userId, body.layerId);

  const nativeLayer = await resolveNativeLayer(db, userId, body, requestedLayer);
  if (body.intent === 'timebox' || nativeLayer !== null) {
    return insertDocketOwnedItem(db, userId, body, nativeLayer);
  }

  const connection = requestedLayer?.connection ?? null;
  if (
    requestedLayer === null ||
    connection === null ||
    requestedLayer.layer.sourceKind !== 'provider_calendar' ||
    !requestedLayer.layer.editableCore ||
    requestedLayer.layer.externalLayerId === null ||
    connection.scopeState?.calendarWrite !== true
  ) {
    throw new InsufficientScopeError(
      'calendar.write',
      'The selected calendar is not available for event creation',
    );
  }

  return insertProviderEvent(
    db,
    userId,
    body,
    { layer: requestedLayer.layer, connection },
    input.syncModules,
  );
}

/** A calendar layer the caller named, with the connection it belongs to. */
interface RequestedLayer {
  readonly layer: CalendarLayerRow;
  readonly connection: CalendarConnectionRow | null;
}

/**
 * Load the layer a create body named, scoped to its owner.
 *
 * @param db - The database client.
 * @param userId - The owning Docket user id.
 * @param layerId - The layer the body named, if any.
 * @returns The layer and its connection, or `null` when the body named none.
 * @throws {NotFoundError} When the named layer is not one of this user's.
 */
async function resolveRequestedLayer(
  db: Database,
  userId: string,
  layerId: string | undefined,
): Promise<RequestedLayer | null> {
  if (layerId === undefined) return null;
  const [found] = await db
    .select({ layer: calendarLayer, connection: calendarConnection })
    .from(calendarLayer)
    .leftJoin(calendarConnection, eq(calendarConnection.id, calendarLayer.connectionId))
    .where(and(eq(calendarLayer.id, layerId), eq(calendarLayer.userId, userId)))
    .limit(1);
  if (found === undefined) throw new NotFoundError('Calendar layer not found');
  return found;
}

/**
 * Decide which Docket-owned layer this item lands on, if any.
 *
 * @param db - The database client.
 * @param userId - The owning Docket user id.
 * @param body - The validated create body.
 * @param requested - The layer the body named, if any.
 * @returns The native layer, or `null` when the body targets a provider calendar.
 */
async function resolveNativeLayer(
  db: Database,
  userId: string,
  body: CalendarItemCreate,
  requested: RequestedLayer | null,
): Promise<CalendarLayerRow | null> {
  if (requested?.layer.sourceKind === 'native_blocks') return requested.layer;
  if (body.layerId === undefined) return ensureNativeLayer(db, userId);
  return null;
}

/**
 * Insert a timebox or Docket-owned event, which never enters the provider write outbox.
 *
 * @param db - The database client.
 * @param userId - The owning Docket user id.
 * @param body - The validated create body.
 * @param nativeLayer - The resolved Docket-owned layer, when one was resolved.
 * @returns The inserted row.
 * @throws {ValidationError} When a timebox names a layer Docket does not own.
 */
async function insertDocketOwnedItem(
  db: Database,
  userId: string,
  body: CalendarItemCreate,
  nativeLayer: CalendarLayerRow | null,
): Promise<CalendarItemRow> {
  if (body.intent === 'timebox' && body.layerId !== undefined && nativeLayer === null) {
    throw new ValidationError([
      { path: ['layerId'], message: 'Timeboxes must use a Docket-owned calendar layer' },
    ]);
  }
  /* v8 ignore next -- @preserve defensive: the branches above always resolve a native layer */
  const targetLayer = nativeLayer ?? (await ensureNativeLayer(db, userId));
  const inserted = await db
    .insert(calendarItem)
    .values({
      userId,
      layerId: targetLayer.id,
      connectionId: null,
      kind: body.intent === 'timebox' ? 'timebox' : 'native_event',
      provider: 'docket',
      status: body.status ?? 'confirmed',
      syncState: 'clean',
      ...authoredColumns(body),
    })
    .returning();
  const row = inserted[0];
  /* v8 ignore next -- @preserve defensive: insert always returns a row */
  if (row === undefined) throw new Error('calendar item insert returned no row');
  return row;
}

/**
 * Insert a provider event locally, enqueue its `create` write, and attempt it once.
 *
 * @remarks
 * This local-first boundary keeps the item visible through provider outages and makes every retry
 * idempotent: the external id is minted here and reused by every attempt.
 *
 * @param db - The database client.
 * @param userId - The owning Docket user id.
 * @param body - The validated create body.
 * @param target - The writable provider layer and its connection.
 * @param syncModules - The sync modules, when the caller wants the write attempted inline.
 * @returns The inserted row, re-read after the attempt so its sync state is current.
 */
async function insertProviderEvent(
  db: Database,
  userId: string,
  body: CalendarItemCreate,
  target: { layer: CalendarLayerRow; connection: CalendarConnectionRow },
  syncModules: SyncModules | undefined,
): Promise<CalendarItemRow> {
  // Google-compatible lowercase hexadecimal is stable across every outbox retry. Other adapters
  // receive the same opaque id through the provider-neutral create contract.
  const externalEventId = randomBytes(16).toString('hex');
  const inserted = await db
    .insert(calendarItem)
    .values({
      userId,
      layerId: target.layer.id,
      connectionId: target.connection.id,
      kind: 'provider_event',
      provider: target.connection.provider,
      externalCalendarId: target.layer.externalLayerId,
      externalEventId,
      status: body.status ?? 'confirmed',
      syncState: 'push_pending',
      permissions: { canEditCore: true, canDelete: true, readOnlyReason: null },
      ...authoredColumns(body),
    })
    .returning();
  const created = inserted[0];
  /* v8 ignore next -- @preserve defensive: insert always returns a row */
  if (created === undefined) throw new Error('provider calendar item insert returned no row');

  const writeRows = await db
    .insert(calendarItemWrite)
    .values({
      userId,
      calendarItemId: created.id,
      connectionId: target.connection.id,
      provider: target.connection.provider,
      operation: 'create',
      patch: createWritePatch(body),
      status: 'pending',
      attempts: 0,
    })
    .returning({ id: calendarItemWrite.id });
  const write = writeRows[0];
  /* v8 ignore next -- @preserve defensive: insert always returns a row */
  if (write === undefined) throw new Error('calendar create outbox insert returned no row');
  if (syncModules !== undefined) {
    await attemptCalendarItemWrite(db, write.id, syncModules);
  }
  const fresh = await db
    .select()
    .from(calendarItem)
    .where(eq(calendarItem.id, created.id))
    .limit(1);
  return fresh[0] ?? created;
}

/** Reject a PATCH/DELETE against a derived-view kind (`task_timebox`/`availability_block`). */
function rejectDerivedKind(kind: CalendarItemKind, action: 'edits' | 'deletion'): never {
  throw new ValidationError([
    {
      path: ['id'],
      message: `'${kind}' items are a derived view and do not support ${action} via this route`,
    },
  ]);
}

/**
 * Map a resolved-permission read-only reason to its typed problem.
 *
 * @remarks
 * An explicit, exhaustive switch (per this task's binding rules) — a reason added to
 * {@link CalendarItemPermission} later without a case here is a compile error, not a
 * silently-allowed fallthrough.
 */
function problemForReadOnlyReason(reason: CalendarItemPermission['readOnlyReason']): ApiError {
  switch (reason) {
    case 'provider_scope':
      return new InsufficientScopeError(
        'calendar.write',
        "This Google account hasn't granted calendar write access — reconnect with write permission to edit this event",
      );
    case 'conflict':
      return new ConflictError('Resolve the conflict before editing this event');
    case 'layer_access_role':
      return new CapabilityError('This calendar is not editable for your account role');
    case 'event_capability':
      return new CapabilityError('This event does not allow edits by the connected account');
    case 'recurrence_unsupported':
      return new CapabilityError('Recurring event edits are not supported yet');
    case 'kind':
      return new CapabilityError('This calendar item kind is not editable');
    case null:
      /* v8 ignore next -- @preserve defensive: canEditCore/canDelete false implies a non-null reason */
      return new CapabilityError('This calendar item is read-only');
  }
}

/**
 * The local columns a patch body sets, with every untouched field left out.
 *
 * @remarks
 * Empty-string `description` and `location` clear the column to `NULL` per the DTO contract.
 *
 * @param patch - The validated update body.
 * @returns The column values to spread into the update.
 */
function patchedColumns(patch: CalendarItemUpdate): Partial<typeof calendarItem.$inferInsert> {
  const values: Partial<typeof calendarItem.$inferInsert> = {};
  if (patch.title !== undefined) values.title = patch.title;
  if (patch.description !== undefined) {
    values.description = patch.description === '' ? null : patch.description;
  }
  if (patch.location !== undefined) {
    values.location = patch.location === '' ? null : patch.location;
  }
  if (patch.timezone !== undefined) values.timezone = patch.timezone;
  if (patch.endTimezone !== undefined) values.endTimezone = patch.endTimezone;
  if (patch.workPlaceId !== undefined) values.workPlaceId = patch.workPlaceId;
  return values;
}

/**
 * Apply a validated patch to an already-loaded, already-owned `native_block` row.
 *
 * @remarks
 * See {@link resolveTimeShapePatch} for the time-shape switching rules.
 *
 * @throws {ValidationError} When the resulting time shape is invalid.
 */
async function applyNativeBlockPatch(
  db: Database,
  existing: CalendarItemRow,
  patch: CalendarItemUpdate,
): Promise<CalendarItemRow> {
  const updated = await db
    .update(calendarItem)
    .set({ ...patchedColumns(patch), ...resolveTimeShapePatch(existing, patch) })
    .where(eq(calendarItem.id, existing.id))
    .returning();
  const row = updated[0];
  /* v8 ignore next -- @preserve defensive: existence was verified by the caller */
  if (row === undefined) throw new NotFoundError('Calendar item not found');
  return row;
}

/**
 * Hard-delete an already-loaded, already-owned `native_block` row.
 *
 * @remarks
 * Native blocks have no provider tombstone semantics (unlike `provider_event`, which
 * soft-archives to reconcile with the provider), so this is a real `DELETE`.
 * `calendar_item_task_link` rows referencing the item cascade via its FK
 * (`ON DELETE CASCADE`) — no explicit cleanup needed here.
 */
async function hardDeleteCalendarItem(
  db: Database,
  existing: CalendarItemRow,
): Promise<CalendarItemRow> {
  const deleted = await db.delete(calendarItem).where(eq(calendarItem.id, existing.id)).returning();
  const row = deleted[0];
  /* v8 ignore next -- @preserve defensive: existence was verified by the caller */
  if (row === undefined) throw new NotFoundError('Calendar item not found');
  return row;
}

/**
 * Patch a calendar item's core fields — the single entry point PATCH `/items/:id` calls,
 * dispatching by kind.
 *
 * @remarks
 * `native_block` applies directly (`syncState` stays `'clean'`). `task_timebox`/
 * `availability_block` are derived views and reject edits. `provider_event` is
 * local-first: {@link resolveItemPermissions} gates the edit, the patch applies to the
 * local row immediately (`syncState` -> `'push_pending'`), a `calendar_item_write`
 * outbox row is enqueued, and — when `syncModules` is supplied — one foreground push
 * attempt runs before this returns, so most edits are already `'clean'` by the time the
 * caller re-reads the item.
 *
 * @param db - The database client.
 * @param input.userId - The owning Docket user id.
 * @param input.itemId - The calendar item id to patch.
 * @param input.patch - The validated update body.
 * @param input.syncModules - The provider → sync-module map for the foreground push
 *   attempt; omit only in contexts that intentionally skip it (e.g. isolated unit tests).
 * @throws {NotFoundError} When the item does not exist or is not owned by `userId`.
 * @throws {ValidationError} When the item kind rejects edits, or the resulting time shape is invalid.
 * @throws {InsufficientScopeError} When a `provider_event` edit needs calendar write scope the connection lacks.
 * @throws {ConflictError} When a `provider_event` item has an unresolved conflict.
 * @throws {CapabilityError} When a `provider_event` edit is denied for another read-only reason.
 */
/**
 * Apply the one field a provider event owns locally, without touching the outbox.
 *
 * @param db - The database client.
 * @param itemId - The calendar item to patch.
 * @param workPlaceId - The saved place to bind, as the patch body carried it.
 * @returns The updated row.
 * @throws {NotFoundError} When the row disappeared between the load and the update.
 */
async function applyLocalOnlyPatch(
  db: Database,
  itemId: string,
  workPlaceId: string | null | undefined,
): Promise<CalendarItemRow> {
  const rows = await db
    .update(calendarItem)
    .set({ workPlaceId })
    .where(eq(calendarItem.id, itemId))
    .returning();
  const row = rows[0];
  /* v8 ignore next -- @preserve defensive: existence was verified by the caller */
  if (row === undefined) throw new NotFoundError('Calendar item not found');
  return row;
}

/** Apply an authenticated patch to a calendar item and synchronize provider-owned fields. */
export async function updateCalendarItem(
  db: Database,
  input: { userId: string; itemId: string; patch: CalendarItemUpdate; syncModules?: SyncModules },
): Promise<CalendarItemRow> {
  const { userId, itemId, patch } = input;
  const loaded = await loadOwnedCalendarItem(db, userId, itemId);
  const kind = CalendarItemKind.parse(loaded.item.kind);

  await requireOwnedWorkPlace(db, userId, patch.workPlaceId);

  if (kind === 'native_block' || kind === 'native_event' || kind === 'timebox') {
    return applyNativeBlockPatch(db, loaded.item, patch);
  }
  if (kind === 'task_timebox' || kind === 'availability_block') rejectDerivedKind(kind, 'edits');

  // kind === 'provider_event'
  const timePatch = resolveTimeShapePatch(loaded.item, patch);
  const providerPatch = toWritePatch(patch, timePatch, loaded.item);
  // Nothing the provider owns changed, so this stays a purely local write.
  if (Object.keys(providerPatch).length === 0) {
    return applyLocalOnlyPatch(db, itemId, patch.workPlaceId);
  }

  const permissions = resolveItemPermissions(loaded);
  if (!permissions.canEditCore) throw problemForReadOnlyReason(permissions.readOnlyReason);

  const connection = loaded.connection;
  /* v8 ignore next -- @preserve defensive: canEditCore true for provider_event requires a connection */
  if (connection === null) throw new Error('provider_event item missing its connection');

  const updatedRows = await db
    .update(calendarItem)
    .set({ ...patchedColumns(patch), ...timePatch, syncState: 'push_pending' })
    .where(eq(calendarItem.id, itemId))
    .returning();
  const updated = updatedRows[0];
  /* v8 ignore next -- @preserve defensive: existence was verified above */
  if (updated === undefined) throw new NotFoundError('Calendar item not found');

  const insertedWrite = await db
    .insert(calendarItemWrite)
    .values({
      userId,
      calendarItemId: itemId,
      connectionId: connection.id,
      provider: connection.provider,
      operation: 'update',
      patch: providerPatch,
      baseExternalEtag: loaded.item.externalEtag,
      baseUpdatedExternalAt: loaded.item.updatedExternalAt,
      status: 'pending',
      attempts: 0,
    })
    .returning({ id: calendarItemWrite.id });
  const write = insertedWrite[0];
  /* v8 ignore next -- @preserve defensive: insert always returns a row */
  if (write === undefined) throw new Error('calendar item write insert returned no row');

  if (input.syncModules !== undefined) {
    await attemptCalendarItemWrite(db, write.id, input.syncModules);
  }

  return updated;
}

/**
 * Delete (or, for `provider_event`, queue the archival of) a calendar item — the single
 * entry point DELETE `/items/:id` calls, dispatching by kind.
 *
 * @remarks
 * `native_block` hard-deletes immediately. `task_timebox`/`availability_block` are
 * derived views and reject deletion. `provider_event` is local-first but NOT
 * locally archived up front (unlike a hard delete, an archive that later turns out to be
 * a conflict would hide the item from the user while the provider still has it): a
 * `calendar_item_write` `'delete'` outbox row is enqueued and attempted in the
 * foreground; only an `'applied'` outcome archives the item (see `calendar-outbox.ts`'s
 * `persistApplied`). Any other outcome leaves the item visible with `syncState`
 * reflecting it (`'push_pending'`/`'conflict'`/`'provider_error'`).
 *
 * @param db - The database client.
 * @param input.userId - The owning Docket user id.
 * @param input.itemId - The calendar item id to delete.
 * @param input.syncModules - The provider → sync-module map for the foreground push attempt.
 * @throws {NotFoundError} When the item does not exist or is not owned by `userId`.
 * @throws {ValidationError} When the item kind rejects deletion.
 * @throws {InsufficientScopeError} When a `provider_event` delete needs calendar write scope the connection lacks.
 * @throws {ConflictError} When a `provider_event` item has an unresolved conflict.
 * @throws {CapabilityError} When a `provider_event` delete is denied for another read-only reason.
 * @returns the item row after the operation — hard-deleted (native) or the fresh (possibly archived) row (provider).
 */
export async function deleteCalendarItem(
  db: Database,
  input: { userId: string; itemId: string; syncModules?: SyncModules },
): Promise<CalendarItemRow> {
  const { userId, itemId } = input;
  const loaded = await loadOwnedCalendarItem(db, userId, itemId);
  const kind = CalendarItemKind.parse(loaded.item.kind);

  if (kind === 'native_block' || kind === 'native_event' || kind === 'timebox') {
    return hardDeleteCalendarItem(db, loaded.item);
  }
  if (kind === 'task_timebox' || kind === 'availability_block') rejectDerivedKind(kind, 'deletion');

  // kind === 'provider_event'
  const permissions = resolveItemPermissions(loaded);
  if (!permissions.canDelete) throw problemForReadOnlyReason(permissions.readOnlyReason);

  const connection = loaded.connection;
  /* v8 ignore next -- @preserve defensive: canDelete true for provider_event requires a connection */
  if (connection === null) throw new Error('provider_event item missing its connection');

  const insertedWrite = await db
    .insert(calendarItemWrite)
    .values({
      userId,
      calendarItemId: itemId,
      connectionId: connection.id,
      provider: connection.provider,
      operation: 'delete',
      patch: {},
      baseExternalEtag: loaded.item.externalEtag,
      baseUpdatedExternalAt: loaded.item.updatedExternalAt,
      status: 'pending',
      attempts: 0,
    })
    .returning({ id: calendarItemWrite.id });
  const write = insertedWrite[0];
  /* v8 ignore next -- @preserve defensive: insert always returns a row */
  if (write === undefined) throw new Error('calendar item write insert returned no row');

  await db
    .update(calendarItem)
    .set({ syncState: 'push_pending' })
    .where(eq(calendarItem.id, itemId));

  if (input.syncModules !== undefined) {
    await attemptCalendarItemWrite(db, write.id, input.syncModules);
  }

  const freshRows = await db
    .select()
    .from(calendarItem)
    .where(eq(calendarItem.id, itemId))
    .limit(1);
  const fresh = freshRows[0];
  /* v8 ignore next -- @preserve defensive: the row cannot vanish between the update above and this read */
  if (fresh === undefined) throw new NotFoundError('Calendar item not found');
  return fresh;
}
