/**
 * Derive `mention` rows from the Markdown an author actually committed.
 *
 * @remarks
 * Mentions are a *convergent projection*, not an incremental log. The reconciler re-reads the
 * committed prose and makes the edge set match it, which buys three things an incremental diff
 * cannot. Two racing writes each derive the same answer from the same committed text instead of
 * interleaving into a half-applied state. A reconcile that fails cannot roll back a legitimate
 * domain write, because it runs after that write commits. And a reconcile that is simply *missed*
 * self-heals the next time anything touches the row.
 *
 * Storage arrives through {@link MentionStorage} rather than being reached for, so this module
 * states domain rules and nothing about tables — and can be tested against an in-memory double.
 */
import {
  canonicalizeResourceUrl,
  parseMentionMarker,
  type MentionEntityKind,
  type MentionRef,
  type MentionSubjectType,
} from '@docket/types';

import { extractMarkdownLinks, type MarkdownLink } from './markdown-links';
import type { MentionDraft, MentionStorage } from './mention-ports';

/**
 * The Markdown-bearing column of every subject whose prose can hold mentions.
 *
 * @remarks
 * The map is the contract: a source table absent from it reconciles to nothing, cheaply, which is
 * the correct behavior for the tables that ride the same seam without having any prose. A source
 * table present here must also be a `mention_subject_type`, which the annotation enforces.
 */
export const MARKDOWN_FIELDS: Readonly<Record<MentionSubjectType, readonly string[]>> = {
  task: ['description'],
  project: ['description'],
  program: ['description'],
  initiative: ['description'],
  comment: ['body'],
  update: ['body'],
};

/** Whether a source table carries prose the reconciler knows how to read. */
function mentionSubjectFor(sourceTable: string): MentionSubjectType | undefined {
  return sourceTable in MARKDOWN_FIELDS ? (sourceTable as MentionSubjectType) : undefined;
}

/** Re-deriving the references written in an entity's prose. */
export interface MentionReconciler {
  /** Make the edges for one subject match its committed prose. */
  reconcile(organizationId: string, sourceTable: string, entityId: string): Promise<void>;
  /** Drop every edge for a subject that no longer exists. */
  deleteForSubject(sourceTable: string, entityId: string): Promise<void>;
}

/**
 * Build a reconciler over the given storage.
 *
 * @param storage - The ports this reconciler reads and writes through.
 * @returns The reconciler.
 */
export function createMentionReconciler(storage: MentionStorage): MentionReconciler {
  /**
   * Resolve a `docket:` marker into an entity reference, refusing anything cross-tenant.
   *
   * @remarks
   * Anyone who can write a description can write a marker naming another organization's task id.
   * Creating that edge would make the hydrate endpoint an existence oracle for ids the author
   * cannot see, so the target must be proven to live in the writing organization *before* the edge
   * exists. Hydrate re-checks visibility independently at read time, because a grant can be revoked
   * after the prose is written — neither gate alone is sufficient.
   */
  async function entityTargetExists(
    organizationId: string,
    entityKind: MentionEntityKind,
    entityId: string,
  ): Promise<boolean> {
    return storage.subjects.entityExists(organizationId, entityKind, entityId);
  }

  /**
   * Find or create the shared resource row for an external URL.
   *
   * @remarks
   * Makes no network call. A brand-new row lands `pending` and the unfurl sweep resolves its
   * metadata later, so writing a description never waits on a third party.
   */
  async function resolveExternalResource(
    organizationId: string,
    createdBy: string | null,
    url: string,
  ): Promise<string | undefined> {
    const canonical = canonicalizeResourceUrl(url);
    if (canonical === undefined) return undefined;
    return storage.resources.findOrCreate({
      organizationId,
      createdBy,
      provider: canonical.provider,
      canonicalKey: canonical.canonicalKey,
      canonicalUrl: canonical.canonicalUrl,
      externalId: canonical.externalId,
      resourceType: canonical.resourceType,
    });
  }

  /** Turn one authored link into an edge, or undefined when it is not a reference we can keep. */
  async function resolveLink(
    organizationId: string,
    createdBy: string | null,
    field: string,
    link: MarkdownLink,
    position: number,
  ): Promise<MentionDraft | undefined> {
    const marked = parseMentionMarker(link.href, link.title);

    // A deliberate entity mention: verify the target is real and in-tenant, or drop the edge.
    if (marked?.kind === 'entity') {
      const exists = await entityTargetExists(organizationId, marked.entityKind, marked.entityId);
      if (!exists) return undefined;
      return { field, position, label: link.label, ref: marked, externalResourceId: undefined };
    }

    // Everything else pointing outward is a reference, marker or not. That is what makes a plainly
    // pasted URL carry metadata and appear in the Resources tab alongside chips.
    const url = marked?.kind === 'external' ? marked.url : link.href;
    const externalResourceId = await resolveExternalResource(organizationId, createdBy, url);
    if (externalResourceId === undefined) return undefined;
    return {
      field,
      position,
      label: link.label,
      ref: { kind: 'external', url },
      externalResourceId,
    };
  }

  return {
    async reconcile(organizationId: string, sourceTable: string, entityId: string): Promise<void> {
      const subjectType = mentionSubjectFor(sourceTable);
      if (subjectType === undefined) return;

      const subject = { organizationId, subjectType, subjectId: entityId } as const;
      const fields = MARKDOWN_FIELDS[subjectType];
      const row = await storage.subjects.read(subjectType, entityId, organizationId, fields);
      if (row === undefined) {
        await storage.mentions.deleteForSubject(subjectType, entityId);
        return;
      }

      const desired: MentionDraft[] = [];
      for (const field of fields) {
        const markdown = row.prose[field];
        if (markdown === undefined) continue;
        for (const link of extractMarkdownLinks(markdown)) {
          const resolved = await resolveLink(
            organizationId,
            row.createdBy,
            field,
            link,
            desired.filter((draft) => draft.field === field).length,
          );
          if (resolved !== undefined) desired.push(resolved);
        }
      }

      await storage.mentions.replaceForSubject(subject, row.createdBy, desired);
    },

    async deleteForSubject(sourceTable: string, entityId: string): Promise<void> {
      const subjectType = mentionSubjectFor(sourceTable);
      if (subjectType === undefined) return;
      await storage.mentions.deleteForSubject(subjectType, entityId);
    },
  };
}

/** A reference the reconciler resolved, re-exported for the storage port's benefit. */
export type { MentionRef };
