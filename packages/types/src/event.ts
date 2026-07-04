/**
 * `@docket/types` — the canonical cross-tool Event contract.
 *
 * @remarks
 * One shape for "something happened", from any tool, internal or external: **who**
 * ({@link ActorRef}) did **what** ({@link EventKind}) to **which thing** ({@link EntityRef}),
 * **when**, **from where** ({@link SourceSystem}), plus an optional typed tool-specific
 * pocket ({@link EventDetail}). The point is that analogous things across tools collapse to
 * one canonical kind — a Docket task, a Linear issue, and a GitHub PR are all
 * `EntityRef{kind:'work_item'}` and share one row UI, with the source as a badge.
 *
 * Distinct from {@link AuditEventOut} (Docket's internal compliance ledger): an `Event` is
 * the user-facing activity feed. Every `*Out` field maps to a serialized DB column, so
 * nullable columns are `.nullable()` — never `.nullable().optional()`.
 */
import { z } from 'zod';

import {
  ActorId,
  DailyDigestId,
  EventId,
  InboundEventId,
  IntegrationId,
  OrganizationId,
} from './primitives';

/** The canonical, source-agnostic verb of an event — what happened. */
export const EventKind = z.enum([
  'message',
  'mention',
  'assignment',
  'status_change',
  'comment',
  'reaction',
  'created',
  'completed',
  'calendar_invite',
  'calendar_update',
  'task_assignment',
]);
/** Event-kind value. */
export type EventKind = z.infer<typeof EventKind>;

/** The tool an event came from (its attribution). `docket` is the internal source. */
export const SourceSystemKind = z.enum([
  'docket',
  'linear',
  'github',
  'slack',
  'discord',
  'google_calendar',
  'gmail',
]);
/** Source-system value. */
export type SourceSystemKind = z.infer<typeof SourceSystemKind>;

/**
 * The canonical, source-agnostic type of the thing an event is about.
 *
 * @remarks
 * The core of "scale to many tools": a Docket task, a Linear issue, and a GitHub PR all
 * collapse to `work_item`. A superset of the internal containment hierarchy, adding the
 * external-only kinds (`thread`, `message`, `document`) that have no Docket node.
 */
export const CanonicalEntityKind = z.enum([
  'work_item',
  'project',
  'program',
  'initiative',
  'cycle',
  'thread',
  'message',
  'document',
  'calendar_event',
  'person',
  'organization',
]);
/** Canonical-entity-kind value. */
export type CanonicalEntityKind = z.infer<typeof CanonicalEntityKind>;

/** Typed source attribution — replaces the old free-text `provider` string. */
export const SourceSystem = z
  .object({
    /** Which tool. */
    system: SourceSystemKind,
    /** The integration this was sourced through (null for internal `docket` events). */
    integrationId: IntegrationId.nullable(),
    /** Canonical deep-link into the source, when one exists. */
    externalUrl: z.string().nullable(),
  })
  .meta({ id: 'SourceSystem', description: 'Typed source attribution for an event.' });
/** Source-system value. */
export type SourceSystem = z.infer<typeof SourceSystem>;

/** The person behind an event, in any source system. */
export const ActorRef = z
  .object({
    /** Which tool this actor identity lives in. */
    source: SourceSystemKind,
    /** The person's native id in that source. */
    externalId: z.string(),
    /** Display name, when known. */
    displayName: z.string().nullable(),
    /** Avatar URL, when known. */
    avatarUrl: z.string().nullable(),
    /** Resolved Docket actor, when this person maps to one (enrichment seam; null until resolved). */
    docketActorId: ActorId.nullable(),
  })
  .meta({ id: 'ActorRef', description: 'The person behind an event, in any source.' });
/** Actor-ref value. */
export type ActorRef = z.infer<typeof ActorRef>;

/** The canonical, source-agnostic reference to the thing an event is about. */
export const EntityRef = z
  .object({
    /** The canonical type — drives the shared row UI. */
    kind: CanonicalEntityKind,
    /** Which tool this entity lives in. */
    source: SourceSystemKind,
    /** The entity's native id in that source. */
    externalId: z.string(),
    /** Display title, when known. */
    title: z.string().nullable(),
    /** Canonical URL, when available. */
    url: z.string().nullable(),
    /** Resolved Docket entity, when this maps to one (enrichment seam; null until resolved). */
    docketEntityId: z.string().nullable(),
  })
  .meta({ id: 'EntityRef', description: 'Canonical reference to the thing an event is about.' });
/** Entity-ref value. */
export type EntityRef = z.infer<typeof EntityRef>;

/**
 * The typed, tool-specific detail pocket — a closed discriminated union on `schema`.
 *
 * @remarks
 * Replaces the old contract-free `payload` jsonb. Each tool attaches a typed variant;
 * the `generic` variant carries anything we don't yet have a specific shape for, so a new
 * source still surfaces (a degraded row) rather than being dropped — the raw original
 * always remains in `inbound_event` for later re-enrichment. Adding a tool's detail = one
 * new arm here, no schema migration.
 */
export const EventDetail = z
  .discriminatedUnion('schema', [
    z.object({
      schema: z.literal('docket.state_change'),
      fromState: z.string().nullable(),
      toState: z.string(),
    }),
    z.object({
      schema: z.literal('linear.issue'),
      stateName: z.string().nullable(),
      priority: z.number().int().nullable(),
    }),
    z.object({
      schema: z.literal('github.pull_request'),
      number: z.number().int(),
      merged: z.boolean(),
      draft: z.boolean(),
    }),
    z.object({
      schema: z.literal('slack.message'),
      channelId: z.string(),
      threadTs: z.string().nullable(),
      text: z.string(),
      /**
       * Slack conversation type (`im` | `mpim` | `channel` | `group`) — drives DM relevance
       * routing. Defaulted so rows stored before this field existed still parse.
       */
      channelType: z.string().nullable().default(null),
    }),
    z.object({
      schema: z.literal('discord.message'),
      /** The Discord channel the message was posted in (a `thread` entity in canonical terms). */
      channelId: z.string(),
      /** The guild the channel belongs to, or `null` for a direct message. */
      guildId: z.string().nullable(),
      /** The message body. */
      text: z.string(),
    }),
    z.object({
      schema: z.literal('generic'),
      title: z.string(),
      summary: z.string().nullable(),
      url: z.string().nullable(),
    }),
  ])
  .meta({ id: 'EventDetail', description: 'Typed, tool-specific detail for an event.' });
/** Event-detail value. */
export type EventDetail = z.infer<typeof EventDetail>;

/** One canonical event in the cross-tool activity log. */
export const EventOut = z
  .object({
    id: EventId,
    organizationId: OrganizationId,
    /** The Hub owner the activity is "for" (null when not attributable to one user). */
    userId: z.string().nullable(),
    kind: EventKind,
    /** When it happened at the source (ISO-8601) — the timeline + digest sort key. */
    occurredAt: z.string(),
    title: z.string(),
    summary: z.string().nullable(),
    permalink: z.string().nullable(),
    source: SourceSystem,
    actor: ActorRef.nullable(),
    entity: EntityRef.nullable(),
    participants: z.array(ActorRef),
    detail: EventDetail.nullable(),
    externalId: z.string().nullable(),
    createdAt: z.string(),
  })
  .meta({ id: 'EventOut', description: 'A canonical event in the cross-tool activity log.' });
/** Event representation value. */
export type EventOut = z.infer<typeof EventOut>;

/** Processing status of one raw inbound event in the durable write-ahead inbox. */
export const InboundEventStatus = z.enum([
  'received',
  'processing',
  'processed',
  'failed',
  'skipped',
]);
/** Inbound-event status value. */
export type InboundEventStatus = z.infer<typeof InboundEventStatus>;

/** Lifecycle status of one user's daily digest for a given day. */
export const DailyDigestStatus = z.enum([
  'pending',
  'generating',
  'generated',
  'sent',
  'failed',
  'skipped_empty',
]);
/** Daily-digest status value. */
export type DailyDigestStatus = z.infer<typeof DailyDigestStatus>;

/** A raw inbound event as recorded in the durable write-ahead ingestion inbox. */
export const InboundEventOut = z
  .object({
    id: InboundEventId,
    /** Routed organization (null until the event is matched to an integration). */
    organizationId: OrganizationId.nullable(),
    integrationId: IntegrationId.nullable(),
    provider: z.string(),
    /** The provider's own event id — the dedup key against webhook retries. */
    externalEventId: z.string(),
    eventType: z.string(),
    signatureVerified: z.boolean(),
    status: InboundEventStatus,
    attempts: z.number().int(),
    lastError: z.string().nullable(),
    receivedAt: z.string(),
    processedAt: z.string().nullable(),
  })
  .meta({ id: 'InboundEventOut', description: 'A raw event in the write-ahead ingestion inbox.' });
/** Inbound-event representation value. */
export type InboundEventOut = z.infer<typeof InboundEventOut>;

/** Aggregate counts describing a day's events, shown alongside the digest. */
export const DigestStats = z
  .object({
    /** Total events summarized. */
    total: z.number().int(),
    /** Count keyed by source system. */
    bySource: z.record(z.string(), z.number().int()),
    /** Count keyed by event kind. */
    byKind: z.record(z.string(), z.number().int()),
  })
  .meta({ id: 'DigestStats', description: "Aggregate counts of a day's events." });
/** Digest-stats value. */
export type DigestStats = z.infer<typeof DigestStats>;

/**
 * A generated daily digest for one user on one day.
 *
 * @remarks
 * Deliberately cross-org and user-scoped (no `organizationId`): the Sunsama-style hero
 * feature is one summary for the *person*, aggregating activity across every tool/org.
 */
export const DailyDigestOut = z
  .object({
    id: DailyDigestId,
    userId: z.string(),
    /** The local calendar day this digest covers (`YYYY-MM-DD`, in the user's timezone). */
    digestDate: z.string(),
    status: DailyDigestStatus,
    summaryMarkdown: z.string().nullable(),
    summaryHtml: z.string().nullable(),
    stats: DigestStats.nullable(),
    eventCount: z.number().int(),
    generatedAt: z.string().nullable(),
    sentAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .meta({ id: 'DailyDigestOut', description: "A user's generated daily digest." });
/** Daily-digest representation value. */
export type DailyDigestOut = z.infer<typeof DailyDigestOut>;
