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
import type { ObservationKind, StreamEventOut, StreamRelevance } from '@docket/types';

/** A flattened, presentation-ready projection of one stream event. */
export interface StreamEventRow {
  readonly id: string;
  readonly organizationId: string;
  readonly provider: string;
  readonly origin: 'docket' | 'external';
  readonly kind: ObservationKind;
  readonly occurredAt: string;
  readonly title: string;
  readonly summary: string | null;
  readonly permalink: string | null;
  readonly actorName: string | null;
  readonly actorAvatar: string | null;
  readonly subjectType: string | null;
  readonly subjectTitle: string | null;
  readonly subjectId: string | null;
  readonly relevance: StreamRelevance | null;
  readonly rendering: { readonly icon: string; readonly category: string };
  readonly payload: Record<string, unknown>;
}

/** Flatten a wire {@link StreamEventOut} into a {@link StreamEventRow}. */
export function toRow(event: StreamEventOut): StreamEventRow {
  return {
    id: event.id,
    organizationId: event.organizationId,
    provider: event.source.provider,
    origin: event.source.origin,
    kind: event.kind,
    occurredAt: event.occurredAt,
    title: event.title,
    summary: event.summary,
    permalink: event.permalink,
    actorName: event.actor?.displayName ?? null,
    actorAvatar: event.actor?.avatar ?? null,
    subjectType: event.subject?.type ?? null,
    subjectTitle: event.subject?.title ?? null,
    subjectId: event.subject?.externalId ?? null,
    relevance: event.relevance,
    rendering: event.rendering,
    payload: event.payload,
  };
}

/** Verb phrase per kind, written to read after an actor name ("{actor} {verb} {subject}"). */
const KIND_VERB: Record<ObservationKind, string> = {
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
export const KIND_LABEL: Record<ObservationKind, string> = {
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
  const subject = row.subjectTitle ?? row.subjectType;
  return subject ? `${actor} ${verb} ${subject}` : row.title;
}

/** Org-scoped subject kinds the stream can deep-link to internally, mapped to their route segment. */
const SUBJECT_ROUTE: Record<string, string> = {
  project: 'projects',
  program: 'programs',
  initiative: 'initiatives',
  cycle: 'cycles',
  team: 'teams',
};

/**
 * The deep link for an event's subject: the external permalink when present, else the internal
 * Docket route for a `docket`-origin subject, else `null` (renders inert).
 */
export function streamHref(row: StreamEventRow): string | null {
  if (row.permalink) return row.permalink;
  if (row.origin !== 'docket' || !row.subjectType || !row.subjectId) return null;
  if (row.subjectType === 'task') return `/orgs/${row.organizationId}/my-work`;
  const segment = SUBJECT_ROUTE[row.subjectType];
  return segment ? `/orgs/${row.organizationId}/${segment}/${row.subjectId}` : null;
}

/** Glyph + tone descriptor for a kind (the row resolves `icon` to a real component). */
export interface KindGlyph {
  readonly icon: string;
  readonly tone: string;
}

/** The leading glyph + tone for a kind. */
export function kindGlyph(kind: ObservationKind): KindGlyph {
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
