import { uploadBuffered } from '../content/upload-buffered';
import { attachmentStream } from '../content/attachment-stream';
import { createHash, randomUUID } from 'node:crypto';
import { attachment, db } from '@docket/db';
import {
  AttachmentOut,
  AttachmentRemoved,
  WorkResourceSubjectType,
} from '@docket/work/attachment-contract';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../context';
import {
  ResourceFileName,
  ResourceMimeType,
  MAX_RESOURCE_BYTES,
} from '../contracts/resource-write';
import { CursorQuery, pageOf } from '../contracts/pagination';
import { attachmentOutput, authorizeResourceSubject } from '../content/resource-subject';
import { loadReadableAttachment } from '../content/attachment-file';
import { removeResourceAttachment } from '../content/resource-removal';
import { linkedResourceMaterial } from '../content/resource-url';
import { persistResourceWrite } from '../content/resource-write-receipt';
import type { ResourceMaterial } from '../content/resource-write-input';
import { NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { pageResult, seekAfter } from '../lib/list-cursor';
import { apiDoc } from '../lib/openapi-route';
import { zForm, zJson, zParam, zQuery } from '../lib/validate';

const subjectParam = z.object({
  subjectType: WorkResourceSubjectType,
  subjectId: z.string().min(1),
});
const itemParam = subjectParam.extend({ attachmentId: z.string().min(1) });
const path = '/:subjectType/:subjectId';
const pointer = z.object({
  title: z.string().trim().min(1).max(500),
  url: z.url(),
  requestId: z.string().min(1).max(128),
});
const upload = z.object({
  file: z.instanceof(File).refine((file) => file.size > 0 && file.size <= MAX_RESOURCE_BYTES),
  requestId: z.string().min(1).max(128).optional(),
});

async function persist(
  subject: Parameters<typeof authorizeResourceSubject>[0],
  material: ResourceMaterial,
  requestId: string = randomUUID(),
) {
  const identity = {
    ...material,
    bytes: undefined,
    digest: material.bytes ? createHash('sha256').update(material.bytes).digest('hex') : null,
  };
  return persistResourceWrite(
    {
      ...subject,
      requestId,
      namespace: 'web-resources',
      requestHash: createHash('sha256').update(JSON.stringify({ subject, identity })).digest('hex'),
    },
    material,
  );
}

/** Shared attachment management for all work kinds; reads and writes enforce the exact current subject. */
const workResources = new Hono<AppEnv>()
  .get(
    path,
    apiDoc({ tag: 'Resources', summary: 'List work resources', response: pageOf(AttachmentOut) }),
    zParam(subjectParam),
    zQuery(CursorQuery),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const subject = { orgId, actorId, ...c.req.valid('param') };
      await authorizeResourceSubject(subject, 'view');
      const { limit, cursor } = c.req.valid('query');
      const rows = await db
        .select()
        .from(attachment)
        .where(
          and(
            eq(attachment.organizationId, orgId),
            eq(attachment.subjectType, subject.subjectType),
            eq(attachment.subjectId, subject.subjectId),
            isNull(attachment.archivedAt),
            seekAfter(attachment.createdAt, attachment.id, cursor, 'asc'),
          ),
        )
        .orderBy(asc(attachment.createdAt), asc(attachment.id))
        .limit(limit + 1);
      return ok(
        c,
        pageOf(AttachmentOut),
        pageResult(rows.map(attachmentOutput), limit, (row) => new Date(row.createdAt)),
      );
    },
  )
  .post(
    path,
    apiDoc({
      tag: 'Resources',
      summary: 'Add a work resource URL',
      capability: 'contribute',
      response: AttachmentOut,
    }),
    zParam(subjectParam),
    zJson(pointer),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const subject = { orgId, actorId, ...c.req.valid('param') };
      await authorizeResourceSubject(subject, 'contribute');
      const input = c.req.valid('json');
      const material = await linkedResourceMaterial(orgId, actorId, input.url, input.title);
      const { row } = await persist(subject, material, input.requestId);
      return ok(c, AttachmentOut, attachmentOutput(row));
    },
  )
  .post(
    `${path}/upload`,
    apiDoc({
      tag: 'Resources',
      summary: 'Upload a work resource file',
      capability: 'contribute',
      response: AttachmentOut,
    }),
    zParam(subjectParam),
    zForm(upload),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const subject = { orgId, actorId, ...c.req.valid('param') };
      await authorizeResourceSubject(subject, 'contribute');
      const { file, requestId } = c.req.valid('form');
      const fileName = ResourceFileName.parse(file.name);
      const mimeType = ResourceMimeType.parse(file.type || 'application/octet-stream');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { row } = await uploadBuffered(
        orgId,
        actorId,
        { requestId, fileName, mimeType, destination: { kind: 'work', ...c.req.valid('param') } },
        bytes,
      );
      return ok(c, AttachmentOut, attachmentOutput(row));
    },
  )
  .get(
    `${path}/:attachmentId/download`,
    apiDoc({ tag: 'Resources', summary: 'Download a work resource file' }),
    zParam(itemParam),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const input = c.req.valid('param');
      await authorizeResourceSubject({ orgId, actorId, ...input }, 'view');
      const row = await loadReadableAttachment(orgId, actorId, input.attachmentId);
      if (row.subjectType !== input.subjectType || row.subjectId !== input.subjectId)
        throw new NotFoundError();
      return attachmentStream(row, c.req.header('Range'));
    },
  )
  .delete(
    `${path}/:attachmentId`,
    apiDoc({
      tag: 'Resources',
      summary: 'Remove a work resource',
      capability: 'contribute',
      response: AttachmentRemoved,
    }),
    zParam(itemParam),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const input = c.req.valid('param');
      await authorizeResourceSubject({ orgId, actorId, ...input }, 'contribute');
      await removeResourceAttachment({ orgId, actorId, ...input }, input.attachmentId);
      return ok(c, AttachmentRemoved, { id: input.attachmentId, removed: true });
    },
  );

export default workResources;
