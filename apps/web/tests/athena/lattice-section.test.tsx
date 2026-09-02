import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeQueryWrapper, okResponse } from '../support/query';

const {
  authorizePost,
  completePost,
  connectionDelete,
  connectionGet,
  connectionPatch,
  devicePost,
  devicesGet,
  requestLatticeFedCM,
} = vi.hoisted(() => ({
  authorizePost: vi.fn(),
  completePost: vi.fn(),
  connectionDelete: vi.fn(),
  connectionGet: vi.fn(),
  connectionPatch: vi.fn(),
  devicePost: vi.fn(),
  devicesGet: vi.fn(),
  requestLatticeFedCM: vi.fn(),
}));

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      me: {
        athena: {
          lattice: {
            $delete: connectionDelete,
            $get: connectionGet,
            $patch: connectionPatch,
            authorize: {
              $post: authorizePost,
              code: { $post: completePost },
            },
            device: { $post: devicePost },
            devices: { $get: devicesGet },
          },
        },
      },
    },
  },
}));

vi.mock('../../src/components/authentication-interlock', () => ({
  useAuthenticationRecovery: () => (action: () => Promise<unknown>) => action(),
  useOptionalAuthenticationRecovery: () => (action: () => Promise<unknown>) => action(),
}));

vi.mock('../../src/lib/app-location', () => ({
  useAppSearchParams: () => new URLSearchParams(),
}));

vi.mock('../../src/app/(app)/settings/athena/lattice-fedcm', () => ({
  requestLatticeFedCM,
}));

import { LatticeSection } from '../../src/app/(app)/settings/athena/lattice-section';
import { LATTICE_FEDCM_FALLBACK_COPY } from '../../src/app/(app)/settings/athena/lattice-copy';

const AUTHORIZATION_URL = 'https://auth.uselovelace.com/oauth/authorize?state=signed';
const STARTED = {
  attemptId: 'attempt_1',
  expiresAt: '2026-09-01T21:00:00.000Z',
  authorizationUrl: AUTHORIZATION_URL,
  fedcm: {
    configUrl: 'https://auth.uselovelace.com/web-identity/config/v1.json',
    clientId: 'client_docket',
    params: {
      purpose: 'oauth_authorization' as const,
      redirect_uri: 'https://api.docket.test/internal/integrations/lattice/callback',
      scope: 'openid offline_access lattice:compute:inference lattice:compute:catalog:read',
      state: 'signed',
      code_challenge: 'challenge',
      code_challenge_method: 'S256' as const,
    },
  },
};

const UNCONNECTED = {
  available: true,
  deploymentReason: null,
  connected: false,
  enabled: false,
  deviceId: null,
  deviceName: null,
  deviceStatus: null,
  scopes: STARTED.fedcm.params.scope.split(' '),
  grantedScope: null,
  unavailableReason: null,
};

let assignMock = vi.fn();

beforeEach(() => {
  assignMock = vi.fn();
  Object.defineProperty(window, 'location', {
    value: { assign: assignMock },
    writable: true,
    configurable: true,
  });
  connectionGet.mockReset().mockResolvedValue(okResponse(UNCONNECTED));
  devicesGet.mockReset().mockResolvedValue(okResponse({ devices: [], unavailableReason: null }));
  authorizePost.mockReset().mockResolvedValue(okResponse(STARTED));
  completePost.mockReset().mockResolvedValue(okResponse({ status: 'connected' }));
  connectionDelete.mockReset().mockResolvedValue(okResponse(UNCONNECTED));
  connectionPatch.mockReset().mockResolvedValue(okResponse(UNCONNECTED));
  devicePost.mockReset().mockResolvedValue(okResponse(UNCONNECTED));
  requestLatticeFedCM.mockReset();
});

afterEach(cleanup);

function renderSection(): void {
  render(<LatticeSection />, { wrapper: makeQueryWrapper().wrapper });
}

async function preparedConnectButton(): Promise<HTMLElement> {
  const connect = await screen.findByRole('button', { name: 'Connect with Lovelace' });
  await waitFor(() => {
    expect(connect).toBeEnabled();
  });
  return connect;
}

describe('LatticeSection FedCM-first authorization', () => {
  it('prepares the server attempt before enabling the click that opens FedCM', async () => {
    requestLatticeFedCM.mockResolvedValue({
      kind: 'fallback',
      authorizationUrl: AUTHORIZATION_URL,
    });
    renderSection();

    const connect = await preparedConnectButton();
    await waitFor(() => {
      expect(authorizePost).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(connect);

    expect(requestLatticeFedCM).toHaveBeenCalledWith(STARTED);
  });

  it('redirects from the original click only when FedCM is unsupported', async () => {
    requestLatticeFedCM.mockResolvedValue({
      kind: 'redirect',
      authorizationUrl: AUTHORIZATION_URL,
    });
    renderSection();

    fireEvent.click(await preparedConnectButton());

    await waitFor(() => {
      expect(assignMock).toHaveBeenCalledWith(AUTHORIZATION_URL);
    });
    expect(requestLatticeFedCM).toHaveBeenCalledWith(STARTED);
    expect(completePost).not.toHaveBeenCalled();
  });

  it('does not redirect after a native dialog is dismissed until the user chooses fallback', async () => {
    requestLatticeFedCM.mockResolvedValue({
      kind: 'fallback',
      authorizationUrl: AUTHORIZATION_URL,
    });
    renderSection();

    fireEvent.click(await preparedConnectButton());

    const fallback = await screen.findByRole('button', {
      name: LATTICE_FEDCM_FALLBACK_COPY.action,
    });
    expect(assignMock).not.toHaveBeenCalled();
    expect(screen.getByText(LATTICE_FEDCM_FALLBACK_COPY.title)).toBeInTheDocument();

    // The fallback is the action that will actually work now, so it must not
    // read as a second button of the same weight as the one that just failed.
    const connect = await preparedConnectButton();
    expect(fallback.className).not.toEqual(connect.className);

    fireEvent.click(fallback);
    expect(assignMock).toHaveBeenCalledWith(AUTHORIZATION_URL);
  });

  it('submits the native dialog code to Docket without putting it in a URL', async () => {
    requestLatticeFedCM.mockResolvedValue({
      kind: 'code',
      authorizationCode: 'code_from_fedcm',
    });
    // The connection query must report the server truth once the ceremony completes, or this
    // test cannot tell the difference between "the connected branch actually rendered" and "the
    // notice rendered beside the still-unconnected Connect button" — the exact contradiction this
    // suite exists to catch.
    connectionGet
      .mockReset()
      .mockResolvedValueOnce(okResponse(UNCONNECTED))
      .mockResolvedValue(okResponse({ ...UNCONNECTED, connected: true }));
    renderSection();

    fireEvent.click(await preparedConnectButton());

    await waitFor(() => {
      expect(completePost).toHaveBeenCalledWith({
        json: { attemptId: STARTED.attemptId, authorizationCode: 'code_from_fedcm' },
      });
    });
    expect(assignMock).not.toHaveBeenCalled();
    expect(await screen.findByText(/Lattice connected/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Connect with Lovelace' })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(authorizePost).toHaveBeenCalledTimes(2);
    });
  });
});
