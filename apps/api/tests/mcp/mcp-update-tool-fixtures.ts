import type * as DbModule from '@docket/db';
import type { Capability } from '@docket/identity-access/capabilities';
import { assertDefined } from '@docket/test-utils';

import type { McpContext } from '../../src/mcp/auth';
import { seedStatuses, type StatusIdLookup } from '../support/routes-harness';

export interface McpUpdateSeed {
  orgId: string;
  teamId: string;
  actorId: string;
  /** A second member, so "Sarah's work" is a real distinction. */
  sarahId: string;
  projectId: string;
  statusId: StatusIdLookup;
  ctx: McpContext;
}

/** Seed the workspace, role, user, actors, and role grant used by update tests. */
async function seedUpdateIdentity(
  db: typeof DbModule.db,
  schema: typeof DbModule,
  capabilities: readonly Capability[],
) {
  const slug = `up-${Math.random().toString(36).slice(2, 10)}`;
  const [org] = await db
    .insert(schema.organization)
    .values({ name: slug, slug, lifecycleState: 'active' })
    .returning({ id: schema.organization.id });
  const orgId = assertDefined(org).id;
  const [role] = await db
    .insert(schema.role)
    .values({
      organizationId: orgId,
      key: 'seeded',
      name: 'Seeded',
      capabilities: [...capabilities],
    })
    .returning({ id: schema.role.id });
  const email = `${slug}@e.com`;
  const [user] = await db
    .insert(schema.user)
    .values({ name: 'Ada', email })
    .returning({ id: schema.user.id });
  const [human] = await db
    .insert(schema.actor)
    .values({
      organizationId: orgId,
      kind: 'human',
      displayName: 'Ada',
      userId: assertDefined(user).id,
      roleId: assertDefined(role).id,
    })
    .returning({ id: schema.actor.id });
  const [sarah] = await db
    .insert(schema.actor)
    .values({ organizationId: orgId, kind: 'human', displayName: 'Sarah' })
    .returning({ id: schema.actor.id });
  if (capabilities.length > 0) {
    await db.insert(schema.grant).values({
      organizationId: orgId,
      subjectKind: 'role',
      subjectId: assertDefined(role).id,
      resourceKind: 'organization',
      resourceId: orgId,
      capabilities: [...capabilities],
      effect: 'allow',
    });
  }
  return {
    orgId,
    email,
    userId: assertDefined(user).id,
    actorId: assertDefined(human).id,
    sarahId: assertDefined(sarah).id,
  };
}

/** Seed an org holding `capabilities` org-wide, with a team, project, and second member. */
export async function seedMcpUpdateOrg(
  db: typeof DbModule.db,
  schema: typeof DbModule,
  capabilities: readonly Capability[],
): Promise<McpUpdateSeed> {
  const identity = await seedUpdateIdentity(db, schema, capabilities);
  const { orgId, actorId, sarahId, userId, email } = identity;
  const statusId = await seedStatuses(db, schema, orgId);
  const [team] = await db
    .insert(schema.team)
    .values({
      organizationId: orgId,
      name: 'Core',
      key: `C${Math.random().toString(36).slice(2, 6)}`,
    })
    .returning({ id: schema.team.id });

  const [project] = await db
    .insert(schema.project)
    .values({
      organizationId: orgId,
      name: 'Platform Migration',
      teamId: assertDefined(team).id,
      createdBy: actorId,
      status: 'planned',
      statusId: statusId('project', 'planned'),
    })
    .returning({ id: schema.project.id });

  return {
    orgId,
    teamId: assertDefined(team).id,
    actorId,
    sarahId,
    projectId: assertDefined(project).id,
    statusId,
    ctx: {
      principal: {
        kind: 'user',
        userId,
        userName: 'Ada',
        userEmail: email,
      },
      scopes: ['work:read', 'work:write', 'agents:run', 'connectors:link'],
    },
  };
}

/** Insert a task, returning its id. */
export async function seedMcpUpdateTask(
  db: typeof DbModule.db,
  schema: typeof DbModule,
  seed: McpUpdateSeed,
  values: Partial<typeof DbModule.task.$inferInsert> = {},
): Promise<string> {
  const state = values.state ?? 'backlog';
  const [row] = await db
    .insert(schema.task)
    .values({
      organizationId: seed.orgId,
      title: 'Task',
      teamId: seed.teamId,
      createdBy: seed.actorId,
      ...values,
      state,
      statusId: seed.statusId('task', state),
    })
    .returning({ id: schema.task.id });
  return assertDefined(row).id;
}
