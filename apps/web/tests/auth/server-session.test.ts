/**
 * The server-side session read's full mapping.
 *
 * @remarks
 * Every case here is a decision the entry gate acts on, and two of them are the difference between
 * a working app and one that shoves a sign-in screen at a valid session: a 500 and a thrown fetch
 * must both report `'unknown'`, never `'signed-out'`. The one property that must hold across every
 * malformed input is that nothing is ever reported as `'authenticated'` on evidence the guard did
 * not actually verify.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ReactModule from 'react';

const { cookiesMock, headersMock } = vi.hoisted(() => ({
  cookiesMock: vi.fn(),
  headersMock: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: cookiesMock,
  headers: headersMock,
}));

// React's `cache()` is a no-op outside a request scope in this environment, but pinning it to
// identity keeps the test measuring the mapping rather than React's memoisation.
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof ReactModule>('react');
  return { ...actual, cache: <T>(fn: T): T => fn };
});

import { readServerSession, safeServerReturnPath } from '../../src/lib/server-session';

/** A `headers()` stand-in exposing only the `get` the module uses. */
function headerStore(entries: Record<string, string>): { get: (name: string) => string | null } {
  return { get: (name: string) => entries[name] ?? null };
}

/** A `Response`-like stub with the `ok`/`json()` surface the module reads. */
function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  cookiesMock.mockReset();
  headersMock.mockReset();
  cookiesMock.mockResolvedValue({ toString: () => 'better-auth.session_token=abc' });
  headersMock.mockResolvedValue(
    headerStore({ 'x-forwarded-host': 'app.example', 'x-forwarded-proto': 'https' }),
  );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('readServerSession', () => {
  it('maps a 200 with a user to authenticated, with the display fields the shell needs', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        session: { id: 'sess_1' },
        user: {
          id: 'user_1',
          name: 'Ada Lovelace',
          email: 'ada@example.com',
          image: 'https://cdn.example/ada.png',
        },
      }),
    );

    await expect(readServerSession()).resolves.toEqual({
      state: 'authenticated',
      user: {
        userId: 'user_1',
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        image: 'https://cdn.example/ada.png',
      },
    });
  });

  it('normalizes a missing avatar to null rather than undefined', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { user: { id: 'user_1', name: 'Ada', email: 'ada@example.com' } }),
    );

    const result = await readServerSession();

    expect(result).toEqual({
      state: 'authenticated',
      user: { userId: 'user_1', name: 'Ada', email: 'ada@example.com', image: null },
    });
  });

  it('forwards the caller cookie to the same-origin auth endpoint', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, null));

    await readServerSession();

    expect(fetchMock).toHaveBeenCalledWith('https://app.example/api/auth/get-session', {
      headers: { cookie: 'better-auth.session_token=abc' },
      cache: 'no-store',
    });
  });

  it('maps a 200 with a null body to signed-out — the answer Better Auth gives for no session', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, null));

    await expect(readServerSession()).resolves.toEqual({ state: 'signed-out' });
  });

  it('maps a 500 to unknown, because an outage is not an answer about the session', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { error: 'boom' }));

    await expect(readServerSession()).resolves.toEqual({ state: 'unknown' });
  });

  it('maps a thrown fetch to unknown', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(readServerSession()).resolves.toEqual({ state: 'unknown' });
  });

  it('maps an unparseable body to unknown', async () => {
    // A proxy's HTML error page arrives with a 200 and blows up in `json()`. That is evidence the
    // transport misbehaved, not evidence about the session, so it must not read as signed-out.
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async (): Promise<never> => {
        throw new SyntaxError('Unexpected token < in JSON');
      },
    });

    await expect(readServerSession()).resolves.toEqual({ state: 'unknown' });
  });

  it('never reports authenticated for a body whose user is malformed', async () => {
    const malformed = [
      { user: null },
      { user: 42 },
      { user: {} },
      { user: { id: '', name: 'Ada', email: 'ada@example.com' } },
      { user: { id: 'user_1', email: 'ada@example.com' } },
      { user: { id: 'user_1', name: 'Ada' } },
      { session: { id: 'sess_1' } },
      'not-an-object',
      [],
    ];

    for (const body of malformed) {
      fetchMock.mockResolvedValue(jsonResponse(200, body));
      // A parseable body that carries no usable identity is the same fact as `null`: no session.
      await expect(readServerSession()).resolves.toEqual({ state: 'signed-out' });
    }
  });

  it('reports unknown when the request carries no host to call back on', async () => {
    headersMock.mockResolvedValue(headerStore({}));

    await expect(readServerSession()).resolves.toEqual({ state: 'unknown' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to the Host header and https when nothing is forwarded', async () => {
    headersMock.mockResolvedValue(headerStore({ host: 'docket.example' }));
    fetchMock.mockResolvedValue(jsonResponse(200, null));

    await readServerSession();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://docket.example/api/auth/get-session',
      expect.anything(),
    );
  });
});

describe('safeServerReturnPath', () => {
  it('keeps a same-origin path, including its query and hash', () => {
    expect(safeServerReturnPath('/settings/athena?mcp=connected')).toBe(
      '/settings/athena?mcp=connected',
    );
    expect(safeServerReturnPath('/tasks#t_1')).toBe('/tasks#t_1');
  });

  it('rejects anything that carries an origin of its own', () => {
    for (const value of [
      '//evil.example',
      'https://evil.example/x',
      '\\\\evil.example',
      '/\\evil.example',
      'javascript:alert(1)',
    ]) {
      expect(safeServerReturnPath(value)).toBeNull();
    }
  });

  it('rejects an absent value', () => {
    expect(safeServerReturnPath(null)).toBeNull();
    expect(safeServerReturnPath(undefined)).toBeNull();
    expect(safeServerReturnPath('')).toBeNull();
  });
});
