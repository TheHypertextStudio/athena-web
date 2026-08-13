/**
 * `hydrateMentions` — an entity card's `excerptMarkdown` field, the raw-ish Markdown excerpt a
 * hovercard renders with real (if reduced-fidelity) structure, alongside the fully flattened
 * `subtitle` it existed as before.
 */
import { describe, expect, it } from 'vitest';

import { getDb, addMember, one, seedOrg, seedUserWithHub } from '../support/routes-harness';

import { hydrateMentions } from '../../src/content/mention-hydrate';

describe('hydrateMentions excerptMarkdown', () => {
  it('carries the raw Markdown body, distinct from the flattened subtitle', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'MentionHydrateUser');
    const orgId = await seedOrg(db, schema);
    await addMember(db, schema, orgId, userId);
    const teamId = one(
      await db
        .insert(schema.team)
        .values({
          organizationId: orgId,
          name: 'Hydrate Team',
          key: `H${Math.random().toString(36).slice(2, 8)}`,
        })
        .returning({ id: schema.team.id }),
    ).id;
    const taskId = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          title: 'Ship the launch',
          teamId,
          state: 'todo',
          visibility: 'public',
        })
        .returning({ id: schema.task.id }),
    ).id;

    await db.insert(schema.searchDocument).values({
      id: `task:${orgId}:${taskId}`,
      organizationId: orgId,
      kind: 'task',
      family: 'work',
      sourceTable: 'task',
      entityId: taskId,
      title: 'Ship the launch',
      summary: 'Repro Open the app in any timezone west of UTC.',
      body: '# Repro\n\nOpen the app in *any* timezone west of UTC.',
      facet: {},
      route: {
        type: 'entity',
        organizationId: orgId,
        entityKind: 'task',
        entityId: taskId,
        href: '#',
      },
      visibility: { mode: 'org_members' },
      baseRank: 100,
    });

    const [card] = await hydrateMentions({
      caller: { kind: 'user', userId },
      orgId,
      refs: [{ kind: 'entity', entityKind: 'task', entityId: taskId }],
    });

    expect(card?.kind).toBe('entity');
    if (card?.kind !== 'entity') throw new Error('expected an entity card');
    expect(card.subtitle).toBe('Repro Open the app in any timezone west of UTC.');
    // Unlike `subtitle`, the excerpt keeps its Markdown syntax — the client renders it, not a
    // server-side flattener.
    expect(card.excerptMarkdown).toBe('# Repro\n\nOpen the app in *any* timezone west of UTC.');
    expect(card.excerptMarkdown).toContain('#');
    expect(card.excerptMarkdown).toContain('*');
  });

  it('has no excerptMarkdown when the entity has no body to excerpt from', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'MentionHydrateUserNoBody');
    const orgId = await seedOrg(db, schema);
    await addMember(db, schema, orgId, userId);

    await db.insert(schema.searchDocument).values({
      id: `task:${orgId}:nobody_task`,
      organizationId: orgId,
      kind: 'task',
      family: 'work',
      sourceTable: 'task',
      entityId: 'nobody_task',
      title: 'Untitled work',
      summary: null,
      body: null,
      facet: {},
      route: {
        type: 'entity',
        organizationId: orgId,
        entityKind: 'task',
        entityId: 'nobody_task',
        href: '#',
      },
      visibility: { mode: 'org_members' },
      baseRank: 100,
    });

    const [card] = await hydrateMentions({
      caller: { kind: 'user', userId },
      orgId,
      refs: [{ kind: 'entity', entityKind: 'task', entityId: 'nobody_task' }],
    });

    expect(card?.kind).toBe('entity');
    if (card?.kind !== 'entity') throw new Error('expected an entity card');
    expect(card.excerptMarkdown).toBeNull();
    expect(card.subtitle).toBeNull();
  });

  it('caps the excerpt at a preview length while keeping it valid enough to lex', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'MentionHydrateUserLong');
    const orgId = await seedOrg(db, schema);
    await addMember(db, schema, orgId, userId);

    const longBody = `# Heading\n\n${'word '.repeat(200).trim()}`;
    await db.insert(schema.searchDocument).values({
      id: `task:${orgId}:long_task`,
      organizationId: orgId,
      kind: 'task',
      family: 'work',
      sourceTable: 'task',
      entityId: 'long_task',
      title: 'Long task',
      summary: null,
      body: longBody,
      facet: {},
      route: {
        type: 'entity',
        organizationId: orgId,
        entityKind: 'task',
        entityId: 'long_task',
        href: '#',
      },
      visibility: { mode: 'org_members' },
      baseRank: 100,
    });

    const [card] = await hydrateMentions({
      caller: { kind: 'user', userId },
      orgId,
      refs: [{ kind: 'entity', entityKind: 'task', entityId: 'long_task' }],
    });

    expect(card?.kind).toBe('entity');
    if (card?.kind !== 'entity') throw new Error('expected an entity card');
    expect(card.excerptMarkdown).not.toBeNull();
    expect(card.excerptMarkdown?.length).toBeLessThan(longBody.length);
    expect(card.excerptMarkdown?.length).toBeLessThanOrEqual(321);
  });
});
