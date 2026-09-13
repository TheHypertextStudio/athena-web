import type * as DbModule from '@docket/db';
import type { Capability } from '@docket/identity-access/capabilities';
import { assertDefined } from '@docket/test-utils';

import type { McpContext } from '../../src/mcp/auth';
import { seedStatuses, type StatusIdLookup } from '../support/routes-harness';

export interface McpSurfaceSeed {
  userId: string;
  orgId: string;
  teamId: string;
  actorId: string;
  agentActorId: string;
  taskId: string;
  task2Id: string;
  projectId: string;
  programId: string;
  initiativeId: string;
  agentId: string;
  integrationId: string;
  cycleId: string;
  statusId: StatusIdLookup;
  ctx: McpContext;
}

/** Seed the workspace and its human identity. */
async function seedIdentity(
  db: typeof DbModule.db,
  schema: typeof DbModule,
  capabilities: readonly Capability[],
) {
  const slug = `ms-${Math.random().toString(36).slice(2, 10)}`;
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
  const userId = assertDefined(user).id;
  await db.insert(schema.hub).values({ userId });
  const [human] = await db
    .insert(schema.actor)
    .values({
      organizationId: orgId,
      kind: 'human',
      displayName: 'Ada',
      userId,
      roleId: assertDefined(role).id,
    })
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
  return { orgId, email, userId, actorId: assertDefined(human).id };
}

/** Seed the team and tasks used across MCP surface assertions. */
async function seedTasks(
  db: typeof DbModule.db,
  schema: typeof DbModule,
  orgId: string,
  actorId: string,
  statusId: StatusIdLookup,
) {
  const [team] = await db
    .insert(schema.team)
    .values({
      organizationId: orgId,
      name: 'Core',
      key: `C${Math.random().toString(36).slice(2, 6)}`,
    })
    .returning({ id: schema.team.id });
  const teamId = assertDefined(team).id;
  const baseTask = {
    organizationId: orgId,
    teamId,
    state: 'todo' as const,
    statusId: statusId('task', 'todo'),
    createdBy: actorId,
  };
  const [task, task2] = await db
    .insert(schema.task)
    .values([
      { ...baseTask, title: 'Ship' },
      { ...baseTask, title: 'Ship 2' },
    ])
    .returning({ id: schema.task.id });
  return { teamId, taskId: assertDefined(task).id, task2Id: assertDefined(task2).id };
}

/** Seed the work containers and cycle used by hydrated resource tests. */
async function seedContainers(
  db: typeof DbModule.db,
  schema: typeof DbModule,
  input: { orgId: string; actorId: string; teamId: string; statusId: StatusIdLookup },
) {
  const { orgId, actorId, teamId, statusId } = input;
  const [project] = await db
    .insert(schema.project)
    .values({
      organizationId: orgId,
      name: 'Proj',
      teamId,
      createdBy: actorId,
      status: 'planned',
      statusId: statusId('project', 'planned'),
    })
    .returning({ id: schema.project.id });
  const [program] = await db
    .insert(schema.program)
    .values({
      organizationId: orgId,
      name: 'Prog',
      createdBy: actorId,
      status: 'active',
      statusId: statusId('program', 'active'),
    })
    .returning({ id: schema.program.id });
  const [initiative] = await db
    .insert(schema.initiative)
    .values({
      organizationId: orgId,
      name: 'Init',
      createdBy: actorId,
      status: 'active',
      statusId: statusId('initiative', 'active'),
    })
    .returning({ id: schema.initiative.id });
  const [cycle] = await db
    .insert(schema.cycle)
    .values({
      organizationId: orgId,
      teamId,
      number: 1,
      name: 'C1',
      startsAt: new Date('2026-01-01'),
      endsAt: new Date('2026-01-14'),
    })
    .returning({ id: schema.cycle.id });
  return {
    projectId: assertDefined(project).id,
    programId: assertDefined(program).id,
    initiativeId: assertDefined(initiative).id,
    cycleId: assertDefined(cycle).id,
  };
}

/** Seed an agent and integration used by their MCP resource projections. */
async function seedAutomation(
  db: typeof DbModule.db,
  schema: typeof DbModule,
  orgId: string,
  actorId: string,
) {
  const [agentActor] = await db
    .insert(schema.actor)
    .values({ organizationId: orgId, kind: 'agent', displayName: 'Athena' })
    .returning({ id: schema.actor.id });
  const agentActorId = assertDefined(agentActor).id;
  const [agent] = await db
    .insert(schema.agent)
    .values({
      organizationId: orgId,
      actorId: agentActorId,
      createdBy: actorId,
      connection: { protocol: 'mcp', endpoint: 'https://agent.example/mcp' },
    })
    .returning({ id: schema.agent.id });
  const [integration] = await db
    .insert(schema.integration)
    .values({
      organizationId: orgId,
      provider: 'github',
      pattern: 'connector',
      roles: ['work'],
      createdBy: actorId,
    })
    .returning({ id: schema.integration.id });
  return {
    agentActorId,
    agentId: assertDefined(agent).id,
    integrationId: assertDefined(integration).id,
  };
}

/** Seed a self-contained org whose human actor holds `capabilities` org-wide. */
export async function seedMcpSurfaceOrg(
  db: typeof DbModule.db,
  schema: typeof DbModule,
  capabilities: readonly Capability[],
): Promise<McpSurfaceSeed> {
  const identity = await seedIdentity(db, schema, capabilities);
  const { orgId, actorId, userId, email } = identity;
  const statusId = await seedStatuses(db, schema, orgId);
  const tasks = await seedTasks(db, schema, orgId, actorId, statusId);
  const containers = await seedContainers(db, schema, { orgId, actorId, ...tasks, statusId });
  const automation = await seedAutomation(db, schema, orgId, actorId);
  const ctx: McpContext = {
    principal: { kind: 'user', userId, userName: 'Ada', userEmail: email },
    scopes: ['work:read', 'work:write', 'agents:run', 'connectors:link'],
  };
  return {
    userId,
    orgId,
    teamId: tasks.teamId,
    actorId,
    ...automation,
    taskId: tasks.taskId,
    task2Id: tasks.task2Id,
    ...containers,
    statusId,
    ctx,
  };
}
