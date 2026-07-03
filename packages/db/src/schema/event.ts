/**
 * `@docket/db` — the canonical cross-tool Event substrate.
 *
 * @remarks
 * The activity-feed pipeline's durable state:
 * - `inbound_event` — the write-ahead inbox of raw, signature-checked provider webhooks.
 *   `organization_id` is **nullable** because the event is persisted (and 200-ACKed)
 *   before it is routed to an integration, and there is no `created_by` Actor (external
 *   origin), so it does NOT use {@link auditColumns}.
 * - `event` — the canonical, append-only activity log. ONE shape for "something happened"
 *   from any tool (internal `docket` or external), legitimized by a real shared contract:
 *   actor + kind + entity + occurredAt + source + typed detail. Org-scoped via
 *   {@link auditColumns}, plus a `user_id` for the cross-org per-person digest.
 * - `event_recipient` — the "concerns me" fan-out read-model (one row per relevant user).
 * - `stream_subscription` — a user's explicit follow/mute of a canonical entity.
 * - `daily_digest` — the persisted cross-org per-user summary.
 * - `event_subscription` — external webhook/push-channel registrations (per integration).
 *
 * `audit_event` (a separate compliance ledger) is intentionally NOT here — different
 * concern, different retention; the feed reads `event` only.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import {
  canonicalEntityKind,
  dailyDigestStatus,
  eventKind,
  eventSubscriptionStatus,
  inboundEventStatus,
  sourceSystem,
  streamRelevance,
  summaryCadence,
} from '../enums';
import { genId } from '../id';
import type { ActorRef, DigestStats, EntityRef, EventDetail } from '../types';
import { integration } from './crosscutting';
import { auditColumns, organization } from './identity';

/**
 * The durable write-ahead inbox: every inbound provider event is verified, persisted
 * here, and 200-ACKed before any processing (the "persist incoming data as fast as
 * possible" invariant). A lease-guarded sweep drains it into canonical events. The raw
 * `payload` is retained here so an unmapped event can be re-normalized later.
 */
export const inboundEvent = pgTable(
  'inbound_event',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    /** Routed tenant — null until the event is matched to an integration. */
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),
    integrationId: text('integration_id').references(() => integration.id, {
      onDelete: 'set null',
    }),
    provider: text('provider').notNull(),
    /** The provider's own event id — the dedup key against webhook retries. */
    externalEventId: text('external_event_id').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    signatureVerified: boolean('signature_verified').notNull().default(false),
    status: inboundEventStatus('status').notNull().default('received'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    receivedAt: timestamp('received_at').notNull().defaultNow(),
    processedAt: timestamp('processed_at'),
    /** In-progress lease for the drain sweep (serializes concurrent processing). */
    processingStartedAt: timestamp('processing_started_at'),
  },
  (t) => [
    uniqueIndex('inbound_event_provider_external_uq').on(t.provider, t.externalEventId),
    index('inbound_event_status_idx').on(t.status, t.receivedAt),
  ],
);

/**
 * One canonical event — the cross-tool activity log the feed and digest read.
 *
 * @remarks
 * Internal Docket actions and external provider activity share this one table because they
 * share a genuine contract (a Docket task completing and a Linear issue completing are both
 * `kind='completed'` on an `entity.kind='work_item'`), NOT a label. `source_system` is the
 * attribution badge; `entity_kind` is denormalized from `entity.kind` so the feed can filter
 * "all work-item activity across tools" without reaching into jsonb. `user_id` is the global
 * Better Auth user the activity is "for" (plain text, no FK), for the cross-org digest.
 */
export const event = pgTable(
  'event',
  {
    ...auditColumns(),
    /** The Hub owner the activity is "for" (null when not attributable to one user). */
    userId: text('user_id'),
    /** Attribution: which tool this event came from. */
    sourceSystem: sourceSystem('source_system').notNull(),
    /** The integration it was sourced through (null for internal `docket` events). */
    integrationId: text('integration_id').references(() => integration.id, {
      onDelete: 'set null',
    }),
    /** Canonical deep-link into the source, when one exists. */
    externalUrl: text('external_url'),
    kind: eventKind('kind').notNull(),
    /** When it happened at the source — the timeline + digest sort key. */
    occurredAt: timestamp('occurred_at').notNull(),
    title: text('title').notNull(),
    summary: text('summary'),
    permalink: text('permalink'),
    /** Who — the person behind the event, in any source. */
    actor: jsonb('actor').$type<ActorRef>(),
    /** Which thing — the canonical, source-agnostic subject reference. */
    entity: jsonb('entity').$type<EntityRef>(),
    /** Denormalized from `entity.kind` for join-free, jsonb-free filtering. */
    entityKind: canonicalEntityKind('entity_kind'),
    participants: jsonb('participants')
      .$type<ActorRef[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Typed, tool-specific detail (a closed union incl. `generic`); null when none. */
    detail: jsonb('detail').$type<EventDetail>(),
    /** Provenance — the inbound event this was normalized from (null if since pruned). */
    sourceEventId: text('source_event_id').references(() => inboundEvent.id, {
      onDelete: 'set null',
    }),
    externalId: text('external_id'),
    /** Collapses duplicate events within an org (stable per source object+kind). */
    dedupeKey: text('dedupe_key').notNull(),
  },
  (t) => [
    index('event_org_user_occurred_idx').on(t.organizationId, t.userId, t.occurredAt),
    // The cross-org per-user digest aggregates by user + day, so it needs a user-leading index.
    index('event_user_occurred_idx').on(t.userId, t.occurredAt),
    // The per-workspace firehose reads by org, newest-first, with an (occurredAt,id) cursor.
    index('event_org_occurred_idx').on(t.organizationId, t.occurredAt, t.id),
    // Powers "all <entity_kind> activity across tools" — the scale-to-many-tools headline read.
    index('event_org_entitykind_occurred_idx').on(t.organizationId, t.entityKind, t.occurredAt),
    uniqueIndex('event_org_dedupe_uq').on(t.organizationId, t.dedupeKey),
  ],
);

/**
 * The "concerns me" fan-out index for the cross-org personal feed.
 *
 * @remarks
 * A separate read-model table (not columns on {@link event}, keeping the canonical row
 * lean): for each event, one row per user it is relevant to, with the `reason`. Fan-out is
 * bounded to *targeted* relevance (mention/assignment/owned/followed/participant) — the
 * org-wide firehose is served by the org query, never by fanning to every member.
 * `occurredAt` is denormalized so the personal feed sorts + cursors without joining back.
 */
export const eventRecipient = pgTable(
  'event_recipient',
  {
    eventId: text('event_id')
      .notNull()
      .references(() => event.id, { onDelete: 'cascade' }),
    /** The Better Auth user this event concerns (plain text, no FK — like `notification`). */
    userId: text('user_id').notNull(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    /** Denormalized from the event for join-free sort + cursor. */
    occurredAt: timestamp('occurred_at').notNull(),
    reason: streamRelevance('reason').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.userId] }),
    index('event_recipient_user_occurred_idx').on(t.userId, t.occurredAt, t.eventId),
  ],
);

/**
 * A user's explicit follow (or mute) of a canonical entity, so its events reach their feed.
 *
 * @remarks
 * Implicit relevance (assignee/lead/owner/createdBy/participant) is derived at routing time
 * without a row here; this table covers *explicit* follows (and mutes). The follow target is
 * the canonical `(entityKind, source, externalId)` identity — matching an {@link event}'s
 * `entity`, so a follow on a Linear issue and on its Docket twin are distinct, addressable rows.
 */
export const streamSubscription = pgTable(
  'stream_subscription',
  {
    ...auditColumns(),
    userId: text('user_id').notNull(),
    entityKind: canonicalEntityKind('entity_kind').notNull(),
    source: sourceSystem('source').notNull(),
    externalId: text('external_id').notNull(),
    muted: boolean('muted').notNull().default(false),
  },
  (t) => [
    uniqueIndex('stream_subscription_user_entity_uq').on(
      t.userId,
      t.entityKind,
      t.source,
      t.externalId,
    ),
    index('stream_subscription_entity_idx').on(t.entityKind, t.source, t.externalId),
  ],
);

/**
 * One user's persisted summary (the Sunsama-style hero output).
 *
 * @remarks
 * Cross-org and user-scoped (no `organization_id`), like `notification`/`daily_plan_item`.
 * The unique `(user_id, digest_date, cadence)` is the idempotency watermark — one digest per
 * user per local day *per cadence* (lunch/eod/eow). `status = 'generating'` doubles as the
 * in-progress lease.
 */
export const dailyDigest = pgTable(
  'daily_digest',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    userId: text('user_id').notNull(),
    /** The local calendar day this digest covers (in the user's timezone). */
    digestDate: date('digest_date').notNull(),
    /** Which summary this row is — lunch / end-of-day / end-of-week. */
    cadence: summaryCadence('cadence').notNull().default('eod'),
    status: dailyDigestStatus('status').notNull().default('pending'),
    summaryMarkdown: text('summary_markdown'),
    summaryHtml: text('summary_html'),
    stats: jsonb('stats').$type<DigestStats>(),
    eventCount: integer('event_count').notNull().default(0),
    generatedAt: timestamp('generated_at'),
    sentAt: timestamp('sent_at'),
    /** The mailer's accepted-message id, once delivered. */
    deliveryMessageId: text('delivery_message_id'),
    lastError: text('last_error'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex('daily_digest_user_date_cadence_uq').on(t.userId, t.digestDate, t.cadence)],
);

/**
 * Provider-side thread participation memory — "which external users have posted in which
 * thread" — powering the `participant` relevance for replies in threads a connected user
 * is part of.
 *
 * @remarks
 * Deliberately keyed on *external* identities (`provider` + workspace + external user id),
 * not Docket users: participation is a fact about the source system, recorded even for
 * messages that never become canonical {@link event} rows (noise control skips irrelevant
 * messages, so the `event` table cannot answer this question). Provider-generic so a future
 * Teams/Discord observer reuses it. One row per (thread, user), upserted on `lastSeenAt`.
 */
export const threadParticipation = pgTable(
  'thread_participation',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    /** The provider workspace/team the thread lives in (e.g. Slack `team_id`). */
    externalWorkspaceId: text('external_workspace_id').notNull(),
    channelId: text('channel_id').notNull(),
    /** The thread root's provider timestamp/id — a top-level message registers under its own. */
    threadTs: text('thread_ts').notNull(),
    /** The participating user's provider-native id (e.g. Slack `U…`). */
    externalUserId: text('external_user_id').notNull(),
    lastSeenAt: timestamp('last_seen_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('thread_participation_identity_uq').on(
      t.organizationId,
      t.provider,
      t.externalWorkspaceId,
      t.channelId,
      t.threadTs,
      t.externalUserId,
    ),
    index('thread_participation_lookup_idx').on(
      t.organizationId,
      t.externalWorkspaceId,
      t.channelId,
      t.threadTs,
    ),
  ],
);

/**
 * An external event subscription — the stateful counterpart to the stateless ingestion
 * edge. Tracks how Docket is registered to receive a provider's events.
 *
 * @remarks
 * `expires_at` drives renewal crons (e.g. Google Calendar watch channels), `cursor` holds a
 * sync/delta token, and `ingest_token` is the opaque per-integration routing token embedded
 * in the ingest URL for providers without payload-based routing.
 */
export const eventSubscription = pgTable(
  'event_subscription',
  {
    ...auditColumns(),
    integrationId: text('integration_id')
      .notNull()
      .references(() => integration.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    /** The provider's own subscription/channel id, when it issues one. */
    externalSubscriptionId: text('external_subscription_id'),
    /** Opaque per-integration token used to route + authenticate inbound deliveries. */
    ingestToken: text('ingest_token'),
    status: eventSubscriptionStatus('status').notNull().default('active'),
    /** When the subscription/channel expires and must be renewed (null = no expiry). */
    expiresAt: timestamp('expires_at'),
    /** Provider sync/delta cursor for change-feed providers (e.g. Calendar syncToken). */
    cursor: text('cursor'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    index('event_subscription_integration_idx').on(t.integrationId),
    index('event_subscription_expiry_idx').on(t.status, t.expiresAt),
  ],
);
