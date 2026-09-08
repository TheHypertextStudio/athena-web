import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { describe, expect, it } from 'vitest';

import { fullSchema } from '../../src/client';
import { account, calendarConnection, calendarItem, calendarLayer, user } from '../../src/schema';

const migration = readFileSync(
  resolve(import.meta.dirname, '../../drizzle/0128_bitter_cloak.sql'),
  'utf8',
);
const executableSql = migration.replace(/^--.*$/gm, '');

describe('canonical calendar source migration', () => {
  it('backfills exact provider source identities without title matching', () => {
    expect(migration).toContain('UPDATE "calendar_layer"');
    expect(migration).toContain('"source_identity_namespace"');
    expect(migration).toContain('"external_layer_id"');
    expect(executableSql).not.toMatch(/title[^;]*(?:identity|group)/i);
  });

  it('backfills iCalendar event and recurring occurrence identities from provider payloads', () => {
    expect(migration).toContain("'iCalUID'");
    expect(migration).toContain("'originalStartTime'");
    expect(migration).toContain("'dateTime'");
    expect(migration).toContain("'date'");
  });

  it('keeps source cleanup non-destructive', () => {
    expect(migration).toContain('"removed_at" timestamp');
    expect(executableSql).not.toMatch(/DELETE\s+FROM\s+"calendar_(?:list|layer|item)"/i);
  });

  it('maps existing Google rows to exact source and recurring occurrence identities', async () => {
    const client = new PGlite('memory://');
    try {
      const db = drizzle(client, { schema: fullSchema });
      await migrate(db, { migrationsFolder: resolve(import.meta.dirname, '../../drizzle') });
      const [owner] = await db
        .insert(user)
        .values({ name: 'Ada', email: 'calendar-migration@example.com' })
        .returning();
      if (!owner) throw new Error('Expected user insertion to return a row');
      await db
        .insert(account)
        .values({ userId: owner.id, providerId: 'google', accountId: 'google-account' });
      const [connection] = await db
        .insert(calendarConnection)
        .values({
          userId: owner.id,
          provider: 'google',
          externalAccountId: 'google-account',
        })
        .returning();
      if (!connection) throw new Error('Expected connection insertion to return a row');
      const [layer] = await db
        .insert(calendarLayer)
        .values({
          userId: owner.id,
          connectionId: connection.id,
          provider: 'google',
          sourceKind: 'provider_calendar',
          externalLayerId: 'personal@example.com',
          title: 'Personal',
          accessRole: 'reader',
        })
        .returning();
      if (!layer) throw new Error('Expected layer insertion to return a row');
      const [item] = await db
        .insert(calendarItem)
        .values({
          userId: owner.id,
          layerId: layer.id,
          connectionId: connection.id,
          kind: 'provider_event',
          provider: 'google',
          externalCalendarId: 'personal@example.com',
          externalEventId: 'copy-specific-id',
          recurringEventId: 'series-id',
          title: 'Planning',
          startsAt: new Date('2026-09-05T16:00:00.000Z'),
          endsAt: new Date('2026-09-05T17:00:00.000Z'),
          providerRaw: {
            iCalUID: 'series@example.com',
            originalStartTime: { dateTime: '2026-09-05T09:00:00-07:00' },
          },
        })
        .returning();
      if (!item) throw new Error('Expected item insertion to return a row');

      const backfill = migration
        .slice(migration.indexOf('-- Existing provider layers'))
        .replaceAll('--> statement-breakpoint', '');
      await client.exec(backfill);

      const [migratedLayer] = await db
        .select()
        .from(calendarLayer)
        .where(eq(calendarLayer.id, layer.id));
      const [migratedItem] = await db
        .select()
        .from(calendarItem)
        .where(eq(calendarItem.id, item.id));
      expect(migratedLayer).toMatchObject({
        sourceIdentityNamespace: 'google-calendar',
        sourceIdentityValue: 'personal@example.com',
        sourceRelationship: 'subscribed',
      });
      expect(migratedItem).toMatchObject({
        eventIdentityNamespace: 'ical',
        eventIdentityValue: 'series@example.com',
        occurrenceIdentity: '2026-09-05T09:00:00-07:00',
      });
    } finally {
      await client.close();
    }
  });
});
