import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { UPLOAD_CHUNK_BYTES } from '@docket/work/attachment-contract';
import type { AppEnv } from '../context';
import { UploadBegin, UploadCompletionOut, UploadSessionOut } from '../contracts/uploads';
import { beginUpload, readUpload, completeUpload } from '../content/upload-session';
import { cancelUpload } from '../content/upload-cleanup';
import { transferUploadBytes } from '../content/upload-bytes';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam } from '../lib/validate';

const idParam = z.object({ id: z.string().min(1) });
/** Authenticated shared upload lifecycle for work resources and private post drafts. */
export const uploadRoutes = new Hono<AppEnv>()
  .post(
    '/',
    apiDoc({
      tag: 'Resources',
      summary: 'Begin a resumable file upload',
      response: UploadSessionOut,
    }),
    zJson(UploadBegin),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      return ok(c, UploadSessionOut, await beginUpload(orgId, actorId, c.req.valid('json')));
    },
  )
  .get(
    '/:id',
    apiDoc({ tag: 'Resources', summary: 'Recover upload progress', response: UploadSessionOut }),
    zParam(idParam),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      return ok(c, UploadSessionOut, await readUpload(orgId, actorId, c.req.valid('param').id));
    },
  )
  .post(
    '/:id/completion',
    apiDoc({
      tag: 'Resources',
      summary: 'Complete a verified file upload',
      response: UploadCompletionOut,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      return ok(
        c,
        UploadCompletionOut,
        await completeUpload(orgId, actorId, c.req.valid('param').id),
      );
    },
  )
  .delete(
    '/:id',
    apiDoc({
      tag: 'Resources',
      summary: 'Retire an unfinished file upload',
      response: z.object({ removed: z.literal(true) }),
    }),
    zParam(idParam),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      await cancelUpload(orgId, actorId, c.req.valid('param').id);
      return ok(c, z.object({ removed: z.literal(true) }), { removed: true });
    },
  );

/** Local-provider capability endpoint implementing bounded Content-Range PUT and status probes. */
export const uploadBytesRoutes = new Hono<AppEnv>().put(
  '/:id/bytes',
  apiDoc({
    tag: 'Resources',
    summary: 'Transfer resumable file bytes',
    description:
      'Scoped local-provider upload capability. PUT at most 8 MiB with Content-Range and X-Docket-Upload-Token. Partial acknowledgement is 308 with Range; completion is 200. Probe with a zero-byte PUT and Content-Range: bytes */TOTAL. Production uploads use the storage provider directly.',
  }),
  bodyLimit({ maxSize: UPLOAD_CHUNK_BYTES }),
  async (c) => {
    const token = c.req.header('X-Docket-Upload-Token') ?? '';
    const progress = await transferUploadBytes(
      c.req.param('id'),
      token,
      c.req.header('Content-Range') ?? '',
      new Uint8Array(await c.req.arrayBuffer()),
    );
    return new Response(null, {
      status: progress.complete ? 200 : 308,
      headers: {
        'Cache-Control': 'no-store',
        ...(progress.offset ? { Range: `bytes=0-${progress.offset - 1}` } : {}),
      },
    });
  },
);
