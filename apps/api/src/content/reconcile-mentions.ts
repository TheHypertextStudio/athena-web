/**
 * Derive `mention` rows from the Markdown an author actually committed.
 *
 * @remarks
 * Mentions are a *convergent projection*, not an incremental log. The reconciler re-reads the
 * committed prose and makes the edge set match it, which buys three things an incremental diff
 * cannot. Two racing PATCHes each derive the same answer from the same committed text instead of
 * interleaving into a half-applied state. A reconcile that fails cannot roll back a legitimate
 * domain write, because it runs after that write commits. And a reconcile that is simply *missed*
 * self-heals the next time anything touches the row, because re-running is a pure function of
 * committed state rather than a replay of events.
 *
 * It rides {@link enqueueSearchUpsert} for the same reason the MCP announcement does: a write path
 * that forgets to reconcile is indistinguishable from prose that genuinely has no mentions, and
 * there are roughly forty write paths.
 */
import { and, eq, inArray } from 'drizzle-orm';
import {
  canonicalizeResourceUrl,
  parseMentionMarker,
  type MentionEntityKind,
  type MentionRef,
  type MentionSubjectType,
} from '@docket/types';

import { extractMarkdownLinks, type MarkdownLink } from './markdown-links';

/**
 * The Markdown-bearing column of every subject whose prose can hold mentions.
 *
 * @remarks
 * The map is the contract: a source table absent from it reconciles to nothing, cheaply, which is
 * the correct behavior for the fourteen-odd tables that ride the same write-through seam without
 * having any prose. A source table *present* here must also be a `mention_subject_type`, which the
 * type annotation enforces at compile time.
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

/** A mention resolved from one authored link, ready to be written. */
interface ResolvedMention {
  readonly field: string;
  readonly position: number;
  readonly label: string;
  readonly ref: MentionRef;
  /** Set for the external arm once the shared resource row exists. */
  readonly externalResourceId: string | undefined;
}

/**
 * The fields that decide whether a stored edge and a derived one are the same reference.
 *
 * @remarks
 * Structural rather than a `mention` row type, because both sides of the diff are compared through
 * it: rows loaded from the database, and mentions derived from prose that have no row yet.
 */
interface MentionIdentityFields {
  readonly field: string;
  readonly position: number;
  readonly targetKind: string;
  readonly targetEntityKind: string | null;
  readonly targetEntityId: string | null;
  readonly externalResourceId: string | null;
  readonly label: string;
}

/** The identity a desired mention is matched against an existing row by. */
function mentionIdentity(row: MentionIdentityFields): string {
  const target =
    row.targetKind === 'entity'
      ? `entity:${row.targetEntityKind ?? ''}:${row.targetEntityId ?? ''}`
      : `external:${row.externalResourceId ?? ''}`;
  return `${row.field}#${row.position}|${target}|${row.label}`;
}

/**
 * Resolve a `docket:` marker into an entity reference, refusing anything cross-tenant.
 *
 * @remarks
 * Anyone who can write a description can write a marker naming another organization's task id.
 * Creating that edge would make the hydrate endpoint into an existence oracle for ids the author
 * cannot see, so the target row must be proven to live in the writing organization *before* the
 * edge exists. Hydrate re-checks visibility independently at read time, because a grant can be
 * revoked after the prose is written — neither gate alone is sufficient.
 */
async function resolveEntityTarget(
  organizationId: string,
  entityKind: MentionEntityKind,
  entityId: string,
): Promise<boolean> {
  const schema = await import('@docket/db');
  const tables = {
    task: schema.task,
    project: schema.project,
    program: schema.program,
    initiative: schema.initiative,
    cycle: schema.cycle,
    milestone: schema.milestone,
    team: schema.team,
    actor: schema.actor,
    agent_session: schema.agentSession,
    comment: schema.comment,
    update: schema.update,
  } as const;
  const table = tables[entityKind];
  const rows = await schema.db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.id, entityId), eq(table.organizationId, organizationId)))
    .limit(1);
  return rows.length > 0;
}

/**
 * Find or create the shared resource row for an external URL.
 *
 * @remarks
 * Makes no network call. A brand-new row lands `pending` and the unfurl sweep resolves its
 * metadata later, so writing a description never waits on Google or on an arbitrary web server.
 */
async function resolveExternalResource(
  organizationId: string,
  createdBy: string | null,
  url: string,
): Promise<string | undefined> {
  const canonical = canonicalizeResourceUrl(url);
  if (canonical === undefined) return undefined;

  const schema = await import('@docket/db');
  await schema.db
    .insert(schema.externalResource)
    .values({
      organizationId,
      createdBy,
      provider: canonical.provider,
      canonicalKey: canonical.canonicalKey,
      canonicalUrl: canonical.canonicalUrl,
      externalId: canonical.externalId ?? null,
      resourceType: canonical.resourceType,
    })
    .onConflictDoNothing({
      target: [schema.externalResource.organizationId, schema.externalResource.canonicalKey],
    });

  const rows = await schema.db
    .select({ id: schema.externalResource.id })
    .from(schema.externalResource)
    .where(
      and(
        eq(schema.externalResource.organizationId, organizationId),
        eq(schema.externalResource.canonicalKey, canonical.canonicalKey),
      ),
    )
    .limit(1);
  return rows[0]?.id;
}

/** Turn one authored link into a mention, or undefined when it is not a reference we can keep. */
async function resolveLink(
  organizationId: string,
  createdBy: string | null,
  field: string,
  link: MarkdownLink,
  position: number,
): Promise<ResolvedMention | undefined> {
  const marked = parseMentionMarker(link.href, link.title);

  // A deliberate entity mention: verify the target is real and in-tenant, or drop the edge.
  if (marked?.kind === 'entity') {
    const exists = await resolveEntityTarget(organizationId, marked.entityKind, marked.entityId);
    if (!exists) return undefined;
    return { field, position, label: link.label, ref: marked, externalResourceId: undefined };
  }

  // Everything else that points outward is a reference, marker or not. That is what makes a
  // plainly pasted URL carry metadata and appear in the Resources tab alongside chips.
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

/**
 * Make the `mention` rows for one subject match its committed prose.
 *
 * @remarks
 * Called from the search write-through after a domain write commits. Silently no-ops for source
 * tables that carry no prose, and deletes every edge for a subject whose row has vanished.
 *
 * @param organizationId - The owning organization.
 * @param sourceTable - The written table, e.g. `project`.
 * @param entityId - The written row id.
 */
export async function reconcileMentions(
  organizationId: string,
  sourceTable: string,
  entityId: string,
): Promise<void> {
  const subjectType = mentionSubjectFor(sourceTable);
  if (subjectType === undefined) return;

  const schema = await import('@docket/db');
  const row = await loadSubjectRow(subjectType, entityId, organizationId);
  if (row === undefined) {
    await schema.db
      .delete(schema.mention)
      .where(
        and(eq(schema.mention.subjectType, subjectType), eq(schema.mention.subjectId, entityId)),
      );
    return;
  }

  const desired: ResolvedMention[] = [];
  for (const field of MARKDOWN_FIELDS[subjectType]) {
    const markdown = row.prose[field];
    if (markdown === undefined) continue;
    for (const link of extractMarkdownLinks(markdown)) {
      const resolved = await resolveLink(
        organizationId,
        row.createdBy,
        field,
        link,
        desired.filter((d) => d.field === field).length,
      );
      if (resolved !== undefined) desired.push(resolved);
    }
  }

  const existing = await schema.db
    .select()
    .from(schema.mention)
    .where(
      and(eq(schema.mention.subjectType, subjectType), eq(schema.mention.subjectId, entityId)),
    );

  const desiredByIdentity = new Map(
    desired.map((d) => [
      mentionIdentity({
        field: d.field,
        position: d.position,
        targetKind: d.ref.kind,
        targetEntityKind: d.ref.kind === 'entity' ? d.ref.entityKind : null,
        targetEntityId: d.ref.kind === 'entity' ? d.ref.entityId : null,
        externalResourceId: d.externalResourceId ?? null,
        label: d.label,
      }),
      d,
    ]),
  );
  const existingByIdentity = new Map(existing.map((e) => [mentionIdentity(e), e]));

  const staleIds = existing
    .filter((e) => !desiredByIdentity.has(mentionIdentity(e)))
    .map((e) => e.id);
  if (staleIds.length > 0) {
    await schema.db.delete(schema.mention).where(inArray(schema.mention.id, staleIds));
  }

  const additions = [...desiredByIdentity].filter(
    ([identity]) => !existingByIdentity.has(identity),
  );
  if (additions.length > 0) {
    await schema.db.insert(schema.mention).values(
      additions.map(([, d]) => ({
        organizationId,
        createdBy: row.createdBy,
        subjectType,
        subjectId: entityId,
        field: d.field,
        position: d.position,
        targetKind: d.ref.kind,
        targetEntityKind: d.ref.kind === 'entity' ? d.ref.entityKind : null,
        targetEntityId: d.ref.kind === 'entity' ? d.ref.entityId : null,
        externalResourceId: d.externalResourceId ?? null,
        label: d.label,
      })),
    );
  }
}

/**
 * One mention subject, reduced to what the reconciler needs from it.
 *
 * @remarks
 * Six different tables feed this, so the loader narrows them to their common shape here rather
 * than passing whole rows around: the reconciler only ever reads the creator and one or two
 * Markdown columns, and saying so keeps the six shapes from leaking through the rest of the file.
 */
interface MentionSubjectRow {
  /** The Actor to attribute derived edges to. */
  readonly createdBy: string | null;
  /** The subject's Markdown-bearing columns, by name. */
  readonly prose: Readonly<Record<string, string>>;
}

/** Collect the named Markdown columns of a loaded row. */
function readProse(
  row: Readonly<Record<string, unknown>>,
  fields: readonly string[],
): Record<string, string> {
  const prose: Record<string, string> = {};
  for (const field of fields) {
    const value = row[field];
    if (typeof value === 'string') prose[field] = value;
  }
  return prose;
}

/** Load the prose columns and creator of one mention subject. */
async function loadSubjectRow(
  subjectType: MentionSubjectType,
  entityId: string,
  organizationId: string,
): Promise<MentionSubjectRow | undefined> {
  const schema = await import('@docket/db');
  const tables = {
    task: schema.task,
    project: schema.project,
    program: schema.program,
    initiative: schema.initiative,
    comment: schema.comment,
    update: schema.update,
  } as const;
  const table = tables[subjectType];
  const rows = await schema.db
    .select()
    .from(table)
    .where(and(eq(table.id, entityId), eq(table.organizationId, organizationId)))
    .limit(1);
  const row = rows[0];
  if (!row) return undefined;
  return { createdBy: row.createdBy, prose: readProse(row, MARKDOWN_FIELDS[subjectType]) };
}

/** Drop every mention authored inside a subject that no longer exists. */
export async function deleteMentionsForSubject(
  sourceTable: string,
  entityId: string,
): Promise<void> {
  const subjectType = mentionSubjectFor(sourceTable);
  if (subjectType === undefined) return;
  const schema = await import('@docket/db');
  await schema.db
    .delete(schema.mention)
    .where(
      and(eq(schema.mention.subjectType, subjectType), eq(schema.mention.subjectId, entityId)),
    );
}
