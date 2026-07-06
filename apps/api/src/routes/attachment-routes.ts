/**
 * `@docket/api` — attachment routes, mounted on the tasks router at `/`
 * (so the surface is `/v1/orgs/:orgId/tasks/:id/attachments`).
 *
 * @remarks
 * An attachment is a typed reference from a task to an external/stored resource — the first
 * use of the general attachment model (`docs/engineering/specs/email-to-task.md`). The
 * subject is always derived from the route (`task` + the `:id` param), never the body, so a
 * caller can only attach to a task it can already address. Every handler loads the host task
 * first via {@link loadTask}, which 404s a cross-org/unknown id — that single check is the
 * tenant boundary for the whole router. Reads require org membership; mutations require
 * `contribute`, matching the tasks router.
 */
import { attachment, db, genId, integration } from '@docket/db';
import { AttachmentCreate, AttachmentOut, AttachmentRemoved, pageOf } from '@docket/types';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { getContainer } from '../container';
import type { AppEnv } from '../context';
import { NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zForm, zJson, zParam } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';
import { loadTask } from './task-helpers';

type AttachmentRow = typeof attachment.$inferSelect;

/** Project an attachment row into its wire {@link AttachmentOut} shape. */
function toOut(a: AttachmentRow): z.input<typeof AttachmentOut> {
  return {
    id: a.id,
    organizationId: a.organizationId,
    subjectType: a.subjectType,
    subjectId: a.subjectId,
    kind: a.kind,
    title: a.title,
    url: a.url,
    sourceIntegrationId: a.sourceIntegrationId,
    externalId: a.externalId,
    metadata: (a.metadata as Record<string, unknown> | null) ?? null,
    fileName: a.fileName,
    mimeType: a.mimeType,
    byteSize: a.byteSize,
    createdAt: a.createdAt.toISOString(),
  };
}

/** Max size for an uploaded file attachment (bytes). Kept under Vercel's ~4.5 MB request-body limit. */
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
/** The cap expressed in MB, for the user-facing over-limit message. */
const MAX_UPLOAD_MB = MAX_UPLOAD_BYTES / (1024 * 1024);

/**
 * The subset of a multipart `File` the upload handler needs. Kept **structural** (not the nominal
 * `File`) on purpose: this shape flows into the RPC contract, and the browser's DOM `File` and
 * Node's `node:buffer` `File` are different nominal types — a structural interface both satisfy is
 * the only thing that type-checks on the web client *and* gives the handler `.name`/`.size`/`.type`.
 */
interface UploadedFile {
  /** Original filename. */
  readonly name: string;
  /** Size in bytes. */
  readonly size: number;
  /** MIME type (may be empty). */
  readonly type: string;
  /** Read the bytes. */
  arrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * Multipart body for a file upload: a required, non-empty `File` within the size cap, plus an
 * optional display label. `z.custom` validates it's a real `File` at runtime while typing it as the
 * structural {@link UploadedFile} (no `any`); the multipart body is representable in OpenAPI.
 */
const uploadForm = z.object({
  file: z
    .custom<UploadedFile>((v) => v instanceof File, { message: 'A file is required.' })
    .refine((f) => f.size > 0, { message: 'The file is empty.' })
    .refine((f) => f.size <= MAX_UPLOAD_BYTES, {
      message: `The file exceeds the ${String(MAX_UPLOAD_MB)} MB limit.`,
    }),
  title: z
    .string()
    .min(1)
    .optional()
    .describe('Optional display label; defaults to the uploaded filename when omitted.'),
});

const taskParam = z.object({ id: z.string() });
const attParam = z.object({ id: z.string(), attachmentId: z.string() });

/**
 * Attachment routes: list / create / remove attachments on a task.
 *
 * @remarks
 * Mounted on the tasks router, so `:id` is the host task. The host task is loaded on every
 * request (404 for a cross-org or unknown id) before any attachment work, keeping the router
 * tenant-isolated by construction.
 */
export const attachmentRoutes = new Hono<AppEnv>()
  .get(
    '/:id/attachments',
    apiDoc({
      tag: 'Tasks',
      summary: 'List task attachments',
      response: pageOf(AttachmentOut),
      description: `List a task's attachments — typed references from the task to an external or stored resource (a pasted \`url\` link, or an integration-backed \`email\` pointer whose content stays in Gmail). Ordered oldest-first by creation. The subject is always derived from the route (\`task\` + \`:id\`), never the body, so a caller can only read attachments on a task it can already address; the host task is loaded first (cross-org/unknown 404s) and that single check is the tenant boundary. Archived attachments are excluded. Requires org membership (\`view\`). Returns a page of {@link AttachmentOut}.`,
    }),
    zParam(taskParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      await loadTask(orgId, id);
      const rows = await db
        .select()
        .from(attachment)
        .where(
          and(
            eq(attachment.organizationId, orgId),
            eq(attachment.subjectType, 'task'),
            eq(attachment.subjectId, id),
            isNull(attachment.archivedAt),
          ),
        )
        .orderBy(asc(attachment.createdAt));
      return ok(c, pageOf(AttachmentOut), { items: rows.map(toOut) });
    },
  )
  .post(
    '/:id/attachments',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Tasks',
      summary: 'Add a task attachment',
      capability: 'contribute',
      response: AttachmentOut,
      description: `Attach a resource to a task. The subject (\`task\` + the \`:id\`) is taken from the route, never the body. Requires \`contribute\`. The host task is loaded first (cross-org/unknown 404s), so an attachment can only be added to a task the caller can address.

The \`kind\` determines the required fields, enforced at the schema edge: a \`url\` attachment requires \`url\`; an \`email\` attachment requires both \`sourceIntegrationId\` and \`externalId\` (the Gmail thread id) — a half-specified body 422s. \`metadata\` is an optional free-form JSON bag for kind-specific extras (e.g. fetched favicon, sender). Returns the created {@link AttachmentOut}.`,
    }),
    zParam(taskParam),
    zJson(AttachmentCreate),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const inputBody = c.req.valid('json');
      await loadTask(orgId, id);

      // An `email` attachment's sourceIntegrationId is caller-supplied — without this check a
      // task in this org could point at another org's integration, and a later mail.* automation
      // action would resolve and mutate that org's real mailbox using its owner's OAuth grant.
      if (inputBody.kind === 'email') {
        const [integrationRow] = await db
          .select({ id: integration.id })
          .from(integration)
          .where(
            and(
              eq(integration.id, inputBody.sourceIntegrationId ?? ''),
              eq(integration.organizationId, orgId),
            ),
          )
          .limit(1);
        if (!integrationRow) throw new NotFoundError('Integration not found');
      }

      const inserted = await db
        .insert(attachment)
        .values({
          organizationId: orgId,
          createdBy: actorId,
          subjectType: 'task',
          subjectId: id,
          kind: inputBody.kind,
          title: inputBody.title,
          url: inputBody.url ?? null,
          sourceIntegrationId: inputBody.sourceIntegrationId ?? null,
          externalId: inputBody.externalId ?? null,
          metadata: inputBody.metadata ?? null,
        })
        .returning();
      const row = inserted[0];
      /* v8 ignore next -- @preserve defensive: insert always returns a row */
      if (!row) throw new Error('attachment insert returned no row');
      return ok(c, AttachmentOut, toOut(row));
    },
  )
  .post(
    '/:id/attachments/upload',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Tasks',
      summary: 'Upload a file attachment',
      capability: 'contribute',
      response: AttachmentOut,
      description: `Upload a file and attach it to a task (a \`file\` attachment). **Multipart/form-data**, not JSON: a \`file\` part (required, non-empty, ≤ ${String(MAX_UPLOAD_MB)} MB) and an optional \`title\` (defaults to the filename). Requires \`contribute\`; the host task is loaded first (cross-org/unknown 404s). The bytes are written to blob storage through the \`BlobStore\` port (local disk in dev, Vercel Blob in production) under a per-attachment key; the row records \`fileName\`/\`mimeType\`/\`byteSize\`. Download the bytes via \`GET …/attachments/:attachmentId/download\`. Returns the created {@link AttachmentOut}.`,
    }),
    zParam(taskParam),
    zForm(uploadForm),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const { file, title } = c.req.valid('form');
      await loadTask(orgId, id);

      // Deterministic, id-scoped key (no filename in the path → no traversal surface).
      const attachmentId = genId();
      const blobKey = `attachments/${orgId}/${attachmentId}`;
      const mimeType = file.type || 'application/octet-stream';
      const bytes = new Uint8Array(await file.arrayBuffer());
      await getContainer().blob.put(blobKey, bytes, mimeType);

      let row: AttachmentRow | undefined;
      try {
        const inserted = await db
          .insert(attachment)
          .values({
            id: attachmentId,
            organizationId: orgId,
            createdBy: actorId,
            subjectType: 'task',
            subjectId: id,
            kind: 'file',
            title: title ?? file.name,
            blobKey,
            fileName: file.name,
            mimeType,
            byteSize: file.size,
          })
          .returning();
        row = inserted[0];
      } catch (error) {
        // The blob is already written; drop it so a failed insert doesn't orphan bytes.
        await getContainer()
          .blob.delete(blobKey)
          .catch(() => undefined);
        throw error;
      }
      /* v8 ignore next -- @preserve defensive: insert always returns a row */
      if (!row) throw new Error('attachment insert returned no row');
      return ok(c, AttachmentOut, toOut(row));
    },
  )
  .get(
    '/:id/attachments/:attachmentId/download',
    apiDoc({
      tag: 'Tasks',
      summary: 'Download a file attachment',
      description: `Stream the bytes of a \`file\` attachment — the **binary sub-resource** of an attachment. Returns raw bytes (\`Content-Type\` from the stored \`mimeType\`, \`Content-Disposition: attachment\` so the browser saves rather than renders — no inline execution of uploaded HTML/SVG), not a JSON envelope, and is fetched via a plain \`<a href>\` link rather than the typed RPC client. The host task is loaded first (cross-org/unknown 404s); the attachment is then scoped to (\`organizationId\`, \`subjectType = task\`, \`subjectId = :id\`, \`kind = file\`), so a non-file or foreign id 404s. The bytes flow through the \`BlobStore.get\` port (local disk in dev, Vercel Blob in production). Requires org membership (\`view\`).`,
    }),
    zParam(attParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id, attachmentId } = c.req.valid('param');
      await loadTask(orgId, id);

      const rows = await db
        .select()
        .from(attachment)
        .where(
          and(
            eq(attachment.id, attachmentId),
            eq(attachment.organizationId, orgId),
            eq(attachment.subjectType, 'task'),
            eq(attachment.subjectId, id),
            eq(attachment.kind, 'file'),
            isNull(attachment.archivedAt),
          ),
        )
        .limit(1);
      const row = rows[0];
      if (!row?.blobKey) throw new NotFoundError('Attachment not found');
      const bytes = await getContainer().blob.get(row.blobKey);
      if (!bytes) throw new NotFoundError('Attachment file is no longer available.');
      const filename = row.fileName ?? 'download';
      // Copy into a fresh `ArrayBuffer`-backed Uint8Array so the body is a valid `BodyInit`
      // (mirrors the account-export download).
      return new Response(new Uint8Array(bytes), {
        status: 200,
        headers: {
          'Content-Type': row.mimeType ?? 'application/octet-stream',
          // RFC 5987 `filename*` avoids header-injection from user-supplied names.
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        },
      });
    },
  )
  .delete(
    '/:id/attachments/:attachmentId',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Tasks',
      summary: 'Remove a task attachment',
      capability: 'contribute',
      response: AttachmentRemoved,
      description: `Hard-delete an attachment from a task. Requires \`contribute\`. The host task is loaded first so a cross-org or unknown task id 404s before the attachment is addressable — the attachment id alone never leaks across tenants. The delete is additionally scoped to (\`organizationId\`, \`subjectType = task\`, \`subjectId = :id\`), so an attachment id that belongs to a different task or org 404s (\`Attachment not found\`). Returns an {@link AttachmentRemoved} acknowledgement.`,
    }),
    zParam(attParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id, attachmentId } = c.req.valid('param');
      // Load the host task first so a cross-org/unknown task id 404s before the attachment
      // is addressable — the attachment id alone never leaks across tenants.
      await loadTask(orgId, id);

      const removed = await db
        .delete(attachment)
        .where(
          and(
            eq(attachment.id, attachmentId),
            eq(attachment.organizationId, orgId),
            eq(attachment.subjectType, 'task'),
            eq(attachment.subjectId, id),
          ),
        )
        .returning();
      const row = removed[0];
      if (!row) throw new NotFoundError('Attachment not found');
      // Best-effort blob cleanup for file attachments — an orphaned blob must never block the
      // user-facing delete, which already succeeded above.
      if (row.kind === 'file' && row.blobKey) {
        await getContainer()
          .blob.delete(row.blobKey)
          .catch(() => undefined);
      }
      return ok(c, AttachmentRemoved, { id: row.id, removed: true });
    },
  );
