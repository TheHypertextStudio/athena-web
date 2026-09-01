import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import { formatMentionLink } from '../../src/contracts/mention';

import { loadEntityMentions } from '../../src/content/entity-mentions';
import { createDrizzleMentionStorage } from '../../src/content/drizzle-mention-storage';
import { createMentionReconciler } from '../../src/content/reconcile-mentions';
import {
  getDb,
  one,
  seedBaseOrg,
  seedStatuses,
  seedUserWithHub,
  addMember,
} from '../support/routes-harness';

let schema: typeof DbModule;
let db: typeof DbModule.db;

/** Built over the real storage adapter, so these exercise the same wiring production uses. */
let reconciler: ReturnType<typeof createMentionReconciler>;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  reconciler = createMentionReconciler(createDrizzleMentionStorage());
});

async function seedProject(orgId: string, description: string): Promise<string> {
  const statusId = await seedStatuses(db, schema, orgId);
  const row = one(
    await db
      .insert(schema.project)
      .values({
        organizationId: orgId,
        name: 'Reference host',
        description,
        status: 'planned',
        statusId: statusId('project', 'planned'),
      })
      .returning({ id: schema.project.id }),
  );
  return row.id;
}

/** Index a task so the visibility filter can resolve it, the way the real write path would. */
async function indexTask(orgId: string, taskId: string, title: string): Promise<void> {
  await db.insert(schema.searchDocument).values({
    id: `task:${orgId}:${taskId}`,
    organizationId: orgId,
    kind: 'task',
    family: 'work',
    sourceTable: 'task',
    entityId: taskId,
    title,
    facet: {},
    route: {
      type: 'entity',
      organizationId: orgId,
      entityKind: 'task',
      entityId: taskId,
      href: `/orgs/${orgId}/tasks/${taskId}`,
    },
    visibility: { mode: 'org_members' },
    baseRank: 100,
  });
}

describe('loadEntityMentions', () => {
  it('returns nothing for prose that references nothing', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const userId = await seedUserWithHub(db, schema, 'MentionsReaderA');
    await addMember(db, schema, orgId, userId);
    const projectId = await seedProject(orgId, 'Just words.');
    await reconciler.reconcile(orgId, 'project', projectId);

    const result = await loadEntityMentions({
      caller: { kind: 'user', userId },
      orgId,
      subjectType: 'project',
      subjectId: projectId,
    });
    expect(result).toEqual({ external: [], entities: [] });
  });

  it('surfaces an external reference with its resolved metadata', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const userId = await seedUserWithHub(db, schema, 'MentionsReaderB');
    await addMember(db, schema, orgId, userId);
    const url = 'https://www.notion.so/Plan-1f2e3d4c5b6a7988990a1b2c3d4e5f60';
    const projectId = await seedProject(
      orgId,
      `Depends on ${formatMentionLink('The plan', url, { kind: 'external', url })}.`,
    );
    await reconciler.reconcile(orgId, 'project', projectId);

    const result = await loadEntityMentions({
      caller: { kind: 'user', userId },
      orgId,
      subjectType: 'project',
      subjectId: projectId,
    });

    expect(result.external).toHaveLength(1);
    expect(result.external[0]?.label).toBe('The plan');
    expect(result.external[0]?.fields).toEqual(['description']);
    expect(result.external[0]?.occurrences).toBe(1);
    // Recognized as Notion rather than as a generic page, which is what the registry buys.
    expect(result.external[0]?.resource?.provider).toBe('notion');
  });

  it('counts a reference written twice as one row', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const userId = await seedUserWithHub(db, schema, 'MentionsReaderC');
    await addMember(db, schema, orgId, userId);
    const url = 'https://example.com/repeated-doc';
    const link = formatMentionLink('Doc', url, { kind: 'external', url });
    const projectId = await seedProject(orgId, `${link} and again ${link}.`);
    await reconciler.reconcile(orgId, 'project', projectId);

    const result = await loadEntityMentions({
      caller: { kind: 'user', userId },
      orgId,
      subjectType: 'project',
      subjectId: projectId,
    });

    expect(result.external).toHaveLength(1);
    expect(result.external[0]?.occurrences).toBe(2);
  });

  it('lists a referenced record the reader can see', async () => {
    const { orgId, teamId, statusId } = await seedBaseOrg(db, schema);
    const userId = await seedUserWithHub(db, schema, 'MentionsReaderD');
    await addMember(db, schema, orgId, userId);
    const target = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          teamId,
          title: 'Visible work',
          state: 'todo',
          statusId: statusId('task', 'todo'),
        })
        .returning({ id: schema.task.id }),
    );
    await indexTask(orgId, target.id, 'Visible work');

    const ref = { kind: 'entity', entityKind: 'task', entityId: target.id } as const;
    const projectId = await seedProject(
      orgId,
      `Blocked by ${formatMentionLink('Visible work', `/orgs/${orgId}/tasks/${target.id}`, ref)}.`,
    );
    await reconciler.reconcile(orgId, 'project', projectId);

    const result = await loadEntityMentions({
      caller: { kind: 'user', userId },
      orgId,
      subjectType: 'project',
      subjectId: projectId,
    });

    expect(result.entities).toHaveLength(1);
    expect(result.entities[0]?.href).toBe(`/orgs/${orgId}/tasks/${target.id}`);
  });

  it('omits a referenced record the reader cannot see, rather than naming it', async () => {
    const { orgId, teamId, statusId } = await seedBaseOrg(db, schema);
    const reader = await seedUserWithHub(db, schema, 'MentionsReaderE');
    const owner = await seedUserWithHub(db, schema, 'MentionsOwnerE');
    await addMember(db, schema, orgId, reader);
    const target = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          teamId,
          title: 'Sirius confidential',
          state: 'todo',
          statusId: statusId('task', 'todo'),
        })
        .returning({ id: schema.task.id }),
    );
    await indexTask(orgId, target.id, 'Sirius confidential');
    await db
      .update(schema.searchDocument)
      .set({ visibility: { mode: 'user_private' }, userId: owner })
      .where(eq(schema.searchDocument.id, `task:${orgId}:${target.id}`));

    const ref = { kind: 'entity', entityKind: 'task', entityId: target.id } as const;
    const projectId = await seedProject(
      orgId,
      formatMentionLink('Sirius confidential', `/orgs/${orgId}/tasks/${target.id}`, ref),
    );
    await reconciler.reconcile(orgId, 'project', projectId);

    const result = await loadEntityMentions({
      caller: { kind: 'user', userId: reader },
      orgId,
      subjectType: 'project',
      subjectId: projectId,
    });

    expect(result.entities).toHaveLength(0);
    expect(JSON.stringify(result)).not.toContain('Sirius');
  });

  it('drops a reference once the author deletes it from the prose', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const userId = await seedUserWithHub(db, schema, 'MentionsReaderF');
    await addMember(db, schema, orgId, userId);
    const url = 'https://example.com/transient-ref';
    const projectId = await seedProject(
      orgId,
      formatMentionLink('Doc', url, { kind: 'external', url }),
    );
    await reconciler.reconcile(orgId, 'project', projectId);

    await db
      .update(schema.project)
      .set({ description: 'No links now.' })
      .where(eq(schema.project.id, projectId));
    await reconciler.reconcile(orgId, 'project', projectId);

    const result = await loadEntityMentions({
      caller: { kind: 'user', userId },
      orgId,
      subjectType: 'project',
      subjectId: projectId,
    });
    expect(result.external).toHaveLength(0);
  });
});
