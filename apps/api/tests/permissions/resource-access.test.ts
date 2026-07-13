import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import {
  resourceAccessKey,
  resolveResourceAccess,
  type ResourceAccessRef,
} from '../../src/permissions/resource-access';
import { addMember, getDb, one, seedOrg, seedUserWithHub } from '../support/routes-harness';

type Schema = typeof DbModule;
type Database = typeof DbModule.db;

async function seedGuest(
  db: Database,
  schema: Schema,
  organizationId: string,
  userId: string,
): Promise<{ actorId: string; roleId: string }> {
  const roleId = one(
    await db
      .insert(schema.role)
      .values({ organizationId, key: 'guest', name: 'Guest', isSystem: true })
      .returning({ id: schema.role.id }),
  ).id;
  const actorId = one(
    await db
      .insert(schema.actor)
      .values({
        organizationId,
        kind: 'human',
        displayName: 'Guest',
        userId,
        roleId,
      })
      .returning({ id: schema.actor.id }),
  ).id;
  return { actorId, roleId };
}

async function seedTeam(db: Database, schema: Schema, organizationId: string): Promise<string> {
  return one(
    await db
      .insert(schema.team)
      .values({
        organizationId,
        name: 'Permission Team',
        key: `P${Math.random().toString(36).slice(2, 8)}`,
      })
      .returning({ id: schema.team.id }),
  ).id;
}

async function seedTask(
  db: Database,
  schema: Schema,
  input: {
    organizationId: string;
    teamId: string;
    visibility: 'public' | 'private';
    projectId?: string;
    programId?: string;
  },
): Promise<string> {
  return one(
    await db
      .insert(schema.task)
      .values({
        organizationId: input.organizationId,
        teamId: input.teamId,
        title: `Permission task ${Math.random().toString(36).slice(2)}`,
        state: 'todo',
        visibility: input.visibility,
        projectId: input.projectId,
        programId: input.programId,
      })
      .returning({ id: schema.task.id }),
  ).id;
}

function accessFor(
  result: ReadonlyMap<string, { canView: boolean; effectiveCapability: string | null }>,
  ref: ResourceAccessRef,
) {
  return result.get(resourceAccessKey(ref));
}

describe('resource access permission service', () => {
  it('gives active non-guest members a view baseline on every public grantable kind', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'PublicResourceMember');
    const organizationId = await seedOrg(db, schema);
    await addMember(db, schema, organizationId, userId);
    const teamId = await seedTeam(db, schema, organizationId);
    const initiativeId = one(
      await db
        .insert(schema.initiative)
        .values({ organizationId, name: 'Public Initiative' })
        .returning({ id: schema.initiative.id }),
    ).id;
    const programId = one(
      await db
        .insert(schema.program)
        .values({ organizationId, name: 'Public Program', visibility: 'public' })
        .returning({ id: schema.program.id }),
    ).id;
    const projectId = one(
      await db
        .insert(schema.project)
        .values({ organizationId, name: 'Public Project', teamId, programId, visibility: 'public' })
        .returning({ id: schema.project.id }),
    ).id;
    const cycleId = one(
      await db
        .insert(schema.cycle)
        .values({
          organizationId,
          teamId,
          number: Math.floor(Math.random() * 1_000_000),
          startsAt: new Date('2026-07-01T00:00:00.000Z'),
          endsAt: new Date('2026-07-08T00:00:00.000Z'),
        })
        .returning({ id: schema.cycle.id }),
    ).id;
    const taskId = await seedTask(db, schema, {
      organizationId,
      teamId,
      projectId,
      programId,
      visibility: 'public',
    });
    const refs: ResourceAccessRef[] = [
      { organizationId, kind: 'organization', id: organizationId },
      { organizationId, kind: 'team', id: teamId },
      { organizationId, kind: 'initiative', id: initiativeId },
      { organizationId, kind: 'program', id: programId },
      { organizationId, kind: 'project', id: projectId },
      { organizationId, kind: 'cycle', id: cycleId },
      { organizationId, kind: 'task', id: taskId },
    ];

    const result = await resolveResourceAccess(userId, refs);

    for (const ref of refs) {
      expect(accessFor(result, ref)).toEqual({ canView: true, effectiveCapability: 'view' });
    }
  });

  it('does not give guests the public membership baseline', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'PublicResourceGuest');
    const organizationId = await seedOrg(db, schema);
    await seedGuest(db, schema, organizationId, userId);
    const teamId = await seedTeam(db, schema, organizationId);
    const ref = { organizationId, kind: 'team', id: teamId } as const;

    const result = await resolveResourceAccess(userId, [ref]);

    expect(accessFor(result, ref)).toEqual({ canView: false, effectiveCapability: null });
  });

  it('uses a direct actor grant to expose a private resource', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'DirectGrantMember');
    const organizationId = await seedOrg(db, schema);
    const actorId = await addMember(db, schema, organizationId, userId);
    const teamId = await seedTeam(db, schema, organizationId);
    const taskId = await seedTask(db, schema, {
      organizationId,
      teamId,
      visibility: 'private',
    });
    await db.insert(schema.grant).values({
      organizationId,
      subjectKind: 'actor',
      subjectId: actorId,
      resourceKind: 'task',
      resourceId: taskId,
      capabilities: ['comment'],
      effect: 'allow',
      cascades: false,
    });
    const ref = { organizationId, kind: 'task', id: taskId } as const;

    const result = await resolveResourceAccess(userId, [ref]);

    expect(accessFor(result, ref)).toEqual({ canView: true, effectiveCapability: 'comment' });
  });

  it('applies a cascading ancestor grant to a private descendant', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'CascadingGrantGuest');
    const organizationId = await seedOrg(db, schema);
    const { roleId } = await seedGuest(db, schema, organizationId, userId);
    const teamId = await seedTeam(db, schema, organizationId);
    const taskId = await seedTask(db, schema, {
      organizationId,
      teamId,
      visibility: 'private',
    });
    await db.insert(schema.grant).values({
      organizationId,
      subjectKind: 'role',
      subjectId: roleId,
      resourceKind: 'team',
      resourceId: teamId,
      capabilities: ['contribute'],
      effect: 'allow',
      cascades: true,
    });
    const ref = { organizationId, kind: 'task', id: taskId } as const;

    const result = await resolveResourceAccess(userId, [ref]);

    expect(accessFor(result, ref)).toEqual({ canView: true, effectiveCapability: 'contribute' });
  });

  it('does not apply a non-cascading ancestor grant to a descendant', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'NonCascadingGrantGuest');
    const organizationId = await seedOrg(db, schema);
    const { actorId } = await seedGuest(db, schema, organizationId, userId);
    const teamId = await seedTeam(db, schema, organizationId);
    const taskId = await seedTask(db, schema, {
      organizationId,
      teamId,
      visibility: 'private',
    });
    await db.insert(schema.grant).values({
      organizationId,
      subjectKind: 'actor',
      subjectId: actorId,
      resourceKind: 'team',
      resourceId: teamId,
      capabilities: ['manage'],
      effect: 'allow',
      cascades: false,
    });
    const ref = { organizationId, kind: 'task', id: taskId } as const;

    const result = await resolveResourceAccess(userId, [ref]);

    expect(accessFor(result, ref)).toEqual({ canView: false, effectiveCapability: null });
  });

  it('ignores expired grants', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'ExpiredGrantGuest');
    const organizationId = await seedOrg(db, schema);
    const { actorId } = await seedGuest(db, schema, organizationId, userId);
    const teamId = await seedTeam(db, schema, organizationId);
    const taskId = await seedTask(db, schema, {
      organizationId,
      teamId,
      visibility: 'private',
    });
    await db.insert(schema.grant).values({
      organizationId,
      subjectKind: 'actor',
      subjectId: actorId,
      resourceKind: 'task',
      resourceId: taskId,
      capabilities: ['view'],
      effect: 'allow',
      expiresAt: new Date('2000-01-01T00:00:00.000Z'),
    });
    const ref = { organizationId, kind: 'task', id: taskId } as const;

    const result = await resolveResourceAccess(userId, [ref]);

    expect(accessFor(result, ref)).toEqual({ canView: false, effectiveCapability: null });
  });

  it('returns the strongest actor-or-role allow capability and ignores deny rows', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'StrongestGrantGuest');
    const organizationId = await seedOrg(db, schema);
    const { actorId, roleId } = await seedGuest(db, schema, organizationId, userId);
    const teamId = await seedTeam(db, schema, organizationId);
    const taskId = await seedTask(db, schema, {
      organizationId,
      teamId,
      visibility: 'private',
    });
    await db.insert(schema.grant).values([
      {
        organizationId,
        subjectKind: 'actor',
        subjectId: actorId,
        resourceKind: 'task',
        resourceId: taskId,
        capabilities: ['comment'],
        effect: 'allow',
      },
      {
        organizationId,
        subjectKind: 'role',
        subjectId: roleId,
        resourceKind: 'organization',
        resourceId: organizationId,
        capabilities: ['contribute'],
        effect: 'allow',
        cascades: true,
      },
      {
        organizationId,
        subjectKind: 'actor',
        subjectId: actorId,
        resourceKind: 'task',
        resourceId: taskId,
        capabilities: ['manage'],
        effect: 'deny',
      },
    ]);
    const ref = { organizationId, kind: 'task', id: taskId } as const;

    const result = await resolveResourceAccess(userId, [ref]);

    expect(accessFor(result, ref)).toEqual({ canView: true, effectiveCapability: 'contribute' });
  });

  it('denies missing, cross-org, unsupported, and foreign-role resource access', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'InvalidResourceMember');
    const memberOrgId = await seedOrg(db, schema);
    const foreignOrgId = await seedOrg(db, schema);
    const memberActorId = await addMember(db, schema, memberOrgId, userId);
    const memberTeamId = await seedTeam(db, schema, memberOrgId);
    const foreignTeamId = await seedTeam(db, schema, foreignOrgId);
    const foreignTaskId = await seedTask(db, schema, {
      organizationId: foreignOrgId,
      teamId: foreignTeamId,
      visibility: 'public',
    });
    const foreignRoleId = one(
      await db
        .insert(schema.role)
        .values({ organizationId: foreignOrgId, key: 'foreign', name: 'Foreign Role' })
        .returning({ id: schema.role.id }),
    ).id;
    const privateTeamId = one(
      await db
        .insert(schema.team)
        .values({
          organizationId: memberOrgId,
          name: 'Private Team',
          key: `X${Math.random().toString(36).slice(2, 8)}`,
          visibility: 'private',
        })
        .returning({ id: schema.team.id }),
    ).id;
    await db
      .update(schema.actor)
      .set({ roleId: foreignRoleId })
      .where(eq(schema.actor.id, memberActorId));
    await db.insert(schema.grant).values({
      organizationId: memberOrgId,
      subjectKind: 'role',
      subjectId: foreignRoleId,
      resourceKind: 'team',
      resourceId: privateTeamId,
      capabilities: ['manage'],
      effect: 'allow',
    });
    const refs: ResourceAccessRef[] = [
      { organizationId: memberOrgId, kind: 'task', id: 'missing-resource' },
      { organizationId: memberOrgId, kind: 'task', id: foreignTaskId },
      { organizationId: foreignOrgId, kind: 'task', id: foreignTaskId },
      { organizationId: memberOrgId, kind: 'milestone', id: memberTeamId },
      { organizationId: memberOrgId, kind: 'team', id: privateTeamId },
    ];

    const result = await resolveResourceAccess(userId, refs);

    for (const ref of refs) {
      expect(accessFor(result, ref)).toEqual({ canView: false, effectiveCapability: null });
    }
  });
});
