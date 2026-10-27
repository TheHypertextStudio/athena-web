/** Upload private deliverables, then claim their IDs when posting a comment or update. */
import { Hono } from 'hono';
import { z } from 'zod';
import { DeliverableDraftOut, DeliverableOut } from '@docket/work/attachment-contract';
import type { AppEnv } from '../context';
import { NotFoundError } from '../error';
import { created, ok, resourceUrl } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zForm, zParam, zQuery } from '../lib/validate';
import { assertSharedWorkWritable } from '../product-capability';
import {
  discardDeliverable,
  listDraftDeliverables,
  listDeliverables,
  readableDeliverable,
  uploadDeliverable,
} from '../content/deliverables';
import { MAX_ATTACHMENT_BYTES, readAttachmentFile } from '../content/attachment-file';

interface UploadedFile {
  readonly name: string;
  readonly type: string;
  readonly size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}
const uploadForm = z.object({
  file: z
    .custom<UploadedFile>((value) => value instanceof File, { message: 'Choose a file.' })
    .refine((file) => file.size > 0 && file.size <= MAX_ATTACHMENT_BYTES, {
      message: 'Choose a non-empty file up to 4 MB.',
    }),
  title: z.string().trim().min(1).max(500).optional(),
  uploadId: z.uuid().optional(),
});
const postQuery = z.object({
  subjectType: z.enum(['comment', 'update']),
  subjectId: z.string().min(1),
});
const fileParam = z.object({ id: z.string().min(1) });

/** Authenticated deliverable routes; pending uploads are never shared with workspace members. */
export const deliverableRoutes = new Hono<AppEnv>()
  .post(
    '/',
    apiDoc({
      status: 201,
      tag: 'Comments',
      summary: 'Upload a deliverable',
      response: DeliverableOut,
      description:
        'Upload a non-empty file up to 4 MB as multipart/form-data. It stays private to this performer until its ID is included in attachmentIds when creating a comment or update. Supply a stable uploadId UUID to safely retry an uncertain response with the same file details and bytes.',
    }),
    zForm(uploadForm),
    async (c) => {
      const { orgId, actorId, isPersonal } = c.get('actorCtx');
      await assertSharedWorkWritable(orgId, isPersonal);
      const { file, title, uploadId } = c.req.valid('form');
      const uploaded = await uploadDeliverable(
        orgId,
        actorId,
        { name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) },
        title,
        uploadId,
      );
      return created(c, DeliverableOut, uploaded, resourceUrl(uploaded.downloadUrl));
    },
  )
  .get(
    '/drafts',
    apiDoc({
      tag: 'Comments',
      summary: 'Recover private deliverable drafts',
      response: z.object({ items: z.array(DeliverableDraftOut) }),
      description:
        'List the current verified performer’s unexpired private uploads so interrupted work can resume. Drafts expire after seven days and remain private until attached.',
    }),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      return ok(c, z.object({ items: z.array(DeliverableDraftOut) }), {
        items: await listDraftDeliverables(orgId, actorId),
      });
    },
  )
  .get(
    '/',
    apiDoc({
      tag: 'Comments',
      summary: 'List post deliverables',
      response: z.object({ items: z.array(DeliverableOut) }),
      description:
        'List files attached to a comment or update. Current access to the parent work is required.',
    }),
    zQuery(postQuery),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { subjectType, subjectId } = c.req.valid('query');
      return ok(c, z.object({ items: z.array(DeliverableOut) }), {
        items: await listDeliverables(orgId, actorId, subjectType, subjectId),
      });
    },
  )
  .get(
    '/:id/preview',
    apiDoc({
      tag: 'Comments',
      summary: 'Preview safe media',
      description:
        'Stream supported raster images, audio, or video after checking current parent access. Other files must be downloaded.',
    }),
    zParam(fileParam),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const row = await readableDeliverable(orgId, actorId, c.req.valid('param').id);
      const mimeType = row.mimeType?.toLowerCase() ?? '';
      if (
        !/^(image\/(?:jpeg|png|gif|webp)|audio\/(?:mpeg|mp4|ogg|wav|webm)|video\/(?:mp4|ogg|webm))$/u.test(
          mimeType,
        )
      )
        throw new NotFoundError();
      const file = await readAttachmentFile(row);
      if (file.status !== 'available') throw new NotFoundError();
      return new Response(new Uint8Array(file.bytes), {
        headers: {
          'Content-Type': mimeType,
          'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(row.fileName ?? 'media')}`,
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy':
            "sandbox; default-src 'none'; img-src 'self'; media-src 'self'",
          'Cache-Control': 'private, no-store',
        },
      });
    },
  )
  .get(
    '/:id/download',
    apiDoc({
      tag: 'Comments',
      summary: 'Download a deliverable',
      description:
        'Download exact file bytes after checking pending-upload ownership or current parent access. Active content is downloaded, never executed inline.',
    }),
    zParam(fileParam),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const row = await readableDeliverable(orgId, actorId, c.req.valid('param').id);
      const file = await readAttachmentFile(row);
      if (file.status !== 'available') throw new NotFoundError();
      return new Response(new Uint8Array(file.bytes), {
        headers: {
          'Content-Type': row.mimeType ?? 'application/octet-stream',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(row.fileName ?? 'download')}`,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'private, no-store',
        },
      });
    },
  )
  .delete(
    '/:id',
    apiDoc({
      tag: 'Comments',
      summary: 'Discard a pending deliverable',
      response: z.object({ removed: z.literal(true) }),
      description:
        'Discard an unattached upload owned by this performer. Posted files are retained with their post.',
    }),
    zParam(fileParam),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      await discardDeliverable(orgId, actorId, c.req.valid('param').id);
      return ok(c, z.object({ removed: z.literal(true) }), { removed: true });
    },
  );
