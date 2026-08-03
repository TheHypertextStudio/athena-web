/**
 * The push-notification sender port: `CapturePushSender` (in-memory, asserted against in
 * tests), `pushConfigFromEnv` (env parsing), and `RealPushSender` (real HTTP provider, driven
 * through an injected fake so no network is touched).
 */
import { describe, expect, it } from 'vitest';

import {
  CapturePushSender,
  PushSendError,
  RealPushSender,
  pushConfigFromEnv,
} from '../../src/push';
import type { HttpClient } from '../../src/http';

describe('CapturePushSender', () => {
  it('starts with an empty outbox and no last message', () => {
    const sender = new CapturePushSender();
    expect(sender.outbox).toEqual([]);
    expect(sender.last()).toBeUndefined();
  });

  it('captures a sent push with a stable zero-padded id and the fixed default now', async () => {
    const sender = new CapturePushSender();
    await sender.send({ token: 'tok_1', title: 'Hi' });
    expect(sender.outbox).toEqual([
      { token: 'tok_1', title: 'Hi', id: 'push_000001', sentAt: '2026-01-01T00:00:00.000Z' },
    ]);
    expect(sender.last()).toEqual(sender.outbox[0]);
  });

  it('increments the id counter across sends and honors a configured now', async () => {
    const sender = new CapturePushSender({ now: '2026-03-14T00:00:00.000Z' });
    await sender.send({ token: 't1', title: 'One' });
    await sender.send({ token: 't2', title: 'Two', body: 'body', data: { k: 'v' } });
    expect(sender.outbox.map((m) => m.id)).toEqual(['push_000001', 'push_000002']);
    expect(sender.last()).toMatchObject({ title: 'Two', body: 'body', data: { k: 'v' } });
  });

  it('throws a typed invalid_token error for a configured invalid token, without capturing it', async () => {
    const sender = new CapturePushSender({ invalidTokens: new Set(['bad_tok']) });
    await expect(sender.send({ token: 'bad_tok', title: 'Hi' })).rejects.toMatchObject({
      code: 'invalid_token',
    });
    expect(sender.outbox).toEqual([]);
  });
});

describe('pushConfigFromEnv', () => {
  it('returns null when any of the three env values is absent', () => {
    expect(pushConfigFromEnv({})).toBeNull();
    expect(pushConfigFromEnv({ PUSH_ENDPOINT: 'https://x' })).toBeNull();
    expect(pushConfigFromEnv({ PUSH_ENDPOINT: 'https://x', PUSH_API_KEY: 'k' })).toBeNull();
  });

  it('parses a complete config', () => {
    expect(
      pushConfigFromEnv({
        PUSH_ENDPOINT: 'https://push.example.com/send',
        PUSH_API_KEY: 'k_1',
        PUSH_APP_ID: 'app_1',
      }),
    ).toEqual({
      endpoint: 'https://push.example.com/send',
      apiKey: 'k_1',
      appId: 'app_1',
    });
  });
});

describe('RealPushSender', () => {
  const config = { endpoint: 'https://push.example.com/send', apiKey: 'k_1', appId: 'app_1' };

  it('posts the appId + message with bearer authentication and returns the provider id', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const http: HttpClient = async (url, init) => {
      calls.push({ url, ...(init ? { init } : {}) });
      return new Response(JSON.stringify({ id: 'msg-provider-1' }), { status: 200 });
    };
    const sender = new RealPushSender(config, http);
    const result = await sender.send({ token: 'device_tok', title: 'Hello' });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(config.endpoint);
    expect(calls[0]!.init?.method).toBe('POST');
    expect((calls[0]!.init?.headers as Record<string, string>)['Authorization']).toBe('Bearer k_1');
    expect(JSON.parse(calls[0]!.init?.body as string)).toEqual({
      appId: 'app_1',
      token: 'device_tok',
      title: 'Hello',
    });
    expect(result.id).toBe('msg-provider-1');
    expect(result.sentAt).toMatch(/Z$/);
  });

  it('falls back to a status-derived id when the provider omits one', async () => {
    const http: HttpClient = async () => new Response('{}', { status: 200 });
    const sender = new RealPushSender(config, http);
    const result = await sender.send({ token: 't', title: 'T' });
    expect(result.id).toBe('push_200');
  });

  it('throws invalid_token on a 410 Gone', async () => {
    const http: HttpClient = async () => new Response('gone', { status: 410 });
    const sender = new RealPushSender(config, http);
    await expect(sender.send({ token: 't', title: 'T' })).rejects.toMatchObject({
      code: 'invalid_token',
    });
  });

  it('throws invalid_token when the provider reports an invalid_token code at any status', async () => {
    const http: HttpClient = async () =>
      new Response(JSON.stringify({ error: 'invalid_token' }), { status: 400 });
    const sender = new RealPushSender(config, http);
    const err = await sender.send({ token: 't', title: 'T' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PushSendError);
    expect((err as PushSendError).code).toBe('invalid_token');
  });

  it('throws provider_error for any other non-ok status', async () => {
    const http: HttpClient = async () => new Response('boom', { status: 503 });
    const sender = new RealPushSender(config, http);
    await expect(sender.send({ token: 't', title: 'T' })).rejects.toMatchObject({
      code: 'provider_error',
    });
  });
});
