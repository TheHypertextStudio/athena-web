/**
 * The "used in" resolver: which work each resource is referenced from.
 *
 * @remarks
 * The behaviour worth pinning is the roll-up. A resource linked from tasks must read as the
 * initiative those tasks ultimately serve, not as the task or even the project — otherwise the
 * Library's central column degrades to naming one arbitrary work item out of eleven.
 */
import { describe, expect, it } from 'vitest';

import { getDb, addMember, one, seedOrg, seedUserWithHub } from '../support/routes-harness';

import { resolveUsedIn } from '../../src/search/used-in';

describe('used-in resolution', () => {
  it('rolls a task-level mention up to the initiative that contains its project', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'UsedInRollupUser');
    const orgId = await seedOrg(db, schema);
    const actorId = await addMember(db, schema, orgId, userId);

    const teamId = one(
      await db
        .insert(schema.team)
        .values({
          organizationId: orgId,
          name: 'Rollup Team',
          key: `R${Math.random().toString(36).slice(2, 8)}`,
        })
        .returning({ id: schema.team.id }),
    ).id;
    const initiativeId = one(
      await db
        .insert(schema.initiative)
        .values({ organizationId: orgId, name: 'Q3 launch', ownerId: actorId })
        .returning({ id: schema.initiative.id }),
    ).id;
    const projectId = one(
      await db
        .insert(schema.project)
        .values({ organizationId: orgId, name: 'API surface freeze', teamId })
        .returning({ id: schema.project.id }),
    ).id;
    await db
      .insert(schema.initiativeProject)
      .values({ organizationId: orgId, initiativeId, projectId });

    const taskId = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          title: 'Cut launch candidate build',
          teamId,
          state: 'todo',
          projectId,
        })
        .returning({ id: schema.task.id }),
    ).id;

    const resourceId = one(
      await db
        .insert(schema.externalResource)
        .values({
          organizationId: orgId,
          createdBy: actorId,
          provider: 'google_drive',
          canonicalKey: `rollup_${Math.random().toString(36).slice(2, 10)}`,
          canonicalUrl: 'https://docs.google.com/document/d/rollup/edit',
          resourceType: 'document',
        })
        .returning({ id: schema.externalResource.id }),
    ).id;

    await db.insert(schema.mention).values({
      organizationId: orgId,
      createdBy: actorId,
      subjectType: 'task',
      subjectId: taskId,
      field: 'description',
      position: 0,
      targetKind: 'external',
      externalResourceId: resourceId,
      label: 'Launch plan',
    });

    const resolved = await resolveUsedIn(orgId, [
      { documentId: 'doc-1', kind: 'external_resource', entityId: resourceId },
    ]);

    // The mention was authored on a task, but the column must name the launch.
    expect(resolved.get('doc-1')).toEqual([
      { kind: 'initiative', id: initiativeId, title: 'Q3 launch' },
    ]);
  });

  it('falls back to the project when no initiative contains it', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'UsedInProjectUser');
    const orgId = await seedOrg(db, schema);
    const actorId = await addMember(db, schema, orgId, userId);

    const teamId = one(
      await db
        .insert(schema.team)
        .values({
          organizationId: orgId,
          name: 'Fallback Team',
          key: `F${Math.random().toString(36).slice(2, 8)}`,
        })
        .returning({ id: schema.team.id }),
    ).id;
    const projectId = one(
      await db
        .insert(schema.project)
        .values({ organizationId: orgId, name: 'Standalone project', teamId })
        .returning({ id: schema.project.id }),
    ).id;
    const resourceId = one(
      await db
        .insert(schema.externalResource)
        .values({
          organizationId: orgId,
          createdBy: actorId,
          provider: 'web',
          canonicalKey: `fallback_${Math.random().toString(36).slice(2, 10)}`,
          canonicalUrl: 'https://example.com/notes',
          resourceType: 'page',
        })
        .returning({ id: schema.externalResource.id }),
    ).id;

    await db.insert(schema.mention).values({
      organizationId: orgId,
      createdBy: actorId,
      subjectType: 'project',
      subjectId: projectId,
      field: 'description',
      position: 0,
      targetKind: 'external',
      externalResourceId: resourceId,
      label: 'Notes',
    });

    const resolved = await resolveUsedIn(orgId, [
      { documentId: 'doc-2', kind: 'external_resource', entityId: resourceId },
    ]);
    expect(resolved.get('doc-2')).toEqual([
      { kind: 'project', id: projectId, title: 'Standalone project' },
    ]);
  });

  it('reports nothing for a resource no prose points at', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'UsedInOrphanUser');
    const orgId = await seedOrg(db, schema);
    const actorId = await addMember(db, schema, orgId, userId);

    const resourceId = one(
      await db
        .insert(schema.externalResource)
        .values({
          organizationId: orgId,
          createdBy: actorId,
          provider: 'web',
          canonicalKey: `orphan_${Math.random().toString(36).slice(2, 10)}`,
          canonicalUrl: 'https://example.com/orphan',
          resourceType: 'page',
        })
        .returning({ id: schema.externalResource.id }),
    ).id;

    const resolved = await resolveUsedIn(orgId, [
      { documentId: 'doc-3', kind: 'external_resource', entityId: resourceId },
    ]);
    // Absence is the answer the Library renders as "Not referenced yet".
    expect(resolved.get('doc-3')).toBeUndefined();
  });
});
