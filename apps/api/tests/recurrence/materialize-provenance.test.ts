/** The change sets a repeating series records for the work it creates. */
import {
  actor,
  changeSet,
  changeSetEntry,
  fullSchema,
  organization,
  seedWorkspaceStatuses,
  team,
  type Database,
} from '@docket/db';
import { assertDefined } from '@docket/test-utils';
import { TeamId } from '@docket/identity-access/ids';
import { ProcessDefinitionId } from '@docket/work/ids';
import type { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ProcessDefinitionCreate } from '../../src/contracts/recurrence';
import { currentProvenance } from '../../src/lib/provenance/context';
import { createPublishedProcessDefinition } from '../../src/lib/recurrence/process-definition';
import { createRecurrenceSeries } from '../../src/lib/recurrence/series';
import { materializeRecurrenceSeriesWindow } from '../../src/lib/recurrence/sweep';
import { installTestProductFixture } from '../support/db';
import { openMigratedPglite } from '../support/pglite-template';

let client!: PGlite;
let db!: Database;
let organizationId!: string;
let teamId!: ReturnType<typeof TeamId.parse>;
let ownerActorId!: string;

beforeAll(async () => {
  client = await openMigratedPglite();
  db = drizzle(client, { schema: fullSchema });
  await installTestProductFixture(db);
  const [org] = await db
    .insert(organization)
    .values({ name: 'Series provenance', slug: `series-provenance-${Date.now()}` })
    .returning();
  organizationId = assertDefined(org).id;
  await seedWorkspaceStatuses(db, organizationId);
  const [row] = await db
    .insert(team)
    .values({ organizationId, name: 'Ops', key: 'OPS' })
    .returning();
  teamId = TeamId.parse(assertDefined(row).id);
  const [owner] = await db
    .insert(actor)
    .values({ organizationId, kind: 'human', displayName: 'Series owner' })
    .returning();
  ownerActorId = assertDefined(owner).id;
});

afterAll(async () => {
  await client.close();
});

/** A daily one-task series, credited to `actorId` when one is given. */
async function dailySeries(name: string, actorId?: string): Promise<{ id: string }> {
  const definition: ProcessDefinitionCreate = {
    name,
    creationMode: 'all_at_once',
    milestones: [],
    tasks: [
      {
        key: 'task',
        title: name,
        teamId,
        priority: 'none',
        labelIds: [],
        timing: { kind: 'on_trigger' },
      },
    ],
    dependencies: [],
  };
  const process = await createPublishedProcessDefinition(db, { organizationId, definition });
  return createRecurrenceSeries(db, {
    organizationId,
    ...(actorId ? { actorId } : {}),
    series: {
      processDefinitionId: ProcessDefinitionId.parse(process.definitionId),
      name,
      trigger: {
        kind: 'calendar',
        schedule: {
          kind: 'daily',
          interval: 1,
          startDate: '2026-08-01',
          timezone: 'America/Los_Angeles',
          end: { kind: 'after_count', count: 3 },
        },
        missedPolicy: 'skip',
        materialization: { horizonDays: 2, minimumOccurrences: 1 },
      },
    },
  });
}

/** Every recorded change set that created something in this workspace. */
async function createdChangeSets() {
  return db
    .select({
      actorId: changeSet.actorId,
      origin: changeSet.origin,
      kind: changeSetEntry.entityKind,
    })
    .from(changeSet)
    .innerJoin(changeSetEntry, eq(changeSetEntry.changeSetId, changeSet.id))
    .where(eq(changeSet.organizationId, organizationId));
}

describe('a repeating series records the work it creates', () => {
  it('records scheduled work as the series’ doing, credited to the series owner', async () => {
    const series = await dailySeries('Daily standup notes', ownerActorId);
    expect(currentProvenance()).toBeNull();

    // The scheduled sweep runs with no request and no actor: the series is the entry point.
    const result = await materializeRecurrenceSeriesWindow(db, {
      organizationId,
      seriesId: series.id,
      asOf: '2026-08-01',
      now: new Date('2026-08-01T12:00:00.000Z'),
    });

    expect(result.materialized).toBeGreaterThan(0);
    const recorded = await createdChangeSets();
    expect(recorded.length).toBeGreaterThan(0);
    for (const entry of recorded) {
      expect(entry).toMatchObject({
        actorId: ownerActorId,
        kind: 'task',
        origin: {
          v: 2,
          channel: 'rule',
          surface: 'recurrence',
          performer: { kind: 'docket' },
          ref: { seriesId: series.id },
          tool: 'recurrence_materialize',
        },
      });
    }
  });

  it('records nothing for a series no member created, since no one authorized the work', async () => {
    const before = (await createdChangeSets()).length;
    const series = await dailySeries('Unowned series');

    const result = await materializeRecurrenceSeriesWindow(db, {
      organizationId,
      seriesId: series.id,
      asOf: '2026-08-01',
      now: new Date('2026-08-01T12:00:00.000Z'),
    });

    expect(result.materialized).toBeGreaterThan(0);
    expect(await createdChangeSets()).toHaveLength(before);
  });
});
