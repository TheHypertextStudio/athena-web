/**
 * `@docket/api` — document image routes (mounted at `/v1/orgs/:orgId/images`).
 *
 * @remarks
 * The storage behind an image pasted into prose. A body is Markdown, so an image inside one is
 * `![alt](/v1/orgs/:orgId/images/:id)` — which means these two routes exist so that reference
 * resolves for everyone who can read the body.
 *
 * ## Why this is not the attachment upload
 *
 * `attachment-routes` already uploads files, and it is the wrong tool here for two structural
 * reasons, not one stylistic one.
 *
 * It is mounted on the tasks router, so its subject is always a task. Prose lives on tasks,
 * projects, initiatives, programs, teams, milestones, comments, and updates — an image model that
 * can only belong to a task cannot serve prose.
 *
 * And it serves bytes as `Content-Disposition: attachment`, deliberately, so that an uploaded HTML
 * or SVG file downloads instead of executing in a viewer's session. An `<img src>` needs the exact
 * opposite. Rather than weaken that route's guarantee, this one earns the inline serving by never
 * accepting anything that could execute: the MIME type is validated against a **raster allowlist**
 * on the way in, the stored value is the validated one rather than the client's claim, and
 * `Content-Type-Options: nosniff` stops a browser from second-guessing it on the way out.
 *
 * ## Ownership
 *
 * A row has no subject. The Markdown that names the URL is the only reference, which is what lets a
 * description be copied from one entity to another — the whole point of the surrounding feature —
 * without an ownership row having to be rewritten to follow it. Reads require org membership, so
 * the tenant boundary is the org scope on every query, exactly as elsewhere.
 */
import { db, documentImage, genId } from '@docket/db';
import { DocumentImageMimeType, DocumentImageOut } from '@docket/types';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { getContainer } from '../container';
import type { AppEnv } from '../context';
import { NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zForm, zParam } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';

type DocumentImageRow = typeof documentImage.$inferSelect;

/** Max size for one inline image (bytes). Kept under Vercel's ~4.5 MB request-body limit. */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
/** The cap expressed in MB, for the user-facing over-limit message. */
const MAX_IMAGE_MB = MAX_IMAGE_BYTES / (1024 * 1024);

/**
 * The subset of a multipart `File` this handler needs.
 *
 * @remarks
 * Structural rather than the nominal `File` for the same reason as the attachment upload: this
 * shape flows into the RPC contract, and the DOM `File` and Node's `node:buffer` `File` are
 * different nominal types.
 */
interface UploadedImage {
  /** Original filename. */
  readonly name: string;
  /** Size in bytes. */
  readonly size: number;
  /** MIME type as claimed by the client (never trusted as the stored value). */
  readonly type: string;
  /** Read the bytes. */
  arrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * Multipart body for an image upload.
 *
 * @remarks
 * The MIME check is part of *validation*, not of the handler, so a non-raster upload is rejected
 * with a 422 before any bytes reach storage. That ordering matters: an SVG that is written to the
 * blob store and only then rejected has still been stored.
 */
const uploadForm = z.object({
  file: z
    .custom<UploadedImage>((v) => v instanceof File, { message: 'An image file is required.' })
    .refine((f) => f.size > 0, { message: 'The image is empty.' })
    .refine((f) => f.size <= MAX_IMAGE_BYTES, {
      message: `The image exceeds the ${String(MAX_IMAGE_MB)} MB limit.`,
    })
    .refine((f) => DocumentImageMimeType.safeParse(f.type).success, {
      message: 'Images must be PNG, JPEG, GIF, or WebP.',
    }),
});

const imageParam = z.object({ imageId: z.string() });

/** The app-relative URL an image is referenced by from inside Markdown. */
function imageUrl(orgId: string, imageId: string): string {
  return `/v1/orgs/${orgId}/images/${imageId}`;
}

/** Project a stored image row into its wire {@link DocumentImageOut} shape. */
function toOut(row: DocumentImageRow): z.input<typeof DocumentImageOut> {
  return {
    id: row.id,
    organizationId: row.organizationId,
    url: imageUrl(row.organizationId, row.id),
    mimeType: row.mimeType as z.input<typeof DocumentImageMimeType>,
    byteSize: row.byteSize,
    fileName: row.fileName,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Document image routes: upload one, and serve its bytes inline. */
const documentImages = new Hono<AppEnv>()
  .post(
    '/',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Organizations',
      summary: 'Upload an inline image',
      capability: 'contribute',
      response: DocumentImageOut,
      description: `Store an image for use inside an entity's prose — the destination for an image pasted or dropped into a rich-text body. **Multipart/form-data**, not JSON: a single \`file\` part (required, non-empty, ≤ ${String(MAX_IMAGE_MB)} MB). The type must be one of \`image/png\`, \`image/jpeg\`, \`image/gif\`, or \`image/webp\`; anything else (notably SVG, which can carry script) is rejected before any bytes are stored, because these bytes are later served **inline** rather than as a download. The stored MIME type is the validated one, never the client's claim. Bytes are written through the \`BlobStore\` port (local disk in dev, Vercel Blob in production) under an id-scoped key with no filename in the path. The row is org-scoped and hangs off no subject: the only reference to it is the \`![alt](url)\` in the Markdown, which is what lets a body be copied between entities. Requires \`contribute\`. Returns the created {@link DocumentImageOut}, whose \`url\` is what belongs in the Markdown.`,
    }),
    zForm(uploadForm),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { file } = c.req.valid('form');

      // Validated above, so this parse cannot fail; taking the parsed value rather than `file.type`
      // is what guarantees the stored type is from the allowlist.
      const mimeType = DocumentImageMimeType.parse(file.type);
      // Deterministic, id-scoped key (no filename in the path → no traversal surface).
      const imageId = genId();
      const blobKey = `document-images/${orgId}/${imageId}`;
      const bytes = new Uint8Array(await file.arrayBuffer());
      await getContainer().blob.put(blobKey, bytes, mimeType);

      let row: DocumentImageRow | undefined;
      try {
        const inserted = await db
          .insert(documentImage)
          .values({
            id: imageId,
            organizationId: orgId,
            createdBy: actorId,
            blobKey,
            fileName: file.name === '' ? null : file.name,
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
      if (!row) throw new Error('document image insert returned no row');
      return ok(c, DocumentImageOut, toOut(row));
    },
  )
  .get(
    '/:imageId',
    apiDoc({
      tag: 'Organizations',
      summary: 'Serve an inline image',
      description: `Stream the bytes of a stored inline image. Returns raw bytes, not a JSON envelope, and is fetched by the browser as an \`<img src>\` rather than through the typed RPC client. Served **inline** with the MIME type recorded at upload — safe only because that type came from a raster allowlist and never from the client, with \`X-Content-Type-Options: nosniff\` so the browser cannot reinterpret it. The row is scoped to the path's organization, so a foreign or unknown id 404s. Requires org membership (\`view\`).`,
    }),
    zParam(imageParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { imageId } = c.req.valid('param');

      const rows = await db
        .select()
        .from(documentImage)
        .where(and(eq(documentImage.id, imageId), eq(documentImage.organizationId, orgId)))
        .limit(1);
      const row = rows[0];
      if (!row) throw new NotFoundError('Image not found');

      const bytes = await getContainer().blob.get(row.blobKey);
      if (!bytes) throw new NotFoundError('Image is no longer available.');

      // Copy into a fresh `ArrayBuffer`-backed Uint8Array so the body is a valid `BodyInit`
      // (mirrors the attachment download).
      return new Response(new Uint8Array(bytes), {
        status: 200,
        headers: {
          'Content-Type': row.mimeType,
          // Inline is the whole point — an image told to download cannot render in prose.
          'Content-Disposition': 'inline',
          // Belt and braces: the type is already allowlisted, and the browser may not re-guess it.
          'X-Content-Type-Options': 'nosniff',
          // Immutable: an id addresses exactly one set of bytes, which are never rewritten.
          'Cache-Control': 'private, max-age=31536000, immutable',
        },
      });
    },
  );

export default documentImages;
