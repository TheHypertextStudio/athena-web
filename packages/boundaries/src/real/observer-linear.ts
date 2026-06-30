/**
 * `@docket/boundaries/real` — `RealLinearObserver` (Linear webhook → canonical events).
 *
 * @remarks
 * The env-driven {@link Observer} for Linear. Linear signs each webhook with an
 * **app-level** secret: a hex HMAC-SHA256 of the exact raw body, delivered in the
 * `Linear-Signature` header. `route` reads the workspace id (`organizationId`) and a
 * per-delivery event id (`type:action:dataId:webhookTimestamp`) so the caller can map the
 * event to an integration and dedup retries. `normalize` maps the high-value event types
 * — `Issue`, `Comment`, `Reaction`, and `AppUserNotification` (the "happened to me"
 * mentions/assignments) — into canonical {@link EventDraft}s, mapping Linear's native object
 * types onto the {@link CanonicalEntityKind} taxonomy (issue → `work_item`, project →
 * `project`, cycle → `cycle`) and attaching a typed {@link EventDetail} via an ordered chain
 * of detail-builders. Unrecognized event types still surface as a degraded `generic` draft;
 * only a non-object payload yields `[]`.
 *
 * Verification and normalization are pure (no network) — selected only when
 * `LINEAR_WEBHOOK_SECRET` is real-shaped; otherwise {@link MockObserver} is used.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import type { CanonicalEntityKind, EventDetail, EventKind } from '@docket/types';

import { type DetailBuilder, genericDetail, runDetailBuilders } from '../event-detail';
import { asRecord, str } from '../json';
import type { ConnectorProvider } from '../ports/connector';
import type {
  EventActorRef,
  EventDraft,
  EventEntityRef,
  InboundRouting,
  Observer,
  RawInboundEvent,
  VerifySignatureInput,
} from '../ports/observer';

/** Build the external person ref from a Linear user-shaped sub-object. */
function actorFrom(user: Record<string, unknown> | undefined): EventActorRef | undefined {
  const externalId = str(user, 'id');
  if (!externalId) return undefined;
  const displayName = str(user, 'name') ?? str(user, 'displayName');
  const avatarUrl = str(user, 'avatarUrl');
  return {
    externalId,
    ...(displayName ? { displayName } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
  };
}

/** Map a Linear native object type (its event `type`) onto the canonical entity taxonomy. */
function linearEntityKind(eventType: string): CanonicalEntityKind | undefined {
  switch (eventType) {
    case 'Issue':
      return 'work_item';
    case 'Project':
      return 'project';
    case 'Cycle':
      return 'cycle';
    default:
      return undefined;
  }
}

/** The per-event context the Linear detail-builders inspect. */
interface LinearDetailContext {
  /** The Linear event `type` (`Issue`, `Comment`, …). */
  readonly eventType: string;
  /** The event's `data` sub-object, when present. */
  readonly data: Record<string, unknown> | undefined;
  /** The draft title (carried onto the `generic` fallback). */
  readonly title: string;
  /** The draft summary, when any. */
  readonly summary?: string;
  /** The source permalink, when any. */
  readonly url?: string;
}

/** Issue events carry a typed `linear.issue` detail (workflow state + priority). */
const buildLinearIssueDetail: DetailBuilder<LinearDetailContext> = (ctx) => {
  if (ctx.eventType !== 'Issue') return null;
  const state = asRecord(ctx.data?.['state']);
  const stateName = str(state, 'name') ?? null;
  const priorityRaw = ctx.data?.['priority'];
  const priority = typeof priorityRaw === 'number' ? priorityRaw : null;
  return { schema: 'linear.issue', stateName, priority };
};

/** Tail: anything without a specific shape surfaces as a degraded `generic` row. */
const buildLinearGenericDetail: DetailBuilder<LinearDetailContext> = (ctx) =>
  genericDetail(ctx.title, ctx.summary, ctx.url);

/** The ordered Linear detail-builder chain ("first non-null wins"). */
const LINEAR_DETAIL_BUILDERS: readonly DetailBuilder<LinearDetailContext>[] = [
  buildLinearIssueDetail,
  buildLinearGenericDetail,
];

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
  normalize(event: RawInboundEvent): EventDraft[] {
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
        // Unrecognized event type — surface a degraded `generic` draft instead of dropping it.
        return this.normalizeGeneric(body, event, dedupeKey);
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
  ): EventDraft[] {
    const data = asRecord(body['data']);
    const action = str(body, 'action');
    const title = str(data, 'title') ?? 'an issue';
    const state = asRecord(data?.['state']);
    const completed = str(state, 'type') === 'completed';
    const kind: EventKind =
      action === 'create' ? 'created' : completed ? 'completed' : 'status_change';
    const verb = action === 'create' ? 'Created' : completed ? 'Completed' : 'Updated';
    const entity = this.entityRef('work_item', data);
    const actor = actorFrom(asRecord(data?.['assignee']));
    const url = str(data, 'url');
    const id = str(data, 'id');
    const draftTitle = `${verb} issue: ${title}`;
    return [
      {
        kind,
        occurredAt: str(body, 'createdAt') ?? event.receivedAt,
        title: draftTitle,
        ...(entity ? { entity } : {}),
        ...(actor ? { actor } : {}),
        ...(url ? { permalink: url } : {}),
        ...(id ? { externalId: id } : {}),
        dedupeKey,
        detail: this.detailFor({
          eventType: 'Issue',
          data,
          title: draftTitle,
          ...(url ? { url } : {}),
        }),
      },
    ];
  }

  private normalizeComment(
    body: Record<string, unknown>,
    event: RawInboundEvent,
    dedupeKey: string,
  ): EventDraft[] {
    const data = asRecord(body['data']);
    const issue = asRecord(data?.['issue']);
    const entity = this.entityRef('work_item', issue);
    const actor = actorFrom(asRecord(data?.['user']));
    const summary = str(data, 'body');
    const url = str(data, 'url');
    const id = str(data, 'id');
    const title = `Commented on ${str(issue, 'title') ?? 'an issue'}`;
    return [
      {
        kind: 'comment',
        occurredAt: str(body, 'createdAt') ?? event.receivedAt,
        title,
        ...(summary ? { summary } : {}),
        ...(entity ? { entity } : {}),
        ...(actor ? { actor } : {}),
        ...(url ? { permalink: url } : {}),
        ...(id ? { externalId: id } : {}),
        dedupeKey,
        detail: this.detailFor({
          eventType: 'Comment',
          data,
          title,
          ...(summary ? { summary } : {}),
          ...(url ? { url } : {}),
        }),
      },
    ];
  }

  private normalizeReaction(
    body: Record<string, unknown>,
    event: RawInboundEvent,
    dedupeKey: string,
  ): EventDraft[] {
    const data = asRecord(body['data']);
    const actor = actorFrom(asRecord(data?.['user']));
    const id = str(data, 'id');
    const title = `Reacted ${str(data, 'emoji') ?? ''}`.trim();
    return [
      {
        kind: 'reaction',
        occurredAt: str(body, 'createdAt') ?? event.receivedAt,
        title,
        ...(actor ? { actor } : {}),
        ...(id ? { externalId: id } : {}),
        dedupeKey,
        detail: this.detailFor({ eventType: 'Reaction', data, title }),
      },
    ];
  }

  private normalizeAppNotification(
    body: Record<string, unknown>,
    event: RawInboundEvent,
    dedupeKey: string,
  ): EventDraft[] {
    const notification = asRecord(body['notification']);
    const notifType = str(notification, 'type') ?? '';
    // Assignment vs mention; anything else is still surfaced as a mention-class signal.
    const kind: EventKind = notifType === 'issueAssignedToYou' ? 'assignment' : 'mention';
    const issue = asRecord(notification?.['issue']);
    const entity = this.entityRef('work_item', issue);
    const actor = actorFrom(asRecord(notification?.['actor']));
    const what = str(issue, 'title') ?? 'a Linear item';
    const url = str(issue, 'url');
    const id = str(notification, 'id');
    const title =
      kind === 'assignment' ? `Assigned to you: ${what}` : `You were mentioned: ${what}`;
    return [
      {
        kind,
        occurredAt: str(notification, 'createdAt') ?? str(body, 'createdAt') ?? event.receivedAt,
        title,
        ...(entity ? { entity } : {}),
        ...(actor ? { actor } : {}),
        ...(url ? { permalink: url } : {}),
        ...(id ? { externalId: id } : {}),
        dedupeKey,
        detail: this.detailFor({
          eventType: 'AppUserNotification',
          data: issue,
          title,
          ...(url ? { url } : {}),
        }),
      },
    ];
  }

  /** Map an unrecognized Linear event onto a degraded `generic` draft (nothing is dropped). */
  private normalizeGeneric(
    body: Record<string, unknown>,
    event: RawInboundEvent,
    dedupeKey: string,
  ): EventDraft[] {
    const data = asRecord(body['data']);
    const action = str(body, 'action');
    const kind: EventKind = action === 'create' ? 'created' : 'status_change';
    const entityKind = linearEntityKind(event.eventType);
    const entity = entityKind ? this.entityRef(entityKind, data) : undefined;
    const title = str(data, 'title') ?? str(data, 'name') ?? `Linear ${event.eventType}`;
    const url = str(data, 'url');
    const id = str(data, 'id');
    return [
      {
        kind,
        occurredAt: str(body, 'createdAt') ?? event.receivedAt,
        title,
        ...(entity ? { entity } : {}),
        ...(url ? { permalink: url } : {}),
        ...(id ? { externalId: id } : {}),
        dedupeKey,
        detail: this.detailFor({
          eventType: event.eventType,
          data,
          title,
          ...(url ? { url } : {}),
        }),
      },
    ];
  }

  /** Resolve the typed {@link EventDetail} for an event via the ordered builder chain. */
  private detailFor(context: LinearDetailContext): EventDetail {
    return runDetailBuilders(LINEAR_DETAIL_BUILDERS, context);
  }

  /** Build a canonical entity ref from a Linear issue/project/cycle-shaped object. */
  private entityRef(
    kind: CanonicalEntityKind,
    obj: Record<string, unknown> | undefined,
  ): EventEntityRef | undefined {
    const externalId = str(obj, 'id');
    if (!externalId) return undefined;
    const title = str(obj, 'title') ?? str(obj, 'name');
    const url = str(obj, 'url');
    return {
      kind,
      externalId,
      ...(title ? { title } : {}),
      ...(url ? { url } : {}),
    };
  }
}
