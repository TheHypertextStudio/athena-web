import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { searchExternalMentions } from '../../src/content/mention-external';
import { getDb, one, seedBaseOrg } from '../support/routes-harness';

let schema: typeof DbModule;
let db: typeof DbModule.db;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

/** Seed a connected integration owned by one actor. */
async function seedConnection(
  orgId: string,
  actorId: string,
  provider: 'drive' | 'github',
): Promise<string> {
  const row = one(
    await db
      .insert(schema.integration)
      .values({
        organizationId: orgId,
        createdBy: actorId,
        provider,
        pattern: 'connector',
        roles: ['context'],
        status: 'connected',
        connection: {},
      })
      .returning({ id: schema.integration.id }),
  );
  return row.id;
}

describe('searchExternalMentions', () => {
  it('returns nothing before anything is typed, so bare @ costs no provider call', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    await seedConnection(orgId, humanActorId, 'drive');

    const result = await searchExternalMentions({
      actorId: humanActorId,
      orgId,
      query: '   ',
      limit: 6,
    });
    expect(result).toEqual({ items: [], providers: [] });
  });

  it('searches a connected source that offers the capability', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    await seedConnection(orgId, humanActorId, 'drive');

    const result = await searchExternalMentions({
      actorId: humanActorId,
      orgId,
      query: 'launch',
      limit: 6,
    });

    expect(result.providers).toEqual([
      expect.objectContaining({ provider: 'google_drive', status: 'ok' }),
    ]);
    expect(result.items.map((item) => item.title)).toEqual(['Q3 launch plan', 'Launch budget']);
    expect(result.items[0]?.origin).toBe('external');
  });

  it('stays silent about a connected source that is not searchable', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    await seedConnection(orgId, humanActorId, 'github');

    const result = await searchExternalMentions({
      actorId: humanActorId,
      orgId,
      query: 'launch',
      limit: 6,
    });
    // Reporting every unsearchable connection would fill the menu footer with unactionable status.
    expect(result.providers).toEqual([]);
    expect(result.items).toEqual([]);
  });

  it('never fans out to a connection somebody else owns', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const colleague = one(
      await db
        .insert(schema.actor)
        .values({ organizationId: orgId, kind: 'human', displayName: 'Colleague' })
        .returning({ id: schema.actor.id }),
    );
    // The only connected source belongs to the colleague, funded by the colleague's credential.
    await seedConnection(orgId, colleague.id, 'drive');

    const result = await searchExternalMentions({
      actorId: humanActorId,
      orgId,
      query: 'launch',
      limit: 6,
    });
    expect(result.items).toEqual([]);
    expect(result.providers).toEqual([]);
  });

  it('respects the row limit the picker asks for', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    await seedConnection(orgId, humanActorId, 'drive');

    const result = await searchExternalMentions({
      actorId: humanActorId,
      orgId,
      query: 'launch',
      limit: 1,
    });
    expect(result.items).toHaveLength(1);
  });
});
