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
import { and, asc, eq } from 'drizzle-orm';

import { calendarItem, calendarItemWrite, calendarLayer, type Database } from '@docket/db';
import {
  CalendarItemKind,
  type CalendarItemCreate,
  type CalendarItemPermission,
  type CalendarItemUpdate,
  type CalendarItemWritePatch,
  type CalendarProvider,
} from '@docket/types';

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
import { resolveItemPermissions } from './calendar-permissions';
import { loadOwnedCalendarItem } from './calendar-read';

type CalendarItemRow = typeof calendarItem.$inferSelect;
type CalendarLayerRow = typeof calendarLayer.$inferSelect;

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

  const layer =
    body.layerId !== undefined
      ? await requireOwnedNativeLayer(db, userId, body.layerId)
      : await ensureNativeLayer(db, userId);

  validateCreateBounds(body);

  // Documented default, not a hidden fallback: the DTO declares `status` as
  // "omitted defaults server-side (typically 'confirmed')" — `body.status` is never null.
  const status = body.status ?? 'confirmed';

  const inserted = await db
    .insert(calendarItem)
    .values({
      userId,
      layerId: layer.id,
      kind: 'native_block',
      provider: 'docket',
      status,
      syncState: 'clean',
      connectionId: null,
      title: body.title,
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.location !== undefined ? { location: body.location } : {}),
      ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
      ...(body.startsAt !== undefined ? { startsAt: new Date(body.startsAt) } : {}),
      ...(body.endsAt !== undefined ? { endsAt: new Date(body.endsAt) } : {}),
      ...(body.allDayStartDate !== undefined ? { allDayStartDate: body.allDayStartDate } : {}),
      ...(body.allDayEndDate !== undefined ? { allDayEndDate: body.allDayEndDate } : {}),
    })
    .returning();
  const row = inserted[0];
  /* v8 ignore next -- @preserve defensive: insert always returns a row */
  if (row === undefined) throw new Error('native block insert returned no row');
  return row;
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

/** Build the outbox-stored patch from a validated update body + its resolved time-shape fields. */
function toWritePatch(
  patch: CalendarItemUpdate,
  timePatch: TimeShapePatch,
): CalendarItemWritePatch {
  const out: CalendarItemWritePatch = {};
  if (patch.title !== undefined) out.title = patch.title;
  if (patch.description !== undefined) out.description = patch.description;
  if (patch.location !== undefined) out.location = patch.location;
  if (patch.timezone !== undefined) out.timezone = patch.timezone;
  if (timePatch.startsAt) out.startsAt = timePatch.startsAt.toISOString();
  if (timePatch.endsAt) out.endsAt = timePatch.endsAt.toISOString();
  if (timePatch.allDayStartDate) out.allDayStartDate = timePatch.allDayStartDate;
  if (timePatch.allDayEndDate) out.allDayEndDate = timePatch.allDayEndDate;
  return out;
}

/**
 * The subset of {@link CalendarItemUpdate} time fields, resolved to a patch.
 *
 * @remarks
 * A shape-switching patch sets the OLD shape's columns to `null` explicitly (not
 * `undefined` — Drizzle's `.set()` skips keys whose value is `undefined`, so clearing a
 * column requires the literal `null`). A same-shape patch omits the other shape's keys
 * entirely, since they are already `null` on a single-shape row.
 */
interface TimeShapePatch {
  startsAt?: Date | null;
  endsAt?: Date | null;
  allDayStartDate?: string | null;
  allDayEndDate?: string | null;
}

/**
 * Resolve the time-shape portion of a patch against the item's current shape.
 *
 * @remarks
 * A patch touching only fields of the item's CURRENT shape (e.g. just `endsAt` on an
 * already-timed item) is a same-shape partial update — it merges with the existing value
 * of the untouched field of that shape. A patch touching fields of the OTHER shape is a
 * shape switch, which requires BOTH fields of the new shape (the full new shape) and
 * clears the old shape's columns to `null`. Touching fields from both shapes at once is
 * rejected as ambiguous. Every branch validates the resulting ordering
 * (`endsAt > startsAt` / `allDayEndDate > allDayStartDate`, exclusive end).
 */
function resolveTimeShapePatch(item: CalendarItemRow, patch: CalendarItemUpdate): TimeShapePatch {
  const timedFieldsPresent = patch.startsAt !== undefined || patch.endsAt !== undefined;
  const allDayFieldsPresent =
    patch.allDayStartDate !== undefined || patch.allDayEndDate !== undefined;

  if (timedFieldsPresent && allDayFieldsPresent) {
    throw new ValidationError([
      {
        path: ['startsAt'],
        message: 'Cannot patch timed and all-day fields in the same request',
      },
    ]);
  }

  const currentlyTimed = item.startsAt !== null;

  if (timedFieldsPresent) {
    if (currentlyTimed) {
      const startsAt = patch.startsAt !== undefined ? new Date(patch.startsAt) : item.startsAt;
      const endsAt = patch.endsAt !== undefined ? new Date(patch.endsAt) : item.endsAt;
      /* v8 ignore next -- @preserve defensive: an item currently timed has both columns set */
      if (startsAt === null || endsAt === null) throw new Error('timed item missing bounds');
      if (endsAt <= startsAt) {
        throw new ValidationError([
          { path: ['endsAt'], message: '`endsAt` must be after `startsAt`' },
        ]);
      }
      return { startsAt, endsAt };
    }

    // Switching all-day -> timed requires the complete new shape.
    if (patch.startsAt === undefined || patch.endsAt === undefined) {
      throw new ValidationError([
        {
          path: ['startsAt'],
          message: 'Switching to a timed block requires both `startsAt` and `endsAt`',
        },
      ]);
    }
    const startsAt = new Date(patch.startsAt);
    const endsAt = new Date(patch.endsAt);
    if (endsAt <= startsAt) {
      throw new ValidationError([
        { path: ['endsAt'], message: '`endsAt` must be after `startsAt`' },
      ]);
    }
    return { startsAt, endsAt, allDayStartDate: null, allDayEndDate: null };
  }

  if (allDayFieldsPresent) {
    if (!currentlyTimed) {
      // Same-shape merge, not a hidden fallback: an omitted field keeps the row's
      // current value (the patch never carries null for these).
      const allDayStartDate = patch.allDayStartDate ?? item.allDayStartDate;
      const allDayEndDate = patch.allDayEndDate ?? item.allDayEndDate;
      /* v8 ignore next -- @preserve defensive: an all-day item has both columns set */
      if (allDayStartDate === null || allDayEndDate === null) {
        throw new Error('all-day item missing bounds');
      }
      if (allDayEndDate <= allDayStartDate) {
        throw new ValidationError([
          {
            path: ['allDayEndDate'],
            message: '`allDayEndDate` must be after `allDayStartDate` (exclusive end)',
          },
        ]);
      }
      return { allDayStartDate, allDayEndDate };
    }

    // Switching timed -> all-day requires the complete new shape.
    if (patch.allDayStartDate === undefined || patch.allDayEndDate === undefined) {
      throw new ValidationError([
        {
          path: ['allDayStartDate'],
          message:
            'Switching to an all-day block requires both `allDayStartDate` and `allDayEndDate`',
        },
      ]);
    }
    if (patch.allDayEndDate <= patch.allDayStartDate) {
      throw new ValidationError([
        {
          path: ['allDayEndDate'],
          message: '`allDayEndDate` must be after `allDayStartDate` (exclusive end)',
        },
      ]);
    }
    return {
      allDayStartDate: patch.allDayStartDate,
      allDayEndDate: patch.allDayEndDate,
      startsAt: null,
      endsAt: null,
    };
  }

  return {};
}

/**
 * Apply a validated patch to an already-loaded, already-owned `native_block` row.
 *
 * @remarks
 * Empty-string `description`/`location` clear the field to `NULL` per the DTO contract.
 * See {@link resolveTimeShapePatch} for the time-shape switching rules.
 *
 * @throws {ValidationError} When the resulting time shape is invalid.
 */
async function applyNativeBlockPatch(
  db: Database,
  existing: CalendarItemRow,
  patch: CalendarItemUpdate,
): Promise<CalendarItemRow> {
  const timePatch = resolveTimeShapePatch(existing, patch);

  const patchValues: Partial<typeof calendarItem.$inferInsert> = { ...timePatch };
  if (patch.title !== undefined) patchValues.title = patch.title;
  if (patch.description !== undefined) {
    patchValues.description = patch.description === '' ? null : patch.description;
  }
  if (patch.location !== undefined) {
    patchValues.location = patch.location === '' ? null : patch.location;
  }
  if (patch.timezone !== undefined) patchValues.timezone = patch.timezone;

  const updated = await db
    .update(calendarItem)
    .set(patchValues)
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
export async function updateCalendarItem(
  db: Database,
  input: { userId: string; itemId: string; patch: CalendarItemUpdate; syncModules?: SyncModules },
): Promise<CalendarItemRow> {
  const { userId, itemId, patch } = input;
  const loaded = await loadOwnedCalendarItem(db, userId, itemId);
  const kind = CalendarItemKind.parse(loaded.item.kind);

  if (kind === 'native_block') return applyNativeBlockPatch(db, loaded.item, patch);
  if (kind === 'task_timebox' || kind === 'availability_block') rejectDerivedKind(kind, 'edits');

  // kind === 'provider_event'
  const permissions = resolveItemPermissions(loaded);
  if (!permissions.canEditCore) throw problemForReadOnlyReason(permissions.readOnlyReason);

  const connection = loaded.connection;
  /* v8 ignore next -- @preserve defensive: canEditCore true for provider_event requires a connection */
  if (connection === null) throw new Error('provider_event item missing its connection');

  const timePatch = resolveTimeShapePatch(loaded.item, patch);
  const patchValues: Partial<typeof calendarItem.$inferInsert> = {
    ...timePatch,
    syncState: 'push_pending',
  };
  if (patch.title !== undefined) patchValues.title = patch.title;
  if (patch.description !== undefined) {
    patchValues.description = patch.description === '' ? null : patch.description;
  }
  if (patch.location !== undefined) {
    patchValues.location = patch.location === '' ? null : patch.location;
  }
  if (patch.timezone !== undefined) patchValues.timezone = patch.timezone;

  const updatedRows = await db
    .update(calendarItem)
    .set(patchValues)
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
      patch: toWritePatch(patch, timePatch),
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

  if (kind === 'native_block') return hardDeleteCalendarItem(db, loaded.item);
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
