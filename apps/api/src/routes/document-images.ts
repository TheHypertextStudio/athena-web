/**
 * `@docket/api` — document image routes (mounted at `/v1/orgs/:orgId/images`).
 *
 * @remarks
 * The storage behind an image pasted into prose. A body is Markdown, so an image inside one is
 * `![alt](/v1/orgs/:orgId/images/:id)`, and these routes make that reference resolve for everyone
 * who can read the body.
 *
 * ## Serving inline safely
 *
 * These bytes go back to the browser inline, which is what an `<img src>` needs to render. Three
 * things keep that safe: the MIME type is validated against a **raster allowlist** on the way in,
 * the stored value is the validated one, and `X-Content-Type-Options: nosniff` holds the browser to
 * it on the way out. An upload that could execute is rejected before any bytes reach storage.
 *
 * ## Ownership
 *
 * A row belongs to the workspace and to no subject; the Markdown naming the URL is the reference.
 * A description can therefore be copied from one entity to another on its own. Every query is
 * org-scoped, which is the tenant boundary here as elsewhere.
 */
import { db, documentImage, genId } from '@docket/db';
import { DocumentImageMimeType, DocumentImageOut, DocumentImageRemoved } from '@docket/types';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { getContainer } from '../container';
import type { AppEnv } from '../context';
import { NotFoundError } from '../error';
import { created, ok } from '../lib/ok';
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
 * Structural, matching the attachment upload: this shape flows into the RPC contract, and the DOM
 * `File` and Node's `node:buffer` `File` are distinct nominal types that both satisfy it.
 */
interface UploadedImage {
  /** Original filename. */
  readonly name: string;
  /** Size in bytes. */
  readonly size: number;
  /** MIME type as claimed by the client; the stored value comes from validation. */
  readonly type: string;
  /** Read the bytes. */
  arrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * Multipart body for an image upload.
 *
 * @remarks
 * The MIME check sits in validation, so a non-raster upload is rejected with a 422 while its bytes
 * are still in the request.
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
      status: 201,
      tag: 'Organizations',
      summary: 'Upload an inline image',
      capability: 'contribute',
      response: DocumentImageOut,
      description: `Store an image for use inside an entity's prose. **Multipart/form-data**: a single \`file\` part, non-empty and ≤ ${String(MAX_IMAGE_MB)} MB, of type \`image/png\`, \`image/jpeg\`, \`image/gif\`, or \`image/webp\` — any other type is rejected with 422. The image is org-scoped and belongs to no entity; reference it by writing the returned \`url\` into Markdown as \`![alt](url)\`. Requires \`contribute\`.`,
    }),
    zForm(uploadForm),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { file } = c.req.valid('form');

      // Validated above, so this parse holds. Taking the parsed value keeps the stored type inside
      // the allowlist.
      const mimeType = DocumentImageMimeType.parse(file.type);
      // Deterministic, id-scoped key; the filename stays out of the path, closing traversal.
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
      return created(c, DocumentImageOut, toOut(row));
    },
  )
  .get(
    '/:imageId',
    apiDoc({
      tag: 'Organizations',
      summary: 'Serve an inline image',
      description: `Stream the bytes of a stored inline image. Returns raw image bytes, served inline with the MIME type recorded at upload, so this URL can be used directly as an \`<img src>\`. Responses are immutable and privately cacheable. An unknown id, or one belonging to another organization, returns 404. Requires org membership (\`view\`).`,
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

      // Copy into a fresh `ArrayBuffer`-backed Uint8Array so the body is a valid `BodyInit`.
      return new Response(new Uint8Array(bytes), {
        status: 200,
        headers: {
          'Content-Type': row.mimeType,
          // Inline, so the URL renders as an `<img src>`.
          'Content-Disposition': 'inline',
          // Holds the browser to the allowlisted type.
          'X-Content-Type-Options': 'nosniff',
          // An id addresses one fixed set of bytes for its lifetime.
          'Cache-Control': 'private, max-age=31536000, immutable',
        },
      });
    },
  )
  .delete(
    '/:imageId',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Organizations',
      summary: 'Delete an inline image',
      capability: 'contribute',
      response: DocumentImageRemoved,
      description: `Delete a stored inline image and its bytes. Images are not reference-counted, so deletion is explicit: call this to reclaim storage once no body references the image. Any Markdown still pointing at it renders its alt text instead. An unknown id, or one belonging to another organization, returns 404. Requires \`contribute\`.`,
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

      // Bytes first: the row is what addresses the blob, and the serve route already 404s a row
      // whose bytes are gone.
      await getContainer().blob.delete(row.blobKey);
      await db
        .delete(documentImage)
        .where(and(eq(documentImage.id, imageId), eq(documentImage.organizationId, orgId)));

      return ok(c, DocumentImageRemoved, { id: row.id, removed: true });
    },
  );

export default documentImages;
