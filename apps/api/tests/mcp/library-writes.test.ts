import { assertDefined } from '@docket/test-utils';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { connect, file, get, index, linked, schema } from './library-fixtures';
import { seedMcpSurfaceOrg } from './mcp-surface-fixtures';

const Written = z.object({
  replayed: z.boolean(),
  resource: z.object({ id: z.string(), uri: z.string(), kind: z.literal('attachment') }),
});
const bytes = Buffer.from('Report from the agent.');

async function writable() {
  return seedMcpSurfaceOrg(schema.db, schema, ['view', 'contribute', 'manage']);
}

describe('MCP Library writes', () => {
  it.each(['task', 'project', 'program', 'initiative'] as const)(
    'uploads a retrievable file to a %s without changing its description',
    async (subjectType) => {
      const s = await writable();
      const subjectId = s[`${subjectType}Id`];
      const client = await connect(s.ctx);
      const args = {
        orgId: s.orgId,
        subjectType,
        subjectId,
        requestId: 'report-1',
        fileName: 'report.txt',
        mimeType: 'text/plain',
        contentBase64: bytes.toString('base64'),
      };
      const result = await client.callTool({ name: 'upload_resource', arguments: args });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      const written = Written.parse(result.structuredContent);
      expect(written.replayed).toBe(false);
      expect(JSON.stringify(result)).not.toMatch(/contentBase64|blobKey|Report from/);
      const content = await client.readResource({ uri: `${written.resource.uri}/content` });
      expect(content.contents[0]).toMatchObject({
        mimeType: 'text/plain',
        blob: bytes.toString('base64'),
      });
      const replay = await client.callTool({ name: 'upload_resource', arguments: args });
      expect(Written.parse(replay.structuredContent)).toEqual({ ...written, replayed: true });
      const conflict = await client.callTool({
        name: 'upload_resource',
        arguments: { ...args, fileName: 'other.txt' },
      });
      expect(conflict.isError).toBe(true);
      const rows = await schema.db
        .select()
        .from(schema.attachment)
        .where(eq(schema.attachment.subjectId, subjectId));
      expect(rows).toHaveLength(1);
    },
  );

  it.each(['task', 'project', 'program', 'initiative'] as const)(
    'attaches a canonical Library link to a %s and reports visible usage',
    async (subjectType) => {
      const s = await writable();
      const id = await linked(s);
      const subjectId = s[`${subjectType}Id`];
      const client = await connect(s.ctx);
      const result = await client.callTool({
        name: 'attach_resource',
        arguments: {
          orgId: s.orgId,
          subjectType,
          subjectId,
          requestId: 'link-1',
          resource: { kind: 'external_resource', id },
        },
      });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      const written = Written.parse(result.structuredContent);
      const [row] = await schema.db
        .select()
        .from(schema.attachment)
        .where(eq(schema.attachment.id, written.resource.id));
      expect(row).toMatchObject({
        subjectType,
        subjectId,
        kind: 'url',
        externalResourceId: id,
        url: 'https://example.com/research',
      });
      await index(subjectType, subjectId);
      expect(await get(client, s.orgId, 'external_resource', id)).toMatchObject({
        resource: { usedBy: { total: 1 } },
      });
    },
  );

  it('copies a readable file without private metadata and survives source removal', async () => {
    const s = await writable();
    const id = await file(s);
    const client = await connect(s.ctx);
    const result = await client.callTool({
      name: 'attach_resource',
      arguments: {
        orgId: s.orgId,
        subjectType: 'task',
        subjectId: s.task2Id,
        requestId: 'copy-1',
        resource: { kind: 'attachment', id },
      },
    });
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    const written = Written.parse(result.structuredContent);
    const [row] = await schema.db
      .select()
      .from(schema.attachment)
      .where(eq(schema.attachment.id, written.resource.id));
    const [source] = await schema.db
      .select()
      .from(schema.attachment)
      .where(eq(schema.attachment.id, id));
    expect(row?.blobKey).not.toBe(source?.blobKey);
    expect(row).toMatchObject({ metadata: null, sourceIntegrationId: null, externalId: null });
    const { getContainer } = await import('../../src/container');
    await getContainer().blob.delete(assertDefined(source?.blobKey));
    await schema.db.delete(schema.attachment).where(eq(schema.attachment.id, id));
    const read = await client.readResource({ uri: `${written.resource.uri}/content` });
    expect(read.contents[0]).toMatchObject({
      blob: Buffer.from('Transit file contents').toString('base64'),
    });
  });

  it('reuses published post files while keeping private drafts outside the Library', async () => {
    const s = await writable();
    const client = await connect(s.ctx);
    const upload = await client.callTool({
      name: 'upload_deliverable',
      arguments: {
        orgId: s.orgId,
        fileName: 'published.md',
        mimeType: 'text/markdown',
        textContent: '# Published result',
      },
    });
    const id = z.object({ id: z.string() }).parse(upload.structuredContent).id;
    const input = {
      orgId: s.orgId,
      subjectType: 'program',
      subjectId: s.programId,
      requestId: 'published-copy',
      resource: { kind: 'attachment', id },
    };
    expect((await client.callTool({ name: 'attach_resource', arguments: input })).isError).toBe(
      true,
    );
    const post = await client.callTool({
      name: 'comment',
      arguments: {
        orgId: s.orgId,
        subjectType: 'task',
        subjectId: s.taskId,
        body: 'Published result for reuse',
        attachmentIds: [id],
      },
    });
    expect(post.isError, JSON.stringify(post)).not.toBe(true);
    const copied = await client.callTool({ name: 'attach_resource', arguments: input });
    expect(copied.isError, JSON.stringify(copied)).not.toBe(true);
    const written = Written.parse(copied.structuredContent);
    const read = await client.readResource({ uri: `${written.resource.uri}/content` });
    expect(read.contents[0]).toMatchObject({
      blob: Buffer.from('# Published result').toString('base64'),
    });
    for (const subjectType of ['draft', 'comment', 'update']) {
      expect(
        (
          await client.callTool({
            name: 'attach_resource',
            arguments: { ...input, requestId: `bad-${subjectType}`, subjectType },
          })
        ).isError,
      ).toBe(true);
    }
  });

  it('rejects read-only scopes, foreign resources and private source access', async () => {
    const s = await writable();
    const foreign = await writable();
    const foreignId = await linked(foreign);
    const sourceId = await file(s);
    const args = {
      orgId: s.orgId,
      subjectType: 'task',
      subjectId: s.task2Id,
      requestId: 'denied',
      resource: { kind: 'attachment', id: sourceId },
    };
    const reader = await connect({ ...s.ctx, scopes: ['work:read'] });
    expect((await reader.callTool({ name: 'attach_resource', arguments: args })).isError).toBe(
      true,
    );
    const client = await connect(s.ctx);
    expect(
      (
        await client.callTool({
          name: 'attach_resource',
          arguments: { ...args, resource: { kind: 'external_resource', id: foreignId } },
        })
      ).isError,
    ).toBe(true);
    await schema.db
      .update(schema.task)
      .set({ visibility: 'private' })
      .where(eq(schema.task.id, s.taskId));
    const agent = await connect({
      scopes: ['work:read', 'work:write'],
      principal: {
        kind: 'agent',
        orgId: s.orgId,
        agentId: s.agentId,
        agentActorId: s.agentActorId,
        displayName: 'Agent',
      },
    });
    expect((await agent.callTool({ name: 'attach_resource', arguments: args })).isError).toBe(true);
  });

  it.each(['', 'not base64', 'YQ', 'YR==', 'YQ==\n', 'A'.repeat(5_592_409)])(
    'refuses malformed, empty or oversized content before persistence',
    async (contentBase64) => {
      const s = await writable();
      const client = await connect(s.ctx);
      const result = await client.callTool({
        name: 'upload_resource',
        arguments: {
          orgId: s.orgId,
          subjectType: 'task',
          subjectId: s.taskId,
          requestId: 'bad',
          fileName: 'bad.txt',
          contentBase64,
        },
      });
      expect(result.isError).toBe(true);
      expect(
        await schema.db
          .select()
          .from(schema.attachment)
          .where(eq(schema.attachment.subjectId, s.taskId)),
      ).toHaveLength(0);
    },
  );

  it('coalesces concurrent retries and refuses to resurrect a removed attachment', async () => {
    const s = await writable();
    const a = await connect(s.ctx);
    const b = await connect(s.ctx);
    const args = {
      orgId: s.orgId,
      subjectType: 'program',
      subjectId: s.programId,
      requestId: 'concurrent',
      fileName: 'a.txt',
      contentBase64: bytes.toString('base64'),
    };
    const results = await Promise.all(
      [a, b].map((client) => client.callTool({ name: 'upload_resource', arguments: args })),
    );
    const written = results.map((r) => Written.parse(r.structuredContent));
    expect(new Set(written.map((r) => r.resource.id)).size).toBe(1);
    const id = assertDefined(written[0]).resource.id;
    await schema.db.delete(schema.attachment).where(eq(schema.attachment.id, id));
    expect((await a.callTool({ name: 'upload_resource', arguments: args })).isError).toBe(true);
    expect(
      await schema.db
        .select()
        .from(schema.attachment)
        .where(eq(schema.attachment.subjectId, s.programId)),
    ).toHaveLength(0);
  });
});
