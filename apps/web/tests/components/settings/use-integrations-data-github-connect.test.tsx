/**
 * Pins the fix for: "installing GitHub always forces Hypertext Studio as the location, and
 * reconnecting after disconnect silently does nothing." Root cause was that `finishConnection`
 * never launched the real GitHub App install redirect (`GET /:id/connect-url`) — every provider,
 * github included, went through the generic Better Auth OAuth-identity-link path
 * (`authClient.linkSocial`), which conflates identity linking with App installation.
 *
 * @remarks
 * Exercises `useIntegrationsData` directly (not the full Connections page) against a mocked `api`
 * client, `authClient`, and browser navigation, asserting: connecting `github` calls
 * `GET /:id/connect-url` and navigates via `window.location.assign` rather than `linkSocial`; a
 * control provider (`gtasks`, not in `REDIRECT_CONNECT_PROVIDERS`) still uses `linkSocial`
 * unchanged; and `?github=` on the URL (either outcome) refetches integrations and strips the
 * marker, since the App-install callback already wrote the truthful status/connection
 * server-side — the client re-reads it rather than duplicating a client-side error message.
 */
import type { IntegrationDirectoryProvider } from '@docket/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { JSX, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  directoryGet,
  integrationsGet,
  teamsGet,
  identitiesGet,
  configGet,
  integrationsPost,
  verifyPost,
  connectUrlGet,
  linkSocial,
} = vi.hoisted(() => ({
  directoryGet: vi.fn(),
  integrationsGet: vi.fn(),
  teamsGet: vi.fn(),
  identitiesGet: vi.fn(),
  configGet: vi.fn(),
  integrationsPost: vi.fn(),
  verifyPost: vi.fn(),
  connectUrlGet: vi.fn(),
  linkSocial: vi.fn(),
}));

vi.mock('../../../src/lib/api', () => ({
  api: {
    v1: {
      config: { $get: configGet },
      me: { identities: { $get: identitiesGet } },
      orgs: {
        ':orgId': {
          integrations: {
            directory: { $get: directoryGet },
            $get: integrationsGet,
            $post: integrationsPost,
            ':id': {
              verify: { $post: verifyPost },
              'connect-url': { $get: connectUrlGet },
            },
          },
          teams: { $get: teamsGet },
        },
      },
    },
  },
}));

vi.mock('../../../src/lib/auth-client', () => ({
  authClient: { linkSocial },
}));

vi.mock('../../../src/components/authentication-interlock', () => ({
  useAuthenticationRecovery: () => (action: () => Promise<unknown>) => action(),
  useOptionalAuthenticationRecovery: () => (action: () => Promise<unknown>) => action(),
}));

// A stable object identity across renders — an inline object literal would give `router` a new
// identity every render, which retriggers any effect that lists it as a dependency and can loop.
const { stableRouter } = vi.hoisted(() => ({ stableRouter: { replace: vi.fn() } }));
vi.mock('next/navigation', () => ({
  useRouter: () => stableRouter,
}));

let searchParams = new URLSearchParams();
vi.mock('../../../src/lib/app-location', () => ({
  useAppSearchParams: () => searchParams,
}));

import { useIntegrationsData } from '../../../src/components/settings/use-integrations-data';

const ORG_ID = 'org_1';
const GITHUB_DIRECTORY: IntegrationDirectoryProvider = {
  provider: 'github',
  name: 'GitHub',
  roles: ['code'],
} as IntegrationDirectoryProvider;
const GTASKS_DIRECTORY: IntegrationDirectoryProvider = {
  provider: 'gtasks',
  name: 'Google Tasks',
  roles: ['work'],
} as IntegrationDirectoryProvider;
const CONNECTOR_PATTERN = { pattern: 'connector' as const, syncMode: 'mirror' as const };

function okJson<T>(data: T): { ok: true; status: 200; json: () => Promise<T> } {
  return { ok: true, status: 200, json: () => Promise.resolve(data) };
}

/** Create an isolated query cache for the hook under test. */
function makeWrapper(): (props: { children: ReactNode }) => JSX.Element {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }): JSX.Element => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

let assignMock = vi.fn();

beforeEach(() => {
  searchParams = new URLSearchParams();
  directoryGet.mockResolvedValue(okJson({ providers: [] }));
  integrationsGet.mockResolvedValue(okJson({ items: [] }));
  teamsGet.mockResolvedValue(okJson({ items: [] }));
  identitiesGet.mockResolvedValue(okJson({ items: [] }));
  configGet.mockResolvedValue(okJson({ appMode: 'production', oauthProviders: ['google'] }));
  integrationsPost.mockResolvedValue(okJson({ id: 'intg_new', provider: 'github' }));
  verifyPost.mockResolvedValue(okJson({ id: 'intg_new', status: 'connected' }));
  connectUrlGet.mockResolvedValue(
    okJson({ url: 'https://github.com/apps/docket-test/installations/new?state=abc' }),
  );
  linkSocial.mockResolvedValue(undefined);

  assignMock = vi.fn();
  Object.defineProperty(window, 'location', {
    value: { assign: assignMock, pathname: '/orgs/org_1/settings/connections' },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('useIntegrationsData — connect ceremony routing', () => {
  it('connecting github fetches the App-install URL and navigates via window.location.assign, never linkSocial', async () => {
    const wrapper = makeWrapper();
    const { result } = renderHook(() => useIntegrationsData(ORG_ID), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.rowActions(GITHUB_DIRECTORY, undefined, CONNECTOR_PATTERN).connect();
    });

    await waitFor(() => {
      expect(connectUrlGet).toHaveBeenCalledTimes(1);
    });
    expect(connectUrlGet).toHaveBeenCalledWith({ param: { orgId: ORG_ID, id: 'intg_new' } });
    await waitFor(() => {
      expect(assignMock).toHaveBeenCalledWith(
        'https://github.com/apps/docket-test/installations/new?state=abc',
      );
    });
    expect(linkSocial).not.toHaveBeenCalled();
    expect(verifyPost).not.toHaveBeenCalled();
  });

  it('connecting a non-github provider (gtasks) still uses the Better Auth OAuth link, unchanged', async () => {
    integrationsPost.mockResolvedValueOnce(okJson({ id: 'intg_gtasks', provider: 'gtasks' }));
    const wrapper = makeWrapper();
    const { result } = renderHook(() => useIntegrationsData(ORG_ID), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.rowActions(GTASKS_DIRECTORY, undefined, CONNECTOR_PATTERN).connect();
    });

    await waitFor(() => {
      expect(linkSocial).toHaveBeenCalledTimes(1);
    });
    expect(connectUrlGet).not.toHaveBeenCalled();
    expect(assignMock).not.toHaveBeenCalled();
  });

  it('refetches integrations and strips the marker when the URL carries ?github=error', async () => {
    searchParams = new URLSearchParams('github=error');
    const wrapper = makeWrapper();
    renderHook(() => useIntegrationsData(ORG_ID), { wrapper });

    // The App-install callback already wrote the truthful status server-side; the client's job
    // is just to re-read it (not fabricate its own error copy) and clear the query param.
    await waitFor(() => {
      expect(stableRouter.replace).toHaveBeenCalledWith('/orgs/org_1/settings/connections');
    });
  });
});
