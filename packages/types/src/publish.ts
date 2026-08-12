/**
 * `@docket/types` — publishing DTOs: briefs and workspace custom domains.
 *
 * @remarks
 * Covers CORE-26 … CORE-34 and MISS-04. Two audiences share this module deliberately:
 *
 * - the **authenticated** surface (`Publication*`, `WorkspaceDomain*`), which the app uses to
 *   publish, unpublish, and manage domains; and
 * - the **public** surface ({@link PublicBriefOut}), the one document an anonymous visitor
 *   receives.
 *
 * A brief's default address is the publishing workspace's own identity slug
 * (`organization.slug`, `@docket/types/organization`) — every workspace has one from the moment
 * it exists, so there is no separate "claim a public name" concept here anymore.
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
import { PublicSlug } from './slug';
import { VocabularySkin } from './vocabulary';

export { PublicSlug, RESERVED_PUBLIC_SLUGS, suggestSlug as suggestPublicSlug } from './slug';

/** The three work records that can be published as a brief. */
export const PublicationSubjectKind = z
  .enum(['initiative', 'program', 'project'])
  .describe(
    'Which kind of work record a brief describes. Tasks and cycles are excluded: a brief is a narrative document about a body of work.',
  );
/** Publication subject kind value. */
export type PublicationSubjectKind = z.infer<typeof PublicationSubjectKind>;

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
        'The path the brief answers on, relative to whichever host serves it (e.g. `/acme/q3-roadmap` on the shared brief host, or `/q3-roadmap` on a verified custom domain).',
      ),
    urls: z
      .array(z.string())
      .describe(
        'Every absolute URL this brief is currently reachable at: the shared brief host (when configured for this deployment) plus one per verified custom domain. Empty for a withdrawn brief, or in a deployment with no brief host and no verified domain.',
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
