/**
 * `@docket/types` — Document image DTOs.
 *
 * @remarks
 * An image pasted or dropped into prose. Unlike an Attachment it hangs off no subject: the only
 * reference to it is the Markdown that names its URL, which is what lets a body carrying an image
 * be copied between entities without an ownership row having to follow it.
 *
 * The stored MIME type is always one of {@link DocumentImageMimeType}. That closed set is the
 * reason the bytes can be served inline at all — an image is worthless as an `<img src>` if the
 * browser is told to download it, and serving arbitrary uploads inline is how an SVG becomes a
 * script running in a viewer's session.
 */
import { z } from 'zod';

import { DocumentImageId, OrganizationId } from './primitives';

/**
 * The raster image types Docket will store and serve inline.
 *
 * @remarks
 * Raster only, and deliberately no `image/svg+xml`. An SVG is a document that may carry script and
 * external references; served inline from Docket's own origin it would run with Docket's origin
 * privileges. Every other decision in this slice depends on this list staying raster.
 */
export const DocumentImageMimeType = z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
/** Document image MIME value. */
export type DocumentImageMimeType = z.infer<typeof DocumentImageMimeType>;

/** A stored inline image. */
export const DocumentImageOut = z
  .object({
    id: DocumentImageId.describe('Opaque document-image id.'),
    organizationId: OrganizationId.describe('Owning org id (the tenant key).'),
    url: z
      .string()
      .describe(
        'App-relative URL the bytes are served inline from. This is the value written into the Markdown as `![alt](url)`.',
      ),
    mimeType: DocumentImageMimeType.describe('Validated raster MIME type the bytes are served as.'),
    byteSize: z.number().int().describe('Size in bytes of the stored image.'),
    fileName: z
      .string()
      .nullable()
      .describe('Original filename when the upload carried one; used as the `alt` fallback.'),
    createdAt: z.string().describe('Creation timestamp (ISO 8601).'),
  })
  .meta({ id: 'DocumentImageOut', description: 'An image stored for use inside prose.' });
/** Document image representation value. */
export type DocumentImageOut = z.infer<typeof DocumentImageOut>;
