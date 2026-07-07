import { generateKeyPairSync, sign as edSign } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { RealDiscordObserver } from '../src/observer-discord';

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
});

describe('RealDiscordObserver.route', () => {
  it('returns null for the type:1 PING handshake', () => {
    expect(observer.route({ type: 1 })).toBeNull();
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
});
