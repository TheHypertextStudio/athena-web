/**
 * `domain packages` — mention DTOs and the Markdown link grammar behind them.
 *
 * @remarks
 * A mention is stored as an ordinary Markdown link carrying a machine ref in the link-title slot:
 *
 * ```
 * [Q3 launch plan](https://docs.google.com/document/d/abc123/edit "docket:v1:google_drive:abc123")
 * [Platform rebuild](/orgs/01JX…/projects/01JY… "docket:v1:project:01JY…")
 * ```
 *
 * The title slot is native Markdown that every renderer we do not control silently drops, so a
 * digest, an agent prompt, or an export sees a normal clickable link pointing at the right place.
 * Where Docket does control rendering, the marker makes a deliberate mention distinguishable from
 * a URL the author typed themselves — which matters, because the two get different treatments.
 *
 * The grammar lives here rather than in the web app because two independent implementations must
 * agree on it byte for byte: the Tiptap node serializing on the client, and `reconcileMentions`
 * parsing on the server. A drift between them loses mentions silently.
 */
import { z } from 'zod';

import { ExternalResourceOut } from '@docket/connections/resource-contract';
import {
  ExternalResourceType,
  ResourceProvider,
} from '@docket/connections/resource-provider-contract';
import { ExternalResourceId } from '@docket/connections/ids';
import { MentionId } from '@docket/work/ids';
import { OrganizationId } from '@docket/identity-access/ids';

/** The entity whose prose a mention was authored in. */
export const MentionSubjectType = z.enum([
  'task',
  'project',
  'program',
  'initiative',
  'comment',
  'update',
  'team',
]);
/** Mention-subject-type value. */
export type MentionSubjectType = z.infer<typeof MentionSubjectType>;

/**
 * One record whose prose points at the thing being asked about.
 *
 * @remarks
 * The inbound direction of {@link MentionItem}: not "what does this record reference" but "what
 * references this record". `mention_target_entity_idx` makes the question an index scan, which is
 * why there is no second table maintaining a backlink graph.
 */
export const ReferencingRecord = z
  .object({
    subjectType: z.string(),
    subjectId: z.string(),
    title: z.string(),
    href: z.string(),
  })
  .meta({ id: 'ReferencingRecord', description: 'A record whose prose references the subject.' });
/** Referencing-record value. */
export type ReferencingRecord = z.infer<typeof ReferencingRecord>;

/** Everything that references one target, grouped by the kind of record doing the referencing. */
export const EntityReferencesOut = z
  .object({
    /** How many visible records reference the target. */
    total: z.number().int().nonnegative(),
    /** The referencing records, grouped by subject kind in a stable order. */
    groups: z.array(
      z.object({
        subjectType: z.string(),
        items: z.array(ReferencingRecord),
      }),
    ),
  })
  .meta({
    id: 'EntityReferencesOut',
    description: 'The records whose prose references one entity or external resource.',
  });
/** Entity-references-out value. */
export type EntityReferencesOut = z.infer<typeof EntityReferencesOut>;

/** The kind of Docket entity an internal mention points at. */
export const MentionEntityKind = z.enum([
  'task',
  'project',
  'program',
  'initiative',
  'cycle',
  'milestone',
  'team',
  'actor',
  'agent_session',
  'comment',
  'update',
]);
/** Mention-entity-kind value. */
export type MentionEntityKind = z.infer<typeof MentionEntityKind>;

/**
 * What a mention points at.
 *
 * @remarks
 * A genuine discriminated union rather than a bag with a kind field: the two arms carry disjoint
 * data and are consumed by two different resolvers. The database mirrors it with two CHECK
 * constraints so an invalid row cannot exist.
 */
export const MentionRef = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('entity'),
    entityKind: MentionEntityKind,
    entityId: z.string(),
  }),
  z.object({
    kind: z.literal('external'),
    url: z.string(),
  }),
]);
/** Mention-ref value. */
export type MentionRef = z.infer<typeof MentionRef>;

/**
 * One row in the `@` picker.
 *
 * @remarks
 * A union over the two genuinely different kinds of row, not one shape with half its fields
 * nulled. A Docket entity has a workflow kind and an in-app route; an external resource has a
 * provider, a file type, and an owner. Forcing both through one object would mean six nullable
 * fields that each mean "not applicable here" — which is how a renderer ends up printing an em
 * dash where a real product prints nothing.
 *
 * `id` is the merge key both arms share, so a Drive file that arrives from the local index and
 * again from the provider fan-out collapses to one row instead of appearing twice.
 */
export const MentionItem = z.discriminatedUnion('origin', [
  z.object({
    origin: z.literal('local'),
    id: z.string(),
    ref: MentionRef,
    entityKind: MentionEntityKind,
    title: z.string(),
    /** Containing project, team, or summary line — whatever orients the reader. Null when none. */
    subtitle: z.string().nullable(),
    href: z.string(),
    score: z.number(),
  }),
  z.object({
    origin: z.literal('external'),
    id: z.string(),
    ref: MentionRef,
    provider: ResourceProvider,
    resourceType: ExternalResourceType,
    title: z.string(),
    /** Owner, containing drive, or site — the one line of context the row has space for. */
    subtitle: z.string().nullable(),
    url: z.string(),
    iconUrl: z.string().nullable(),
    modifiedAt: z.string().nullable(),
    score: z.number(),
  }),
]);
/** Mention-item value. */
export type MentionItem = z.infer<typeof MentionItem>;

/** The local wave of the picker: Docket entities, answered from the index with no provider call. */
export const MentionSearchOut = z
  .object({
    query: z
      .string()
      .describe('The query these items answer, echoed so a stale response is detectable.'),
    items: z.array(MentionItem).describe('Matching rows, best first.'),
  })
  .meta({ id: 'MentionSearchOut', description: 'Local mention picker results.' });
/** Local mention-search response value. */
export type MentionSearchOut = z.infer<typeof MentionSearchOut>;

/**
 * How one connected provider fared during a fan-out.
 *
 * @remarks
 * A closed enum, never a message. Provider text must not reach a Docket surface — the UI branches
 * on these values and supplies its own copy. Every value describes something the user could act
 * on, which is why `throttled` and `timed_out` are distinct from `unavailable`.
 */
export const MentionProviderStatus = z.enum([
  'ok',
  'scope_required',
  'reauth_required',
  'not_connected',
  'throttled',
  'timed_out',
  'unavailable',
]);
/** Mention-provider-status value. */
export type MentionProviderStatus = z.infer<typeof MentionProviderStatus>;

/** The external wave of the picker: resources from the caller's own connected apps. */
export const MentionExternalOut = z
  .object({
    query: z
      .string()
      .describe('The query these items answer, echoed so a stale response is detectable.'),
    items: z.array(MentionItem).describe('Matching resources, best first.'),
    providers: z
      .array(
        z.object({
          provider: ResourceProvider,
          status: MentionProviderStatus,
          tookMs: z.number().int().nonnegative(),
        }),
      )
      .describe(
        'Per-provider outcome. A provider failure is reported here inside a 200 rather than failing the request, so one degraded app never removes the rest of the results.',
      ),
  })
  .meta({ id: 'MentionExternalOut', description: 'External mention picker results.' });
/** External mention-search response value. */
export type MentionExternalOut = z.infer<typeof MentionExternalOut>;

/** One reference authored inside an entity's prose, as returned by reads. */
export const MentionOut = z
  .object({
    id: MentionId.describe('Opaque mention id.'),
    organizationId: OrganizationId.describe('Owning org id (the tenant key).'),
    subjectType: MentionSubjectType.describe('Kind of entity whose prose the reference lives in.'),
    subjectId: z.string().describe('Id of the entity whose prose the reference lives in.'),
    field: z
      .string()
      .describe('Which Markdown-bearing column it was authored in: `description` or `body`.'),
    position: z
      .number()
      .int()
      .nonnegative()
      .describe('Ordinal within the field, in document order.'),
    label: z
      .string()
      .describe(
        'The link text as authored. A stale fallback only — live titles come from the target.',
      ),
    ref: MentionRef.describe('What the reference points at.'),
    externalResourceId: ExternalResourceId.nullable().describe(
      'The deduped resource row for an external reference; null for an entity reference.',
    ),
  })
  .meta({ id: 'MentionOut', description: "A reference authored inside an entity's prose." });
/** Mention representation value. */
export type MentionOut = z.infer<typeof MentionOut>;

/**
 * A hydrated reference, ready to render as a chip and a hovercard.
 *
 * @remarks
 * The entity arm carries `accessible`, and when it is false every other field is absent rather
 * than blanked. A caller that cannot see a task must not learn its title from a mention someone
 * else authored, so the resolver returns nothing to leak.
 */
export const MentionCard = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('entity'),
    entityKind: MentionEntityKind,
    entityId: z.string(),
    accessible: z.boolean(),
    title: z.string().nullable(),
    subtitle: z.string().nullable(),
    /**
     * A short, still-Markdown-bearing excerpt of the entity's own description, for a hovercard
     * that wants to render real (if reduced-fidelity) structure — bold, links, list markers —
     * rather than the fully flattened `subtitle`. Cut at a generous length, not a syntactically
     * safe one: the renderer that consumes this tolerates a truncated trailing token.
     */
    excerptMarkdown: z.string().nullable(),
    href: z.string().nullable(),
    /** Workflow state name for work items; null for kinds that have none. */
    state: z.string().nullable(),
    /** Health signal for entities that report one; null otherwise. */
    health: z.string().nullable(),
    /** Display name of the owner, lead, or assignee; null when unassigned or unknown. */
    ownerLabel: z.string().nullable(),
    /** Due or target date (ISO 8601); null when the entity has none. */
    dueAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
  }),
  z.object({
    kind: z.literal('external'),
    url: z.string(),
    resource: ExternalResourceOut,
  }),
]);
/** Mention-card value. */
export type MentionCard = z.infer<typeof MentionCard>;

/**
 * One thing an entity's prose points at, as the Resources tab shows it.
 *
 * @remarks
 * Derived from the entity's own Markdown rather than curated, so it carries where it was written
 * instead of who added it. A reference written twice in the same body is one row with a count, not
 * two rows.
 */
export const EntityMention = z
  .object({
    ref: MentionRef.describe('What the reference points at.'),
    /** The stable key both waves and the hydrate cache agree on. */
    key: z
      .string()
      .describe('Stable identity, used to dedupe against manually attached resources.'),
    label: z.string().describe('The link text as authored, shown until a live title resolves.'),
    href: z.string().describe('Where following the reference goes.'),
    fields: z
      .array(z.string())
      .describe(
        'Which Markdown columns it appears in, e.g. `description`. Drives the "in Description" provenance line.',
      ),
    occurrences: z
      .number()
      .int()
      .positive()
      .describe('How many times it appears across those fields.'),
    resource: ExternalResourceOut.nullable().describe(
      'The shared metadata row for an external reference; null for a reference to a Docket entity.',
    ),
  })
  .meta({ id: 'EntityMention', description: "One reference derived from an entity's prose." });
/** Entity-mention value. */
export type EntityMention = z.infer<typeof EntityMention>;

/** Everything an entity's prose points at, split by what kind of thing it is. */
export const EntityMentionsOut = z
  .object({
    external: z
      .array(EntityMention)
      .describe('References to things outside Docket, in document order.'),
    entities: z
      .array(EntityMention)
      .describe('References to other Docket entities, in document order.'),
  })
  .meta({
    id: 'EntityMentionsOut',
    description: "The references derived from one entity's prose.",
  });
/** Entity-mentions response value. */
export type EntityMentionsOut = z.infer<typeof EntityMentionsOut>;

/** Batch hydrate request: the refs a rendered surface needs cards for. */
export const MentionHydrateIn = z
  .object({
    refs: z
      .array(MentionRef)
      .min(1)
      .max(50)
      .describe(
        'The references to resolve, deduped by the caller. Capped at 50 because one surface is one request; a longer document paginates rather than fanning out.',
      ),
  })
  .meta({ id: 'MentionHydrateIn', description: 'A batch request for mention preview cards.' });
/** Validated hydrate-request body. */
export type MentionHydrateIn = z.infer<typeof MentionHydrateIn>;

/** Batch hydrate response. */
export const MentionHydrateOut = z
  .object({
    items: z
      .array(MentionCard)
      .describe('One card per resolvable ref, in request order. Unresolvable refs are omitted.'),
  })
  .meta({ id: 'MentionHydrateOut', description: 'Preview cards for a batch of references.' });
/** Hydrate response value. */
export type MentionHydrateOut = z.infer<typeof MentionHydrateOut>;

/** The marker prefix that distinguishes a deliberate mention from an ordinary Markdown link. */
export const MENTION_MARKER_PREFIX = 'docket:v1:';

/**
 * Encode a ref into the marker string that rides in a Markdown link's title slot.
 *
 * @param ref - What the mention points at.
 * @returns The marker, e.g. `docket:v1:project:01JY…` or `docket:v1:external`.
 */
export function formatMentionMarker(ref: MentionRef): string {
  return ref.kind === 'entity'
    ? `${MENTION_MARKER_PREFIX}${ref.entityKind}:${ref.entityId}`
    : `${MENTION_MARKER_PREFIX}external`;
}

/** Schemes that must never become a navigable chip, whatever a pasted document claims. */
const DENIED_SCHEMES = /^\s*(javascript|data|vbscript|file|blob):/i;

/**
 * Decode a Markdown link into a mention ref.
 *
 * @remarks
 * Returns undefined for any link that is not a well-formed mention, which is the signal the
 * Markdown handler chain uses to fall through to the ordinary Link mark. That includes links with
 * no marker, links with an unrecognized entity kind, and — importantly — links whose href carries
 * a script-bearing scheme. Pasted Markdown is untrusted input, and a mention chip is a navigable
 * anchor, so a `javascript:` href that survived this function would be a live XSS vector.
 *
 * The external arm reads its target from the href rather than the marker, so a resource that moves
 * to a new URL is a new reference rather than a stale id pointing nowhere.
 *
 * @param href - The link target.
 * @param title - The link's title slot, if it has one.
 * @returns The decoded ref, or undefined when this is not a mention.
 *
 * @example
 * ```typescript
 * parseMentionMarker('/orgs/1/projects/2', 'docket:v1:project:01JY');
 * // { kind: 'entity', entityKind: 'project', entityId: '01JY' }
 * ```
 */
export function parseMentionMarker(
  href: string,
  title: string | undefined,
): MentionRef | undefined {
  if (!title?.startsWith(MENTION_MARKER_PREFIX)) return undefined;
  if (DENIED_SCHEMES.test(href)) return undefined;

  const body = title.slice(MENTION_MARKER_PREFIX.length);
  if (body === 'external') {
    return href === '' ? undefined : { kind: 'external', url: href };
  }

  const separator = body.indexOf(':');
  if (separator <= 0) return undefined;
  const parsedKind = MentionEntityKind.safeParse(body.slice(0, separator));
  const entityId = body.slice(separator + 1);
  if (!parsedKind.success || entityId === '') return undefined;

  return { kind: 'entity', entityKind: parsedKind.data, entityId };
}

/** Characters that would end the label early and change the link's shape if left raw. */
function escapeMentionLabel(label: string): string {
  return label.replace(/([[\]\\])/g, '\\$1');
}

/**
 * Percent-encode the characters that would end a Markdown link target early.
 *
 * @remarks
 * Written as an explicit map rather than `encodeURIComponent`, which treats parentheses as
 * unreserved and leaves them intact — so a URL containing `)` would close the link mid-href and
 * spill the rest of the target into the paragraph.
 */
function escapeMentionHref(href: string): string {
  return href.replace(/[()\s]/g, (char) => {
    if (char === '(') return '%28';
    if (char === ')') return '%29';
    return encodeURIComponent(char);
  });
}

/**
 * Render a mention as the Markdown link that persists in an entity's prose.
 *
 * @param label - The visible link text.
 * @param href - Where the chip navigates.
 * @param ref - What the mention points at.
 * @returns The Markdown link, marker included.
 *
 * @example
 * ```typescript
 * formatMentionLink('Q3 plan', 'https://x/d/1', { kind: 'external', url: 'https://x/d/1' });
 * // '[Q3 plan](https://x/d/1 "docket:v1:external")'
 * ```
 */
export function formatMentionLink(label: string, href: string, ref: MentionRef): string {
  return `[${escapeMentionLabel(label)}](${escapeMentionHref(href)} "${formatMentionMarker(ref)}")`;
}

/**
 * Build the stable identity a ref is deduped and cached by.
 *
 * @remarks
 * Shared by the picker's cross-wave merge, the recents ledger, and the hydrate cache, so a Drive
 * file that arrives from local search and from the provider fan-out collapses to one row in the
 * menu instead of appearing twice.
 *
 * @param ref - What the mention points at.
 * @returns The key, e.g. `docket:task:01JY` or `google_drive:1AbC`.
 */
export function mentionRefKey(ref: MentionRef): string {
  return ref.kind === 'entity' ? `docket:${ref.entityKind}:${ref.entityId}` : `url:${ref.url}`;
}
