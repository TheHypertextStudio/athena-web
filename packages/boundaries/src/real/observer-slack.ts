/**
 * `@docket/boundaries/real` — `RealSlackObserver` (Slack Events API → observations).
 *
 * @remarks
 * The env-driven {@link Observer} for Slack. Slack signs each request with the app **signing
 * secret**: `v0=<hex>` of `HMAC-SHA256("v0:" + timestamp + ":" + rawBody)`, delivered in
 * `X-Slack-Signature` with the timestamp in `X-Slack-Request-Timestamp` (rejected if older than
 * 5 min — the replay guard). `route` reads `team_id` (workspace) + `event_id` (dedup) + the inner
 * `event.type`. The initial `url_verification` handshake carries no event, so `route` returns null
 * and the ingest edge echoes its `challenge`. `normalize` maps `app_mention`→`mention`,
 * `message`→`message`, `reaction_added`→`reaction`. Observe-only (no Slack connector), so it binds
 * to the {@link ObserverProvider} `'slack'`.
 *
 * Pure (verification uses only the secret + the request clock) — selected when
 * `SLACK_SIGNING_SECRET` is real-shaped; otherwise {@link MockObserver} is used.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import { asRecord, str } from '../json';
import type {
  InboundRouting,
  Observer,
  ObservationActorRef,
  ObservationDraft,
  ObserverProvider,
  RawInboundEvent,
  VerifySignatureInput,
} from '../ports/observer';

/** Reject requests whose signed timestamp is older than this (Slack's replay window). */
const SLACK_REPLAY_WINDOW_S = 300;

/** Validated configuration for {@link RealSlackObserver}. */
export interface RealSlackObserverConfig {
  /** Slack app signing secret (from `SLACK_SIGNING_SECRET`). */
  readonly signingSecret: string;
}

/** A real, env-driven {@link Observer} for the Slack Events API. */
export class RealSlackObserver implements Observer {
  /** {@inheritDoc Observer.provider} */
  readonly provider: ObserverProvider = 'slack';
  private readonly signingSecret: string;

  constructor(config: RealSlackObserverConfig) {
    this.signingSecret = config.signingSecret;
  }

  /** {@inheritDoc Observer.verifySignature} */
  verifySignature(input: VerifySignatureInput): boolean {
    const signature = input.headers['x-slack-signature'];
    const timestamp = input.headers['x-slack-request-timestamp'];
    if (!signature || !timestamp) return false;
    const tsNum = Number(timestamp);
    if (!Number.isFinite(tsNum)) return false;
    // Replay guard: the signed timestamp must be recent.
    if (Math.abs(Date.now() / 1000 - tsNum) > SLACK_REPLAY_WINDOW_S) return false;
    const expected = `v0=${createHmac('sha256', this.signingSecret)
      .update(`v0:${timestamp}:${input.rawBody}`, 'utf8')
      .digest('hex')}`;
    const sigBuf = Buffer.from(signature, 'utf8');
    const expBuf = Buffer.from(expected, 'utf8');
    if (sigBuf.length !== expBuf.length) return false;
    return timingSafeEqual(sigBuf, expBuf);
  }

  /** {@inheritDoc Observer.route} */
  route(payload: unknown): InboundRouting | null {
    const body = asRecord(payload);
    if (!body) return null;
    // The url_verification handshake is not an event — the ingest edge echoes its `challenge`.
    if (str(body, 'type') === 'url_verification') return null;
    const event = asRecord(body['event']);
    const eventType = str(event, 'type');
    const externalWorkspaceId = str(body, 'team_id');
    const externalEventId =
      str(body, 'event_id') ??
      `${externalWorkspaceId ?? ''}:${str(event, 'event_ts') ?? str(event, 'ts') ?? ''}`;
    if (!eventType || externalEventId === ':') return null;
    return {
      ...(externalWorkspaceId ? { externalWorkspaceId } : {}),
      externalEventId,
      eventType,
    };
  }

  /** {@inheritDoc Observer.normalize} */
  normalize(event: RawInboundEvent): ObservationDraft[] {
    const body = asRecord(event.payload);
    const ev = asRecord(body?.['event']);
    if (!ev) return [];
    const kind = this.kindFor(str(ev, 'type'));
    if (!kind) return [];
    const channel = str(ev, 'channel');
    const userId = str(ev, 'user');
    const actor: ObservationActorRef | undefined = userId ? { externalId: userId } : undefined;
    const text = str(ev, 'text');
    const dedupeKey = (body ? this.route(body)?.externalEventId : undefined) ?? `slack:${event.receivedAt}`;
    return [
      {
        kind,
        occurredAt: this.tsToIso(str(ev, 'event_ts') ?? str(ev, 'ts')) ?? event.receivedAt,
        title: kind === 'mention' ? 'Mentioned you in Slack' : `New Slack ${kind}`,
        ...(text ? { summary: text } : {}),
        ...(actor ? { externalActor: actor } : {}),
        ...(channel ? { subject: { type: 'channel', externalId: channel } } : {}),
        dedupeKey,
        payload: body ?? {},
      },
    ];
  }

  /** Map a Slack event type to an observation kind, or null to skip. */
  private kindFor(type: string | undefined): string | null {
    switch (type) {
      case 'app_mention':
        return 'mention';
      case 'message':
        return 'message';
      case 'reaction_added':
        return 'reaction';
      default:
        return null;
    }
  }

  /** Convert a Slack `ts` (`"1700000000.000100"`) to an ISO timestamp. */
  private tsToIso(ts: string | undefined): string | undefined {
    if (!ts) return undefined;
    const secs = Number(ts.split('.')[0]);
    return Number.isFinite(secs) ? new Date(secs * 1000).toISOString() : undefined;
  }
}
