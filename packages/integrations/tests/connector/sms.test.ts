/**
 * The SMS sender port: `CaptureSmsSender` (in-memory, asserted against in tests),
 * `smsConfigFromEnv` (env parsing), and `RealSmsSender` (real HTTP provider, driven through an
 * injected fake so no network is touched).
 */
import { describe, expect, it } from 'vitest';

import { CaptureSmsSender, RealSmsSender, smsConfigFromEnv } from '../../src/sms';
import type { HttpClient } from '../../src/http';
import { assertDefined } from '@docket/test-utils';

describe('CaptureSmsSender', () => {
  it('starts with an empty outbox and no last message', () => {
    const sender = new CaptureSmsSender();
    expect(sender.outbox).toEqual([]);
    expect(sender.last()).toBeUndefined();
  });

  it('captures a sent SMS with a stable zero-padded id and the fixed default now', async () => {
    const sender = new CaptureSmsSender();
    await sender.send({ to: '+15551234567', body: 'Hi' });
    expect(sender.outbox).toEqual([
      {
        to: '+15551234567',
        body: 'Hi',
        id: 'sms_000001',
        sentAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    expect(sender.last()).toEqual(sender.outbox[0]);
  });

  it('increments the id counter across sends and honors a configured now', async () => {
    const sender = new CaptureSmsSender({ now: '2026-03-14T00:00:00.000Z' });
    await sender.send({ to: '+1', body: 'One' });
    await sender.send({ to: '+2', body: 'Two' });
    expect(sender.outbox.map((m) => m.id)).toEqual(['sms_000001', 'sms_000002']);
    expect(sender.last()?.body).toBe('Two');
  });
});

describe('smsConfigFromEnv', () => {
  it('returns null when any of the three env values is absent', () => {
    expect(smsConfigFromEnv({})).toBeNull();
    expect(smsConfigFromEnv({ SMS_ENDPOINT: 'https://x' })).toBeNull();
    expect(smsConfigFromEnv({ SMS_ENDPOINT: 'https://x', SMS_API_KEY: 'k' })).toBeNull();
  });

  it('parses a complete config', () => {
    expect(
      smsConfigFromEnv({
        SMS_ENDPOINT: 'https://sms.example.com/send',
        SMS_API_KEY: 'k_1',
        SMS_FROM: '+15550000000',
      }),
    ).toEqual({
      endpoint: 'https://sms.example.com/send',
      apiKey: 'k_1',
      from: '+15550000000',
    });
  });
});

describe('RealSmsSender', () => {
  const config = {
    endpoint: 'https://sms.example.com/send',
    apiKey: 'k_1',
    from: '+15550000000',
  };

  it('posts the from + message with bearer authentication and returns the provider id', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const http: HttpClient = async (url, init) => {
      calls.push({ url, ...(init ? { init } : {}) });
      return new Response(JSON.stringify({ id: 'sms-provider-1' }), { status: 200 });
    };
    const sender = new RealSmsSender(config, http);
    const result = await sender.send({ to: '+15551234567', body: 'Code: 123456' });

    expect(calls).toHaveLength(1);
    expect(assertDefined(calls[0]).url).toBe(config.endpoint);
    expect((assertDefined(calls[0]).init?.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer k_1',
    );
    expect(JSON.parse(assertDefined(calls[0]).init?.body as string)).toEqual({
      from: '+15550000000',
      to: '+15551234567',
      body: 'Code: 123456',
    });
    expect(result.id).toBe('sms-provider-1');
    expect(result.sentAt).toMatch(/Z$/);
  });

  it('falls back to a status-derived id when the provider omits one', async () => {
    const http: HttpClient = async () => new Response('{}', { status: 200 });
    const sender = new RealSmsSender(config, http);
    const result = await sender.send({ to: '+1', body: 'T' });
    expect(result.id).toBe('sms_200');
  });

  it('throws a plain error carrying the status on a non-ok response', async () => {
    const http: HttpClient = async () => new Response('boom', { status: 503 });
    const sender = new RealSmsSender(config, http);
    await expect(sender.send({ to: '+1', body: 'T' })).rejects.toThrow(
      /RealSmsSender send failed: 503/,
    );
  });
});
