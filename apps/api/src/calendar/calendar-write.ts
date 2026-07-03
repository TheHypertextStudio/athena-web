/**
 * `@docket/api` — Docket-native calendar-block write service.
 *
 * @remarks
 * Covers CRUD for `calendar_item` rows of kind `'native_block'` only (focus, travel,
 * do-not-schedule, holds — created directly in Docket, with no provider account).
 * `provider_event` writes (the provider write outbox) and task-link mutations are later
 * phases; this module never touches `calendar_item_write` and never sets `syncState` to
 * anything but `'clean'`.
 */
import { and, asc, eq } from 'drizzle-orm';

import { calendarItem, calendarLayer, type Database } from '@docket/db';
import type { CalendarItemCreate, CalendarItemUpdate } from '@docket/types';

import { NotFoundError, ValidationError } from '../error';

type CalendarItemRow = typeof calendarItem.$inferSelect;
type CalendarLayerRow = typeof calendarLayer.$inferSelect;

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

/** Load a native block owned by `userId`, or throw the appropriate typed error. */
async function requireOwnedNativeBlock(
  db: Database,
  userId: string,
  itemId: string,
): Promise<CalendarItemRow> {
  const rows = await db
    .select()
    .from(calendarItem)
    .where(and(eq(calendarItem.id, itemId), eq(calendarItem.userId, userId)))
    .limit(1);
  const row = rows[0];
  if (row === undefined) throw new NotFoundError('Calendar item not found');
  if (row.kind !== 'native_block') {
    throw new ValidationError([
      {
        path: ['id'],
        message:
          'This calendar item is not a Docket-native block; provider-event edits are not supported yet',
      },
    ]);
  }
  return row;
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
 * Patch a Docket-native calendar block's core fields.
 *
 * @remarks
 * Rejects `provider_event` (and any non-`native_block`) items explicitly — provider-event
 * patching arrives with the write outbox in a later phase. Empty-string `description`/
 * `location` clear the field to `NULL` per the DTO contract. See
 * {@link resolveTimeShapePatch} for the time-shape switching rules.
 *
 * @param db - The database client.
 * @param input.userId - The owning Docket user id.
 * @param input.itemId - The calendar item id to patch.
 * @param input.patch - The validated update body.
 * @throws {NotFoundError} When the item does not exist or is not owned by `userId`.
 * @throws {ValidationError} When the item is not a `native_block`, or the resulting time
 *   shape is invalid.
 */
export async function updateNativeBlock(
  db: Database,
  input: { userId: string; itemId: string; patch: CalendarItemUpdate },
): Promise<CalendarItemRow> {
  const { userId, itemId, patch } = input;
  const existing = await requireOwnedNativeBlock(db, userId, itemId);

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
    .where(and(eq(calendarItem.id, itemId), eq(calendarItem.userId, userId)))
    .returning();
  const row = updated[0];
  /* v8 ignore next -- @preserve defensive: existence was verified above */
  if (row === undefined) throw new NotFoundError('Calendar item not found');
  return row;
}

/**
 * Hard-delete a Docket-native calendar block.
 *
 * @remarks
 * Native blocks have no provider tombstone semantics (unlike `provider_event`, which will
 * eventually soft-archive to reconcile with the provider), so this is a real `DELETE`.
 * `calendar_item_task_link` rows referencing the item cascade via its FK
 * (`ON DELETE CASCADE`) — no explicit cleanup needed here.
 *
 * @param db - The database client.
 * @param input.userId - The owning Docket user id.
 * @param input.itemId - The calendar item id to delete.
 * @throws {NotFoundError} When the item does not exist or is not owned by `userId`.
 * @throws {ValidationError} When the item is not a `native_block`.
 * @returns the deleted row.
 */
export async function deleteNativeBlock(
  db: Database,
  input: { userId: string; itemId: string },
): Promise<CalendarItemRow> {
  const { userId, itemId } = input;
  await requireOwnedNativeBlock(db, userId, itemId);

  const deleted = await db
    .delete(calendarItem)
    .where(and(eq(calendarItem.id, itemId), eq(calendarItem.userId, userId)))
    .returning();
  const row = deleted[0];
  /* v8 ignore next -- @preserve defensive: existence was verified above */
  if (row === undefined) throw new NotFoundError('Calendar item not found');
  return row;
}
