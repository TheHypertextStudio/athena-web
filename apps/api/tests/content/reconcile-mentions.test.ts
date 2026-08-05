import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import { formatMentionLink } from '@docket/types';

import { reconcileMentions } from '../../src/content/reconcile-mentions';
import { getDb, one, seedBaseOrg } from '../support/routes-harness';

let schema: typeof DbModule;
let db: typeof DbModule.db;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

async function seedProject(orgId: string, description: string): Promise<string> {
  const row = one(
    await db
      .insert(schema.project)
      .values({ organizationId: orgId, name: 'Platform rebuild', description })
      .returning({ id: schema.project.id }),
  );
  return row.id;
}

async function mentionsFor(projectId: string) {
  return db
    .select()
    .from(schema.mention)
    .where(and(eq(schema.mention.subjectType, 'project'), eq(schema.mention.subjectId, projectId)));
}

async function setDescription(projectId: string, description: string): Promise<void> {
  await db.update(schema.project).set({ description }).where(eq(schema.project.id, projectId));
}

describe('reconcileMentions', () => {
  it('does nothing for a source table that carries no prose', async () => {
    const { orgId, teamId } = await seedBaseOrg(db, schema);
    await expect(reconcileMentions(orgId, 'label', teamId)).resolves.toBeUndefined();
  });

  it('creates one external resource and one edge for a mentioned Drive file', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const url = 'https://docs.google.com/document/d/mentionsA/edit';
    const projectId = await seedProject(
      orgId,
      `Depends on ${formatMentionLink('Q3 launch plan', url, { kind: 'external', url })}.`,
    );

    await reconcileMentions(orgId, 'project', projectId);

    const rows = await mentionsFor(projectId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.targetKind).toBe('external');
    expect(rows[0]?.label).toBe('Q3 launch plan');
    expect(rows[0]?.field).toBe('description');
    expect(rows[0]?.position).toBe(0);

    const resource = one(
      await db
        .select()
        .from(schema.externalResource)
        .where(eq(schema.externalResource.id, rows[0]?.externalResourceId ?? '')),
    );
    expect(resource.provider).toBe('google_drive');
    expect(resource.canonicalKey).toBe('google_drive:mentionsA');
    expect(resource.resourceType).toBe('document');
    // The write path makes no network call, so a fresh resource has no title yet — and must not
    // invent one from the URL.
    expect(resource.unfurlStatus).toBe('pending');
    expect(resource.title).toBeNull();
  });

  it('dedupes two spellings of the same file onto one resource row', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const a = 'https://docs.google.com/document/d/mentionsB/edit#heading';
    const b = 'https://drive.google.com/open?id=mentionsB';
    const projectId = await seedProject(
      orgId,
      [
        formatMentionLink('Spec', a, { kind: 'external', url: a }),
        formatMentionLink('Same spec', b, { kind: 'external', url: b }),
      ].join('\n\n'),
    );

    await reconcileMentions(orgId, 'project', projectId);

    const rows = await mentionsFor(projectId);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.externalResourceId)).size).toBe(1);
  });

  it('records a plainly pasted URL, so even a bare link carries metadata', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const projectId = await seedProject(orgId, 'Context: https://example.com/handbook');

    await reconcileMentions(orgId, 'project', projectId);

    const rows = await mentionsFor(projectId);
    expect(rows).toHaveLength(1);
    const resource = one(
      await db
        .select()
        .from(schema.externalResource)
        .where(eq(schema.externalResource.id, rows[0]?.externalResourceId ?? '')),
    );
    expect(resource.provider).toBe('web');
    expect(resource.canonicalUrl).toBe('https://example.com/handbook');
  });

  it('links an in-org entity mention to the entity, not to a resource', async () => {
    const { orgId, teamId } = await seedBaseOrg(db, schema);
    const target = one(
      await db
        .insert(schema.task)
        .values({ organizationId: orgId, teamId, title: 'Ship the migration', state: 'todo' })
        .returning({ id: schema.task.id }),
    );
    const ref = { kind: 'entity', entityKind: 'task', entityId: target.id } as const;
    const projectId = await seedProject(
      orgId,
      `Blocked by ${formatMentionLink('Ship the migration', `/orgs/${orgId}/tasks/${target.id}`, ref)}.`,
    );

    await reconcileMentions(orgId, 'project', projectId);

    const rows = await mentionsFor(projectId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.targetKind).toBe('entity');
    expect(rows[0]?.targetEntityKind).toBe('task');
    expect(rows[0]?.targetEntityId).toBe(target.id);
    expect(rows[0]?.externalResourceId).toBeNull();
  });

  it('refuses a forged cross-tenant reference, so hydrate cannot become an id oracle', async () => {
    const other = await seedBaseOrg(db, schema);
    const foreignTask = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: other.orgId,
          teamId: other.teamId,
          title: 'Secret work',
          state: 'todo',
        })
        .returning({ id: schema.task.id }),
    );
    const { orgId } = await seedBaseOrg(db, schema);
    const ref = { kind: 'entity', entityKind: 'task', entityId: foreignTask.id } as const;
    const projectId = await seedProject(
      orgId,
      `Peeking at ${formatMentionLink('Secret work', `/orgs/${other.orgId}/tasks/${foreignTask.id}`, ref)}.`,
    );

    await reconcileMentions(orgId, 'project', projectId);

    expect(await mentionsFor(projectId)).toHaveLength(0);
  });

  it('drops a reference to an entity that does not exist at all', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const ref = {
      kind: 'entity',
      entityKind: 'task',
      entityId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    } as const;
    const projectId = await seedProject(orgId, formatMentionLink('Ghost', '/orgs/x/tasks/y', ref));

    await reconcileMentions(orgId, 'project', projectId);

    expect(await mentionsFor(projectId)).toHaveLength(0);
  });

  it('ignores a link written inside a fenced code block', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const projectId = await seedProject(
      orgId,
      ['How to link:', '', '```md', '[example](https://example.com/not-a-mention)', '```'].join(
        '\n',
      ),
    );

    await reconcileMentions(orgId, 'project', projectId);

    expect(await mentionsFor(projectId)).toHaveLength(0);
  });

  it('converges on re-run rather than duplicating edges', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const url = 'https://example.com/repeat';
    const projectId = await seedProject(
      orgId,
      `See ${formatMentionLink('Doc', url, { kind: 'external', url })}.`,
    );

    await reconcileMentions(orgId, 'project', projectId);
    await reconcileMentions(orgId, 'project', projectId);
    await reconcileMentions(orgId, 'project', projectId);

    expect(await mentionsFor(projectId)).toHaveLength(1);
  });

  it('removes an edge when the author deletes the link from the prose', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const url = 'https://example.com/transient';
    const projectId = await seedProject(
      orgId,
      formatMentionLink('Doc', url, { kind: 'external', url }),
    );
    await reconcileMentions(orgId, 'project', projectId);
    expect(await mentionsFor(projectId)).toHaveLength(1);

    await setDescription(projectId, 'No links here any more.');
    await reconcileMentions(orgId, 'project', projectId);

    expect(await mentionsFor(projectId)).toHaveLength(0);
  });

  it('renumbers positions when a link is inserted above an existing one', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const second = 'https://example.com/second';
    const first = 'https://example.com/first';
    const projectId = await seedProject(
      orgId,
      formatMentionLink('Second', second, { kind: 'external', url: second }),
    );
    await reconcileMentions(orgId, 'project', projectId);

    await setDescription(
      projectId,
      [
        formatMentionLink('First', first, { kind: 'external', url: first }),
        formatMentionLink('Second', second, { kind: 'external', url: second }),
      ].join('\n\n'),
    );
    await reconcileMentions(orgId, 'project', projectId);

    const rows = [...(await mentionsFor(projectId))].sort((a, b) => a.position - b.position);
    expect(rows.map((r) => [r.position, r.label])).toEqual([
      [0, 'First'],
      [1, 'Second'],
    ]);
  });

  it('deletes every edge when the subject row is gone', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const url = 'https://example.com/doomed';
    const projectId = await seedProject(
      orgId,
      formatMentionLink('Doc', url, { kind: 'external', url }),
    );
    await reconcileMentions(orgId, 'project', projectId);
    expect(await mentionsFor(projectId)).toHaveLength(1);

    await db.delete(schema.project).where(eq(schema.project.id, projectId));
    await reconcileMentions(orgId, 'project', projectId);

    expect(await mentionsFor(projectId)).toHaveLength(0);
  });
});
