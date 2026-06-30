/**
 * `@docket/db` — observation schema island (Ambient Context Intelligence).
 *
 * @remarks
 * The ingestion pipeline's durable state:
 * - `inbound_event` — the write-ahead inbox of raw, signature-checked provider events.
 *   `organization_id` is **nullable** because the event is persisted (and 200-ACKed)
 *   before it is routed to an integration, and there is no `created_by` Actor (external
 *   origin), so it does NOT use {@link auditColumns}.
 * - `observation` — the normalized, append-only knowledge timeline. Org-scoped tenant
 *   data (an integration's org) via {@link auditColumns}, plus a `user_id` so the
 *   cross-org daily digest can aggregate "what *I* did" by person.
 * - `daily_digest` — the persisted end-of-day summary. Deliberately cross-org and
 *   user-scoped (no `organization_id`), like `notification`/`daily_plan_item`: one
 *   Sunsama-style summary for the person across every tool.
 * - `event_subscription` — external webhook/push-channel registrations (per integration).
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
  dailyDigestStatus,
  eventSubscriptionStatus,
  inboundEventStatus,
  observationKind,
  streamRelevance,
  summaryCadence,
} from '../enums';
import { genId } from '../id';
import type { DigestStats, ObservationActor, ObservationSubject } from '../types';
import { integration } from './crosscutting';
import { auditColumns, organization } from './identity';

/**
 * The durable write-ahead inbox: every inbound provider event is verified, persisted
 * here, and 200-ACKed before any processing (the "persist incoming data as fast as
 * possible" invariant). A lease-guarded sweep drains it into observations.
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
 * One normalized ambient observation — the knowledge timeline the daily digest reads.
 *
 * @remarks
 * Distinct from `audit_event` (Docket's internal feed over its own entities): an
 * observation describes provider-shaped activity whose source of truth lives elsewhere.
 * `user_id` is the global Better Auth user the activity is "for" (plain text, no FK —
 * matching `notification.user_id`), enabling the cross-org per-user digest aggregation.
 */
export const observation = pgTable(
  'observation',
  {
    ...auditColumns(),
    /** The Hub owner the activity is "for" (null when not attributable to one user). */
    userId: text('user_id'),
    integrationId: text('integration_id').references(() => integration.id, {
      onDelete: 'set null',
    }),
    provider: text('provider').notNull(),
    kind: observationKind('kind').notNull(),
    /** When it happened at the source — the timeline + digest sort key. */
    occurredAt: timestamp('occurred_at').notNull(),
    title: text('title').notNull(),
    summary: text('summary'),
    permalink: text('permalink'),
    externalActor: jsonb('external_actor').$type<ObservationActor>(),
    subject: jsonb('subject').$type<ObservationSubject>(),
    participants: jsonb('participants')
      .$type<ObservationActor[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    /** Provenance — the inbound event this was normalized from (null if since pruned). */
    sourceEventId: text('source_event_id').references(() => inboundEvent.id, {
      onDelete: 'set null',
    }),
    externalId: text('external_id'),
    /** Collapses duplicate observations within an org (stable per source object+kind). */
    dedupeKey: text('dedupe_key').notNull(),
  },
  (t) => [
    index('observation_org_user_occurred_idx').on(t.organizationId, t.userId, t.occurredAt),
    // The daily digest aggregates cross-org by user + day, so it needs a user-leading index
    // (the org-leading one above serves the org-scoped timeline view, not this query).
    index('observation_user_occurred_idx').on(t.userId, t.occurredAt),
    // The per-workspace stream firehose reads by org, newest-first, with an (occurredAt,id)
    // cursor — no user predicate, so the org/user index above can't serve it.
    index('observation_org_occurred_idx').on(t.organizationId, t.occurredAt, t.id),
    uniqueIndex('observation_org_dedupe_uq').on(t.organizationId, t.dedupeKey),
  ],
);

/**
 * The "concerns me" fan-out index for the cross-org personal stream.
 *
 * @remarks
 * A separate read-model table (not columns on {@link observation}, keeping the canonical
 * row lean): for each observation, one row per user it is relevant to, with the `reason`.
 * Fan-out is deliberately bounded to *targeted* relevance (mention/assignment/owned/
 * followed/participant) — the org-wide firehose is served by the org query, never by
 * fanning an event out to every member. `occurredAt` is denormalized so the personal
 * stream sorts + cursors without joining back to `observation`.
 */
export const observationRecipient = pgTable(
  'observation_recipient',
  {
    observationId: text('observation_id')
      .notNull()
      .references(() => observation.id, { onDelete: 'cascade' }),
    /** The Better Auth user this observation concerns (plain text, no FK — like `notification`). */
    userId: text('user_id').notNull(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    /** Denormalized from the observation for join-free sort + cursor. */
    occurredAt: timestamp('occurred_at').notNull(),
    reason: streamRelevance('reason').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.observationId, t.userId] }),
    index('observation_recipient_user_occurred_idx').on(t.userId, t.occurredAt, t.observationId),
  ],
);

/**
 * A user's explicit follow of a Docket subject, so its events reach their personal stream.
 *
 * @remarks
 * Implicit relevance (assignee/lead/owner/createdBy/participant) is derived at emit time
 * without a row here; this table covers *explicit* follows (and mutes). `subjectType`/
 * `subjectId` are free text to mirror an observation's subject addressing.
 */
export const streamSubscription = pgTable(
  'stream_subscription',
  {
    ...auditColumns(),
    userId: text('user_id').notNull(),
    subjectType: text('subject_type').notNull(),
    subjectId: text('subject_id').notNull(),
    muted: boolean('muted').notNull().default(false),
  },
  (t) => [
    uniqueIndex('stream_subscription_user_subject_uq').on(t.userId, t.subjectType, t.subjectId),
    index('stream_subscription_subject_idx').on(t.subjectType, t.subjectId),
  ],
);

/**
 * One user's persisted end-of-day digest (the Sunsama-style hero output).
 *
 * @remarks
 * Cross-org and user-scoped (no `organization_id`), like `notification`/`daily_plan_item`.
 * The unique `(user_id, digest_date, cadence)` is the idempotency watermark — one digest per
 * user per local day *per cadence* (lunch/eod/eow), no duplicate sends across cron ticks or
 * restarts. `status = 'generating'` doubles as the in-progress lease.
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
    observationCount: integer('observation_count').notNull().default(0),
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
 * An external event subscription — the stateful counterpart to the stateless ingestion
 * edge. Tracks how Docket is registered to receive a provider's events.
 *
 * @remarks
 * Minimal for Linear (whose OAuth app auto-creates webhooks), but the seam later
 * providers need: `expires_at` drives the Google Calendar watch-channel renewal cron,
 * `cursor` holds a sync/delta token, and `ingest_token` is the opaque per-integration
 * routing token embedded in the ingest URL for providers without payload-based routing.
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
