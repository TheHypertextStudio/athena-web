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
  useAppSearchParams,
} = vi.hoisted(() => ({
  authorizePost: vi.fn(),
  completePost: vi.fn(),
  connectionDelete: vi.fn(),
  connectionGet: vi.fn(),
  connectionPatch: vi.fn(),
  devicePost: vi.fn(),
  devicesGet: vi.fn(),
  requestLatticeFedCM: vi.fn(),
  useAppSearchParams: vi.fn(() => new URLSearchParams()),
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

vi.mock('../../src/app/(app)/settings/athena/lattice-fedcm', () => ({
  requestLatticeFedCM,
}));

vi.mock('../../src/lib/app-location', () => ({
  useAppSearchParams,
}));

import { LatticeSection } from '../../src/app/(app)/settings/athena/lattice-section';
import {
  LATTICE_FEDCM_FALLBACK_COPY,
  LATTICE_SETUP_URL,
} from '../../src/app/(app)/settings/athena/lattice-copy';

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
      resource: 'https://lattice.test',
      scope: 'openid offline_access lattice:compute:inference lattice:compute:catalog:read',
      state: 'signed',
      code_challenge: 'challenge',
      code_challenge_method: 'S256' as const,
    },
  },
};
const RESTARTED = {
  ...STARTED,
  attemptId: 'attempt_2',
  authorizationUrl: `${AUTHORIZATION_URL}_again`,
  fedcm: {
    ...STARTED.fedcm,
    params: { ...STARTED.fedcm.params, state: 'signed_again' },
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
    value: {
      assign: assignMock,
      href: 'http://localhost:3000/settings/athena',
      pathname: '/settings/athena',
      search: '',
      hash: '',
    },
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
  useAppSearchParams.mockReset().mockReturnValue(new URLSearchParams());
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
    // test cannot tell the difference between the connected branch actually rendering and the
    // still-unconnected Connect button lingering.
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
    // The connected branch replaces the single Connect row with its own header actions — that
    // structural change is the confirmation; there's no separate "you're connected" sentence.
    expect(await screen.findByRole('button', { name: 'Reconnect Lovelace' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Connect with Lovelace' })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(authorizePost).toHaveBeenCalledTimes(2);
    });
  });

  it('prepares a fresh authorization attempt after disconnecting without a reload', async () => {
    connectionGet
      .mockReset()
      .mockResolvedValueOnce(okResponse({ ...UNCONNECTED, connected: true }))
      .mockResolvedValue(okResponse(UNCONNECTED));
    authorizePost
      .mockReset()
      .mockResolvedValueOnce(okResponse(STARTED))
      .mockResolvedValue(okResponse(RESTARTED));
    requestLatticeFedCM.mockResolvedValue({
      kind: 'fallback',
      authorizationUrl: RESTARTED.authorizationUrl,
    });
    renderSection();

    const disconnect = await screen.findByRole('button', { name: 'Disconnect' });
    await waitFor(() => {
      expect(authorizePost).toHaveBeenCalledTimes(1);
    });
    fireEvent.click(disconnect);
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));

    const connect = await preparedConnectButton();
    fireEvent.click(connect);

    await waitFor(() => {
      expect(authorizePost).toHaveBeenCalledTimes(2);
      expect(requestLatticeFedCM).toHaveBeenCalledWith(RESTARTED);
    });
  });
});

describe('LatticeSection carries no supplemental status text', () => {
  it('shows only the device list and header actions, even when the API reports a problem', async () => {
    connectionGet.mockReset().mockResolvedValue(
      okResponse({
        ...UNCONNECTED,
        connected: true,
        enabled: true,
        deviceId: 'd1',
        deviceName: 'Mac Studio',
        deviceStatus: 'reachable' as const,
        // A non-terminal reason: the backend can genuinely report this while still connected.
        // ('authorization_expired' cannot — recording it always flips status to 'error'.)
        unavailableReason: 'gateway_unreachable' as const,
      }),
    );
    devicesGet.mockReset().mockResolvedValue(
      okResponse({
        devices: [
          {
            id: 'd1',
            name: 'Mac Studio',
            status: 'reachable' as const,
            ready: true,
            lastSeenAt: null,
            executionBackend: 'lattice',
            selected: true,
          },
        ],
        unavailableReason: null,
      }),
    );
    renderSection();

    // The device row itself, not a separate sentence, is what's on screen.
    expect(await screen.findByText('Mac Studio')).toBeInTheDocument();
    // No narration anywhere — not a top banner, not a reason footer, not a status line.
    expect(screen.queryByText(/answers only from/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/standard models/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // Structure carries the signal instead: Reconnect Lovelace is the filled, weighted action
    // rather than its usual quiet ghost treatment, because reconnecting is actually needed here.
    const reconnect = screen.getByRole('button', { name: 'Reconnect Lovelace' });
    expect(reconnect.className).toContain('bg-secondary-container');
  });

  it("links to Lovelace's own Lattice setup docs when no computers are paired", async () => {
    connectionGet.mockReset().mockResolvedValue(okResponse({ ...UNCONNECTED, connected: true }));
    // devicesGet already defaults to an empty list in beforeEach.
    renderSection();

    expect(await screen.findByText('No computers paired')).toBeInTheDocument();
    const setup = screen.getByRole('link', { name: 'Set up Lattice' });
    expect(setup).toHaveAttribute('href', LATTICE_SETUP_URL);
    expect(setup).toHaveAttribute('target', '_blank');
  });

  it('gives an honest reason when the computer list itself failed to load', async () => {
    connectionGet.mockReset().mockResolvedValue(okResponse({ ...UNCONNECTED, connected: true }));
    devicesGet
      .mockReset()
      .mockResolvedValue(
        okResponse({ devices: [], unavailableReason: 'gateway_unreachable' as const }),
      );
    renderSection();

    expect(await screen.findByText('Could not load your computers')).toBeInTheDocument();
    // Not the same empty state a genuinely unpaired account gets, and no "Set up Lattice" link,
    // since the account may already have a paired computer that the list just failed to read.
    expect(screen.queryByText('No computers paired')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Set up Lattice' })).not.toBeInTheDocument();
  });
});

describe('LatticeSection ceremony feedback', () => {
  it('tells you a declined in-page ceremony did not connect, and lets you retry', async () => {
    requestLatticeFedCM.mockResolvedValue({ kind: 'code', authorizationCode: 'code_from_fedcm' });
    completePost.mockResolvedValue(okResponse({ status: 'declined' }));
    renderSection();

    fireEvent.click(await preparedConnectButton());

    expect(await screen.findByRole('alert')).toHaveTextContent('You declined the connection.');
    // The button re-arms for another attempt instead of staying stuck.
    await waitFor(() => {
      expect(authorizePost).toHaveBeenCalledTimes(2);
    });
    expect(await preparedConnectButton()).toBeEnabled();
  });

  it('tells you what to do differently when the ceremony reports insufficient scopes', async () => {
    requestLatticeFedCM.mockResolvedValue({ kind: 'code', authorizationCode: 'code_from_fedcm' });
    completePost.mockResolvedValue(okResponse({ status: 'scopes' }));
    renderSection();

    fireEvent.click(await preparedConnectButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Approve all the permissions Athena asks for.',
    );
  });

  it('shows the same feedback for a declined ceremony that returns via full-page redirect', async () => {
    useAppSearchParams.mockReturnValue(new URLSearchParams('lattice=declined'));
    renderSection();

    expect(await screen.findByRole('alert')).toHaveTextContent('You declined the connection.');
  });

  it('surfaces a silently-refused device switch as a write error', async () => {
    connectionGet.mockReset().mockResolvedValue(okResponse({ ...UNCONNECTED, connected: true }));
    devicesGet.mockReset().mockResolvedValue(
      okResponse({
        devices: [
          {
            id: 'd1',
            name: 'Mac Studio',
            status: 'reachable' as const,
            ready: true,
            lastSeenAt: null,
            executionBackend: 'lattice',
            selected: false,
          },
        ],
        unavailableReason: null,
      }),
    );
    devicePost.mockReset().mockResolvedValue(
      okResponse({
        ...UNCONNECTED,
        connected: true,
        unavailableReason: 'device_missing' as const,
      }),
    );
    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: 'Use this' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That computer is no longer available. Refresh the list and try again.',
    );
  });
});
