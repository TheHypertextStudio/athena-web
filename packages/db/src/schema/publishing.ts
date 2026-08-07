/**
 * `@docket/db` — publishing schema island (CORE-26 … CORE-34, MISS-04).
 *
 * @remarks
 * Three tables, and the shape of each is driven by one rule: **a brief is a permission
 * decision, not a copy of the work.** Nothing here stores a title, a description, a status,
 * or a task list. A {@link publication} row says only "this initiative/program/project is
 * readable by the public, at this path" — every byte a visitor sees is read live from
 * `initiative` / `program` / `project` / `task` at request time, which is what makes
 * CORE-27 ("the same underlying data sources as the rest of the app") true by construction
 * rather than by a sync job that can silently drift.
 *
 * Reachability is the other half. A published brief is served on:
 * - the product's own brief host, under the workspace's claimed {@link workspacePublicSlug}
 *   (CORE-32 — the fallback for a workspace that owns no domain), or
 * - a {@link workspaceDomain} the workspace has proved it owns via DNS (CORE-29 … CORE-31,
 *   MISS-04).
 *
 * Both name-spaces are globally unique, enforced in the database rather than in a handler:
 * a host or a workspace slug is a public identity, and two tenants answering to one name is
 * a tenancy break, not a UX annoyance.
 *
 * @see `@docket/env/custom-domain` for host normalization, token minting, and DNS verification.
 */
import { index, pgEnum, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { auditColumns } from './identity';

/**
 * The three work records that can be published as a brief.
 *
 * @remarks
 * Declared here rather than in `../enums` deliberately: this island is self-contained, and a
 * fresh `CREATE TYPE` in a migration carries none of the `ALTER TYPE … ADD VALUE` + use-in-the
 * -same-transaction hazard (Postgres `55P04`) that shared enums do. Tasks and cycles are
 * absent on purpose — a brief is a narrative document about a body of work, and a single task
 * has no narrative.
 */
export const publicationSubject = pgEnum('publication_subject', [
  'initiative',
  'program',
  'project',
]);

/**
 * One work record's public readability, plus the path it answers on.
 *
 * @remarks
 * Unpublishing sets `publishedAt` to `null` and keeps the row, so re-publishing later restores
 * the *same* URL instead of minting a new one — a link someone shared should not rot because a
 * status was toggled off and on. The serving guard is therefore `publishedAt IS NOT NULL`, never
 * mere row existence.
 *
 * `(organization_id, subject_kind, subject_id)` is unique so one record has exactly one public
 * identity, and `(organization_id, slug)` is unique so one workspace never has two records
 * fighting over a path. Slug uniqueness is scoped to the workspace, not global: two workspaces
 * may both publish `q3-roadmap`, because they are reached through different hosts or different
 * workspace slugs.
 */
export const publication = pgTable(
  'publication',
  {
    ...auditColumns(),
    /** Which kind of work record this brief describes. */
    subjectKind: publicationSubject('subject_kind').notNull(),
    /** The record's id, in the same organization. Deliberately not a foreign key: the column is
     * polymorphic across three tables, and the publish/unpublish handlers already resolve the
     * subject inside the owning organization before writing. */
    subjectId: text('subject_id').notNull(),
    /** The last path segment of the public URL, unique within the workspace. */
    slug: text('slug').notNull(),
    /** When the brief last became public. `null` means unpublished — the serving guard. */
    publishedAt: timestamp('published_at'),
    /** When the brief was last withdrawn, for the in-app history line. */
    unpublishedAt: timestamp('unpublished_at'),
  },
  (t) => [
    uniqueIndex('publication_subject_uq').on(t.organizationId, t.subjectKind, t.subjectId),
    uniqueIndex('publication_slug_uq').on(t.organizationId, t.slug),
    index('publication_org_idx').on(t.organizationId),
  ],
);

/**
 * A hostname a workspace has claimed, and (once proved) serves its briefs from.
 *
 * @remarks
 * `host` is globally unique — that single index is CORE-30's real enforcement. A handler check
 * alone loses the race between two concurrent claims; a unique index cannot. The value stored
 * is always the output of `normalizeCustomDomain`, so `Example.COM.`, `www.example.com`, and
 * `https://example.com/x` collapse to one row and collide with each other.
 *
 * `verifiedAt` is the serving gate (CORE-31): a row exists from the moment it is claimed, and
 * refuses to serve until DNS proves ownership. `lastFailure` stores a **stable failure code**
 * from `@docket/env/custom-domain` — never resolver output, which is attacker-influenced text
 * from a domain Docket does not own.
 */
export const workspaceDomain = pgTable(
  'workspace_domain',
  {
    ...auditColumns(),
    /** The normalized hostname. Globally unique: one host, one workspace, ever. */
    host: text('host').notNull(),
    /** The per-row secret published in the ownership `TXT` record. */
    verificationToken: text('verification_token').notNull(),
    /** When ownership was last proved. `null` means the domain must not serve. */
    verifiedAt: timestamp('verified_at'),
    /** When verification was last attempted, so the UI can say when it last looked. */
    lastCheckedAt: timestamp('last_checked_at'),
    /** Stable failure code from the last attempt (`lookup-failed`/`no-record`/`token-mismatch`). */
    lastFailure: text('last_failure'),
  },
  (t) => [
    uniqueIndex('workspace_domain_host_uq').on(t.host),
    index('workspace_domain_org_idx').on(t.organizationId),
  ],
);

/**
 * The workspace's claimed name on the shared brief host (CORE-32).
 *
 * @remarks
 * Separate from `organization.slug` on purpose. That column is an internal tenant key,
 * auto-derived from the workspace name at creation and never chosen; publishing it would hand
 * every workspace a public identity nobody picked, and would leak the workspace's name to
 * anyone who could enumerate it. This is an explicit, opt-in claim with its own reserved-word
 * screening.
 *
 * One row per workspace (`organization_id` unique) and one workspace per slug (`slug` unique):
 * changing the claim is an update of the same row, so a workspace can never hoard names.
 */
export const workspacePublicSlug = pgTable(
  'workspace_public_slug',
  {
    ...auditColumns(),
    /** The public path segment identifying this workspace on the shared brief host. */
    slug: text('slug').notNull(),
  },
  (t) => [
    uniqueIndex('workspace_public_slug_uq').on(t.slug),
    uniqueIndex('workspace_public_slug_org_uq').on(t.organizationId),
  ],
);
