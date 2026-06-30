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
export const ObservationKind = z
  .enum([
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
  ])
  .describe(
    'The normalized kind of activity captured from an external tool: chat (`message`, `mention`, `reaction`), issue/task lifecycle (`assignment`, `task_assignment`, `status_change`, `created`, `completed`), discussion (`comment`), and calendar (`calendar_invite`, `calendar_update`). `mention` and `assignment` are the kinds that can proactively seed an agent session.',
  );
/** Observation-kind value. */
export type ObservationKind = z.infer<typeof ObservationKind>;

/** Processing status of one raw inbound event in the durable write-ahead inbox. */
export const InboundEventStatus = z
  .enum(['received', 'processing', 'processed', 'failed', 'skipped'])
  .describe(
    'Where a raw inbound webhook event sits in the write-ahead inbox pipeline: `received` (durably recorded, not yet handled), `processing` (being normalized into observations), `processed` (done), `failed` (handling errored — see `lastError`/`attempts`), or `skipped` (deliberately not turned into an observation, e.g. an irrelevant event type).',
  );
/** Inbound-event status value. */
export type InboundEventStatus = z.infer<typeof InboundEventStatus>;

/** Lifecycle status of one user's daily digest for a given day. */
export const DailyDigestStatus = z
  .enum(['pending', 'generating', 'generated', 'sent', 'failed', 'skipped_empty'])
  .describe(
    "A daily digest's lifecycle: `pending` (queued for the day), `generating` (being summarized), `generated` (summary ready), `sent` (delivered to the user), `failed` (generation/delivery errored), or `skipped_empty` (no observations that day, so nothing was generated).",
  );
/** Daily-digest status value. */
export type DailyDigestStatus = z.infer<typeof DailyDigestStatus>;

/** The external person behind an observed action. */
export const ObservationActor = z
  .object({
    externalId: z
      .string()
      .describe("The person's native id in the source system (e.g. a Slack/Linear user id)."),
    displayName: z.string().optional().describe('Display name, when the provider exposes one.'),
    avatar: z.string().optional().describe('Avatar image URL, when known.'),
  })
  .meta({ id: 'ObservationActor', description: 'The external person behind an observed action.' });
/** Observation-actor value. */
export type ObservationActor = z.infer<typeof ObservationActor>;

/** The external object an observation is about (an issue, thread, channel, event). */
export const ObservationSubject = z
  .object({
    type: z
      .string()
      .describe(
        'The subject kind in the source system (e.g. `issue`, `thread`, `channel`, `event`) — a freeform provider-defined string.',
      ),
    externalId: z.string().describe("The subject's native id in the source system."),
    title: z.string().optional().describe('Display title, when the provider exposes one.'),
    url: z
      .string()
      .optional()
      .describe('Canonical URL to the subject in its source tool, when available.'),
  })
  .meta({ id: 'ObservationSubject', description: 'The external object an observation is about.' });
/** Observation-subject value. */
export type ObservationSubject = z.infer<typeof ObservationSubject>;

/** One normalized ambient observation in the knowledge timeline. */
export const ObservationOut = z
  .object({
    id: ObservationId.describe('The observation id.'),
    organizationId: OrganizationId.describe('The organization the observation belongs to.'),
    userId: z
      .string()
      .nullable()
      .describe('The Hub owner the activity is "for"; null when not attributable to one user.'),
    integrationId: IntegrationId.nullable().describe(
      'The integration the observation was sourced through; null if that integration has since been removed.',
    ),
    provider: z.string().describe('The source provider id (`linear`, `slack`, `github`, …).'),
    kind: ObservationKind.describe('The normalized kind of activity.'),
    occurredAt: z
      .string()
      .describe(
        'When it happened AT THE SOURCE (ISO-8601) — the timeline + digest sort key, distinct from `createdAt`.',
      ),
    title: z.string().describe('The observation headline.'),
    summary: z
      .string()
      .nullable()
      .describe('Secondary detail; null when the source provides none.'),
    permalink: z
      .string()
      .nullable()
      .describe('Deep link to the activity in its source tool; null when none.'),
    externalActor: ObservationActor.nullable().describe(
      'The external person who performed the action; null when not attributable.',
    ),
    subject: ObservationSubject.nullable().describe(
      'The external object the activity is about; null when none.',
    ),
    participants: z
      .array(ObservationActor)
      .describe('Other external people involved (may be empty).'),
    externalId: z
      .string()
      .nullable()
      .describe(
        "The activity's native id in the source system, used for dedup; null when the source provides none.",
      ),
    createdAt: z
      .string()
      .describe(
        'ISO-8601 timestamp the observation was ingested into Docket (distinct from `occurredAt`).',
      ),
  })
  .meta({ id: 'ObservationOut', description: 'A normalized ambient observation in the timeline.' });
/** Observation representation value. */
export type ObservationOut = z.infer<typeof ObservationOut>;

/** A raw inbound event as recorded in the durable write-ahead ingestion inbox. */
export const InboundEventOut = z
  .object({
    id: InboundEventId.describe('The inbound-event id.'),
    organizationId: OrganizationId.nullable().describe(
      'The routed organization; null until the event is matched to an integration.',
    ),
    integrationId: IntegrationId.nullable().describe(
      'The integration the event was matched to; null until routed.',
    ),
    provider: z.string().describe('The source provider that sent the webhook.'),
    externalEventId: z
      .string()
      .describe(
        "The provider's own event id — the dedup key that makes webhook retries idempotent.",
      ),
    eventType: z.string().describe("The provider's event type string (e.g. `issue.updated`)."),
    signatureVerified: z
      .boolean()
      .describe(
        'Whether the webhook signature was cryptographically verified — a security flag on the raw event.',
      ),
    status: InboundEventStatus.describe(
      'Where the event sits in the write-ahead processing pipeline.',
    ),
    attempts: z
      .number()
      .int()
      .describe('How many times processing has been attempted (increments on retry).'),
    lastError: z
      .string()
      .nullable()
      .describe('The most recent processing failure reason; null when none.'),
    receivedAt: z
      .string()
      .describe('ISO-8601 instant the webhook was received and durably recorded.'),
    processedAt: z
      .string()
      .nullable()
      .describe('ISO-8601 instant processing finished; null while still pending/processing.'),
  })
  .meta({ id: 'InboundEventOut', description: 'A raw event in the write-ahead ingestion inbox.' });
/** Inbound-event representation value. */
export type InboundEventOut = z.infer<typeof InboundEventOut>;

/** Aggregate counts describing a day's observations, shown alongside the digest. */
export const DigestStats = z
  .object({
    total: z.number().int().describe('Total observations summarized in the digest for the day.'),
    byProvider: z
      .record(z.string(), z.number().int())
      .describe('Observation count keyed by source provider (e.g. `{ linear: 4, slack: 9 }`).'),
    byKind: z
      .record(z.string(), z.number().int())
      .describe(
        'Observation count keyed by observation kind (e.g. `{ mention: 3, status_change: 6 }`).',
      ),
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
    id: DailyDigestId.describe('The daily-digest id.'),
    userId: z
      .string()
      .describe(
        'The user this digest is for. Deliberately cross-org and user-scoped (no `organizationId`): one end-of-day summary for the person across every tool/org.',
      ),
    digestDate: z
      .string()
      .describe(
        "The local calendar day this digest covers (`YYYY-MM-DD`, in the user's timezone).",
      ),
    status: DailyDigestStatus.describe(
      'Where the digest sits in its generation/delivery lifecycle.',
    ),
    summaryMarkdown: z
      .string()
      .nullable()
      .describe('The generated summary in Markdown; null until generated (or when skipped empty).'),
    summaryHtml: z
      .string()
      .nullable()
      .describe('The generated summary rendered to HTML for email delivery; null until generated.'),
    stats: DigestStats.nullable().describe(
      'Aggregate counts for the day (totals by provider/kind); null until generated.',
    ),
    observationCount: z
      .number()
      .int()
      .describe('How many observations the digest covers — 0 implies a `skipped_empty` day.'),
    generatedAt: z
      .string()
      .nullable()
      .describe('ISO-8601 instant the summary was generated; null while pending/generating.'),
    sentAt: z
      .string()
      .nullable()
      .describe('ISO-8601 instant the digest was delivered to the user; null until sent.'),
    createdAt: z.string().describe('ISO-8601 timestamp the digest record was created.'),
  })
  .meta({ id: 'DailyDigestOut', description: "A user's generated daily digest." });
/** Daily-digest representation value. */
export type DailyDigestOut = z.infer<typeof DailyDigestOut>;
