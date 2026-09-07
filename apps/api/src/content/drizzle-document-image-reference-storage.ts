/** The Drizzle adapter for the document-image reference projection and authoritative prose. */
import { and, eq, inArray } from 'drizzle-orm';

import type {
  DocumentImageReferenceDraft,
  DocumentImageReferenceRepository,
  DocumentImageReferenceStorage,
  DocumentImageRepository,
  DocumentImageSubject,
  DocumentImageSubjectReader,
  DocumentImageSubjectRow,
  DocumentImageSubjectType,
} from './document-image-references';
import { DOCUMENT_IMAGE_FIELDS } from './document-image-references';

/** Read a string property from an unknown row without accepting coerced values. */
function stringProperty(row: Readonly<Record<string, unknown>>, field: string): string | undefined {
  const value = row[field];
  return typeof value === 'string' ? value : undefined;
}

/** Read the template draft's Markdown body from its typed JSON payload. */
function templateDescription(row: Readonly<Record<string, unknown>>): string | undefined {
  const payload = row['payload'];
  if (typeof payload !== 'object' || payload === null) return undefined;
  return stringProperty(payload as Readonly<Record<string, unknown>>, 'description');
}

/** Project a database row into the prose shape the reconciler consumes. */
function toSubjectRow(
  subjectType: DocumentImageSubjectType,
  row: Readonly<Record<string, unknown>>,
): DocumentImageSubjectRow | undefined {
  const id = stringProperty(row, 'id');
  const organizationId = stringProperty(row, 'organizationId');
  if (id === undefined || organizationId === undefined) return undefined;
  const field = DOCUMENT_IMAGE_FIELDS[subjectType][0];
  const markdown =
    subjectType === 'template' ? templateDescription(row) : stringProperty(row, field);
  return {
    organizationId,
    subjectType,
    subjectId: id,
    prose: markdown === undefined ? {} : { [field]: markdown },
  };
}

/** Return the database table that owns one supported prose subject. */
async function sourceTable(subjectType: DocumentImageSubjectType) {
  const schema = await import('@docket/db');
  return {
    task: schema.task,
    project: schema.project,
    program: schema.program,
    initiative: schema.initiative,
    team: schema.team,
    milestone: schema.milestone,
    comment: schema.comment,
    update: schema.update,
    template: schema.template,
  }[subjectType];
}

/** Read every row for one subject kind in an organization. */
async function listSubjectRows(
  subjectType: DocumentImageSubjectType,
  organizationId: string,
): Promise<readonly DocumentImageSubjectRow[]> {
  const schema = await import('@docket/db');
  const table = await sourceTable(subjectType);
  const rows = await schema.db.select().from(table).where(eq(table.organizationId, organizationId));
  return rows
    .map((row) => toSubjectRow(subjectType, row))
    .filter((row): row is DocumentImageSubjectRow => row !== undefined);
}

/** Build the image-reference storage ports over the application database. */
export function createDrizzleDocumentImageReferenceStorage(): DocumentImageReferenceStorage {
  const references: DocumentImageReferenceRepository = {
    async replaceForSubject(
      subject: DocumentImageSubject,
      desired: readonly DocumentImageReferenceDraft[],
    ): Promise<void> {
      const schema = await import('@docket/db');
      await schema.db.transaction(async (tx) => {
        await tx
          .delete(schema.documentImageReference)
          .where(
            and(
              eq(schema.documentImageReference.organizationId, subject.organizationId),
              eq(schema.documentImageReference.subjectType, subject.subjectType),
              eq(schema.documentImageReference.subjectId, subject.subjectId),
            ),
          );
        if (desired.length === 0) return;
        await tx.insert(schema.documentImageReference).values(
          desired.map((reference) => ({
            organizationId: subject.organizationId,
            imageId: reference.imageId,
            subjectType: subject.subjectType,
            subjectId: subject.subjectId,
            field: reference.field,
            position: reference.position,
          })),
        );
      });
    },

    async deleteForSubject(organizationId, subjectType, subjectId): Promise<void> {
      const schema = await import('@docket/db');
      await schema.db
        .delete(schema.documentImageReference)
        .where(
          and(
            eq(schema.documentImageReference.organizationId, organizationId),
            eq(schema.documentImageReference.subjectType, subjectType),
            eq(schema.documentImageReference.subjectId, subjectId),
          ),
        );
    },

    async hasImageReference(organizationId, imageId): Promise<boolean> {
      const schema = await import('@docket/db');
      const rows = await schema.db
        .select({ id: schema.documentImageReference.id })
        .from(schema.documentImageReference)
        .where(
          and(
            eq(schema.documentImageReference.organizationId, organizationId),
            eq(schema.documentImageReference.imageId, imageId),
          ),
        )
        .limit(1);
      return rows.length > 0;
    },
  };

  const images: DocumentImageRepository = {
    async filterOwnedImageIds(organizationId, imageIds): Promise<ReadonlySet<string>> {
      if (imageIds.length === 0) return new Set();
      const schema = await import('@docket/db');
      const rows = await schema.db
        .select({ id: schema.documentImage.id })
        .from(schema.documentImage)
        .where(
          and(
            eq(schema.documentImage.organizationId, organizationId),
            inArray(schema.documentImage.id, [...new Set(imageIds)]),
          ),
        );
      return new Set(rows.map((row) => row.id));
    },
  };

  const subjects: DocumentImageSubjectReader = {
    async read(
      subjectType,
      subjectId,
      organizationId,
    ): Promise<DocumentImageSubjectRow | undefined> {
      const schema = await import('@docket/db');
      const table = await sourceTable(subjectType);
      const rows = await schema.db
        .select()
        .from(table)
        .where(and(eq(table.id, subjectId), eq(table.organizationId, organizationId)))
        .limit(1);
      return rows[0] === undefined ? undefined : toSubjectRow(subjectType, rows[0]);
    },

    async listAll(organizationId): Promise<readonly DocumentImageSubjectRow[]> {
      const subjectTypes = Object.keys(DOCUMENT_IMAGE_FIELDS) as DocumentImageSubjectType[];
      return (
        await Promise.all(subjectTypes.map((type) => listSubjectRows(type, organizationId)))
      ).flat();
    },
  };

  return { references, images, subjects };
}
