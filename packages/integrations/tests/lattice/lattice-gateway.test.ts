/**
 * The gateway operations Docket performs, and the invariant that gives the whole feature its
 * meaning: **an unavailable device never silently becomes a cloud model.**
 *
 * @remarks
 * The `runLatticeChat` tests below assert on the *absence* of a dispatch as much as on the error.
 * A version of this module that fell back would still throw in some paths and still return text in
 * others; only counting the requests proves it did not quietly go somewhere else.
 */
import {
  LATTICE_UNAVAILABLE_REASONS,
  LatticeError,
  LatticeUnavailableError,
  PersonalRuntimeUnreachableError,
  deviceUnavailableReason,
  listLatticeDevices,
  readLatticeDevice,
  runLatticeChat,
  toLatticeUnavailable,
  type LatticeGatewayContext,
} from '@docket/integrations';
import { describe, expect, it } from 'vitest';

/** Build one gateway runtime record. */
function runtime(
  latticeId: string,
  status: 'unpaired' | 'reachable' | 'offline' | 'revoked',
  displayName = latticeId,
): Record<string, unknown> {
  return {
    latticeId,
    accountId: 'acct_1',
    displayName,
    executionBackend: 'local-model',
    status,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    lastSeenAt: '2026-08-02T12:00:00.000Z',
  };
}

/** A fetch double that routes by path and records every request path it saw. */
function gatewayFetch(handlers: { runtimes?: () => Response; chat?: () => Response }): {
  context: LatticeGatewayContext;
  paths: string[];
} {
  const paths: string[] = [];
  const fetchImpl = (async (input: string | URL) => {
    const path = new URL(String(input)).pathname;
    paths.push(path);
    if (path === '/v1/personal-runtimes') {
      return (
        handlers.runtimes?.() ?? new Response(JSON.stringify({ runtimes: [] }), { status: 200 })
      );
    }
    if (path === '/v1/chat/completions') {
      return (
        handlers.chat?.() ??
        new Response(
          JSON.stringify({
            id: 'c1',
            object: 'chat.completion',
            model: 'lattice:personal:lat_a',
            choices: [{ index: 0, message: { role: 'assistant', content: 'local reply' } }],
          }),
          { status: 200 },
        )
      );
    }
    return new Response('{}', { status: 404 });
  }) as typeof globalThis.fetch;
  return {
    context: { accessToken: 'tok', baseUrl: 'https://gateway.test', fetch: fetchImpl },
    paths,
  };
}

/** A JSON response helper. */
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('deviceUnavailableReason', () => {
  it('maps every device state, and only `reachable` can serve a turn', () => {
    expect(deviceUnavailableReason('reachable')).toBeNull();
    expect(deviceUnavailableReason('offline')).toBe('device_offline');
    expect(deviceUnavailableReason('unpaired')).toBe('device_unpaired');
    expect(deviceUnavailableReason('revoked')).toBe('device_revoked');
  });
});

describe('toLatticeUnavailable', () => {
  it('maps each documented gateway code onto an actionable reason', () => {
    const cases: readonly (readonly [string, number, string])[] = [
      ['transport_error', 0, 'gateway_unreachable'],
      ['revoked_grant', 401, 'authorization_expired'],
      ['insufficient_scopes', 403, 'insufficient_scopes'],
      ['personal_lattice_not_found', 404, 'device_missing'],
      ['personal_lattice_relay_unavailable', 503, 'device_offline'],
      ['personal_lattice_execution_timeout', 504, 'device_offline'],
    ];
    for (const [code, status, expected] of cases) {
      expect(toLatticeUnavailable(new LatticeError(status, code, 'provider prose')).reason).toBe(
        expected,
      );
    }
  });

  it('maps the SDK’s terminal unreachable error onto device_offline', () => {
    expect(toLatticeUnavailable(new PersonalRuntimeUnreachableError()).reason).toBe(
      'device_offline',
    );
  });

  it('treats an unrecognized 401/403 as a dead grant rather than guessing', () => {
    expect(toLatticeUnavailable(new LatticeError(401, 'weird_code', 'x')).reason).toBe(
      'authorization_expired',
    );
  });

  it('falls back to gateway_error instead of guessing at an unknown code', () => {
    // A wrong guess here would tell someone to take an action that cannot possibly help.
    expect(toLatticeUnavailable(new LatticeError(500, 'no_provider_available', 'x')).reason).toBe(
      'gateway_error',
    );
    expect(toLatticeUnavailable(new Error('something else')).reason).toBe('gateway_error');
  });

  it('keeps provider prose in `detail`, out of the reason', () => {
    const mapped = toLatticeUnavailable(new LatticeError(0, 'transport_error', 'ENOTFOUND'));
    expect(mapped.detail).toBe('ENOTFOUND');
    expect(LATTICE_UNAVAILABLE_REASONS).toContain(mapped.reason);
  });
});

describe('listLatticeDevices', () => {
  it('projects gateway records and marks only reachable devices ready', async () => {
    const { context } = gatewayFetch({
      runtimes: () =>
        json(200, {
          runtimes: [runtime('lat_a', 'reachable', 'Studio'), runtime('lat_b', 'offline')],
        }),
    });

    const devices = await listLatticeDevices(context);

    expect(devices).toEqual([
      {
        id: 'lat_a',
        name: 'Studio',
        status: 'reachable',
        ready: true,
        lastSeenAt: '2026-08-02T12:00:00.000Z',
        executionBackend: 'local-model',
      },
      {
        id: 'lat_b',
        name: 'lat_b',
        status: 'offline',
        ready: false,
        lastSeenAt: '2026-08-02T12:00:00.000Z',
        executionBackend: 'local-model',
      },
    ]);
  });

  it('keeps revoked devices in the list so a chosen device never silently vanishes', async () => {
    const { context } = gatewayFetch({
      runtimes: () => json(200, { runtimes: [runtime('lat_x', 'revoked')] }),
    });
    expect((await listLatticeDevices(context)).map((d) => d.id)).toEqual(['lat_x']);
  });

  it('reports a gateway failure as an actionable reason', async () => {
    const { context } = gatewayFetch({
      runtimes: () => json(403, { error: 'insufficient_scopes', message: 'x' }),
    });
    await expect(listLatticeDevices(context)).rejects.toMatchObject({
      reason: 'insufficient_scopes',
    });
  });

  it('returns null from readLatticeDevice for an id the account does not have', async () => {
    const { context } = gatewayFetch({
      runtimes: () => json(200, { runtimes: [runtime('lat_a', 'reachable')] }),
    });
    expect(await readLatticeDevice(context, 'lat_missing')).toBeNull();
  });
});

describe('runLatticeChat never falls back', () => {
  it('runs the turn on the chosen device when it is reachable', async () => {
    const { context, paths } = gatewayFetch({
      runtimes: () => json(200, { runtimes: [runtime('lat_a', 'reachable')] }),
    });

    const completion = await runLatticeChat(context, {
      deviceId: 'lat_a',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(completion.choices[0]?.message.content).toBe('local reply');
    expect(paths).toEqual(['/v1/personal-runtimes', '/v1/chat/completions']);
  });

  it('fails with device_offline and dispatches nothing when the device is asleep', async () => {
    const { context, paths } = gatewayFetch({
      runtimes: () => json(200, { runtimes: [runtime('lat_a', 'offline')] }),
    });

    const failure = await runLatticeChat(context, {
      deviceId: 'lat_a',
      messages: [{ role: 'user', content: 'hi' }],
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(LatticeUnavailableError);
    expect((failure as LatticeUnavailableError).reason).toBe('device_offline');
    // The load-bearing assertion: no chat request was made anywhere, to any capacity.
    expect(paths).toEqual(['/v1/personal-runtimes']);
  });

  it('fails with device_missing when the chosen device is gone', async () => {
    const { context, paths } = gatewayFetch({
      runtimes: () => json(200, { runtimes: [runtime('lat_other', 'reachable')] }),
    });

    await expect(
      runLatticeChat(context, { deviceId: 'lat_a', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toMatchObject({ reason: 'device_missing' });
    expect(paths).toEqual(['/v1/personal-runtimes']);
  });

  it('surfaces a device that drops between the readiness check and the dispatch', async () => {
    // The pre-check is an optimization, not the guarantee — the gateway's own terminal error has
    // to map to the same reason, or a race would produce a confusing generic failure.
    const { context } = gatewayFetch({
      runtimes: () => json(200, { runtimes: [runtime('lat_a', 'reachable')] }),
      chat: () => json(409, { error: 'runtime_unreachable', message: 'daemon stopped polling' }),
    });

    await expect(
      runLatticeChat(context, { deviceId: 'lat_a', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toMatchObject({ reason: 'device_offline' });
  });

  it('reports an unreachable gateway rather than answering from anywhere else', async () => {
    const failing = (async () => {
      throw new Error('getaddrinfo ENOTFOUND lattice.uselovelace.com');
    }) as typeof globalThis.fetch;

    await expect(
      runLatticeChat(
        { accessToken: 't', baseUrl: 'https://gateway.test', fetch: failing },
        { deviceId: 'lat_a', messages: [{ role: 'user', content: 'hi' }] },
      ),
    ).rejects.toMatchObject({ reason: 'gateway_unreachable' });
  });
});
