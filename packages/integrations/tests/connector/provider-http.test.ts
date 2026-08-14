/**
 * Direct unit tests for {@link ProviderHttp} — the shared authenticated-request wrapper every
 * real provider client is built on. `real-connector.test.ts` exercises it incidentally through
 * each provider; this file drives it directly so every response-shape edge (missing/invalid
 * `Retry-After`, an unreadable error body, empty/204 success bodies, `PATCH`/`DELETE`, and the
 * `raw` auth mode) is proven rather than assumed.
 */
import { describe, expect, it } from 'vitest';

import { ProviderHttp } from '../../src/provider-http';
import type { HttpClient } from '../../src/http';
import { assertDefined } from '@docket/test-utils';

describe('ProviderHttp — Retry-After parsing on 429', () => {
  it('leaves retryAfterSeconds undefined when the header is absent', async () => {
    const http: HttpClient = async () => new Response('slow down', { status: 429 });
    const client = new ProviderHttp('github', 'https://api.github.com', 'tok', http);
    const err = await client.getJson('/x').catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: 'rate_limit', retryAfterSeconds: undefined });
  });

  it.each(['abc', '-5'])(
    'leaves retryAfterSeconds undefined for an invalid value (%s)',
    async (raw) => {
      const http: HttpClient = async () =>
        new Response('slow down', { status: 429, headers: { 'retry-after': raw } });
      const client = new ProviderHttp('github', 'https://api.github.com', 'tok', http);
      const err = await client.getJson('/x').catch((e: unknown) => e);
      expect(err).toMatchObject({ kind: 'rate_limit', retryAfterSeconds: undefined });
    },
  );
});

describe('ProviderHttp — error body reading', () => {
  it('falls back to an empty snippet when reading the error body throws', async () => {
    const broken = {
      ok: false,
      status: 500,
      headers: new Headers(),
      text: () => Promise.reject(new Error('stream already consumed')),
    } as unknown as Response;
    const http: HttpClient = async () => broken;
    const client = new ProviderHttp('github', 'https://api.github.com', 'tok', http);
    await expect(client.getJson('/x')).rejects.toThrow(/github API GET \/x failed: 500$/);
  });
});

describe('ProviderHttp — success body shapes', () => {
  it('resolves undefined for a 204 No Content', async () => {
    const http: HttpClient = async () => new Response(null, { status: 204 });
    const client = new ProviderHttp('gtasks', 'https://tasks.googleapis.com/tasks/v1', 'tok', http);
    await expect(client.getJson('/x')).resolves.toBeUndefined();
  });

  it('resolves undefined for a 200 with an empty body', async () => {
    const http: HttpClient = async () => new Response('', { status: 200 });
    const client = new ProviderHttp('github', 'https://api.github.com', 'tok', http);
    await expect(client.getJson('/x')).resolves.toBeUndefined();
  });
});

describe('ProviderHttp — PATCH', () => {
  it('sends a bearer-authenticated JSON PATCH and parses the response', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const http: HttpClient = async (url, init) => {
      calls.push({ url, ...(init ? { init } : {}) });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const client = new ProviderHttp(
      'gtasks',
      'https://tasks.googleapis.com/tasks/v1',
      'g_tok',
      http,
    );
    const result = await client.patchJson('/lists/l1/tasks/t1', { title: 'Renamed' });
    expect(result).toEqual({ ok: true });
    expect(assertDefined(calls[0]).init?.method).toBe('PATCH');
    expect((assertDefined(calls[0]).init?.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer g_tok',
    );
    expect(JSON.parse(assertDefined(calls[0]).init?.body as string)).toEqual({ title: 'Renamed' });
  });
});

describe('ProviderHttp — DELETE', () => {
  it('sends a bearer-authenticated DELETE and resolves cleanly on 204', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const http: HttpClient = async (url, init) => {
      calls.push({ url, ...(init ? { init } : {}) });
      return new Response(null, { status: 204 });
    };
    const client = new ProviderHttp(
      'gtasks',
      'https://tasks.googleapis.com/tasks/v1',
      'g_tok',
      http,
    );
    await expect(client.deleteVoid('/lists/l1/tasks/t1')).resolves.toBeUndefined();
    expect(assertDefined(calls[0]).init?.method).toBe('DELETE');
    expect(assertDefined(calls[0]).init?.body).toBeUndefined();
    expect((assertDefined(calls[0]).init?.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer g_tok',
    );
  });
});

describe('ProviderHttp — POST auth modes', () => {
  it('sends the token verbatim (no Bearer prefix) in raw auth mode', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const http: HttpClient = async (url, init) => {
      calls.push({ url, ...(init ? { init } : {}) });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const client = new ProviderHttp('notion', 'https://api.notion.com/v1', 'secret_raw', http);
    await client.postJson('/pages', { title: 'X' }, 'raw');
    expect((assertDefined(calls[0]).init?.headers as Record<string, string>)['Authorization']).toBe(
      'secret_raw',
    );
  });
});
