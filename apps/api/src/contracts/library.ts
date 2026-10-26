import { z } from 'zod';
import { ExternalResourceOut } from '@docket/connections/resource-contract';
import { AttachmentKind, AttachmentSubjectType } from '@docket/work/attachment-contract';
import { OrganizationId } from '@docket/identity-access/ids';
import { EntityReferencesOut } from './mention';
import { SearchUsedIn } from './search';

/** The two existing Library material kinds. */
export const LibraryKind = z.enum(['external_resource', 'attachment']);
/** An unambiguous Library address. */
export const LibraryRef = z.object({
  orgId: OrganizationId,
  kind: LibraryKind,
  id: z.string().min(1),
});
/** A Library address value. */
export type LibraryRef = z.infer<typeof LibraryRef>;

const AttachmentMetadata = z.object({
  kind: AttachmentKind,
  subjectType: AttachmentSubjectType,
  subjectId: z.string(),
  fileName: z.string().nullable(),
  mimeType: z.string().nullable(),
  byteSize: z.number().nullable(),
  downloadUrl: z.string().optional(),
});

/** Safe Library metadata; arbitrary attachment metadata and integration/storage internals are excluded. */
export const LibrarySummary = LibraryRef.extend({
  uri: z.string(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  updatedAt: z.iso.datetime(),
  metadata: z.union([ExternalResourceOut, AttachmentMetadata]),
  usedIn: z.array(SearchUsedIn),
});

/** Explicit content availability, with a retrievable address only when bytes exist. */
export const LibraryContent = z.union([
  z.object({ status: z.literal('available'), uri: z.string(), mimeType: z.string() }),
  z.object({ status: z.enum(['unsupported', 'unavailable', 'too_large']) }),
]);

/** Current Library detail, shared by tools and resource URI reads. */
export const LibraryDetail = LibrarySummary.extend({
  usedBy: EntityReferencesOut,
  content: LibraryContent,
});
/** A Library detail value. */
export type LibraryDetail = z.infer<typeof LibraryDetail>;

/** A bounded discovery request; no workspace means the caller's full accessible corpus. */
export const ListResourcesInput = z.object({
  orgId: OrganizationId.optional(),
  query: z.string().trim().default(''),
  kinds: z.array(LibraryKind).default(['external_resource', 'attachment']),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(50),
});
/** A paginated Library response. */
export const ListResourcesOutput = z.object({
  items: z.array(LibrarySummary),
  nextCursor: z.string().optional(),
});
/** Per-reference results keep missing and unreadable material indistinguishable. */
export const GetResourcesOutput = z.object({
  items: z.array(
    z.union([
      z.object({ ref: LibraryRef, status: z.literal('ok'), resource: LibraryDetail }),
      z.object({ ref: LibraryRef, status: z.literal('not_found') }),
    ]),
  ),
});
