/**
 * The official Lattice SDK client: does it put the right bytes on the wire, and does it turn the
 * gateway's documented error codes into the right error classes.
 *
 * @remarks
 * These assertions are deliberately about the *wire*, not about Docket's own abstractions. They
 * keep the package boundary honest when Lovelace changes its implementation.
 */
import {
  LATTICE_GATEWAY_BASE_URL,
  LatticeClient,
  LatticeError,
  PersonalRuntimeRequiresUserTokenError,
  PersonalRuntimeUnreachableError,
  personalRuntimeTarget,
} from '@docket/integrations';
import { describe, expect, it, vi } from 'vitest';

/** One recorded outbound request. */
interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A fetch double that records the request and replays a scripted response. */
function recordingFetch(
  status: number,
  payload: unknown,
): { fetch: typeof globalThis.fetch; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;
  return { fetch: fetchImpl, calls };
}

describe('personalRuntimeTarget', () => {
  it('builds the gateway’s compatibility model selector', () => {
    expect(personalRuntimeTarget('lat_abc')).toEqual({
      latticeId: 'lat_abc',
      model: 'lattice:personal:lat_abc',
    });
  });

  it('trims a padded id rather than sending whitespace into a model selector', () => {
    expect(personalRuntimeTarget('  lat_abc  ').model).toBe('lattice:personal:lat_abc');
  });

  it('refuses a blank id instead of building `lattice:personal:`', () => {
    expect(() => personalRuntimeTarget('   ')).toThrow(LatticeError);
  });

  it('accepts an already-built target or a runtime resource, not just a bare id', () => {
    // listPersonalRuntimes hands back full resource records; callers must be able to feed one
    // straight back in without extracting the id themselves first.
    expect(
      personalRuntimeTarget({ latticeId: 'lat_xyz', model: 'lattice:personal:lat_stale' }),
    ).toEqual({ latticeId: 'lat_xyz', model: 'lattice:personal:lat_xyz' });
  });
});

describe('LatticeClient wire contract', () => {
  it('sends an OAuth token as a bearer header to the documented device route', async () => {
    const { fetch, calls } = recordingFetch(200, {
      id: 'chat_1',
      object: 'chat.completion',
      model: 'lattice:personal:lat_abc',
      choices: [{ index: 0, message: { role: 'assistant', content: 'hi' } }],
    });
    const client = new LatticeClient({
      credential: { kind: 'oauth', accessToken: 'tok_123' },
      baseUrl: 'https://gateway.test',
      fetch,
    });

    await client.chatCompleteForPersonalRuntime('lat_abc', {
      messages: [{ role: 'user', content: 'hello' }],
      maxTokens: 128,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://gateway.test/v1/chat/completions');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.headers['authorization']).toBe('Bearer tok_123');
    // `maxTokens` must reach the gateway snake_cased, or the device silently uses its own ceiling.
    expect(calls[0]?.body).toEqual({
      messages: [{ role: 'user', content: 'hello' }],
      model: 'lattice:personal:lat_abc',
      max_tokens: 128,
    });
  });

  it('sends a developer key as x-api-key, never as a bearer token', async () => {
    const { fetch, calls } = recordingFetch(200, { runtimes: [] });
    const client = new LatticeClient({
      credential: { kind: 'apiKey', apiKey: 'lv_live_x' },
      baseUrl: 'https://gateway.test',
      fetch,
    });

    await client.listPersonalRuntimes();

    expect(calls[0]?.url).toBe('https://gateway.test/v1/personal-runtimes');
    expect(calls[0]?.headers['x-api-key']).toBe('lv_live_x');
    expect(calls[0]?.headers['authorization']).toBeUndefined();
  });

  it('defaults to the production gateway when no base URL is given', async () => {
    const { fetch, calls } = recordingFetch(200, { runtimes: [] });
    await new LatticeClient({
      credential: { kind: 'oauth', accessToken: 't' },
      fetch,
    }).listPersonalRuntimes();
    expect(calls[0]?.url).toBe(`${LATTICE_GATEWAY_BASE_URL}/v1/personal-runtimes`);
  });

  it('refuses device dispatch on a developer key before any network call', async () => {
    const { fetch, calls } = recordingFetch(200, {});
    const client = new LatticeClient({
      credential: { kind: 'apiKey', apiKey: 'lv_live_x' },
      fetch,
    });

    await expect(
      client.chatCompleteForPersonalRuntime('lat_abc', {
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).rejects.toBeInstanceOf(PersonalRuntimeRequiresUserTokenError);
    // The point of the client-side guard: nothing was sent.
    expect(calls).toHaveLength(0);
  });

  it('maps a 409 runtime_unreachable onto its own terminal error class', async () => {
    const { fetch } = recordingFetch(409, {
      error: 'runtime_unreachable',
      message: 'daemon has not polled since 2026-08-02T00:00:00Z',
    });
    const client = new LatticeClient({
      credential: { kind: 'oauth', accessToken: 't' },
      fetch,
    });

    await expect(
      client.chatCompleteForPersonalRuntime('lat_abc', {
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).rejects.toBeInstanceOf(PersonalRuntimeUnreachableError);
  });

  it('keeps the gateway’s stable code and never invents one from the message', async () => {
    const { fetch } = recordingFetch(403, {
      error: 'insufficient_scopes',
      message: 'grant is missing lattice:compute:inference',
    });
    const client = new LatticeClient({ credential: { kind: 'oauth', accessToken: 't' }, fetch });

    await expect(client.listPersonalRuntimes()).rejects.toMatchObject({
      code: 'insufficient_scopes',
      status: 403,
    });
  });

  it('reports a transport failure as code transport_error with status 0', async () => {
    const failing = (async () => {
      throw new Error('getaddrinfo ENOTFOUND lattice.uselovelace.com');
    }) as typeof globalThis.fetch;
    const client = new LatticeClient({
      credential: { kind: 'oauth', accessToken: 't' },
      fetch: failing,
    });

    await expect(client.listPersonalRuntimes()).rejects.toMatchObject({
      code: 'transport_error',
      status: 0,
    });
  });

  it('sends a canonical model id straight through, not just a personal-runtime target', async () => {
    const { fetch, calls } = recordingFetch(200, {
      id: 'chat_1',
      object: 'chat.completion',
      model: 'gpt-4o',
      choices: [{ index: 0, message: { role: 'assistant', content: 'hi' } }],
    });
    const client = new LatticeClient({ credential: { kind: 'oauth', accessToken: 't' }, fetch });

    await client.chatComplete({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] });

    expect(calls[0]?.body).toMatchObject({ model: 'gpt-4o' });
  });

  it('sends the idempotency key header when the caller supplies one', async () => {
    const { fetch, calls } = recordingFetch(200, {
      id: 'chat_1',
      object: 'chat.completion',
      model: 'lattice:personal:lat_abc',
      choices: [{ index: 0, message: { role: 'assistant', content: 'hi' } }],
    });
    const client = new LatticeClient({ credential: { kind: 'oauth', accessToken: 't' }, fetch });

    await client.chatCompleteForPersonalRuntime('lat_abc', {
      messages: [{ role: 'user', content: 'hi' }],
      idempotencyKey: 'idem-key-1',
    });

    expect(calls[0]?.headers['idempotency-key']).toBe('idem-key-1');
  });

  it('falls back to the platform fetch when no transport is injected', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ runtimes: [] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      const client = new LatticeClient({
        credential: { kind: 'oauth', accessToken: 't' },
        baseUrl: 'https://gateway.test',
      });
      await client.listPersonalRuntimes();
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('treats an empty error body as an HTTP-coded failure without inventing a message', async () => {
    const fetch = (async () => new Response('', { status: 502 })) as typeof globalThis.fetch;
    const client = new LatticeClient({ credential: { kind: 'oauth', accessToken: 't' }, fetch });

    await expect(client.listPersonalRuntimes()).rejects.toMatchObject({
      code: 'http_502',
      status: 502,
      message: 'Gateway returned HTTP 502',
    });
  });

  it('treats a non-JSON error body (e.g. an HTML error page) the same as an empty one', async () => {
    const fetch = (async () =>
      new Response('<html><body>502 Bad Gateway</body></html>', {
        status: 502,
        headers: { 'content-type': 'text/html' },
      })) as typeof globalThis.fetch;
    const client = new LatticeClient({ credential: { kind: 'oauth', accessToken: 't' }, fetch });

    await expect(client.listPersonalRuntimes()).rejects.toMatchObject({
      code: 'http_502',
      status: 502,
    });
  });

  it('reports fetch failed when the transport throws something that is not an Error', async () => {
    const failing = (async () => {
      // Exercises the non-Error fallback path, which requires throwing something that isn't one.
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw { code: 'ECONNRESET' };
    }) as typeof globalThis.fetch;
    const client = new LatticeClient({
      credential: { kind: 'oauth', accessToken: 't' },
      fetch: failing,
    });

    await expect(client.listPersonalRuntimes()).rejects.toMatchObject({
      code: 'transport_error',
      message: 'fetch failed',
    });
  });

  it('aborts the request once it outlasts the configured timeout', async () => {
    const hangingFetch = ((_input: string | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new Error('The operation was aborted'));
        });
      })) as typeof globalThis.fetch;
    const client = new LatticeClient({
      credential: { kind: 'oauth', accessToken: 't' },
      fetch: hangingFetch,
      timeoutMs: 5,
    });

    await expect(client.listPersonalRuntimes()).rejects.toMatchObject({
      code: 'transport_error',
      message: 'The operation was aborted',
    });
  });

  it('filters reachable devices without a second gateway round trip', async () => {
    const { fetch, calls } = recordingFetch(200, {
      runtimes: [
        {
          latticeId: 'lat_a',
          accountId: 'acct_1',
          displayName: 'Studio',
          executionBackend: 'local-model',
          status: 'reachable',
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-01T00:00:00.000Z',
        },
        {
          latticeId: 'lat_b',
          accountId: 'acct_1',
          displayName: 'Laptop',
          executionBackend: 'local-model',
          status: 'offline',
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-01T00:00:00.000Z',
        },
      ],
    });
    const client = new LatticeClient({ credential: { kind: 'oauth', accessToken: 't' }, fetch });

    const reachable = await client.listReachablePersonalRuntimes();

    expect(reachable.map((r) => r.latticeId)).toEqual(['lat_a']);
    expect(calls).toHaveLength(1);
  });
});
