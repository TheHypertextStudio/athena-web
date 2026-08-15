/**
 * `@docket/api` — MCP task-comment disclosure regressions.
 *
 * @remarks
 * These tests run a real identity-bound MCP server against the migrated database. An
 * organization-root grant that does not cascade is deliberately used to prove that generic
 * organization membership cannot disclose a private task's comment through either a resource URI
 * or the semantic `get_comments` tool.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import type { Capability } from '@docket/types';

import type { McpContext } from '../../src/mcp/auth';
import type {
  authorizeResourceUri as AuthorizeResourceUri,
  registerResources as RegisterResources,
} from '../../src/mcp/resources';
import type { registerTools as RegisterTools } from '../../src/mcp/tools';
import { getMigratedDb } from '../support/db';
import { one, seedStatuses } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let authorizeResourceUri!: typeof AuthorizeResourceUri;
let registerResources!: typeof RegisterResources;
let registerTools!: typeof RegisterTools;

beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;
  const resources = await import('../../src/mcp/resources');
  authorizeResourceUri = resources.authorizeResourceUri;
  registerResources = resources.registerResources;
  registerTools = (await import('../../src/mcp/tools')).registerTools;
});

interface Seed {
  readonly orgId: string;
  readonly actorId: string;
  readonly taskId: string;
  readonly commentId: string;
  readonly ctx: McpContext;
}

/** Seed an active human who can read the org but has no cascading or task-level grant. */
async function seedPrivateTaskComment(): Promise<Seed> {
  const slug = `mcp-task-comment-${Math.random().toString(36).slice(2, 10)}`;
  const orgId = one(
    await db
      .insert(schema.organization)
      .values({ name: slug, slug, lifecycleState: 'active' })
      .returning({ id: schema.organization.id }),
  ).id;
  const statusId = await seedStatuses(db, schema, orgId);
  const teamId = one(
    await db
      .insert(schema.team)
      .values({ organizationId: orgId, name: 'Core', key: `K${slug.slice(-5)}` })
      .returning({ id: schema.team.id }),
  ).id;
  const email = `${slug}@example.test`;
  const userId = one(
    await db
      .insert(schema.user)
      .values({ name: 'MCP member', email })
      .returning({ id: schema.user.id }),
  ).id;
  const actorId = one(
    await db
      .insert(schema.actor)
      .values({ organizationId: orgId, kind: 'human', displayName: 'MCP member', userId })
      .returning({ id: schema.actor.id }),
  ).id;
  const taskId = one(
    await db
      .insert(schema.task)
      .values({
        organizationId: orgId,
        teamId,
        title: 'MCP private comment subject',
        state: 'todo',
        statusId: statusId('task', 'todo'),
        visibility: 'private',
        createdBy: actorId,
      })
      .returning({ id: schema.task.id }),
  ).id;
  const commentId = one(
    await db
      .insert(schema.comment)
      .values({
        organizationId: orgId,
        authorId: actorId,
        subjectType: 'task',
        subjectId: taskId,
        body: 'private MCP comment body',
        createdBy: actorId,
      })
      .returning({ id: schema.comment.id }),
  ).id;
  // Exact org view makes ordinary in-org comment reads pass today, but must not turn into a
  // cascading task grant. This is the critical private-task disclosure shape.
  await db.insert(schema.grant).values({
    organizationId: orgId,
    subjectKind: 'actor',
    subjectId: actorId,
    resourceKind: 'organization',
    resourceId: orgId,
    capabilities: ['view'],
    effect: 'allow',
    cascades: false,
  });

  return {
    orgId,
    actorId,
    taskId,
    commentId,
    ctx: {
      principal: { kind: 'user', userId, userName: 'MCP member', userEmail: email },
      scopes: ['work:read', 'work:write'],
    },
  };
}

/** Create an exact task grant and return its id, so the test can update and revoke it live. */
async function grantTask(seed: Seed, capabilities: readonly Capability[]): Promise<string> {
  return one(
    await db
      .insert(schema.grant)
      .values({
        organizationId: seed.orgId,
        subjectKind: 'actor',
        subjectId: seed.actorId,
        resourceKind: 'task',
        resourceId: seed.taskId,
        capabilities: [...capabilities],
        effect: 'allow',
        cascades: false,
      })
      .returning({ id: schema.grant.id }),
  ).id;
}

interface Harness {
  readonly client: Client;
  close(): Promise<void>;
}

const harnesses: Harness[] = [];

/** Register the real tools/resources on an identity-bound in-memory MCP connection. */
async function harnessFor(ctx: McpContext): Promise<Harness> {
  const server = new McpServer(
    { name: 'task-comment-access', version: '0.0.0' },
    { capabilities: { tools: {}, resources: {} } },
  );
  registerTools(server, ctx);
  registerResources(server, ctx);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'task-comment-access-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const harness = {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
  harnesses.push(harness);
  return harness;
}

afterEach(async () => {
  while (harnesses.length > 0) {
    const harness = harnesses.pop();
    if (harness) await harness.close();
  }
});

function toolPayload(result: CallToolResult): Record<string, unknown> {
  return JSON.parse((result.content[0] as { readonly text: string }).text) as Record<
    string,
    unknown
  >;
}

describe('MCP task comments', () => {
  it('does not disclose a hidden task comment through resource or semantic reads, permits direct access, and closes again after revocation', async () => {
    const seed = await seedPrivateTaskComment();
    const { client } = await harnessFor(seed.ctx);
    const uri = `docket://${seed.orgId}/comment/${seed.commentId}`;

    await expect(client.readResource({ uri })).rejects.toThrow(/not_found|Not found/i);
    await expect(authorizeResourceUri(seed.ctx, uri)).rejects.toThrow(/not_found|Not found/i);
    const hiddenRead = (await client.callTool({
      name: 'get_comments',
      arguments: { orgId: seed.orgId, refs: [seed.commentId] },
    })) as CallToolResult;
    expect(hiddenRead.isError).toBeFalsy();
    const hiddenPayload = toolPayload(hiddenRead);
    expect(hiddenPayload['items']).toEqual([]);
    expect(JSON.stringify(hiddenPayload)).not.toContain('private MCP comment body');
    expect(JSON.stringify(hiddenPayload)).not.toContain(uri);

    const taskGrantId = await grantTask(seed, ['view']);
    const directResource = await client.readResource({ uri });
    await expect(authorizeResourceUri(seed.ctx, uri)).resolves.toBeUndefined();
    const directComment = JSON.parse(
      (directResource.contents[0] as { readonly text: string }).text,
    ) as { readonly id: string; readonly body: string };
    expect(directComment).toMatchObject({ id: seed.commentId, body: 'private MCP comment body' });

    // A task-scoped `comment` grant is enough for the old MCP tool but must no longer replace
    // task-level contribution authority.
    await db
      .update(schema.grant)
      .set({ capabilities: ['comment'] })
      .where(and(eq(schema.grant.id, taskGrantId), eq(schema.grant.organizationId, seed.orgId)));
    const commenter = (await client.callTool({
      name: 'comment',
      arguments: {
        orgId: seed.orgId,
        subjectType: 'task',
        subjectId: seed.taskId,
        body: 'must require contribute',
      },
    })) as CallToolResult;
    expect(commenter.isError).toBe(true);

    await db
      .update(schema.grant)
      .set({ capabilities: ['contribute'] })
      .where(and(eq(schema.grant.id, taskGrantId), eq(schema.grant.organizationId, seed.orgId)));
    const contributor = (await client.callTool({
      name: 'comment',
      arguments: {
        orgId: seed.orgId,
        subjectType: 'task',
        subjectId: seed.taskId,
        body: 'direct contributor MCP comment',
      },
    })) as CallToolResult;
    expect(contributor.isError).toBeFalsy();

    await db
      .delete(schema.grant)
      .where(and(eq(schema.grant.id, taskGrantId), eq(schema.grant.organizationId, seed.orgId)));
    await expect(client.readResource({ uri })).rejects.toThrow(/not_found|Not found/i);
    await expect(authorizeResourceUri(seed.ctx, uri)).rejects.toThrow(/not_found|Not found/i);
    const revokedRead = (await client.callTool({
      name: 'get_comments',
      arguments: { orgId: seed.orgId, refs: [seed.commentId] },
    })) as CallToolResult;
    expect(toolPayload(revokedRead)['items']).toEqual([]);
  });
});
