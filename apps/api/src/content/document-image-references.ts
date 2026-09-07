/**
 * Derive document-image references from committed Markdown without trusting editor state.
 *
 * @remarks
 * The table behind this service is a projection. The Markdown remains authoritative. A write
 * replaces one subject's complete reference set, and an image-use check falls back to scanning
 * authoritative prose when the projection reports no use. That fallback is what prevents a failed
 * entity-write subscriber from turning a live figure into cleanup garbage.
 */
import { documentImageIdFromSource, extractDocumentFigures } from '@docket/markdown-tree';

/** The Markdown-bearing field for every persisted subject that can own shared prose. */
export const DOCUMENT_IMAGE_FIELDS = {
  task: ['description'],
  project: ['description'],
  program: ['description'],
  initiative: ['description'],
  team: ['description'],
  milestone: ['description'],
  comment: ['body'],
  update: ['body'],
  template: ['description'],
} as const;

/** A persisted subject whose prose may reference a document image. */
export type DocumentImageSubjectType = keyof typeof DOCUMENT_IMAGE_FIELDS;

/** The identity of one subject's complete derived reference set. */
export interface DocumentImageSubject {
  readonly organizationId: string;
  readonly subjectType: DocumentImageSubjectType;
  readonly subjectId: string;
}

/** One image occurrence derived from a subject field. */
export interface DocumentImageReferenceDraft {
  readonly imageId: string;
  readonly field: string;
  readonly position: number;
}

/** One authoritative prose row returned by storage. */
export interface DocumentImageSubjectRow extends DocumentImageSubject {
  readonly prose: Readonly<Record<string, string>>;
}

/** Reading and replacing the derived reference set. */
export interface DocumentImageReferenceRepository {
  /** Make one subject's stored references match its current prose. */
  replaceForSubject(
    subject: DocumentImageSubject,
    desired: readonly DocumentImageReferenceDraft[],
  ): Promise<void>;
  /** Remove references for a subject that no longer exists. */
  deleteForSubject(
    organizationId: string,
    subjectType: DocumentImageSubjectType,
    subjectId: string,
  ): Promise<void>;
  /** Return whether the projection currently names an image in an organization. */
  hasImageReference(organizationId: string, imageId: string): Promise<boolean>;
}

/** Checking image ownership without exposing a query builder to the reconciler. */
export interface DocumentImageRepository {
  /** Keep only ids that name image rows in the given organization. */
  filterOwnedImageIds(
    organizationId: string,
    imageIds: readonly string[],
  ): Promise<ReadonlySet<string>>;
}

/** Reading the Markdown that remains authoritative over the projection. */
export interface DocumentImageSubjectReader {
  /** Read one subject, or return undefined after deletion. */
  read(
    subjectType: DocumentImageSubjectType,
    subjectId: string,
    organizationId: string,
  ): Promise<DocumentImageSubjectRow | undefined>;
  /** Read all supported prose in one organization for a destructive-use check. */
  listAll(organizationId: string): Promise<readonly DocumentImageSubjectRow[]>;
}

/** Every storage operation the document-image reference slice needs. */
export interface DocumentImageReferenceStorage {
  readonly references: DocumentImageReferenceRepository;
  readonly images: DocumentImageRepository;
  readonly subjects: DocumentImageSubjectReader;
}

/** Reconcile references and prove whether an image is safe to remove. */
export interface DocumentImageReferenceReconciler {
  /** Reconcile one saved subject. */
  reconcile(organizationId: string, sourceTable: string, entityId: string): Promise<void>;
  /** Remove one deleted subject's derived references. */
  deleteForSubject(organizationId: string, sourceTable: string, entityId: string): Promise<void>;
  /** Check the projection, then authoritative prose, and repair a missed live reference. */
  isImageInUse(organizationId: string, imageId: string): Promise<boolean>;
}

/** Narrow an entity-write table name to the subjects this projection owns. */
function subjectTypeFor(sourceTable: string): DocumentImageSubjectType | undefined {
  return Object.hasOwn(DOCUMENT_IMAGE_FIELDS, sourceTable)
    ? (sourceTable as DocumentImageSubjectType)
    : undefined;
}

/** Extract all private Docket image occurrences from one subject row. */
async function referenceDrafts(
  storage: DocumentImageReferenceStorage,
  row: DocumentImageSubjectRow,
): Promise<readonly DocumentImageReferenceDraft[]> {
  const candidates: DocumentImageReferenceDraft[] = [];
  for (const field of DOCUMENT_IMAGE_FIELDS[row.subjectType]) {
    const markdown = row.prose[field];
    if (markdown === undefined) continue;
    let position = 0;
    for (const figure of extractDocumentFigures(markdown)) {
      const imageId = documentImageIdFromSource(figure.src);
      if (imageId !== null) candidates.push({ imageId, field, position });
      position += 1;
    }
  }
  if (candidates.length === 0) return [];
  const owned = await storage.images.filterOwnedImageIds(
    row.organizationId,
    candidates.map((candidate) => candidate.imageId),
  );
  return candidates.filter((candidate) => owned.has(candidate.imageId));
}

/** Replace the complete projection for one already-loaded authoritative row. */
async function reconcileRow(
  storage: DocumentImageReferenceStorage,
  row: DocumentImageSubjectRow,
): Promise<readonly DocumentImageReferenceDraft[]> {
  const desired = await referenceDrafts(storage, row);
  await storage.references.replaceForSubject(row, desired);
  return desired;
}

/** Build the convergent document-image reference service over its storage ports. */
export function createDocumentImageReferenceReconciler(
  storage: DocumentImageReferenceStorage,
): DocumentImageReferenceReconciler {
  return {
    async reconcile(organizationId, sourceTable, entityId): Promise<void> {
      const subjectType = subjectTypeFor(sourceTable);
      if (subjectType === undefined) return;
      const row = await storage.subjects.read(subjectType, entityId, organizationId);
      if (row === undefined) {
        await storage.references.deleteForSubject(organizationId, subjectType, entityId);
        return;
      }
      await reconcileRow(storage, row);
    },

    async deleteForSubject(organizationId, sourceTable, entityId): Promise<void> {
      const subjectType = subjectTypeFor(sourceTable);
      if (subjectType === undefined) return;
      await storage.references.deleteForSubject(organizationId, subjectType, entityId);
    },

    async isImageInUse(organizationId, imageId): Promise<boolean> {
      if (await storage.references.hasImageReference(organizationId, imageId)) return true;
      const rows = await storage.subjects.listAll(organizationId);
      for (const row of rows) {
        const desired = await referenceDrafts(storage, row);
        if (!desired.some((reference) => reference.imageId === imageId)) continue;
        await storage.references.replaceForSubject(row, desired);
        return true;
      }
      return false;
    },
  };
}
