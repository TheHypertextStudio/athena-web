import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertDefined } from '@docket/test-utils';

import { organization, planDraft, user } from '../../src/schema';

/**
 * Schema coverage for the personal planning draft: who it belongs to, what it references, the
 * revision and timestamps the store relies on, and what happens to it when its owner goes.
 */

const client = new PGlite('memory://');
const db = drizzle(client);
const ids: Record<string, string> = {};

const EMPTY_DOCUMENT = { nodes: [], edges: [] };

beforeAll(async () => {
  await migrate(db, { migrationsFolder: resolve(import.meta.dirname, '../../drizzle') });
  ids['user'] = assertDefined(
    (
      await db
        .insert(user)
        .values({ name: 'Willie', email: 'w@example.com', emailVerified: true })
        .returning()
    )[0],
  ).id;
  ids['org'] = assertDefined(
    (await db.insert(organization).values({ name: 'Acme', slug: 'acme' }).returning())[0],
  ).id;
});

afterAll(async () => {
  await client.close();
});

describe('plan_draft', () => {
  it('references its owner, workspace, session, and root initiative', () => {
    const config = getTableConfig(planDraft);
    const targets = config.foreignKeys.map((key) => {
      const reference = key.reference();
      return `${reference.columns.map((column) => column.name).join(',')}->${getTableConfig(reference.foreignTable).name}`;
    });
    expect(targets).toEqual(
      expect.arrayContaining([
        'owner_user_id->user',
        'organization_id->organization',
        'session_id->agent_session',
        'root_initiative_id->initiative',
      ]),
    );
    expect(config.indexes.map((entry) => entry.config.name)).toEqual(
      expect.arrayContaining([
        'plan_draft_owner_status_idx',
        'plan_draft_session_idx',
        'plan_draft_owner_root_active_uq',
      ]),
    );
  });

  it('starts at revision 0 with generated ids and timestamps, and bumps updated_at on write', async () => {
    const [created] = await db
      .insert(planDraft)
      .values({
        ownerUserId: assertDefined(ids['user']),
        organizationId: assertDefined(ids['org']),
        title: 'Spring giving campaign',
        document: EMPTY_DOCUMENT,
      })
      .returning();
    const row = assertDefined(created);
    expect(row.id).toMatch(/^[0-9A-Z]{26}$/);
    expect(row.status).toBe('active');
    expect(row.revision).toBe(0);
    expect(row.rootInitiativeId).toBeNull();
    expect(row.archivedAt).toBeNull();
    expect(row.updatedAt.getTime()).toBe(row.createdAt.getTime());

    await new Promise((done) => setTimeout(done, 5));
    const [updated] = await db
      .update(planDraft)
      .set({ revision: 1 })
      .where(eq(planDraft.id, row.id))
      .returning();
    expect(assertDefined(updated).updatedAt.getTime()).toBeGreaterThan(row.updatedAt.getTime());
  });

  it('refuses a blank title', async () => {
    await expect(
      db.insert(planDraft).values({
        ownerUserId: assertDefined(ids['user']),
        organizationId: assertDefined(ids['org']),
        title: '   ',
        document: EMPTY_DOCUMENT,
      }),
    ).rejects.toThrow();
  });

  it('goes with its owner', async () => {
    const [owner] = await db
      .insert(user)
      .values({ name: 'Leaving', email: 'leaving@example.com', emailVerified: true })
      .returning();
    const ownerId = assertDefined(owner).id;
    await db.insert(planDraft).values({
      ownerUserId: ownerId,
      organizationId: assertDefined(ids['org']),
      title: 'Short-lived',
      document: EMPTY_DOCUMENT,
    });
    await db.delete(user).where(eq(user.id, ownerId));
    const remaining = await db.select().from(planDraft).where(eq(planDraft.ownerUserId, ownerId));
    expect(remaining).toEqual([]);
  });
});
