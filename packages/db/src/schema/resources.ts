/**
 * `@docket/db` — referenced external resources and the mention edges that point at them.
 *
 * @remarks
 * Three tables split along a disclosure boundary rather than along a technical one.
 *
 * {@link externalResource} is org-scoped and deduped: one row per resource per organization,
 * carrying the metadata a preview renders from. It is written only at the moment a resource is
 * *disclosed* into shared content — a mention committed into a description, or an attachment
 * added — because mentioning a Drive file in a project description is a deliberate act of
 * telling everyone who can read that description what the file is called. Picker results are
 * never persisted here; searching your own Drive discloses nothing to anyone.
 *
 * {@link mention} is the edge from a piece of prose to a target, derived by `reconcileMentions`
 * from the stored Markdown rather than written by the editor. It is a convergent projection: the
 * reconciler re-reads committed prose and makes the edge set match, so a lost write self-heals
 * instead of drifting.
 *
 * {@link mentionUsage} is the per-user recency ledger behind bare-`@` recents and provider
 * affinity. It deliberately holds no titles, URLs, or any other metadata — only a key and
 * counters — so ranking one user's picker cannot leak what another user has looked at.
 *
 * See `docs/engineering/specs/resource-mentions.md`.
 */
import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import {
  externalResourceType,
  mentionEntityKind,
  mentionSubjectType,
  mentionTargetKind,
  resourceProvider,
  resourceUnfurlStatus,
} from '../enums';
import { genId } from '../id';
import { user } from './auth';
import { integration } from './crosscutting';
import { auditColumns, organization } from './identity';

/**
 * A resource outside Docket that someone has referenced — a Drive file, a web page.
 *
 * @remarks
 * Deduped per organization by {@link externalResource.canonicalKey}, which is derived by a pure
 * function so the same document reached through two URL shapes (`docs.google.com/document/d/X/edit`
 * and `drive.google.com/open?id=X`) collapses to one row. Provider rows key on the provider's own
 * id; generic web rows key on a hash of the normalized URL.
 *
 * Every field a preview renders is a real column. There is no per-provider `preview` jsonb bag,
 * because a bag keyed by a provider string is a discriminator wearing a boundary's clothes —
 * anything a column cannot hold is fetched live through the `ResourceSearch` port instead.
 *
 * {@link externalResource.title} is nullable with no default and stays null until an unfurl
 * resolves one. The row must not store the URL as a stand-in title: a caller that cannot tell
 * "not fetched yet" from "actually called that" will render a fabricated name.
 *
 * The unfurl lease lives on the row rather than in a sibling outbox table, because one row is one
 * URL is one unfurl job — dedupe is then structural instead of a `dedupeKey` convention. This
 * mirrors the lease on `agent_session_dispatch`.
 */
export const externalResource = pgTable(
  'external_resource',
  {
    ...auditColumns(),
    provider: resourceProvider('provider').notNull(),
    /** Stable dedupe identity within the org. See `canonicalResourceKey` in `domain packages`. */
    canonicalKey: text('canonical_key').notNull(),
    canonicalUrl: text('canonical_url').notNull(),
    /** The provider's own id for the resource; null for generic web pages. */
    externalId: text('external_id'),
    sourceIntegrationId: text('source_integration_id').references(() => integration.id, {
      onDelete: 'set null',
    }),
    resourceType: externalResourceType('resource_type').notNull().default('unknown'),
    title: text('title'),
    description: text('description'),
    siteName: text('site_name'),
    iconUrl: text('icon_url'),
    thumbnailUrl: text('thumbnail_url'),
    mimeType: text('mime_type'),
    ownerLabel: text('owner_label'),
    /** When the resource last changed at the provider, when the provider tells us. */
    externalUpdatedAt: timestamp('external_updated_at'),
    unfurlStatus: resourceUnfurlStatus('unfurl_status').notNull().default('pending'),
    unfurlAttempts: integer('unfurl_attempts').notNull().default(0),
    unfurlAfter: timestamp('unfurl_after').notNull().defaultNow(),
    unfurlLeaseToken: text('unfurl_lease_token'),
    unfurlLeaseExpiresAt: timestamp('unfurl_lease_expires_at'),
    unfurlError: text('unfurl_error'),
    fetchedAt: timestamp('fetched_at'),
    /** When the cached metadata should be refetched; null while never fetched. */
    staleAfter: timestamp('stale_after'),
  },
  (t) => [
    uniqueIndex('external_resource_key_uq').on(t.organizationId, t.canonicalKey),
    index('external_resource_unfurl_due_idx').on(t.unfurlStatus, t.unfurlAfter),
    index('external_resource_provider_idx').on(t.organizationId, t.provider, t.externalId),
  ],
);

/**
 * One reference authored inside an entity's prose, pointing either at a Docket entity or at an
 * {@link externalResource}.
 *
 * @remarks
 * Derived, never user-written: `reconcileMentions` parses the subject's Markdown after each
 * commit and makes this table match. `position` is the ordinal within `(subject, field)`, which
 * keeps the Resources tab in document order and gives the diff a stable identity to match on.
 *
 * There is no `origin` column and no `'attached'` value. Attachments live in `attachment`, so
 * "attached by hand" versus "mentioned in prose" is which table the row is in — a real
 * distinction, not a flag. {@link mention.label} is the link text as authored and is only ever a
 * fallback; the live title comes from the target.
 *
 * `mention_target_entity_idx` is what makes backlinks free: "where is this task referenced?" is
 * an index scan, with no second table to keep in sync.
 */
export const mention = pgTable(
  'mention',
  {
    ...auditColumns(),
    subjectType: mentionSubjectType('subject_type').notNull(),
    subjectId: text('subject_id').notNull(),
    /** The Markdown-bearing column the reference was authored in: `description` or `body`. */
    field: text('field').notNull(),
    position: integer('position').notNull(),
    targetKind: mentionTargetKind('target_kind').notNull(),
    targetEntityKind: mentionEntityKind('target_entity_kind'),
    targetEntityId: text('target_entity_id'),
    externalResourceId: text('external_resource_id').references(() => externalResource.id, {
      onDelete: 'cascade',
    }),
    label: text('label').notNull(),
  },
  (t) => [
    index('mention_subject_idx').on(t.subjectType, t.subjectId),
    index('mention_target_entity_idx').on(t.organizationId, t.targetEntityKind, t.targetEntityId),
    index('mention_resource_idx').on(t.externalResourceId),
    uniqueIndex('mention_inline_uq').on(t.subjectType, t.subjectId, t.field, t.position),
    check(
      'mention_entity_arm_check',
      sql`(${t.targetKind} = 'entity') = (${t.targetEntityKind} IS NOT NULL AND ${t.targetEntityId} IS NOT NULL)`,
    ),
    check(
      'mention_external_arm_check',
      sql`(${t.targetKind} = 'external') = (${t.externalResourceId} IS NOT NULL)`,
    ),
  ],
);

/**
 * How recently and how often one user has referenced one thing.
 *
 * @remarks
 * The ledger behind bare-`@` recents and per-provider ranking affinity. Keyed by the same
 * canonical key as {@link externalResource} for external targets, and by `docket:<kind>:<id>` for
 * Docket entities, so one table ranks both origins and there is no second recents store to keep
 * coherent.
 *
 * It holds no metadata by design. Recency is a per-user signal, but a title is a per-resource
 * disclosure — keeping them in separate tables means ranking can be personal without a user's
 * picker history exposing anything about what they can see.
 */
export const mentionUsage = pgTable(
  'mention_usage',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    canonicalKey: text('canonical_key').notNull(),
    useCount: integer('use_count').notNull().default(1),
    lastUsedAt: timestamp('last_used_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('mention_usage_user_key_uq').on(t.userId, t.organizationId, t.canonicalKey),
    index('mention_usage_recent_idx').on(t.userId, t.organizationId, t.lastUsedAt),
  ],
);
