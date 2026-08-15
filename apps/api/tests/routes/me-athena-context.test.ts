/**
 * `@docket/api` — direct unit coverage for the invocation-context resolvers in
 * `src/routes/me-athena-context.ts`.
 *
 * @remarks
 * Exercised directly (not through the HTTP surface) because every branch here turns on a
 * specific source kind or a specific authorization edge, and driving each one through a full
 * session/activity HTTP round trip would multiply the fixture setup without adding assurance
 * beyond what `me-athena.test.ts` already covers for the one source kind ('project') it uses.
 */
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type * as AuthzModule from '@docket/authz';
import type * as DbModule from '@docket/db';

import { NotFoundError } from '../../src/error';
import type {
  activeAthenaActor as ActiveAthenaActor,
  resolveAthenaDisplay as ResolveAthenaDisplay,
  resolveAthenaDisplays as ResolveAthenaDisplays,
  resolveAthenaInvocation as ResolveAthenaInvocation,
} from '../../src/routes/me-athena-context';
import { getDb, one, seedStatuses } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let authz!: typeof AuthzModule;
let resolveAthenaInvocation!: typeof ResolveAthenaInvocation;
let resolveAthenaDisplay!: typeof ResolveAthenaDisplay;
let resolveAthenaDisplays!: typeof ResolveAthenaDisplays;
let activeAthenaActor!: typeof ActiveAthenaActor;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  authz = await import('@docket/authz');
  ({ resolveAthenaInvocation, resolveAthenaDisplay, resolveAthenaDisplays, activeAthenaActor } =
    await import('../../src/routes/me-athena-context'));
});

afterEach(() => {
  vi.restoreAllMocks();
});

interface Fixture {
  readonly orgId: string;
  readonly otherOrgId: string;
  readonly teamId: string;
  readonly userId: string;
  readonly actorId: string;
  readonly roleId: string;
  readonly taskId: string;
  readonly projectId: string;
  readonly initiativeId: string;
  readonly programId: string;
  /** A task with no project/program lineage — the batched-ancestor optional branches' other side. */
  readonly bareTaskId: string;
  /** A project with no team/program lineage — ditto. */
  readonly bareProjectId: string;
}

/** Seed one workspace with a fully-authorized human actor and one of every work-source kind. */
async function seed(): Promise<Fixture> {
  const suffix = Math.random().toString(36).slice(2, 9);
  const org = one(
    await db
      .insert(schema.organization)
      .values({ name: `Ctx-${suffix}`, slug: `ctx-${suffix}`, lifecycleState: 'active' })
      .returning({ id: schema.organization.id }),
  );
  const otherOrg = one(
    await db
      .insert(schema.organization)
      .values({ name: `CtxOther-${suffix}`, slug: `ctx-other-${suffix}`, lifecycleState: 'active' })
      .returning({ id: schema.organization.id }),
  );
  const statusId = await seedStatuses(db, schema, org.id);
  const team = one(
    await db
      .insert(schema.team)
      .values({ organizationId: org.id, name: 'Core', key: `C${suffix.slice(-3)}` })
      .returning({ id: schema.team.id }),
  );
  const user = one(
    await db
      .insert(schema.user)
      .values({ name: 'Ctx Owner', email: `ctx-${suffix}@example.com` })
      .returning({ id: schema.user.id }),
  );
  await db.insert(schema.hub).values({ userId: user.id });
  const role = one(
    await db
      .insert(schema.role)
      .values({
        organizationId: org.id,
        key: `ctx-role-${suffix}`,
        name: 'Member',
        capabilities: ['view', 'contribute'],
      })
      .returning({ id: schema.role.id }),
  );
  const actor = one(
    await db
      .insert(schema.actor)
      .values({
        organizationId: org.id,
        kind: 'human',
        displayName: 'Ctx Owner',
        userId: user.id,
        roleId: role.id,
      })
      .returning({ id: schema.actor.id }),
  );
  await db.insert(schema.grant).values({
    organizationId: org.id,
    subjectKind: 'role',
    subjectId: role.id,
    resourceKind: 'organization',
    resourceId: org.id,
    capabilities: ['view', 'contribute'],
    effect: 'allow',
  });
  const program = one(
    await db
      .insert(schema.program)
      .values({
        organizationId: org.id,
        name: 'Growth',
        ownerId: actor.id,
        status: 'active',
        statusId: statusId('program', 'active'),
      })
      .returning({ id: schema.program.id }),
  );
  // Full ancestry (team + program) so batchedWorkSources' optional-ancestor branches run for
  // both a task and a project, not just their required fields.
  const project = one(
    await db
      .insert(schema.project)
      .values({
        organizationId: org.id,
        name: 'Launch',
        status: 'active',
        statusId: statusId('project', 'active'),
        createdBy: actor.id,
        teamId: team.id,
        programId: program.id,
      })
      .returning({ id: schema.project.id }),
  );
  const task = one(
    await db
      .insert(schema.task)
      .values({
        organizationId: org.id,
        teamId: team.id,
        title: 'Ship the release',
        state: 'todo',
        statusId: statusId('task', 'todo'),
        createdBy: actor.id,
        projectId: project.id,
        programId: program.id,
      })
      .returning({ id: schema.task.id }),
  );
  const initiative = one(
    await db
      .insert(schema.initiative)
      .values({
        organizationId: org.id,
        name: 'Portfolio theme',
        ownerId: actor.id,
        status: 'active',
        statusId: statusId('initiative', 'active'),
      })
      .returning({ id: schema.initiative.id }),
  );
  const bareTask = one(
    await db
      .insert(schema.task)
      .values({
        organizationId: org.id,
        teamId: team.id,
        title: 'Bare task',
        state: 'todo',
        statusId: statusId('task', 'todo'),
        createdBy: actor.id,
      })
      .returning({ id: schema.task.id }),
  );
  const bareProject = one(
    await db
      .insert(schema.project)
      .values({
        organizationId: org.id,
        name: 'Bare project',
        status: 'active',
        statusId: statusId('project', 'active'),
        createdBy: actor.id,
      })
      .returning({ id: schema.project.id }),
  );
  return {
    orgId: org.id,
    otherOrgId: otherOrg.id,
    teamId: team.id,
    userId: user.id,
    actorId: actor.id,
    roleId: role.id,
    taskId: task.id,
    projectId: project.id,
    initiativeId: initiative.id,
    programId: program.id,
    bareTaskId: bareTask.id,
    bareProjectId: bareProject.id,
  };
}

describe('resolveAthenaInvocation', () => {
  it('returns a neutral invocation when no input is given', async () => {
    const fixture = await seed();
    expect(await resolveAthenaInvocation(fixture.userId, undefined)).toEqual({
      context: null,
      actorId: null,
    });
  });

  it('returns a neutral invocation for an input with neither workspace nor source', async () => {
    const fixture = await seed();
    expect(await resolveAthenaInvocation(fixture.userId, {})).toEqual({
      context: null,
      actorId: null,
    });
  });

  it('resolves a bare workspace focus to the caller’s active actor', async () => {
    const fixture = await seed();
    const resolved = await resolveAthenaInvocation(fixture.userId, { workspaceId: fixture.orgId });
    expect(resolved).toEqual({ context: { workspaceId: fixture.orgId }, actorId: fixture.actorId });
  });

  it('refuses a bare workspace focus where the caller has no active actor', async () => {
    const fixture = await seed();
    await expect(
      resolveAthenaInvocation(fixture.userId, { workspaceId: fixture.otherOrgId }),
    ).rejects.toThrow(NotFoundError);
  });

  it('resolves a task source to its workspace and the caller’s actor', async () => {
    const fixture = await seed();
    const resolved = await resolveAthenaInvocation(fixture.userId, {
      source: { type: 'task', id: fixture.taskId },
    });
    expect(resolved).toEqual({
      context: { workspaceId: fixture.orgId, source: { type: 'task', id: fixture.taskId } },
      actorId: fixture.actorId,
    });
  });

  it('resolves an initiative source to its workspace and the caller’s actor', async () => {
    const fixture = await seed();
    const resolved = await resolveAthenaInvocation(fixture.userId, {
      source: { type: 'initiative', id: fixture.initiativeId },
    });
    expect(resolved).toEqual({
      context: {
        workspaceId: fixture.orgId,
        source: { type: 'initiative', id: fixture.initiativeId },
      },
      actorId: fixture.actorId,
    });
  });

  it('resolves a program source to its workspace and the caller’s actor', async () => {
    const fixture = await seed();
    const resolved = await resolveAthenaInvocation(fixture.userId, {
      source: { type: 'program', id: fixture.programId },
    });
    expect(resolved).toEqual({
      context: { workspaceId: fixture.orgId, source: { type: 'program', id: fixture.programId } },
      actorId: fixture.actorId,
    });
  });

  it('hides an archived work source', async () => {
    const fixture = await seed();
    await db
      .update(schema.task)
      .set({ archivedAt: new Date() })
      .where(eq(schema.task.id, fixture.taskId));
    await expect(
      resolveAthenaInvocation(fixture.userId, { source: { type: 'task', id: fixture.taskId } }),
    ).rejects.toThrow(NotFoundError);
  });

  it('hides a work source the caller cannot view', async () => {
    const fixture = await seed();
    await db.delete(schema.grant).where(eq(schema.grant.organizationId, fixture.orgId));
    await expect(
      resolveAthenaInvocation(fixture.userId, {
        source: { type: 'project', id: fixture.projectId },
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it('hides a source whose stated workspace does not match its resolved workspace', async () => {
    const fixture = await seed();
    await expect(
      resolveAthenaInvocation(fixture.userId, {
        workspaceId: fixture.otherOrgId,
        source: { type: 'task', id: fixture.taskId },
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it('resolves a calendar item through its task-linked workspace', async () => {
    const fixture = await seed();
    const layer = one(
      await db
        .insert(schema.calendarLayer)
        .values({ userId: fixture.userId, sourceKind: 'personal', title: 'Mine' })
        .returning({ id: schema.calendarLayer.id }),
    );
    const item = one(
      await db
        .insert(schema.calendarItem)
        .values({ userId: fixture.userId, layerId: layer.id, kind: 'block', title: 'Focus time' })
        .returning({ id: schema.calendarItem.id }),
    );
    await db.insert(schema.calendarItemTaskLink).values({
      calendarItemId: item.id,
      taskId: fixture.taskId,
      organizationId: fixture.orgId,
      createdBy: fixture.actorId,
    });
    const resolved = await resolveAthenaInvocation(fixture.userId, {
      source: { type: 'calendar_item', id: item.id },
    });
    expect(resolved).toEqual({
      context: { workspaceId: fixture.orgId, source: { type: 'calendar_item', id: item.id } },
      actorId: fixture.actorId,
    });
  });

  it('resolves a calendar item through a shared layer when the workspace is stated', async () => {
    const fixture = await seed();
    const layer = one(
      await db
        .insert(schema.calendarLayer)
        .values({ userId: fixture.userId, sourceKind: 'personal', title: 'Mine' })
        .returning({ id: schema.calendarLayer.id }),
    );
    const item = one(
      await db
        .insert(schema.calendarItem)
        .values({
          userId: fixture.userId,
          layerId: layer.id,
          kind: 'block',
          title: 'Shared review',
        })
        .returning({ id: schema.calendarItem.id }),
    );
    await db.insert(schema.calendarLayerShare).values({
      layerId: layer.id,
      organizationId: fixture.orgId,
      access: 'details',
      createdBy: fixture.actorId,
    });
    const resolved = await resolveAthenaInvocation(fixture.userId, {
      workspaceId: fixture.orgId,
      source: { type: 'calendar_item', id: item.id },
    });
    expect(resolved.context).toEqual({
      workspaceId: fixture.orgId,
      source: { type: 'calendar_item', id: item.id },
    });
  });

  it('hides an ambiguous calendar item shared to two workspaces with no stated workspace', async () => {
    const fixture = await seed();
    const layer = one(
      await db
        .insert(schema.calendarLayer)
        .values({ userId: fixture.userId, sourceKind: 'personal', title: 'Mine' })
        .returning({ id: schema.calendarLayer.id }),
    );
    const item = one(
      await db
        .insert(schema.calendarItem)
        .values({ userId: fixture.userId, layerId: layer.id, kind: 'block', title: 'Ambiguous' })
        .returning({ id: schema.calendarItem.id }),
    );
    await db.insert(schema.calendarLayerShare).values([
      {
        layerId: layer.id,
        organizationId: fixture.orgId,
        access: 'details',
        createdBy: fixture.actorId,
      },
      {
        layerId: layer.id,
        organizationId: fixture.otherOrgId,
        access: 'details',
        createdBy: fixture.actorId,
      },
    ]);
    await expect(
      resolveAthenaInvocation(fixture.userId, { source: { type: 'calendar_item', id: item.id } }),
    ).rejects.toThrow(NotFoundError);
  });

  it('hides a calendar item whose stated workspace is not among its candidates', async () => {
    const fixture = await seed();
    const layer = one(
      await db
        .insert(schema.calendarLayer)
        .values({ userId: fixture.userId, sourceKind: 'personal', title: 'Mine' })
        .returning({ id: schema.calendarLayer.id }),
    );
    const item = one(
      await db
        .insert(schema.calendarItem)
        .values({ userId: fixture.userId, layerId: layer.id, kind: 'block', title: 'Unshared' })
        .returning({ id: schema.calendarItem.id }),
    );
    await db.insert(schema.calendarLayerShare).values({
      layerId: layer.id,
      organizationId: fixture.orgId,
      access: 'details',
      createdBy: fixture.actorId,
    });
    await expect(
      resolveAthenaInvocation(fixture.userId, {
        workspaceId: fixture.otherOrgId,
        source: { type: 'calendar_item', id: item.id },
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it('hides a calendar item not owned by the caller', async () => {
    const fixture = await seed();
    const stranger = one(
      await db
        .insert(schema.user)
        .values({
          name: 'Stranger',
          email: `stranger-${Math.random().toString(36).slice(2)}@x.test`,
        })
        .returning({ id: schema.user.id }),
    );
    const layer = one(
      await db
        .insert(schema.calendarLayer)
        .values({ userId: stranger.id, sourceKind: 'personal', title: 'Theirs' })
        .returning({ id: schema.calendarLayer.id }),
    );
    const item = one(
      await db
        .insert(schema.calendarItem)
        .values({ userId: stranger.id, layerId: layer.id, kind: 'block', title: 'Not yours' })
        .returning({ id: schema.calendarItem.id }),
    );
    await expect(
      resolveAthenaInvocation(fixture.userId, { source: { type: 'calendar_item', id: item.id } }),
    ).rejects.toThrow(NotFoundError);
  });

  it('resolves a Stream event the caller owns', async () => {
    const fixture = await seed();
    const evt = one(
      await db
        .insert(schema.event)
        .values({
          organizationId: fixture.orgId,
          userId: fixture.userId,
          createdBy: fixture.actorId,
          sourceSystem: 'docket',
          kind: 'comment',
          occurredAt: new Date(),
          title: 'Owned event',
          entityKind: 'work_item',
          dedupeKey: `ctx-owned-${Math.random().toString(36).slice(2)}`,
        })
        .returning({ id: schema.event.id }),
    );
    const resolved = await resolveAthenaInvocation(fixture.userId, {
      source: { type: 'stream_event', id: evt.id },
    });
    expect(resolved).toEqual({
      context: { workspaceId: fixture.orgId, source: { type: 'stream_event', id: evt.id } },
      actorId: fixture.actorId,
    });
  });

  it('resolves a Stream event the caller is only a recipient of', async () => {
    const fixture = await seed();
    const otherUser = one(
      await db
        .insert(schema.user)
        .values({ name: 'Author', email: `author-${Math.random().toString(36).slice(2)}@x.test` })
        .returning({ id: schema.user.id }),
    );
    const evt = one(
      await db
        .insert(schema.event)
        .values({
          organizationId: fixture.orgId,
          userId: otherUser.id,
          createdBy: fixture.actorId,
          sourceSystem: 'docket',
          kind: 'mention',
          occurredAt: new Date(),
          title: 'Mentioned event',
          entityKind: 'work_item',
          dedupeKey: `ctx-recipient-${Math.random().toString(36).slice(2)}`,
        })
        .returning({ id: schema.event.id }),
    );
    await db.insert(schema.eventRecipient).values({
      eventId: evt.id,
      userId: fixture.userId,
      organizationId: fixture.orgId,
      occurredAt: new Date(),
      reason: 'mention',
    });
    const resolved = await resolveAthenaInvocation(fixture.userId, {
      source: { type: 'stream_event', id: evt.id },
    });
    expect(resolved.context).toEqual({
      workspaceId: fixture.orgId,
      source: { type: 'stream_event', id: evt.id },
    });
  });

  it('hides a Stream event that does not concern the caller', async () => {
    const fixture = await seed();
    const otherUser = one(
      await db
        .insert(schema.user)
        .values({ name: 'Author', email: `author2-${Math.random().toString(36).slice(2)}@x.test` })
        .returning({ id: schema.user.id }),
    );
    const evt = one(
      await db
        .insert(schema.event)
        .values({
          organizationId: fixture.orgId,
          userId: otherUser.id,
          createdBy: fixture.actorId,
          sourceSystem: 'docket',
          kind: 'comment',
          occurredAt: new Date(),
          title: 'Not yours',
          entityKind: 'work_item',
          dedupeKey: `ctx-hidden-${Math.random().toString(36).slice(2)}`,
        })
        .returning({ id: schema.event.id }),
    );
    await expect(
      resolveAthenaInvocation(fixture.userId, { source: { type: 'stream_event', id: evt.id } }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe('activeAthenaActor', () => {
  it('refuses a workspace where the caller has no active human actor', async () => {
    const fixture = await seed();
    await expect(activeAthenaActor(fixture.userId, fixture.otherOrgId)).rejects.toThrow(
      NotFoundError,
    );
  });

  it('refuses a workspace where the caller’s actor has been suspended', async () => {
    const fixture = await seed();
    await db
      .update(schema.actor)
      .set({ status: 'suspended' })
      .where(eq(schema.actor.id, fixture.actorId));
    await expect(activeAthenaActor(fixture.userId, fixture.orgId)).rejects.toThrow(NotFoundError);
  });
});

describe('resolveAthenaDisplay', () => {
  it('returns a null context and workspace for a null input', async () => {
    const fixture = await seed();
    expect(await resolveAthenaDisplay(fixture.userId, null)).toEqual({
      context: null,
      workspace: null,
    });
  });

  it('resolves canonical labels for a currently accessible task source', async () => {
    const fixture = await seed();
    const display = await resolveAthenaDisplay(fixture.userId, {
      workspaceId: fixture.orgId,
      source: { type: 'task', id: fixture.taskId },
    });
    expect(display.workspace).toMatchObject({ id: fixture.orgId });
    expect(display.context).toEqual({
      workspaceId: fixture.orgId,
      source: { type: 'task', id: fixture.taskId, label: 'Ship the release' },
    });
  });

  it('resolves canonical labels for a currently accessible calendar item source', async () => {
    const fixture = await seed();
    const layer = one(
      await db
        .insert(schema.calendarLayer)
        .values({ userId: fixture.userId, sourceKind: 'personal', title: 'Mine' })
        .returning({ id: schema.calendarLayer.id }),
    );
    const item = one(
      await db
        .insert(schema.calendarItem)
        .values({
          userId: fixture.userId,
          layerId: layer.id,
          kind: 'block',
          title: 'Singular deep work',
        })
        .returning({ id: schema.calendarItem.id }),
    );
    await db.insert(schema.calendarItemTaskLink).values({
      calendarItemId: item.id,
      taskId: fixture.taskId,
      organizationId: fixture.orgId,
      createdBy: fixture.actorId,
    });
    const display = await resolveAthenaDisplay(fixture.userId, {
      source: { type: 'calendar_item', id: item.id },
    });
    expect(display.workspace).toMatchObject({ id: fixture.orgId });
    expect(display.context).toEqual({
      workspaceId: fixture.orgId,
      source: { type: 'calendar_item', id: item.id, label: 'Singular deep work' },
    });
  });

  it('resolves canonical labels for a currently accessible Stream event source', async () => {
    const fixture = await seed();
    const evt = one(
      await db
        .insert(schema.event)
        .values({
          organizationId: fixture.orgId,
          userId: fixture.userId,
          createdBy: fixture.actorId,
          sourceSystem: 'docket',
          kind: 'comment',
          occurredAt: new Date(),
          title: 'Singular stream event',
          entityKind: 'work_item',
          dedupeKey: `ctx-singular-stream-${Math.random().toString(36).slice(2)}`,
        })
        .returning({ id: schema.event.id }),
    );
    const display = await resolveAthenaDisplay(fixture.userId, {
      source: { type: 'stream_event', id: evt.id },
    });
    expect(display.workspace).toMatchObject({ id: fixture.orgId });
    expect(display.context).toEqual({
      workspaceId: fixture.orgId,
      source: { type: 'stream_event', id: evt.id, label: 'Singular stream event' },
    });
  });

  it('resolves a bare workspace focus without a source', async () => {
    const fixture = await seed();
    const display = await resolveAthenaDisplay(fixture.userId, { workspaceId: fixture.orgId });
    expect(display.workspace).toMatchObject({ id: fixture.orgId });
    expect(display.context).toEqual({ workspaceId: fixture.orgId });
  });

  it('resolves canonical labels for a currently accessible project source', async () => {
    const fixture = await seed();
    const display = await resolveAthenaDisplay(fixture.userId, {
      source: { type: 'project', id: fixture.projectId },
    });
    expect(display.context).toEqual({
      workspaceId: fixture.orgId,
      source: { type: 'project', id: fixture.projectId, label: 'Launch' },
    });
  });

  it('resolves canonical labels for a currently accessible initiative source', async () => {
    const fixture = await seed();
    const display = await resolveAthenaDisplay(fixture.userId, {
      source: { type: 'initiative', id: fixture.initiativeId },
    });
    expect(display.context).toEqual({
      workspaceId: fixture.orgId,
      source: { type: 'initiative', id: fixture.initiativeId, label: 'Portfolio theme' },
    });
  });

  it('resolves canonical labels for a currently accessible program source', async () => {
    const fixture = await seed();
    const display = await resolveAthenaDisplay(fixture.userId, {
      source: { type: 'program', id: fixture.programId },
    });
    expect(display.context).toEqual({
      workspaceId: fixture.orgId,
      source: { type: 'program', id: fixture.programId, label: 'Growth' },
    });
  });

  it('falls back to a source-less historical context for a bare unauthorized workspace', async () => {
    const fixture = await seed();
    const display = await resolveAthenaDisplay(fixture.userId, { workspaceId: fixture.otherOrgId });
    expect(display).toEqual({ context: { workspaceId: fixture.otherOrgId }, workspace: null });
  });

  it('falls back to a generic historical label once source access is revoked', async () => {
    const fixture = await seed();
    await db.delete(schema.grant).where(eq(schema.grant.organizationId, fixture.orgId));
    const display = await resolveAthenaDisplay(fixture.userId, {
      workspaceId: fixture.orgId,
      source: { type: 'project', id: fixture.projectId },
    });
    expect(display.workspace).toBeNull();
    expect(display.context).toEqual({
      workspaceId: fixture.orgId,
      source: { type: 'project', id: fixture.projectId, label: 'Project' },
    });
  });

  it('drops workspace metadata once the organization itself is archived', async () => {
    const fixture = await seed();
    await db
      .update(schema.organization)
      .set({ archivedAt: new Date() })
      .where(eq(schema.organization.id, fixture.orgId));
    const display = await resolveAthenaDisplay(fixture.userId, { workspaceId: fixture.orgId });
    expect(display).toEqual({
      context: { workspaceId: fixture.orgId },
      workspace: null,
    });
  });

  it('returns a null context for an input naming neither a workspace nor a source', async () => {
    const fixture = await seed();
    // A non-null but empty invocation context — distinct from the `input === null` case above:
    // `resolveAthenaInvocation` itself resolves this to a null context without throwing.
    expect(await resolveAthenaDisplay(fixture.userId, {})).toEqual({
      context: null,
      workspace: null,
    });
  });

  it('redacts a source revoked strictly between resolution and the disclosure re-check', async () => {
    const fixture = await seed();
    const originalCanActor = authz.canActor;
    let calls = 0;
    vi.spyOn(authz, 'canActor').mockImplementation(async (actorId, required, target, database) => {
      calls += 1;
      const result = await originalCanActor(actorId, required, target, database);
      if (calls === 1) {
        // Access is revoked strictly after the first (successful) authorization check but
        // before the disclosure boundary re-check runs its own second check.
        await db
          .update(schema.actor)
          .set({ status: 'suspended' })
          .where(eq(schema.actor.id, fixture.actorId));
      }
      return result;
    });

    const display = await resolveAthenaDisplay(fixture.userId, {
      workspaceId: fixture.orgId,
      source: { type: 'task', id: fixture.taskId },
    });

    expect(calls).toBe(1);
    expect(display.workspace).toBeNull();
    expect(display.context).toEqual({
      workspaceId: fixture.orgId,
      source: { type: 'task', id: fixture.taskId, label: 'Task' },
    });
  });

  it('redacts a source whose canonical workspace itself changes between the two checks', async () => {
    const fixture = await seed();
    // Give the caller a second, equally-authorized workspace so a task that moves there
    // mid-flight still resolves — but to a *different* workspace than the first check saw.
    const otherRole = one(
      await db
        .insert(schema.role)
        .values({
          organizationId: fixture.otherOrgId,
          key: 'ctx-other-role',
          name: 'Member',
          capabilities: ['view', 'contribute'],
        })
        .returning({ id: schema.role.id }),
    );
    await db.insert(schema.actor).values({
      organizationId: fixture.otherOrgId,
      kind: 'human',
      displayName: 'Ctx Owner',
      userId: fixture.userId,
      roleId: otherRole.id,
    });
    await db.insert(schema.grant).values({
      organizationId: fixture.otherOrgId,
      subjectKind: 'role',
      subjectId: otherRole.id,
      resourceKind: 'organization',
      resourceId: fixture.otherOrgId,
      capabilities: ['view', 'contribute'],
      effect: 'allow',
    });
    // A row's status travels with it: the status id, the status key, and the workspace are bound
    // together by one composite foreign key, so a task moving workspace takes the destination's
    // status of the same key.
    const otherStatusId = await seedStatuses(db, schema, fixture.otherOrgId);

    const originalCanActor = authz.canActor;
    let calls = 0;
    vi.spyOn(authz, 'canActor').mockImplementation(async (actorId, required, target, database) => {
      calls += 1;
      if (calls === 1) {
        // Moved to the other workspace strictly after the first check read the task's *old*
        // organization, and strictly before the disclosure boundary re-reads it.
        await db
          .update(schema.task)
          .set({
            organizationId: fixture.otherOrgId,
            statusId: otherStatusId('task', 'todo'),
            projectId: null,
            programId: null,
          })
          .where(eq(schema.task.id, fixture.taskId));
      }
      return originalCanActor(actorId, required, target, database);
    });

    // No `workspaceId` stated: resolveAthenaInvocation's own stated/resolved consistency check
    // (a different guard, inside that function) must stay out of the way so *both* internal
    // calls here succeed — otherwise that check — not the one this test targets — is what
    // would throw.
    const display = await resolveAthenaDisplay(fixture.userId, {
      source: { type: 'task', id: fixture.taskId },
    });

    expect(calls).toBe(2);
    expect(display.workspace).toBeNull();
    expect(display.context).toEqual({
      source: { type: 'task', id: fixture.taskId, label: 'Task' },
    });
  });

  it('propagates a non-authorization failure instead of masking it as a revoked source', async () => {
    const fixture = await seed();
    const boom = new Error('authz backend unavailable');
    vi.spyOn(authz, 'canActor').mockRejectedValueOnce(boom);

    await expect(
      resolveAthenaDisplay(fixture.userId, {
        workspaceId: fixture.orgId,
        source: { type: 'task', id: fixture.taskId },
      }),
    ).rejects.toBe(boom);
  });
});

describe('resolveAthenaDisplays', () => {
  it('returns a null entry for a null input and dedupes repeated contexts', async () => {
    const fixture = await seed();
    const context = {
      workspaceId: fixture.orgId,
      source: { type: 'task' as const, id: fixture.taskId },
    };
    const results = await resolveAthenaDisplays(fixture.userId, [null, context, context]);
    expect(results[0]).toEqual({ context: null, workspace: null });
    expect(results[1]).toEqual(results[2]);
    expect(results[1]?.context).toEqual({
      workspaceId: fixture.orgId,
      source: { type: 'task', id: fixture.taskId, label: 'Ship the release' },
    });
  });

  it('batch-resolves distinct contexts spanning several source kinds in one call', async () => {
    const fixture = await seed();
    const results = await resolveAthenaDisplays(fixture.userId, [
      { workspaceId: fixture.orgId, source: { type: 'project', id: fixture.projectId } },
      { workspaceId: fixture.orgId, source: { type: 'initiative', id: fixture.initiativeId } },
      { workspaceId: fixture.orgId },
    ]);
    expect(results.map((entry) => entry.context?.source?.type)).toEqual([
      'project',
      'initiative',
      undefined,
    ]);
    expect(results.every((entry) => entry.workspace?.id === fixture.orgId)).toBe(true);
  });

  it('batch-resolves a task and a project that carry no optional lineage', async () => {
    const fixture = await seed();
    const results = await resolveAthenaDisplays(fixture.userId, [
      { workspaceId: fixture.orgId, source: { type: 'task', id: fixture.bareTaskId } },
      { workspaceId: fixture.orgId, source: { type: 'project', id: fixture.bareProjectId } },
    ]);
    expect(results[0]?.context).toEqual({
      workspaceId: fixture.orgId,
      source: { type: 'task', id: fixture.bareTaskId, label: 'Bare task' },
    });
    expect(results[1]?.context).toEqual({
      workspaceId: fixture.orgId,
      source: { type: 'project', id: fixture.bareProjectId, label: 'Bare project' },
    });
  });

  it('falls back to historical display for every entry once access is fully revoked', async () => {
    const fixture = await seed();
    await db.delete(schema.grant).where(eq(schema.grant.organizationId, fixture.orgId));
    const results = await resolveAthenaDisplays(fixture.userId, [
      { workspaceId: fixture.orgId, source: { type: 'program', id: fixture.programId } },
    ]);
    expect(results[0]?.workspace).toBeNull();
    expect(results[0]?.context).toEqual({
      workspaceId: fixture.orgId,
      source: { type: 'program', id: fixture.programId, label: 'Program' },
    });
  });

  it('does not inherit a non-cascading organization grant into a batched task display', async () => {
    const fixture = await seed();
    await db
      .update(schema.grant)
      .set({ cascades: false })
      .where(eq(schema.grant.organizationId, fixture.orgId));

    const results = await resolveAthenaDisplays(fixture.userId, [
      { workspaceId: fixture.orgId, source: { type: 'task', id: fixture.taskId } },
    ]);

    expect(results[0]).toEqual({
      context: {
        workspaceId: fixture.orgId,
        source: { type: 'task', id: fixture.taskId, label: 'Task' },
      },
      workspace: null,
    });
  });

  it('honors a non-cascading grant on the batched task itself', async () => {
    const fixture = await seed();
    await db.delete(schema.grant).where(eq(schema.grant.organizationId, fixture.orgId));
    await db.insert(schema.grant).values({
      organizationId: fixture.orgId,
      subjectKind: 'role',
      subjectId: fixture.roleId,
      resourceKind: 'task',
      resourceId: fixture.taskId,
      capabilities: ['view', 'contribute'],
      effect: 'allow',
      cascades: false,
    });

    const results = await resolveAthenaDisplays(fixture.userId, [
      { workspaceId: fixture.orgId, source: { type: 'task', id: fixture.taskId } },
    ]);

    expect(results[0]?.workspace).toMatchObject({ id: fixture.orgId });
    expect(results[0]?.context).toEqual({
      workspaceId: fixture.orgId,
      source: { type: 'task', id: fixture.taskId, label: 'Ship the release' },
    });
  });

  it('does not treat a role id as an actor grant subject in a batched task display', async () => {
    const fixture = await seed();
    await db.delete(schema.grant).where(eq(schema.grant.organizationId, fixture.orgId));
    await db.insert(schema.grant).values({
      organizationId: fixture.orgId,
      subjectKind: 'actor',
      subjectId: fixture.roleId,
      resourceKind: 'organization',
      resourceId: fixture.orgId,
      capabilities: ['view', 'contribute'],
      effect: 'allow',
    });

    const results = await resolveAthenaDisplays(fixture.userId, [
      { workspaceId: fixture.orgId, source: { type: 'task', id: fixture.taskId } },
    ]);

    expect(results[0]).toEqual({
      context: {
        workspaceId: fixture.orgId,
        source: { type: 'task', id: fixture.taskId, label: 'Task' },
      },
      workspace: null,
    });
  });

  it('batch-resolves a caller-owned calendar item source', async () => {
    const fixture = await seed();
    const layer = one(
      await db
        .insert(schema.calendarLayer)
        .values({ userId: fixture.userId, sourceKind: 'personal', title: 'Mine' })
        .returning({ id: schema.calendarLayer.id }),
    );
    const item = one(
      await db
        .insert(schema.calendarItem)
        .values({ userId: fixture.userId, layerId: layer.id, kind: 'block', title: 'Deep work' })
        .returning({ id: schema.calendarItem.id }),
    );
    await db.insert(schema.calendarItemTaskLink).values({
      calendarItemId: item.id,
      taskId: fixture.taskId,
      organizationId: fixture.orgId,
      createdBy: fixture.actorId,
    });
    const results = await resolveAthenaDisplays(fixture.userId, [
      { workspaceId: fixture.orgId, source: { type: 'calendar_item', id: item.id } },
    ]);
    expect(results[0]?.workspace).toMatchObject({ id: fixture.orgId });
    expect(results[0]?.context).toEqual({
      workspaceId: fixture.orgId,
      source: { type: 'calendar_item', id: item.id, label: 'Deep work' },
    });
  });

  it('batch-resolves a caller-owned Stream event source', async () => {
    const fixture = await seed();
    const evt = one(
      await db
        .insert(schema.event)
        .values({
          organizationId: fixture.orgId,
          userId: fixture.userId,
          createdBy: fixture.actorId,
          sourceSystem: 'docket',
          kind: 'comment',
          occurredAt: new Date(),
          title: 'Batched stream event',
          entityKind: 'work_item',
          dedupeKey: `ctx-batch-stream-${Math.random().toString(36).slice(2)}`,
        })
        .returning({ id: schema.event.id }),
    );
    const results = await resolveAthenaDisplays(fixture.userId, [
      { workspaceId: fixture.orgId, source: { type: 'stream_event', id: evt.id } },
    ]);
    expect(results[0]?.workspace).toMatchObject({ id: fixture.orgId });
    expect(results[0]?.context).toEqual({
      workspaceId: fixture.orgId,
      source: { type: 'stream_event', id: evt.id, label: 'Batched stream event' },
    });
  });

  it('batch-resolves a Stream event the caller is only a recipient of', async () => {
    const fixture = await seed();
    const author = one(
      await db
        .insert(schema.user)
        .values({
          name: 'Author',
          email: `ctx-batch-author-${Math.random().toString(36).slice(2)}@x.test`,
        })
        .returning({ id: schema.user.id }),
    );
    const evt = one(
      await db
        .insert(schema.event)
        .values({
          organizationId: fixture.orgId,
          userId: author.id,
          createdBy: fixture.actorId,
          sourceSystem: 'docket',
          kind: 'mention',
          occurredAt: new Date(),
          title: 'Batched mention',
          entityKind: 'work_item',
          dedupeKey: `ctx-batch-recipient-${Math.random().toString(36).slice(2)}`,
        })
        .returning({ id: schema.event.id }),
    );
    await db.insert(schema.eventRecipient).values({
      eventId: evt.id,
      userId: fixture.userId,
      organizationId: fixture.orgId,
      occurredAt: new Date(),
      reason: 'mention',
    });
    const results = await resolveAthenaDisplays(fixture.userId, [
      { workspaceId: fixture.orgId, source: { type: 'stream_event', id: evt.id } },
    ]);
    expect(results[0]?.context).toEqual({
      workspaceId: fixture.orgId,
      source: { type: 'stream_event', id: evt.id, label: 'Batched mention' },
    });
  });

  it('batch-resolves a calendar item shared to the workspace rather than task-linked', async () => {
    const fixture = await seed();
    const layer = one(
      await db
        .insert(schema.calendarLayer)
        .values({ userId: fixture.userId, sourceKind: 'personal', title: 'Mine' })
        .returning({ id: schema.calendarLayer.id }),
    );
    const item = one(
      await db
        .insert(schema.calendarItem)
        .values({
          userId: fixture.userId,
          layerId: layer.id,
          kind: 'block',
          title: 'Shared batch review',
        })
        .returning({ id: schema.calendarItem.id }),
    );
    await db.insert(schema.calendarLayerShare).values({
      layerId: layer.id,
      organizationId: fixture.orgId,
      access: 'details',
      createdBy: fixture.actorId,
    });
    const results = await resolveAthenaDisplays(fixture.userId, [
      { workspaceId: fixture.orgId, source: { type: 'calendar_item', id: item.id } },
    ]);
    expect(results[0]?.context).toEqual({
      workspaceId: fixture.orgId,
      source: { type: 'calendar_item', id: item.id, label: 'Shared batch review' },
    });
  });

  it('hides a batched calendar item and Stream event the caller cannot see', async () => {
    const fixture = await seed();
    const stranger = one(
      await db
        .insert(schema.user)
        .values({
          name: 'Stranger',
          email: `ctx-stranger-${Math.random().toString(36).slice(2)}@x.test`,
        })
        .returning({ id: schema.user.id }),
    );
    const layer = one(
      await db
        .insert(schema.calendarLayer)
        .values({ userId: stranger.id, sourceKind: 'personal', title: 'Theirs' })
        .returning({ id: schema.calendarLayer.id }),
    );
    const item = one(
      await db
        .insert(schema.calendarItem)
        .values({ userId: stranger.id, layerId: layer.id, kind: 'block', title: 'Not yours' })
        .returning({ id: schema.calendarItem.id }),
    );
    const evt = one(
      await db
        .insert(schema.event)
        .values({
          organizationId: fixture.orgId,
          userId: stranger.id,
          createdBy: fixture.actorId,
          sourceSystem: 'docket',
          kind: 'comment',
          occurredAt: new Date(),
          title: 'Not concerning you',
          entityKind: 'work_item',
          dedupeKey: `ctx-batch-hidden-${Math.random().toString(36).slice(2)}`,
        })
        .returning({ id: schema.event.id }),
    );
    const results = await resolveAthenaDisplays(fixture.userId, [
      { workspaceId: fixture.orgId, source: { type: 'calendar_item', id: item.id } },
      { workspaceId: fixture.orgId, source: { type: 'stream_event', id: evt.id } },
    ]);
    expect(results[0]).toEqual({
      context: {
        workspaceId: fixture.orgId,
        source: { type: 'calendar_item', id: item.id, label: 'Calendar item' },
      },
      workspace: null,
    });
    expect(results[1]).toEqual({
      context: {
        workspaceId: fixture.orgId,
        source: { type: 'stream_event', id: evt.id, label: 'Stream event' },
      },
      workspace: null,
    });
  });

  it('carries a source-only context with no workspace through as a historical display', async () => {
    const fixture = await seed();
    // A raw persisted context with a source but no workspace is not something the resolvers
    // themselves ever construct, but the wire schema permits it (only one of the two is
    // required) — this proves a batch read degrades it gracefully rather than crashing.
    const results = await resolveAthenaDisplays(fixture.userId, [
      { source: { type: 'task', id: fixture.taskId } },
    ]);
    expect(results[0]).toEqual({
      context: { source: { type: 'task', id: fixture.taskId, label: 'Task' } },
      workspace: null,
    });
  });

  it('hides a bare workspace focus the caller no longer has an actor in', async () => {
    const fixture = await seed();
    const results = await resolveAthenaDisplays(fixture.userId, [
      { workspaceId: fixture.otherOrgId },
    ]);
    expect(results[0]).toEqual({ context: { workspaceId: fixture.otherOrgId }, workspace: null });
  });

  it('hides a batched task that is archived, distinct from one the caller cannot view', async () => {
    const fixture = await seed();
    await db
      .update(schema.task)
      .set({ archivedAt: new Date() })
      .where(eq(schema.task.id, fixture.taskId));
    const results = await resolveAthenaDisplays(fixture.userId, [
      { workspaceId: fixture.orgId, source: { type: 'task', id: fixture.taskId } },
    ]);
    expect(results[0]).toEqual({
      context: {
        workspaceId: fixture.orgId,
        source: { type: 'task', id: fixture.taskId, label: 'Task' },
      },
      workspace: null,
    });
  });

  it('honors a role grant that has not yet reached its expiry', async () => {
    const fixture = await seed();
    await db
      .update(schema.grant)
      .set({ expiresAt: new Date(Date.now() + 60 * 60_000) })
      .where(eq(schema.grant.organizationId, fixture.orgId));
    const results = await resolveAthenaDisplays(fixture.userId, [
      { workspaceId: fixture.orgId, source: { type: 'task', id: fixture.taskId } },
    ]);
    expect(results[0]?.workspace).toMatchObject({ id: fixture.orgId });
    expect(results[0]?.context).toEqual({
      workspaceId: fixture.orgId,
      source: { type: 'task', id: fixture.taskId, label: 'Ship the release' },
    });
  });

  it('authorizes a roleless actor through a direct actor-level grant', async () => {
    const fixture = await seed();
    const rolelessUser = one(
      await db
        .insert(schema.user)
        .values({
          name: 'Roleless',
          email: `ctx-roleless-${Math.random().toString(36).slice(2)}@x.test`,
        })
        .returning({ id: schema.user.id }),
    );
    await db.insert(schema.hub).values({ userId: rolelessUser.id });
    const rolelessActor = one(
      await db
        .insert(schema.actor)
        .values({
          organizationId: fixture.orgId,
          kind: 'human',
          displayName: 'Roleless',
          userId: rolelessUser.id,
        })
        .returning({ id: schema.actor.id }),
    );
    await db.insert(schema.grant).values({
      organizationId: fixture.orgId,
      subjectKind: 'actor',
      subjectId: rolelessActor.id,
      resourceKind: 'organization',
      resourceId: fixture.orgId,
      capabilities: ['view', 'contribute'],
      effect: 'allow',
    });
    const results = await resolveAthenaDisplays(rolelessUser.id, [
      { workspaceId: fixture.orgId, source: { type: 'task', id: fixture.taskId } },
    ]);
    expect(results[0]?.context).toEqual({
      workspaceId: fixture.orgId,
      source: { type: 'task', id: fixture.taskId, label: 'Ship the release' },
    });
  });

  it('degrades a batched Stream event with no matching preloaded row to a generic label', async () => {
    const fixture = await seed();
    const results = await resolveAthenaDisplays(fixture.userId, [
      { workspaceId: fixture.orgId, source: { type: 'stream_event', id: 'event_does_not_exist' } },
    ]);
    expect(results[0]).toEqual({
      context: {
        workspaceId: fixture.orgId,
        source: { type: 'stream_event', id: 'event_does_not_exist', label: 'Stream event' },
      },
      workspace: null,
    });
  });
});
