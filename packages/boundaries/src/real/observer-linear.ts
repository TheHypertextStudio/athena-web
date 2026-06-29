/**
 * `@docket/boundaries/real` — `RealLinearObserver` (Linear webhook → observations).
 *
 * @remarks
 * The env-driven {@link Observer} for Linear. Linear signs each webhook with an
 * **app-level** secret: a hex HMAC-SHA256 of the exact raw body, delivered in the
 * `Linear-Signature` header. `route` reads the workspace id (`organizationId`) and a
 * per-delivery event id (`type:action:dataId:webhookTimestamp`) so the caller can map the
 * event to an integration and dedup retries. `normalize` maps the high-value event types
 * — `Issue`, `Comment`, `Reaction`, and `AppUserNotification` (the "happened to me"
 * mentions/assignments) — into {@link ObservationDraft}s; unrecognized events yield `[]`.
 *
 * Verification and normalization are pure (no network) — selected only when
 * `LINEAR_WEBHOOK_SECRET` is real-shaped; otherwise {@link MockObserver} is used.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import { asRecord, str } from '../json';
import type { ConnectorProvider } from '../ports/connector';
import type {
  InboundRouting,
  Observer,
  ObservationActorRef,
  ObservationDraft,
  ObservationSubjectRef,
  RawInboundEvent,
  VerifySignatureInput,
} from '../ports/observer';

/** Build the external person ref from a Linear user-shaped sub-object. */
function actorFrom(user: Record<string, unknown> | undefined): ObservationActorRef | undefined {
  const externalId = str(user, 'id');
  if (!externalId) return undefined;
  const displayName = str(user, 'name') ?? str(user, 'displayName');
  const avatar = str(user, 'avatarUrl');
  return {
    externalId,
    ...(displayName ? { displayName } : {}),
    ...(avatar ? { avatar } : {}),
  };
}

/** Validated configuration for {@link RealLinearObserver}. */
export interface RealLinearObserverConfig {
  /** App-level Linear webhook signing secret (from `LINEAR_WEBHOOK_SECRET`). */
  readonly signingSecret: string;
}

/** A real, env-driven {@link Observer} for Linear webhooks. */
export class RealLinearObserver implements Observer {
  /** {@inheritDoc Observer.provider} */
  readonly provider: ConnectorProvider = 'linear';
  private readonly signingSecret: string;

  constructor(config: RealLinearObserverConfig) {
    this.signingSecret = config.signingSecret;
  }

  /** {@inheritDoc Observer.verifySignature} */
  verifySignature(input: VerifySignatureInput): boolean {
    const signature = input.headers['linear-signature'];
    if (!signature) return false;
    const expected = createHmac('sha256', this.signingSecret)
      .update(input.rawBody, 'utf8')
      .digest('hex');
    // Constant-time compare over equal-length buffers (length mismatch is an immediate reject).
    const sigBuf = Buffer.from(signature, 'utf8');
    const expBuf = Buffer.from(expected, 'utf8');
    if (sigBuf.length !== expBuf.length) return false;
    return timingSafeEqual(sigBuf, expBuf);
  }

  /** {@inheritDoc Observer.route} */
  route(payload: unknown): InboundRouting | null {
    const body = asRecord(payload);
    if (!body) return null;
    const type = str(body, 'type');
    if (!type) return null;
    const action = str(body, 'action') ?? 'event';
    const externalWorkspaceId = str(body, 'organizationId');
    const dataId = this.eventEntityId(body);
    const ts = typeof body['webhookTimestamp'] === 'number' ? String(body['webhookTimestamp']) : '';
    return {
      ...(externalWorkspaceId ? { externalWorkspaceId } : {}),
      externalEventId: `${type}:${action}:${dataId}:${ts}`,
      eventType: type,
    };
  }

  /** {@inheritDoc Observer.normalize} */
  normalize(event: RawInboundEvent): ObservationDraft[] {
    const body = asRecord(event.payload);
    if (!body) return [];
    const dedupeKey = this.route(body)?.externalEventId ?? `linear:${event.receivedAt}`;
    switch (event.eventType) {
      case 'Issue':
        return this.normalizeIssue(body, event, dedupeKey);
      case 'Comment':
        return this.normalizeComment(body, event, dedupeKey);
      case 'Reaction':
        return this.normalizeReaction(body, event, dedupeKey);
      case 'AppUserNotification':
        return this.normalizeAppNotification(body, event, dedupeKey);
      default:
        return [];
    }
  }

  /** The native id of the entity an event concerns (the dedup anchor). */
  private eventEntityId(body: Record<string, unknown>): string {
    const data = asRecord(body['data']);
    const notification = asRecord(body['notification']);
    return str(data, 'id') ?? str(notification, 'id') ?? '';
  }

  private normalizeIssue(
    body: Record<string, unknown>,
    event: RawInboundEvent,
    dedupeKey: string,
  ): ObservationDraft[] {
    const data = asRecord(body['data']);
    const action = str(body, 'action');
    const title = str(data, 'title') ?? 'an issue';
    const state = asRecord(data?.['state']);
    const completed = str(state, 'type') === 'completed';
    const kind = action === 'create' ? 'created' : completed ? 'completed' : 'status_change';
    const verb = action === 'create' ? 'Created' : completed ? 'Completed' : 'Updated';
    const subject = this.issueSubject(data);
    const actor = actorFrom(asRecord(data?.['assignee']));
    const url = str(data, 'url');
    const id = str(data, 'id');
    return [
      {
        kind,
        occurredAt: str(body, 'createdAt') ?? event.receivedAt,
        title: `${verb} issue: ${title}`,
        ...(subject ? { subject } : {}),
        ...(actor ? { externalActor: actor } : {}),
        ...(url ? { permalink: url } : {}),
        ...(id ? { externalId: id } : {}),
        dedupeKey,
        payload: body,
      },
    ];
  }

  private normalizeComment(
    body: Record<string, unknown>,
    event: RawInboundEvent,
    dedupeKey: string,
  ): ObservationDraft[] {
    const data = asRecord(body['data']);
    const issue = asRecord(data?.['issue']);
    const subject = this.issueSubject(issue);
    const actor = actorFrom(asRecord(data?.['user']));
    const summary = str(data, 'body');
    const url = str(data, 'url');
    const id = str(data, 'id');
    return [
      {
        kind: 'comment',
        occurredAt: str(body, 'createdAt') ?? event.receivedAt,
        title: `Commented on ${str(issue, 'title') ?? 'an issue'}`,
        ...(summary ? { summary } : {}),
        ...(subject ? { subject } : {}),
        ...(actor ? { externalActor: actor } : {}),
        ...(url ? { permalink: url } : {}),
        ...(id ? { externalId: id } : {}),
        dedupeKey,
        payload: body,
      },
    ];
  }

  private normalizeReaction(
    body: Record<string, unknown>,
    event: RawInboundEvent,
    dedupeKey: string,
  ): ObservationDraft[] {
    const data = asRecord(body['data']);
    const actor = actorFrom(asRecord(data?.['user']));
    const id = str(data, 'id');
    return [
      {
        kind: 'reaction',
        occurredAt: str(body, 'createdAt') ?? event.receivedAt,
        title: `Reacted ${str(data, 'emoji') ?? ''}`.trim(),
        ...(actor ? { externalActor: actor } : {}),
        ...(id ? { externalId: id } : {}),
        dedupeKey,
        payload: body,
      },
    ];
  }

  private normalizeAppNotification(
    body: Record<string, unknown>,
    event: RawInboundEvent,
    dedupeKey: string,
  ): ObservationDraft[] {
    const notification = asRecord(body['notification']);
    const notifType = str(notification, 'type') ?? '';
    // Assignment vs mention; anything else is still surfaced as a mention-class signal.
    const kind = notifType === 'issueAssignedToYou' ? 'assignment' : 'mention';
    const issue = asRecord(notification?.['issue']);
    const subject = this.issueSubject(issue);
    const actor = actorFrom(asRecord(notification?.['actor']));
    const what = str(issue, 'title') ?? 'a Linear item';
    const url = str(issue, 'url');
    const id = str(notification, 'id');
    return [
      {
        kind,
        occurredAt: str(notification, 'createdAt') ?? str(body, 'createdAt') ?? event.receivedAt,
        title: kind === 'assignment' ? `Assigned to you: ${what}` : `You were mentioned: ${what}`,
        ...(subject ? { subject } : {}),
        ...(actor ? { externalActor: actor } : {}),
        ...(url ? { permalink: url } : {}),
        ...(id ? { externalId: id } : {}),
        dedupeKey,
        payload: body,
      },
    ];
  }

  /** Build an issue subject ref from a Linear issue-shaped object. */
  private issueSubject(
    issue: Record<string, unknown> | undefined,
  ): ObservationSubjectRef | undefined {
    const externalId = str(issue, 'id');
    if (!externalId) return undefined;
    return {
      type: 'issue',
      externalId,
      ...(str(issue, 'title') ? { title: str(issue, 'title') } : {}),
      ...(str(issue, 'url') ? { url: str(issue, 'url') } : {}),
    };
  }
}
