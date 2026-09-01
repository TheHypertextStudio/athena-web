/** Athena authoring coverage for Docket-owned repeating work. */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import type { Capability } from '@docket/identity-access/capabilities';

import type { McpContext } from '../../src/mcp/auth';
import type { registerTools as RegisterTools } from '../../src/mcp/tools';
import { resetAuthMocks } from '../support/auth-mock';
import { getMigratedDb } from '../support/db';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let registerTools!: typeof RegisterTools;

beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;
  registerTools = (await import('../../src/mcp/tools')).registerTools;
});

interface Seed {
  readonly orgId: string;
  readonly teamId: string;
  readonly ctx: McpContext;
}

/** Return the row an insert was expected to create. */
function first<T>(rows: readonly T[]): T {
  const row = rows[0];
  if (!row) throw new Error('seed insert returned no row');
  return row;
}

/** Seed one workspace member with the requested org-wide capabilities. */
async function seedOrg(capabilities: readonly Capability[]): Promise<Seed> {
  const slug = `rw-${Math.random().toString(36).slice(2, 10)}`;
  const org = first(
    await db
      .insert(schema.organization)
      .values({ name: slug, slug, lifecycleState: 'active' })
      .returning({ id: schema.organization.id }),
  );
  // The tools under test create work in this workspace, and work needs its status set to exist.
  await schema.seedWorkspaceStatuses(db, org.id);
  const role = first(
    await db
      .insert(schema.role)
      .values({
        organizationId: org.id,
        key: 'seeded',
        name: 'Seeded',
        capabilities: [...capabilities],
      })
      .returning({ id: schema.role.id }),
  );
  const email = `${slug}@example.test`;
  const user = first(
    await db.insert(schema.user).values({ name: 'Ada', email }).returning({ id: schema.user.id }),
  );
  first(
    await db
      .insert(schema.actor)
      .values({
        organizationId: org.id,
        kind: 'human',
        displayName: 'Ada',
        userId: user.id,
        roleId: role.id,
      })
      .returning({ id: schema.actor.id }),
  );
  if (capabilities.length > 0) {
    await db.insert(schema.grant).values({
      organizationId: org.id,
      subjectKind: 'role',
      subjectId: role.id,
      resourceKind: 'organization',
      resourceId: org.id,
      capabilities: [...capabilities],
      effect: 'allow',
    });
  }
  const team = first(
    await db
      .insert(schema.team)
      .values({
        organizationId: org.id,
        name: 'Events',
        key: `E${Math.random().toString(36).slice(2, 6)}`,
      })
      .returning({ id: schema.team.id }),
  );
  return {
    orgId: org.id,
    teamId: team.id,
    ctx: {
      principal: {
        kind: 'user',
        userId: user.id,
        userName: 'Ada',
        userEmail: email,
      },
      scopes: ['work:read', 'work:write'],
    },
  };
}

const harnesses: { close(): Promise<void> }[] = [];

/** Connect an MCP client to the complete Docket tool catalog. */
async function connect(ctx: McpContext): Promise<Client> {
  const server = new McpServer(
    { name: 'test', version: '0.0.0' },
    { capabilities: { tools: {}, resources: {} } },
  );
  registerTools(server, ctx, 'sess_repeating_work');
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  harnesses.push({
    close: async () => {
      await client.close();
      await server.close();
    },
  });
  return client;
}

/** Parse the structured JSON body returned by a Docket MCP tool. */
function payload(result: CallToolResult): Record<string, unknown> {
  return JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
}

afterEach(async () => {
  while (harnesses.length > 0) await harnesses.pop()?.close();
  resetAuthMocks();
});

describe('repeating-work MCP tools', () => {
  it('exposes intent-shaped authoring commands with explicit mutation annotations', async () => {
    const seed = await seedOrg(['contribute']);
    const client = await connect(seed.ctx);
    const tools = (await client.listTools()).tools;

    for (const name of ['define_process', 'schedule_process', 'repeat_task']) {
      expect(tools.find((tool) => tool.name === name)?.annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      });
    }
  });

  it('defines and schedules a reusable process through the shared Docket engine', async () => {
    const seed = await seedOrg(['contribute']);
    const client = await connect(seed.ctx);
    const defined = (await client.callTool({
      name: 'define_process',
      arguments: {
        orgId: seed.orgId,
        definition: {
          name: 'Intro to Urbanism Workshop',
          creationMode: 'all_at_once',
          tasks: [
            {
              key: 'publish',
              title: 'Publish the workshop',
              teamId: seed.teamId,
              timing: { kind: 'relative_to_trigger', offsetDays: -14 },
            },
            {
              key: 'host',
              title: 'Host the workshop',
              teamId: seed.teamId,
              timing: { kind: 'on_trigger' },
            },
            {
              key: 'follow-up',
              title: 'Send attendee follow-ups',
              teamId: seed.teamId,
              timing: { kind: 'relative_to_trigger', offsetDays: 1 },
            },
          ],
        },
      },
    })) as CallToolResult;
    expect(defined.isError).toBeFalsy();
    const definitionId = payload(defined)['definitionId'];
    expect(definitionId).toEqual(expect.any(String));

    const scheduled = (await client.callTool({
      name: 'schedule_process',
      arguments: {
        orgId: seed.orgId,
        series: {
          processDefinitionId: definitionId,
          name: 'Monthly workshops',
          trigger: {
            kind: 'calendar',
            schedule: {
              kind: 'monthly',
              interval: 1,
              startDate: '2099-01-15',
              timezone: 'America/Los_Angeles',
              end: { kind: 'after_count', count: 2 },
              pattern: { kind: 'day_of_month', day: 15 },
            },
          },
        },
      },
    })) as CallToolResult;
    expect(scheduled.isError).toBeFalsy();
    const scheduledPayload = payload(scheduled) as {
      occurrences: { scheduledFor: string; status: string }[];
    };
    expect(scheduledPayload.occurrences).toEqual([
      expect.objectContaining({ scheduledFor: '2099-01-15', status: 'materialized' }),
      expect.objectContaining({ scheduledFor: '2099-02-15', status: 'materialized' }),
    ]);
  });

  it('creates a repeating ordinary task without teaching Athena recurrence internals', async () => {
    const seed = await seedOrg(['contribute']);
    const client = await connect(seed.ctx);
    const result = (await client.callTool({
      name: 'repeat_task',
      arguments: {
        orgId: seed.orgId,
        recurringTask: {
          task: { title: 'Run six miles', teamId: seed.teamId },
          schedule: {
            kind: 'weekly',
            interval: 1,
            startDate: '2099-01-05',
            timezone: 'America/Los_Angeles',
            end: { kind: 'after_count', count: 3 },
            weekdays: ['monday', 'wednesday', 'friday'],
          },
        },
      },
    })) as CallToolResult;
    expect(result.isError).toBeFalsy();
    const resultPayload = payload(result) as {
      firstTask: { title: string };
      occurrences: unknown[];
    };
    expect(resultPayload.firstTask.title).toBe('Run six miles');
    expect(resultPayload.occurrences).toHaveLength(3);
  });

  it('requires the same contribute capability as the web API', async () => {
    const seed = await seedOrg(['view']);
    const client = await connect(seed.ctx);
    const result = (await client.callTool({
      name: 'repeat_task',
      arguments: {
        orgId: seed.orgId,
        recurringTask: {
          task: { title: 'Run six miles', teamId: seed.teamId },
          schedule: {
            kind: 'daily',
            interval: 1,
            startDate: '2099-01-01',
            timezone: 'America/Los_Angeles',
            end: { kind: 'after_count', count: 1 },
          },
        },
      },
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('forbidden');
  });
});
