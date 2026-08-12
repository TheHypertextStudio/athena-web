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

  it('searches parent pages at the provider rather than returning the workspace', async () => {
    // The route used to dump every page the integration could see, unsorted, on every settings
    // open. The narrowing has to reach Notion — a picker that filters locally has already paid to
    // download a workspace it will mostly throw away.
    const { integration, app } = await seedRouter();

    const all = await app.request(`/${integration.id}/parent-pages`);
    expect(all.status).toBe(200);
    const everything = (await all.json()) as { items: { title: string }[] };
    expect(everything.items.length).toBeGreaterThan(1);

    const narrowed = await app.request(`/${integration.id}/parent-pages?q=proj`);
    expect(narrowed.status).toBe(200);
    const matched = (await narrowed.json()) as { items: { title: string }[] };
    expect(matched.items.length).toBeLessThan(everything.items.length);
    expect(matched.items.every((page) => page.title.toLowerCase().includes('proj'))).toBe(true);
  });

  it('carries what tells two same-named pages apart, and pages with a cursor', async () => {
    const { integration, app } = await seedRouter();

    const first = await app.request(`/${integration.id}/parent-pages?limit=2`);
    const page1 = (await first.json()) as {
      items: { id: string; url: string | null; icon: string | null; parentKind: string | null }[];
      nextCursor?: string;
    };
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).toBeDefined();
    // A row without these is a row nobody can choose between; `url` in particular was already on
    // the port and dropped by the old inline `{ id, title }` response schema.
    expect(page1.items[0]).toMatchObject({ url: expect.any(String), parentKind: 'workspace' });

    const second = await app.request(
      `/${integration.id}/parent-pages?limit=2&cursor=${String(page1.nextCursor)}`,
    );
    const page2 = (await second.json()) as { items: { id: string }[]; nextCursor?: string };
    expect(page2.items.map((p) => p.id)).not.toEqual(page1.items.map((p) => p.id));
    expect(page2.nextCursor).toBeUndefined();
  });

  it('records what the container page is called, from Notion rather than from the client', async () => {
    // Settings names this page on a link people click, so the title has to come from the provider
    // and not from whatever the browser happened to be showing when Create was pressed.
    const { integration, app } = await seedRouter();
    await app.request(`/${integration.id}/databases`);

    const provisioned = await app.request(`/${integration.id}/provision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ containerPageId: 'mock_page_workspace' }),
    });
    expect(provisioned.status).toBe(200);

    const row = one(
      await db.select().from(schema.integration).where(eq(schema.integration.id, integration.id)),
    );
    expect(row.config).toMatchObject({
      notionMirror: {
        containerPageId: 'mock_page_workspace',
        containerPageTitle: 'Team wiki',
        containerPageUrl: expect.any(String),
      },
    });
  });

  it('keeps the linked-table mode’s config when it records the container page', async () => {
    // `config` is a wholesale replace. Writing only the mirror key would drop `listIds` and
    // silently unlink every database the linked-table mode syncs.
    const { integration, app } = await seedRouter();
    await db
      .update(schema.integration)
      .set({ config: { listIds: ['existing-notion-db'] } })
      .where(eq(schema.integration.id, integration.id));
    await app.request(`/${integration.id}/databases`);

    await app.request(`/${integration.id}/provision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ containerPageId: 'mock_page_projects' }),
    });

    const row = one(
      await db.select().from(schema.integration).where(eq(schema.integration.id, integration.id)),
    );
    expect(row.config).toMatchObject({
      listIds: ['existing-notion-db'],
      notionMirror: { containerPageId: 'mock_page_projects' },
    });
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
