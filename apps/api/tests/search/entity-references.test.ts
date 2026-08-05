/**
 * Backlinks: what references a thing, rather than what it references.
 *
 * @remarks
 * The index for this existed since MENTIONS-001 with no endpoint over it. The two behaviours worth
 * pinning are that both mention arms resolve — external resources and Docket entities — and that a
 * referencing record the caller cannot see is omitted rather than counted, because a backlink
 * panel that leaks a private title is worse than one that under-reports.
 */
import { describe, expect, it } from 'vitest';

import { getDb, addMember, one, seedOrg, seedUserWithHub } from '../support/routes-harness';

import { loadInboundReferences } from '../../src/content/entity-references';

describe('inbound references', () => {
  it('lists the records whose prose points at an external resource', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'BacklinkUser');
    const orgId = await seedOrg(db, schema);
    const actorId = await addMember(db, schema, orgId, userId);

    const teamId = one(
      await db
        .insert(schema.team)
        .values({
          organizationId: orgId,
          name: 'Backlink Team',
          key: `B${Math.random().toString(36).slice(2, 8)}`,
        })
        .returning({ id: schema.team.id }),
    ).id;
    const taskId = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          title: 'Freeze the response shapes',
          teamId,
          state: 'todo',
          visibility: 'public',
        })
        .returning({ id: schema.task.id }),
    ).id;
    const resourceId = one(
      await db
        .insert(schema.externalResource)
        .values({
          organizationId: orgId,
          createdBy: actorId,
          provider: 'web',
          canonicalKey: `backlink_${Math.random().toString(36).slice(2, 10)}`,
          canonicalUrl: 'https://example.com/spec',
          resourceType: 'page',
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
      label: 'The spec',
    });

    // The projection is what supplies the title and href, so the subject must be indexed.
    await db.insert(schema.searchDocument).values({
      id: `task:${orgId}:${taskId}`,
      organizationId: orgId,
      kind: 'task',
      family: 'work',
      sourceTable: 'task',
      entityId: taskId,
      title: 'Freeze the response shapes',
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

    const result = await loadInboundReferences({
      caller: { kind: 'user', userId },
      orgId,
      targetKind: 'external_resource',
      targetId: resourceId,
    });

    expect(result.total).toBe(1);
    expect(result.groups).toEqual([
      {
        subjectType: 'task',
        items: [
          {
            subjectType: 'task',
            subjectId: taskId,
            title: 'Freeze the response shapes',
            href: `/orgs/${orgId}/tasks/${taskId}`,
          },
        ],
      },
    ]);
  });

  it('omits a referencing record the caller cannot see', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'BacklinkHiddenUser');
    const ownerId = await seedUserWithHub(db, schema, 'BacklinkHiddenOwner');
    const orgId = await seedOrg(db, schema);
    const actorId = await addMember(db, schema, orgId, userId);
    await addMember(db, schema, orgId, ownerId);

    const resourceId = one(
      await db
        .insert(schema.externalResource)
        .values({
          organizationId: orgId,
          createdBy: actorId,
          provider: 'web',
          canonicalKey: `hidden_${Math.random().toString(36).slice(2, 10)}`,
          canonicalUrl: 'https://example.com/private-ref',
          resourceType: 'page',
        })
        .returning({ id: schema.externalResource.id }),
    ).id;

    const hiddenSubjectId = `hidden_subject_${Math.random().toString(36).slice(2, 10)}`;
    await db.insert(schema.mention).values({
      organizationId: orgId,
      createdBy: actorId,
      subjectType: 'task',
      subjectId: hiddenSubjectId,
      field: 'description',
      position: 0,
      targetKind: 'external',
      externalResourceId: resourceId,
      label: 'Private mention',
    });
    await db.insert(schema.searchDocument).values({
      id: `task:${orgId}:${hiddenSubjectId}`,
      organizationId: orgId,
      userId: ownerId,
      kind: 'task',
      family: 'work',
      sourceTable: 'task',
      entityId: hiddenSubjectId,
      title: 'Someone else’s private note',
      facet: {},
      route: {
        type: 'entity',
        organizationId: orgId,
        entityKind: 'task',
        entityId: hiddenSubjectId,
        href: `/orgs/${orgId}/tasks/${hiddenSubjectId}`,
      },
      visibility: { mode: 'user_private' },
      baseRank: 100,
    });

    const result = await loadInboundReferences({
      caller: { kind: 'user', userId },
      orgId,
      targetKind: 'external_resource',
      targetId: resourceId,
    });

    // Under-reporting is correct here; leaking the title is not.
    expect(result.total).toBe(0);
    expect(result.groups).toEqual([]);
  });

  it('returns nothing for a target nothing points at', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'BacklinkEmptyUser');
    const orgId = await seedOrg(db, schema);
    await addMember(db, schema, orgId, userId);

    const result = await loadInboundReferences({
      caller: { kind: 'user', userId },
      orgId,
      targetKind: 'external_resource',
      targetId: 'does_not_exist',
    });
    expect(result).toEqual({ total: 0, groups: [] });
  });
});
