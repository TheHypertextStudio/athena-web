/**
 * `@docket/boundaries/real` — `RealSlackObserver` (Slack Events API → canonical events).
 *
 * @remarks
 * The env-driven {@link Observer} for Slack. Slack signs each request with the app **signing
 * secret**: `v0=<hex>` of `HMAC-SHA256("v0:" + timestamp + ":" + rawBody)`, delivered in
 * `X-Slack-Signature` with the timestamp in `X-Slack-Request-Timestamp` (rejected if older than
 * 5 min — the replay guard). `route` reads `team_id` (workspace) + `event_id` (dedup) + the inner
 * `event.type`. The initial `url_verification` handshake carries no event, so `route` returns null
 * and the ingest edge echoes its `challenge`. `normalize` maps `app_mention`→`mention`,
 * `message`→`message`, `reaction_added`→`reaction`; the Slack channel/thread the event happened in
 * collapses to `entity.kind = 'thread'`, and message-class events carry a typed `slack.message`
 * {@link EventDetail}. Any other inner event type still surfaces as a degraded `generic` draft;
 * only a payload with no inner `event` (the handshake) yields `[]`. Observe-only (no Slack
 * connector), so it binds to the {@link ObserverProvider} `'slack'`.
 *
 * Pure (verification uses only the secret + the request clock) — selected when
 * `SLACK_SIGNING_SECRET` is real-shaped; otherwise {@link MockObserver} is used.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import type { EventDetail, EventKind } from '@docket/types';

import { type DetailBuilder, genericDetail, runDetailBuilders } from '../event-detail';
import { asRecord, str } from '../json';
import type {
  EventActorRef,
  EventDraft,
  EventEntityRef,
  InboundRouting,
  Observer,
  ObserverProvider,
  RawInboundEvent,
  VerifySignatureInput,
} from '../ports/observer';

/** Reject requests whose signed timestamp is older than this (Slack's replay window). */
const SLACK_REPLAY_WINDOW_S = 300;

/**
 * Slack renders user mentions as `<@U123>` (or `<@U123|label>`) in raw message text; user ids
 * start with `U` or `W` (Enterprise Grid). Captured ids become draft participants so the drain
 * can resolve "does this message mention a connected user" without re-parsing text.
 */
const SLACK_MENTION_RE = /<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g;

/**
 * Message subtypes that are pure channel noise (edits, deletes, join/leave/topic churn, bot
 * chatter) — normalized to nothing. `thread_broadcast` and `file_share` are real user messages
 * and intentionally NOT listed.
 */
const SKIPPED_MESSAGE_SUBTYPES: ReadonlySet<string> = new Set([
  'message_changed',
  'message_deleted',
  'channel_join',
  'channel_leave',
  'channel_topic',
  'bot_message',
]);

/** The per-event context the Slack detail-builders inspect. */
interface SlackDetailContext {
  /** The inner Slack event `type` (`message`, `app_mention`, …). */
  readonly eventType: string | undefined;
  /** The channel the event happened in, when present. */
  readonly channelId: string | undefined;
  /** The Slack conversation type (`im`/`mpim`/`channel`/`group`), when present. */
  readonly channelType: string | null;
  /** The parent thread timestamp, or `null` for a top-level message. */
  readonly threadTs: string | null;
  /** The message text (empty string when the event carries none). */
  readonly text: string;
  /** The draft title (carried onto the `generic` fallback). */
  readonly title: string;
}

/** Message-class events (`message`/`app_mention`) carry a typed `slack.message` detail. */
const buildSlackMessageDetail: DetailBuilder<SlackDetailContext> = (ctx) => {
  if (ctx.eventType !== 'message' && ctx.eventType !== 'app_mention') return null;
  if (!ctx.channelId) return null;
  return {
    schema: 'slack.message',
    channelId: ctx.channelId,
    threadTs: ctx.threadTs,
    text: ctx.text,
    channelType: ctx.channelType,
  };
};

/** Tail: anything without a specific shape surfaces as a degraded `generic` row. */
const buildSlackGenericDetail: DetailBuilder<SlackDetailContext> = (ctx) =>
  genericDetail(ctx.title, ctx.text || undefined);

/** The ordered Slack detail-builder chain ("first non-null wins"). */
const SLACK_DETAIL_BUILDERS: readonly DetailBuilder<SlackDetailContext>[] = [
  buildSlackMessageDetail,
  buildSlackGenericDetail,
];

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
  normalize(event: RawInboundEvent): EventDraft[] {
    const body = asRecord(event.payload);
    const ev = asRecord(body?.['event']);
    // No inner event (e.g. the url_verification handshake) — genuinely nothing to record.
    if (!ev) return [];
    const evType = str(ev, 'type');
    // Channel-noise subtypes (edits/deletes/join/leave/topic) and bot chatter carry nothing the
    // feed should record — drop them here so they never reach the drain as drafts.
    const subtype = str(ev, 'subtype');
    if (subtype && SKIPPED_MESSAGE_SUBTYPES.has(subtype)) return [];
    if (str(ev, 'bot_id')) return [];
    const mappedKind = this.kindFor(evType);
    // Slack is fundamentally a messaging surface, so an unmapped event still records as a
    // `message`-kind row (with a `generic` detail) rather than being dropped.
    const kind: EventKind = mappedKind ?? 'message';
    const channelId = str(ev, 'channel');
    const channelType = str(ev, 'channel_type') ?? null;
    const userId = str(ev, 'user');
    const actor: EventActorRef | undefined = userId ? { externalId: userId } : undefined;
    const text = str(ev, 'text') ?? '';
    const threadTs = str(ev, 'thread_ts') ?? null;
    const participants = this.mentionedUserIds(text).map(
      (externalId): EventActorRef => ({ externalId }),
    );
    const entity: EventEntityRef | undefined = channelId
      ? { kind: 'thread', externalId: channelId }
      : undefined;
    const dedupeKey =
      (body ? this.route(body)?.externalEventId : undefined) ?? `slack:${event.receivedAt}`;
    const title = this.titleFor(mappedKind, evType, channelType);
    const detail: EventDetail = runDetailBuilders(SLACK_DETAIL_BUILDERS, {
      eventType: evType,
      channelId,
      channelType,
      threadTs,
      text,
      title,
    });
    return [
      {
        kind,
        occurredAt: this.tsToIso(str(ev, 'event_ts') ?? str(ev, 'ts')) ?? event.receivedAt,
        title,
        ...(text ? { summary: text } : {}),
        ...(actor ? { actor } : {}),
        ...(entity ? { entity } : {}),
        ...(participants.length ? { participants } : {}),
        dedupeKey,
        detail,
      },
    ];
  }

  /** The distinct Slack user ids `<@U…>`-mentioned in a message text, in order of appearance. */
  private mentionedUserIds(text: string): string[] {
    const seen = new Set<string>();
    for (const match of text.matchAll(SLACK_MENTION_RE)) {
      const id = match[1];
      if (id) seen.add(id);
    }
    return [...seen];
  }

  /** Map a Slack event type to a canonical event kind, or null when it has no specific kind. */
  private kindFor(type: string | undefined): EventKind | null {
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

  /** The display title for a Slack event (degrades to the raw type for unmapped events). */
  private titleFor(
    kind: EventKind | null,
    evType: string | undefined,
    channelType: string | null,
  ): string {
    if (kind === 'mention') return 'Mentioned you in Slack';
    if (kind === 'message' && channelType === 'im') return 'Slack direct message';
    if (kind === 'message' && channelType === 'mpim') return 'Slack group message';
    if (kind) return `New Slack ${kind}`;
    return `Slack event: ${evType ?? 'unknown'}`;
  }

  /** Convert a Slack `ts` (`"1700000000.000100"`) to an ISO timestamp. */
  private tsToIso(ts: string | undefined): string | undefined {
    if (!ts) return undefined;
    const secs = Number(ts.split('.')[0]);
    return Number.isFinite(secs) ? new Date(secs * 1000).toISOString() : undefined;
  }
}
