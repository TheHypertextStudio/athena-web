/**
 * The "used in" resolver: which work each resource is referenced from.
 *
 * @remarks
 * The behaviour worth pinning is the roll-up. A resource linked from tasks must group under the
 * initiative those tasks ultimately serve, not under the task or one arbitrary project.
 */
import { describe, expect, it } from 'vitest';

import {
  getDb,
  addMember,
  one,
  seedOrg,
  seedStatuses,
  seedUserWithHub,
} from '../support/routes-harness';

import { resolveUsedIn } from '../../src/search/used-in';

/** A gate that admits everything — visibility itself is covered by its own tests. */
const allVisible = (_orgId: string, ids: readonly string[]): Promise<ReadonlySet<string>> =>
  Promise.resolve(new Set(ids));

describe('used-in resolution', () => {
  it('derives an attachment context from its host task hierarchy', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'UsedInAttachmentUser');
    const orgId = await seedOrg(db, schema);
    const statusId = await seedStatuses(db, schema, orgId);
    const actorId = await addMember(db, schema, orgId, userId);

    const teamId = one(
      await db
        .insert(schema.team)
        .values({
          organizationId: orgId,
          name: 'Attachment Team',
          key: `A${Math.random().toString(36).slice(2, 8)}`,
        })
        .returning({ id: schema.team.id }),
    ).id;
    const initiativeId = one(
      await db
        .insert(schema.initiative)
        .values({
          organizationId: orgId,
          name: 'Visible launch',
          ownerId: actorId,
          status: 'active',
          statusId: statusId('initiative', 'active'),
        })
        .returning({ id: schema.initiative.id }),
    ).id;
    const projectId = one(
      await db
        .insert(schema.project)
        .values({
          organizationId: orgId,
          name: 'Attachment host project',
          teamId,
          status: 'planned',
          statusId: statusId('project', 'planned'),
        })
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
          title: 'Attachment host task',
          teamId,
          projectId,
          state: 'todo',
          statusId: statusId('task', 'todo'),
        })
        .returning({ id: schema.task.id }),
    ).id;
    const attachmentId = one(
      await db
        .insert(schema.attachment)
        .values({
          organizationId: orgId,
          createdBy: actorId,
          subjectType: 'task',
          subjectId: taskId,
          kind: 'file',
          title: 'Launch brief.pdf',
          blobKey: 'used-in/launch-brief.pdf',
          fileName: 'Launch brief.pdf',
          mimeType: 'application/pdf',
          byteSize: 512,
        })
        .returning({ id: schema.attachment.id }),
    ).id;

    const resolved = await resolveUsedIn(
      orgId,
      [{ documentId: 'attachment-doc', kind: 'attachment', entityId: attachmentId }],
      allVisible,
    );

    expect(resolved.get('attachment-doc')).toEqual([
      { kind: 'initiative', id: initiativeId, title: 'Visible launch' },
    ]);
  });

  it('keeps every visible initiative and falls back when one initiative is hidden', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'UsedInMultiInitiativeUser');
    const orgId = await seedOrg(db, schema);
    const statusId = await seedStatuses(db, schema, orgId);
    const actorId = await addMember(db, schema, orgId, userId);
    const teamId = one(
      await db
        .insert(schema.team)
        .values({
          organizationId: orgId,
          name: 'Multi-context team',
          key: `M${Math.random().toString(36).slice(2, 8)}`,
        })
        .returning({ id: schema.team.id }),
    ).id;
    const initiatives = await db
      .insert(schema.initiative)
      .values([
        {
          organizationId: orgId,
          name: 'Hidden launch',
          ownerId: actorId,
          status: 'active',
          statusId: statusId('initiative', 'active'),
        },
        {
          organizationId: orgId,
          name: 'Visible launch',
          ownerId: actorId,
          status: 'active',
          statusId: statusId('initiative', 'active'),
        },
      ])
      .returning({ id: schema.initiative.id, name: schema.initiative.name });
    const hiddenInitiativeId = initiatives.find((row) => row.name === 'Hidden launch')?.id ?? '';
    const visibleInitiativeId = initiatives.find((row) => row.name === 'Visible launch')?.id ?? '';
    expect(hiddenInitiativeId).not.toBe('');
    expect(visibleInitiativeId).not.toBe('');
    const projectId = one(
      await db
        .insert(schema.project)
        .values({
          organizationId: orgId,
          name: 'Shared initiative project',
          teamId,
          status: 'planned',
          statusId: statusId('project', 'planned'),
        })
        .returning({ id: schema.project.id }),
    ).id;
    await db.insert(schema.initiativeProject).values([
      { organizationId: orgId, initiativeId: hiddenInitiativeId, projectId },
      { organizationId: orgId, initiativeId: visibleInitiativeId, projectId },
    ]);
    const taskId = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          title: 'Shared initiative task',
          teamId,
          projectId,
          state: 'todo',
          statusId: statusId('task', 'todo'),
        })
        .returning({ id: schema.task.id }),
    ).id;
    const attachmentId = one(
      await db
        .insert(schema.attachment)
        .values({
          organizationId: orgId,
          createdBy: actorId,
          subjectType: 'task',
          subjectId: taskId,
          kind: 'url',
          title: 'Shared plan',
          url: 'https://example.com/shared-plan',
        })
        .returning({ id: schema.attachment.id }),
    ).id;
    const target = [
      { documentId: 'multi-attachment-doc', kind: 'attachment' as const, entityId: attachmentId },
    ];

    const all = await resolveUsedIn(orgId, target, allVisible);
    expect(all.get('multi-attachment-doc')).toHaveLength(2);
    expect(all.get('multi-attachment-doc')).toEqual(
      expect.arrayContaining([
        { kind: 'initiative', id: hiddenInitiativeId, title: 'Hidden launch' },
        { kind: 'initiative', id: visibleInitiativeId, title: 'Visible launch' },
      ]),
    );

    const hideOneInitiative = (_organizationId: string, ids: readonly string[]) =>
      Promise.resolve(new Set(ids.filter((id) => id !== hiddenInitiativeId)));
    const visible = await resolveUsedIn(orgId, target, hideOneInitiative);
    expect(visible.get('multi-attachment-doc')).toEqual([
      { kind: 'initiative', id: visibleInitiativeId, title: 'Visible launch' },
    ]);
  });

  it('does not expose an attachment host hierarchy when its host is hidden', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'UsedInHiddenAttachmentUser');
    const orgId = await seedOrg(db, schema);
    const statusId = await seedStatuses(db, schema, orgId);
    const actorId = await addMember(db, schema, orgId, userId);
    const teamId = one(
      await db
        .insert(schema.team)
        .values({
          organizationId: orgId,
          name: 'Hidden attachment team',
          key: `X${Math.random().toString(36).slice(2, 8)}`,
        })
        .returning({ id: schema.team.id }),
    ).id;
    const projectId = one(
      await db
        .insert(schema.project)
        .values({
          organizationId: orgId,
          name: 'Hidden attachment project',
          teamId,
          status: 'planned',
          statusId: statusId('project', 'planned'),
        })
        .returning({ id: schema.project.id }),
    ).id;
    const taskId = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          title: 'Hidden attachment host',
          teamId,
          projectId,
          state: 'todo',
          statusId: statusId('task', 'todo'),
        })
        .returning({ id: schema.task.id }),
    ).id;
    const attachmentId = one(
      await db
        .insert(schema.attachment)
        .values({
          organizationId: orgId,
          createdBy: actorId,
          subjectType: 'task',
          subjectId: taskId,
          kind: 'url',
          title: 'Hidden plan',
          url: 'https://example.com/hidden-plan',
        })
        .returning({ id: schema.attachment.id }),
    ).id;
    const hideHost = (_organizationId: string, ids: readonly string[]) =>
      Promise.resolve(new Set(ids.filter((id) => id !== taskId)));

    const resolved = await resolveUsedIn(
      orgId,
      [{ documentId: 'hidden-attachment-doc', kind: 'attachment', entityId: attachmentId }],
      hideHost,
    );

    expect(resolved.get('hidden-attachment-doc')).toBeUndefined();
  });

  it('rolls a task-level mention up to the initiative that contains its project', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'UsedInRollupUser');
    const orgId = await seedOrg(db, schema);
    const statusId = await seedStatuses(db, schema, orgId);
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
        .values({
          organizationId: orgId,
          name: 'Q3 launch',
          ownerId: actorId,
          status: 'active',
          statusId: statusId('initiative', 'active'),
        })
        .returning({ id: schema.initiative.id }),
    ).id;
    const projectId = one(
      await db
        .insert(schema.project)
        .values({
          organizationId: orgId,
          name: 'API surface freeze',
          teamId,
          status: 'planned',
          statusId: statusId('project', 'planned'),
        })
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
          statusId: statusId('task', 'todo'),
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

    const resolved = await resolveUsedIn(
      orgId,
      [{ documentId: 'doc-1', kind: 'external_resource', entityId: resourceId }],
      allVisible,
    );

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
    const statusId = await seedStatuses(db, schema, orgId);
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
        .values({
          organizationId: orgId,
          name: 'Standalone project',
          teamId,
          status: 'planned',
          statusId: statusId('project', 'planned'),
        })
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

    const resolved = await resolveUsedIn(
      orgId,
      [{ documentId: 'doc-2', kind: 'external_resource', entityId: resourceId }],
      allVisible,
    );
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

    const resolved = await resolveUsedIn(
      orgId,
      [{ documentId: 'doc-3', kind: 'external_resource', entityId: resourceId }],
      allVisible,
    );
    // Absence is the answer the Library renders as "Unreferenced".
    expect(resolved.get('doc-3')).toBeUndefined();
  });

  it('drops a mention whose subject the caller cannot see', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'UsedInHiddenSubjectUser');
    const orgId = await seedOrg(db, schema);
    const statusId = await seedStatuses(db, schema, orgId);
    const actorId = await addMember(db, schema, orgId, userId);

    const teamId = one(
      await db
        .insert(schema.team)
        .values({
          organizationId: orgId,
          name: 'Hidden Team',
          key: `H${Math.random().toString(36).slice(2, 8)}`,
        })
        .returning({ id: schema.team.id }),
    ).id;
    const projectId = one(
      await db
        .insert(schema.project)
        .values({
          organizationId: orgId,
          name: 'Confidential project',
          teamId,
          status: 'planned',
          statusId: statusId('project', 'planned'),
        })
        .returning({ id: schema.project.id }),
    ).id;
    const resourceId = one(
      await db
        .insert(schema.externalResource)
        .values({
          organizationId: orgId,
          createdBy: actorId,
          provider: 'web',
          canonicalKey: `hidden_${Math.random().toString(36).slice(2, 10)}`,
          canonicalUrl: 'https://example.com/confidential',
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
      label: 'Confidential',
    });

    // The gate reports the subject as invisible, so neither the reference nor the container's
    // name may reach the column — a private project must not be named by what it links to.
    const noneVisible = (): Promise<ReadonlySet<string>> => Promise.resolve(new Set<string>());
    const resolved = await resolveUsedIn(
      orgId,
      [{ documentId: 'doc-hidden', kind: 'external_resource', entityId: resourceId }],
      noneVisible,
    );
    expect(resolved.get('doc-hidden')).toBeUndefined();
  });
});
