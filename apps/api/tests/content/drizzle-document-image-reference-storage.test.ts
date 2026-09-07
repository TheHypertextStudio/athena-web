import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';

import { createDrizzleDocumentImageReferenceStorage } from '../../src/content/drizzle-document-image-reference-storage';
import { getDb, one, seedBaseOrg } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

async function insertImage(organizationId: string, id: string): Promise<void> {
  await db.insert(schema.documentImage).values({
    id,
    organizationId,
    blobKey: `document-images/${organizationId}/${id}`,
    fileName: `${id}.png`,
    mimeType: 'image/png',
    byteSize: 10,
  });
}

describe('Drizzle document image reference storage', () => {
  it('replaces a subject projection and scopes image lookups to its organization', async () => {
    const mine = await seedBaseOrg(db, schema);
    const theirs = await seedBaseOrg(db, schema);
    await insertImage(mine.orgId, 'image_mine_1');
    await insertImage(mine.orgId, 'image_mine_2');
    await insertImage(theirs.orgId, 'image_theirs');
    const storage = createDrizzleDocumentImageReferenceStorage();
    const subject = {
      organizationId: mine.orgId,
      subjectType: 'project',
      subjectId: 'project_1',
    } as const;

    await storage.references.replaceForSubject(subject, [
      { imageId: 'image_mine_1', field: 'description', position: 0 },
      { imageId: 'image_mine_2', field: 'description', position: 1 },
    ]);
    await storage.references.replaceForSubject(subject, [
      { imageId: 'image_mine_2', field: 'description', position: 0 },
    ]);

    const rows = await db.select().from(schema.documentImageReference);
    expect(rows.filter((row) => row.subjectId === 'project_1')).toMatchObject([
      {
        organizationId: mine.orgId,
        imageId: 'image_mine_2',
        subjectType: 'project',
        subjectId: 'project_1',
        field: 'description',
        position: 0,
      },
    ]);
    await expect(storage.references.hasImageReference(mine.orgId, 'image_mine_2')).resolves.toBe(
      true,
    );
    await expect(storage.references.hasImageReference(theirs.orgId, 'image_mine_2')).resolves.toBe(
      false,
    );
    await expect(
      storage.images.filterOwnedImageIds(mine.orgId, ['image_mine_1', 'image_theirs']),
    ).resolves.toEqual(new Set(['image_mine_1']));
  });

  it('reads all nine authoritative prose shapes, including template payload descriptions', async () => {
    const org = await seedBaseOrg(db, schema);
    const prose = '![Figure](/v1/orgs/example/images/image_1)';
    await db.update(schema.team).set({ description: prose }).where(eq(schema.team.id, org.teamId));

    const initiative = one(
      await db
        .insert(schema.initiative)
        .values({
          organizationId: org.orgId,
          name: 'Initiative',
          status: 'active',
          statusId: org.statusId('initiative', 'active'),
          description: prose,
        })
        .returning(),
    );
    const program = one(
      await db
        .insert(schema.program)
        .values({
          organizationId: org.orgId,
          name: 'Program',
          status: 'active',
          statusId: org.statusId('program', 'active'),
          description: prose,
        })
        .returning(),
    );
    const project = one(
      await db
        .insert(schema.project)
        .values({
          organizationId: org.orgId,
          name: 'Project',
          status: 'planned',
          statusId: org.statusId('project', 'planned'),
          description: prose,
        })
        .returning(),
    );
    const milestone = one(
      await db
        .insert(schema.milestone)
        .values({
          organizationId: org.orgId,
          projectId: project.id,
          name: 'Milestone',
          description: prose,
        })
        .returning(),
    );
    const task = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: org.orgId,
          teamId: org.teamId,
          title: 'Task',
          state: 'todo',
          statusId: org.statusId('task', 'todo'),
          description: prose,
        })
        .returning(),
    );
    const comment = one(
      await db
        .insert(schema.comment)
        .values({
          organizationId: org.orgId,
          subjectType: 'task',
          subjectId: task.id,
          body: prose,
        })
        .returning(),
    );
    const update = one(
      await db
        .insert(schema.update)
        .values({
          organizationId: org.orgId,
          subjectType: 'project',
          subjectId: project.id,
          body: prose,
        })
        .returning(),
    );
    const template = one(
      await db
        .insert(schema.template)
        .values({
          organizationId: org.orgId,
          targetType: 'task',
          name: 'Template',
          scope: 'personal',
          payload: { targetType: 'task', description: prose },
        })
        .returning(),
    );

    const rows = await createDrizzleDocumentImageReferenceStorage().subjects.listAll(org.orgId);
    expect(
      Object.fromEntries(rows.map((row) => [`${row.subjectType}:${row.subjectId}`, row.prose])),
    ).toMatchObject({
      [`task:${task.id}`]: { description: prose },
      [`project:${project.id}`]: { description: prose },
      [`program:${program.id}`]: { description: prose },
      [`initiative:${initiative.id}`]: { description: prose },
      [`team:${org.teamId}`]: { description: prose },
      [`milestone:${milestone.id}`]: { description: prose },
      [`comment:${comment.id}`]: { body: prose },
      [`update:${update.id}`]: { body: prose },
      [`template:${template.id}`]: { description: prose },
    });
  });
});
