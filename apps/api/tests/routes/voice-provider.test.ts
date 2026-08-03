/**
 * `@docket/api` — the realtime speech seam: local/test double vs. the real OpenAI adapter.
 *
 * @remarks
 * The whole point of this module is that a developer's stray `OPENAI_API_KEY` can never turn a
 * test run into a billed call, and that a real provider failure never leaks the provider's own
 * response text. These tests exist to hold both of those.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  CLIENT_SECRET_TTL_SECONDS,
  DEFAULT_REALTIME_MODEL,
  DEFAULT_REALTIME_VOICE,
  MockRealtimeProvider,
  OpenAiRealtimeProvider,
  resolveVoiceProvider,
  voiceLocalMode,
  VoiceProviderUnavailableError,
} from '../../src/routes/voice-provider';

const INPUT = {
  instructions: 'You are Athena.',
  tools: [],
  greeting: 'Hi, this is Athena.',
};

describe('voiceLocalMode', () => {
  it('is true for local and test app modes', () => {
    expect(voiceLocalMode({ APP_MODE: 'local' })).toBe(true);
    expect(voiceLocalMode({ APP_MODE: 'test' })).toBe(true);
  });

  it('is false for production and an unset app mode', () => {
    expect(voiceLocalMode({ APP_MODE: 'production' })).toBe(false);
    expect(voiceLocalMode({})).toBe(false);
  });
});

describe('MockRealtimeProvider', () => {
  it('mints a mock-transport credential that never opens a real audio link', async () => {
    const now = () => new Date('2026-08-02T12:00:00.000Z');
    const provider = new MockRealtimeProvider(now);
    const credential = await provider.issueClientSession(INPUT);
    expect(credential).toMatchObject({
      transport: 'mock',
      provider: 'mock',
      clientSecret: 'mock-no-credential-required',
    });
    expect(credential.expiresAt).toBe(
      new Date(now().getTime() + CLIENT_SECRET_TTL_SECONDS * 1000).toISOString(),
    );
  });

  it('defaults to the real clock when none is injected', async () => {
    const provider = new MockRealtimeProvider();
    const before = Date.now();
    const credential = await provider.issueClientSession(INPUT);
    const expiresAt = new Date(credential.expiresAt).getTime();
    expect(expiresAt).toBeGreaterThan(before);
  });
});

describe('resolveVoiceProvider', () => {
  it('always uses the mock in local/test mode, even with an API key present', () => {
    const local = resolveVoiceProvider({ APP_MODE: 'local', OPENAI_API_KEY: 'sk-real' });
    expect(local).toBeInstanceOf(MockRealtimeProvider);
    const test = resolveVoiceProvider({ APP_MODE: 'test', OPENAI_API_KEY: 'sk-real' });
    expect(test).toBeInstanceOf(MockRealtimeProvider);
  });

  it('refuses to boot in production with no configured key', () => {
    expect(() => resolveVoiceProvider({ APP_MODE: 'production' })).toThrow(
      'Missing required production voice config: OPENAI_API_KEY',
    );
  });

  it('builds the real adapter in production when a key is configured', () => {
    const provider = resolveVoiceProvider({
      APP_MODE: 'production',
      OPENAI_API_KEY: 'sk-real',
      VOICE_REALTIME_MODEL: 'gpt-realtime-custom',
      VOICE_REALTIME_VOICE: 'sage',
    });
    expect(provider).toBeInstanceOf(OpenAiRealtimeProvider);
    expect(provider.id).toBe('openai-realtime');
  });

  it('falls back to the default model and voice when none is configured', () => {
    const provider = resolveVoiceProvider({ APP_MODE: 'production', OPENAI_API_KEY: 'sk-real' });
    expect(provider).toBeInstanceOf(OpenAiRealtimeProvider);
  });
});

describe('OpenAiRealtimeProvider', () => {
  it('mints a webrtc credential from a successful client-secret response', async () => {
    const fetchImpl = vi.fn(
      async (_url: string | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ value: 'ek_test_123', expires_at: 1_800_000_000 }), {
          status: 200,
        }),
    );
    const provider = new OpenAiRealtimeProvider(
      'sk-test',
      DEFAULT_REALTIME_MODEL,
      DEFAULT_REALTIME_VOICE,
      fetchImpl as unknown as typeof fetch,
    );

    const credential = await provider.issueClientSession(INPUT);
    expect(credential).toMatchObject({
      transport: 'webrtc',
      provider: 'openai-realtime',
      model: DEFAULT_REALTIME_MODEL,
      clientSecret: 'ek_test_123',
      expiresAt: new Date(1_800_000_000 * 1000).toISOString(),
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/realtime/client_secrets');
    expect(init!.headers).toMatchObject({ authorization: 'Bearer sk-test' });
  });

  it('falls back to a computed expiry when the provider omits expires_at', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ value: 'ek_no_expiry' }), { status: 200 }),
    );
    const provider = new OpenAiRealtimeProvider(
      'sk-test',
      DEFAULT_REALTIME_MODEL,
      DEFAULT_REALTIME_VOICE,
      fetchImpl,
    );
    const before = Date.now();
    const credential = await provider.issueClientSession(INPUT);
    expect(new Date(credential.expiresAt).getTime()).toBeGreaterThan(before);
  });

  it('reports the provider as unavailable on a non-OK response, never leaking its body', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'rate_limited: secret internals' }), {
          status: 429,
        }),
    );
    const provider = new OpenAiRealtimeProvider(
      'sk-test',
      DEFAULT_REALTIME_MODEL,
      DEFAULT_REALTIME_VOICE,
      fetchImpl,
    );
    await expect(provider.issueClientSession(INPUT)).rejects.toThrow(VoiceProviderUnavailableError);
    try {
      await provider.issueClientSession(INPUT);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(VoiceProviderUnavailableError);
      expect((error as VoiceProviderUnavailableError).status).toBe(429);
      expect((error as Error).message).not.toContain('secret internals');
    }
  });

  it('reports the provider as unavailable when the response carries no usable secret', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ value: '' }), { status: 200 }),
    );
    const provider = new OpenAiRealtimeProvider(
      'sk-test',
      DEFAULT_REALTIME_MODEL,
      DEFAULT_REALTIME_VOICE,
      fetchImpl,
    );
    await expect(provider.issueClientSession(INPUT)).rejects.toThrow(VoiceProviderUnavailableError);
  });
});
