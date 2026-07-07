/**
 * Inbox presentation metadata: notification-type glyphs/tones + cross-org deep links.
 *
 * @remarks
 * The Inbox renders heterogeneous cross-org {@link NotificationOut}s and
 * {@link AuditEventOut}s as one calm, scannable feed. These pure helpers translate the raw
 * DTOs into the presentation vocabulary the rows need — a leading glyph + accessible label
 * per kind, a one-line plain-English description of an activity event, and the canonical
 * deep-link for a notification's subject (so every row navigates onward rather than
 * dead-ending). Only icons already exported from `@docket/ui/icons` are used so the curated
 * icon barrel (owned by another surface) is never touched.
 */
import type { AuditEventOut, NotificationOut, NotificationType } from '@docket/types';
import {
  Cable,
  CheckCircle2,
  CircleDot,
  MessageSquare,
  type LucideIcon,
  Sparkles,
  User,
  Users,
  XCircle,
} from '@docket/ui/icons';

/** The leading glyph + accessible label for each {@link NotificationType}. */
interface NotificationKindMeta {
  /** The row's leading glyph (an `@docket/ui/icons` MUI icon). */
  readonly icon: LucideIcon;
  /** The accessible label announced for the glyph (e.g. "Approval request"). */
  readonly label: string;
}

/** Per-type glyph + label, keyed by every {@link NotificationType}. */
const NOTIFICATION_KIND: Record<NotificationType, NotificationKindMeta> = {
  approval_request: { icon: Sparkles, label: 'Approval request' },
  agent_session: { icon: Sparkles, label: 'Agent session' },
  mention: { icon: User, label: 'Mention' },
  assignment: { icon: CircleDot, label: 'Assignment' },
  status_change: { icon: CheckCircle2, label: 'Status change' },
  comment: { icon: User, label: 'Comment' },
  invitation: { icon: Users, label: 'Invitation' },
  connector_sync_failed: { icon: XCircle, label: 'Sync failed' },
  connector_needs_reauth: { icon: Cable, label: 'Reconnect needed' },
  automation: { icon: Sparkles, label: 'Automation' },
  service_announcement: { icon: MessageSquare, label: 'Service announcement' },
};

/**
 * Resolve the glyph + accessible label for a notification's kind.
 *
 * @param type - The notification's {@link NotificationType}.
 * @returns the leading glyph and its accessible label.
 */
export function notificationKind(type: NotificationType): NotificationKindMeta {
  return NOTIFICATION_KIND[type];
}

/**
 * Whether a notification is a low-risk, one-tap **actionable** item.
 *
 * @remarks
 * Approval requests are the Inbox's emphasis: an agent is waiting on the caller's sign-off,
 * and (when low-risk) the caller can approve directly from the feed via the notification
 * `act` transition — no detour to the Session view required.
 *
 * @param type - The notification's {@link NotificationType}.
 * @returns `true` for an approval request, otherwise `false`.
 */
export function isApproval(type: NotificationType): boolean {
  return type === 'approval_request';
}

/**
 * The canonical deep-link for a notification's subject, when one can be derived.
 *
 * @remarks
 * The body always carries a `title`; many notifications also carry an explicit `url`
 * (the server's own deep link to the task / project / session), which is preferred when
 * present. Returns `null` when there is nothing to navigate to, so the row renders inert
 * rather than as a broken link.
 *
 * @param notification - The notification to link from.
 * @returns the subject href, or `null` when none is available.
 */
export function notificationHref(notification: NotificationOut): string | null {
  const url = notification.body.url;
  return typeof url === 'string' && url.length > 0 ? url : null;
}

/** Human-readable verb phrases for each audit-event type, for the activity feed. */
const ACTIVITY_VERB: Record<AuditEventOut['type'], string> = {
  created: 'created',
  updated: 'updated',
  state_changed: 'changed the state of',
  assigned: 'assigned',
  commented: 'commented on',
  archived: 'archived',
  deleted: 'deleted',
  moved: 'moved',
  linked: 'linked',
  member_added: 'added a member to',
  member_removed: 'removed a member from',
  role_changed: 'changed a role on',
  grant_changed: 'changed a grant on',
  approved: 'approved',
  rejected: 'rejected',
};

/** Singular display nouns for each audit subject kind, for the activity feed. */
const SUBJECT_NOUN: Record<AuditEventOut['subjectType'], string> = {
  organization: 'organization',
  team: 'team',
  initiative: 'initiative',
  program: 'program',
  project: 'project',
  cycle: 'cycle',
  task: 'task',
  actor: 'member',
  agent: 'agent',
  agent_session: 'agent session',
  comment: 'comment',
  update: 'update',
  integration: 'integration',
  role: 'role',
  grant: 'grant',
  membership: 'membership',
};

/**
 * A plain-English one-line description of an audit event (e.g. "updated a task").
 *
 * @remarks
 * The passive Activity feed reads like a sentence fragment — verb + subject noun — so a
 * glance down the column tells the awareness story without decoding raw event/subject
 * enums. The metadata may carry a `title`/`name` for the subject; when present it is woven
 * in (e.g. "updated task “Ship the beta”") for a more legible line.
 *
 * @param event - The audit event to describe.
 * @returns the human-readable description fragment.
 */
export function activityDescription(event: AuditEventOut): string {
  const verb = ACTIVITY_VERB[event.type];
  const noun = SUBJECT_NOUN[event.subjectType];
  const title = subjectTitle(event);
  return title ? `${verb} ${noun} “${title}”` : `${verb} a ${noun}`;
}

/** Read a subject display title off an audit event's metadata, when present. */
function subjectTitle(event: AuditEventOut): string | null {
  const candidate = event.metadata['title'] ?? event.metadata['name'];
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}

/** Org-scoped subject kinds the activity feed can deep-link to, mapped to their segment. */
const SUBJECT_ROUTE: Partial<Record<AuditEventOut['subjectType'], string>> = {
  project: 'projects',
  program: 'programs',
  initiative: 'initiatives',
  cycle: 'cycles',
  team: 'teams',
  agent_session: 'sessions',
};

/**
 * The canonical deep-link for an audit event's subject within its org, when one exists.
 *
 * @remarks
 * Maps the subject kind to its org-scoped route segment (e.g. a `project` →
 * `/orgs/{org}/projects/{id}`). Tasks have no stable standalone route on this surface, so
 * they resolve to the org's My Work view. Kinds with no navigable home (e.g. a `grant`)
 * return `null` and render inert.
 *
 * @param event - The audit event to link from.
 * @returns the subject href, or `null` when the kind has no navigable home.
 */
export function activityHref(event: AuditEventOut): string | null {
  const org = event.organizationId;
  if (event.subjectType === 'task') return `/orgs/${org}/my-work`;
  const segment = SUBJECT_ROUTE[event.subjectType];
  return segment ? `/orgs/${org}/${segment}/${event.subjectId}` : null;
}
