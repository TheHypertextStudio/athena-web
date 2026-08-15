/** Integration coverage for the Identity & Access persistence adapter. */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  ancestorChain,
  loadExplicitAuthorizationFacts,
  type ResourceKind,
  type ResourceRef,
} from '@docket/db/identity-access';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { fullSchema, type Database } from '../src/client';
import { actor, grant, organization, program, project, role, task, team } from '../src/schema';
import { seedWorkspaceStatuses, statusLookupKey, type SeededStatuses } from '../src/seed-statuses';

let client!: PGlite;
let db!: Database;
let orgId!: string;
let foreignOrgId!: string;
let roleId!: string;
let foreignRoleId!: string;
let activeAgentId!: string;
let suspendedActorId!: string;
let archivedActorId!: string;
let foreignRoleActorId!: string;
let teamId!: string;
let programId!: string;
let projectId!: string;
let taskId!: string;
let statuses!: SeededStatuses;

/** Resolve one default status seeded for the adapter workspace. */
function statusId(entityType: 'task' | 'project' | 'program', key: string): string {
  const id = statuses.get(statusLookupKey(entityType, key));
  if (id === undefined) throw new Error(`no seeded ${entityType} status ${key}`);
  return id;
}

function target(kind: ResourceKind, id: string, orgIdForTarget: string = orgId): ResourceRef {
  return { kind, id, orgId: orgIdForTarget };
}

/** Return the id from a required single-row insert result. */
function insertedId(rows: readonly { readonly id: string }[]): string {
  const row = rows[0];
  if (row === undefined) throw new Error('fixture insert returned no row');
  return row.id;
}

beforeAll(async () => {
  client = new PGlite('memory://');
  const migrated = drizzle(client, { schema: fullSchema });
  await migrate(migrated, { migrationsFolder: resolve(import.meta.dirname, '../drizzle') });
  db = migrated;

  orgId = insertedId(
    await db
      .insert(organization)
      .values({ name: 'Adapter organization', slug: `identity-access-${Date.now()}` })
      .returning({ id: organization.id }),
  );
  foreignOrgId = insertedId(
    await db
      .insert(organization)
      .values({ name: 'Foreign organization', slug: `foreign-identity-access-${Date.now()}` })
      .returning({ id: organization.id }),
  );
  statuses = await seedWorkspaceStatuses(db, orgId);
  await seedWorkspaceStatuses(db, foreignOrgId);

  roleId = insertedId(
    await db
      .insert(role)
      .values({ organizationId: orgId, key: 'operator', name: 'Operator', capabilities: [] })
      .returning({ id: role.id }),
  );
  foreignRoleId = insertedId(
    await db
      .insert(role)
      .values({
        organizationId: foreignOrgId,
        key: 'foreign-operator',
        name: 'Foreign operator',
        capabilities: [],
      })
      .returning({ id: role.id }),
  );

  activeAgentId = insertedId(
    await db
      .insert(actor)
      .values({
        organizationId: orgId,
        kind: 'agent',
        displayName: 'Active agent',
        roleId,
      })
      .returning({ id: actor.id }),
  );
  suspendedActorId = insertedId(
    await db
      .insert(actor)
      .values({
        organizationId: orgId,
        kind: 'human',
        displayName: 'Suspended actor',
        roleId,
        status: 'suspended',
      })
      .returning({ id: actor.id }),
  );
  archivedActorId = insertedId(
    await db
      .insert(actor)
      .values({
        organizationId: orgId,
        kind: 'human',
        displayName: 'Archived actor',
        roleId,
        archivedAt: new Date('2026-08-14T00:00:00.000Z'),
      })
      .returning({ id: actor.id }),
  );
  foreignRoleActorId = insertedId(
    await db
      .insert(actor)
      .values({
        organizationId: orgId,
        kind: 'human',
        displayName: 'Foreign-role actor',
        roleId: foreignRoleId,
      })
      .returning({ id: actor.id }),
  );

  teamId = insertedId(
    await db
      .insert(team)
      .values({ organizationId: orgId, name: 'Adapter team', key: 'ADAPT' })
      .returning({ id: team.id }),
  );
  programId = insertedId(
    await db
      .insert(program)
      .values({
        organizationId: orgId,
        name: 'Adapter program',
        statusId: statusId('program', 'active'),
      })
      .returning({ id: program.id }),
  );
  projectId = insertedId(
    await db
      .insert(project)
      .values({
        organizationId: orgId,
        name: 'Adapter project',
        teamId,
        programId,
        statusId: statusId('project', 'planned'),
      })
      .returning({ id: project.id }),
  );
  taskId = insertedId(
    await db
      .insert(task)
      .values({
        organizationId: orgId,
        title: 'Adapter task',
        teamId,
        projectId,
        programId,
        state: 'todo',
        statusId: statusId('task', 'todo'),
      })
      .returning({ id: task.id }),
  );

  await db.insert(grant).values([
    {
      organizationId: orgId,
      subjectKind: 'actor',
      subjectId: activeAgentId,
      resourceKind: 'task',
      resourceId: taskId,
      capabilities: ['view'],
      effect: 'allow',
      cascades: true,
    },
    {
      organizationId: orgId,
      subjectKind: 'role',
      subjectId: roleId,
      resourceKind: 'task',
      resourceId: taskId,
      capabilities: ['contribute'],
      effect: 'allow',
      cascades: false,
    },
    {
      organizationId: orgId,
      subjectKind: 'role',
      subjectId: roleId,
      resourceKind: 'team',
      resourceId: teamId,
      capabilities: ['manage'],
      effect: 'allow',
      cascades: true,
    },
    {
      organizationId: orgId,
      subjectKind: 'actor',
      subjectId: activeAgentId,
      resourceKind: 'project',
      resourceId: projectId,
      capabilities: ['comment'],
      effect: 'allow',
      cascades: false,
    },
    {
      organizationId: orgId,
      subjectKind: 'role',
      subjectId: roleId,
      resourceKind: 'project',
      resourceId: projectId,
      capabilities: ['view'],
      effect: 'allow',
      cascades: true,
      expiresAt: new Date('2000-01-01T00:00:00.000Z'),
    },
    {
      organizationId: orgId,
      subjectKind: 'role',
      subjectId: roleId,
      resourceKind: 'project',
      resourceId: projectId,
      capabilities: ['manage'],
      effect: 'deny',
      cascades: false,
    },
    {
      organizationId: orgId,
      subjectKind: 'role',
      subjectId: foreignRoleId,
      resourceKind: 'organization',
      resourceId: orgId,
      capabilities: ['manage'],
      effect: 'allow',
    },
  ]);
});

afterAll(async () => {
  await client.close();
});

describe('loadExplicitAuthorizationFacts', () => {
  it('declares matching TypeScript and runtime public entrypoints', async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(import.meta.dirname, '../package.json'), 'utf8'),
    ) as { readonly exports: Readonly<Record<string, unknown>> };

    expect(packageJson.exports['./identity-access']).toEqual({
      types: './src/identity-access.ts',
      default: './src/identity-access.ts',
    });
  });

  it('loads pure authorization facts for an active non-human actor without evaluating them', async () => {
    const result = await loadExplicitAuthorizationFacts(activeAgentId, target('task', taskId), db);

    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') return;

    expect(result.facts.principal).toEqual({
      organizationId: orgId,
      actorId: activeAgentId,
      roleId,
    });
    expect(result.facts.resourceChain).toEqual({
      organizationId: orgId,
      resources: [
        { kind: 'task', id: taskId },
        { kind: 'team', id: teamId },
        { kind: 'project', id: projectId },
        { kind: 'program', id: programId },
        { kind: 'organization', id: orgId },
      ],
    });
    expect(result.facts.grants).toHaveLength(6);
    for (const explicitGrant of result.facts.grants) {
      expect(Object.keys(explicitGrant).sort()).toEqual([
        'capabilities',
        'cascades',
        'effect',
        'expiresAt',
        'organizationId',
        'resourceId',
        'resourceKind',
        'subjectId',
        'subjectKind',
      ]);
    }
    expect(result.facts.grants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          subjectKind: 'actor',
          subjectId: activeAgentId,
          resourceKind: 'task',
          resourceId: taskId,
          capabilities: ['view'],
          cascades: true,
          expiresAt: null,
        }),
        expect.objectContaining({
          subjectKind: 'role',
          subjectId: roleId,
          resourceKind: 'task',
          resourceId: taskId,
          capabilities: ['contribute'],
          cascades: false,
          expiresAt: null,
        }),
        expect.objectContaining({
          subjectKind: 'role',
          subjectId: roleId,
          resourceKind: 'team',
          resourceId: teamId,
          capabilities: ['manage'],
          cascades: true,
          expiresAt: null,
        }),
        expect.objectContaining({
          subjectKind: 'actor',
          subjectId: activeAgentId,
          resourceKind: 'project',
          resourceId: projectId,
          capabilities: ['comment'],
          cascades: false,
          expiresAt: null,
        }),
        expect.objectContaining({
          subjectKind: 'role',
          subjectId: roleId,
          resourceKind: 'project',
          resourceId: projectId,
          capabilities: ['view'],
          cascades: true,
          expiresAt: new Date('2000-01-01T00:00:00.000Z'),
        }),
        expect.objectContaining({
          subjectKind: 'role',
          subjectId: roleId,
          resourceKind: 'project',
          resourceId: projectId,
          capabilities: ['manage'],
          effect: 'deny',
          cascades: false,
          expiresAt: null,
        }),
      ]),
    );
  });

  it.each(['actor_not_found', 'cross_org', 'actor_suspended', 'actor_archived'] as const)(
    'returns %s without loading candidate authorization facts',
    async (kind) => {
      const actorId =
        kind === 'actor_not_found'
          ? 'missing-actor'
          : kind === 'cross_org'
            ? activeAgentId
            : kind === 'actor_suspended'
              ? suspendedActorId
              : archivedActorId;
      const resource =
        kind === 'cross_org'
          ? target('organization', foreignOrgId, foreignOrgId)
          : target('organization', orgId);

      await expect(loadExplicitAuthorizationFacts(actorId, resource, db)).resolves.toEqual({
        kind,
      });
    },
  );

  it('suppresses a role that is not authoritative for the actor organization', async () => {
    const result = await loadExplicitAuthorizationFacts(
      foreignRoleActorId,
      target('organization', orgId),
      db,
    );

    expect(result).toEqual({
      kind: 'ready',
      facts: {
        principal: { organizationId: orgId, actorId: foreignRoleActorId, roleId: null },
        resourceChain: {
          organizationId: orgId,
          resources: [{ kind: 'organization', id: orgId }],
        },
        grants: [],
      },
    });
  });
});

describe('ancestorChain', () => {
  it('preserves task and project containment ordering', async () => {
    await expect(ancestorChain(target('task', taskId), db)).resolves.toEqual([
      target('task', taskId),
      target('team', teamId),
      target('project', projectId),
      target('program', programId),
      target('organization', orgId),
    ]);
    await expect(ancestorChain(target('project', projectId), db)).resolves.toEqual([
      target('project', projectId),
      target('team', teamId),
      target('program', programId),
      target('organization', orgId),
    ]);
  });

  it('keeps a missing target plus the organization root', async () => {
    await expect(ancestorChain(target('task', 'missing-task'), db)).resolves.toEqual([
      target('task', 'missing-task'),
      target('organization', orgId),
    ]);
    await expect(ancestorChain(target('project', 'missing-project'), db)).resolves.toEqual([
      target('project', 'missing-project'),
      target('organization', orgId),
    ]);
  });
});
