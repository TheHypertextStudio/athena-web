/**
 * The Connected apps roster must describe a grant the way the consent screen granted it.
 *
 * @remarks
 * Two surfaces talk about the same authorization: `/oauth/authorize` asks for it, and
 * `/settings/connected-apps` is where a person goes afterwards to check what they agreed to and
 * take it back. They must therefore call each permission by the same name — and neither may ever
 * print a raw scope identifier — the same plain-language, no-raw-identifier rule the consent
 * screen already enforces.
 *
 * The roster used to keep its own parallel label map. It had drifted ("Read work" against the
 * consent screen's "Read your work"), and its `?? scope` fallback printed `connectors:link` at a
 * reader the moment a granted scope left the issuable set. Both bugs were invisible to the consent
 * screen's own tests because the two surfaces shared no code. They share `describeScope` now, and
 * this file is what keeps them sharing it.
 */
import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as QueryModule from '../../src/lib/query';

/** One roster row per test run, swapped by mutating this hoisted fixture. */
const state = vi.hoisted(() => ({
  scopes: ['work:read'] as string[],
}));

vi.mock('../../src/lib/query', async (importOriginal) => {
  const actual = await importOriginal<typeof QueryModule>();
  return {
    ...actual,
    useLiveApiQuery: () => ({
      data: {
        items: [
          {
            clientId: 'https://claude.ai',
            name: 'Claude',
            icon: null,
            scopes: state.scopes,
            consentedAt: '2026-08-02T00:00:00.000Z',
          },
        ],
      },
      isPending: false,
      isError: false,
      error: null,
    }),
    useApiMutation: () => ({ mutate: vi.fn(), isError: false, error: null }),
  };
});

vi.mock('../../src/lib/public-config', () => ({
  usePublicConfig: () => ({ data: undefined }),
  mcpUrl: () => 'https://api.docket.test/mcp',
}));

vi.mock('../../src/components/settings/mcp-setup-panels', () => ({
  ClientSetup: () => null,
}));

import { ConnectedAppsTab } from '../../src/components/settings/connected-apps-tab';
import { OAUTH_SCOPE_COPY } from '../../src/lib/oauth-scope-copy';

afterEach(() => {
  cleanup();
  state.scopes = ['work:read'];
});

describe('the Connected apps roster', () => {
  it('labels every issuable permission with the consent screen’s own words', () => {
    state.scopes = Object.keys(OAUTH_SCOPE_COPY);
    render(<ConnectedAppsTab orgId="01BX5ZZKBKACTAV9WEVGEMMVRZ" />);

    for (const [scope, copy] of Object.entries(OAUTH_SCOPE_COPY)) {
      expect(screen.getByText(copy.label), `label for ${scope}`).toBeInTheDocument();
      expect(screen.queryByText(scope)).toBeNull();
    }
  });

  it('never prints a raw identifier for a scope outside the issuable set', () => {
    // A legacy grant: the scope was issuable when it was approved and no longer is. The row still
    // renders — hiding a permission the user actually granted would understate what they gave
    // away — but it is named in words, not in `some:future`.
    state.scopes = ['work:read', 'some:future'];
    render(<ConnectedAppsTab orgId="01BX5ZZKBKACTAV9WEVGEMMVRZ" />);

    expect(screen.queryByText('some:future')).toBeNull();
    expect(screen.getByText('A permission Docket does not offer')).toBeInTheDocument();
  });

  it('promises immediate revocation, and no residual window', () => {
    render(<ConnectedAppsTab orgId="01BX5ZZKBKACTAV9WEVGEMMVRZ" />);

    // This assertion has been inverted once, deliberately, and the history is the point. Access
    // tokens are self-contained JWTs, so while the resource server checked only the signature,
    // revoking could not reach a token already issued and the copy correctly named the ~15-minute
    // window rather than overstating its own reach. `isGrantLive` in `apps/api/src/mcp/auth.ts`
    // now re-reads the grant on every Bearer call, so the window is gone and the copy says so —
    // and `apps/api/tests/mcp/mcp-grant-lifecycle.test.ts` proves the claim against a token that
    // is still cryptographically valid at the moment it is refused. If that check is ever removed,
    // this test fails and the promise cannot quietly outlive the mechanism behind it.
    // Scoped through the heading rather than a landmark name: settings groups are deliberately
    // unnamed sections, because one region landmark per card on a surface built entirely of cards
    // is landmark spam. The heading is the group's identity and survives the container.
    const roster = screen
      .getByRole('heading', { name: 'Apps with access to your Docket' })
      .closest('section');
    expect(roster).not.toBeNull();
    expect(roster).toHaveTextContent('takes effect immediately');
    expect(roster).not.toHaveTextContent('15 minutes');
    expect(roster).not.toHaveTextContent('for up to');
  });
});
