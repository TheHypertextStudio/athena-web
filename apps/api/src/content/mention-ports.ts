/**
 * What the mention slice needs from storage, stated as behavior rather than as tables.
 *
 * @remarks
 * These are the seams the reconciler, the hydrator, and the Resources tab depend on. Each names an
 * operation the domain actually performs — "find or create the shared row for this URL", "replace
 * the edges for this subject" — rather than exposing a query builder, so a caller cannot reach past
 * the port and write its own `WHERE`.
 *
 * Two things follow from that. The services become testable with an in-memory double instead of a
 * migrated database, and the permission-relevant reads stay in one place where they can be audited.
 */
import type { ExternalResourceOut } from '@docket/connections/resource-contract';
import type { MentionEntityKind, MentionRef, MentionSubjectType } from '../contracts/mention';
import type {
  ResourceProvider,
  ExternalResourceType,
} from '@docket/connections/resource-provider-contract';

/** One stored edge, as the slice reads it back. */
export interface StoredMention {
  readonly id: string;
  readonly field: string;
  readonly position: number;
  readonly label: string;
  readonly targetKind: 'entity' | 'external';
  readonly targetEntityKind: MentionEntityKind | null;
  readonly targetEntityId: string | null;
  readonly externalResourceId: string | null;
}

/** One edge to write. */
export interface MentionDraft {
  readonly field: string;
  readonly position: number;
  readonly label: string;
  readonly ref: MentionRef;
  readonly externalResourceId: string | undefined;
}

/** Identifies the prose a set of edges was derived from. */
export interface MentionSubject {
  readonly organizationId: string;
  readonly subjectType: MentionSubjectType;
  readonly subjectId: string;
}

/** Reading and replacing the edges derived from one subject's prose. */
export interface MentionRepository {
  /** Every edge currently stored for a subject, in document order. */
  listForSubject(subject: MentionSubject): Promise<readonly StoredMention[]>;
  /**
   * Make the stored edges match the given set.
   *
   * @remarks
   * Expressed as "replace", not as insert/delete pairs, because the domain operation *is* a
   * convergence: the caller has derived the complete truth and the store's job is to match it.
   */
  replaceForSubject(
    subject: MentionSubject,
    createdBy: string | null,
    desired: readonly MentionDraft[],
  ): Promise<void>;
  /** Drop every edge for a subject that no longer exists. */
  deleteForSubject(subjectType: MentionSubjectType, subjectId: string): Promise<void>;
}

/**
 * A resource row as the slice reads it back.
 *
 * @remarks
 * Carries exactly what a preview renders, which is what makes it a port rather than a leak: a
 * caller can build an `ExternalResourceOut` from this without reaching for the table, and the
 * lease and retry columns stay where they belong — with the sweep that owns them.
 */
export interface StoredResource {
  readonly id: string;
  readonly organizationId: string;
  readonly provider: ResourceProvider;
  readonly canonicalKey: string;
  readonly canonicalUrl: string;
  readonly externalId: string | null;
  readonly resourceType: ExternalResourceType;
  readonly title: string | null;
  readonly description: string | null;
  readonly siteName: string | null;
  readonly iconUrl: string | null;
  readonly thumbnailUrl: string | null;
  readonly mimeType: string | null;
  readonly ownerLabel: string | null;
  readonly externalUpdatedAt: Date | null;
  readonly unfurlStatus: ExternalResourceOut['unfurlStatus'];
  readonly fetchedAt: Date | null;
}

/** What to create when a URL is referenced for the first time. */
export interface ResourceDraft {
  readonly organizationId: string;
  readonly createdBy: string | null;
  readonly provider: ResourceProvider;
  readonly canonicalKey: string;
  readonly canonicalUrl: string;
  readonly externalId: string | undefined;
  readonly resourceType: ExternalResourceType;
}

/** Finding and creating the shared metadata rows references point at. */
export interface ExternalResourceRepository {
  /**
   * Find the row for a canonical key, creating it if it is new.
   *
   * @returns The row id, or undefined when the URL cannot be referenced at all.
   */
  findOrCreate(draft: ResourceDraft): Promise<string | undefined>;
  /** Load rows by id, for rendering. */
  findByIds(organizationId: string, ids: readonly string[]): Promise<readonly StoredResource[]>;
  /** Load rows by canonical key, for resolving a reference back to its metadata. */
  findByKeys(organizationId: string, keys: readonly string[]): Promise<readonly StoredResource[]>;
}

/** The prose columns of one subject, and who wrote it. */
export interface MentionSubjectRow {
  readonly createdBy: string | null;
  /** The subject's Markdown-bearing columns, by name. */
  readonly prose: Readonly<Record<string, string>>;
}

/** Reading the prose a subject's edges are derived from. */
export interface MentionSubjectReader {
  /** Load a subject's prose, or undefined when the row is gone. */
  read(
    subjectType: MentionSubjectType,
    entityId: string,
    organizationId: string,
    fields: readonly string[],
  ): Promise<MentionSubjectRow | undefined>;
  /** Whether an entity of this kind exists in this organization. */
  entityExists(
    organizationId: string,
    entityKind: MentionEntityKind,
    entityId: string,
  ): Promise<boolean>;
}

/** Everything the mention slice needs from storage, handed over as one bundle. */
export interface MentionStorage {
  readonly mentions: MentionRepository;
  readonly resources: ExternalResourceRepository;
  readonly subjects: MentionSubjectReader;
}
