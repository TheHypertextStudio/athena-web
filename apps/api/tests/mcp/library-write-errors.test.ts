import { assertDefined } from '@docket/test-utils';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { connect, file, schema } from './library-fixtures';
import { seedMcpSurfaceOrg } from './mcp-surface-fixtures';
import { flushDeferredWork } from '../../src/lib/after-response';

const Written = z.object({ resource: z.object({ id: z.string(), uri: z.string() }) });
async function setup() {
  const s = await seedMcpSurfaceOrg(schema.db, schema, ['view', 'contribute', 'manage']);
  return { s, client: await connect(s.ctx) };
}
function uploadArgs(s: Awaited<ReturnType<typeof setup>>['s']) {
  return {
    orgId: s.orgId,
    subjectType: 'task',
    subjectId: s.taskId,
    requestId: 'report',
    fileName: 'report.txt',
    mimeType: 'text/plain',
    contentBase64: Buffer.from('Report').toString('base64'),
  };
}

describe('Library write failure boundaries', () => {
  it('limits fresh workspace writes while allowing identical accepted retries at the limit', async () => {
    const { s, client } = await setup();
    const args = uploadArgs(s);
    const accepted = await client.callTool({ name: 'upload_resource', arguments: args });
    expect(accepted.isError, JSON.stringify(accepted)).not.toBe(true);
    await schema.db.insert(schema.resourceWriteReceipt).values(
      Array.from({ length: 29 }, (_, index) => ({
        organizationId: s.orgId,
        actorId: s.actorId,
        namespace: 'budget-fixture',
        requestId: `reserved-${index}`,
        requestHash: 'reserved',
        attachmentId: schema.genId(),
      })),
    );
    expect((await client.callTool({ name: 'upload_resource', arguments: args })).isError).not.toBe(
      true,
    );
    const denied = await client.callTool({
      name: 'upload_resource',
      arguments: { ...args, requestId: 'new' },
    });
    expect(denied.isError).toBe(true);
    expect(JSON.stringify(denied.content)).toContain('rate_limited');
    expect(
      await schema.db
        .select()
        .from(schema.attachment)
        .where(eq(schema.attachment.subjectId, s.taskId)),
    ).toHaveLength(1);
  });

  it('accepts exactly 4 MiB and refuses an extra decoded byte', async () => {
    const { s, client } = await setup();
    const args = uploadArgs(s);
    const max = Buffer.alloc(4 * 1024 * 1024, 42);
    const accepted = await client.callTool({
      name: 'upload_resource',
      arguments: { ...args, contentBase64: max.toString('base64') },
    });
    expect(accepted.isError, JSON.stringify(accepted)).not.toBe(true);
    const denied = await client.callTool({
      name: 'upload_resource',
      arguments: {
        ...args,
        requestId: 'over',
        contentBase64: Buffer.alloc(max.length + 1).toString('base64'),
      },
    });
    expect(denied.isError).toBe(true);
  });

  it.each([
    { fileName: '../secret.txt' },
    { fileName: 'bad\r\nname.txt' },
    { mimeType: 'text/plain\r\nX-Injected: yes' },
    { mimeType: 'not-a-media-type' },
  ])('rejects unsafe display metadata', async (change) => {
    const { s, client } = await setup();
    expect(
      (
        await client.callTool({
          name: 'upload_resource',
          arguments: { ...uploadArgs(s), ...change },
        })
      ).isError,
    ).toBe(true);
  });

  it('rechecks registered-agent destination grants on retries', async () => {
    const { s } = await setup();
    await schema.db.insert(schema.grant).values({
      organizationId: s.orgId,
      subjectKind: 'actor',
      subjectId: s.agentActorId,
      resourceKind: 'task',
      resourceId: s.taskId,
      capabilities: ['view', 'contribute'],
      effect: 'allow',
    });
    const client = await connect({
      scopes: ['work:read', 'work:write'],
      principal: {
        kind: 'agent',
        orgId: s.orgId,
        agentId: s.agentId,
        agentActorId: s.agentActorId,
        displayName: 'Agent',
      },
    });
    const args = uploadArgs(s);
    expect((await client.callTool({ name: 'upload_resource', arguments: args })).isError).not.toBe(
      true,
    );
    await schema.db
      .delete(schema.grant)
      .where(
        and(eq(schema.grant.subjectId, s.agentActorId), eq(schema.grant.resourceId, s.taskId)),
      );
    expect((await client.callTool({ name: 'upload_resource', arguments: args })).isError).toBe(
      true,
    );
    expect(
      await schema.db
        .select()
        .from(schema.attachment)
        .where(eq(schema.attachment.subjectId, s.taskId)),
    ).toHaveLength(1);
  });

  it('refuses provider-backed attachments rather than copying integration authority', async () => {
    const { s, client } = await setup();
    const [source] = await schema.db
      .insert(schema.attachment)
      .values({
        organizationId: s.orgId,
        createdBy: s.actorId,
        subjectType: 'task',
        subjectId: s.taskId,
        kind: 'email',
        title: 'Private mail',
        sourceIntegrationId: s.integrationId,
        externalId: 'mail-1',
        metadata: { token: 'private' },
      })
      .returning();
    expect(
      (
        await client.callTool({
          name: 'attach_resource',
          arguments: {
            orgId: s.orgId,
            subjectType: 'task',
            subjectId: s.task2Id,
            requestId: 'mail',
            resource: { kind: 'attachment', id: assertDefined(source).id },
          },
        })
      ).isError,
    ).toBe(true);
    expect(
      await schema.db
        .select()
        .from(schema.attachment)
        .where(eq(schema.attachment.subjectId, s.task2Id)),
    ).toHaveLength(0);
  });

  it('rolls back attachment and activity together and cleans bytes after persistence fails', async () => {
    const { s, client } = await setup();
    const audit = await import('../../src/lib/provenance/audit-events');
    const recorder = vi
      .spyOn(audit, 'insertAuditEvents')
      .mockRejectedValueOnce(new Error('injected transaction failure'));
    const { getContainer } = await import('../../src/container');
    const put = vi.spyOn(getContainer().blob, 'put');
    try {
      expect(
        (await client.callTool({ name: 'upload_resource', arguments: uploadArgs(s) })).isError,
      ).toBe(true);
      await flushDeferredWork();
      const key = assertDefined(put.mock.calls[0]?.[0]);
      expect(await getContainer().blob.get(key)).toBeNull();
      expect(
        await schema.db
          .select()
          .from(schema.attachment)
          .where(eq(schema.attachment.subjectId, s.taskId)),
      ).toHaveLength(0);
      recorder.mockRestore();
      const retry = await client.callTool({ name: 'upload_resource', arguments: uploadArgs(s) });
      expect(retry.isError, JSON.stringify(retry)).not.toBe(true);
    } finally {
      recorder.mockRestore();
      put.mockRestore();
    }
  });

  it('cleans abandoned writes without deleting completed files or forgetting completed retry identity', async () => {
    const { s, client } = await setup();
    const created = await client.callTool({ name: 'upload_resource', arguments: uploadArgs(s) });
    const id = Written.parse(created.structuredContent).resource.id;
    const sourceId = await file(s);
    await schema.db
      .update(schema.attachment)
      .set({ archivedAt: new Date() })
      .where(eq(schema.attachment.id, sourceId));
    const { processAttachmentBlobCleanup } =
      await import('../../src/content/deliverable-blob-cleanup');
    await processAttachmentBlobCleanup();
    expect(
      await schema.db.select().from(schema.attachment).where(eq(schema.attachment.id, sourceId)),
    ).toHaveLength(1);
    const { sweepAbandonedResourceWrites } =
      await import('../../src/content/resource-write-receipt');
    await sweepAbandonedResourceWrites(new Date(Date.now() + 2 * 60 * 60 * 1000));
    expect(
      await schema.db.select().from(schema.attachment).where(eq(schema.attachment.id, id)),
    ).toHaveLength(1);
    expect(
      await schema.db
        .select()
        .from(schema.fileUpload)
        .where(eq(schema.fileUpload.organizationId, s.orgId)),
    ).toHaveLength(1);
  });
});
