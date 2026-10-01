/** The person who grants access and the client that writes content stay distinct. */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import { assertDefined } from '@docket/test-utils';

import type { McpContext } from '../../src/mcp/auth';
import { createMcpCatalog } from '../../src/mcp/catalog';
import { ownsAuthoredContent } from '../../src/lib/provenance/authored-content';
import {
  appProvenance,
  clientProvenance,
  runWithProvenance,
} from '../../src/lib/provenance/context';
import type { registerTools as RegisterTools } from '../../src/mcp/tools';
import type { emitEvent as EmitEvent } from '../../src/routes/event-emit';
import '../support/auth-mock';
import { getMigratedDb } from '../support/db';
import { seedMcpSurfaceOrg } from './mcp-surface-fixtures';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let registerTools!: typeof RegisterTools;
let emitEvent!: typeof EmitEvent;

beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;
  registerTools = (await import('../../src/mcp/tools')).registerTools;
  emitEvent = (await import('../../src/routes/event-emit')).emitEvent;
});

const close: (() => Promise<void>)[] = [];

/** Connect one in-memory MCP client to the real tool catalog. */
async function connect(ctx: McpContext): Promise<Client> {
  const server = new McpServer({ name: 'attribution-test', version: '1.0.0' });
  registerTools(createMcpCatalog(server), ctx);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'attribution-test', version: '1.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  close.push(async () => {
    await client.close();
    await server.close();
  });
  return client;
}

afterEach(async () => {
  while (close.length > 0) await assertDefined(close.pop())();
});

/** Read the id that a successful content tool returned. */
function idOf(result: unknown): string {
  const parsed = CallToolResultSchema.parse(result);
  expect(parsed.isError ?? false).toBe(false);
  const text = parsed.content[0];
  if (text?.type !== 'text') throw new Error('tool returned no text');
  return (JSON.parse(text.text) as { id: string }).id;
}

describe('authored content', () => {
  it('lets only the verified performer claim ownership of agent and human content', () => {
    const agentRow = {
      authorId: null,
      createdBy: 'human-actor',
      origin: {
        v: 2 as const,
        channel: 'mcp' as const,
        tool: 'comment',
        performer: { kind: 'agent' as const, name: 'Codex' },
        client: 'Codex',
        clientId: 'codex-client',
      },
    };
    expect(
      runWithProvenance(clientProvenance('api', { name: 'Codex', id: 'codex-client' }), () =>
        ownsAuthoredContent(agentRow, 'human-actor'),
      ),
    ).toBe(true);
    expect(
      runWithProvenance(appProvenance(), () => ownsAuthoredContent(agentRow, 'human-actor')),
    ).toBe(false);
    expect(
      runWithProvenance(clientProvenance('api', { name: 'Other', id: 'other-client' }), () =>
        ownsAuthoredContent(agentRow, 'human-actor'),
      ),
    ).toBe(false);
    expect(
      runWithProvenance(clientProvenance('api', { name: 'Codex', id: 'codex-client' }), () =>
        ownsAuthoredContent(
          { authorId: 'human-actor', createdBy: 'human-actor', origin: null },
          'human-actor',
        ),
      ),
    ).toBe(false);
  });

  it('credits a connected agent for its comment while retaining the human authority', async () => {
    const seed = await seedMcpSurfaceOrg(db, schema, ['contribute']);
    const agent = await connect({ ...seed.ctx, clientId: 'codex-client', clientName: 'Codex' });
    const id = idOf(
      await agent.callTool({
        name: 'comment',
        arguments: {
          orgId: seed.orgId,
          subjectType: 'task',
          subjectId: seed.taskId,
          body: 'Agent note',
        },
      }),
    );
    const [agentRow] = await db.select().from(schema.comment).where(eq(schema.comment.id, id));
    expect(agentRow).toMatchObject({
      authorId: null,
      createdBy: seed.actorId,
      origin: { channel: 'mcp', performer: { kind: 'agent', name: 'Codex' } },
    });

    const human = await connect(seed.ctx);
    const humanId = idOf(
      await human.callTool({
        name: 'comment',
        arguments: {
          orgId: seed.orgId,
          subjectType: 'task',
          subjectId: seed.taskId,
          body: 'My note',
        },
      }),
    );
    const [humanRow] = await db.select().from(schema.comment).where(eq(schema.comment.id, humanId));
    expect(humanRow).toMatchObject({
      authorId: seed.actorId,
      origin: { channel: 'mcp', performer: { kind: 'person' } },
    });
  });

  it('credits the connected agent for its status report', async () => {
    const seed = await seedMcpSurfaceOrg(db, schema, ['contribute']);
    const client = await connect({ ...seed.ctx, clientId: 'codex-client', clientName: 'Codex' });
    const id = idOf(
      await client.callTool({
        name: 'report_status',
        arguments: {
          orgId: seed.orgId,
          subjectType: 'project',
          subjectId: seed.projectId,
          body: 'Agent status',
        },
      }),
    );
    const [row] = await db.select().from(schema.update).where(eq(schema.update.id, id));
    expect(row).toMatchObject({
      authorId: null,
      createdBy: seed.actorId,
      origin: { channel: 'mcp', performer: { kind: 'agent', name: 'Codex' } },
    });
  });

  it('names the agent in the stream without suppressing its human owner', async () => {
    const seed = await seedMcpSurfaceOrg(db, schema, ['contribute']);
    await emitEvent({
      organizationId: seed.orgId,
      kind: 'comment',
      title: 'Agent comment',
      actorId: null,
      actorRef: {
        source: 'docket',
        externalId: 'codex-client',
        displayName: 'Codex',
        avatarUrl: null,
        docketActorId: null,
      },
      subject: { type: 'task', id: seed.taskId },
    });

    const [recorded] = await db
      .select()
      .from(schema.event)
      .where(and(eq(schema.event.organizationId, seed.orgId), eq(schema.event.kind, 'comment')));
    expect(recorded?.actor?.displayName).toBe('Codex');
    const recipients = await db
      .select()
      .from(schema.eventRecipient)
      .where(eq(schema.eventRecipient.eventId, assertDefined(recorded).id));
    expect(recipients.map((row) => row.userId)).toContain(seed.userId);
  });
});
