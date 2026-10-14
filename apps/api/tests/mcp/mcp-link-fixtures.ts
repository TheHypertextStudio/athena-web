import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import type * as DbModule from '@docket/db';
import type { Capability } from '@docket/identity-access/capabilities';
import { assertDefined } from '@docket/test-utils';

import type { McpContext } from '../../src/mcp/auth';
import type { registerTools as RegisterTools } from '../../src/mcp/tools';
import { seedStatuses, type StatusIdLookup } from '../support/routes-harness';

/** A workspace with one of each container, seeded for relation tests. */
export interface LinkSeed {
  orgId: string;
  teamId: string;
  actorId: string;
  userId: string;
  projectId: string;
  programId: string;
  initiativeId: string;
  statusId: StatusIdLookup;
  ctx: McpContext;
}

/** The migrated database module the relation tests share. */
export interface LinkDb {
  readonly schema: typeof DbModule;
  readonly db: typeof DbModule.db;
}

/** Seed a user, a role holding `capabilities`, and its org-wide grant. */
async function seedMember(
  { db, schema }: LinkDb,
  orgId: string,
  slug: string,
  capabilities: readonly Capability[],
): Promise<{ userId: string; actorId: string; email: string }> {
  const [role] = await db
    .insert(schema.role)
    .values({ organizationId: orgId, key: slug, name: slug, capabilities: [...capabilities] })
    .returning({ id: schema.role.id });
  const email = `${slug}@e.com`;
  const [user] = await db
    .insert(schema.user)
    .values({ name: slug, email })
    .returning({ id: schema.user.id });
  const [human] = await db
    .insert(schema.actor)
    .values({
      organizationId: orgId,
      kind: 'human',
      displayName: slug,
      userId: assertDefined(user).id,
      roleId: assertDefined(role).id,
    })
    .returning({ id: schema.actor.id });
  await db.insert(schema.grant).values({
    organizationId: orgId,
    subjectKind: 'role',
    subjectId: assertDefined(role).id,
    resourceKind: 'organization',
    resourceId: orgId,
    capabilities: [...capabilities],
    effect: 'allow',
  });
  return { userId: assertDefined(user).id, actorId: assertDefined(human).id, email };
}

/** An MCP context for a user principal carrying every work scope. */
export function userContext(userId: string, email: string): McpContext {
  return {
    principal: { kind: 'user', userId, userName: 'Ada', userEmail: email },
    scopes: ['work:read', 'work:write', 'agents:run', 'connectors:link'],
  };
}

/**
 * Seed an org that can contribute org-wide, with one project, program, and initiative.
 *
 * @param handle - The migrated database module.
 * @returns the seeded ids and an MCP context for the contributing member.
 */
export async function seedLinkOrg(handle: LinkDb): Promise<LinkSeed> {
  const { db, schema } = handle;
  const slug = `lk-${Math.random().toString(36).slice(2, 10)}`;
  const [org] = await db
    .insert(schema.organization)
    .values({ name: slug, slug, lifecycleState: 'active' })
    .returning({ id: schema.organization.id });
  const orgId = assertDefined(org).id;
  const statusId = await seedStatuses(db, schema, orgId);
  const member = await seedMember(handle, orgId, slug, ['contribute']);

  const [team] = await db
    .insert(schema.team)
    .values({
      organizationId: orgId,
      name: 'Core',
      key: `C${Math.random().toString(36).slice(2, 6)}`,
    })
    .returning({ id: schema.team.id });
  const teamId = assertDefined(team).id;
  const seed = {
    orgId,
    teamId,
    actorId: member.actorId,
    userId: member.userId,
    statusId,
    ctx: userContext(member.userId, member.email),
  };
  return {
    ...seed,
    projectId: await seedProject(handle, seed, 'Auth Rewrite'),
    programId: await seedProgram(handle, seed, 'Reliability'),
    initiativeId: await seedInitiative(handle, seed, 'Q3 Platform'),
  };
}

/** The ids every seeding helper needs. */
type SeedScope = Pick<LinkSeed, 'orgId' | 'teamId' | 'actorId' | 'statusId'>;

/**
 * Add a member to the org who holds only `capabilities` org-wide.
 *
 * @returns an MCP context for that member.
 */
export async function seedRestrictedMember(
  handle: LinkDb,
  s: Pick<LinkSeed, 'orgId'>,
  capabilities: readonly Capability[],
): Promise<McpContext> {
  const slug = `rm-${Math.random().toString(36).slice(2, 10)}`;
  const member = await seedMember(handle, s.orgId, slug, capabilities);
  return userContext(member.userId, member.email);
}

/** Insert a task, defaulting to the backlog state on the seeded team. */
export async function seedTask(
  { db, schema }: LinkDb,
  s: SeedScope,
  values: Partial<typeof schema.task.$inferInsert> = {},
): Promise<string> {
  const state = values.state ?? 'backlog';
  const [row] = await db
    .insert(schema.task)
    .values({
      organizationId: s.orgId,
      title: 'Task',
      teamId: s.teamId,
      createdBy: s.actorId,
      ...values,
      state,
      statusId: s.statusId('task', state),
    })
    .returning({ id: schema.task.id });
  return assertDefined(row).id;
}

/** Insert a planned project on the seeded team. */
export async function seedProject(
  { db, schema }: LinkDb,
  s: SeedScope,
  name: string,
): Promise<string> {
  const [row] = await db
    .insert(schema.project)
    .values({
      organizationId: s.orgId,
      name,
      teamId: s.teamId,
      createdBy: s.actorId,
      status: 'planned',
      statusId: s.statusId('project', 'planned'),
    })
    .returning({ id: schema.project.id });
  return assertDefined(row).id;
}

/** Insert an active program. */
export async function seedProgram(
  { db, schema }: LinkDb,
  s: SeedScope,
  name: string,
): Promise<string> {
  const [row] = await db
    .insert(schema.program)
    .values({
      organizationId: s.orgId,
      name,
      createdBy: s.actorId,
      status: 'active',
      statusId: s.statusId('program', 'active'),
    })
    .returning({ id: schema.program.id });
  return assertDefined(row).id;
}

/** Insert an active initiative. */
export async function seedInitiative(
  { db, schema }: LinkDb,
  s: SeedScope,
  name: string,
): Promise<string> {
  const [row] = await db
    .insert(schema.initiative)
    .values({
      organizationId: s.orgId,
      name,
      createdBy: s.actorId,
      status: 'active',
      statusId: s.statusId('initiative', 'active'),
    })
    .returning({ id: schema.initiative.id });
  return assertDefined(row).id;
}

/** Connected MCP clients, closed after each test. */
export class LinkHarness {
  private readonly open: { close(): Promise<void> }[] = [];

  constructor(private readonly registerTools: typeof RegisterTools) {}

  /** Connect a client to a fresh server carrying every tool for `ctx`. */
  async connect(ctx: McpContext): Promise<Client> {
    const server = new McpServer(
      { name: 'test', version: '0.0.0' },
      { capabilities: { tools: {}, resources: {} } },
    );
    this.registerTools(server, ctx, 'sess_link');
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'c', version: '0.0.0' });
    await Promise.all([server.connect(st), client.connect(ct)]);
    this.open.push({
      close: async () => {
        await client.close();
        await server.close();
      },
    });
    return client;
  }

  /** Close every client opened since the last call. */
  async closeAll(): Promise<void> {
    while (this.open.length > 0) await assertDefined(this.open.pop()).close();
  }
}

/** The JSON payload of a successful tool result. */
export function payload(res: CallToolResult): Record<string, unknown> {
  return JSON.parse((res.content[0] as { text: string }).text) as Record<string, unknown>;
}

/** The text of a tool result, for asserting on an error. */
export function resultText(res: CallToolResult): string {
  return (res.content[0] as { text: string }).text;
}
