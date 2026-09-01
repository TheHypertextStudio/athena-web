import { describe, expect, it, vi } from 'vitest';

import {
  requestLatticeFedCM,
  type LatticeAuthorizationStart,
} from '../../src/app/(app)/settings/athena/lattice-fedcm';

const STARTED: LatticeAuthorizationStart = {
  attemptId: 'attempt_1',
  expiresAt: '2026-09-01T21:00:00.000Z',
  authorizationUrl: 'https://auth.uselovelace.com/oauth/authorize?state=signed',
  fedcm: {
    configUrl: 'https://auth.uselovelace.com/web-identity/config.json',
    clientId: 'client_docket',
    params: {
      purpose: 'oauth_authorization',
      redirect_uri: 'https://api.docket.test/internal/integrations/lattice/callback',
      scope: 'openid offline_access lattice:compute:inference lattice:compute:catalog:read',
      state: 'signed',
      code_challenge: 'challenge',
      code_challenge_method: 'S256',
    },
  },
};

describe('requestLatticeFedCM', () => {
  it('selects redirect without calling credentials when FedCM is absent', async () => {
    const get = vi.fn();

    await expect(
      requestLatticeFedCM(STARTED, { navigator: { credentials: { get } } }),
    ).resolves.toEqual({
      kind: 'redirect',
      authorizationUrl: STARTED.authorizationUrl,
    });
    expect(get).not.toHaveBeenCalled();
  });

  it('requests the OAuth code through an active native FedCM ceremony', async () => {
    const get = vi.fn().mockResolvedValue({ token: 'code_from_lovelace' });

    await expect(
      requestLatticeFedCM(STARTED, {
        IdentityCredential: {},
        navigator: { credentials: { get } },
      }),
    ).resolves.toEqual({ kind: 'code', authorizationCode: 'code_from_lovelace' });
    expect(get).toHaveBeenCalledWith({
      identity: {
        mode: 'active',
        providers: [
          {
            configURL: STARTED.fedcm.configUrl,
            clientId: STARTED.fedcm.clientId,
            params: STARTED.fedcm.params,
          },
        ],
      },
    });
  });

  it('offers an explicit redirect after an invoked dialog is dismissed', async () => {
    const get = vi.fn().mockRejectedValue(new DOMException('Dismissed', 'AbortError'));

    await expect(
      requestLatticeFedCM(STARTED, {
        IdentityCredential: {},
        navigator: { credentials: { get } },
      }),
    ).resolves.toEqual({
      kind: 'fallback',
      authorizationUrl: STARTED.authorizationUrl,
    });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('offers the same explicit fallback when no OAuth code is returned', async () => {
    const get = vi.fn().mockResolvedValue({ token: '' });

    await expect(
      requestLatticeFedCM(STARTED, {
        IdentityCredential: {},
        navigator: { credentials: { get } },
      }),
    ).resolves.toEqual({
      kind: 'fallback',
      authorizationUrl: STARTED.authorizationUrl,
    });
  });
});
