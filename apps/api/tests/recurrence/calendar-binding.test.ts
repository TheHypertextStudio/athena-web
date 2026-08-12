/** Calendar-event bindings materialize the same reusable process for each provider occurrence. */
import { resolve } from 'node:path';

import {
  account,
  actor,
  calendarConnection,
  calendarItem,
  calendarLayer,
  calendarProcessBinding,
  fullSchema,
  organization,
  processOccurrence,
  recurrenceSeries,
  task,
  team,
  user,
  type Database,
} from '@docket/db';
import { ProcessDefinitionId, TeamId } from '@docket/types';
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  bindProcessToCalendarItem,
  materializeCalendarProcessBindings,
} from '../../src/lib/recurrence/calendar-binding';
import { createPublishedProcessDefinition } from '../../src/lib/recurrence/process-definition';

const MIGRATIONS = resolve(import.meta.dirname, '../../../../packages/db/drizzle');

let client!: PGlite;
let db!: Database;

describe('calendar process bindings', () => {
  beforeAll(async () => {
    client = new PGlite('memory://');
    const migrated = drizzle(client, { schema: fullSchema });
    await migrate(migrated, { migrationsFolder: MIGRATIONS });
    db = migrated;
  });

  afterAll(async () => {
    await client.close();
  });

  it('binds a provider series once and materializes each event occurrence exactly once', async () => {
    const [identity] = await db
      .insert(user)
      .values({ name: 'Meetup coordinator', email: 'calendar-binding@example.test' })
      .returning();
    const [workspace] = await db
      .insert(organization)
      .values({ name: 'Transit organizers', slug: 'calendar-binding-transit' })
      .returning();
    const [workTeam] = await db
      .insert(team)
      .values({ organizationId: workspace!.id, name: 'Events', key: 'EVENTS' })
      .returning();
    const [coordinator] = await db
      .insert(actor)
      .values({
        organizationId: workspace!.id,
        userId: identity!.id,
        kind: 'human',
        displayName: 'Meetup coordinator',
      })
      .returning();
    await db.insert(account).values({
      userId: identity!.id,
      providerId: 'google',
      accountId: 'calendar-binding-account',
    });
    const [connection] = await db
      .insert(calendarConnection)
      .values({
        userId: identity!.id,
        provider: 'google',
        externalAccountId: 'calendar-binding-account',
      })
      .returning();
    const [layer] = await db
      .insert(calendarLayer)
      .values({
        userId: identity!.id,
        connectionId: connection!.id,
        provider: 'google',
        sourceKind: 'provider',
        externalLayerId: 'primary',
        title: 'Community events',
        timezone: 'America/Los_Angeles',
      })
      .returning();
    const [firstEvent] = await db
      .insert(calendarItem)
      .values({
        userId: identity!.id,
        layerId: layer!.id,
        connectionId: connection!.id,
        kind: 'provider_event',
        provider: 'google',
        externalCalendarId: 'primary',
        externalEventId: 'meetup-august',
        recurringEventId: 'monthly-meetup-series',
        recurrenceInstanceKey: 'meetup-august',
        title: 'Las Vegans for Better Transit meetup',
        startsAt: new Date('2026-08-15T01:00:00.000Z'),
        endsAt: new Date('2026-08-15T03:00:00.000Z'),
        timezone: 'America/Los_Angeles',
      })
      .returning();
    const process = await createPublishedProcessDefinition(db, {
      organizationId: workspace!.id,
      actorId: coordinator!.id,
      definition: {
        name: 'Meetup event work',
        creationMode: 'all_at_once',
        milestones: [],
        tasks: [
          {
            key: 'announce',
            title: 'Make announcement for meetup',
            teamId: TeamId.parse(workTeam!.id),
            priority: 'none',
            labelIds: [],
            timing: { kind: 'relative_to_trigger', offsetDays: -7 },
          },
          {
            key: 'host',
            title: 'Host meetup',
            teamId: TeamId.parse(workTeam!.id),
            priority: 'none',
            labelIds: [],
            timing: { kind: 'on_trigger' },
          },
        ],
        dependencies: [],
      },
    });

    const command = {
      organizationId: workspace!.id,
      actorId: coordinator!.id,
      userId: identity!.id,
      calendarItemId: firstEvent!.id,
      processDefinitionId: ProcessDefinitionId.parse(process.definitionId),
    };
    const first = await bindProcessToCalendarItem(db, command);
    const retried = await bindProcessToCalendarItem(db, command);

    expect(retried).toEqual(first);
    expect(first).toMatchObject({
      scope: 'event_series',
      externalSeriesId: 'monthly-meetup-series',
      calendarItemId: firstEvent!.id,
      seriesName: 'Las Vegans for Better Transit meetup work',
    });
    expect(await db.select().from(calendarProcessBinding)).toHaveLength(1);
    expect(await db.select().from(recurrenceSeries)).toHaveLength(1);
    expect(await db.select().from(processOccurrence)).toHaveLength(1);

    const september = {
      calendarLayerId: layer!.id,
      externalSeriesId: 'monthly-meetup-series',
      externalOccurrenceKey: 'meetup-september',
      scheduledFor: '2026-09-11',
    };
    expect(await materializeCalendarProcessBindings(db, september)).toEqual({
      materialized: 1,
      errors: [],
    });
    expect(await materializeCalendarProcessBindings(db, september)).toEqual({
      materialized: 1,
      errors: [],
    });

    // A different provider event on the same civil date must remain a distinct process instance.
    expect(
      await materializeCalendarProcessBindings(db, {
        ...september,
        externalOccurrenceKey: 'meetup-september-special',
      }),
    ).toEqual({ materialized: 1, errors: [] });

    expect(await db.select().from(processOccurrence)).toHaveLength(3);
    expect(await db.select().from(task).where(eq(task.organizationId, workspace!.id))).toHaveLength(
      6,
    );
  });
});
