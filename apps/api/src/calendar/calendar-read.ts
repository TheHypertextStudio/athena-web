/**
 * `@docket/api` — the provider-agnostic calendar read service.
 *
 * @remarks
 * Reads over `calendar_layer`/`calendar_item` (the tables that supersede
 * `calendar_list`/`calendar_event` for rendering, per `packages/db/src/schema/calendar.ts`).
 * Every export here takes `db` explicitly so tests can point it at an isolated harness
 * connection; callers pass the shared `@docket/db` client.
 */
import {
  actor,
  calendarConnection,
  calendarItem,
  calendarItemTaskLink,
  calendarLayer,
  type Database,
  task,
  team,
} from '@docket/db';
import {
  CalendarItemTaskRole,
  type CalendarItemKind,
  type CalendarItemLinkedTaskOut,
  type CalendarItemOut,
  type CalendarLayerOut,
} from '@docket/types';
import { and, asc, eq, gt, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import type { z } from 'zod';

import { NotFoundError } from '../error';
import { buildTaskViewFilter, type ViewableTaskParts } from '../routes/task-helpers';

import {
  type CalendarConnectionRow,
  type CalendarLayerRow,
  resolveItemPermissions,
} from './calendar-permissions';
import { toCalendarItemOut, toCalendarLayerOut } from './calendar-serializers';

type CalendarItemRow = typeof calendarItem.$inferSelect;

/**
 * Hydrate the linked-task summaries for a set of calendar items, filtered per viewer.
 *
 * @remarks
 * A link is included only when the viewer has an actor row in the link's organization
 * (membership) AND that actor can view the linked task under this codebase's visibility
 * cascade ({@link buildTaskViewFilter}, mirroring `canActor('view', …)`). Task visibility
 * here is grant-based (a task defaults to org-wide `public`, so plain membership already
 * covers the common case), not a separate per-item privacy model — this hydration reuses
 * the same cascade the rest of the API uses rather than inventing a new one.
 *
 * @param db - The database client.
 * @param userId - The viewer's Docket user id.
 * @param itemIds - The calendar item ids to hydrate links for.
 * @returns a map from calendar item id to its visible linked-task summaries, sorted by
 *   `sort`. Items with no visible links are simply absent from the map.
 */
async function hydrateLinkedTasks(
  db: Database,
  userId: string,
  itemIds: readonly string[],
): Promise<Map<string, z.input<typeof CalendarItemLinkedTaskOut>[]>> {
  const result = new Map<string, z.input<typeof CalendarItemLinkedTaskOut>[]>();
  if (itemIds.length === 0) return result;

  const linkRows = await db
    .select({ link: calendarItemTaskLink, task })
    .from(calendarItemTaskLink)
    .innerJoin(task, eq(task.id, calendarItemTaskLink.taskId))
    .where(inArray(calendarItemTaskLink.calendarItemId, [...itemIds]));
  if (linkRows.length === 0) return result;

  const orgIds = [...new Set(linkRows.map((row) => row.link.organizationId))];
  const actorRows = await db
    .select({ id: actor.id, organizationId: actor.organizationId, roleId: actor.roleId })
    .from(actor)
    .where(and(eq(actor.userId, userId), inArray(actor.organizationId, orgIds)));
  const actorByOrg = new Map(actorRows.map((row) => [row.organizationId, row]));

  const teamIds = [...new Set(linkRows.map((row) => row.task.teamId))];
  const teamRows =
    teamIds.length > 0 ? await db.select().from(team).where(inArray(team.id, teamIds)) : [];
  const teamById = new Map(teamRows.map((row) => [row.id, row]));

  // Build a view predicate per org the links touch; orgs the viewer has no actor in get
  // no predicate at all, which the loop below treats as "exclude every link in that org".
  const viewFilterByOrg = new Map<string, (t: ViewableTaskParts) => boolean>();
  for (const orgId of orgIds) {
    const viewerActor = actorByOrg.get(orgId);
    if (viewerActor === undefined) continue;
    viewFilterByOrg.set(
      orgId,
      await buildTaskViewFilter(orgId, viewerActor.id, viewerActor.roleId),
    );
  }

  for (const row of linkRows) {
    const canViewInOrg = viewFilterByOrg.get(row.link.organizationId);
    if (canViewInOrg === undefined) continue;
    if (!canViewInOrg(row.task)) continue;

    const teamRow = teamById.get(row.task.teamId);
    const stateEntry = teamRow?.workflowStates.find((s) => s.key === row.task.state);
    const done =
      stateEntry !== undefined &&
      (stateEntry.type === 'completed' || stateEntry.type === 'canceled');

    const out: z.input<typeof CalendarItemLinkedTaskOut> = {
      taskId: row.task.id,
      organizationId: row.link.organizationId,
      role: CalendarItemTaskRole.parse(row.link.role),
      sort: row.link.sort,
      note: row.link.note,
      title: row.task.title,
      state: row.task.state,
      done,
    };

    const existing = result.get(row.link.calendarItemId);
    if (existing === undefined) {
      result.set(row.link.calendarItemId, [out]);
    } else {
      existing.push(out);
    }
  }

  for (const list of result.values()) {
    list.sort((a, b) => a.sort - b.sort);
  }
  return result;
}

/**
 * Read every calendar item overlapping `[start, end)` across the viewer's selected
 * layers, plus the layers that selection touches.
 *
 * @remarks
 * Range semantics match Google's own all-day convention: timed items overlap when
 * `startsAt < end AND endsAt > start`; all-day items overlap when
 * `allDayStartDate < end::date AND allDayEndDate > start::date` (the end date is
 * exclusive). A layer's items are excluded entirely once the layer is deselected —
 * deselecting a layer is a full opt-out of range reads, not just a display hint.
 *
 * @param db - The database client.
 * @param input.userId - The viewer's Docket user id.
 * @param input.start - Range start (inclusive).
 * @param input.end - Range end (exclusive).
 * @param input.layerIds - Restrict to these layer ids; omitted returns every selected layer.
 * @param input.kinds - Restrict to these item kinds; omitted returns every kind.
 */
export async function readCalendarItemsInRange(
  db: Database,
  input: {
    userId: string;
    start: Date;
    end: Date;
    layerIds?: readonly string[];
    kinds?: readonly CalendarItemKind[];
  },
): Promise<{
  layers: z.input<typeof CalendarLayerOut>[];
  items: z.input<typeof CalendarItemOut>[];
}> {
  const layerFilters = [eq(calendarLayer.userId, input.userId), eq(calendarLayer.selected, true)];
  if (input.layerIds !== undefined && input.layerIds.length > 0) {
    layerFilters.push(inArray(calendarLayer.id, [...input.layerIds]));
  }
  const layerRows = await db
    .select()
    .from(calendarLayer)
    .where(and(...layerFilters))
    .orderBy(asc(calendarLayer.title));

  const itemFilters = [eq(calendarItem.userId, input.userId), eq(calendarLayer.selected, true)];
  if (input.layerIds !== undefined && input.layerIds.length > 0) {
    itemFilters.push(inArray(calendarItem.layerId, [...input.layerIds]));
  }
  if (input.kinds !== undefined && input.kinds.length > 0) {
    itemFilters.push(inArray(calendarItem.kind, [...input.kinds]));
  }
  itemFilters.push(isNull(calendarItem.archivedAt));

  const rangeCondition = or(
    and(
      isNotNull(calendarItem.startsAt),
      isNotNull(calendarItem.endsAt),
      lt(calendarItem.startsAt, input.end),
      gt(calendarItem.endsAt, input.start),
    ),
    and(
      isNotNull(calendarItem.allDayStartDate),
      isNotNull(calendarItem.allDayEndDate),
      sql`${calendarItem.allDayStartDate} < ${input.end}::date`,
      sql`${calendarItem.allDayEndDate} > ${input.start}::date`,
    ),
  );

  const itemRows = await db
    .select({ item: calendarItem, layer: calendarLayer, connection: calendarConnection })
    .from(calendarItem)
    .innerJoin(calendarLayer, eq(calendarLayer.id, calendarItem.layerId))
    .leftJoin(calendarConnection, eq(calendarConnection.id, calendarItem.connectionId))
    .where(and(...itemFilters, rangeCondition));

  const linkedTasksByItem = await hydrateLinkedTasks(
    db,
    input.userId,
    itemRows.map((row) => row.item.id),
  );

  const items = itemRows.map((row) => serializeItemRow(row, linkedTasksByItem));

  return { layers: layerRows.map(toCalendarLayerOut), items };
}

/** Read every calendar layer for a user (selected or not) — settings need the full list. */
export async function readCalendarLayers(
  db: Database,
  userId: string,
): Promise<z.input<typeof CalendarLayerOut>[]> {
  const rows = await db
    .select()
    .from(calendarLayer)
    .where(eq(calendarLayer.userId, userId))
    .orderBy(asc(calendarLayer.title));
  return rows.map(toCalendarLayerOut);
}

/**
 * Load one active calendar item (with its owning layer and, when provider-bound, its
 * connection) owned by `userId` — the shared ownership+join query the write service
 * (`calendar-write.ts`) and the outbox (`calendar-outbox.ts`) both need before they can
 * resolve {@link resolveItemPermissions} or dispatch a provider push. The ONE
 * implementation of this join, per this task's binding rules.
 *
 * @throws {NotFoundError} When the item does not exist, is archived, or is not owned by `userId`.
 */
export async function loadOwnedCalendarItem(
  db: Database,
  userId: string,
  itemId: string,
): Promise<{
  item: CalendarItemRow;
  layer: CalendarLayerRow;
  connection: CalendarConnectionRow | null;
}> {
  const rows = await db
    .select({ item: calendarItem, layer: calendarLayer, connection: calendarConnection })
    .from(calendarItem)
    .innerJoin(calendarLayer, eq(calendarLayer.id, calendarItem.layerId))
    .leftJoin(calendarConnection, eq(calendarConnection.id, calendarItem.connectionId))
    .where(
      and(
        eq(calendarItem.id, itemId),
        eq(calendarItem.userId, userId),
        isNull(calendarItem.archivedAt),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (row === undefined) throw new NotFoundError('Calendar item not found');
  return row;
}

/**
 * Read a single calendar item with its resolved permissions and viewer-filtered linked
 * tasks, or `null` when it does not exist (or is archived, or belongs to another user).
 *
 * @remarks
 * Unlike {@link readCalendarItemsInRange}, this does not require the item's layer to be
 * currently selected — a deep link into a deselected layer should still resolve.
 */
export async function readItemDetail(
  db: Database,
  input: { userId: string; itemId: string },
): Promise<z.input<typeof CalendarItemOut> | null> {
  const rows = await db
    .select({ item: calendarItem, layer: calendarLayer, connection: calendarConnection })
    .from(calendarItem)
    .innerJoin(calendarLayer, eq(calendarLayer.id, calendarItem.layerId))
    .leftJoin(calendarConnection, eq(calendarConnection.id, calendarItem.connectionId))
    .where(
      and(
        eq(calendarItem.id, input.itemId),
        eq(calendarItem.userId, input.userId),
        isNull(calendarItem.archivedAt),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (row === undefined) return null;

  const linkedTasksByItem = await hydrateLinkedTasks(db, input.userId, [row.item.id]);
  return serializeItemRow(row, linkedTasksByItem);
}

/** Shared item-row -> `CalendarItemOut` mapping: resolve permissions, then serialize. */
function serializeItemRow(
  row: {
    item: CalendarItemRow;
    layer: typeof calendarLayer.$inferSelect;
    connection: typeof calendarConnection.$inferSelect | null;
  },
  linkedTasksByItem: Map<string, z.input<typeof CalendarItemLinkedTaskOut>[]>,
): z.input<typeof CalendarItemOut> {
  const permissions = resolveItemPermissions({
    item: row.item,
    layer: row.layer,
    connection: row.connection,
  });
  const linkedTasks = linkedTasksByItem.get(row.item.id) ?? [];
  return toCalendarItemOut({ ...row.item, permissions }, { linkedTasks });
}
