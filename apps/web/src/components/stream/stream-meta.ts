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
  readonly actorName: string | null;
  readonly actorAvatarUrl: string | null;
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
    actorName: event.actor?.displayName ?? null,
    actorAvatarUrl: event.actor?.avatarUrl ?? null,
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
};

/**
 * The plain-English one-line description: `{actor} {verb} {subject}`.
 *
 * @remarks
 * Composed uniformly so every source reads the same. Falls back to the stored `title` when
 * there's no subject to name (e.g. a workspace-level update), and to "Someone" with no actor.
 */
export function streamDescription(row: StreamEventRow): string {
  const actor = row.actorName ?? 'Someone';
  const verb = KIND_VERB[row.kind];
  const subject = row.entityTitle;
  return subject ? `${actor} ${verb} ${subject}` : row.title;
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
 * Surfaces the `event_recipient.reason` the router assigned — e.g. a Discord/Slack mention resolved
 * to this user reads "Mentioned you", so the feed answers "why is this here" at a glance.
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
      return { icon: 'calendar', tone: 'text-on-surface-variant' };
    default:
      return { icon: 'created', tone: 'text-on-surface-variant' };
  }
}
