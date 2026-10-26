import { z } from 'zod';
import { DeliverableOut } from '@docket/work/attachment-contract';
import { CommentOut } from '@docket/work/comment-contract';
import { UpdateOut } from '@docket/work/update-contract';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '@docket/db';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import {
  appWithActor,
  appWithAuthenticatedActor,
  getDb,
  one,
  seedTaskAccessOrg,
} from '../support/routes-harness';
import type { AppEnv } from '../../src/context';

let schema: typeof DbModule;
let db: typeof DbModule.db;
let routes: Hono<AppEnv>;

afterEach(() => vi.restoreAllMocks());

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  const { deliverableRoutes } = await import('../../src/routes/deliverables');
  const { default: comments } = await import('../../src/routes/comments');
  const { default: updates } = await import('../../src/routes/updates');
  routes = new Hono<AppEnv>()
    .route('/deliverables', deliverableRoutes)
    .route('/comments', comments)
    .route('/updates', updates);
});

async function fixture() {
  const base = await seedTaskAccessOrg(db, schema);
  const task = one(
    await db
      .insert(schema.task)
      .values({
        organizationId: base.orgId,
        teamId: base.teamId,
        title: 'Review deliverables',
        state: 'todo',
        statusId: base.statusId('task', 'todo'),
        createdBy: base.humanActorId,
      })
      .returning(),
  );
  const app = appWithActor(routes, base.orgId, ['manage'], base.humanActorId);
  return { ...base, taskId: task.id, app };
}

async function upload(
  app: ReturnType<typeof appWithActor>,
  file = new File(['finished work'], 'report.txt', { type: 'text/plain' }),
  uploadId?: string,
) {
  const form = new FormData();
  form.set('file', file);
  if (uploadId) form.set('uploadId', uploadId);
  return app.request('/deliverables', { method: 'POST', body: form });
}

async function post(
  app: ReturnType<typeof appWithActor>,
  taskId: string,
  attachmentIds: string[],
  key?: string,
) {
  return app.request('/comments', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(key === undefined ? {} : { 'Idempotency-Key': key }),
    },
    body: JSON.stringify({
      subjectType: 'task',
      subjectId: taskId,
      body: 'The finished work',
      attachmentIds,
    }),
  });
}

describe('deliverables on posts', () => {
  it('locates a new upload at its downloadable resource', async () => {
    const f = await fixture();
    const response = await upload(f.app);
    expect(response.status).toBe(201);
    const uploaded = DeliverableOut.parse(await response.json());
    const responseLocation = response.headers.get('Location');
    const { env } = await import('../../src/env');
    expect(responseLocation).toBe(`${env.API_URL}${uploaded.downloadUrl}`);
    expect(uploaded.downloadUrl).toBe(`/v1/orgs/${f.orgId}/deliverables/${uploaded.id}/download`);
    const download = await f.app.request(`/deliverables/${uploaded.id}/download`);
    expect(download.status).toBe(200);
    expect(await download.text()).toBe('finished work');
  });

  it('reuses an upload id after an uncertain response and rejects changed bytes', async () => {
    const f = await fixture();
    const uploadId = crypto.randomUUID();
    const first = DeliverableOut.parse(await (await upload(f.app, undefined, uploadId)).json());
    const replay = DeliverableOut.parse(await (await upload(f.app, undefined, uploadId)).json());
    expect(replay.id).toBe(first.id);
    const changed = await upload(
      f.app,
      new File(['different work'], 'report.txt', { type: 'text/plain' }),
      uploadId,
    );
    expect(changed.status).toBe(422);
    const drafts = await (await f.app.request('/deliverables/drafts')).json();
    expect(drafts).toMatchObject({ items: [{ id: first.id }] });
  });

  it('keeps an upload retryable when blob storage reports an uncertain failure', async () => {
    const f = await fixture();
    const { getContainer } = await import('../../src/container');
    const put = vi.spyOn(getContainer().blob, 'put').mockRejectedValueOnce(new Error('uncertain'));
    const file = new File(['finished work'], 'report.txt', { type: 'text/plain' });
    const uploadId = crypto.randomUUID();
    expect((await upload(f.app, file, uploadId)).status).toBe(500);
    const incomplete = one(
      await db.select().from(schema.fileUpload).where(eq(schema.fileUpload.requestId, uploadId)),
    );
    expect(await (await f.app.request('/deliverables/drafts')).json()).toEqual({ items: [] });
    expect((await post(f.app, f.taskId, [incomplete.attachmentId])).status).toBe(404);
    const retry = await upload(f.app, file, uploadId);
    expect(retry.status).toBe(201);
    const uploaded = DeliverableOut.parse(await retry.json());
    expect(uploaded.id).toBe(incomplete.attachmentId);
    const drafts = await (await f.app.request('/deliverables/drafts')).json();
    expect(drafts).toMatchObject({ items: [expect.objectContaining({ id: uploaded.id })] });
    put.mockRestore();
  });

  it('replays an uncertain post response without creating a second comment or claiming twice', async () => {
    const f = await fixture();
    const app = await appWithAuthenticatedActor(
      db,
      schema,
      routes,
      f.orgId,
      ['manage'],
      f.humanActorId,
    );
    const file = DeliverableOut.parse(await (await upload(app)).json());
    const key = crypto.randomUUID();
    const first = CommentOut.parse(await (await post(app, f.taskId, [file.id], key)).json());
    const replay = await post(app, f.taskId, [file.id], key);
    expect(replay.status).toBe(201);
    expect(CommentOut.parse(await replay.json()).id).toBe(first.id);
    expect(
      await db.select().from(schema.comment).where(eq(schema.comment.subjectId, f.taskId)),
    ).toHaveLength(1);
  });

  it('reclaims stored bytes after an unconfirmed draft expires', async () => {
    const f = await fixture();
    const { getContainer } = await import('../../src/container');
    const { processAttachmentBlobCleanup } = await import('../../src/content/deliverables');
    const blob = getContainer().blob;
    const write = blob.put.bind(blob);
    vi.spyOn(blob, 'put').mockImplementationOnce(async (...args) => {
      await write(...args);
      throw new Error('acknowledgment lost');
    });
    const uploadId = crypto.randomUUID();
    expect((await upload(f.app, undefined, uploadId)).status).toBe(500);
    const incomplete = one(
      await db.select().from(schema.fileUpload).where(eq(schema.fileUpload.requestId, uploadId)),
    );
    const blobKey = incomplete.blobKey;
    expect(await blob.get(blobKey)).not.toBeNull();
    await db
      .update(schema.fileUpload)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(schema.fileUpload.id, incomplete.id));
    const { sweepExpiredUploads } = await import('../../src/content/upload-cleanup');
    expect(await sweepExpiredUploads()).toBe(1);
    await processAttachmentBlobCleanup();
    expect(await blob.get(blobKey)).toBeNull();
  });

  it('returns the current performer’s private drafts with an expiry for recovery', async () => {
    const f = await fixture();
    const file = DeliverableOut.parse(await (await upload(f.app)).json());
    const recovered = await f.app.request('/deliverables/drafts');
    expect(recovered.status).toBe(200);
    const result = z.object({ items: z.array(DeliverableOut.extend({ expiresAt: z.string() })) });
    expect(result.parse(await recovered.json()).items).toHaveLength(1);
    expect((await f.app.request('/deliverables/drafts')).status).toBe(200);
    expect(file.id).toBeTruthy();
  });

  it('uploads privately, attaches to a comment, lists and downloads exact bytes', async () => {
    const f = await fixture();
    const res = await upload(f.app);
    expect(res.status).toBe(201);
    const file = DeliverableOut.parse(await res.json());
    const created = await post(f.app, f.taskId, [file.id]);
    expect(created.status).toBe(201);
    const comment = CommentOut.parse(await created.json());
    const list = await f.app.request(`/deliverables?subjectType=comment&subjectId=${comment.id}`);
    expect(list.status).toBe(200);
    expect(z.object({ items: z.array(DeliverableOut) }).parse(await list.json()).items).toEqual([
      file,
    ]);
    const download = await f.app.request(`/deliverables/${file.id}/download`);
    expect(download.status).toBe(200);
    expect(await download.text()).toBe('finished work');
    expect(download.headers.get('content-disposition')).toContain('attachment;');
    expect(download.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('serves an attached raster image as an authorized sandboxed preview', async () => {
    const f = await fixture();
    const imageBytes = new Uint8Array([137, 80, 78, 71]);
    const uploaded = DeliverableOut.parse(
      await (
        await upload(f.app, new File([imageBytes], 'proof.png', { type: 'image/png' }))
      ).json(),
    );
    expect(uploaded.previewUrl).toBe(`/v1/orgs/${f.orgId}/deliverables/${uploaded.id}/preview`);
    const comment = CommentOut.parse(await (await post(f.app, f.taskId, [uploaded.id])).json());
    const preview = await f.app.request(`/deliverables/${uploaded.id}/preview`);
    expect(preview.status).toBe(200);
    expect(preview.headers.get('content-type')).toBe('image/png');
    expect(preview.headers.get('content-security-policy')).toContain('sandbox');
    expect(new Uint8Array(await preview.arrayBuffer())).toEqual(imageBytes);
    const stranger = one(
      await db
        .insert(schema.actor)
        .values({ organizationId: f.orgId, kind: 'human', displayName: 'Stranger' })
        .returning(),
    );
    const privateApp = appWithActor(routes, f.orgId, ['view'], stranger.id);
    await db.update(schema.task).set({ visibility: 'private' }).where(eq(schema.task.id, f.taskId));
    expect((await privateApp.request(`/deliverables/${uploaded.id}/preview`)).status).toBe(404);
    expect(comment.id).toBeTruthy();
  });

  it.each([
    ['audio/mpeg', 'voice-note.mp3'],
    ['video/mp4', 'demo.mp4'],
  ] as const)('previews supported media type %s', async (mimeType, fileName) => {
    const f = await fixture();
    const media = DeliverableOut.parse(
      await (
        await upload(f.app, new File([new Uint8Array([1, 2, 3])], fileName, { type: mimeType }))
      ).json(),
    );
    expect(media.previewUrl).toBeDefined();
    await post(f.app, f.taskId, [media.id]);
    const preview = await f.app.request(`/deliverables/${media.id}/preview`);
    expect(preview.status).toBe(200);
    expect(preview.headers.get('content-type')).toBe(mimeType);
    expect(preview.headers.get('content-disposition')).toContain('inline;');
  });

  it('does not preview active SVG content inline', async () => {
    const f = await fixture();
    const svg = DeliverableOut.parse(
      await (
        await upload(
          f.app,
          new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'drawing.svg', {
            type: 'image/svg+xml',
          }),
        )
      ).json(),
    );
    expect(svg.previewUrl).toBeUndefined();
    expect((await f.app.request(`/deliverables/${svg.id}/preview`)).status).toBe(404);
  });

  it('rejects empty and oversized files without storing attachments', async () => {
    const f = await fixture();
    for (const size of [0, 4 * 1024 * 1024 + 1]) {
      const res = await upload(f.app, new File([new Uint8Array(size)], 'file.bin'));
      expect(res.status).toBe(422);
    }
    expect(
      await db
        .select()
        .from(schema.attachment)
        .where(eq(schema.attachment.organizationId, f.orgId)),
    ).toHaveLength(0);
  });

  it('cannot claim another author or workspace upload, and rolls back the post', async () => {
    const f = await fixture();
    const other = await fixture();
    const file = DeliverableOut.parse(await (await upload(other.app)).json());
    const res = await post(f.app, f.taskId, [file.id]);
    expect(res.status).toBe(404);
    expect(
      await db.select().from(schema.comment).where(eq(schema.comment.subjectId, f.taskId)),
    ).toHaveLength(0);
    const colleague = one(
      await db
        .insert(schema.actor)
        .values({ organizationId: f.orgId, kind: 'human', displayName: 'Colleague' })
        .returning(),
    );
    await db.insert(schema.grant).values({
      organizationId: f.orgId,
      subjectKind: 'actor',
      subjectId: colleague.id,
      resourceKind: 'task',
      resourceId: f.taskId,
      capabilities: ['contribute'],
      effect: 'allow',
      cascades: false,
    });
    const foreign = appWithActor(routes, f.orgId, ['manage'], colleague.id);
    const privateFile = DeliverableOut.parse(await (await upload(f.app)).json());
    expect((await foreign.request(`/deliverables/${privateFile.id}/download`)).status).toBe(404);
    expect((await post(foreign, f.taskId, [privateFile.id])).status).toBe(404);
  });

  it('rolls back all claims on failure and rejects reusing a posted attachment', async () => {
    const f = await fixture();
    const file = DeliverableOut.parse(await (await upload(f.app)).json());
    expect((await post(f.app, f.taskId, [file.id, schema.genId()])).status).toBe(404);
    expect((await post(f.app, f.taskId, [file.id])).status).toBe(201);
    expect((await post(f.app, f.taskId, [file.id])).status).toBe(404);
    expect(
      await db.select().from(schema.comment).where(eq(schema.comment.subjectId, f.taskId)),
    ).toHaveLength(1);
  });

  it('inherits private task access and hides files after the post is deleted', async () => {
    const f = await fixture();
    const file = DeliverableOut.parse(await (await upload(f.app)).json());
    const comment = CommentOut.parse(await (await post(f.app, f.taskId, [file.id])).json());
    await db.update(schema.task).set({ visibility: 'private' }).where(eq(schema.task.id, f.taskId));
    const stranger = one(
      await db
        .insert(schema.actor)
        .values({ organizationId: f.orgId, kind: 'human', displayName: 'Stranger' })
        .returning(),
    );
    const unreadable = appWithActor(routes, f.orgId, ['view'], stranger.id);
    expect((await unreadable.request(`/deliverables/${file.id}/download`)).status).toBe(404);
    expect(
      (await unreadable.request(`/deliverables?subjectType=comment&subjectId=${comment.id}`))
        .status,
    ).toBe(404);
    await db
      .delete(schema.comment)
      .where(and(eq(schema.comment.id, comment.id), eq(schema.comment.organizationId, f.orgId)));
    expect((await f.app.request(`/deliverables/${file.id}/download`)).status).toBe(404);
  });
});

describe('update deliverable lifecycle', () => {
  it('omits private-parent file metadata without hiding org-scoped comment or update reads', async () => {
    const f = await fixture();
    const project = one(
      await db
        .insert(schema.project)
        .values({
          organizationId: f.orgId,
          createdBy: f.humanActorId,
          name: 'Private deliverable review',
          teamId: f.teamId,
          status: 'planned',
          statusId: f.statusId('project', 'planned'),
          visibility: 'private',
        })
        .returning(),
    );
    const commentFile = DeliverableOut.parse(await (await upload(f.app)).json());
    const commentResponse = await f.app.request('/comments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        subjectType: 'project',
        subjectId: project.id,
        body: 'A private project comment',
        attachmentIds: [commentFile.id],
      }),
    });
    expect(commentResponse.status).toBe(201);

    const updateFile = DeliverableOut.parse(await (await upload(f.app)).json());
    const updateResponse = await f.app.request('/updates', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        subjectType: 'project',
        subjectId: project.id,
        body: 'A private project update',
        attachmentIds: [updateFile.id],
      }),
    });
    expect(updateResponse.status).toBe(201);

    const stranger = one(
      await db
        .insert(schema.actor)
        .values({ organizationId: f.orgId, kind: 'human', displayName: 'Stranger' })
        .returning(),
    );
    const privateReader = appWithActor(routes, f.orgId, ['view'], stranger.id);
    const comments = await privateReader.request(
      `/comments?subjectType=project&subjectId=${project.id}`,
    );
    expect(comments.status).toBe(200);
    const commentsBody = await comments.json();
    expect(commentsBody).toMatchObject({ items: [{ body: 'A private project comment' }] });
    expect(JSON.stringify(commentsBody)).not.toContain(commentFile.id);

    const updates = await privateReader.request(
      `/updates?subjectType=project&subjectId=${project.id}`,
    );
    expect(updates.status).toBe(200);
    const updatesBody = await updates.json();
    expect(updatesBody).toMatchObject({ items: [{ body: 'A private project update' }] });
    expect(JSON.stringify(updatesBody)).not.toContain(updateFile.id);
  });

  it('returns attached files in update reads and removes their bytes with the post', async () => {
    const f = await fixture();
    const project = one(
      await db
        .insert(schema.project)
        .values({
          organizationId: f.orgId,
          createdBy: f.humanActorId,
          name: 'Deliverable review',
          teamId: f.teamId,
          status: 'planned',
          statusId: f.statusId('project', 'planned'),
        })
        .returning(),
    );
    const file = DeliverableOut.parse(await (await upload(f.app)).json());
    const response = await f.app.request('/updates', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        subjectType: 'project',
        subjectId: project.id,
        body: 'Review the attached work.',
        attachmentIds: [file.id],
      }),
    });
    expect(response.status).toBe(201);
    const update = UpdateOut.parse(await response.json());
    expect(update.attachments).toEqual([file]);
    const loaded = await f.app.request(`/updates/${update.id}`);
    expect(UpdateOut.parse(await loaded.json()).attachments).toEqual([file]);
    expect((await f.app.request(`/updates/${update.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await f.app.request(`/deliverables/${file.id}/download`)).status).toBe(404);
    expect(
      await db.select().from(schema.attachment).where(eq(schema.attachment.id, file.id)),
    ).toHaveLength(0);
    const { getContainer } = await import('../../src/container');
    expect(await getContainer().blob.get(`attachments/${f.orgId}/${file.id}`)).toBeNull();
  });

  it('retains failed blob deletions for retry and reclaims expired drafts', async () => {
    const f = await fixture();
    const { getContainer } = await import('../../src/container');
    const { processAttachmentBlobCleanup, sweepExpiredDeliverableDrafts } =
      await import('../../src/content/deliverables');
    const file = DeliverableOut.parse(await (await upload(f.app)).json());
    const blobKey = `attachments/${f.orgId}/${file.id}`;
    const deletion = vi
      .spyOn(getContainer().blob, 'delete')
      .mockRejectedValueOnce(new Error('temporary storage failure'));
    expect((await f.app.request(`/deliverables/${file.id}`, { method: 'DELETE' })).status).toBe(
      200,
    );
    const [cleanup] = await db
      .select()
      .from(schema.attachmentBlobCleanup)
      .where(eq(schema.attachmentBlobCleanup.blobKey, blobKey));
    expect(cleanup?.attempts).toBe(1);
    deletion.mockRestore();
    await db
      .update(schema.attachmentBlobCleanup)
      .set({ nextAttemptAt: new Date(Date.now() - 1_000) })
      .where(eq(schema.attachmentBlobCleanup.blobKey, blobKey));
    expect((await processAttachmentBlobCleanup()).deleted).toBe(1);
    expect(await getContainer().blob.get(blobKey)).toBeNull();

    const expired = DeliverableOut.parse(await (await upload(f.app)).json());
    await db
      .update(schema.attachment)
      .set({ draftExpiresAt: new Date(Date.now() - 1_000) })
      .where(eq(schema.attachment.id, expired.id));
    expect(await sweepExpiredDeliverableDrafts()).toBe(1);
    expect((await f.app.request(`/deliverables/${expired.id}/download`)).status).toBe(404);
    expect(
      await db
        .select()
        .from(schema.attachmentBlobCleanup)
        .where(eq(schema.attachmentBlobCleanup.blobKey, `attachments/${f.orgId}/${expired.id}`)),
    ).toHaveLength(1);
  });
});
