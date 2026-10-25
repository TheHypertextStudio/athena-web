/** The person who grants access and the client that writes content stay distinct. */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import { DeliverableOut } from '@docket/work/attachment-contract';
import { assertDefined } from '@docket/test-utils';

import type { McpContext } from '../../src/mcp/auth';
import { createMcpCatalog } from '../../src/mcp/catalog';
import { onError } from '../../src/error';
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

describe('agent deliverables', () => {
  it('streams local binaries with a short-lived upload token and attaches the returned draft', async () => {
    const seed = await seedMcpSurfaceOrg(db, schema, ['contribute']);
    const client = await connect({ ...seed.ctx, clientId: 'streaming-agent', clientName: 'Codex' });
    const sessionResult = CallToolResultSchema.parse(
      await client.callTool({
        name: 'create_deliverable_upload_session',
        arguments: {
          orgId: seed.orgId,
          fileName: 'render.pdf',
          mimeType: 'application/pdf',
        },
      }),
    );
    expect(sessionResult.isError ?? false).toBe(false);
    const sessionBlock = sessionResult.content[0];
    if (sessionBlock?.type !== 'text') throw new Error('tool returned no upload session');
    const session = JSON.parse(sessionBlock.text) as {
      uploadUrl: string;
      uploadToken: string;
      expiresAt: string;
    };
    expect(new Date(session.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const { app } = await import('../../src/app');
    const form = new FormData();
    form.set('file', new File(['finished binary work'], 'render.pdf', { type: 'application/pdf' }));
    const uploadedResponse = await app.request(new URL(session.uploadUrl).pathname, {
      method: 'POST',
      headers: { 'X-Docket-Upload-Token': session.uploadToken },
      body: form,
    });
    expect(uploadedResponse.status).toBe(201);
    const uploaded = DeliverableOut.parse(await uploadedResponse.json());

    const posted = CallToolResultSchema.parse(
      await client.callTool({
        name: 'comment',
        arguments: {
          orgId: seed.orgId,
          subjectType: 'project',
          subjectId: seed.projectId,
          body: 'The PDF is attached.',
          attachmentIds: [uploaded.id],
        },
      }),
    );
    const postBlock = posted.content[0];
    if (postBlock?.type !== 'text') throw new Error('comment tool returned no post');
    expect(JSON.parse(postBlock.text)).toMatchObject({ attachments: [{ id: uploaded.id }] });

    const retryForm = new FormData();
    retryForm.set(
      'file',
      new File(['finished binary work'], 'render.pdf', { type: 'application/pdf' }),
    );
    const retry = await app.request(new URL(session.uploadUrl).pathname, {
      method: 'POST',
      headers: { 'X-Docket-Upload-Token': session.uploadToken },
      body: retryForm,
    });
    expect(DeliverableOut.parse(await retry.json()).id).toBe(uploaded.id);

    const changedForm = new FormData();
    changedForm.set(
      'file',
      new File(['different bytes'], 'render.pdf', { type: 'application/pdf' }),
    );
    const uploadApp = new Hono().route('/', app);
    uploadApp.onError(onError);
    const changed = await uploadApp.request(new URL(session.uploadUrl).pathname, {
      method: 'POST',
      headers: { 'X-Docket-Upload-Token': session.uploadToken },
      body: changedForm,
    });
    expect(changed.status).toBe(422);
    expect(await changed.json()).toMatchObject({ code: 'idempotency_key_reuse' });
  });

  it('uploads UTF-8 directly and lets the same agent recover its private draft', async () => {
    const seed = await seedMcpSurfaceOrg(db, schema, ['contribute']);
    const client = await connect({ ...seed.ctx, clientId: 'recoverable-agent' });
    const uploaded = CallToolResultSchema.parse(
      await client.callTool({
        name: 'upload_deliverable',
        arguments: {
          orgId: seed.orgId,
          fileName: 'notes.md',
          mimeType: 'text/markdown',
          textContent: '# Finished work',
        },
      }),
    );
    expect(uploaded.isError ?? false).toBe(false);
    const recovered = CallToolResultSchema.parse(
      await client.callTool({
        name: 'list_my_deliverable_drafts',
        arguments: { orgId: seed.orgId },
      }),
    );
    expect(recovered.structuredContent).toMatchObject({
      items: [{ id: idOf(uploaded), fileName: 'notes.md' }],
    });
  });

  it('replays an MCP post by requestId and rejects changed content under the same key', async () => {
    const seed = await seedMcpSurfaceOrg(db, schema, ['contribute']);
    const client = await connect({ ...seed.ctx, clientId: 'retry-agent' });
    const requestId = crypto.randomUUID();
    const input = {
      orgId: seed.orgId,
      subjectType: 'project',
      subjectId: seed.projectId,
      body: 'One authored result',
      requestId,
    };
    const first = CallToolResultSchema.parse(
      await client.callTool({ name: 'comment', arguments: input }),
    );
    const replay = CallToolResultSchema.parse(
      await client.callTool({ name: 'comment', arguments: input }),
    );
    expect(idOf(replay)).toBe(idOf(first));
    const conflict = CallToolResultSchema.parse(
      await client.callTool({
        name: 'comment',
        arguments: { ...input, body: 'Changed result' },
      }),
    );
    expect(conflict.isError).toBe(true);
    expect(
      await db.select().from(schema.comment).where(eq(schema.comment.subjectId, seed.projectId)),
    ).toHaveLength(1);
  });

  it('uploads work and attaches it to both comments and status updates', async () => {
    const seed = await seedMcpSurfaceOrg(db, schema, ['contribute']);
    const client = await connect({
      ...seed.ctx,
      clientId: 'deliverable-agent',
      clientName: 'Codex',
    });
    for (const name of ['comment', 'report_status']) {
      const uploadIdempotencyKey = crypto.randomUUID();
      const uploadInput = {
        orgId: seed.orgId,
        fileName: 'result.txt',
        mimeType: 'text/plain',
        textContent: 'Finished work',
        uploadId: uploadIdempotencyKey,
      };
      const uploadId = idOf(
        await client.callTool({
          name: 'upload_deliverable',
          arguments: uploadInput,
        }),
      );
      expect(
        idOf(await client.callTool({ name: 'upload_deliverable', arguments: uploadInput })),
      ).toBe(uploadId);
      const requestId = crypto.randomUUID();
      const postInput = {
        orgId: seed.orgId,
        subjectType: 'project',
        subjectId: seed.projectId,
        body: 'The deliverable is attached.',
        attachmentIds: [uploadId],
        requestId,
      };
      const postId = idOf(
        await client.callTool({
          name,
          arguments: postInput,
        }),
      );
      expect(idOf(await client.callTool({ name, arguments: postInput }))).toBe(postId);
      const result = CallToolResultSchema.parse(
        await client.callTool({
          name: 'list_deliverables',
          arguments: {
            orgId: seed.orgId,
            subjectType: name === 'comment' ? 'comment' : 'update',
            subjectId: postId,
          },
        }),
      );
      expect(result.isError ?? false).toBe(false);
      expect(result.structuredContent).toMatchObject({
        items: [{ id: uploadId, fileName: 'result.txt' }],
      });
    }
  });

  it('does not let a different OAuth client claim a private upload under the same human authority', async () => {
    const seed = await seedMcpSurfaceOrg(db, schema, ['contribute']);
    const owner = await connect({ ...seed.ctx, clientId: 'owner-agent', clientName: 'Owner' });
    const other = await connect({ ...seed.ctx, clientId: 'other-agent', clientName: 'Other' });
    const fileId = idOf(
      await owner.callTool({
        name: 'upload_deliverable',
        arguments: {
          orgId: seed.orgId,
          fileName: 'private.txt',
          base64: Buffer.from('Work').toString('base64'),
        },
      }),
    );
    const result = CallToolResultSchema.parse(
      await other.callTool({
        name: 'comment',
        arguments: {
          orgId: seed.orgId,
          subjectType: 'task',
          subjectId: seed.taskId,
          body: 'Claim',
          attachmentIds: [fileId],
        },
      }),
    );
    expect(result.isError).toBe(true);
    const [file] = await db
      .select()
      .from(schema.attachment)
      .where(eq(schema.attachment.id, fileId));
    expect(file?.subjectType).toBe('draft');
  });

  it('rejects malformed base64 and read-only upload scopes', async () => {
    const seed = await seedMcpSurfaceOrg(db, schema, ['contribute']);
    const client = await connect({ ...seed.ctx, clientId: 'invalid-upload' });
    const malformed = CallToolResultSchema.parse(
      await client.callTool({
        name: 'upload_deliverable',
        arguments: { orgId: seed.orgId, fileName: 'bad.txt', base64: 'not base64!' },
      }),
    );
    expect(malformed.isError).toBe(true);
    const readonly = await connect({ ...seed.ctx, scopes: ['work:read'], clientId: 'reader' });
    const denied = CallToolResultSchema.parse(
      await readonly.callTool({
        name: 'upload_deliverable',
        arguments: { orgId: seed.orgId, fileName: 'bad.txt', base64: 'd29yaw==' },
      }),
    );
    expect(denied.isError).toBe(true);
  });
});

describe('deliverable upload bounds', () => {
  it('accepts the full 4 MB limit without overflowing validation and rejects larger bytes', async () => {
    const seed = await seedMcpSurfaceOrg(db, schema, ['contribute']);
    const client = await connect({ ...seed.ctx, clientId: 'bounded-upload' });
    const argumentsFor = (size: number) => ({
      orgId: seed.orgId,
      fileName: 'work.bin',
      base64: Buffer.alloc(size).toString('base64'),
    });
    const accepted = CallToolResultSchema.parse(
      await client.callTool({
        name: 'upload_deliverable',
        arguments: argumentsFor(4 * 1024 * 1024),
      }),
    );
    expect(accepted.isError ?? false).toBe(false);
    const rejected = CallToolResultSchema.parse(
      await client.callTool({
        name: 'upload_deliverable',
        arguments: argumentsFor(4 * 1024 * 1024 + 1),
      }),
    );
    expect(rejected.isError).toBe(true);
  });
});
