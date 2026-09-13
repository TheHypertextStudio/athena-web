/**
 * `@docket/api` — scheduled sync for linked Notion databases.
 *
 * @remarks
 * Covers what a sync pass records about page content: that an edit reaches Notion on the next
 * scheduled pass, and that whether Notion accepted page bodies is stored without disturbing
 * settings saved while the pass ran.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import { assertDefined } from '@docket/test-utils';

import type * as IntegrationSyncModule from '../../src/routes/integration-sync';
import { appWithActor, getDb, one, seedBaseOrg } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let integrations!: unknown;
let sweepConnectorSync!: typeof IntegrationSyncModule.sweepConnectorSync;
let persistLinkedContentAccess!: typeof IntegrationSyncModule.persistLinkedContentAccess;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  integrations = (await import('../../src/routes/integrations')).default;
  ({ persistLinkedContentAccess, sweepConnectorSync } =
    await import('../../src/routes/integration-sync'));
});

/** Insert a write-back Notion integration with the given config. */
async function seedNotion(config: Record<string, unknown> = {}) {
  const { orgId, humanActorId } = await seedBaseOrg(db, schema);
  const row = one(
    await db
      .insert(schema.integration)
      .values({
        organizationId: orgId,
        provider: 'notion',
        pattern: 'connector',
        roles: ['work'],
        writeBack: true,
        config,
        createdBy: humanActorId,
      })
      .returning(),
  );
  return { orgId, humanActorId, row };
}

/** The integration's stored config. */
async function storedConfig(id: string): Promise<Record<string, unknown>> {
  const [row] = await db
    .select({ config: schema.integration.config })
    .from(schema.integration)
    .where(eq(schema.integration.id, id));
  return assertDefined(row).config;
}

describe('linked Notion sync', () => {
  it('pushes a description edit on the next scheduled sync even when Notion reports no change', async () => {
    const { orgId, humanActorId, row } = await seedNotion();
    const w = appWithActor(integrations, orgId, ['manage'], humanActorId);
    const sync = await w.request(`/${row.id}/sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    expect(sync.status).toBe(200);

    const [linked] = await db
      .select()
      .from(schema.task)
      .where(eq(schema.task.sourceIntegrationId, row.id))
      .limit(1);
    const original = assertDefined(linked);
    await db
      .update(schema.task)
      .set({ description: '# Revised brief\n\nEdited in Docket.' })
      .where(eq(schema.task.id, original.id));

    // A recent full read makes the scheduled pass incremental, so Notion returns no rows at all.
    const now = new Date();
    await db
      .update(schema.integration)
      .set({
        status: 'connected',
        syncCadenceMinutes: 60,
        lastSyncedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
        lastFullSyncedAt: new Date(now.getTime() - 60 * 60 * 1000),
      })
      .where(eq(schema.integration.id, row.id));
    await sweepConnectorSync(now);

    const pushed = one(await db.select().from(schema.task).where(eq(schema.task.id, original.id)));
    expect(pushed.lastPushedAt).not.toBeNull();
    expect(pushed.updatedAt.getTime()).toBe(assertDefined(pushed.externalUpdatedAt).getTime());
    expect(await storedConfig(row.id)).toMatchObject({ notionLinkedContentAccess: 'granted' });
  });
});

describe('persistLinkedContentAccess', () => {
  it('records missing access when any page body was refused', async () => {
    const { row } = await seedNotion({ notionLinkedContentAccess: 'granted' });

    await persistLinkedContentAccess(row, {
      contentWritten: 3,
      contentInaccessible: 1,
      contentRejected: 0,
    });

    expect(await storedConfig(row.id)).toMatchObject({
      notionLinkedContentAccess: 'missing',
      notionLinkedContentKept: false,
    });
  });

  it('records pages Notion would not replace, and clears it once every body lands', async () => {
    const { row } = await seedNotion();

    await persistLinkedContentAccess(row, {
      contentWritten: 1,
      contentInaccessible: 0,
      contentRejected: 1,
    });
    expect(await storedConfig(row.id)).toEqual({
      notionLinkedContentAccess: 'granted',
      notionLinkedContentKept: true,
    });

    await persistLinkedContentAccess(row, {
      contentWritten: 2,
      contentInaccessible: 0,
      contentRejected: 0,
    });
    expect(await storedConfig(row.id)).toMatchObject({ notionLinkedContentKept: false });
  });

  it('keeps settings saved while the pass ran', async () => {
    const { row } = await seedNotion({ listIds: ['before'] });
    await db
      .update(schema.integration)
      .set({ config: { listIds: ['saved-during-sync'] } })
      .where(eq(schema.integration.id, row.id));

    await persistLinkedContentAccess(row, {
      contentWritten: 1,
      contentInaccessible: 0,
      contentRejected: 0,
    });

    expect(await storedConfig(row.id)).toEqual({
      listIds: ['saved-during-sync'],
      notionLinkedContentAccess: 'granted',
      notionLinkedContentKept: false,
    });
  });

  it('writes nothing when the pass wrote no page content or the answer is unchanged', async () => {
    const { row } = await seedNotion({ notionLinkedContentAccess: 'missing' });
    const before = one(
      await db.select().from(schema.integration).where(eq(schema.integration.id, row.id)),
    );

    await persistLinkedContentAccess(row, {
      contentWritten: 0,
      contentInaccessible: 0,
      contentRejected: 0,
    });
    await persistLinkedContentAccess(row, {
      contentWritten: 0,
      contentInaccessible: 2,
      contentRejected: 0,
    });

    const after = one(
      await db.select().from(schema.integration).where(eq(schema.integration.id, row.id)),
    );
    expect(after.config).toEqual({ notionLinkedContentAccess: 'missing' });
    expect(after.updatedAt).toEqual(before.updatedAt);
  });
});
