/**
 * `@docket/api` — resolving a calendar update body into the columns and the outbox patch it writes.
 *
 * @remarks
 * Split out of `./calendar-write` because time-shape resolution is its own subject: a calendar item
 * is either timed or all-day, never both, and a patch that touches the other shape's fields is a
 * shape *switch* rather than a partial update. Stating those rules here keeps them out of the write
 * service, which is about ownership, permissions, and the provider outbox.
 */
import type { calendarItem } from '@docket/db';
import type {
  CalendarItemUpdate,
  CalendarItemWritePatch,
} from '@docket/planning/calendar-contract';

import { ValidationError } from '../error';

type CalendarItemRow = typeof calendarItem.$inferSelect;

/**
 * The subset of {@link CalendarItemUpdate} time fields, resolved to a patch.
 *
 * @remarks
 * A shape-switching patch sets the OLD shape's columns to `null` explicitly (not
 * `undefined` — Drizzle's `.set()` skips keys whose value is `undefined`, so clearing a
 * column requires the literal `null`). A same-shape patch omits the other shape's keys
 * entirely, since they are already `null` on a single-shape row.
 */
export interface TimeShapePatch {
  startsAt?: Date | null;
  endsAt?: Date | null;
  allDayStartDate?: string | null;
  allDayEndDate?: string | null;
}

/** Reject a timed range whose end does not fall after its start. */
function requireTimedOrder(startsAt: Date, endsAt: Date): void {
  if (endsAt > startsAt) return;
  throw new ValidationError([{ path: ['endsAt'], message: '`endsAt` must be after `startsAt`' }]);
}

/** Reject an all-day range whose exclusive end does not fall after its start. */
function requireAllDayOrder(allDayStartDate: string, allDayEndDate: string): void {
  if (allDayEndDate > allDayStartDate) return;
  throw new ValidationError([
    {
      path: ['allDayEndDate'],
      message: '`allDayEndDate` must be after `allDayStartDate` (exclusive end)',
    },
  ]);
}

/**
 * Resolve a patch that touches the timed fields.
 *
 * @param item - The row being patched.
 * @param patch - The validated update body.
 * @param currentlyTimed - Whether the row is currently a timed item.
 * @returns The resolved time columns.
 * @throws {ValidationError} When a shape switch is incomplete, or the range is out of order.
 */
function resolveTimedPatch(
  item: CalendarItemRow,
  patch: CalendarItemUpdate,
  currentlyTimed: boolean,
): TimeShapePatch {
  if (currentlyTimed) {
    const startsAt = patch.startsAt !== undefined ? new Date(patch.startsAt) : item.startsAt;
    const endsAt = patch.endsAt !== undefined ? new Date(patch.endsAt) : item.endsAt;
    /* v8 ignore next -- @preserve defensive: an item currently timed has both columns set */
    if (startsAt === null || endsAt === null) throw new Error('timed item missing bounds');
    requireTimedOrder(startsAt, endsAt);
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
  requireTimedOrder(startsAt, endsAt);
  return { startsAt, endsAt, allDayStartDate: null, allDayEndDate: null };
}

/**
 * Resolve a patch that touches the all-day fields.
 *
 * @param item - The row being patched.
 * @param patch - The validated update body.
 * @param currentlyTimed - Whether the row is currently a timed item.
 * @returns The resolved time columns.
 * @throws {ValidationError} When a shape switch is incomplete, or the range is out of order.
 */
function resolveAllDayPatch(
  item: CalendarItemRow,
  patch: CalendarItemUpdate,
  currentlyTimed: boolean,
): TimeShapePatch {
  if (!currentlyTimed) {
    // Same-shape merge, not a hidden fallback: an omitted field keeps the row's
    // current value (the patch never carries null for these).
    const allDayStartDate = patch.allDayStartDate ?? item.allDayStartDate;
    const allDayEndDate = patch.allDayEndDate ?? item.allDayEndDate;
    /* v8 ignore next -- @preserve defensive: an all-day item has both columns set */
    if (allDayStartDate === null || allDayEndDate === null) {
      throw new Error('all-day item missing bounds');
    }
    requireAllDayOrder(allDayStartDate, allDayEndDate);
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
  requireAllDayOrder(patch.allDayStartDate, patch.allDayEndDate);
  return {
    allDayStartDate: patch.allDayStartDate,
    allDayEndDate: patch.allDayEndDate,
    startsAt: null,
    endsAt: null,
  };
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
 *
 * @param item - The row being patched.
 * @param patch - The validated update body.
 * @returns The resolved time columns; empty when the patch touches no time field.
 * @throws {ValidationError} When the patch is ambiguous, incomplete, or out of order.
 */
export function resolveTimeShapePatch(
  item: CalendarItemRow,
  patch: CalendarItemUpdate,
): TimeShapePatch {
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
  if (timedFieldsPresent) return resolveTimedPatch(item, patch, currentlyTimed);
  if (allDayFieldsPresent) return resolveAllDayPatch(item, patch, currentlyTimed);
  return {};
}

/**
 * Carry the item's timezones into the outbox patch when either one was touched.
 *
 * @remarks
 * Providers read a timed event's bounds in the zone the same payload declares, so a patch that
 * changes only the zone has to restate both — otherwise the provider reinterprets the unchanged
 * instants in the new zone and silently moves the event.
 *
 * @param out - The outbox patch being built, mutated in place.
 * @param patch - The validated update body.
 * @param timePatch - The already-resolved time columns.
 * @param existing - The row being patched.
 */
function applyZonePatch(
  out: CalendarItemWritePatch,
  patch: CalendarItemUpdate,
  timePatch: TimeShapePatch,
  existing: CalendarItemRow,
): void {
  out.timezone = patch.timezone ?? existing.timezone ?? undefined;
  if (patch.endTimezone !== undefined) out.endTimezone = patch.endTimezone;
  else if (existing.endTimezone !== null) out.endTimezone = existing.endTimezone;

  if (timePatch.startsAt !== undefined || timePatch.endsAt !== undefined) return;
  if (existing.startsAt === null || existing.endsAt === null) return;
  out.startsAt = existing.startsAt.toISOString();
  out.endsAt = existing.endsAt.toISOString();
}

/**
 * Build the outbox-stored patch from a validated update body and its resolved time-shape fields.
 *
 * @param patch - The validated update body.
 * @param timePatch - The already-resolved time columns.
 * @param existing - The row being patched.
 * @returns The provider-neutral patch to enqueue.
 */
export function toWritePatch(
  patch: CalendarItemUpdate,
  timePatch: TimeShapePatch,
  existing: CalendarItemRow,
): CalendarItemWritePatch {
  const out: CalendarItemWritePatch = {};
  if (patch.title !== undefined) out.title = patch.title;
  if (patch.description !== undefined) out.description = patch.description;
  if (patch.location !== undefined) out.location = patch.location;
  if (timePatch.startsAt) out.startsAt = timePatch.startsAt.toISOString();
  if (timePatch.endsAt) out.endsAt = timePatch.endsAt.toISOString();
  if (timePatch.allDayStartDate) out.allDayStartDate = timePatch.allDayStartDate;
  if (timePatch.allDayEndDate) out.allDayEndDate = timePatch.allDayEndDate;
  if (patch.timezone !== undefined || patch.endTimezone !== undefined) {
    applyZonePatch(out, patch, timePatch, existing);
  }
  return out;
}
