/**
 * `@docket/api` — bulk task-view filter tests.
 *
 * @remarks
 * The list-time filter must preserve the same exact-target versus ancestor cascade
 * distinction as `canActor('view', …)`. These use the migrated database rather than
 * stubbing grant rows, because the column projection is the boundary this regression
 * protects.
 */
import { describe, expect, it } from 'vitest';

import { eq } from 'drizzle-orm';

import type * as DbModule from '@docket/db';

import { buildTaskViewFilter, type ViewableTaskParts } from '../../src/routes/task-helpers';
import { getDb, one, seedBaseOrg } from '../support/routes-harness';

interface PrivateTaskFixture {
  readonly schema: typeof DbModule;
  readonly orgId: string;
  readonly actorId: string;
  readonly teamId: string;
  readonly projectId: string;
  readonly programId: string;
  readonly task: ViewableTaskParts;
}

/** Seed one private task with every ancestor shape the bulk filter can traverse. */
async function seedPrivateTask(): Promise<PrivateTaskFixture> {
  const schema = await getDb();
  const { db } = schema;
  const base = await seedBaseOrg(db, schema);
  const programId = one(
    await db
      .insert(schema.program)
      .values({
        organizationId: base.orgId,
        name: 'Private program',
        statusId: base.statusId('program', 'active'),
      })
      .returning({ id: schema.program.id }),
  ).id;
  const projectId = one(
    await db
      .insert(schema.project)
      .values({
        organizationId: base.orgId,
        name: 'Private project',
        teamId: base.teamId,
        programId,
        createdBy: base.humanActorId,
        statusId: base.statusId('project', 'planned'),
      })
      .returning({ id: schema.project.id }),
  ).id;
  const task = one(
    await db
      .insert(schema.task)
      .values({
        organizationId: base.orgId,
        teamId: base.teamId,
        projectId,
        programId,
        title: 'Private task',
        state: 'todo',
        statusId: base.statusId('task', 'todo'),
        visibility: 'private',
      })
      .returning({
        id: schema.task.id,
        teamId: schema.task.teamId,
        projectId: schema.task.projectId,
        programId: schema.task.programId,
        visibility: schema.task.visibility,
      }),
  );

  return {
    schema,
    orgId: base.orgId,
    actorId: base.humanActorId,
    teamId: base.teamId,
    projectId,
    programId,
    task,
  };
}

async function grantView(
  fixture: PrivateTaskFixture,
  resourceKind: 'organization' | 'team' | 'project' | 'program' | 'task',
  resourceId: string,
  cascades: boolean,
): Promise<void> {
  await fixture.schema.db.insert(fixture.schema.grant).values({
    organizationId: fixture.orgId,
    subjectKind: 'actor',
    subjectId: fixture.actorId,
    resourceKind,
    resourceId,
    capabilities: ['view'],
    effect: 'allow',
    cascades,
  });
}

/** Update the fixture's persisted task visibility and return its filter projection. */
async function setTaskVisibility(
  fixture: PrivateTaskFixture,
  visibility: 'public' | 'private',
): Promise<ViewableTaskParts> {
  return one(
    await fixture.schema.db
      .update(fixture.schema.task)
      .set({ visibility })
      .where(eq(fixture.schema.task.id, fixture.task.id))
      .returning({
        id: fixture.schema.task.id,
        teamId: fixture.schema.task.teamId,
        projectId: fixture.schema.task.projectId,
        programId: fixture.schema.task.programId,
        visibility: fixture.schema.task.visibility,
      }),
  );
}

/** Assign the fixture actor an in-org guest role. */
async function assignGuestRole(fixture: PrivateTaskFixture): Promise<void> {
  const guest = one(
    await fixture.schema.db
      .insert(fixture.schema.role)
      .values({
        organizationId: fixture.orgId,
        key: 'guest',
        name: 'Guest',
        defaultVisibility: 'public',
      })
      .returning({ id: fixture.schema.role.id }),
  );
  await fixture.schema.db
    .update(fixture.schema.actor)
    .set({ roleId: guest.id })
    .where(eq(fixture.schema.actor.id, fixture.actorId));
}

describe('buildTaskViewFilter', () => {
  it('does not expose a private task through an allow grant with no capabilities', async () => {
    const fixture = await seedPrivateTask();
    await fixture.schema.db.insert(fixture.schema.grant).values({
      organizationId: fixture.orgId,
      subjectKind: 'actor',
      subjectId: fixture.actorId,
      resourceKind: 'task',
      resourceId: fixture.task.id,
      capabilities: [],
      effect: 'allow',
      cascades: false,
    });

    const canView = await buildTaskViewFilter(fixture.orgId, fixture.actorId);

    expect(canView(fixture.task)).toBe(false);
  });

  it('does not treat a role grant named after the actor as an actor grant', async () => {
    const fixture = await seedPrivateTask();
    await fixture.schema.db.insert(fixture.schema.grant).values({
      organizationId: fixture.orgId,
      subjectKind: 'role',
      subjectId: fixture.actorId,
      resourceKind: 'task',
      resourceId: fixture.task.id,
      capabilities: ['view'],
      effect: 'allow',
      cascades: false,
    });

    const canView = await buildTaskViewFilter(fixture.orgId, fixture.actorId);

    expect(canView(fixture.task)).toBe(false);
  });

  it('does not give an active guest the public-task baseline without a grant', async () => {
    const fixture = await seedPrivateTask();
    const publicTask = await setTaskVisibility(fixture, 'public');
    await assignGuestRole(fixture);

    const canView = await buildTaskViewFilter(fixture.orgId, fixture.actorId);

    expect(canView(publicTask)).toBe(false);
  });

  it('does not give a suspended actor the public-task baseline', async () => {
    const fixture = await seedPrivateTask();
    const publicTask = await setTaskVisibility(fixture, 'public');
    await fixture.schema.db
      .update(fixture.schema.actor)
      .set({ status: 'suspended' })
      .where(eq(fixture.schema.actor.id, fixture.actorId));

    const canView = await buildTaskViewFilter(fixture.orgId, fixture.actorId);

    expect(canView(publicTask)).toBe(false);
  });

  it('does not give an active but archived actor the public-task baseline', async () => {
    const fixture = await seedPrivateTask();
    const publicTask = await setTaskVisibility(fixture, 'public');
    await fixture.schema.db
      .update(fixture.schema.actor)
      .set({ archivedAt: new Date('2026-08-14T00:00:00.000Z') })
      .where(eq(fixture.schema.actor.id, fixture.actorId));

    const canView = await buildTaskViewFilter(fixture.orgId, fixture.actorId);

    expect(canView(publicTask)).toBe(false);
  });

  it('gives an active non-guest the public-task baseline', async () => {
    const fixture = await seedPrivateTask();
    const publicTask = await setTaskVisibility(fixture, 'public');

    const canView = await buildTaskViewFilter(fixture.orgId, fixture.actorId);

    expect(canView(publicTask)).toBe(true);
  });

  it('allows a direct non-cascading task grant', async () => {
    const fixture = await seedPrivateTask();
    await grantView(fixture, 'task', fixture.task.id, false);

    const canView = await buildTaskViewFilter(fixture.orgId, fixture.actorId);

    expect(canView(fixture.task)).toBe(true);
  });

  it.each([
    ['team', (fixture: PrivateTaskFixture) => fixture.teamId],
    ['project', (fixture: PrivateTaskFixture) => fixture.projectId],
    ['program', (fixture: PrivateTaskFixture) => fixture.programId],
    ['organization', (fixture: PrivateTaskFixture) => fixture.orgId],
  ] as const)('allows a cascading %s grant on a private descendant', async (kind, resourceId) => {
    const fixture = await seedPrivateTask();
    await grantView(fixture, kind, resourceId(fixture), true);

    const canView = await buildTaskViewFilter(fixture.orgId, fixture.actorId);

    expect(canView(fixture.task)).toBe(true);
  });

  it.each([
    ['team', (fixture: PrivateTaskFixture) => fixture.teamId],
    ['project', (fixture: PrivateTaskFixture) => fixture.projectId],
    ['program', (fixture: PrivateTaskFixture) => fixture.programId],
    ['organization', (fixture: PrivateTaskFixture) => fixture.orgId],
  ] as const)(
    'rejects a non-cascading %s grant on a private descendant',
    async (kind, resourceId) => {
      const fixture = await seedPrivateTask();
      await grantView(fixture, kind, resourceId(fixture), false);

      const canView = await buildTaskViewFilter(fixture.orgId, fixture.actorId);

      expect(canView(fixture.task)).toBe(false);
    },
  );
});
