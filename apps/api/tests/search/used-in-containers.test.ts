/**
 * Which container the "used in" column names when a task is not in a project.
 *
 * @remarks
 * The roll-up prefers the highest-altitude container a mentioning subject belongs to, and its
 * fallback chain — project, then program, then team, then nothing — is what keeps the Library's
 * work-context grouping useful instead of naming one arbitrary task. Each
 * rung matters on its own: a task filed directly under a program must not be reported as belonging
 * to its team. (The chain's final `null` arm is unreachable in practice — `task.team_id` is NOT
 * NULL, so every task has at least a team to fall back to.)
 *
 * Also covers the two arms of `mention`, which are indexed separately: a reference points either
 * at an external resource or at a Docket entity, never both.
 */
import { describe, expect, it } from 'vitest';

import {
  addMember,
  getDb,
  one,
  seedOrg,
  seedStatuses,
  seedUserWithHub,
} from '../support/routes-harness';

import { resolveUsedIn } from '../../src/search/used-in';

/** A gate that admits everything — visibility has its own tests. */
const allVisible = (_orgId: string, ids: readonly string[]): Promise<ReadonlySet<string>> =>
  Promise.resolve(new Set(ids));

/** A gate that admits nothing, standing in for a caller who may read none of the mentions. */
const noneVisible = (): Promise<ReadonlySet<string>> => Promise.resolve(new Set<string>());

/** Seed an organization with an actor, a team, and a status lookup. */
async function seedWorkspace(label: string) {
  const schema = await getDb();
  const { db } = schema;
  const userId = await seedUserWithHub(db, schema, `${label}User`);
  const orgId = await seedOrg(db, schema);
  const statusId = await seedStatuses(db, schema, orgId);
  const actorId = await addMember(db, schema, orgId, userId);
  const teamId = one(
    await db
      .insert(schema.team)
      .values({
        organizationId: orgId,
        name: `${label} Team`,
        key: `T${Math.random().toString(36).slice(2, 8)}`,
      })
      .returning({ id: schema.team.id }),
  ).id;
  return { schema, db, orgId, actorId, teamId, statusId };
}

/** Create an external resource and a mention of it authored on the given task. */
async function mentionFromTask(
  ctx: Awaited<ReturnType<typeof seedWorkspace>>,
  taskId: string,
): Promise<string> {
  const { schema, db, orgId, actorId } = ctx;
  const resourceId = one(
    await db
      .insert(schema.externalResource)
      .values({
        organizationId: orgId,
        createdBy: actorId,
        provider: 'google_drive',
        canonicalKey: `used_in_${Math.random().toString(36).slice(2, 12)}`,
        canonicalUrl: 'https://docs.google.com/document/d/used-in/edit',
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
    label: 'Reference',
  });
  return resourceId;
}

describe('the container fallback chain', () => {
  it('names the program when a task is filed under one with no project', async () => {
    const ctx = await seedWorkspace('Program');
    const { schema, db, orgId, actorId, teamId, statusId } = ctx;
    const programId = one(
      await db
        .insert(schema.program)
        .values({
          organizationId: orgId,
          name: 'Platform',
          createdBy: actorId,
          statusId: statusId('program', 'active'),
        })
        .returning({ id: schema.program.id }),
    ).id;
    const taskId = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          title: 'Program-level work',
          teamId,
          programId,
          state: 'todo',
          statusId: statusId('task', 'todo'),
        })
        .returning({ id: schema.task.id }),
    ).id;
    const resourceId = await mentionFromTask(ctx, taskId);

    const resolved = await resolveUsedIn(
      orgId,
      [{ documentId: 'doc-program', kind: 'external_resource', entityId: resourceId }],
      allVisible,
    );

    // The team is the lower rung; naming it would bury the fact that this is platform work.
    expect(resolved.get('doc-program')).toMatchObject([{ kind: 'program', id: programId }]);
  });

  it('falls back to the team when a task has neither project nor program', async () => {
    const ctx = await seedWorkspace('TeamOnly');
    const { schema, db, orgId, teamId, statusId } = ctx;
    const taskId = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          title: 'Unfiled work',
          teamId,
          state: 'todo',
          statusId: statusId('task', 'todo'),
        })
        .returning({ id: schema.task.id }),
    ).id;
    const resourceId = await mentionFromTask(ctx, taskId);

    const resolved = await resolveUsedIn(
      orgId,
      [{ documentId: 'doc-team', kind: 'external_resource', entityId: resourceId }],
      allVisible,
    );

    expect(resolved.get('doc-team')).toMatchObject([{ kind: 'team', id: teamId }]);
  });
});

describe('inputs that resolve to nothing', () => {
  it('does no work at all when asked about no documents', async () => {
    // The caller passes whatever a page rendered; an empty page must not cost a query.
    const resolved = await resolveUsedIn('org-unused', [], allVisible);
    expect(resolved.size).toBe(0);
  });

  it('reports nothing when the caller may not read the mentioning work', async () => {
    // The column is a disclosure surface: it names work by title, so an unreadable mention has to
    // vanish rather than reveal that something references the document.
    const ctx = await seedWorkspace('Hidden');
    const { schema, db, orgId, teamId, statusId } = ctx;
    const taskId = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          title: 'Private work',
          teamId,
          state: 'todo',
          statusId: statusId('task', 'todo'),
        })
        .returning({ id: schema.task.id }),
    ).id;
    const resourceId = await mentionFromTask(ctx, taskId);

    const resolved = await resolveUsedIn(
      orgId,
      [{ documentId: 'doc-hidden', kind: 'external_resource', entityId: resourceId }],
      noneVisible,
    );

    expect(resolved.get('doc-hidden') ?? []).toEqual([]);
  });

  it('reports nothing for a resource nobody has referenced', async () => {
    const ctx = await seedWorkspace('Unreferenced');
    const { schema, db, orgId, actorId } = ctx;
    const resourceId = one(
      await db
        .insert(schema.externalResource)
        .values({
          organizationId: orgId,
          createdBy: actorId,
          provider: 'google_drive',
          canonicalKey: `orphan_${Math.random().toString(36).slice(2, 12)}`,
          canonicalUrl: 'https://docs.google.com/document/d/orphan/edit',
          resourceType: 'document',
        })
        .returning({ id: schema.externalResource.id }),
    ).id;

    const resolved = await resolveUsedIn(
      orgId,
      [{ documentId: 'doc-orphan', kind: 'external_resource', entityId: resourceId }],
      allVisible,
    );

    expect(resolved.get('doc-orphan') ?? []).toEqual([]);
  });
});

describe('the entity arm of a mention', () => {
  it('resolves a reference that points at a Docket entity rather than a resource', async () => {
    // The two arms use different indexes and different columns; a target of one kind must not be
    // looked up through the other's.
    const ctx = await seedWorkspace('EntityArm');
    const { schema, db, orgId, actorId, teamId, statusId } = ctx;
    const programId = one(
      await db
        .insert(schema.program)
        .values({
          organizationId: orgId,
          name: 'Referenced program',
          createdBy: actorId,
          statusId: statusId('program', 'active'),
        })
        .returning({ id: schema.program.id }),
    ).id;
    const mentioningTask = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          title: 'Mentions a task',
          teamId,
          programId,
          state: 'todo',
          statusId: statusId('task', 'todo'),
        })
        .returning({ id: schema.task.id }),
    ).id;
    const mentionedTask = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          title: 'The mentioned task',
          teamId,
          state: 'todo',
          statusId: statusId('task', 'todo'),
        })
        .returning({ id: schema.task.id }),
    ).id;

    await db.insert(schema.mention).values({
      organizationId: orgId,
      createdBy: actorId,
      subjectType: 'task',
      subjectId: mentioningTask,
      field: 'description',
      position: 0,
      targetKind: 'entity',
      targetEntityKind: 'task',
      targetEntityId: mentionedTask,
      label: 'The mentioned task',
    });

    const resolved = await resolveUsedIn(
      orgId,
      [{ documentId: 'doc-entity', kind: 'task', entityId: mentionedTask }],
      allVisible,
    );

    expect(resolved.get('doc-entity')).toMatchObject([{ kind: 'program', id: programId }]);
  });
});
