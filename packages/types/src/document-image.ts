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
 * Raster formats only. These bytes are served inline from Docket's own origin, so the list holds
 * formats a browser renders as pixels and stops there — an SVG is a document that can carry script
 * and external references, and would run with Docket's origin privileges. The rest of this slice
 * rests on the list staying raster.
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

/** Acknowledgement returned when a stored image is deleted. */
export const DocumentImageRemoved = z
  .object({
    id: DocumentImageId.describe('Id of the removed image.'),
    removed: z.literal(true).describe('Always `true`; confirms the image and its bytes are gone.'),
  })
  .meta({ id: 'DocumentImageRemoved', description: 'A removed-image acknowledgement.' });
/** Removal acknowledgement value. */
export type DocumentImageRemoved = z.infer<typeof DocumentImageRemoved>;
