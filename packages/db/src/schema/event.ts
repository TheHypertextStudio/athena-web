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
 * - `activity_day` / `activity_highlight` — one person's narrated day, and the per-episode
 *   sentences they can curate. The *record* (`event`) is append-only; the *story* is editable.
 * - `daily_digest` — one delivery of a narrated day (email today, other channels later). Kept
 *   distinct from `activity_day` so several cadences can share one day's episodes.
 * - `event_subscription` — external webhook/push-channel registrations (per integration).
 *
 * `audit_event` (a separate compliance ledger) is intentionally NOT here — different
 * concern, different retention; the feed reads `event` only.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
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
  activityDayStatus,
  activityNarrationState,
  canonicalEntityKind,
  dailyDigestStatus,
  entityAssociation,
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
    /**
     * How far entity association has got.
     *
     * @remarks
     * A column rather than a field inside the `entity` jsonb: this is the firehose's bookkeeping
     * about its own resolution work, and the sweep that re-resolves `pending` rows wants an indexed
     * scan, not a jsonb probe.
     */
    entityAssociation: entityAssociation('entity_association').notNull().default('pending'),
    /**
     * The Docket entity this event turned out to be about.
     *
     * @remarks
     * A real column rather than only `entity.docketEntityId` inside the jsonb, for two reasons.
     * "Everything that happened to this task, across every tool" is a headline read and a btree
     * index serves it; a jsonb probe does not. And it decouples resolving from acting on the
     * result — four consumers read the jsonb field, so populating that field is indistinguishable
     * from switching all four on at once, which is exactly what the rollout must avoid.
     */
    docketEntityId: text('docket_entity_id'),
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
    // The re-association sweep claims rows whose subject had no Docket entity when it first
    // arrived. Partial on both columns: `pending` drains toward empty, and an event with no subject
    // at all has nothing to associate, so it must never enter the sweep's working set.
    index('event_pending_association_idx')
      .on(t.organizationId, t.entityKind)
      .where(sql`${t.entityAssociation} = 'pending' and ${t.entityKind} is not null`),
    // "Everything that happened to this thing, across every tool" — the read association exists to
    // make possible. Partial, because unassociated rows can never satisfy it.
    index('event_docket_entity_occurred_idx')
      .on(t.docketEntityId, t.occurredAt)
      .where(sql`${t.docketEntityId} is not null`),
    // `matched` is exactly "we have an id", in both directions. Without this the two columns can
    // drift into a row claiming a match it cannot name, or naming an id it does not claim.
    check(
      'event_association_id_check',
      sql`(${t.entityAssociation} = 'matched') = (${t.docketEntityId} IS NOT NULL)`,
    ),
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
 * One *delivery* of a narrated day (the Sunsama-style hero output).
 *
 * @remarks
 * Cross-org and user-scoped (no `organization_id`), like `notification`/`daily_plan_item`.
 * The unique `(user_id, digest_date, cadence)` is the idempotency watermark — one digest per
 * user per local day *per cadence* (lunch/eod/eow). `status = 'generating'` doubles as the
 * in-progress lease.
 *
 * The content it delivers lives on {@link activityDay}; this row records that it went out, to which
 * channel, when, and with what result. `summary_markdown`/`summary_html` are therefore the
 * *delivered artifact* — assembled at send time from whichever highlights were kept, and frozen
 * thereafter, so later curation cannot retroactively rewrite what somebody already received.
 */
export const dailyDigest = pgTable(
  'daily_digest',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    userId: text('user_id').notNull(),
    /** The local calendar day this digest covers (in the user's timezone). */
    digestDate: date('digest_date').notNull(),
    /**
     * The narrated day this delivered. Nullable only because rows predating the split have none.
     */
    activityDayId: text('activity_day_id').references(() => activityDay.id, {
      onDelete: 'set null',
    }),
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
 * One person's narrated day — the durable answer to "what did I do".
 *
 * @remarks
 * Cross-org and user-scoped, because a day does not respect organization boundaries. The unique
 * `(user_id, local_date)` is the identity *and* the idempotency watermark: reconciling a day twice
 * converges rather than duplicating.
 *
 * Deliberately separate from {@link dailyDigest}, which is a *delivery* record (it has `sent_at` and
 * a `delivery_message_id`). Hanging the narrated content off the delivery envelope is what had kept
 * the `lunch|eod|eow` cadence permanently hardcoded to one value — a second cadence over the same
 * day would have needed a second copy of the episodes. One narrated day now has many deliveries.
 *
 * `timezone` is recorded rather than re-derived because it is the tz the day's *boundaries* were
 * computed in, and somebody who travels would otherwise silently re-cut a day that has already been
 * narrated and curated.
 */
export const activityDay = pgTable(
  'activity_day',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    userId: text('user_id').notNull(),
    /** The local calendar day this covers, in {@link timezone}. */
    localDate: date('local_date').notNull(),
    /** The IANA zone the day's boundaries were computed in. */
    timezone: text('timezone').notNull(),
    status: activityDayStatus('status').notNull().default('pending'),
    /** Canonical events the day was built from — the honest emptiness/cost signal. */
    eventCount: integer('event_count').notNull().default(0),
    stats: jsonb('stats').$type<DigestStats>(),
    /** When episodes were last rebuilt from the event log. */
    reconciledAt: timestamp('reconciled_at'),
    /** When narration last completed for every episode that could be narrated. */
    narratedAt: timestamp('narrated_at'),
    lastError: text('last_error'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('activity_day_user_date_uq').on(t.userId, t.localDate),
    index('activity_day_status_idx').on(t.status),
  ],
);

/**
 * One episode of a narrated day: what happened, and the sentence about it.
 *
 * @remarks
 * A row per episode rather than a jsonb array on {@link activityDay}, because curation is
 * interactive per-item editing. An array would force read-modify-write of the whole day for every
 * save, so a phone and a laptop editing two different lines would silently lose one — and it would
 * leave the API with no stable id to address a single line by.
 *
 * The division of authority is the point. `event` rows are append-only and are never edited: the
 * record is fixed. `narration` is generated, `edited_narration` is the person's rewrite, and `kept`
 * is their decision about whether the line belongs in their highlights — the story is editable.
 * There is deliberately nowhere on `event` to write any of that.
 *
 * `event_ids` carries no foreign key. An episode is a derived presentation grouping over a log, not
 * a durable relation; nothing asks "which highlights contain event X", a join table would add a
 * write and buy no read, and the absence of the constraint means an event-retention purge can never
 * orphan-block a day. A GIN index on the array is the cheap upgrade if the reverse read appears.
 */
export const activityHighlight = pgTable(
  'activity_highlight',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    activityDayId: text('activity_day_id')
      .notNull()
      .references(() => activityDay.id, { onDelete: 'cascade' }),
    /** The order-independent episode key from `domain packages` — stable under backfill. */
    episodeKey: text('episode_key').notNull(),
    /** Chronological position within the day. */
    sort: integer('sort').notNull(),
    /** The episode's first and last event times — a span, never a duration worked. */
    occurredAt: timestamp('occurred_at').notNull(),
    endedAt: timestamp('ended_at').notNull(),
    sourceSystem: sourceSystem('source_system').notNull(),
    entityKind: canonicalEntityKind('entity_kind'),
    docketEntityId: text('docket_entity_id'),
    /** Whether the subject resolved to Docket work — what gates the manual link action. */
    entityAssociation: entityAssociation('entity_association').notNull().default('unmatched'),
    /** The subject's label, denormalized so reading a day needs no join. */
    subjectTitle: text('subject_title'),
    /** The append-only events this narrates. See the remarks on the missing FK. */
    eventIds: text('event_ids').array().notNull(),
    narrationState: activityNarrationState('narration_state').notNull().default('pending'),
    /**
     * When narration last claimed this row, so a stranded claim can be taken back.
     *
     * @remarks
     * Its own column rather than reusing `updatedAt`: the episode upsert touches every row on every
     * reconcile, so `updatedAt` says when the *facts* were last written, not when narration took the
     * row. Using it to age a claim would mean no claim ever looked stale.
     */
    narrationClaimedAt: timestamp('narration_claimed_at'),
    /** The generated sentence; null until narration succeeds. Never edited in place. */
    narration: text('narration'),
    /** The person's rewrite. Null means "use `narration`". */
    editedNarration: text('edited_narration'),
    /** False = dropped from the highlights. The event log is untouched either way. */
    kept: boolean('kept').notNull().default(true),
    /** When a person last touched this line; null = untouched by a human. */
    curatedAt: timestamp('curated_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('activity_highlight_day_episode_uq').on(t.activityDayId, t.episodeKey),
    index('activity_highlight_day_sort_idx').on(t.activityDayId, t.sort),
  ],
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
