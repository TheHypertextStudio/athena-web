/**
 * `@docket/types` — publishing DTOs: briefs, workspace domains, and the public slug claim.
 *
 * @remarks
 * Covers CORE-26 … CORE-34 and MISS-04. Two audiences share this module deliberately:
 *
 * - the **authenticated** surface (`Publication*`, `WorkspaceDomain*`, `WorkspacePublicSlug*`),
 *   which the app uses to publish, unpublish, claim a name, and manage domains; and
 * - the **public** surface ({@link PublicBriefOut}), the one document an anonymous visitor
 *   receives.
 *
 * {@link PublicBriefOut} is the narrow waist that makes CORE-27 checkable. It carries no
 * publication-time snapshot: every field on it is projected from the live `initiative` /
 * `program` / `project` / `task` rows on each request. If a brief could ever show a stale
 * title, it would have to be because this shape gained a column the app does not read from the
 * same table — which is a reviewable diff, not an invisible drift.
 *
 * Display copy is NOT in this module. The API returns raw enum values, ISO timestamps, and the
 * workspace's vocabulary skin; the web resolves those into words. Sending prose over the wire
 * would put user-facing copy outside the application layer that owns it.
 */
import { z } from 'zod';

import { Health } from './capability';
import { Id, OrganizationId } from './primitives';
import type { ActorId } from './primitives';
import { VocabularySkin } from './vocabulary';

/** The three work records that can be published as a brief. */
export const PublicationSubjectKind = z
  .enum(['initiative', 'program', 'project'])
  .describe(
    'Which kind of work record a brief describes. Tasks and cycles are excluded: a brief is a narrative document about a body of work.',
  );
/** Publication subject kind value. */
export type PublicationSubjectKind = z.infer<typeof PublicationSubjectKind>;

/**
 * Path segments no workspace may claim, for either a workspace slug or a brief slug.
 *
 * @remarks
 * Two distinct hazards, one list. Some entries (`api`, `admin`, `app`, `www`, `mail`) would let
 * a workspace impersonate a product host if the shared brief host were ever flattened; the rest
 * (`sign-in`, `settings`, `_next`, `privacy`) are real Docket paths, and a workspace answering
 * on one of them would shadow a page the product owns. Screening both name-spaces against one
 * list is what CORE-32's "reserved/system slugs are refused" asks for, and keeping it in
 * `@docket/types` means the API rejects and the UI warns from the same source.
 */
export const RESERVED_PUBLIC_SLUGS: readonly string[] = [
  '_next',
  'about',
  'admin',
  'api',
  'app',
  'assets',
  'auth',
  'blog',
  'brief',
  'briefs',
  'cdn',
  'dashboard',
  'docket',
  'docs',
  'health',
  'help',
  'hub',
  'internal',
  'legal',
  'login',
  'mail',
  'me',
  'new',
  'onboarding',
  'orgs',
  'pricing',
  'privacy',
  'problems',
  'public',
  'settings',
  'sign-in',
  'sign-out',
  'sign-up',
  'signin',
  'signup',
  'static',
  'status',
  'support',
  'terms',
  'today',
  'v1',
  'www',
];

/** The shape both a workspace slug and a brief slug must take. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Longest slug accepted, short enough to stay legible in a shared link. */
const SLUG_MAX_LENGTH = 64;

/**
 * A URL-safe public path segment: lowercase alphanumerics separated by single hyphens.
 *
 * @remarks
 * Deliberately stricter than "what a URL allows". A public slug is something a person reads off
 * a slide and types into a phone, so mixed case, underscores, dots, and percent-encoding are all
 * refused rather than normalized — silently changing what someone typed produces a link they
 * cannot reproduce.
 */
export const PublicSlug = z
  .string()
  .min(1)
  .max(SLUG_MAX_LENGTH)
  .regex(SLUG_PATTERN)
  .refine((value) => !RESERVED_PUBLIC_SLUGS.includes(value), {
    error: 'reserved',
  })
  .describe(
    'A public path segment: 1–64 characters, lowercase letters/digits separated by single hyphens, and not one of the reserved system names.',
  );
/** Public slug value. */
export type PublicSlug = z.infer<typeof PublicSlug>;

/**
 * Best-effort conversion of a record's title into a candidate slug.
 *
 * @remarks
 * A *suggestion*, never an authority: the result is offered to the person publishing so the
 * common case needs no typing, and it is re-validated by {@link PublicSlug} on the way in like
 * any other input. Returns an empty string when the title has no slug-able characters at all
 * (e.g. a title that is entirely emoji), which callers treat as "ask the person to choose".
 *
 * @param title - The record's title.
 * @returns A candidate slug, possibly empty.
 *
 * @example
 * ```ts
 * suggestPublicSlug('Q3 — Payments Reliability!'); // 'q3-payments-reliability'
 * ```
 */
export function suggestPublicSlug(title: string): string {
  const slug = title
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, '');
  return RESERVED_PUBLIC_SLUGS.includes(slug) ? '' : slug;
}

/** A record's publication state, as the app sees it. */
export const PublicationOut = z
  .object({
    id: Id.describe('ULID id of the publication row.'),
    organizationId: OrganizationId.describe('The owning workspace.'),
    subjectKind: PublicationSubjectKind,
    subjectId: Id.describe('The published record.'),
    slug: PublicSlug.describe('The last path segment of the public URL.'),
    published: z
      .boolean()
      .describe(
        'Whether the brief is currently readable by the public. A withdrawn brief keeps its row (and therefore its URL) so re-publishing restores the same link.',
      ),
    publishedAt: z.iso
      .datetime()
      .nullable()
      .describe('When the brief last became public; `null` while withdrawn.'),
    unpublishedAt: z.iso.datetime().nullable().describe('When the brief was last withdrawn.'),
    path: z
      .string()
      .describe(
        'The path the brief answers on, relative to whichever host serves it (e.g. `/briefs/acme/q3-roadmap`).',
      ),
    urls: z
      .array(z.string())
      .describe(
        'Every absolute URL this brief is currently reachable at: the shared brief host when the workspace has claimed a slug, plus one per verified custom domain. Empty when the workspace has claimed neither.',
      ),
  })
  .meta({ id: 'PublicationOut', description: "One record's publication state." });
/** Publication state value. */
export type PublicationOut = z.infer<typeof PublicationOut>;

/**
 * One record's publication state, as a nullable envelope.
 *
 * @remarks
 * A 200 carrying `null` rather than a 404, because "this record has never been published" is an
 * answer, not a failure. A detail header asks this question on every render; making the normal
 * case an error status would force every caller to special-case a status code to distinguish it
 * from a genuine problem, and one of them would eventually get it wrong and hide a real outage
 * behind "not published".
 */
export const PublicationStateOut = z
  .object({
    publication: PublicationOut.nullable().describe(
      'The record’s publication, or `null` when it has never been published.',
    ),
  })
  .meta({ id: 'PublicationStateOut', description: "One record's publication state." });
/** Publication state envelope value. */
export type PublicationStateOut = z.infer<typeof PublicationStateOut>;

/** Body for publishing a record. */
export const PublicationCreate = z
  .object({
    subjectKind: PublicationSubjectKind,
    subjectId: Id.describe('The record to publish; must live in the path organization.'),
    slug: PublicSlug.optional().describe(
      "The public path segment. Omit to derive one from the record's title.",
    ),
  })
  .meta({ id: 'PublicationCreate', description: 'Publish a record as a public brief.' });
/** Validated publish body. */
export type PublicationCreate = z.infer<typeof PublicationCreate>;

/** Body for changing an existing publication. */
export const PublicationUpdate = z
  .object({
    slug: PublicSlug.optional().describe('Move the brief to a different path segment.'),
    published: z
      .boolean()
      .optional()
      .describe('`false` withdraws the brief; `true` restores it at the same URL.'),
  })
  .meta({ id: 'PublicationUpdate', description: 'Re-slug or withdraw a published brief.' });
/** Validated publication-update body. */
export type PublicationUpdate = z.infer<typeof PublicationUpdate>;

/** A DNS record the workspace's operator must publish, ready to render verbatim. */
export const DnsRecordOut = z
  .object({
    type: z.enum(['TXT', 'CNAME']).describe('Record type.'),
    name: z.string().describe('Fully-qualified record name.'),
    value: z.string().describe('Record value.'),
    ttlSeconds: z.number().int().describe('Suggested TTL, in seconds.'),
  })
  .meta({ id: 'DnsRecordOut', description: 'One DNS record to publish, shown verbatim.' });
/** DNS record value. */
export type DnsRecordOut = z.infer<typeof DnsRecordOut>;

/** Why the last verification attempt did not prove ownership. Stable codes; the UI owns the wording. */
export const DomainVerificationFailureCode = z
  .enum(['lookup-failed', 'no-record', 'token-mismatch'])
  .describe(
    'Stable verification failure code. `lookup-failed`: the name could not be resolved at all. `no-record`: no Docket verification record was found. `token-mismatch`: a Docket record exists but carries a different token.',
  );
/** Domain verification failure code value. */
export type DomainVerificationFailureCode = z.infer<typeof DomainVerificationFailureCode>;

/** A custom domain claimed by a workspace. */
export const WorkspaceDomainOut = z
  .object({
    id: Id.describe('ULID id of the domain row.'),
    organizationId: OrganizationId.describe('The claiming workspace.'),
    host: z.string().describe('The normalized hostname (no scheme, no port, no `www.`).'),
    verified: z
      .boolean()
      .describe('Whether ownership is proved. An unverified domain never serves briefs.'),
    verifiedAt: z.iso.datetime().nullable().describe('When ownership was last proved.'),
    lastCheckedAt: z.iso.datetime().nullable().describe('When verification was last attempted.'),
    lastFailure: DomainVerificationFailureCode.nullable().describe(
      'Why the last attempt failed; `null` after a success or before the first attempt.',
    ),
    verificationRecord: DnsRecordOut.describe(
      'The `TXT` record proving ownership. Shown until the domain verifies, and again if it stops verifying.',
    ),
    routingRecord: DnsRecordOut.nullable().describe(
      'The `CNAME` that points the host at Docket, once ownership is proved. `null` when the deployment has no custom-domain target configured.',
    ),
    createdAt: z.iso.datetime().describe('When the domain was claimed.'),
  })
  .meta({ id: 'WorkspaceDomainOut', description: 'A workspace-owned custom domain.' });
/** Workspace domain value. */
export type WorkspaceDomainOut = z.infer<typeof WorkspaceDomainOut>;

/** Body for claiming a custom domain. */
export const WorkspaceDomainCreate = z
  .object({
    host: z
      .string()
      .min(1)
      .max(253)
      .describe(
        'The domain to claim. A full URL, a bare host, mixed case, a trailing dot, or a `www.` prefix are all accepted and normalized to one canonical host.',
      ),
  })
  .meta({ id: 'WorkspaceDomainCreate', description: 'Claim a custom domain for a workspace.' });
/** Validated domain-create body. */
export type WorkspaceDomainCreate = z.infer<typeof WorkspaceDomainCreate>;

/** The outcome of re-checking a domain's DNS. */
export const WorkspaceDomainVerifyOut = z
  .object({
    domain: WorkspaceDomainOut.describe('The domain, with its refreshed verification state.'),
    verified: z.boolean().describe('Whether this attempt proved ownership.'),
    failure: DomainVerificationFailureCode.nullable().describe(
      'Why this attempt failed; `null` on success.',
    ),
    observedCount: z
      .number()
      .int()
      .describe(
        'How many Docket-prefixed `TXT` values were seen at the record name. A count, never the values: those are strings from a domain Docket does not own.',
      ),
  })
  .meta({ id: 'WorkspaceDomainVerifyOut', description: 'The result of a DNS ownership check.' });
/** Domain verification result value. */
export type WorkspaceDomainVerifyOut = z.infer<typeof WorkspaceDomainVerifyOut>;

/** The workspace's claimed public name on the shared brief host. */
export const WorkspacePublicSlugOut = z
  .object({
    organizationId: OrganizationId.describe('The claiming workspace.'),
    slug: PublicSlug.nullable().describe('The claimed name; `null` when nothing is claimed.'),
    baseUrl: z
      .string()
      .nullable()
      .describe(
        'The absolute URL prefix briefs answer on for this workspace, or `null` when no name is claimed.',
      ),
  })
  .meta({ id: 'WorkspacePublicSlugOut', description: "A workspace's public name claim." });
/** Workspace public slug value. */
export type WorkspacePublicSlugOut = z.infer<typeof WorkspacePublicSlugOut>;

/** Body for claiming or changing the workspace's public name. */
export const WorkspacePublicSlugClaim = z
  .object({ slug: PublicSlug.describe('The name to claim.') })
  .meta({
    id: 'WorkspacePublicSlugClaim',
    description: "Claim or change a workspace's public name.",
  });
/** Validated slug-claim body. */
export type WorkspacePublicSlugClaim = z.infer<typeof WorkspacePublicSlugClaim>;

/** One labelled fact in a brief's masthead — a date, an owner, a health verdict. */
export const BriefFact = z
  .object({
    key: z
      .string()
      .describe(
        'Stable machine key (`status`, `health`, `owner`, `startDate`, `targetDate`, `priority`, `cadence`) the renderer switches on to choose wording and formatting.',
      ),
    value: z
      .string()
      .nullable()
      .describe(
        'The raw value: an enum member, a bare `YYYY-MM-DD` calendar day, or a person’s display name. Never a sentence.',
      ),
  })
  .meta({ id: 'BriefFact', description: 'One labelled fact about the published record.' });
/** Brief fact value. */
export type BriefFact = z.infer<typeof BriefFact>;

/** One line of work listed under a brief. */
export const BriefWorkItem = z
  .object({
    id: Id.describe('The record id.'),
    kind: z
      .enum(['initiative', 'program', 'project', 'task', 'milestone'])
      .describe('Which table the row came from, so the renderer can pick its glyph.'),
    title: z.string().describe('The record’s own title, read live.'),
    status: z.string().nullable().describe('Raw status/state value, or `null` where none applies.'),
    health: Health.nullable().describe('Health verdict, where the record carries one.'),
    startDate: z.iso
      .date()
      .nullable()
      .describe('Start date as a bare `YYYY-MM-DD` calendar day, where the record carries one.'),
    targetDate: z.iso
      .date()
      .nullable()
      .describe(
        'Target/due date as a bare `YYYY-MM-DD` calendar day, where the record carries one.',
      ),
    complete: z
      .boolean()
      .describe('Whether the row is finished, so a reader can see progress at a glance.'),
  })
  .meta({ id: 'BriefWorkItem', description: 'One row of work listed under a brief.' });
/** Brief work-item value. */
export type BriefWorkItem = z.infer<typeof BriefWorkItem>;

/** A titled group of work under a brief (its projects, its tasks, its milestones). */
export const BriefSection = z
  .object({
    key: z
      .enum(['programs', 'projects', 'milestones', 'tasks'])
      .describe('Stable section key the renderer turns into a heading.'),
    items: z.array(BriefWorkItem).describe('The rows in this section, in display order.'),
    total: z
      .number()
      .int()
      .describe(
        'How many rows exist in total. Larger than `items.length` when the section was capped, so the document can say so honestly instead of silently truncating.',
      ),
  })
  .meta({ id: 'BriefSection', description: 'A titled group of work under a brief.' });
/** Brief section value. */
export type BriefSection = z.infer<typeof BriefSection>;

/**
 * The public brief document — everything an anonymous visitor receives.
 *
 * @remarks
 * Every field is projected from the live work tables on each request. There is no
 * publication-time copy of any of it, which is the whole of CORE-27.
 */
export const PublicBriefOut = z
  .object({
    subjectKind: PublicationSubjectKind,
    subjectId: Id.describe('The published record.'),
    slug: PublicSlug.describe('The brief’s path segment.'),
    workspaceSlug: PublicSlug.describe('The publishing workspace’s public name.'),
    workspaceName: z.string().describe('The publishing workspace’s display name.'),
    vocabulary: VocabularySkin.describe(
      'The workspace’s vocabulary skin, so the document calls its work what the workspace calls it.',
    ),
    title: z.string().describe('The record’s title, read live.'),
    summary: z.string().nullable().describe('The record’s one-line summary, read live.'),
    description: z.string().nullable().describe('The record’s long-form body, read live.'),
    facts: z.array(BriefFact).describe('The masthead facts, in display order.'),
    sections: z.array(BriefSection).describe('The work listed under the record, in display order.'),
    publishedAt: z.iso.datetime().describe('When the brief became public.'),
    updatedAt: z.iso
      .datetime()
      .describe(
        'When the underlying record last changed — the honest "as of" line for a printed copy.',
      ),
    canonicalUrl: z
      .string()
      .nullable()
      .describe(
        'The absolute URL on the shared brief host, when the workspace has claimed a name there. `null` when the brief is reachable only on a custom domain.',
      ),
  })
  .meta({
    id: 'PublicBriefOut',
    description: 'A published brief, projected live from the work tables.',
  });
/** Public brief value. */
export type PublicBriefOut = z.infer<typeof PublicBriefOut>;

/** The owner reference a brief resolves to a display name; exported for handler typing. */
export type BriefOwnerRef = z.infer<typeof ActorId> | null;
