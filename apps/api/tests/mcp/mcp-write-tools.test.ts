import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import type { Capability } from '@docket/types';

import type { McpContext } from '../../src/mcp/auth';
import type { registerTools as RegisterTools } from '../../src/mcp/tools';
import { resetAuthMocks } from '../support/auth-mock';
import { getMigratedDb, grantDocketPro } from '../support/db';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let registerTools!: typeof RegisterTools;

beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;
  registerTools = (await import('../../src/mcp/tools')).registerTools;
});

interface Seed {
  userId: string;
  orgId: string;
  teamId: string;
  actorId: string;
  ctx: McpContext;
}

/** Seed an org whose human actor holds `capabilities` org-wide, with one team to land in. */
async function seedOrg(capabilities: readonly Capability[]): Promise<Seed> {
  const slug = `wt-${Math.random().toString(36).slice(2, 10)}`;
  const [org] = await db
    .insert(schema.organization)
    .values({ name: slug, slug, lifecycleState: 'active' })
    .returning({ id: schema.organization.id });
  const orgId = org!.id;
  await grantDocketPro(schema, orgId);

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
  const userId = user!.id;

  const [human] = await db
    .insert(schema.actor)
    .values({
      organizationId: orgId,
      kind: 'human',
      displayName: 'Ada',
      userId,
      roleId: role!.id,
    })
    .returning({ id: schema.actor.id });

  if (capabilities.length > 0) {
    await db.insert(schema.grant).values({
      organizationId: orgId,
      subjectKind: 'role',
      subjectId: role!.id,
      resourceKind: 'organization',
      resourceId: orgId,
      capabilities: [...capabilities],
      effect: 'allow',
    });
  }

  const [team] = await db
    .insert(schema.team)
    .values({
      organizationId: orgId,
      name: 'Core',
      key: `C${Math.random().toString(36).slice(2, 6)}`,
    })
    .returning({ id: schema.team.id });

  return {
    userId,
    orgId,
    teamId: team!.id,
    actorId: human!.id,
    ctx: {
      principal: { kind: 'user', userId, userName: 'Ada', userEmail: email },
      scopes: ['work:read', 'work:write', 'agents:run', 'connectors:link'],
    },
  };
}

const harnesses: { close(): Promise<void> }[] = [];

async function connect(ctx: McpContext): Promise<Client> {
  const server = new McpServer(
    { name: 'test', version: '0.0.0' },
    { capabilities: { tools: {}, resources: {} } },
  );
  registerTools(server, ctx, 'sess_test');
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'c', version: '0.0.0' });
  await Promise.all([server.connect(st), client.connect(ct)]);
  harnesses.push({
    close: async () => {
      await client.close();
      await server.close();
    },
  });
  return client;
}

afterEach(async () => {
  while (harnesses.length > 0) await harnesses.pop()!.close();
  resetAuthMocks();
});

function payload(res: CallToolResult): Record<string, unknown> {
  return JSON.parse((res.content[0] as { text: string }).text) as Record<string, unknown>;
}

describe('capture tool', () => {
  it('lands a task without being told team, state, or cycle', async () => {
    const s = await seedOrg(['contribute']);
    const client = await connect(s.ctx);
    const res = (await client.callTool({
      name: 'capture',
      arguments: { orgId: s.orgId, text: 'Chase the vendor SOC2\nthey went quiet last week' },
    })) as CallToolResult;
    expect(res.isError).toBeFalsy();

    const out = payload(res) as { id: string; title: string; state: string; teamId: string };
    // The first line becomes the title; the whole paste stays as the body.
    expect(out.title).toBe('Chase the vendor SOC2');
    expect(out.teamId).toBe(s.teamId);
    expect(out.state).toBe('backlog');

    const [row] = await db
      .select({ description: schema.task.description, assigneeId: schema.task.assigneeId })
      .from(schema.task)
      .where(eq(schema.task.id, out.id));
    expect(row?.description).toContain('they went quiet last week');
    // Landing assigns the caller, so captured work is not orphaned.
    expect(row?.assigneeId).toBe(s.actorId);
  });

  it('records an origin naming the tool and session', async () => {
    const s = await seedOrg(['contribute']);
    const client = await connect(s.ctx);
    const res = (await client.callTool({
      name: 'capture',
      arguments: { orgId: s.orgId, text: 'Trace me' },
    })) as CallToolResult;
    const { changeSetId } = payload(res) as { changeSetId: string };

    const [set] = await db
      .select({ origin: schema.changeSet.origin, actorId: schema.changeSet.actorId })
      .from(schema.changeSet)
      .where(eq(schema.changeSet.id, changeSetId));
    expect(set?.origin).toMatchObject({ tool: 'capture', sessionId: 'sess_test' });
    // Proxy identity: the change is attributed to the human whose permissions it ran under.
    expect(set?.actorId).toBe(s.actorId);
  });
});

describe('undo tool', () => {
  it('takes back the change it names', async () => {
    const s = await seedOrg(['contribute']);
    const client = await connect(s.ctx);
    const created = payload(
      (await client.callTool({
        name: 'capture',
        arguments: { orgId: s.orgId, text: 'Undo me' },
      })) as CallToolResult,
    ) as { id: string; changeSetId: string };

    const res = (await client.callTool({
      name: 'undo',
      arguments: { orgId: s.orgId, changeSetId: created.changeSetId },
    })) as CallToolResult;
    expect(res.isError).toBeFalsy();
    expect(payload(res)).toMatchObject({ reverted: 1, skipped: [] });

    // Undoing a create archives rather than deletes — the row may already be referenced.
    const [row] = await db
      .select({ archivedAt: schema.task.archivedAt })
      .from(schema.task)
      .where(eq(schema.task.id, created.id));
    expect(row?.archivedAt).not.toBeNull();
  });

  it('defaults to the caller’s own most recent change', async () => {
    const s = await seedOrg(['contribute']);
    const client = await connect(s.ctx);
    await client.callTool({ name: 'capture', arguments: { orgId: s.orgId, text: 'First' } });
    const second = payload(
      (await client.callTool({
        name: 'capture',
        arguments: { orgId: s.orgId, text: 'Second' },
      })) as CallToolResult,
    ) as { id: string };

    const res = (await client.callTool({
      name: 'undo',
      arguments: { orgId: s.orgId },
    })) as CallToolResult;
    expect(payload(res)).toMatchObject({ summary: 'Captured "Second"', reverted: 1 });

    const [row] = await db
      .select({ archivedAt: schema.task.archivedAt })
      .from(schema.task)
      .where(eq(schema.task.id, second.id));
    expect(row?.archivedAt).not.toBeNull();
  });

  it('refuses to clobber a row someone else changed since', async () => {
    const s = await seedOrg(['contribute']);
    const client = await connect(s.ctx);
    const created = payload(
      (await client.callTool({
        name: 'capture',
        arguments: { orgId: s.orgId, text: 'Contested' },
      })) as CallToolResult,
    ) as { id: string; changeSetId: string };

    // Somebody else moves it on before the undo lands.
    await db
      .update(schema.task)
      .set({ state: 'in_progress' })
      .where(eq(schema.task.id, created.id));

    const res = (await client.callTool({
      name: 'undo',
      arguments: { orgId: s.orgId, changeSetId: created.changeSetId },
    })) as CallToolResult;
    const out = payload(res) as {
      reverted: number;
      skipped: { id: string; reason: string }[];
    };
    expect(out.reverted).toBe(0);
    expect(out.skipped).toEqual([{ kind: 'task', id: created.id, reason: 'changed_since' }]);

    // Reversing your own change must not discard someone else's.
    const [row] = await db
      .select({ state: schema.task.state, archivedAt: schema.task.archivedAt })
      .from(schema.task)
      .where(eq(schema.task.id, created.id));
    expect(row?.state).toBe('in_progress');
    expect(row?.archivedAt).toBeNull();
  });

  it('will not undo the same change twice', async () => {
    const s = await seedOrg(['contribute']);
    const client = await connect(s.ctx);
    const created = payload(
      (await client.callTool({
        name: 'capture',
        arguments: { orgId: s.orgId, text: 'Once only' },
      })) as CallToolResult,
    ) as { changeSetId: string };

    await client.callTool({
      name: 'undo',
      arguments: { orgId: s.orgId, changeSetId: created.changeSetId },
    });
    const again = (await client.callTool({
      name: 'undo',
      arguments: { orgId: s.orgId, changeSetId: created.changeSetId },
    })) as CallToolResult;
    expect(again.isError).toBe(true);
  });

  it('cannot reach a change set in another organization', async () => {
    const mine = await seedOrg(['contribute']);
    const theirs = await seedOrg(['contribute']);
    const theirClient = await connect(theirs.ctx);
    const created = payload(
      (await theirClient.callTool({
        name: 'capture',
        arguments: { orgId: theirs.orgId, text: 'Not yours' },
      })) as CallToolResult,
    ) as { changeSetId: string };

    const myClient = await connect(mine.ctx);
    const res = (await myClient.callTool({
      name: 'undo',
      arguments: { orgId: mine.orgId, changeSetId: created.changeSetId },
    })) as CallToolResult;
    expect(res.isError).toBe(true);
  });

  it('has nothing to undo when the caller has made no changes', async () => {
    const s = await seedOrg(['contribute']);
    const client = await connect(s.ctx);
    const res = (await client.callTool({
      name: 'undo',
      arguments: { orgId: s.orgId },
    })) as CallToolResult;
    expect(res.isError).toBe(true);
  });
});

describe('change-set provenance', () => {
  it('answers where a task came from months later', async () => {
    const s = await seedOrg(['contribute']);
    const client = await connect(s.ctx);
    const created = payload(
      (await client.callTool({
        name: 'capture',
        arguments: { orgId: s.orgId, text: 'Whence' },
      })) as CallToolResult,
    ) as { id: string };

    const { originOf } = await import('../../src/mcp/change-set');
    const origin = await originOf('task', created.id);
    expect(origin?.origin).toMatchObject({ tool: 'capture' });
    expect(origin?.actorId).toBe(s.actorId);

    // Nothing was created for a row no tool made.
    const [other] = await db
      .insert(schema.task)
      .values({
        organizationId: s.orgId,
        title: 'Hand made',
        teamId: s.teamId,
        state: 'backlog',
        createdBy: s.actorId,
      })
      .returning({ id: schema.task.id });
    expect(await originOf('task', other!.id)).toBeNull();
  });

  it('leaves provenance_source alone — authorship is a different axis', async () => {
    const s = await seedOrg(['contribute']);
    const client = await connect(s.ctx);
    const created = payload(
      (await client.callTool({
        name: 'capture',
        arguments: { orgId: s.orgId, text: 'Still native' },
      })) as CallToolResult,
    ) as { id: string };

    const [row] = await db
      .select({ source: schema.task.source })
      .from(schema.task)
      .where(and(eq(schema.task.id, created.id), eq(schema.task.organizationId, s.orgId)));
    // `native|linked` means "is this mirrored from an external system", not "who made it".
    expect(row?.source).toBe('native');
  });
});
