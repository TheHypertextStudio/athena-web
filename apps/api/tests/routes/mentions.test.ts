import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import type { MentionHydrateOut, MentionSearchOut } from '../../src/contracts/mention';

import {
  addMember,
  appWithSession,
  fakeSession,
  getDb,
  seedOrg,
  seedUserWithHub,
} from '../support/routes-harness';

function entityRoute(orgId: string, kind: string, id: string) {
  return {
    type: 'entity',
    organizationId: orgId,
    entityKind: kind,
    entityId: id,
    href: `/orgs/${orgId}/${kind}s/${id}`,
  };
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** Seed one search document, which is the read model the picker answers from. */
async function seedDocument(
  db: Awaited<ReturnType<typeof getDb>>['db'],
  schema: Awaited<ReturnType<typeof getDb>>,
  input: {
    orgId: string;
    entityId: string;
    title: string;
    kind?: string;
    visibility?: Record<string, unknown>;
    summary?: string;
    sourceUpdatedAt?: Date;
  },
): Promise<void> {
  const kind = input.kind ?? 'task';
  await db.insert(schema.searchDocument).values({
    id: `${kind}:${input.orgId}:${input.entityId}`,
    organizationId: input.orgId,
    kind: kind as never,
    family: 'work',
    sourceTable: kind,
    entityId: input.entityId,
    title: input.title,
    summary: input.summary ?? null,
    facet: {},
    route: entityRoute(input.orgId, kind, input.entityId),
    visibility: input.visibility ?? { mode: 'org_members' },
    baseRank: 100,
    sourceUpdatedAt: input.sourceUpdatedAt ?? new Date(),
  });
}

async function mountOrgs() {
  return (await import('../../src/routes/orgs')).default;
}

describe('mention picker — local wave', () => {
  it('returns matching entities as insertable refs', async () => {
    const schema = await getDb();
    const { db } = schema;
    const orgs = await mountOrgs();
    const userId = await seedUserWithHub(db, schema, 'MentionSearchUser');
    const orgId = await seedOrg(db, schema);
    await addMember(db, schema, orgId, userId);
    await seedDocument(db, schema, {
      orgId,
      entityId: 'zephyr_task',
      title: 'Zephyr migration',
      summary: 'Move the fleet',
    });

    const app = appWithSession(orgs, fakeSession(userId));
    const res = await app.request(`/${orgId}/mentions/search?q=zephyr`);
    expect(res.status).toBe(200);

    const body = await json<MentionSearchOut>(res);
    expect(body.query).toBe('zephyr');
    expect(body.items).toHaveLength(1);
    const item = body.items[0];
    expect(item?.origin).toBe('local');
    expect(item?.title).toBe('Zephyr migration');
    expect(item?.ref).toEqual({ kind: 'entity', entityKind: 'task', entityId: 'zephyr_task' });
    expect(item?.id).toBe('docket:task:zephyr_task');
  });

  it('hides an entity the caller cannot see, rather than listing it without a title', async () => {
    const schema = await getDb();
    const { db } = schema;
    const orgs = await mountOrgs();
    const userId = await seedUserWithHub(db, schema, 'MentionPrivacyUser');
    const otherUserId = await seedUserWithHub(db, schema, 'MentionPrivacyOther');
    const orgId = await seedOrg(db, schema);
    await addMember(db, schema, orgId, userId);
    await seedDocument(db, schema, {
      orgId,
      entityId: 'private_thing',
      title: 'Nimbus secret',
      visibility: { mode: 'user_private' },
    });
    await db
      .update(schema.searchDocument)
      .set({ userId: otherUserId })
      .where(eqDocument(schema, `task:${orgId}:private_thing`));

    const app = appWithSession(orgs, fakeSession(userId));
    const body = await json<MentionSearchOut>(
      await app.request(`/${orgId}/mentions/search?q=nimbus`),
    );
    expect(body.items).toHaveLength(0);
  });

  it('answers an empty query with recents, which is what the picker shows on bare @', async () => {
    const schema = await getDb();
    const { db } = schema;
    const orgs = await mountOrgs();
    const userId = await seedUserWithHub(db, schema, 'MentionRecentsUser');
    const orgId = await seedOrg(db, schema);
    await addMember(db, schema, orgId, userId);
    await seedDocument(db, schema, {
      orgId,
      entityId: 'older_item',
      title: 'Older item',
      sourceUpdatedAt: new Date('2026-01-01T00:00:00Z'),
    });
    await seedDocument(db, schema, {
      orgId,
      entityId: 'newer_item',
      title: 'Newer item',
      sourceUpdatedAt: new Date('2026-07-01T00:00:00Z'),
    });

    const app = appWithSession(orgs, fakeSession(userId));
    const body = await json<MentionSearchOut>(await app.request(`/${orgId}/mentions/search`));
    expect(body.query).toBe('');
    expect(body.items.map((i) => i.title)).toEqual(['Newer item', 'Older item']);
  });

  it('does not offer kinds nobody points at mid-sentence', async () => {
    const schema = await getDb();
    const { db } = schema;
    const orgs = await mountOrgs();
    const userId = await seedUserWithHub(db, schema, 'MentionKindsUser');
    const orgId = await seedOrg(db, schema);
    await addMember(db, schema, orgId, userId);
    await seedDocument(db, schema, {
      orgId,
      entityId: 'a_label',
      title: 'Quasar label',
      kind: 'label',
    });

    const app = appWithSession(orgs, fakeSession(userId));
    const body = await json<MentionSearchOut>(
      await app.request(`/${orgId}/mentions/search?q=quasar`),
    );
    expect(body.items).toHaveLength(0);
  });

  it('refuses a non-member outright', async () => {
    const schema = await getDb();
    const { db } = schema;
    const orgs = await mountOrgs();
    const userId = await seedUserWithHub(db, schema, 'MentionOutsider');
    const orgId = await seedOrg(db, schema);

    const app = appWithSession(orgs, fakeSession(userId));
    const res = await app.request(`/${orgId}/mentions/search?q=anything`);
    expect(res.status).toBe(404);
  });
});

describe('mention hydrate', () => {
  it('remains readable for a manager in a free shared workspace', async () => {
    const schema = await getDb();
    const { db } = schema;
    const orgs = await mountOrgs();
    const userId = await seedUserWithHub(db, schema, 'FreeHydrateManager');
    const orgId = await seedOrg(db, schema, false, false);
    const actorId = await addMember(db, schema, orgId, userId, 'owner');
    const [membership] = await db
      .select({ roleId: schema.actor.roleId })
      .from(schema.actor)
      .where(eq(schema.actor.id, actorId));
    await db
      .update(schema.role)
      .set({ capabilities: ['manage'] })
      .where(eq(schema.role.id, membership?.roleId ?? ''));

    const app = appWithSession(orgs, fakeSession(userId));
    const response = await app.request(`/${orgId}/mentions/hydrate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        refs: [{ kind: 'entity', entityKind: 'task', entityId: 'missing_task' }],
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      items: [{ kind: 'entity', accessible: false }],
    });
  });

  it('returns a card for a visible entity', async () => {
    const schema = await getDb();
    const { db } = schema;
    const orgs = await mountOrgs();
    const userId = await seedUserWithHub(db, schema, 'HydrateUser');
    const orgId = await seedOrg(db, schema);
    await addMember(db, schema, orgId, userId);
    await seedDocument(db, schema, {
      orgId,
      entityId: 'visible_task',
      title: 'Pulsar rollout',
      summary: 'Ship it',
    });

    const app = appWithSession(orgs, fakeSession(userId));
    const body = await json<MentionHydrateOut>(
      await app.request(`/${orgId}/mentions/hydrate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          refs: [{ kind: 'entity', entityKind: 'task', entityId: 'visible_task' }],
        }),
      }),
    );

    expect(body.items).toHaveLength(1);
    const card = body.items[0];
    expect(card?.kind).toBe('entity');
    if (card?.kind !== 'entity') throw new Error('expected an entity card');
    expect(card.accessible).toBe(true);
    expect(card.title).toBe('Pulsar rollout');
    expect(card.href).toBe(`/orgs/${orgId}/tasks/visible_task`);
  });

  it('leaks nothing about an entity the caller cannot see', async () => {
    const schema = await getDb();
    const { db } = schema;
    const orgs = await mountOrgs();
    const userId = await seedUserWithHub(db, schema, 'HydrateDeniedUser');
    const ownerUserId = await seedUserWithHub(db, schema, 'HydrateOwnerUser');
    const orgId = await seedOrg(db, schema);
    await addMember(db, schema, orgId, userId);
    await seedDocument(db, schema, {
      orgId,
      entityId: 'hidden_task',
      title: 'Vega confidential',
      visibility: { mode: 'user_private' },
    });
    await db
      .update(schema.searchDocument)
      .set({ userId: ownerUserId })
      .where(eqDocument(schema, `task:${orgId}:hidden_task`));

    const app = appWithSession(orgs, fakeSession(userId));
    const body = await json<MentionHydrateOut>(
      await app.request(`/${orgId}/mentions/hydrate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          refs: [{ kind: 'entity', entityKind: 'task', entityId: 'hidden_task' }],
        }),
      }),
    );

    expect(body.items).toHaveLength(1);
    const card = body.items[0];
    if (card?.kind !== 'entity') throw new Error('expected an entity card');
    expect(card.accessible).toBe(false);
    expect(card.title).toBeNull();
    expect(card.subtitle).toBeNull();
    expect(card.href).toBeNull();
    expect(JSON.stringify(card)).not.toContain('Vega');
  });

  it('reports an id from another organization as inaccessible, not as missing', async () => {
    const schema = await getDb();
    const { db } = schema;
    const orgs = await mountOrgs();
    const userId = await seedUserWithHub(db, schema, 'HydrateCrossTenantUser');
    const orgId = await seedOrg(db, schema);
    const foreignOrgId = await seedOrg(db, schema);
    await addMember(db, schema, orgId, userId);
    await seedDocument(db, schema, {
      orgId: foreignOrgId,
      entityId: 'foreign_task',
      title: 'Andromeda internal',
    });

    const app = appWithSession(orgs, fakeSession(userId));
    const body = await json<MentionHydrateOut>(
      await app.request(`/${orgId}/mentions/hydrate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          refs: [{ kind: 'entity', entityKind: 'task', entityId: 'foreign_task' }],
        }),
      }),
    );

    const card = body.items[0];
    if (card?.kind !== 'entity') throw new Error('expected an entity card');
    expect(card.accessible).toBe(false);
    expect(JSON.stringify(body)).not.toContain('Andromeda');
  });

  it('rejects a batch larger than one surface could contain', async () => {
    const schema = await getDb();
    const { db } = schema;
    const orgs = await mountOrgs();
    const userId = await seedUserWithHub(db, schema, 'HydrateOverflowUser');
    const orgId = await seedOrg(db, schema);
    await addMember(db, schema, orgId, userId);

    const app = appWithSession(orgs, fakeSession(userId));
    const res = await app.request(`/${orgId}/mentions/hydrate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        refs: Array.from({ length: 51 }, (_, i) => ({
          kind: 'entity',
          entityKind: 'task',
          entityId: `t${i}`,
        })),
      }),
    });
    expect(res.status).toBe(422);
  });
});

/** Narrow a search document by its composite id. */
function eqDocument(schema: Awaited<ReturnType<typeof getDb>>, id: string) {
  return eq(schema.searchDocument.id, id);
}
