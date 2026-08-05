import { generateKeyPairSync, sign as edSign } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { RealDiscordObserver } from '../../src/observer-discord';

// A throwaway Ed25519 keypair: Discord signs each request with the app's private key; the
// observer verifies with the app's public key (a raw 32-byte key, hex-encoded).
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
/** The raw 32-byte Ed25519 public key as hex — the shape Discord shows in the developer portal. */
const PUBLIC_KEY_HEX = publicKey
  .export({ type: 'spki', format: 'der' })
  .subarray(-32)
  .toString('hex');
const RECEIVED_AT = '2026-06-30T12:00:00.000Z';

const observer = new RealDiscordObserver({ publicKey: PUBLIC_KEY_HEX });

/** Sign exactly as Discord does: Ed25519 over `timestamp + rawBody`, hex-encoded. */
function sign(body: string, ts: string): string {
  return edSign(null, Buffer.from(ts + body), privateKey).toString('hex');
}

describe('RealDiscordObserver.verifySignature', () => {
  it('accepts a valid Ed25519 signature over timestamp + body', () => {
    const body = JSON.stringify({ type: 1 });
    const ts = '1700000000';
    expect(
      observer.verifySignature({
        rawBody: body,
        headers: { 'x-signature-ed25519': sign(body, ts), 'x-signature-timestamp': ts },
      }),
    ).toBe(true);
  });

  it('rejects a tampered body', () => {
    const body = JSON.stringify({ type: 1 });
    const ts = '1700000000';
    const sig = sign(body, ts);
    expect(
      observer.verifySignature({
        rawBody: `${body} `,
        headers: { 'x-signature-ed25519': sig, 'x-signature-timestamp': ts },
      }),
    ).toBe(false);
  });

  it('rejects missing headers', () => {
    expect(observer.verifySignature({ rawBody: '{}', headers: {} })).toBe(false);
  });

  it('rejects a malformed signature without throwing', () => {
    expect(
      observer.verifySignature({
        rawBody: '{}',
        headers: { 'x-signature-ed25519': 'not-hex', 'x-signature-timestamp': '1' },
      }),
    ).toBe(false);
  });

  it('rejects everything when the configured public key does not parse as Ed25519', () => {
    // A malformed `DISCORD_PUBLIC_KEY` (wrong length / not real key material) — `key()` must
    // swallow the parse failure and cache `null` rather than throwing out of the pure edge.
    const badObserver = new RealDiscordObserver({ publicKey: 'not-a-real-public-key' });
    const body = JSON.stringify({ type: 1 });
    const ts = '1700000000';
    expect(
      badObserver.verifySignature({
        rawBody: body,
        headers: { 'x-signature-ed25519': sign(body, ts), 'x-signature-timestamp': ts },
      }),
    ).toBe(false);
  });
});

describe('RealDiscordObserver.route', () => {
  it('returns null for the type:1 PING handshake', () => {
    expect(observer.route({ type: 1 })).toBeNull();
  });

  it('returns null for a non-object payload', () => {
    expect(observer.route(null)).toBeNull();
    expect(observer.route('not-json')).toBeNull();
  });

  it('routes a relayed message by guild id + message id', () => {
    const r = observer.route({
      t: 'MESSAGE_CREATE',
      d: { id: 'M1', channel_id: 'C1', guild_id: 'G1', content: 'hi' },
      mentioned_user_ids: ['U2'],
    });
    expect(r?.externalWorkspaceId).toBe('G1');
    expect(r?.externalEventId).toBe('M1');
    expect(r?.eventType).toBe('MESSAGE_CREATE');
  });

  it('falls back to the raw body when there is no relay envelope, defaulting the event type and omitting the workspace id', () => {
    const r = observer.route({ id: 'M42' });
    expect(r).toEqual({ externalEventId: 'M42', eventType: 'MESSAGE_CREATE' });
    expect(r).not.toHaveProperty('externalWorkspaceId');
  });

  it('returns null when the relayed message carries no id', () => {
    expect(observer.route({ t: 'TYPING_START', d: { guild_id: 'G1' } })).toBeNull();
  });
});

describe('RealDiscordObserver.normalize', () => {
  it('maps a message with mentioned users to a mention event (thread entity + participants + detail)', () => {
    const payload = {
      t: 'MESSAGE_CREATE',
      d: {
        id: 'M1',
        channel_id: 'C1',
        guild_id: 'G1',
        content: 'hey @dani',
        timestamp: '2026-06-30T11:59:00.000Z',
        author: { id: 'U9', username: 'willie' },
        mentions: [{ id: 'U2', username: 'dani' }],
      },
      mentioned_user_ids: ['U2'],
    };
    const [draft] = observer.normalize({
      eventType: 'MESSAGE_CREATE',
      payload,
      receivedAt: RECEIVED_AT,
    });
    expect(draft?.kind).toBe('mention');
    expect(draft?.summary).toBe('hey @dani');
    expect(draft?.occurredAt).toBe('2026-06-30T11:59:00.000Z');
    expect(draft?.actor?.externalId).toBe('U9');
    expect(draft?.entity).toEqual({ kind: 'thread', externalId: 'C1' });
    expect(draft?.participants).toEqual([{ externalId: 'U2', displayName: 'dani' }]);
    expect(draft?.detail).toEqual({
      schema: 'discord.message',
      channelId: 'C1',
      guildId: 'G1',
      text: 'hey @dani',
    });
  });

  it('maps a message with no mentions to a plain message-kind event', () => {
    const [draft] = observer.normalize({
      eventType: 'MESSAGE_CREATE',
      payload: { t: 'MESSAGE_CREATE', d: { id: 'M2', channel_id: 'C1', content: 'hello' } },
      receivedAt: RECEIVED_AT,
    });
    expect(draft?.kind).toBe('message');
    expect(draft?.participants).toEqual([]);
    expect(draft?.detail).toEqual({
      schema: 'discord.message',
      channelId: 'C1',
      guildId: null,
      text: 'hello',
    });
  });

  it('returns [] for a PING payload with no message', () => {
    expect(
      observer.normalize({ eventType: 'PING', payload: { type: 1 }, receivedAt: RECEIVED_AT }),
    ).toEqual([]);
  });

  it('falls back to a generic detail (keeping the summary) when the message carries no channel', () => {
    const [draft] = observer.normalize({
      eventType: 'MESSAGE_CREATE',
      payload: { d: { id: 'M10', content: 'no channel field at all' } },
      receivedAt: RECEIVED_AT,
    });
    expect(draft?.entity).toBeUndefined();
    expect(draft?.summary).toBe('no channel field at all');
    expect(draft?.detail).toEqual({
      schema: 'generic',
      title: 'New Discord message',
      summary: 'no channel field at all',
      url: null,
    });
  });

  it('falls back to a generic detail with no summary when the message carries no channel or content', () => {
    const [draft] = observer.normalize({
      eventType: 'MESSAGE_CREATE',
      payload: { d: { id: 'M11' } },
      receivedAt: RECEIVED_AT,
    });
    expect(draft).not.toHaveProperty('summary');
    expect(draft?.entity).toBeUndefined();
    expect(draft?.detail).toEqual({
      schema: 'generic',
      title: 'New Discord message',
      summary: null,
      url: null,
    });
  });

  it('resolves the channel from the legacy `channel` field when `channel_id` is absent', () => {
    const [draft] = observer.normalize({
      eventType: 'MESSAGE_CREATE',
      payload: { d: { id: 'M12', channel: 'CHAN99', content: 'via legacy field' } },
      receivedAt: RECEIVED_AT,
    });
    expect(draft?.entity).toEqual({ kind: 'thread', externalId: 'CHAN99' });
    expect(draft?.detail).toMatchObject({ channelId: 'CHAN99' });
  });

  it('falls back the dedupe key to the receivedAt timestamp when the message carries no id', () => {
    const [draft] = observer.normalize({
      eventType: 'MESSAGE_CREATE',
      payload: { d: { channel_id: 'C1', content: 'no id here' } },
      receivedAt: RECEIVED_AT,
    });
    expect(draft?.dedupeKey).toBe(`discord:${RECEIVED_AT}`);
  });

  it('omits the actor entirely when the author record carries no id', () => {
    const [draft] = observer.normalize({
      eventType: 'MESSAGE_CREATE',
      payload: {
        d: { id: 'M13', channel_id: 'C1', content: 'hi', author: { username: 'nouser' } },
      },
      receivedAt: RECEIVED_AT,
    });
    expect(draft).not.toHaveProperty('actor');
  });

  it('omits the display name when the author record carries no username/global_name', () => {
    const [draft] = observer.normalize({
      eventType: 'MESSAGE_CREATE',
      payload: { d: { id: 'M14', channel_id: 'C1', content: 'hi', author: { id: 'U8' } } },
      receivedAt: RECEIVED_AT,
    });
    expect(draft?.actor).toEqual({ externalId: 'U8' });
  });

  it("falls back to the message's own mentions[] when the relay did not expand mentioned_user_ids, tolerating entries with no id or no display name", () => {
    const [draft] = observer.normalize({
      eventType: 'MESSAGE_CREATE',
      payload: {
        d: {
          id: 'M15',
          channel_id: 'C1',
          content: 'ping people',
          mentions: [{ id: 'U5', username: 'has-name' }, { username: 'no-id' }, { id: 'U6' }],
        },
        // No `mentioned_user_ids` expansion field — forces the fallback to `d.mentions`.
      },
      receivedAt: RECEIVED_AT,
    });
    expect(draft?.kind).toBe('mention');
    expect(draft?.participants).toEqual([
      { externalId: 'U5', displayName: 'has-name' },
      { externalId: 'U6' },
    ]);
  });
});
