/**
 * `hydrateMentions` — an entity card's `excerptMarkdown` field, the raw-ish Markdown excerpt a
 * hovercard renders with real (if reduced-fidelity) structure, alongside the fully flattened
 * `subtitle` it existed as before.
 */
import { describe, expect, it } from 'vitest';

import { canonicalizeResourceUrl } from '@docket/connections/resource-contract';

import {
  getDb,
  addMember,
  one,
  seedOrg,
  seedStatuses,
  seedUserWithHub,
} from '../support/routes-harness';

import { createDrizzleMentionStorage } from '../../src/content/drizzle-mention-storage';
import { excerptMarkdownOf, hydrateMentions } from '../../src/content/mention-hydrate';

describe('hydrateMentions excerptMarkdown', () => {
  it('carries the raw Markdown body, distinct from the flattened subtitle', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'MentionHydrateUser');
    const orgId = await seedOrg(db, schema);
    const statusId = await seedStatuses(db, schema, orgId);
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
          statusId: statusId('task', 'todo'),
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

describe('hydrateMentions external resources', () => {
  it('resolves an external ref to the stored resource behind its canonical key', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'MentionHydrateExternalUser');
    const orgId = await seedOrg(db, schema);
    await addMember(db, schema, orgId, userId);

    const url = 'https://example.com/handbook';
    const canonical = canonicalizeResourceUrl(url);
    if (canonical === undefined) throw new Error('expected a canonicalizable url');
    await createDrizzleMentionStorage().resources.findOrCreate({
      organizationId: orgId,
      createdBy: null,
      ...canonical,
    });

    const [card] = await hydrateMentions({
      caller: { kind: 'user', userId },
      orgId,
      refs: [{ kind: 'external', url }],
    });

    expect(card?.kind).toBe('external');
    if (card?.kind !== 'external') throw new Error('expected an external card');
    expect(card.url).toBe(url);
  });

  it('omits an external ref whose resource was never stored, rather than throwing', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'MentionHydrateExternalMissingUser');
    const orgId = await seedOrg(db, schema);
    await addMember(db, schema, orgId, userId);

    const cards = await hydrateMentions({
      caller: { kind: 'user', userId },
      orgId,
      refs: [{ kind: 'external', url: 'https://example.com/never-unfurled' }],
    });

    expect(cards).toHaveLength(0);
  });
});

describe('excerptMarkdownOf', () => {
  it('returns null for an empty or whitespace-only body', () => {
    expect(excerptMarkdownOf(null)).toBeNull();
    expect(excerptMarkdownOf('   \n\n  ')).toBeNull();
  });

  it('leaves a body at or under the limit untouched, with no trailing ellipsis', () => {
    expect(excerptMarkdownOf('Short body.')).toBe('Short body.');
  });

  it('breaks a truncated excerpt on a word boundary and appends an ellipsis', () => {
    const body = 'word '.repeat(100).trim();
    const result = excerptMarkdownOf(body);
    expect(result?.endsWith('…')).toBe(true);
    const withoutEllipsis = result?.slice(0, -1) ?? '';
    // Every space-separated piece is a whole "word" — nothing was cut mid-token.
    expect(withoutEllipsis.split(' ').every((piece) => piece === 'word')).toBe(true);
  });

  it('trims off a fenced code block left unterminated by truncation, rather than leaving it dangling', () => {
    const intro = 'Intro text before the fence. ';
    const body = `${intro}\n\n\`\`\`ts\n${'const line = 1;\n'.repeat(50)}`;
    const result = excerptMarkdownOf(body);
    // No lone, unterminated ``` survives into the excerpt.
    expect(((result ?? '').match(/```/g) ?? []).length % 2).toBe(0);
    expect(result).not.toContain('```');
    expect(result).toContain('Intro text before the fence.');
  });

  it('never splits a surrogate pair at the truncation boundary', () => {
    // An emoji (a two-code-unit surrogate pair) sitting right at the raw 320-character cutoff.
    const body = `${'a'.repeat(319)}😀${'b'.repeat(50)}`;
    const result = excerptMarkdownOf(body) ?? '';
    // No unpaired high or low surrogate anywhere in the result.
    expect(result).not.toMatch(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u,
    );
  });
});
