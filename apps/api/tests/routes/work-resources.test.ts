import { describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { appWithActor } from '../support/routes-harness';
import { schema, connect } from '../mcp/library-fixtures';
import { seedMcpSurfaceOrg } from '../mcp/mcp-surface-fixtures';

const Created = z.object({ resource: z.object({ id: z.string() }) });

describe('work resource management', () => {
  it('hides a removed file immediately and durably retries storage cleanup', async () => {
    const s = await seedMcpSurfaceOrg(schema.db, schema, ['view', 'contribute', 'manage']);
    const client = await connect(s.ctx);
    const result = await client.callTool({
      name: 'upload_resource',
      arguments: {
        orgId: s.orgId,
        subjectType: 'program',
        subjectId: s.programId,
        requestId: 'cleanup',
        fileName: 'brief.txt',
        contentBase64: Buffer.from('Brief').toString('base64'),
      },
    });
    const id = Created.parse(result.structuredContent).resource.id;
    const router = (await import('../../src/routes/work-resources')).default;
    const app = appWithActor(router, s.orgId, ['view', 'contribute', 'manage'], s.actorId);
    const { getContainer } = await import('../../src/container');
    const deletion = vi
      .spyOn(getContainer().blob, 'delete')
      .mockRejectedValue(new Error('storage unavailable'));
    try {
      expect(
        (await app.request(`/program/${s.programId}/${id}`, { method: 'DELETE' })).status,
      ).toBe(200);
      expect((await app.request(`/program/${s.programId}/${id}/download`)).status).toBe(404);
      expect(
        await schema.db.select().from(schema.attachment).where(eq(schema.attachment.id, id)),
      ).toHaveLength(0);
      const [pending] = await schema.db
        .select()
        .from(schema.attachmentBlobCleanup)
        .where(eq(schema.attachmentBlobCleanup.organizationId, s.orgId));
      expect(pending?.attempts).toBeGreaterThan(0);
    } finally {
      deletion.mockRestore();
    }
    const { processAttachmentBlobCleanup } =
      await import('../../src/content/deliverable-blob-cleanup');
    await schema.db
      .update(schema.attachmentBlobCleanup)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(schema.attachmentBlobCleanup.organizationId, s.orgId));
    await processAttachmentBlobCleanup();
    expect(
      await schema.db.select().from(schema.attachment).where(eq(schema.attachment.id, id)),
    ).toHaveLength(0);
  });

  it.each(['task', 'project', 'program', 'initiative'] as const)(
    'lists, downloads and removes agent files on a %s',
    async (subjectType) => {
      const s = await seedMcpSurfaceOrg(schema.db, schema, ['view', 'contribute', 'manage']);
      const client = await connect(s.ctx);
      const subjectId = s[`${subjectType}Id`];
      const result = await client.callTool({
        name: 'upload_resource',
        arguments: {
          orgId: s.orgId,
          subjectType,
          subjectId,
          requestId: 'managed',
          fileName: 'report.html',
          mimeType: 'text/html',
          contentBase64: Buffer.from('<h1>Report</h1>').toString('base64'),
        },
      });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      const id = Created.parse(result.structuredContent).resource.id;
      const router = (await import('../../src/routes/work-resources')).default;
      const app = appWithActor(router, s.orgId, ['view', 'contribute', 'manage'], s.actorId);
      const path = `/${subjectType}/${subjectId}`;
      const list = await app.request(path);
      expect(list.status).toBe(200);
      expect(await list.json()).toMatchObject({ items: [{ id, kind: 'file' }] });
      const download = await app.request(`${path}/${id}/download`);
      expect(download.headers.get('Content-Disposition')).toMatch(/^attachment;/);
      expect(await download.text()).toBe('<h1>Report</h1>');
      expect((await app.request(`/${subjectType}/${s.task2Id}/${id}/download`)).status).toBe(404);
      expect((await app.request(`${path}/${id}`, { method: 'DELETE' })).status).toBe(200);
      expect((await app.request(`${path}/${id}/download`)).status).toBe(404);
      expect(
        await schema.db.select().from(schema.attachment).where(eq(schema.attachment.id, id)),
      ).toHaveLength(0);
    },
  );
});
