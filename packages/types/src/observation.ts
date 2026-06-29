/**
 * `@docket/types` — Ambient Context Intelligence DTOs (observations, the inbound
 * write-ahead inbox, and the daily digest).
 *
 * @remarks
 * An Observation is a normalized, provider-shaped record of something the user did in
 * an external tool (a Linear mention, a Slack message, a calendar invite) — the
 * append-only knowledge timeline the daily digest summarizes. It is deliberately
 * distinct from the internal {@link AuditEventOut} feed, whose subjects are Docket's
 * own entities; observations describe activity where the source of truth lives
 * elsewhere. Every `*Out` field maps to a serialized DB column, so nullable columns
 * are `.nullable()` (present, possibly null) — never `.nullable().optional()`.
 */
import { z } from 'zod';

import {
  DailyDigestId,
  InboundEventId,
  IntegrationId,
  ObservationId,
  OrganizationId,
} from './primitives';

/** The high-level kind of an ambient observation captured from an external tool. */
export const ObservationKind = z.enum([
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
/** Observation-kind value. */
export type ObservationKind = z.infer<typeof ObservationKind>;

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

/** The external person behind an observed action. */
export const ObservationActor = z
  .object({
    /** The person's native id in the source system. */
    externalId: z.string(),
    /** Display name, when the provider exposes one. */
    displayName: z.string().optional(),
    /** Avatar URL, when known. */
    avatar: z.string().optional(),
  })
  .meta({ id: 'ObservationActor', description: 'The external person behind an observed action.' });
/** Observation-actor value. */
export type ObservationActor = z.infer<typeof ObservationActor>;

/** The external object an observation is about (an issue, thread, channel, event). */
export const ObservationSubject = z
  .object({
    /** Subject kind in the source system (e.g. `issue`, `thread`, `channel`, `event`). */
    type: z.string(),
    /** The subject's native id in the source system. */
    externalId: z.string(),
    /** Display title, when the provider exposes one. */
    title: z.string().optional(),
    /** Canonical URL, when available. */
    url: z.string().optional(),
  })
  .meta({ id: 'ObservationSubject', description: 'The external object an observation is about.' });
/** Observation-subject value. */
export type ObservationSubject = z.infer<typeof ObservationSubject>;

/** One normalized ambient observation in the knowledge timeline. */
export const ObservationOut = z
  .object({
    id: ObservationId,
    organizationId: OrganizationId,
    /** The Hub owner the activity is "for" (null when not attributable to one user). */
    userId: z.string().nullable(),
    /** The integration the observation was sourced through (null if since removed). */
    integrationId: IntegrationId.nullable(),
    provider: z.string(),
    kind: ObservationKind,
    /** When it happened at the source (ISO-8601) — the timeline + digest sort key. */
    occurredAt: z.string(),
    title: z.string(),
    summary: z.string().nullable(),
    permalink: z.string().nullable(),
    externalActor: ObservationActor.nullable(),
    subject: ObservationSubject.nullable(),
    participants: z.array(ObservationActor),
    externalId: z.string().nullable(),
    createdAt: z.string(),
  })
  .meta({ id: 'ObservationOut', description: 'A normalized ambient observation in the timeline.' });
/** Observation representation value. */
export type ObservationOut = z.infer<typeof ObservationOut>;

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

/** Aggregate counts describing a day's observations, shown alongside the digest. */
export const DigestStats = z
  .object({
    /** Total observations summarized. */
    total: z.number().int(),
    /** Count keyed by provider. */
    byProvider: z.record(z.string(), z.number().int()),
    /** Count keyed by observation kind. */
    byKind: z.record(z.string(), z.number().int()),
  })
  .meta({ id: 'DigestStats', description: "Aggregate counts of a day's observations." });
/** Digest-stats value. */
export type DigestStats = z.infer<typeof DigestStats>;

/**
 * A generated daily digest for one user on one day.
 *
 * @remarks
 * Deliberately cross-org and user-scoped (no `organizationId`): the Sunsama-style hero
 * feature is one end-of-day summary for the *person*, aggregating their activity across
 * every tool/org — mirroring the cross-org Hub `notification`/`dailyPlanItem` model.
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
    observationCount: z.number().int(),
    generatedAt: z.string().nullable(),
    sentAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .meta({ id: 'DailyDigestOut', description: "A user's generated daily digest." });
/** Daily-digest representation value. */
export type DailyDigestOut = z.infer<typeof DailyDigestOut>;
