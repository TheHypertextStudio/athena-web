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

import { TaskActivityChange } from './activity';
import {
  ActorId,
  DailyDigestId,
  EventId,
  InboundEventId,
  IntegrationId,
  OrganizationId,
} from './primitives';

/**
 * The canonical, source-agnostic verb of an event — what happened.
 *
 * @remarks
 * One closed vocabulary for every producer. Values are appended, never renamed or removed:
 * the DB `event_kind` enum mirrors this list in the same order, and stored rows must keep
 * parsing forever. A verb earns its own value only when a consumer must branch on it
 * *without decoding {@link EventDetail}* — routing, notification policy, feed filters and
 * automation `on` matchers all read `kind` alone. Everything finer-grained rides in `detail`.
 *
 * Families:
 * - **work** — `created`/`completed`/`status_change`/`assignment`/`task_assignment`/`field_change`
 * - **conversation** — `message`/`mention`/`comment`/`reaction`/`email_received`
 * - **calendar** — `calendar_invite`/`calendar_update`
 * - **tracking** — the `timer_*` family ({@link TIMER_EVENT_KINDS})
 * - **assistance** — the `elicitation_*` ({@link ELICITATION_EVENT_KINDS}) and `agent_*`
 *   ({@link AGENT_EVENT_KINDS}) families
 */
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
  // Tracking — the universal timer. One verb per transition a person can make, because
  // "started" and "stopped" drive different consumer behavior (Athena reacting, the shell's
  // live state, reflection roll-ups) and must be filterable without reading `detail`.
  'timer_started',
  'timer_paused',
  'timer_resumed',
  'timer_switched',
  'timer_stopped',
  // Conversation — a message arriving at a Docket-owned address (Athena's inbox).
  'email_received',
  // Assistance — the agent↔human question loop. `expired` is the timed-out ask the system
  // auto-resolved; it is deliberately NOT `answered`, so "a human decided" stays provable.
  'elicitation_requested',
  'elicitation_answered',
  'elicitation_expired',
  // Assistance — milestone updates from independently running agents. Every agent reports
  // through these five verbs and nothing else, so one feed row renders any agent's progress.
  'agent_started',
  'agent_progress',
  'agent_blocked',
  'agent_completed',
  'agent_failed',
  // Work — one entity's metadata moving (the per-entity activity log line).
  'field_change',
]);
/** Event-kind value. */
export type EventKind = z.infer<typeof EventKind>;

/**
 * The universal timer's transitions, in the order a session walks them.
 *
 * @remarks
 * Exported so producers and consumers share one list instead of re-typing string literals.
 * `timer_switched` is emitted **instead of** a `timer_stopped` + `timer_started` pair when a
 * person moves tracking from one thing to another, so elapsed time is never double-counted:
 * the record being left rides in `detail.previousTimeRecordId`.
 */
export const TIMER_EVENT_KINDS = [
  'timer_started',
  'timer_paused',
  'timer_resumed',
  'timer_switched',
  'timer_stopped',
] as const satisfies readonly EventKind[];
/** One transition of the universal timer. */
export type TimerEventKind = (typeof TIMER_EVENT_KINDS)[number];

/** The agent↔human question loop's three terminal-or-opening verbs. */
export const ELICITATION_EVENT_KINDS = [
  'elicitation_requested',
  'elicitation_answered',
  'elicitation_expired',
] as const satisfies readonly EventKind[];
/** One stage of the agent↔human question loop. */
export type ElicitationEventKind = (typeof ELICITATION_EVENT_KINDS)[number];

/** The milestone vocabulary every independently running agent reports through. */
export const AGENT_EVENT_KINDS = [
  'agent_started',
  'agent_progress',
  'agent_blocked',
  'agent_completed',
  'agent_failed',
] as const satisfies readonly EventKind[];
/** One milestone an independently running agent reports. */
export type AgentEventKind = (typeof AGENT_EVENT_KINDS)[number];

/**
 * Kinds whose only legitimate audience is the person who caused them.
 *
 * @remarks
 * Tracking is personal data. A timer transition still lands on the tracked entity (so the
 * item's own history reads "started tracking"), but it must never fan out to that entity's
 * lead, assignee or followers — nobody gets a feed line because a colleague started a
 * stopwatch. The recipient router reads this set and routes such events to the acting user
 * alone; Athena still observes every one of them off the live bus.
 */
export const PERSONAL_EVENT_KINDS: readonly EventKind[] = TIMER_EVENT_KINDS;

/** The tool an event came from (its attribution). `docket` is the internal source. */
export const SourceSystemKind = z.enum([
  'docket',
  'linear',
  'github',
  'slack',
  'discord',
  'google_calendar',
  'gmail',
  'outlook',
]);
/** Source-system value. */
export type SourceSystemKind = z.infer<typeof SourceSystemKind>;

/**
 * The canonical, source-agnostic type of the thing an event is about.
 *
 * @remarks
 * The core of "scale to many tools": a Docket task, a Linear issue, and a GitHub PR all
 * collapse to `work_item`. A superset of the internal containment hierarchy, adding the
 * external-only kinds (`thread`, `message`, `document`) that have no Docket node, plus
 * `agent_session` — an agent's run is a first-class subject in Docket *and* in other tools
 * (Linear agent sessions), so an elicitation or a milestone update is "about" the run itself
 * even when the run has no task attached.
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
  'agent_session',
]);
/** Canonical-entity-kind value. */
export type CanonicalEntityKind = z.infer<typeof CanonicalEntityKind>;

/**
 * Map a Docket entity type (an internal emit `subject.type`) to its canonical entity kind.
 *
 * @remarks
 * The single source of truth for the internal-subject → canonical-kind mapping, shared by the
 * event emit Facade and the automation projection. Subject types without a canonical kind
 * (e.g. `email_suggestion`, `time_record`) are deliberately absent — they carry no
 * `EntityRef`, so the event still records and still reaches the feed, just without a
 * canonical subject to route on or deep-link to.
 */
export const DOCKET_ENTITY_KIND: Readonly<Record<string, CanonicalEntityKind>> = {
  task: 'work_item',
  project: 'project',
  program: 'program',
  initiative: 'initiative',
  cycle: 'cycle',
  agent_session: 'agent_session',
  inbound_message: 'message',
};

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
 * always remains in `inbound_event` for later re-enrichment. Retired provider arms remain
 * parseable solely for historical rows; no new observer can emit them.
 *
 * `schema` is namespaced by producer (`docket.*` for internal features, `<tool>.*` for an
 * observer adapter). An internal feature adds **one** arm here rather than inventing a
 * parallel payload: the arm is the feature's entire vocabulary on the bus, and anything it
 * cannot express belongs in the feature's own tables, not in a loose bag on the event.
 *
 * Arms never restate the event's `kind`. A consumer branches on `kind` (closed, indexed,
 * routable) and reads the arm for the specifics, so the two can never contradict each other.
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
      /** Historical Slack detail retained only so stored events remain readable. */
      schema: z.literal('slack.message'),
      channelId: z.string(),
      threadTs: z.string().nullable(),
      text: z.string(),
      channelType: z.string().nullable().default(null),
    }),
    z.object({
      /** Historical Discord detail retained only so stored events remain readable. */
      schema: z.literal('discord.message'),
      channelId: z.string(),
      guildId: z.string().nullable(),
      text: z.string(),
    }),
    z.object({
      schema: z.literal('docket.email_suggestion'),
      /** Funnel verdict category (`'promotions'`); null for an uncategorized thread. */
      category: z.string().nullable(),
      /** Funnel confidence score (0–100) the suggestion was created with. */
      confidence: z.number().int(),
    }),
    z.object({
      /**
       * One transition of the universal timer. The transition itself is the event's `kind`
       * (`timer_started` … `timer_stopped`) and is deliberately NOT repeated here — a
       * consumer branches on `kind` and reads this pocket for the numbers.
       */
      schema: z.literal('docket.timer'),
      /** The Time Ledger record the transition happened on. */
      timeRecordId: z.string(),
      /**
       * The record tracking moved *off*, on `timer_switched`; null on every other transition.
       * A switch emits one event, never a stop+start pair, so elapsed time cannot double-count.
       */
      previousTimeRecordId: z.string().nullable(),
      /** Total measured elapsed milliseconds on `timeRecordId` at the moment of the transition. */
      elapsedMs: z.number().int().nonnegative(),
      /** What the person is tracking, in their own words (the record title). */
      trackedLabel: z.string(),
    }),
    z.object({
      /** A message that arrived at a Docket-owned address (Athena's inbox). */
      schema: z.literal('docket.inbound_email'),
      /** RFC 5322 `Message-ID`, or the receiving transport's message id when absent. */
      messageId: z.string(),
      /** The conversation it belongs to; null when it is standalone. */
      threadId: z.string().nullable(),
      /** The sender's address, as received. */
      fromAddress: z.string(),
      /** The sender's display name, when the message carried one. */
      fromName: z.string().nullable(),
      /** The subject line, as received. */
      subject: z.string(),
      /** A short plain-text preview; null when no body could be previewed. */
      snippet: z.string().nullable(),
      /** Whether the message carried attachments. */
      hasAttachments: z.boolean(),
      /**
       * What the message became once captured (the "context object"), and its id. Both null
       * while the message is only a message — a later `created` event on the captured entity
       * completes the story, and this pocket is what ties the two together.
       */
      capturedEntityKind: CanonicalEntityKind.nullable(),
      capturedEntityId: z.string().nullable(),
    }),
    z.object({
      /** One agent↔human question, across all three of its `elicitation_*` events. */
      schema: z.literal('docket.elicitation'),
      /** The `session_activity` row that asked — the reply route's target. */
      elicitationId: z.string(),
      /** The agent session the question belongs to. */
      sessionId: z.string(),
      /** The question as the agent asked it — agent-authored *content*, never error copy. */
      question: z.string(),
      /** The human's answer on `elicitation_answered`; null before one exists. */
      answer: z.string().nullable(),
      /**
       * What the system resolved to when nobody answered in time (`elicitation_expired`);
       * null when the ask expired with no default, or has not expired.
       */
      autoResolvedValue: z.string().nullable(),
      /** ISO-8601 instant the ask stops waiting; null when it waits indefinitely. */
      expiresAt: z.string().nullable(),
    }),
    z.object({
      /** A milestone update from an independently running agent. */
      schema: z.literal('docket.agent_milestone'),
      /** The reporting agent's session. */
      sessionId: z.string(),
      /** The specific runtime dispatch beneath the session; null when it has none. */
      executionId: z.string().nullable(),
      /** The session that spawned this one; null for a top-level agent. */
      parentSessionId: z.string().nullable(),
      /** The reporting agent's display name (Athena, or a named subagent). */
      agentName: z.string(),
      /** The milestone in the agent's own words — content, rendered as content. */
      milestone: z.string(),
      /** Self-reported completion 0–100; null when the agent does not estimate progress. */
      progress: z.number().int().min(0).max(100).nullable(),
      /**
       * A stable machine code for a block or failure (`awaiting_credentials`,
       * `rate_limited`, …) on `agent_blocked`/`agent_failed`; null otherwise. Consumers
       * branch on it and supply their own copy — it is never rendered verbatim, and provider
       * or exception text must never be smuggled through it.
       */
      reasonCode: z.string().nullable(),
    }),
    z.object({
      /**
       * One entity's metadata moving — the activity-log line, on the bus.
       *
       * @remarks
       * ONE event per mutation carrying every field that moved, not one event per field: a
       * five-field edit must not multiply notifications, SSE pushes, automation runs and
       * reindex jobs by five. The durable per-task history still lives in `audit_event`
       * (the compliance ledger), and both write the same {@link TaskActivityChange} shape,
       * so the log and the feed can never describe the same edit differently.
       */
      schema: z.literal('docket.field_change'),
      /** Every field that moved, with display-ready values resolved at write time. */
      changes: z.array(TaskActivityChange).min(1).max(50),
      /**
       * The machine keys of {@link changes}, denormalized so an automation predicate can
       * match `detail.fields contains 'dueDate'` without walking an array of objects.
       */
      fields: z.array(z.string()).min(1).max(50),
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
