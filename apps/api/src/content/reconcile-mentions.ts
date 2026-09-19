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
import { canonicalizeResourceUrl } from '@docket/connections/resource-contract';
import { parseMentionMarker, type MentionRef, type MentionSubjectType } from '../contracts/mention';
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
  // A team's description is where someone writes what the team is for, and the resources they
  // reference there are exactly what its Library should surface without anyone attaching them.
  team: ['description'],
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
 * Find or create the shared resource row for an external URL.
 *
 * @remarks
 * Makes no network call. A brand-new row lands `pending` and the unfurl sweep resolves its
 * metadata later, so writing a description never waits on a third party.
 *
 * @param storage - The ports to write through.
 * @param organizationId - The writing organization.
 * @param createdBy - The author of the prose, when there is one.
 * @param url - The authored URL.
 * @returns The resource's id, or `undefined` when the URL is not one we keep.
 */
async function resolveExternalResource(
  storage: MentionStorage,
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

/** One authored link, with everything needed to turn it into an edge. */
interface LinkToResolve {
  readonly organizationId: string;
  readonly createdBy: string | null;
  readonly field: string;
  readonly link: MarkdownLink;
  readonly position: number;
}

/**
 * Turn one authored link into an edge.
 *
 * @remarks
 * A `docket:` marker naming an entity is verified in-tenant before the edge exists: anyone who can
 * write a description can write a marker naming another organization's task id, and creating that
 * edge would make the hydrate endpoint an existence oracle for ids the author cannot see. Hydrate
 * re-checks visibility independently at read time, because a grant can be revoked after the prose
 * is written — neither gate alone is sufficient.
 *
 * @param storage - The ports to read and write through.
 * @param authored - The link and its position in the field.
 * @returns The edge, or `undefined` when this is not a reference we can keep.
 */
async function resolveLink(
  storage: MentionStorage,
  authored: LinkToResolve,
): Promise<MentionDraft | undefined> {
  const { organizationId, createdBy, field, link, position } = authored;
  const marked = parseMentionMarker(link.href, link.title);

  // A deliberate entity mention: verify the target is real and in-tenant, or drop the edge.
  if (marked?.kind === 'entity') {
    const exists = await storage.subjects.entityExists(
      organizationId,
      marked.entityKind,
      marked.entityId,
    );
    if (!exists) return undefined;
    return { field, position, label: link.label, ref: marked, externalResourceId: undefined };
  }

  // Everything else pointing outward is a reference, marker or not. That is what makes a plainly
  // pasted URL carry metadata and appear in the Resources tab alongside chips.
  const url = marked?.kind === 'external' ? marked.url : link.href;
  const externalResourceId = await resolveExternalResource(storage, organizationId, createdBy, url);
  if (externalResourceId === undefined) return undefined;
  return {
    field,
    position,
    label: link.label,
    ref: { kind: 'external', url },
    externalResourceId,
  };
}

/**
 * Build a reconciler over the given storage.
 *
 * @param storage - The ports this reconciler reads and writes through.
 * @returns The reconciler.
 */
export function createMentionReconciler(storage: MentionStorage): MentionReconciler {
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
          const resolved = await resolveLink(storage, {
            organizationId,
            createdBy: row.createdBy,
            field,
            link,
            position: desired.filter((draft) => draft.field === field).length,
          });
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
