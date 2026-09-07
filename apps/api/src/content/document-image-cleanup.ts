/** Cleanup for uploaded document images that never became part of saved prose. */
import { and, asc, eq, lte, notExists } from 'drizzle-orm';

/** Seven days gives drafts and interrupted saves time to recover before bytes are reclaimed. */
export const DOCUMENT_IMAGE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** One old image whose derived projection currently has no references. */
export interface DocumentImageCleanupCandidate {
  readonly id: string;
  readonly organizationId: string;
  readonly blobKey: string;
}

/** Database operations required by the cleanup sweep. */
export interface DocumentImageCleanupStorage {
  /** List a bounded batch of old images with no derived references. */
  listUnreferencedBefore(cutoff: Date): Promise<readonly DocumentImageCleanupCandidate[]>;
  /** Remove the image row after its bytes have been deleted. */
  deleteRow(organizationId: string, imageId: string): Promise<void>;
}

/** The authoritative check the cleanup sweep performs before deleting bytes. */
export interface DocumentImageUseChecker {
  /** Return whether saved prose still names the image, repairing a missed projection when needed. */
  isImageInUse(organizationId: string, imageId: string): Promise<boolean>;
}

/** The blob operation the cleanup sweep needs. */
export interface DocumentImageCleanupBlobStore {
  /** Delete one stored object. */
  delete(key: string): Promise<void>;
}

/** Inspectable counts returned by one bounded cleanup pass. */
export interface DocumentImageCleanupResult {
  readonly considered: number;
  readonly deleted: number;
  readonly retained: number;
  readonly failed: number;
}

/** Build cleanup storage over the application database. */
export function createDrizzleDocumentImageCleanupStorage(limit = 100): DocumentImageCleanupStorage {
  return {
    async listUnreferencedBefore(cutoff): Promise<readonly DocumentImageCleanupCandidate[]> {
      const schema = await import('@docket/db');
      return schema.db
        .select({
          id: schema.documentImage.id,
          organizationId: schema.documentImage.organizationId,
          blobKey: schema.documentImage.blobKey,
        })
        .from(schema.documentImage)
        .where(
          and(
            lte(schema.documentImage.createdAt, cutoff),
            notExists(
              schema.db
                .select({ id: schema.documentImageReference.id })
                .from(schema.documentImageReference)
                .where(
                  and(
                    eq(schema.documentImageReference.imageId, schema.documentImage.id),
                    eq(
                      schema.documentImageReference.organizationId,
                      schema.documentImage.organizationId,
                    ),
                  ),
                ),
            ),
          ),
        )
        .orderBy(asc(schema.documentImage.createdAt), asc(schema.documentImage.id))
        .limit(limit);
    },

    async deleteRow(organizationId, imageId): Promise<void> {
      const schema = await import('@docket/db');
      await schema.db
        .delete(schema.documentImage)
        .where(
          and(
            eq(schema.documentImage.organizationId, organizationId),
            eq(schema.documentImage.id, imageId),
          ),
        );
    },
  };
}

/**
 * Reclaim one bounded batch of abandoned uploads.
 *
 * @remarks
 * The candidate query uses the projection for speed. Every candidate then passes through the
 * authoritative use checker before blob deletion. A blob failure leaves the row intact so a later
 * daily pass can retry and so diagnostics retain the object key.
 */
export async function sweepUnreferencedDocumentImages(
  storage: DocumentImageCleanupStorage,
  useChecker: DocumentImageUseChecker,
  blob: DocumentImageCleanupBlobStore,
  now: Date,
): Promise<DocumentImageCleanupResult> {
  const cutoff = new Date(now.getTime() - DOCUMENT_IMAGE_RETENTION_MS);
  const candidates = await storage.listUnreferencedBefore(cutoff);
  let deleted = 0;
  let retained = 0;
  let failed = 0;

  for (const candidate of candidates) {
    if (await useChecker.isImageInUse(candidate.organizationId, candidate.id)) {
      retained += 1;
      continue;
    }
    try {
      await blob.delete(candidate.blobKey);
      await storage.deleteRow(candidate.organizationId, candidate.id);
      deleted += 1;
    } catch (error) {
      failed += 1;
      console.warn('Document image cleanup failed', {
        organizationId: candidate.organizationId,
        imageId: candidate.id,
        error,
      });
    }
  }

  return { considered: candidates.length, deleted, retained, failed };
}
