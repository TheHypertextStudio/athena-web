/**
 * `stream` — pure presentation helpers for the unified event stream.
 *
 * @remarks
 * The stream analogue of `inbox/notification-meta.ts`: it flattens a {@link StreamEventOut} into
 * a thin {@link StreamEventRow} view-model (so the catalog + row read stable fields, decoupled
 * from the wire DTO), and derives the one-line description, the deep link, and the kind glyph/
 * tone. Heterogeneous sources render through one homogeneous line: `{actor} {verb} {subject}`,
 * with the provider shown as an attribution badge by the row, not a separate layout.
 */
import type {
  CanonicalEntityKind,
  EventDetail,
  EventKind,
  SourceSystemKind,
  StreamEventOut,
  StreamRelevance,
} from '@docket/types';

/**
 * A flattened, presentation-ready projection of one stream event.
 *
 * @remarks
 * Reads the canonical {@link StreamEventOut} shape: `source.system` (with the coarse
 * `origin` derived from it), the canonical `entity` (its `kind` is what makes analogous
 * things across tools share one row), and the typed `detail` pocket.
 */
export interface StreamEventRow {
  readonly id: string;
  readonly organizationId: string;
  readonly system: SourceSystemKind;
  readonly origin: 'docket' | 'external';
  readonly externalUrl: string | null;
  readonly kind: EventKind;
  readonly occurredAt: string;
  readonly title: string;
  readonly summary: string | null;
  readonly permalink: string | null;
  readonly actorSource: SourceSystemKind | null;
  readonly actorExternalId: string | null;
  readonly actorDocketId: string | null;
  readonly actorName: string | null;
  readonly actorAvatarUrl: string | null;
  /** Explicit server-derived relationship; clients must never infer this from a name. */
  readonly actorIsViewer: boolean;
  readonly entityKind: CanonicalEntityKind | null;
  readonly entityTitle: string | null;
  readonly entityExternalId: string | null;
  readonly entityDocketId: string | null;
  readonly entityUrl: string | null;
  readonly relevance: StreamRelevance | null;
  readonly rendering: { readonly icon: string; readonly category: string };
  readonly detail: EventDetail | null;
}

/** Flatten a wire {@link StreamEventOut} into a {@link StreamEventRow}. */
export function toRow(event: StreamEventOut): StreamEventRow {
  return {
    id: event.id,
    organizationId: event.organizationId,
    system: event.source.system,
    origin: event.source.system === 'docket' ? 'docket' : 'external',
    externalUrl: event.source.externalUrl,
    kind: event.kind,
    occurredAt: event.occurredAt,
    title: event.title,
    summary: event.summary,
    permalink: event.permalink,
    actorSource: event.actor?.source ?? null,
    actorExternalId: event.actor?.externalId ?? null,
    actorDocketId: event.actor?.docketActorId ?? null,
    actorName: event.actor?.displayName ?? null,
    actorAvatarUrl: event.actor?.avatarUrl ?? null,
    actorIsViewer: event.actorIsViewer,
    entityKind: event.entity?.kind ?? null,
    entityTitle: event.entity?.title ?? null,
    entityExternalId: event.entity?.externalId ?? null,
    entityDocketId: event.entity?.docketEntityId ?? null,
    entityUrl: event.entity?.url ?? null,
    relevance: event.relevance,
    rendering: event.rendering,
    detail: event.detail,
  };
}

/** Actor label for timeline prose, using only the API's explicit viewer relationship. */
export function streamActorLabel(row: StreamEventRow): string {
  if (row.actorIsViewer) return 'You';
  return row.actorName ?? detailActorName(row.detail) ?? 'Someone';
}

/** Subject-free action phrase used beneath an episode's already-visible entity title. */
const KIND_ACTION: Record<EventKind, string> = {
  message: 'sent a message',
  mention: 'mentioned you',
  assignment: 'assigned you',
  task_assignment: 'changed the assignment',
  status_change: 'changed the status',
  comment: 'commented',
  reaction: 'reacted',
  created: 'created this item',
  completed: 'completed the task',
  calendar_invite: 'sent a calendar invitation',
  calendar_update: 'updated the schedule',
  // "had", not "attended": the event records an accepted invitation that has elapsed, which is
  // not the same claim as having been in the room. See `EventKind`'s remarks.
  meeting_attended: 'had this meeting',
  timer_started: 'started tracking time',
  timer_paused: 'paused time tracking',
  timer_resumed: 'resumed time tracking',
  timer_switched: 'switched time tracking',
  timer_stopped: 'stopped tracking time',
  email_received: 'sent an email',
  elicitation_requested: 'asked a question',
  elicitation_answered: 'answered a question',
  elicitation_expired: 'stopped waiting for an answer',
  agent_started: 'started working',
  agent_progress: 'reported progress',
  agent_blocked: 'reported a blocker',
  agent_completed: 'finished working',
  agent_failed: 'could not finish',
  field_change: 'updated details',
};

/** A compact event sentence that does not repeat the episode subject. */
export function streamEventSentence(row: StreamEventRow): string {
  if (row.actorIsViewer && row.kind === 'assignment') return 'You assigned yourself';
  return `${streamActorLabel(row)} ${KIND_ACTION[row.kind]}`;
}

/** Verb phrase per kind, written to read after an actor name ("{actor} {verb} {subject}"). */
const KIND_VERB: Record<EventKind, string> = {
  message: 'sent a message in',
  mention: 'mentioned you in',
  assignment: 'assigned you to',
  task_assignment: 'assigned you to',
  status_change: 'changed the status of',
  comment: 'commented on',
  reaction: 'reacted to',
  created: 'created',
  completed: 'completed',
  calendar_invite: 'invited you to',
  calendar_update: 'updated',
  meeting_attended: 'had',
  timer_started: 'started tracking',
  timer_paused: 'paused tracking',
  timer_resumed: 'resumed tracking',
  timer_switched: 'switched tracking to',
  timer_stopped: 'stopped tracking',
  email_received: 'emailed you about',
  elicitation_requested: 'needs your answer on',
  elicitation_answered: 'answered a question on',
  elicitation_expired: 'stopped waiting for an answer on',
  agent_started: 'started working on',
  agent_progress: 'made progress on',
  agent_blocked: 'is blocked on',
  agent_completed: 'finished working on',
  agent_failed: 'could not finish',
  field_change: 'updated',
};

/** Human label per kind (for filter chips / menus). */
export const KIND_LABEL: Record<EventKind, string> = {
  message: 'Message',
  mention: 'Mention',
  assignment: 'Assignment',
  task_assignment: 'Assignment',
  status_change: 'Status change',
  comment: 'Comment',
  reaction: 'Reaction',
  created: 'Created',
  completed: 'Completed',
  calendar_invite: 'Calendar invite',
  calendar_update: 'Calendar update',
  meeting_attended: 'Meeting',
  timer_started: 'Tracking started',
  timer_paused: 'Tracking paused',
  timer_resumed: 'Tracking resumed',
  timer_switched: 'Tracking switched',
  timer_stopped: 'Tracking stopped',
  email_received: 'Email received',
  elicitation_requested: 'Question asked',
  elicitation_answered: 'Question answered',
  elicitation_expired: 'Question expired',
  agent_started: 'Agent started',
  agent_progress: 'Agent progress',
  agent_blocked: 'Agent blocked',
  agent_completed: 'Agent finished',
  agent_failed: 'Agent failed',
  field_change: 'Field change',
};

/**
 * The plain-English one-line description: `{actor} {verb} {subject}`.
 *
 * @remarks
 * Composed uniformly so every source reads the same. Falls back to the stored `title` when
 * there's no subject to name (e.g. a workspace-level update), and to "Someone" with no actor.
 */
export function streamDescription(row: StreamEventRow): string {
  const actor = streamActorLabel(row);
  const verb = KIND_VERB[row.kind];
  const subject = row.entityTitle;
  if (row.actorIsViewer && row.kind === 'assignment' && subject) {
    return `You assigned yourself to ${subject}`;
  }
  return subject ? `${actor} ${verb} ${subject}` : row.title;
}

/** Convert stable enum-like values to sentence case for display. */
function humanValue(value: string | null): string {
  if (value === null || value.trim() === '') return 'None';
  const normalized = value.replaceAll('_', ' ').trim();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

/** Format a field's display snapshot according to its stable semantic key. */
function fieldValue(field: string, value: string | null): string {
  if (value === null) return 'None';
  if ((field === 'dueDate' || field === 'startDate') && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }
  return humanValue(value);
}

/** Render milliseconds as a compact application-owned duration. */
function durationLabel(elapsedMs: number): string {
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 60) return `${String(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${String(hours)} hr` : `${String(hours)} hr ${String(remainder)} min`;
}

/**
 * Display-ready typed detail for an inline event line.
 *
 * @remarks
 * Uses application-owned labels and content only. Machine field keys and agent failure codes are
 * never rendered, and unknown provider detail degrades to its safe summary rather than raw errors.
 */
export function streamEventDetailLabel(row: StreamEventRow): string | null {
  const detail = row.detail;
  if (!detail) return row.summary;
  switch (detail.schema) {
    case 'docket.state_change':
      return detail.fromState === null
        ? `Now ${humanValue(detail.toState)}`
        : `${humanValue(detail.fromState)} → ${humanValue(detail.toState)}`;
    case 'docket.field_change':
      return detail.changes
        .map(
          (change) =>
            `${change.label}: ${fieldValue(change.field, change.from)} → ${fieldValue(change.field, change.to)}`,
        )
        .join(' · ');
    case 'docket.timer':
      return `${detail.trackedLabel} · ${durationLabel(detail.elapsedMs)}`;
    case 'docket.agent_milestone':
      return detail.progress === null
        ? detail.milestone
        : `${detail.milestone} · ${String(detail.progress)}%`;
    case 'docket.elicitation':
      return detail.answer ?? detail.autoResolvedValue ?? detail.question;
    case 'docket.inbound_email':
      return detail.snippet ?? detail.subject;
    case 'docket.email_suggestion':
      return detail.snippet || detail.subject;
    case 'google_calendar.meeting': {
      // The scheduled length, never presented as time worked — the Time Ledger owns that claim.
      const people =
        detail.attendeeCount <= 1 ? 'just you' : `${String(detail.attendeeCount)} people`;
      return `${durationLabel(detail.durationMinutes * 60_000)} · ${people}`;
    }
    case 'gmail.message':
      return detail.subject;
    case 'linear.issue':
      return detail.stateName;
    case 'github.pull_request':
      return detail.merged
        ? 'Merged'
        : detail.draft
          ? 'Draft'
          : `Pull request #${String(detail.number)}`;
    case 'slack.message':
    case 'discord.message':
      return detail.text;
    case 'generic':
      return detail.summary ?? detail.title;
  }
}

/**
 * The human name a typed detail knows, when the event has no resolved Docket actor.
 *
 * @remarks
 * An email that arrives at Athena's own address is written by a stranger who has no Docket
 * identity, so `actor` is legitimately null — but the sender is right there in the typed detail,
 * and "Someone emailed you" when we know exactly who is a worse line than the truth.
 *
 * @param detail - The event's typed detail pocket.
 * @returns the sender's name or address, or `null` when the detail names nobody.
 */
function detailActorName(detail: EventDetail | null): string | null {
  if (detail?.schema !== 'docket.inbound_email') return null;
  return detail.fromName ?? detail.fromAddress;
}

/** Canonical entity kinds the stream can deep-link to internally, mapped to their route segment. */
const SUBJECT_ROUTE: Partial<Record<CanonicalEntityKind, string>> = {
  project: 'projects',
  program: 'programs',
  initiative: 'initiatives',
  cycle: 'cycles',
};

/**
 * The deep link for an event's entity: the external permalink when present, else the internal
 * Docket route for a `docket`-origin entity (keyed on canonical {@link CanonicalEntityKind}),
 * else the entity/source external URL, else `null` (renders inert).
 */
export function streamHref(row: StreamEventRow): string | null {
  if (row.permalink) return row.permalink;
  if (row.origin === 'docket' && row.entityKind && row.entityDocketId) {
    if (row.entityKind === 'work_item') return `/orgs/${row.organizationId}/my-work`;
    const segment = SUBJECT_ROUTE[row.entityKind];
    return segment ? `/orgs/${row.organizationId}/${segment}/${row.entityDocketId}` : null;
  }
  return row.entityUrl ?? row.externalUrl;
}

/**
 * The short "why you're seeing this" label for a personal-feed relevance reason, or `null` when
 * there is none (the org firehose carries no relevance, so no chip renders).
 *
 * @remarks
 * Surfaces the `event_recipient.reason` the router assigned — a mention resolved to this user
 * reads "Mentioned you", so the feed answers "why is this here" at a glance.
 */
export function relevanceLabel(relevance: StreamRelevance | null): string | null {
  switch (relevance) {
    case 'mention':
      return 'Mentioned you';
    case 'assignment':
      return 'Assigned to you';
    case 'owned':
      return 'Your item';
    case 'followed':
      return 'Following';
    case 'participant':
      return "You're involved";
    case 'awaiting_you':
      return 'Waiting on you';
    default:
      return null;
  }
}

/** Glyph + tone descriptor for a kind (the row resolves `icon` to a real component). */
export interface KindGlyph {
  readonly icon: string;
  readonly tone: string;
}

/** The leading glyph + tone for a kind. */
export function kindGlyph(kind: EventKind): KindGlyph {
  switch (kind) {
    case 'mention':
      return { icon: 'mention', tone: 'text-state-mention' };
    case 'assignment':
    case 'task_assignment':
      return { icon: 'assignment', tone: 'text-state-assignment' };
    case 'completed':
      return { icon: 'completed', tone: 'text-state-completed' };
    case 'comment':
    case 'message':
      return { icon: 'comment', tone: 'text-state-comment' };
    case 'status_change':
      return { icon: 'status', tone: 'text-state-status' };
    case 'reaction':
      return { icon: 'reaction', tone: 'text-on-surface-variant' };
    case 'calendar_invite':
    case 'calendar_update':
    case 'meeting_attended':
      return { icon: 'calendar', tone: 'text-on-surface-variant' };
    case 'timer_started':
    case 'timer_paused':
    case 'timer_resumed':
    case 'timer_switched':
    case 'timer_stopped':
      return { icon: 'timer', tone: 'text-on-surface-variant' };
    case 'email_received':
      return { icon: 'email', tone: 'text-on-surface-variant' };
    case 'elicitation_requested':
    case 'elicitation_answered':
    case 'elicitation_expired':
      return { icon: 'question', tone: 'text-state-started' };
    case 'agent_started':
    case 'agent_progress':
    case 'agent_blocked':
    case 'agent_completed':
    case 'agent_failed':
      return { icon: 'agent', tone: 'text-state-started' };
    case 'field_change':
      return { icon: 'edit', tone: 'text-on-surface-variant' };
    default:
      return { icon: 'created', tone: 'text-on-surface-variant' };
  }
}
