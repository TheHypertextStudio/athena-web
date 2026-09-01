/**
 * Tests for the Cloud Identity group-membership adapter.
 *
 * @remarks
 * Driven through an injected `fetch` rather than a network: the adapter's whole job is to turn
 * two HTTP responses into a list of group addresses, and the branches that matter are the
 * failure ones — a refused token or a refused lookup must THROW, because the sync treats a
 * throw as "unknown" and an empty array as "no groups, revoke".
 */
import { describe, expect, it, vi } from 'vitest';

import { createGoogleDirectory, staticGoogleDirectory } from '../src/google-directory';

/** A `fetch` stand-in returning canned responses in order. */
function fetchStub(...responses: readonly Response[]): typeof fetch {
  const queue = [...responses];
  return vi.fn(() => Promise.resolve(queue.shift() ?? new Response('', { status: 500 })));
}

/** A metadata-server token response. */
function tokenResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('staticGoogleDirectory', () => {
  it('answers from the fixture map, case-insensitively, and lowercases what it returns', async () => {
    const directory = staticGoogleDirectory({ 'op@x.dev': ['Group-A@x.dev'] });
    await expect(directory.groupsFor('OP@X.dev')).resolves.toEqual(['group-a@x.dev']);
  });

  it('reports no groups for an unknown account', async () => {
    const directory = staticGoogleDirectory({});
    await expect(directory.groupsFor('nobody@x.dev')).resolves.toEqual([]);
  });
});

describe('createGoogleDirectory', () => {
  it('mints a token and returns the group addresses it finds', async () => {
    const fetchImpl = fetchStub(
      tokenResponse({ access_token: 'token-1', expires_in: 3600 }),
      tokenResponse({
        memberships: [
          { groupKey: { id: 'Docket-Admins@x.dev' } },
          { groupKey: { id: 'docket-support@x.dev' } },
        ],
      }),
    );

    const groups = await createGoogleDirectory(fetchImpl).groupsFor('op@x.dev');

    expect(groups).toEqual(['docket-admins@x.dev', 'docket-support@x.dev']);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('reuses a cached token until it is close to expiring', async () => {
    const fetchImpl = fetchStub(
      tokenResponse({ access_token: 'token-1', expires_in: 3600 }),
      tokenResponse({ memberships: [] }),
      tokenResponse({ memberships: [] }),
    );
    let clock = 0;
    const directory = createGoogleDirectory(fetchImpl, () => clock);

    await directory.groupsFor('op@x.dev');
    clock += 60_000;
    await directory.groupsFor('op@x.dev');

    // Three calls, not four: one token fetch covered both lookups.
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('re-mints once the cached token has aged out', async () => {
    const fetchImpl = fetchStub(
      tokenResponse({ access_token: 'token-1', expires_in: 120 }),
      tokenResponse({ memberships: [] }),
      tokenResponse({ access_token: 'token-2', expires_in: 120 }),
      tokenResponse({ memberships: [] }),
    );
    let clock = 0;
    const directory = createGoogleDirectory(fetchImpl, () => clock);

    await directory.groupsFor('op@x.dev');
    clock += 120_000;
    await directory.groupsFor('op@x.dev');

    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('throws when the metadata server refuses a token', async () => {
    const fetchImpl = fetchStub(tokenResponse({ error: 'nope' }, 403));

    await expect(createGoogleDirectory(fetchImpl).groupsFor('op@x.dev')).rejects.toThrow(
      /Metadata server refused/,
    );
  });

  it('throws when the metadata server returns no token at all', async () => {
    const fetchImpl = fetchStub(tokenResponse({ expires_in: 3600 }));

    await expect(createGoogleDirectory(fetchImpl).groupsFor('op@x.dev')).rejects.toThrow(
      /no access token/,
    );
  });

  it('throws when the group lookup itself fails, so the sync cannot read it as "no groups"', async () => {
    const fetchImpl = fetchStub(
      tokenResponse({ access_token: 'token-1', expires_in: 3600 }),
      tokenResponse({ error: 'forbidden' }, 403),
    );

    await expect(createGoogleDirectory(fetchImpl).groupsFor('op@x.dev')).rejects.toThrow(
      /group lookup failed/,
    );
  });

  it('skips membership entries carrying no usable group address', async () => {
    const fetchImpl = fetchStub(
      tokenResponse({ access_token: 'token-1', expires_in: 3600 }),
      tokenResponse({
        memberships: [
          { groupKey: { id: '' } },
          { groupKey: {} },
          {},
          { groupKey: { id: 'ok@x.dev' } },
        ],
      }),
    );

    await expect(createGoogleDirectory(fetchImpl).groupsFor('op@x.dev')).resolves.toEqual([
      'ok@x.dev',
    ]);
  });

  it('treats a response with no memberships key as no groups', async () => {
    const fetchImpl = fetchStub(
      tokenResponse({ access_token: 'token-1', expires_in: 3600 }),
      tokenResponse({}),
    );

    await expect(createGoogleDirectory(fetchImpl).groupsFor('op@x.dev')).resolves.toEqual([]);
  });

  it('defaults an absent expires_in to an immediately stale token', async () => {
    const fetchImpl = fetchStub(
      tokenResponse({ access_token: 'token-1' }),
      tokenResponse({ memberships: [] }),
      tokenResponse({ access_token: 'token-2' }),
      tokenResponse({ memberships: [] }),
    );
    const directory = createGoogleDirectory(fetchImpl, () => 0);

    await directory.groupsFor('op@x.dev');
    await directory.groupsFor('op@x.dev');

    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });
});
