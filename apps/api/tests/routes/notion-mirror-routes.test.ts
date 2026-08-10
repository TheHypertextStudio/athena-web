/**
 * `@docket/api` — request-level coverage for the Notion mirror management surface.
 */
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import type { AppEnv } from '../../src/context';
import { notionMirrorApp } from '../../src/routes/notion-mirror';
import { appWithActor, getDb, one, seedBaseOrg } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

async function seedRouter() {
  const base = await seedBaseOrg(db, schema);
  const integration = one(
    await db
      .insert(schema.integration)
      .values({
        organizationId: base.orgId,
        provider: 'notion',
        pattern: 'connector',
        status: 'connected',
        createdBy: base.humanActorId,
      })
      .returning(),
  );
  const router = new Hono<AppEnv>().route('/:id', notionMirrorApp);
  const app = appWithActor(router, base.orgId, ['manage'], base.humanActorId);
  return { ...base, integration, app };
}

describe('Notion mirror routes', () => {
  it('lists, previews, updates, and scopes designed databases', async () => {
    const { orgId, integration, app } = await seedRouter();

    const listed = await app.request(`/${integration.id}/databases`);
    expect(listed.status).toBe(200);
    expect(((await listed.json()) as { items: unknown[] }).items).toHaveLength(9);

    const design = await app.request(`/${integration.id}/design/task`);
    expect(design.status).toBe(200);
    expect((await design.json()) as object).toMatchObject({
      database: { entityType: 'task' },
      sample: true,
    });

    const updated = await app.request(`/${integration.id}/design/task`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Delivery work',
        columns: [{ field: 'title', title: 'Work' }],
      }),
    });
    expect(updated.status).toBe(200);
    expect((await updated.json()) as object).toMatchObject({
      database: { title: 'Delivery work' },
    });

    const parents = await app.request(`/${integration.id}/parent-pages`);
    expect(parents.status).toBe(200);
    expect(((await parents.json()) as { items: unknown[] }).items.length).toBeGreaterThan(0);

    const unmatched = await app.request(`/${integration.id}/unmatched-people`);
    expect(unmatched.status).toBe(200);
    expect(await unmatched.json()).toEqual({ docketOnly: 1 });

    const foreign = await seedBaseOrg(db, schema);
    const foreignIntegration = one(
      await db
        .insert(schema.integration)
        .values({ organizationId: foreign.orgId, provider: 'notion', pattern: 'connector' })
        .returning(),
    );
    expect((await app.request(`/${foreignIntegration.id}/databases`)).status).toBe(404);
    expect((await app.request('/missing-integration/databases')).status).toBe(404);

    const notNotion = one(
      await db
        .insert(schema.integration)
        .values({ organizationId: orgId, provider: 'github', pattern: 'connector' })
        .returning(),
    );
    expect((await app.request(`/${notNotion.id}/databases`)).status).toBe(404);
  });

  it('makes every Notion person resolution explicit and durable', async () => {
    const { orgId, humanActorId, integration, app } = await seedRouter();
    await db.insert(schema.externalActor).values([
      {
        organizationId: orgId,
        integrationId: integration.id,
        externalId: 'notion-match',
        displayName: 'Match Me',
        email: 'match@example.com',
      },
      {
        organizationId: orgId,
        integrationId: integration.id,
        externalId: 'notion-create',
        displayName: 'Create Me',
      },
      {
        organizationId: orgId,
        integrationId: integration.id,
        externalId: 'notion-skip',
        displayName: 'Skip Me',
      },
    ]);

    const people = await app.request(`/${integration.id}/people`);
    expect(people.status).toBe(200);
    expect(((await people.json()) as { items: unknown[] }).items).toHaveLength(3);

    const resolve = (externalId: string, body: object) =>
      app.request(`/${integration.id}/people/${externalId}/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

    expect((await resolve('notion-match', { action: 'match_existing' })).status).toBe(409);
    expect(
      (
        await resolve('notion-match', {
          action: 'match_existing',
          actorId: 'actor-from-another-workspace',
        })
      ).status,
    ).toBe(404);

    const matched = await resolve('notion-match', {
      action: 'match_existing',
      actorId: humanActorId,
    });
    expect(matched.status).toBe(200);
    expect(await matched.json()).toMatchObject({ actorId: humanActorId, matchedBy: 'manual' });

    const created = await resolve('notion-create', { action: 'create_actor' });
    expect(created.status).toBe(200);
    expect(await created.json()).toMatchObject({
      actorId: expect.any(String),
      matchedBy: 'manual',
    });

    const skipped = await resolve('notion-skip', { action: 'skip' });
    expect(skipped.status).toBe(200);
    expect(await skipped.json()).toMatchObject({ actorId: null, matchedBy: null });
    expect((await resolve('missing-person', { action: 'skip' })).status).toBe(404);

    const count = await app.request(`/${integration.id}/unmatched-people`);
    expect(count.status).toBe(200);
    expect((await count.json()) as { docketOnly: number }).toMatchObject({ docketOnly: 0 });
  });

  it('provisions through the leased sync spine and reports a held lease as conflict', async () => {
    const { integration, app } = await seedRouter();
    await app.request(`/${integration.id}/databases`);
    await db
      .update(schema.notionMirrorDatabase)
      .set({ enabled: false })
      .where(eq(schema.notionMirrorDatabase.integrationId, integration.id));
    await db
      .update(schema.notionMirrorDatabase)
      .set({ enabled: true })
      .where(
        and(
          eq(schema.notionMirrorDatabase.integrationId, integration.id),
          eq(schema.notionMirrorDatabase.entityType, 'label'),
        ),
      );

    const provision = () =>
      app.request(`/${integration.id}/provision`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ containerPageId: 'mock_page_workspace' }),
      });

    const started = await provision();
    expect(started.status).toBe(200);
    expect(await started.json()).toMatchObject({ status: 'succeeded', purpose: 'notion_mirror' });

    await db
      .update(schema.integration)
      .set({ syncStartedAt: new Date('2030-01-01T00:00:00.000Z') })
      .where(eq(schema.integration.id, integration.id));
    expect((await provision()).status).toBe(409);
  });
});
