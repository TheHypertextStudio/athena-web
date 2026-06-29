/**
 * `@docket/boundaries/real` — `RealGitHubObserver` (GitHub App webhook → observations).
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
 * present) instead. `normalize` maps the high-value events into {@link ObservationDraft}s off the
 * webhook payload alone (GitHub embeds the full issue/PR object, so no extra API call is needed).
 *
 * Verification and normalization are pure (no network) — selected only when
 * `GITHUB_APP_WEBHOOK_SECRET` is real-shaped; otherwise {@link MockObserver} is used.
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

/** The GitHub webhook event types Docket ingests, inferred from the payload shape. */
type GitHubEventType =
  | 'issues'
  | 'issue_comment'
  | 'pull_request'
  | 'pull_request_review_comment'
  | 'unknown';

/** Build the external person ref from a GitHub user-shaped sub-object (`login`/`id`/`avatar_url`). */
function actorFrom(user: Record<string, unknown> | undefined): ObservationActorRef | undefined {
  const externalId = str(user, 'login') ?? (user && 'id' in user ? String(user['id']) : undefined);
  if (!externalId) return undefined;
  const displayName = str(user, 'login');
  const avatar = str(user, 'avatar_url');
  return {
    externalId,
    ...(displayName ? { displayName } : {}),
    ...(avatar ? { avatar } : {}),
  };
}

/** Validated configuration for {@link RealGitHubObserver}. */
export interface RealGitHubObserverConfig {
  /** App-level GitHub webhook signing secret (from `GITHUB_APP_WEBHOOK_SECRET`). */
  readonly signingSecret: string;
}

/** A real, env-driven {@link Observer} for GitHub App webhooks. */
export class RealGitHubObserver implements Observer {
  /** {@inheritDoc Observer.provider} */
  readonly provider: ConnectorProvider = 'github';
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
  normalize(event: RawInboundEvent): ObservationDraft[] {
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
        return [];
    }
  }

  private normalizeIssue(
    body: Record<string, unknown>,
    event: RawInboundEvent,
    dedupeKey: string,
  ): ObservationDraft[] {
    const issue = asRecord(body['issue']);
    const action = str(body, 'action');
    const title = str(issue, 'title') ?? 'an issue';
    const closed = str(issue, 'state') === 'closed';
    const kind = action === 'opened' ? 'created' : closed ? 'completed' : 'status_change';
    const verb = action === 'opened' ? 'Opened' : closed ? 'Closed' : 'Updated';
    return [
      this.draft({
        kind,
        title: `${verb} issue: ${title}`,
        subject: this.subject('issue', issue),
        actor: actorFrom(asRecord(body['sender'])),
        entity: issue,
        body,
        event,
        dedupeKey,
      }),
    ];
  }

  private normalizePull(
    body: Record<string, unknown>,
    event: RawInboundEvent,
    dedupeKey: string,
  ): ObservationDraft[] {
    const pr = asRecord(body['pull_request']);
    const action = str(body, 'action');
    const title = str(pr, 'title') ?? 'a pull request';
    const merged = pr?.['merged'] === true;
    const closed = str(pr, 'state') === 'closed';
    const kind = action === 'opened' ? 'created' : merged || closed ? 'completed' : 'status_change';
    const verb = action === 'opened' ? 'Opened' : merged ? 'Merged' : closed ? 'Closed' : 'Updated';
    return [
      this.draft({
        kind,
        title: `${verb} PR: ${title}`,
        subject: this.subject('pull_request', pr),
        actor: actorFrom(asRecord(body['sender'])),
        entity: pr,
        body,
        event,
        dedupeKey,
      }),
    ];
  }

  private normalizeComment(
    body: Record<string, unknown>,
    event: RawInboundEvent,
    dedupeKey: string,
  ): ObservationDraft[] {
    const comment = asRecord(body['comment']);
    const parent = asRecord(body['issue']) ?? asRecord(body['pull_request']);
    const summary = str(comment, 'body');
    return [
      this.draft({
        kind: 'comment',
        title: `Commented on ${str(parent, 'title') ?? 'a thread'}`,
        ...(summary ? { summary } : {}),
        subject: this.subject(body['pull_request'] ? 'pull_request' : 'issue', parent),
        actor: actorFrom(asRecord(comment?.['user']) ?? asRecord(body['sender'])),
        entity: comment,
        body,
        event,
        dedupeKey,
      }),
    ];
  }

  /** Assemble one {@link ObservationDraft}, threading the common provenance fields. */
  private draft(input: {
    kind: string;
    title: string;
    summary?: string;
    subject: ObservationSubjectRef | undefined;
    actor: ObservationActorRef | undefined;
    entity: Record<string, unknown> | undefined;
    body: Record<string, unknown>;
    event: RawInboundEvent;
    dedupeKey: string;
  }): ObservationDraft {
    const url = str(input.entity, 'html_url');
    const id = input.entity && 'id' in input.entity ? String(input.entity['id']) : undefined;
    return {
      kind: input.kind,
      occurredAt: str(input.entity, 'updated_at') ?? input.event.receivedAt,
      title: input.title,
      ...(input.summary ? { summary: input.summary } : {}),
      ...(input.subject ? { subject: input.subject } : {}),
      ...(input.actor ? { externalActor: input.actor } : {}),
      ...(url ? { permalink: url } : {}),
      ...(id ? { externalId: id } : {}),
      dedupeKey: input.dedupeKey,
      payload: input.body,
    };
  }

  /** Build a subject ref from a GitHub issue/PR-shaped object. */
  private subject(
    type: 'issue' | 'pull_request',
    entity: Record<string, unknown> | undefined,
  ): ObservationSubjectRef | undefined {
    const externalId = entity && 'id' in entity ? String(entity['id']) : undefined;
    if (!externalId) return undefined;
    return {
      type,
      externalId,
      ...(str(entity, 'title') ? { title: str(entity, 'title') } : {}),
      ...(str(entity, 'html_url') ? { url: str(entity, 'html_url') } : {}),
    };
  }
}
