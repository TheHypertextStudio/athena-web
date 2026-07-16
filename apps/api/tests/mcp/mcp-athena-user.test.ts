import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const getSession = vi.fn(async () => null);
vi.mock('@docket/auth', () => ({ auth: { api: { getSession } } }));

import type * as DbModule from '@docket/db';

import type { internalUserContext as InternalUserContext } from '../../src/mcp/internal-session';
import type { openToolbox as OpenToolbox } from '../../src/agent/toolbox';
import { getMigratedDb } from '../support/db';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let internalUserContext!: typeof InternalUserContext;
let openToolbox!: typeof OpenToolbox;

beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;
  ({ internalUserContext } = await import('../../src/mcp/internal-session'));
  ({ openToolbox } = await import('../../src/agent/toolbox'));
});

interface Seed {
  readonly userId: string;
  readonly orgId: string;
  readonly actorId: string;
  readonly roleId: string;
  readonly teamId: string;
}

async function seedUserWorkspace(): Promise<Seed> {
  const slug = `au-${Math.random().toString(36).slice(2, 10)}`;
  const [org] = await db
    .insert(schema.organization)
    .values({ name: slug, slug, lifecycleState: 'active' })
    .returning({ id: schema.organization.id });
  const [role] = await db
    .insert(schema.role)
    .values({
      organizationId: org!.id,
      key: `owner-${slug}`,
      name: 'Owner',
      capabilities: ['view', 'contribute'],
    })
    .returning({ id: schema.role.id });
  const [user] = await db
    .insert(schema.user)
    .values({ name: 'Ada', email: `${slug}@example.com` })
    .returning({ id: schema.user.id });
  const [human] = await db
    .insert(schema.actor)
    .values({
      organizationId: org!.id,
      kind: 'human',
      displayName: 'Ada',
      userId: user!.id,
      roleId: role!.id,
    })
    .returning({ id: schema.actor.id });
  await db.insert(schema.grant).values({
    organizationId: org!.id,
    subjectKind: 'role',
    subjectId: role!.id,
    resourceKind: 'organization',
    resourceId: org!.id,
    capabilities: ['view', 'contribute'],
    effect: 'allow',
  });
  const [team] = await db
    .insert(schema.team)
    .values({ organizationId: org!.id, name: 'Core', key: `A${slug.slice(-4)}` })
    .returning({ id: schema.team.id });
  return {
    userId: user!.id,
    orgId: org!.id,
    actorId: human!.id,
    roleId: role!.id,
    teamId: team!.id,
  };
}

describe('Athena internal user principal', () => {
  it('loads a first-party user context without provisioning an agent identity', async () => {
    const seed = await seedUserWorkspace();

    const ctx = await internalUserContext(seed.userId);

    expect(ctx.principal).toMatchObject({ kind: 'user', userId: seed.userId, userName: 'Ada' });
    expect(ctx.scopes).toEqual(['work:read', 'work:write', 'agents:run', 'connectors:link']);
    expect(await db.select().from(schema.agent)).toHaveLength(0);
    const agentActors = await db.select().from(schema.actor).where(eq(schema.actor.kind, 'agent'));
    expect(agentActors).toHaveLength(0);
  });

  it('resolves the current human Actor and grants on every Docket call', async () => {
    const seed = await seedUserWorkspace();
    const toolbox = await openToolbox({ kind: 'athena', ownerUserId: seed.userId });
    try {
      const first = await toolbox.callTool('create_task', {
        orgId: seed.orgId,
        teamId: seed.teamId,
        title: 'First task',
      });
      expect(first.isError).toBe(false);

      await db
        .delete(schema.grant)
        .where(
          and(
            eq(schema.grant.organizationId, seed.orgId),
            eq(schema.grant.subjectKind, 'role'),
            eq(schema.grant.subjectId, seed.roleId),
          ),
        );
      const revoked = await toolbox.callTool('create_task', {
        orgId: seed.orgId,
        teamId: seed.teamId,
        title: 'Denied task',
      });
      expect(revoked.isError).toBe(true);

      await db.insert(schema.grant).values({
        organizationId: seed.orgId,
        subjectKind: 'role',
        subjectId: seed.roleId,
        resourceKind: 'organization',
        resourceId: seed.orgId,
        capabilities: ['view', 'contribute'],
        effect: 'allow',
      });
      const restored = await toolbox.callTool('create_task', {
        orgId: seed.orgId,
        teamId: seed.teamId,
        title: 'Restored task',
      });
      expect(restored.isError).toBe(false);

      await db
        .update(schema.actor)
        .set({ status: 'suspended' })
        .where(eq(schema.actor.id, seed.actorId));
      const membershipRevoked = await toolbox.callTool('create_task', {
        orgId: seed.orgId,
        teamId: seed.teamId,
        title: 'Former member task',
      });
      expect(membershipRevoked.isError).toBe(true);
    } finally {
      await toolbox.close();
    }

    const tasks = await db
      .select({ title: schema.task.title, createdBy: schema.task.createdBy })
      .from(schema.task)
      .where(eq(schema.task.organizationId, seed.orgId));
    expect(tasks).toEqual([
      { title: 'First task', createdBy: seed.actorId },
      { title: 'Restored task', createdBy: seed.actorId },
    ]);
    expect(await db.select().from(schema.agent)).toHaveLength(0);
    expect(await db.select().from(schema.role).where(eq(schema.role.key, 'athena'))).toHaveLength(
      0,
    );
  });
});
