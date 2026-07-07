/**
 * `@docket/integrations` — `RealGitHubObserver` (GitHub App webhook → canonical events).
 *
 * @remarks
 * The env-driven {@link Observer} for the GitHub App firehose. GitHub signs every webhook with
 * the **app-level** webhook secret: a hex HMAC-SHA256 of the exact raw body, delivered as
 * `sha256=<hex>` in the `X-Hub-Signature-256` header.
 *
 * `route` reads the **installation id** (`installation.id`) as the routing key — matched against
 * `integration.connection.externalWorkspaceId`, where the connect flow records which installation
 * an org owns — plus a per-delivery event id for dedup. The GitHub *event type* (issues /
 * issue_comment / pull_request / …) is carried in the `X-GitHub-Event` header, which `route`
 * does not receive, so it is **inferred from the payload shape** (which top-level objects are
 * present) instead. `normalize` maps the high-value events into canonical {@link EventDraft}s off
 * the webhook payload alone (GitHub embeds the full issue/PR object, so no extra API call is
 * needed): issues and pull requests both collapse to `entity.kind = 'work_item'`, PR events carry
 * a typed `github.pull_request` {@link EventDetail}, and everything else falls back to `generic`.
 * Payloads that carry no issue/PR/comment (ping/health deliveries) yield `[]`.
 *
 * Verification and normalization are pure (no network) — selected only when
 * `GITHUB_APP_WEBHOOK_SECRET` is real-shaped; otherwise {@link MockObserver} is used.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import type { CanonicalEntityKind, EventKind } from '@docket/types';

import { type DetailBuilder, genericDetail, runDetailBuilders } from './event-detail';
import { asRecord, str } from './json';
import type {
  EventActorRef,
  EventDraft,
  EventEntityRef,
  InboundRouting,
  Observer,
  ObserverProvider,
  RawInboundEvent,
  VerifySignatureInput,
} from './observer';

/** The GitHub webhook event types Docket ingests, inferred from the payload shape. */
type GitHubEventType =
  | 'issues'
  | 'issue_comment'
  | 'pull_request'
  | 'pull_request_review_comment'
  | 'unknown';

/** Build the external person ref from a GitHub user-shaped sub-object (`login`/`id`/`avatar_url`). */
function actorFrom(user: Record<string, unknown> | undefined): EventActorRef | undefined {
  const externalId = str(user, 'login') ?? (user && 'id' in user ? String(user['id']) : undefined);
  if (!externalId) return undefined;
  const displayName = str(user, 'login');
  const avatarUrl = str(user, 'avatar_url');
  return {
    externalId,
    ...(displayName ? { displayName } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
  };
}

/** The per-event context the GitHub detail-builders inspect. */
interface GitHubDetailContext {
  /** The inferred GitHub event type. */
  readonly eventType: GitHubEventType;
  /** The raw issue/PR/comment object the event concerns. */
  readonly object: Record<string, unknown> | undefined;
  /** The draft title (carried onto the `generic` fallback). */
  readonly title: string;
  /** The draft summary, when any. */
  readonly summary?: string;
  /** The source permalink, when any. */
  readonly url?: string;
}

/** Pull-request events carry a typed `github.pull_request` detail (number + merged/draft flags). */
const buildGitHubPullRequestDetail: DetailBuilder<GitHubDetailContext> = (ctx) => {
  if (ctx.eventType !== 'pull_request') return null;
  const numberRaw = ctx.object?.['number'];
  if (typeof numberRaw !== 'number') return null;
  return {
    schema: 'github.pull_request',
    number: numberRaw,
    merged: ctx.object?.['merged'] === true,
    draft: ctx.object?.['draft'] === true,
  };
};

/** Tail: anything without a specific shape surfaces as a degraded `generic` row. */
const buildGitHubGenericDetail: DetailBuilder<GitHubDetailContext> = (ctx) =>
  genericDetail(ctx.title, ctx.summary, ctx.url);

/** The ordered GitHub detail-builder chain ("first non-null wins"). */
const GITHUB_DETAIL_BUILDERS: readonly DetailBuilder<GitHubDetailContext>[] = [
  buildGitHubPullRequestDetail,
  buildGitHubGenericDetail,
];

/** Validated configuration for {@link RealGitHubObserver}. */
export interface RealGitHubObserverConfig {
  /** App-level GitHub webhook signing secret (from `GITHUB_APP_WEBHOOK_SECRET`). */
  readonly signingSecret: string;
}

/** A real, env-driven {@link Observer} for GitHub App webhooks. */
export class RealGitHubObserver implements Observer {
  /** {@inheritDoc Observer.provider} */
  readonly provider: ObserverProvider = 'github';
  private readonly signingSecret: string;

  constructor(config: RealGitHubObserverConfig) {
    this.signingSecret = config.signingSecret;
  }

  /** {@inheritDoc Observer.verifySignature} */
  verifySignature(input: VerifySignatureInput): boolean {
    const signature = input.headers['x-hub-signature-256'];
    if (!signature) return false;
    const expected = `sha256=${createHmac('sha256', this.signingSecret)
      .update(input.rawBody, 'utf8')
      .digest('hex')}`;
    const sigBuf = Buffer.from(signature, 'utf8');
    const expBuf = Buffer.from(expected, 'utf8');
    if (sigBuf.length !== expBuf.length) return false;
    return timingSafeEqual(sigBuf, expBuf);
  }

  /**
   * Infer the GitHub event type from which top-level objects the payload carries.
   *
   * @remarks
   * The real event type is in the `X-GitHub-Event` header, which {@link Observer.route} does not
   * receive; the payload shape is an equivalent discriminator (a comment payload also carries its
   * parent issue/PR, so the comment keys are checked first).
   */
  private inferEventType(body: Record<string, unknown>): GitHubEventType {
    if ('comment' in body && 'pull_request' in body) return 'pull_request_review_comment';
    if ('comment' in body && 'issue' in body) return 'issue_comment';
    if ('pull_request' in body) return 'pull_request';
    if ('issue' in body) return 'issues';
    return 'unknown';
  }

  /** The native id + last-modified of the entity an event concerns (the dedup anchor). */
  private eventEntity(body: Record<string, unknown>): { id: string; updatedAt: string } {
    const comment = asRecord(body['comment']);
    const pr = asRecord(body['pull_request']);
    const issue = asRecord(body['issue']);
    const entity = comment ?? pr ?? issue;
    const id = entity && 'id' in entity ? String(entity['id']) : '';
    const updatedAt = str(entity, 'updated_at') ?? '';
    return { id, updatedAt };
  }

  /** {@inheritDoc Observer.route} */
  route(payload: unknown): InboundRouting | null {
    const body = asRecord(payload);
    if (!body) return null;
    const eventType = this.inferEventType(body);
    if (eventType === 'unknown') return null;
    const action = str(body, 'action') ?? 'event';
    const installation = asRecord(body['installation']);
    const externalWorkspaceId =
      installation && 'id' in installation ? String(installation['id']) : undefined;
    const { id, updatedAt } = this.eventEntity(body);
    return {
      ...(externalWorkspaceId ? { externalWorkspaceId } : {}),
      externalEventId: `${eventType}:${action}:${id}:${updatedAt}`,
      eventType,
    };
  }

  /** {@inheritDoc Observer.normalize} */
  normalize(event: RawInboundEvent): EventDraft[] {
    const body = asRecord(event.payload);
    if (!body) return [];
    const dedupeKey = this.route(body)?.externalEventId ?? `github:${event.receivedAt}`;
    switch (event.eventType as GitHubEventType) {
      case 'issues':
        return this.normalizeIssue(body, event, dedupeKey);
      case 'pull_request':
        return this.normalizePull(body, event, dedupeKey);
      case 'issue_comment':
      case 'pull_request_review_comment':
        return this.normalizeComment(body, event, dedupeKey);
      default:
        // A ping/health delivery carries no issue/PR/comment — genuinely nothing to record.
        return [];
    }
  }

  private normalizeIssue(
    body: Record<string, unknown>,
    event: RawInboundEvent,
    dedupeKey: string,
  ): EventDraft[] {
    const issue = asRecord(body['issue']);
    const action = str(body, 'action');
    const title = str(issue, 'title') ?? 'an issue';
    const closed = str(issue, 'state') === 'closed';
    const kind: EventKind =
      action === 'opened' ? 'created' : closed ? 'completed' : 'status_change';
    const verb = action === 'opened' ? 'Opened' : closed ? 'Closed' : 'Updated';
    return [
      this.draft({
        kind,
        eventType: 'issues',
        title: `${verb} issue: ${title}`,
        entity: this.entityRef('work_item', issue),
        actor: actorFrom(asRecord(body['sender'])),
        object: issue,
        event,
        dedupeKey,
      }),
    ];
  }

  private normalizePull(
    body: Record<string, unknown>,
    event: RawInboundEvent,
    dedupeKey: string,
  ): EventDraft[] {
    const pr = asRecord(body['pull_request']);
    const action = str(body, 'action');
    const title = str(pr, 'title') ?? 'a pull request';
    const merged = pr?.['merged'] === true;
    const closed = str(pr, 'state') === 'closed';
    const kind: EventKind =
      action === 'opened' ? 'created' : merged || closed ? 'completed' : 'status_change';
    const verb = action === 'opened' ? 'Opened' : merged ? 'Merged' : closed ? 'Closed' : 'Updated';
    return [
      this.draft({
        kind,
        eventType: 'pull_request',
        title: `${verb} PR: ${title}`,
        entity: this.entityRef('work_item', pr),
        actor: actorFrom(asRecord(body['sender'])),
        object: pr,
        event,
        dedupeKey,
      }),
    ];
  }

  private normalizeComment(
    body: Record<string, unknown>,
    event: RawInboundEvent,
    dedupeKey: string,
  ): EventDraft[] {
    const comment = asRecord(body['comment']);
    const parent = asRecord(body['issue']) ?? asRecord(body['pull_request']);
    const summary = str(comment, 'body');
    const eventType: GitHubEventType = body['pull_request']
      ? 'pull_request_review_comment'
      : 'issue_comment';
    return [
      this.draft({
        kind: 'comment',
        eventType,
        title: `Commented on ${str(parent, 'title') ?? 'a thread'}`,
        ...(summary ? { summary } : {}),
        entity: this.entityRef('work_item', parent),
        actor: actorFrom(asRecord(comment?.['user']) ?? asRecord(body['sender'])),
        object: comment,
        event,
        dedupeKey,
      }),
    ];
  }

  /** Assemble one {@link EventDraft}, threading the common provenance + typed detail. */
  private draft(input: {
    kind: EventKind;
    eventType: GitHubEventType;
    title: string;
    summary?: string;
    entity: EventEntityRef | undefined;
    actor: EventActorRef | undefined;
    object: Record<string, unknown> | undefined;
    event: RawInboundEvent;
    dedupeKey: string;
  }): EventDraft {
    const url = str(input.object, 'html_url');
    const id = input.object && 'id' in input.object ? String(input.object['id']) : undefined;
    return {
      kind: input.kind,
      occurredAt: str(input.object, 'updated_at') ?? input.event.receivedAt,
      title: input.title,
      ...(input.summary ? { summary: input.summary } : {}),
      ...(input.entity ? { entity: input.entity } : {}),
      ...(input.actor ? { actor: input.actor } : {}),
      ...(url ? { permalink: url } : {}),
      ...(id ? { externalId: id } : {}),
      dedupeKey: input.dedupeKey,
      detail: runDetailBuilders(GITHUB_DETAIL_BUILDERS, {
        eventType: input.eventType,
        object: input.object,
        title: input.title,
        ...(input.summary ? { summary: input.summary } : {}),
        ...(url ? { url } : {}),
      }),
    };
  }

  /** Build a canonical entity ref from a GitHub issue/PR-shaped object. */
  private entityRef(
    kind: CanonicalEntityKind,
    object: Record<string, unknown> | undefined,
  ): EventEntityRef | undefined {
    const externalId = object && 'id' in object ? String(object['id']) : undefined;
    if (!externalId) return undefined;
    return {
      kind,
      externalId,
      ...(str(object, 'title') ? { title: str(object, 'title') } : {}),
      ...(str(object, 'html_url') ? { url: str(object, 'html_url') } : {}),
    };
  }
}
