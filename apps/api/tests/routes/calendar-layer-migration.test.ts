import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { getDb, one, seedBaseOrg, seedUserWithHub } from '../support/routes-harness';

/**
 * The exact backfill INSERT statements appended to `drizzle/0023_conscious_hulk.sql`.
 * Migrations run once at `getDb()` time (before any fixture rows exist), so re-reading
 * the migration file's SQL here would be a no-op smoke test. Instead we inline the same
 * two statements and run them directly against seeded `calendar_list`/`calendar_event`
 * rows to prove the backfill is (a) correct and (b) idempotent.
 */
const BACKFILL_LAYERS_FROM_CALENDAR_LIST = sql`
  INSERT INTO "calendar_layer" (
    "id", "user_id", "connection_id", "provider", "source_kind", "external_layer_id",
    "title", "description", "timezone", "color", "access_role", "primary", "selected",
    "visible_by_default", "editable_core", "sync_token", "watch_channel_id",
    "watch_resource_id", "watch_token", "watch_expires_at", "last_synced_at", "last_error",
    "created_at", "updated_at"
  )
  SELECT
    "id", "user_id", "connection_id", 'google', 'provider_calendar', "external_calendar_id",
    "title", "description", "timezone", "color", "access_role", "primary", "selected",
    "visible_by_default", false, "sync_token", "watch_channel_id", "watch_resource_id",
    "watch_token", "watch_expires_at", "last_synced_at", "last_error", "created_at",
    "updated_at"
  FROM "calendar_list"
  ON CONFLICT ("id") DO NOTHING
`;

const BACKFILL_ITEMS_FROM_CALENDAR_EVENT = sql`
  INSERT INTO "calendar_item" (
    "id", "user_id", "layer_id", "connection_id", "kind", "provider",
    "external_calendar_id", "external_event_id", "recurring_event_id", "status", "title",
    "description", "location", "html_link", "starts_at", "ends_at", "all_day_start_date",
    "all_day_end_date", "organizer", "attendees", "updated_external_at", "external_etag",
    "sync_state", "archived_at", "created_at", "updated_at"
  )
  SELECT
    "id", "user_id", "calendar_id", "connection_id", 'provider_event', 'google',
    "external_calendar_id", "external_event_id", "recurring_event_id", "status", "title",
    "description", "location", "html_link", "starts_at", "ends_at", "all_day_start_date",
    "all_day_end_date", "organizer", "attendees", "updated_external_at", "etag",
    'clean', "archived_at", "created_at", "updated_at"
  FROM "calendar_event"
  ON CONFLICT ("id") DO NOTHING
`;

describe('layered-calendar migration (0016)', () => {
  it('inserts and reads back a calendarConnection + calendarLayer + calendarItem', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'LayerUser');

    const connection = one(
      await schema.db
        .insert(schema.calendarConnection)
        .values({
          userId,
          provider: 'google',
          externalAccountId: 'google-sub-layer',
          status: 'connected',
          scopeState: {
            grantedScopes: ['https://www.googleapis.com/auth/calendar'],
            calendarRead: true,
            calendarWrite: true,
            capturedAt: '2026-06-30T00:00:00.000Z',
          },
        })
        .returning(),
    );
    expect(connection.scopeState?.calendarWrite).toBe(true);

    const layer = one(
      await schema.db
        .insert(schema.calendarLayer)
        .values({
          userId,
          connectionId: connection.id,
          provider: 'google',
          sourceKind: 'provider_calendar',
          externalLayerId: 'primary',
          title: 'Primary',
        })
        .returning(),
    );
    expect(layer.editableCore).toBe(false);
    expect(layer.selected).toBe(true);

    const item = one(
      await schema.db
        .insert(schema.calendarItem)
        .values({
          userId,
          layerId: layer.id,
          connectionId: connection.id,
          kind: 'provider_event',
          provider: 'google',
          externalEventId: 'event-abc',
          title: 'Design review',
          startsAt: new Date('2026-06-30T16:00:00.000Z'),
          endsAt: new Date('2026-06-30T17:00:00.000Z'),
          permissions: { canEditCore: false, canDelete: false, readOnlyReason: 'provider_scope' },
        })
        .returning(),
    );
    expect(item.syncState).toBe('clean');
    expect(item.permissions?.readOnlyReason).toBe('provider_scope');

    const [reread] = await schema.db
      .select()
      .from(schema.calendarItem)
      .where(eq(schema.calendarItem.id, item.id));
    expect(reread?.layerId).toBe(layer.id);
  });

  it('reuses task-link ids/roles when linking a calendar item to a task', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'LinkUser');
    const base = await seedBaseOrg(schema.db, schema);
    await schema.db
      .update(schema.actor)
      .set({ userId })
      .where(eq(schema.actor.id, base.humanActorId));
    const taskRow = one(
      await schema.db
        .insert(schema.task)
        .values({
          organizationId: base.orgId,
          teamId: base.teamId,
          title: 'Prep slides',
          state: 'todo',
        })
        .returning({ id: schema.task.id }),
    );

    const layer = one(
      await schema.db
        .insert(schema.calendarLayer)
        .values({ userId, sourceKind: 'native_blocks', title: 'My Blocks', editableCore: true })
        .returning({ id: schema.calendarLayer.id }),
    );
    const item = one(
      await schema.db
        .insert(schema.calendarItem)
        .values({
          userId,
          layerId: layer.id,
          kind: 'native_block',
          title: 'Focus block',
          startsAt: new Date('2026-06-30T16:00:00.000Z'),
          endsAt: new Date('2026-06-30T17:00:00.000Z'),
        })
        .returning({ id: schema.calendarItem.id }),
    );

    const link = one(
      await schema.db
        .insert(schema.calendarItemTaskLink)
        .values({
          calendarItemId: item.id,
          taskId: taskRow.id,
          organizationId: base.orgId,
          createdBy: base.humanActorId,
          role: 'agenda',
        })
        .returning(),
    );
    expect(link.role).toBe('agenda');
    expect(link.sort).toBe(0);
  });

  it('backfills calendar_layer/calendar_item from calendar_list/calendar_event, reusing ids, idempotently', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'BackfillUser');

    const connection = one(
      await schema.db
        .insert(schema.calendarConnection)
        .values({ userId, externalAccountId: 'google-sub-backfill', status: 'connected' })
        .returning({ id: schema.calendarConnection.id }),
    );
    const legacyCalendar = one(
      await schema.db
        .insert(schema.calendarList)
        .values({
          userId,
          connectionId: connection.id,
          externalCalendarId: 'primary',
          title: 'Ada (legacy)',
          selected: true,
          visibleByDefault: true,
        })
        .returning({ id: schema.calendarList.id }),
    );
    const legacyEvent = one(
      await schema.db
        .insert(schema.calendarEvent)
        .values({
          userId,
          connectionId: connection.id,
          calendarId: legacyCalendar.id,
          externalCalendarId: 'primary',
          externalEventId: 'legacy-event-1',
          status: 'confirmed',
          title: 'Legacy design review',
          startsAt: new Date('2026-06-30T16:00:00.000Z'),
          endsAt: new Date('2026-06-30T17:00:00.000Z'),
        })
        .returning({ id: schema.calendarEvent.id }),
    );

    // Run the backfill twice — it must be idempotent (ON CONFLICT DO NOTHING on reused ids).
    await schema.db.execute(BACKFILL_LAYERS_FROM_CALENDAR_LIST);
    await schema.db.execute(BACKFILL_ITEMS_FROM_CALENDAR_EVENT);
    await schema.db.execute(BACKFILL_LAYERS_FROM_CALENDAR_LIST);
    await schema.db.execute(BACKFILL_ITEMS_FROM_CALENDAR_EVENT);

    const layers = await schema.db
      .select()
      .from(schema.calendarLayer)
      .where(eq(schema.calendarLayer.id, legacyCalendar.id));
    expect(layers).toHaveLength(1);
    expect(layers[0]?.sourceKind).toBe('provider_calendar');
    expect(layers[0]?.provider).toBe('google');
    expect(layers[0]?.externalLayerId).toBe('primary');

    const items = await schema.db
      .select()
      .from(schema.calendarItem)
      .where(eq(schema.calendarItem.id, legacyEvent.id));
    expect(items).toHaveLength(1);
    expect(items[0]?.layerId).toBe(legacyCalendar.id);
    expect(items[0]?.kind).toBe('provider_event');
    expect(items[0]?.syncState).toBe('clean');
    expect(items[0]?.title).toBe('Legacy design review');
  });
});
