/**
 * The Google work-location transport's *default* HTTP path — the one production actually runs.
 *
 * @remarks
 * Every other test for this transport injects a `fetchJson` seam, which is the right way to test
 * request shaping but leaves the real implementation unexercised: bearer auth, when a
 * `content-type` is sent, how a non-2xx becomes a typed error, and how the empty bodies Google
 * returns for a delete are distinguished from JSON. Those are the lines that talk to Google, and
 * a mistake in any of them is only observable in production.
 *
 * These construct the transport with no seam and stub `globalThis.fetch`, so the assertions are
 * about the request that would really go out and the response handling that would really run.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createGoogleWorkLocationTransport,
  GoogleWorkLocationApiError,
} from '../../../src/services/work-location/google-transport';

/** One captured outbound request. */
interface Captured {
  url: string;
  init: RequestInit;
}

/**
 * Stub `fetch` with a scripted reply and capture what the transport sent.
 *
 * @param reply - How the stubbed endpoint answers.
 * @returns The capture buffer, filled as requests are made.
 */
function stubFetch(reply: { status: number; body?: string }): Captured[] {
  const captured: Captured[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    captured.push({ url: href, init: init ?? {} });
    // `Response` refuses any body for a 204, including an empty string.
    const bodyless = reply.status === 204 || reply.status === 205 || reply.status === 304;
    return new Response(bodyless ? null : (reply.body ?? ''), { status: reply.status });
  });
  return captured;
}

/** A transport with no injected seam, so `defaultFetchJson` runs. */
function transport() {
  return createGoogleWorkLocationTransport({
    getAccessToken: async () => ({ accessToken: 'tk-1' }),
  });
}

const PULL = {
  connectionId: 'conn-1',
  userId: 'user-1',
  externalAccountId: 'acct-1',
  cursor: null,
} as const;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('outbound request shape', () => {
  it('authenticates every call as a bearer token', async () => {
    const captured = stubFetch({ status: 200, body: JSON.stringify({ items: [] }) });
    await transport().pull(PULL);

    const headers = captured[0]?.init.headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer tk-1');
  });

  it('sends no content-type on a body-less request', async () => {
    // A GET that advertises a JSON body it does not have is the kind of thing a strict gateway
    // rejects, and nothing downstream would explain why.
    const captured = stubFetch({ status: 200, body: JSON.stringify({ items: [] }) });
    await transport().pull(PULL);

    const headers = captured[0]?.init.headers as Record<string, string>;
    expect(headers).not.toHaveProperty('content-type');
    expect(captured[0]?.init.body).toBeUndefined();
    expect(captured[0]?.init.method).toBe('GET');
  });

  it('serializes a body and declares its type when one is supplied', async () => {
    const captured = stubFetch({ status: 200, body: JSON.stringify({ id: 'evt-1' }) });
    await transport().upsert({
      connectionId: 'conn-1',
      userId: 'user-1',
      externalAccountId: 'acct-1',
      externalEventId: 'evt-1',
      externalEtag: null,
      body: { summary: 'Working from home' },
    });

    const headers = captured[0]?.init.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
    expect(captured[0]?.init.method).toBe('POST');
    const sent = captured[0]?.init.body;
    expect(typeof sent).toBe('string');
    expect(JSON.parse(typeof sent === 'string' ? sent : '{}')).toEqual({
      summary: 'Working from home',
    });
  });

  it('passes a caller-supplied header through alongside auth', async () => {
    const captured = stubFetch({ status: 200, body: JSON.stringify({ id: 'evt-1' }) });
    await transport().upsert({
      connectionId: 'conn-1',
      userId: 'user-1',
      externalAccountId: 'acct-1',
      externalEventId: 'evt-1',
      externalEtag: 'etag-9',
      body: { summary: 'Working from home' },
    });

    const headers = captured[0]?.init.headers as Record<string, string>;
    expect(headers['If-Match']).toBe('etag-9');
    expect(headers['authorization']).toBe('Bearer tk-1');
    expect(captured[0]?.init.method).toBe('PATCH');
  });
});

describe('response handling', () => {
  it('turns a non-2xx into a typed error carrying the status', async () => {
    // The status is load-bearing: the callers above branch on 409, 410, and 404 to decide whether
    // a failure is recoverable, so an untyped throw would collapse those paths into one.
    stubFetch({ status: 503 });
    await expect(transport().pull(PULL)).rejects.toBeInstanceOf(GoogleWorkLocationApiError);
  });

  it('preserves the status on the typed error', async () => {
    stubFetch({ status: 401 });
    await expect(transport().pull(PULL)).rejects.toMatchObject({ status: 401 });
  });

  it('treats 204 as a body-less success rather than parsing empty JSON', async () => {
    // Google answers a delete with 204; `JSON.parse('')` would throw and turn a clean delete into
    // an error the caller would retry forever.
    stubFetch({ status: 204 });
    await expect(
      transport().delete({
        connectionId: 'conn-1',
        userId: 'user-1',
        externalAccountId: 'acct-1',
        externalEventId: 'evt-1',
        externalEtag: null,
      }),
    ).resolves.toBeUndefined();
  });

  it('treats an empty 200 body as no content rather than a parse failure', async () => {
    stubFetch({ status: 200, body: '' });
    await expect(
      transport().delete({
        connectionId: 'conn-1',
        userId: 'user-1',
        externalAccountId: 'acct-1',
        externalEventId: 'evt-1',
        externalEtag: null,
      }),
    ).resolves.toBeUndefined();
  });

  it('parses a JSON body into the value the caller reads', async () => {
    stubFetch({
      status: 200,
      body: JSON.stringify({ items: [{ id: 'evt-1' }], nextSyncToken: 'cursor-2' }),
    });
    const result = await transport().pull(PULL);
    expect(result.nextCursor).toBe('cursor-2');
    expect(result.events).toHaveLength(1);
  });
});
