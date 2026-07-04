/**
 * `@docket/boundaries/real` — `RealDiscordObserver` (Discord messages/interactions → canonical events).
 *
 * @remarks
 * The env-driven {@link Observer} for Discord. Unlike Slack (HMAC over a shared signing secret),
 * Discord signs each request with the app's **Ed25519** key: the signature (`X-Signature-Ed25519`,
 * hex) is over `timestamp + rawBody`, with the timestamp in `X-Signature-Timestamp`, verified
 * against the app's **public key** (a raw 32-byte key, hex-encoded, from the developer portal). The
 * initial handshake is a `type:1` PING (the ingest edge answers a `type:1` PONG), for which `route`
 * returns null.
 *
 * Ordinary Discord message mentions are not available over HTTP — they arrive over the Gateway and
 * are forwarded to Docket by the {@link https | discord-relay} sidecar as a gateway-shaped envelope
 * `{ t: 'MESSAGE_CREATE', d: <message>, mentioned_user_ids: [...] }`. `route` keys off the message's
 * `guild_id` (workspace) + `id` (dedup); `normalize` maps the channel to `entity.kind = 'thread'`,
 * emits `kind = 'mention'` when the relay expanded any mentioned users (else `message`), carries the
 * mentioned users as `participants` (so the attribution seam can resolve them to Docket users), and
 * attaches a typed `discord.message` {@link EventDetail}. Any other payload still surfaces as a
 * degraded `generic` draft; a payload with no message (the PING) yields `[]`. Observe-only, so it
 * binds to the {@link ObserverProvider} `'discord'`.
 *
 * Pure (verification uses only the public key + request bytes) — selected when `DISCORD_PUBLIC_KEY`
 * is real-shaped; otherwise {@link MockObserver} is used.
 */
import { createPublicKey, verify as cryptoVerify } from 'node:crypto';
import type { KeyObject } from 'node:crypto';

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

/** The fixed SPKI DER prefix for an Ed25519 public key; the raw 32-byte key is appended. */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/** The per-event context the Discord detail-builders inspect. */
interface DiscordDetailContext {
  /** The channel the message was posted in, when present. */
  readonly channelId: string | undefined;
  /** The guild the channel belongs to, or `null` for a direct message. */
  readonly guildId: string | null;
  /** The message body (empty string when the payload carries none). */
  readonly text: string;
  /** The draft title (carried onto the `generic` fallback). */
  readonly title: string;
}

/** A message payload carries a typed `discord.message` detail. */
const buildDiscordMessageDetail: DetailBuilder<DiscordDetailContext> = (ctx) => {
  if (!ctx.channelId) return null;
  return {
    schema: 'discord.message',
    channelId: ctx.channelId,
    guildId: ctx.guildId,
    text: ctx.text,
  };
};

/** Tail: anything without a specific shape surfaces as a degraded `generic` row. */
const buildDiscordGenericDetail: DetailBuilder<DiscordDetailContext> = (ctx) =>
  genericDetail(ctx.title, ctx.text || undefined);

/** The ordered Discord detail-builder chain ("first non-null wins"). */
const DISCORD_DETAIL_BUILDERS: readonly DetailBuilder<DiscordDetailContext>[] = [
  buildDiscordMessageDetail,
  buildDiscordGenericDetail,
];

/** Validated configuration for {@link RealDiscordObserver}. */
export interface RealDiscordObserverConfig {
  /** Discord app public key, raw 32-byte Ed25519 key hex-encoded (from `DISCORD_PUBLIC_KEY`). */
  readonly publicKey: string;
}

/** A real, env-driven {@link Observer} for Discord messages + interactions. */
export class RealDiscordObserver implements Observer {
  /** {@inheritDoc Observer.provider} */
  readonly provider: ObserverProvider = 'discord';
  private readonly publicKeyHex: string;
  /** Lazily-parsed Ed25519 key object (null once parsing has been attempted and failed). */
  private keyObject: KeyObject | null | undefined;

  constructor(config: RealDiscordObserverConfig) {
    this.publicKeyHex = config.publicKey;
  }

  /** {@inheritDoc Observer.verifySignature} */
  verifySignature(input: VerifySignatureInput): boolean {
    const signature = input.headers['x-signature-ed25519'];
    const timestamp = input.headers['x-signature-timestamp'];
    if (!signature || !timestamp) return false;
    const key = this.key();
    if (!key) return false;
    try {
      return cryptoVerify(
        null,
        Buffer.from(timestamp + input.rawBody),
        key,
        Buffer.from(signature, 'hex'),
      );
    } catch {
      // A malformed signature/key yields a verification error rather than a boolean — treat any
      // such failure as "not authentic" (never throw out of the pure edge).
      return false;
    }
  }

  /** {@inheritDoc Observer.route} */
  route(payload: unknown): InboundRouting | null {
    const body = asRecord(payload);
    if (!body) return null;
    // The type:1 PING handshake is not an event — the ingest edge answers a type:1 PONG.
    if (body['type'] === 1) return null;
    const message = asRecord(body['d']) ?? body;
    const messageId = str(message, 'id');
    if (messageId) {
      const guildId = str(message, 'guild_id');
      const eventType = str(body, 't') ?? 'MESSAGE_CREATE';
      return {
        ...(guildId ? { externalWorkspaceId: guildId } : {}),
        externalEventId: messageId,
        eventType,
      };
    }
    return null;
  }

  /** {@inheritDoc Observer.normalize} */
  normalize(event: RawInboundEvent): EventDraft[] {
    const body = asRecord(event.payload);
    const message = asRecord(body?.['d']);
    // No message object (e.g. the PING handshake) — genuinely nothing to record.
    if (!message) return [];

    const channelId = str(message, 'channel');
    const channel = str(message, 'channel_id') ?? channelId;
    const guildId = str(message, 'guild_id') ?? null;
    const text = str(message, 'content') ?? '';
    const author = asRecord(message['author']);
    const authorName = author ? (str(author, 'global_name') ?? str(author, 'username')) : undefined;
    const actor: EventActorRef | undefined = author
      ? {
          externalId: str(author, 'id') ?? '',
          ...(authorName ? { displayName: authorName } : {}),
        }
      : undefined;

    // The relay expands direct/@role/reply/DM targets into one flat id list; fall back to the
    // message's own direct-mention array when the expansion field is absent.
    const mentionedIds = this.mentionedUserIds(body, message);
    const nameById = this.mentionNames(message);
    const participants: EventActorRef[] = mentionedIds.map((id) => {
      const name = nameById.get(id);
      return { externalId: id, ...(name ? { displayName: name } : {}) };
    });

    const kind: EventKind = mentionedIds.length > 0 ? 'mention' : 'message';
    const entity: EventEntityRef | undefined = channel
      ? { kind: 'thread', externalId: channel }
      : undefined;
    const title = kind === 'mention' ? 'Mentioned you in Discord' : 'New Discord message';
    const detail: EventDetail = runDetailBuilders(DISCORD_DETAIL_BUILDERS, {
      channelId: channel,
      guildId,
      text,
      title,
    });
    const dedupeKey = str(message, 'id') ?? `discord:${event.receivedAt}`;
    return [
      {
        kind,
        occurredAt: str(message, 'timestamp') ?? event.receivedAt,
        title,
        ...(text ? { summary: text } : {}),
        ...(actor?.externalId ? { actor } : {}),
        ...(entity ? { entity } : {}),
        ...(participants.length ? { participants } : { participants: [] }),
        dedupeKey,
        detail,
      },
    ];
  }

  /** Parse (once) the raw hex public key into an Ed25519 {@link KeyObject}, or null if malformed. */
  private key(): KeyObject | null {
    if (this.keyObject !== undefined) return this.keyObject;
    try {
      const raw = Buffer.from(this.publicKeyHex, 'hex');
      const der = Buffer.concat([ED25519_SPKI_PREFIX, raw]);
      this.keyObject = createPublicKey({ key: der, format: 'der', type: 'spki' });
    } catch {
      this.keyObject = null;
    }
    return this.keyObject;
  }

  /** The flat set of mentioned user ids: the relay's expansion, else the message's own mentions. */
  private mentionedUserIds(
    body: Record<string, unknown> | undefined,
    message: Record<string, unknown>,
  ): string[] {
    const expandedRaw = body?.['mentioned_user_ids'];
    if (Array.isArray(expandedRaw)) {
      return expandedRaw.filter((v): v is string => typeof v === 'string');
    }
    const mentions = Array.isArray(message['mentions']) ? (message['mentions'] as unknown[]) : [];
    return mentions.flatMap((m) => {
      const id = str(asRecord(m), 'id');
      return id ? [id] : [];
    });
  }

  /** Display names for mentioned users, taken from the message's `mentions[]` when present. */
  private mentionNames(message: Record<string, unknown>): Map<string, string> {
    const names = new Map<string, string>();
    const mentions = Array.isArray(message['mentions']) ? (message['mentions'] as unknown[]) : [];
    for (const m of mentions) {
      const rec = asRecord(m);
      const id = str(rec, 'id');
      const name = str(rec, 'global_name') ?? str(rec, 'username');
      if (id && name) names.set(id, name);
    }
    return names;
  }
}
