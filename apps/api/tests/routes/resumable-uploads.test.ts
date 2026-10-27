import { OrganizationId } from '@docket/identity-access/ids';
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { appWithActor } from '../support/routes-harness';
import { schema, connect } from '../mcp/library-fixtures';
import { seedMcpSurfaceOrg } from '../mcp/mcp-surface-fixtures';
import { uploadRoutes, uploadBytesRoutes } from '../../src/routes/uploads';
import type { AppEnv } from '../../src/context';

const Session = z.object({
  id: z.string(),
  state: z.string(),
  offset: z.number(),
  uploadUrl: z.string().optional(),
  uploadToken: z.string().optional(),
  file: z.object({ id: z.string() }).optional(),
});
const metadata = {
  fileName: 'report.txt',
  mimeType: 'text/plain',
  byteSize: 9,
  crc32c: '4waSgw==',
};
const ownedWorkspaces: string[] = [];
afterEach(async () => {
  const { getContainer } = await import('../../src/container');
  for (const orgId of ownedWorkspaces.splice(0)) {
    const files = await schema.db
      .select()
      .from(schema.attachment)
      .where(eq(schema.attachment.organizationId, orgId));
    const pending = await schema.db
      .select()
      .from(schema.fileUpload)
      .where(eq(schema.fileUpload.organizationId, orgId));
    const keys = new Set([
      ...files.flatMap((file) => (file.blobKey ? [file.blobKey] : [])),
      ...pending.map((upload) => upload.blobKey),
    ]);
    for (const key of keys) {
      await getContainer().blob.transfer.cancel(key, null);
      await getContainer().blob.delete(key);
    }
  }
});
async function fixture() {
  const s = await seedMcpSurfaceOrg(schema.db, schema, ['view', 'contribute', 'manage']);
  ownedWorkspaces.push(s.orgId);
  const router = new Hono<AppEnv>()
    .route('/uploads', uploadRoutes)
    .route('/file-uploads', uploadBytesRoutes);
  return { ...s, app: appWithActor(router, s.orgId, ['manage'], s.actorId) };
}
async function begin(
  f: Awaited<ReturnType<typeof fixture>>,
  destination: unknown = { kind: 'draft' },
  changes = {},
) {
  return f.app.request('/uploads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...metadata, requestId: 'stable', destination, ...changes }),
  });
}
async function send(
  f: Awaited<ReturnType<typeof fixture>>,
  session: z.infer<typeof Session>,
  data: string,
  start: number,
) {
  return f.app.request(`/file-uploads/${session.id}/bytes`, {
    method: 'PUT',
    headers: {
      'X-Docket-Upload-Token': session.uploadToken ?? '',
      'Content-Range': `bytes ${start}-${start + data.length - 1}/9`,
    },
    body: data,
  });
}
async function finish(f: Awaited<ReturnType<typeof fixture>>, id: string) {
  return f.app.request(`/uploads/${id}/completion`, { method: 'POST' });
}

describe('shared resumable uploads', () => {
  it.each(['task', 'project', 'program', 'initiative'] as const)(
    'resumes and publishes one file on %s',
    async (subjectType) => {
      const f = await fixture();
      const session = Session.parse(
        await (
          await begin(f, { kind: 'work', subjectType, subjectId: f[`${subjectType}Id`] })
        ).json(),
      );
      expect(session.offset).toBe(0);
      expect((await send(f, session, '123', 0)).status).toBe(308);
      const recovered = Session.parse(await (await f.app.request(`/uploads/${session.id}`)).json());
      expect(recovered.offset).toBe(3);
      expect((await send(f, session, '456789', 3)).status).toBe(200);
      const [firstCompletion, concurrentCompletion] = await Promise.all([
        finish(f, session.id),
        finish(f, session.id),
      ]);
      const completed = Session.parse(await firstCompletion.json());
      expect(Session.parse(await concurrentCompletion.json()).file?.id).toBe(completed.file?.id);
      expect(completed.state).toBe('completed');
      expect(completed.file).toBeDefined();
      expect(completed.uploadToken).toBeUndefined();
      expect(completed.uploadUrl).toBeUndefined();
      expect(Session.parse(await (await finish(f, session.id)).json()).file?.id).toBe(
        completed.file?.id,
      );
      const [row] = await schema.db
        .select()
        .from(schema.attachment)
        .where(eq(schema.attachment.id, completed.file?.id ?? ''));
      expect(row).toMatchObject({ subjectType, subjectId: f[`${subjectType}Id`], byteSize: 9 });
      const { getContainer } = await import('../../src/container');
      expect(await getContainer().blob.get(row?.blobKey ?? '')).toEqual(
        new TextEncoder().encode('123456789'),
      );
      await schema.db
        .delete(schema.attachment)
        .where(eq(schema.attachment.id, completed.file?.id ?? ''));
      expect((await finish(f, session.id)).status).toBe(409);
    },
  );
  it('replays identical begin and rejects changed bytes, oversized files and other owners', async () => {
    const f = await fixture();
    const first = Session.parse(await (await begin(f)).json());
    expect(Session.parse(await (await begin(f)).json()).id).toBe(first.id);
    expect((await begin(f, undefined, { crc32c: 'AAAAAA==' })).status).toBe(409);
    expect((await begin(f, undefined, { byteSize: 100 * 1024 * 1024 + 1 })).status).toBe(422);
    const other = appWithActor(uploadRoutes, f.orgId, ['manage'], f.agentActorId);
    expect((await other.request(`/${first.id}`)).status).toBe(404);
    expect(
      (
        await f.app.request(`/file-uploads/${first.id}/bytes`, {
          method: 'PUT',
          headers: { 'X-Docket-Upload-Token': 'wrong', 'Content-Range': 'bytes 0-8/9' },
          body: '123456789',
        })
      ).status,
    ).toBe(404);
  });
  it('keeps drafts private, rejects incomplete completion and retires paused sessions', async () => {
    const f = await fixture();
    const session = Session.parse(await (await begin(f)).json());
    expect((await finish(f, session.id)).status).toBe(409);
    await send(f, session, '123', 0);
    expect((await f.app.request(`/uploads/${session.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await send(f, session, '456789', 3)).status).toBe(404);
    expect((await finish(f, session.id)).status).toBe(409);
  });
  it('exposes the same session through MCP without binary tool payloads', async () => {
    const f = await fixture();
    const client = await connect(f.ctx);
    const result = await client.callTool({
      name: 'manage_upload',
      arguments: {
        orgId: f.orgId,
        action: 'begin',
        ...metadata,
        requestId: 'mcp',
        destination: { kind: 'draft' },
      },
    });
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    const session = Session.parse(result.structuredContent);
    expect(session.uploadUrl).toBeDefined();
    const status = await client.callTool({
      name: 'manage_upload',
      arguments: { orgId: f.orgId, action: 'status', uploadId: session.id },
    });
    expect(status.isError, JSON.stringify(status)).not.toBe(true);
    expect(Session.parse(status.structuredContent)).toMatchObject({ id: session.id, offset: 0 });
    await send(f, session, '123456789', 0);
    const completed = await client.callTool({
      name: 'manage_upload',
      arguments: { orgId: f.orgId, action: 'complete', uploadId: session.id },
    });
    expect(completed.isError, JSON.stringify(completed)).not.toBe(true);
    expect(Session.parse(completed.structuredContent)).toMatchObject({
      id: session.id,
      state: 'completed',
      file: { id: expect.any(String) },
    });
    const pending = await client.callTool({
      name: 'manage_upload',
      arguments: {
        orgId: f.orgId,
        action: 'begin',
        ...metadata,
        requestId: 'mcp-cancel',
        destination: { kind: 'draft' },
      },
    });
    expect(pending.isError, JSON.stringify(pending)).not.toBe(true);
    const cancelled = await client.callTool({
      name: 'manage_upload',
      arguments: {
        orgId: f.orgId,
        action: 'cancel',
        uploadId: Session.parse(pending.structuredContent).id,
      },
    });
    expect(cancelled.isError, JSON.stringify(cancelled)).not.toBe(true);
    expect(cancelled.structuredContent).toEqual({ removed: true });
  });
  it('streams an accepted large file and copies Library bytes without whole-object reads', async () => {
    const f = await fixture();
    const session = Session.parse(await (await begin(f)).json());
    await send(f, session, '123456789', 0);
    const completed = Session.parse(await (await finish(f, session.id)).json());
    const { deliverableRoutes } = await import('../../src/routes/deliverables');
    const app = appWithActor(deliverableRoutes, f.orgId, ['manage'], f.actorId);
    const { getContainer } = await import('../../src/container');
    const get = vi
      .spyOn(getContainer().blob, 'get')
      .mockRejectedValue(new Error('whole object read forbidden'));
    try {
      const response = await app.request(`/${completed.file?.id}/download`, {
        headers: { Range: 'bytes=2-5' },
      });
      expect(response.status).toBe(206);
      expect(await response.text()).toBe('3456');
    } finally {
      get.mockRestore();
    }
  });
  it('retains cleanup identity after workspace deletion until storage acknowledges cleanup', async () => {
    const f = await fixture();
    const session = Session.parse(await (await begin(f)).json());
    await send(f, session, '123', 0);
    await schema.db.delete(schema.organization).where(eq(schema.organization.id, f.orgId));
    expect(
      await schema.db.select().from(schema.fileUpload).where(eq(schema.fileUpload.id, session.id)),
    ).toHaveLength(1);
    const { sweepExpiredUploads } = await import('../../src/content/upload-cleanup');
    await sweepExpiredUploads();
    expect(
      await schema.db.select().from(schema.fileUpload).where(eq(schema.fileUpload.id, session.id)),
    ).toHaveLength(0);
  });
  it('does not recreate bytes when a cleaned buffered request is retried', async () => {
    const f = await fixture();
    const requestId = crypto.randomUUID();
    const session = Session.parse(await (await begin(f, { kind: 'draft' }, { requestId })).json());
    await f.app.request(`/uploads/${session.id}`, { method: 'DELETE' });
    const { deliverableRoutes } = await import('../../src/routes/deliverables');
    const app = appWithActor(deliverableRoutes, f.orgId, ['manage'], f.actorId);
    const body = new FormData();
    body.set('file', new File(['123456789'], 'report.txt', { type: 'text/plain' }));
    body.set('uploadId', requestId);
    expect((await app.request('/', { method: 'POST', body })).status).toBe(422);
    const [receipt] = await schema.db
      .select()
      .from(schema.fileUpload)
      .where(eq(schema.fileUpload.id, session.id));
    const { getContainer } = await import('../../src/container');
    expect(await getContainer().blob.get(receipt?.blobKey ?? '')).toBeNull();
  });
  it('keeps the authenticated download reference in serialized Library metadata', async () => {
    const f = await fixture();
    const session = Session.parse(
      await (await begin(f, { kind: 'work', subjectType: 'task', subjectId: f.taskId })).json(),
    );
    await send(f, session, '123456789', 0);
    const completed = Session.parse(await (await finish(f, session.id)).json());
    const [row] = await schema.db
      .select()
      .from(schema.attachment)
      .where(eq(schema.attachment.id, completed.file?.id ?? ''));
    if (!row) throw new Error('Missing fixture file');
    const { summarizeLibraryResource } = await import('../../src/content/library-source');
    const resource = summarizeLibraryResource(
      { orgId: OrganizationId.parse(f.orgId), kind: 'attachment', id: row.id },
      row,
      [],
    );
    expect(resource.metadata).toHaveProperty(
      'downloadUrl',
      `/v1/orgs/${f.orgId}/deliverables/${row.id}/download`,
    );
  });

  it('uploads above the old inline ceiling and enforces exact integrity', async () => {
    const f = await fixture();
    const bytes = new Uint8Array(5 * 1024 * 1024).fill(97);
    const { Crc32c } = await import('@docket/blob-store/checksum');
    const crc = new Crc32c();
    crc.update(bytes);
    const session = Session.parse(
      await (
        await begin(f, { kind: 'draft' }, { byteSize: bytes.length, crc32c: crc.digest() })
      ).json(),
    );
    const response = await f.app.request(`/file-uploads/${session.id}/bytes`, {
      method: 'PUT',
      headers: {
        'X-Docket-Upload-Token': session.uploadToken ?? '',
        'Content-Range': `bytes 0-${bytes.length - 1}/${bytes.length}`,
      },
      body: bytes,
    });
    expect(response.status).toBe(200);
    expect((await finish(f, session.id)).status).toBe(200);
    const bounded = await begin(
      f,
      { kind: 'draft' },
      { requestId: 'ceiling', byteSize: 100 * 1024 * 1024 },
    );
    expect(bounded.status).toBe(200);
    const corrupt = Session.parse(
      await (await begin(f, { kind: 'draft' }, { requestId: 'corrupt' })).json(),
    );
    expect((await send(f, corrupt, 'xxxxxxxxx', 0)).status).toBe(409);
    expect((await finish(f, corrupt.id)).status).toBe(409);
  });
  it('retains cancelled cleanup for retry after a provider failure and never cleans an accepted winner', async () => {
    const f = await fixture();
    const session = Session.parse(await (await begin(f)).json());
    await send(f, session, '123', 0);
    const { getContainer } = await import('../../src/container');
    const cancel = vi
      .spyOn(getContainer().blob.transfer, 'cancel')
      .mockRejectedValueOnce(new Error('provider unavailable'));
    try {
      expect((await f.app.request(`/uploads/${session.id}`, { method: 'DELETE' })).status).toBe(
        500,
      );
    } finally {
      cancel.mockRestore();
    }
    const [row] = await schema.db
      .select()
      .from(schema.fileUpload)
      .where(eq(schema.fileUpload.id, session.id));
    expect(row?.state).toBe('cancelled');
    const { sweepExpiredUploads } = await import('../../src/content/upload-cleanup');
    await sweepExpiredUploads();
    expect((await send(f, session, '456789', 3)).status).toBe(404);
    const accepted = Session.parse(
      await (await begin(f, { kind: 'draft' }, { requestId: 'accepted' })).json(),
    );
    await send(f, accepted, '123456789', 0);
    await finish(f, accepted.id);
    await schema.db
      .update(schema.fileUpload)
      .set({ expiresAt: new Date(0) })
      .where(eq(schema.fileUpload.id, accepted.id));
    await sweepExpiredUploads();
    expect((await finish(f, accepted.id)).status).toBe(200);
    expect((await f.app.request(`/uploads/${accepted.id}`, { method: 'DELETE' })).status).toBe(409);
  });
  it('replays a completed private upload after its draft is claimed by a post', async () => {
    const f = await fixture();
    const session = Session.parse(await (await begin(f)).json());
    await send(f, session, '123456789', 0);
    const completed = Session.parse(await (await finish(f, session.id)).json());
    const { default: comments } = await import('../../src/routes/comments');
    const app = appWithActor(comments, f.orgId, ['manage'], f.actorId);
    const posted = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subjectType: 'task',
        subjectId: f.taskId,
        body: 'Completed report',
        attachmentIds: [completed.file?.id],
      }),
    });
    expect(posted.status).toBe(201);
    const replay = Session.parse(await (await finish(f, session.id)).json());
    expect(replay.file?.id).toBe(completed.file?.id);
    const { getContainer } = await import('../../src/container');
    const wholeRead = vi
      .spyOn(getContainer().blob, 'get')
      .mockRejectedValue(new Error('unbounded read'));
    try {
      const client = await connect(f.ctx);
      const copy = await client.callTool({
        name: 'attach_resource',
        arguments: {
          orgId: f.orgId,
          subjectType: 'project',
          subjectId: f.projectId,
          requestId: 'copy-post',
          resource: { kind: 'attachment', id: completed.file?.id },
        },
      });
      expect(copy.isError, JSON.stringify(copy)).not.toBe(true);
    } finally {
      wholeRead.mockRestore();
    }
  });
  it('does not let another connected client recover a private upload', async () => {
    const f = await fixture();
    const one = await connect({ ...f.ctx, clientId: 'one', clientName: 'First client' });
    const created = await one.callTool({
      name: 'manage_upload',
      arguments: {
        orgId: f.orgId,
        action: 'begin',
        ...metadata,
        requestId: 'client-owned',
        destination: { kind: 'draft' },
      },
    });
    expect(created.isError, JSON.stringify(created)).not.toBe(true);
    const session = Session.parse(created.structuredContent);
    const two = await connect({ ...f.ctx, clientId: 'two', clientName: 'Second client' });
    expect(
      (
        await two.callTool({
          name: 'manage_upload',
          arguments: { orgId: f.orgId, action: 'status', uploadId: session.id },
        })
      ).isError,
    ).toBe(true);
  });
  it('rechecks destination contribution before completing an agent upload', async () => {
    const f = await fixture();
    await schema.db.insert(schema.grant).values({
      organizationId: f.orgId,
      subjectKind: 'actor',
      subjectId: f.agentActorId,
      resourceKind: 'task',
      resourceId: f.taskId,
      capabilities: ['view', 'contribute'],
      effect: 'allow',
    });
    const client = await connect({
      scopes: ['work:read', 'work:write'],
      principal: {
        kind: 'agent',
        orgId: f.orgId,
        agentId: f.agentId,
        agentActorId: f.agentActorId,
        displayName: 'Agent',
      },
    });
    const created = await client.callTool({
      name: 'manage_upload',
      arguments: {
        orgId: f.orgId,
        action: 'begin',
        ...metadata,
        requestId: 'permission',
        destination: { kind: 'work', subjectType: 'task', subjectId: f.taskId },
      },
    });
    expect(created.isError, JSON.stringify(created)).not.toBe(true);
    const session = Session.parse(created.structuredContent);
    await send(f, session, '123456789', 0);
    await schema.db.delete(schema.grant).where(eq(schema.grant.subjectId, f.agentActorId));
    expect(
      (
        await client.callTool({
          name: 'manage_upload',
          arguments: { orgId: f.orgId, action: 'complete', uploadId: session.id },
        })
      ).isError,
    ).toBe(true);
    expect(
      await schema.db
        .select()
        .from(schema.attachment)
        .where(eq(schema.attachment.subjectId, f.taskId)),
    ).toHaveLength(0);
  });
  it('does not buffer download streams in the global ETag middleware', async () => {
    const f = await fixture();
    const session = Session.parse(await (await begin(f)).json());
    await send(f, session, '123456789', 0);
    const completed = Session.parse(await (await finish(f, session.id)).json());
    const { finiteEtag } = await import('../../src/lib/finite-etag');
    const { deliverableRoutes } = await import('../../src/routes/deliverables');
    const router = new Hono<AppEnv>().use('*', finiteEtag).route('/', deliverableRoutes);
    const app = appWithActor(router, f.orgId, ['manage'], f.actorId);
    const clone = vi.spyOn(Response.prototype, 'clone').mockImplementation(() => {
      throw new Error('buffered stream');
    });
    try {
      const response = await app.request(`/${completed.file?.id}/download`);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('123456789');
    } finally {
      clone.mockRestore();
    }
  });
});
