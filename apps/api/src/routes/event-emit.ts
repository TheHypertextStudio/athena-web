/**
 * `@docket/api` — internal event emission (the `docket` source write-path), a Facade.
 *
 * @remarks
 * The cross-tool feed reads one substrate: the {@link event} log. External activity arrives via
 * the webhook drain; *internal* Docket domain events (a task assigned, a project's status
 * changed, a comment posted) are appended here with `sourceSystem='docket'`. This is a thin
 * Facade: it hides "insert the canonical event → resolve recipients → fan out live" behind one
 * {@link emitEvent} call. Relevance resolution + the {@link eventRecipient} fan-out are delegated
 * to the shared {@link routeAndWriteRecipients} Strategy (the same one the external drain uses).
 *
 * Awareness, not transactional truth: emission runs in its own transaction *after* the domain
 * mutation commits, so a failed emit never rolls back real work.
 *
 * Below {@link emitEvent} sit the **typed producers** — one per feature that reports through the
 * bus (tracking, inbound mail, elicitations, agent milestones, metadata changes). They exist so
 * the decisions this contract makes once — which `kind`, which subject, which detail arm, who
 * receives it and why — are made *here* rather than re-derived at each of the dozens of call
 * sites. A feature calls its producer with domain values; it never assembles an
 * {@link EmitEventInput} by hand, and so cannot invent a second vocabulary for the same fact.
 */
import { actor, db, event } from '@docket/db';
import { DOCKET_ENTITY_KIND } from '@docket/types';
import type {
  ActorRef,
  AgentEventKind,
  CanonicalEntityKind,
  ElicitationEventKind,
  EventDetail,
  EventKind,
  StreamRelevance,
  TaskActivityChange,
  TimerEventKind,
} from '@docket/types';
import { eq } from 'drizzle-orm';

import type { RoutableEvent } from '../consumers/routing';
import { routeAndWriteRecipients } from '../consumers/routing';
import { projectEmitInput } from '../lib/automation/event';
import { runAutomationsForEvent } from '../lib/automation/runtime';
import { enqueueSearchIndexJobs } from '../search/enqueue';
import { eventSearchReindexTarget } from '../search/event-log';
import { publishEvent } from './stream-helpers';

/**
 * The Docket entity an internal event is about.
 *
 * @remarks
 * `type` is a Docket entity type. The ones {@link DOCKET_ENTITY_KIND} maps (`task`,
 * `project`, `program`, `initiative`, `cycle`, `agent_session`, `inbound_message`) get a
 * canonical `EntityRef` and therefore owner routing, followers and a deep link. An unmapped
 * type (`time_record`, `email_suggestion`) is still a perfectly valid subject — it just
 * carries no `EntityRef`, so the event records and surfaces without a routable subject.
 * Always pass the most meaningful entity: a timer tracking a task takes the **task** as its
 * subject (the record id rides in `detail`), and only freeform tracking falls back to
 * `time_record`.
 */
export interface EmitSubject {
  /** Docket entity type — `task` | `project` | `agent_session` | `time_record` | … */
  readonly type: string;
  /** The Docket entity id. */
  readonly id: string;
  /** Display title woven into the feed line. */
  readonly title?: string;
  /** Canonical in-app URL, when one exists. */
  readonly url?: string;
}

/** Input to {@link emitEvent}. */
export interface EmitEventInput {
  readonly organizationId: string;
  readonly kind: EventKind;
  /** When it happened; defaults to now. */
  readonly occurredAt?: Date;
  readonly title: string;
  readonly summary?: string | null;
  readonly permalink?: string | null;
  /** The acting Docket Actor (excluded from its own event's recipients). */
  readonly actorId?: string | null;
  readonly subject: EmitSubject;
  /** Extra Docket Actor ids involved (e.g. @-mentioned actors); resolved to recipients. */
  readonly participantActorIds?: readonly string[];
  /** Typed, tool-specific detail (e.g. a `docket.state_change`). */
  readonly detail?: EventDetail | null;
  /** The primary "for" user (sets `event.userId` for the digest). */
  readonly forUserId?: string | null;
  /**
   * Disambiguates two same-kind events on the same subject in the same millisecond.
   *
   * @remarks
   * The dedupe key is `(subject, kind, occurredAt-in-ms)`, which is exactly right for domain
   * events — emitting "task completed" twice must collapse — and exactly wrong for events a
   * feature legitimately fires in a burst (a milestone per subagent, a question per prompt).
   * Pass a stable per-event discriminator and the burst survives; omit it and the collapse
   * still protects you. Never pass a random value: that would defeat dedupe entirely.
   */
  readonly dedupeToken?: string;
  /**
   * Users this event addresses outright, each with the reason to show them.
   *
   * @remarks
   * Exempt from the "never surface your own action to yourself" rule, so an agent acting as
   * your own Athena can still put a question in front of you. See
   * {@link RoutableEvent.directRecipients} for when this is legitimate.
   */
  readonly directRecipients?: ReadonlyMap<string, StreamRelevance>;
}

/**
 * Append one internal (`docket`-source) event and fan it out to its recipients.
 *
 * @remarks
 * Deduped by `(organizationId, dedupeKey)` — `subject`, `kind`, the occurrence millisecond and
 * an optional {@link EmitEventInput.dedupeToken} — so the same domain event emitted twice is a
 * no-op while a legitimate burst of same-kind events survives.
 * Best-effort: runs in its own transaction AFTER the domain mutation commits and swallows
 * failures (a missing migration or transient error must never 500 the domain write).
 *
 * @param input - The event to record (see {@link EmitEventInput}).
 */
export async function emitEvent(input: EmitEventInput): Promise<void> {
  try {
    await emitEventStrict(input);
  } catch {
    // Best-effort awareness — never roll back or 500 the domain mutation that triggered it.
  }
}

/**
 * Append one internal event and propagate failures so a durable outbox can retry delivery.
 *
 * @param input - The event to record with a stable occurrence time and dedupe token.
 */
export async function emitEventStrict(input: EmitEventInput): Promise<void> {
  const occurredAt = input.occurredAt ?? new Date();
  const token = input.dedupeToken ? `:${input.dedupeToken}` : '';
  const dedupeKey = `docket:${input.subject.type}:${input.subject.id}:${input.kind}:${occurredAt.getTime()}${token}`;
  await emitInternal(input, occurredAt, dedupeKey);
}

/** The actual emit work, separated so {@link emitEvent} can swallow its failures. */
async function emitInternal(
  input: EmitEventInput,
  occurredAt: Date,
  dedupeKey: string,
): Promise<void> {
  const entityKind = DOCKET_ENTITY_KIND[input.subject.type] ?? null;
  const result = await db.transaction(async (tx) => {
    const actorRef: ActorRef | null = input.actorId
      ? await tx
          .select({ id: actor.id, displayName: actor.displayName, avatar: actor.avatar })
          .from(actor)
          .where(eq(actor.id, input.actorId))
          .limit(1)
          .then(([a]) =>
            a
              ? {
                  source: 'docket' as const,
                  externalId: a.id,
                  displayName: a.displayName,
                  avatarUrl: a.avatar,
                  docketActorId: a.id as ActorRef['docketActorId'],
                }
              : null,
          )
      : null;

    const [row] = await tx
      .insert(event)
      .values({
        organizationId: input.organizationId,
        userId: input.forUserId ?? null,
        sourceSystem: 'docket',
        integrationId: null,
        externalUrl: input.subject.url ?? null,
        kind: input.kind,
        occurredAt,
        title: input.title,
        summary: input.summary ?? null,
        permalink: input.permalink ?? null,
        actor: actorRef,
        entity: entityKind
          ? {
              kind: entityKind,
              source: 'docket',
              externalId: input.subject.id,
              title: input.subject.title ?? null,
              url: input.subject.url ?? null,
              docketEntityId: input.subject.id,
            }
          : null,
        entityKind,
        // An internal event's subject IS a Docket entity, so association is settled on write and
        // these rows must never enter the re-association sweep's working set. A subject with no
        // canonical kind (`time_record`, `email_suggestion`) has nothing to associate at all.
        entityAssociation: entityKind ? 'matched' : 'unmatched',
        docketEntityId: entityKind ? input.subject.id : null,
        participants: [],
        detail: input.detail ?? null,
        externalId: input.subject.id,
        dedupeKey,
      })
      .onConflictDoNothing({ target: [event.organizationId, event.dedupeKey] })
      .returning({ id: event.id });

    if (!row) return null; // duplicate — already recorded

    const routable: RoutableEvent = {
      organizationId: input.organizationId,
      kind: input.kind,
      entity: entityKind
        ? {
            kind: entityKind,
            source: 'docket',
            externalId: input.subject.id,
            docketEntityId: input.subject.id,
          }
        : null,
      actorId: input.actorId,
      participantActorIds: input.participantActorIds,
      ...(input.directRecipients && { directRecipients: input.directRecipients }),
    };
    const recipients = await routeAndWriteRecipients(tx, row.id, routable, occurredAt);
    return { eventId: row.id, recipients };
  });

  if (result) {
    const entityReindexTarget = eventSearchReindexTarget(
      entityKind,
      entityKind ? input.subject.id : null,
    );
    await enqueueSearchIndexJobs([
      {
        organizationId: input.organizationId,
        sourceTable: 'event',
        entityId: result.eventId,
        operation: 'upsert',
        reason: 'event_log',
        sourceEventId: result.eventId,
      },
      ...(entityReindexTarget
        ? [
            {
              organizationId: input.organizationId,
              sourceTable: entityReindexTarget.sourceTable,
              entityId: entityReindexTarget.entityId,
              operation: 'upsert' as const,
              reason: 'event_log' as const,
              sourceEventId: result.eventId,
            },
          ]
        : []),
    ]);
    const recipients = [...result.recipients].map(([userId, reason]) => ({ userId, reason }));
    await publishEvent(result.eventId, recipients).catch(() => undefined);
    // Observer hook: run automation rules against the freshly committed event. Fires only on
    // non-duplicate inserts; never throws (best-effort, depth-capped inside).
    await runAutomationsForEvent(projectEmitInput(input, occurredAt));
    // Personal Athena assignment triggers observe the same committed event but derive scope from
    // the assignment's live subtree and re-authorize the owner before starting work. Loaded lazily
    // to keep the core mutation/event module graph independent of the agent loop at startup.
    const { handleAthenaAssignmentEvent } = await import('../agent/assignments');
    await handleAthenaAssignmentEvent(input, occurredAt).catch(() => undefined);
  }
}

/**
 * The application-owned feed line for each timer transition.
 *
 * @remarks
 * Copy lives here, not at the call sites, so every surface that starts a timer produces the
 * same sentence. `{label}` is the person's own words for what they are tracking.
 */
const TIMER_TITLE: Readonly<Record<TimerEventKind, (label: string) => string>> = {
  timer_started: (label) => `Started tracking ${label}`,
  timer_paused: (label) => `Paused tracking ${label}`,
  timer_resumed: (label) => `Resumed tracking ${label}`,
  timer_switched: (label) => `Switched tracking to ${label}`,
  timer_stopped: (label) => `Stopped tracking ${label}`,
};

/** Input to {@link emitTimerEvent}. */
export interface TimerEventInput {
  readonly organizationId: string;
  /** Which transition happened. */
  readonly kind: TimerEventKind;
  /** The person tracking — the event's sole recipient and its digest owner. */
  readonly userId: string;
  /** That person's Actor in this workspace, when they have one (attribution only). */
  readonly actorId?: string | null;
  /** When the transition happened; defaults to now. */
  readonly occurredAt?: Date;
  /**
   * The Docket entity being tracked, when tracking is attached to one. Omit for freeform
   * tracking — the event then hangs off the Time Record itself and carries no `EntityRef`.
   */
  readonly tracked?: EmitSubject;
  /** The Time Ledger record the transition happened on. */
  readonly timeRecordId: string;
  /** The record tracking moved off, on `timer_switched`. */
  readonly previousTimeRecordId?: string | null;
  /** Total measured elapsed milliseconds on the record at this instant. */
  readonly elapsedMs: number;
  /** What the person is tracking, in their own words. */
  readonly trackedLabel: string;
}

/**
 * Record one transition of the universal timer.
 *
 * @remarks
 * Athena observes tracking exactly here: start, pause, resume, switch and stop each land as a
 * distinct `kind` on the one bus, so the assistant can watch the live stream without polling
 * the Time Ledger. A switch is **one** event, not a stop plus a start, so elapsed time can
 * never be counted twice. Routing is deliberately narrow — tracking is personal data, so the
 * only recipient is the person tracking, even when the tracked task belongs to someone else.
 *
 * @param input - The transition (see {@link TimerEventInput}).
 *
 * @example
 * ```typescript
 * await emitTimerEvent({
 *   organizationId: orgId,
 *   kind: 'timer_started',
 *   userId,
 *   actorId,
 *   tracked: { type: 'task', id: taskId, title: task.title },
 *   timeRecordId: record.id,
 *   elapsedMs: 0,
 *   trackedLabel: record.title,
 * });
 * ```
 */
export async function emitTimerEvent(input: TimerEventInput): Promise<void> {
  await emitEvent({
    organizationId: input.organizationId,
    kind: input.kind,
    ...(input.occurredAt && { occurredAt: input.occurredAt }),
    title: TIMER_TITLE[input.kind](input.trackedLabel),
    actorId: input.actorId ?? null,
    subject: input.tracked ?? {
      type: 'time_record',
      id: input.timeRecordId,
      title: input.trackedLabel,
    },
    detail: {
      schema: 'docket.timer',
      timeRecordId: input.timeRecordId,
      previousTimeRecordId: input.previousTimeRecordId ?? null,
      elapsedMs: input.elapsedMs,
      trackedLabel: input.trackedLabel,
    },
    forUserId: input.userId,
    // The record id keeps a stop-and-restart inside one millisecond from collapsing.
    dedupeToken: input.timeRecordId,
    directRecipients: new Map([[input.userId, 'owned']]),
  });
}

/** Input to {@link emitInboundEmail}. */
export interface InboundEmailInput {
  readonly organizationId: string;
  /** The mailbox owner the message arrived for — its recipient and digest owner. */
  readonly userId: string;
  /** The sender's Actor, when the address resolved to a known person. */
  readonly actorId?: string | null;
  /** When the message was received; defaults to now. */
  readonly occurredAt?: Date;
  /** RFC 5322 `Message-ID`, or the receiving transport's id when absent. */
  readonly messageId: string;
  /** The conversation it belongs to. */
  readonly threadId?: string | null;
  readonly fromAddress: string;
  readonly fromName?: string | null;
  readonly subject: string;
  /** A short plain-text preview of the body. */
  readonly snippet?: string | null;
  readonly hasAttachments?: boolean;
  /** In-app link to the message, when a surface renders it. */
  readonly permalink?: string | null;
  /** What the message became, when capture already happened. */
  readonly captured?: { readonly kind: CanonicalEntityKind; readonly id: string } | null;
}

/**
 * Record a message arriving at a Docket-owned address (Athena's inbox).
 *
 * @remarks
 * The event is about the *message*, whose canonical kind is `message`; what the message turns
 * into is a separate, later `created` event on the captured entity, tied back through
 * `detail.capturedEntityId`. Keeping the two apart matters: a message that Docket decides not
 * to capture still leaves a record that it arrived, which is the difference between "we saw
 * nothing" and "we saw it and passed".
 *
 * Attribution stays `docket` — the message reached a Docket address. The human sender rides in
 * `actor` and `detail.fromAddress`. Mail pulled from a *connected* provider is a different
 * story with a different source badge, and arrives through the connector path, not here.
 *
 * @param input - The received message (see {@link InboundEmailInput}).
 */
export async function emitInboundEmail(input: InboundEmailInput): Promise<void> {
  await emitEvent({
    organizationId: input.organizationId,
    kind: 'email_received',
    ...(input.occurredAt && { occurredAt: input.occurredAt }),
    title: input.subject,
    summary: input.snippet ?? null,
    permalink: input.permalink ?? null,
    actorId: input.actorId ?? null,
    subject: { type: 'inbound_message', id: input.messageId, title: input.subject },
    detail: {
      schema: 'docket.inbound_email',
      messageId: input.messageId,
      threadId: input.threadId ?? null,
      fromAddress: input.fromAddress,
      fromName: input.fromName ?? null,
      subject: input.subject,
      snippet: input.snippet ?? null,
      hasAttachments: input.hasAttachments ?? false,
      capturedEntityKind: input.captured?.kind ?? null,
      capturedEntityId: input.captured?.id ?? null,
    },
    forUserId: input.userId,
    // Addressed delivery: mail lands in the owner's feed even when they mailed themselves.
    directRecipients: new Map([[input.userId, 'owned']]),
  });
}

/** Input to {@link emitElicitationEvent}. */
export interface ElicitationEventInput {
  readonly organizationId: string;
  /** Which stage of the question loop this is. */
  readonly kind: ElicitationEventKind;
  /** The session that asked. */
  readonly sessionId: string;
  /** The `session_activity` row carrying the question — the reply route's target. */
  readonly elicitationId: string;
  /** The human being asked: the recipient, and the person the loop is waiting on. */
  readonly askedUserId: string;
  /** The asking agent's Actor, when it has one. Ignored on expiry — nobody acted. */
  readonly agentActorId?: string | null;
  /** When the stage happened; defaults to now. */
  readonly occurredAt?: Date;
  /** The question as the agent asked it. */
  readonly question: string;
  /** The human's answer, on `elicitation_answered`. */
  readonly answer?: string | null;
  /** What the system resolved to on `elicitation_expired`. */
  readonly autoResolvedValue?: string | null;
  /** ISO-8601 instant the ask stops waiting. */
  readonly expiresAt?: string | null;
  /** In-app link to the asking session. */
  readonly permalink?: string | null;
}

/**
 * Record one stage of an agent asking a human a question.
 *
 * @remarks
 * Three properties this producer guarantees, each of which is easy to get wrong by hand:
 *
 * 1. **The ask reaches the asker's owner.** A personal Athena run acts *as* its owner, so its
 *    Actor resolves to that same user and ordinary routing — which never shows you your own
 *    action — would drop the one person who must answer. The asked user is therefore an
 *    addressed recipient, exempt from that rule.
 * 2. **An unanswered question outranks everything else** in the feed: `awaiting_you` says work
 *    has halted, which a mention never does.
 * 3. **A timeout is not an answer.** `elicitation_expired` is emitted with no actor, because
 *    nobody acted — a clock fired. That keeps "a human decided this" provable after the fact,
 *    and it lets the session owner see the expiry (an actorless event excludes nobody).
 *
 * @param input - The stage to record (see {@link ElicitationEventInput}).
 */
export async function emitElicitationEvent(input: ElicitationEventInput): Promise<void> {
  const expired = input.kind === 'elicitation_expired';
  await emitEvent({
    organizationId: input.organizationId,
    kind: input.kind,
    ...(input.occurredAt && { occurredAt: input.occurredAt }),
    title: input.question,
    summary: input.answer ?? input.autoResolvedValue ?? null,
    permalink: input.permalink ?? null,
    // A timeout has no actor: no one acted, a clock fired.
    actorId: expired ? null : (input.agentActorId ?? null),
    subject: { type: 'agent_session', id: input.sessionId, title: input.question },
    detail: {
      schema: 'docket.elicitation',
      elicitationId: input.elicitationId,
      sessionId: input.sessionId,
      question: input.question,
      answer: input.answer ?? null,
      autoResolvedValue: input.autoResolvedValue ?? null,
      expiresAt: input.expiresAt ?? null,
    },
    forUserId: input.askedUserId,
    // One session can hold several open questions; the activity id keeps them distinct.
    dedupeToken: input.elicitationId,
    // Only an open question is addressed to someone. Once it is answered or has timed out,
    // ordinary session-owner routing applies — and the person who answered sees nothing back.
    ...(input.kind === 'elicitation_requested' && {
      directRecipients: new Map<string, StreamRelevance>([[input.askedUserId, 'awaiting_you']]),
    }),
  });
}

/** Input to {@link emitAgentMilestone}. */
export interface AgentMilestoneInput {
  readonly organizationId: string;
  /** Which milestone this is. */
  readonly kind: AgentEventKind;
  /** The reporting agent's session. */
  readonly sessionId: string;
  /** The specific runtime dispatch beneath the session, when there is one. */
  readonly executionId?: string | null;
  /** The session that spawned this one; omit for a top-level agent. */
  readonly parentSessionId?: string | null;
  /** The human who spawned the agent — the milestone's recipient. */
  readonly ownerUserId: string;
  /** The agent's Actor, when it has one. */
  readonly agentActorId?: string | null;
  /** When the milestone happened; defaults to now. */
  readonly occurredAt?: Date;
  /** The agent's display name. */
  readonly agentName: string;
  /** The milestone in the agent's own words. */
  readonly milestone: string;
  /** Self-reported completion 0–100. */
  readonly progress?: number | null;
  /** A stable machine code for a block or failure. Never rendered verbatim. */
  readonly reasonCode?: string | null;
  /**
   * The work the agent is doing, when it is attached to one. Defaults to the session itself,
   * so an agent with no task still reports somewhere addressable.
   */
  readonly subject?: EmitSubject;
  /** In-app link to the session. */
  readonly permalink?: string | null;
}

/**
 * How loudly each milestone reaches the human who spawned the agent.
 *
 * @remarks
 * `null` means "address nobody": bare progress is recorded and streamed live, but never fanned
 * into a personal feed, which a chatty agent would otherwise fill on its own.
 */
const MILESTONE_REASON: Readonly<Record<AgentEventKind, StreamRelevance | null>> = {
  agent_started: 'owned',
  agent_progress: null,
  agent_blocked: 'awaiting_you',
  agent_completed: 'owned',
  agent_failed: 'owned',
};

/**
 * Record one milestone from an independently running agent.
 *
 * @remarks
 * Every agent — Athena, a registered third-party agent, a subagent Athena spawned — reports
 * through these five verbs and this one detail arm, which is what makes "each agent acts
 * independently and reports through a shared observable bus" true rather than aspirational:
 * a consumer written against this contract renders and reacts to an agent nobody had built
 * when the consumer was written.
 *
 * Fan-out is graded by what the human must do. A block is `awaiting_you` (the run has
 * stopped and needs them). Start, completion and failure are `owned` (worth knowing). Bare
 * progress addresses nobody — it belongs to the live stream and the session view, not to a
 * personal feed that would drown in it — while still being recorded and still reaching every
 * live observer.
 *
 * @param input - The milestone (see {@link AgentMilestoneInput}).
 */
export async function emitAgentMilestone(input: AgentMilestoneInput): Promise<void> {
  const reason = MILESTONE_REASON[input.kind];
  await emitEvent({
    organizationId: input.organizationId,
    kind: input.kind,
    ...(input.occurredAt && { occurredAt: input.occurredAt }),
    title: input.milestone,
    summary: input.agentName,
    permalink: input.permalink ?? null,
    actorId: input.agentActorId ?? null,
    subject: input.subject ?? {
      type: 'agent_session',
      id: input.sessionId,
      title: input.agentName,
    },
    detail: {
      schema: 'docket.agent_milestone',
      sessionId: input.sessionId,
      executionId: input.executionId ?? null,
      parentSessionId: input.parentSessionId ?? null,
      agentName: input.agentName,
      milestone: input.milestone,
      progress: input.progress ?? null,
      reasonCode: input.reasonCode ?? null,
    },
    forUserId: input.ownerUserId,
    // Parallel subagents report inside the same millisecond; keep every report.
    dedupeToken: `${input.executionId ?? input.sessionId}:${input.milestone}`,
    ...(reason && {
      directRecipients: new Map<string, StreamRelevance>([[input.ownerUserId, reason]]),
    }),
  });
}

/** Input to {@link emitFieldChange}. */
export interface FieldChangeInput {
  readonly organizationId: string;
  /** The entity whose metadata moved. */
  readonly subject: EmitSubject;
  /** Who changed it; null for an unattributed system or automation change. */
  readonly actorId?: string | null;
  /** When the edit was applied; defaults to now. */
  readonly occurredAt?: Date;
  /** Stable command identity that makes an outbox retry emit the same event. */
  readonly dedupeToken?: string;
  /** Propagate delivery failures so a durable outbox can retry them. */
  readonly strict?: boolean;
  /**
   * Every field that moved in this one mutation, with values already resolved to display
   * strings — the same rows the durable activity ledger writes.
   */
  readonly changes: readonly TaskActivityChange[];
}

/**
 * Record one mutation's metadata changes — the activity-log line, on the bus.
 *
 * @remarks
 * **One event per mutation, never one per field.** A five-field edit emitting five events
 * would multiply notifications, live pushes, automation runs and reindex jobs by five for a
 * single user action, so the whole edit travels as one row carrying every change. Automations
 * still address individual fields through `detail.fields contains 'dueDate'`.
 *
 * This does not replace the durable ledger in `audit_event`, which remains the entity's
 * permanent, queryable history; both write the same {@link TaskActivityChange} shape, so the
 * two can never tell different stories about the same edit. State transitions and
 * (re)assignments keep their own kinds (`status_change`, `completed`, `assignment`) — do not
 * also report them here, or the feed says the same thing twice.
 *
 * @param input - The mutation's resolved changes (see {@link FieldChangeInput}).
 */
export async function emitFieldChange(input: FieldChangeInput): Promise<void> {
  if (input.changes.length === 0) return; // nothing moved — nothing to say
  const changes = input.changes.slice(0, 50);
  const fields = changes.map((c) => c.field);
  await (input.strict ? emitEventStrict : emitEvent)({
    organizationId: input.organizationId,
    kind: 'field_change',
    ...(input.occurredAt && { occurredAt: input.occurredAt }),
    title: input.subject.title ?? changes.map((c) => c.label).join(', '),
    summary: changes.map((c) => c.label).join(', '),
    actorId: input.actorId ?? null,
    subject: input.subject,
    detail: { schema: 'docket.field_change', changes: [...changes], fields },
    // Two different edits to the same entity inside one millisecond stay distinct.
    dedupeToken: input.dedupeToken ? `${fields.join(',')}:${input.dedupeToken}` : fields.join(','),
  });
}
