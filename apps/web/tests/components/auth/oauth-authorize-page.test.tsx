/**
 * Behaviour contract for the OAuth consent screen.
 *
 * @remarks
 * Started as one regression test — an unauthenticated visitor must be sent to sign-in with the
 * consent params preserved via `?callbackURL=`, so a successful sign-in returns them to this exact
 * screen instead of falling back to the home destination and silently abandoning the third-party
 * app's authorization request.
 *
 * It now also covers what the screen SAYS, because this is the surface an outside developer relies
 * on to tell a person what their app will do with that person's work: every requested permission
 * renders as a plain-English label with a read/write qualifier and never as a raw identifier, the
 * two buttons explain themselves, and the request paints before the session read returns.
 */
import '@testing-library/jest-dom/vitest';

import { OAUTH_ISSUABLE_SCOPES } from '@docket/types';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OAUTH_SCOPE_COPY } from '@/lib/oauth-scope-copy';

/**
 * The mock mirrors Better Auth's real `useSession` shape, `error` included. It is not decoration:
 * the page distinguishes "the server said you have no session" from "the server never answered", and
 * a mock that omitted `error` would let a regression in that distinction pass unnoticed.
 */
interface MockSession {
  data: { user: { email: string } } | null;
  isPending: boolean;
  error: { status: number } | null;
}

const { metadataGet, replace, useSession } = vi.hoisted(() => ({
  metadataGet: vi.fn(),
  replace: vi.fn(),
  useSession: vi.fn((): MockSession => ({ data: null, isPending: false, error: null })),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

vi.mock('../../../src/lib/api', () => ({
  api: { v1: { oauth: { clients: { ':clientId': { metadata: { $get: metadataGet } } } } } },
}));

vi.mock('../../../src/lib/auth-client', () => ({
  useSession,
}));

import OAuthAuthorizePage from '../../../src/app/(auth)/oauth/authorize/page';

const CONSENT_QUERY =
  '?consent_code=abc123&client_id=https%3A%2F%2Fclient.example&scope=work%3Aread';

/**
 * A well-formed request: `sig` present (the marker the page gates on), plus the `redirect_uri`
 * the screen now discloses. `CONSENT_QUERY` above deliberately keeps the stale `consent_code`
 * shape, so the redirect tests exercise the malformed branch.
 */
const SIGNED_QUERY =
  '?sig=abc123&client_id=https%3A%2F%2Fclient.example%2Fmcp' +
  '&redirect_uri=https%3A%2F%2Fcallback.example%2Fdone' +
  '&scope=work%3Aread%20offline_access';

/** Point the page at a signed request and return an authenticated session. */
function renderSignedRequest(): void {
  window.history.replaceState(null, '', `/oauth/authorize${SIGNED_QUERY}`);
  useSession.mockReturnValue({
    data: { user: { email: 'ada@example.com' } },
    isPending: false,
    error: null,
  });
  render(<OAuthAuthorizePage />);
}

beforeEach(() => {
  metadataGet.mockReset();
  metadataGet.mockResolvedValue({ ok: false });
  replace.mockReset();
  useSession.mockReset();
  useSession.mockReturnValue({ data: null, isPending: false, error: null });
  window.history.replaceState(null, '', `/oauth/authorize${CONSENT_QUERY}`);
});

afterEach(() => {
  cleanup();
});

describe('OAuthAuthorizePage', () => {
  it('sends an unauthenticated visitor to sign-in with the consent screen as ?callbackURL=', async () => {
    render(<OAuthAuthorizePage />);

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith(
        `/sign-in?callbackURL=${encodeURIComponent(`/oauth/authorize${CONSENT_QUERY}`)}`,
      );
    });
  });

  it('does not redirect while the session read is still pending', () => {
    useSession.mockReturnValue({ data: null, isPending: true, error: null });

    render(<OAuthAuthorizePage />);

    expect(replace).not.toHaveBeenCalled();
  });

  it('does not redirect an authenticated visitor', async () => {
    useSession.mockReturnValue({
      data: { user: { email: 'ada@example.com' } },
      isPending: false,
      error: null,
    });

    render(<OAuthAuthorizePage />);

    await waitFor(() => {
      expect(metadataGet).toHaveBeenCalled();
    });
    expect(replace).not.toHaveBeenCalled();
  });

  it('does not abandon a consent grant because the session read failed', async () => {
    // Regression. This page used to gate on `!isPending && !session`, a boolean pair that cannot
    // tell "signed out" from "could not ask". A dropped connection or a 5xx on `/get-session` threw
    // an authenticated user out of a consent flow they were part-way through granting — and since
    // sign-in completes via fetch, the grant was simply lost. Only a server-confirmed sign-out may
    // redirect; an errored read keeps waiting.
    const failed: MockSession = { data: null, isPending: false, error: { status: 500 } };
    useSession.mockReturnValue(failed);

    render(<OAuthAuthorizePage />);

    await waitFor(() => {
      expect(useSession).toHaveBeenCalled();
    });
    expect(replace).not.toHaveBeenCalled();
  });

  it('offers a way out of the malformed-request state', () => {
    // The `sig`-less state used to render a title and description and nothing else, leaving the
    // reader on a screen with no control of any kind.
    useSession.mockReturnValue({
      data: { user: { email: 'ada@example.com' } },
      isPending: false,
      error: null,
    });

    render(<OAuthAuthorizePage />);

    expect(screen.getByRole('heading', { name: 'Invalid request' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Docket' })).toHaveAttribute('href', '/');
  });

  describe('a well-formed request', () => {
    it('renders the requested scopes, the account, and where the browser will be returned', async () => {
      renderSignedRequest();

      expect(await screen.findByRole('button', { name: 'Authorize' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Deny' })).toBeInTheDocument();

      // Scope labels, not raw scope strings.
      expect(screen.getByText('Read your work')).toBeInTheDocument();
      expect(screen.getByText('Stay connected')).toBeInTheDocument();

      expect(screen.getByText('ada@example.com')).toBeInTheDocument();
      // The disclosure this screen previously omitted entirely: `redirect_uri` was in the query
      // and never shown, so nobody approving could see where they were about to be sent.
      expect(screen.getByText('Returns to')).toBeInTheDocument();
      expect(screen.getByText('callback.example')).toBeInTheDocument();
    });

    it('shows an unrecognized permission in plain English, never its raw identifier', async () => {
      // The intent of the original test — an unrecognized permission must be SHOWN, because
      // silently hiding something the app asked for understates the grant — is unchanged. What
      // changed is the expectation: the row used to render the identifier itself, so a request
      // for `some:future` put a machine string in front of someone deciding whether to trust an
      // app. It now resolves through `describeScope`, which has no branch that can echo the input.
      window.history.replaceState(
        null,
        '',
        '/oauth/authorize?sig=abc123&client_id=https%3A%2F%2Fclient.example&scope=some%3Afuture',
      );
      useSession.mockReturnValue({
        data: { user: { email: 'ada@example.com' } },
        isPending: false,
        error: null,
      });

      render(<OAuthAuthorizePage />);

      expect(await screen.findByText('A permission Docket does not offer')).toBeInTheDocument();
      // The claim the row makes is true because `OAUTH_ISSUABLE_SCOPES` is the authorization
      // server's hard ceiling: a permission outside it cannot be granted at all.
      expect(screen.getByText('Grants nothing')).toBeInTheDocument();
      expect(screen.queryByText('some:future')).toBeNull();
    });

    it('renders a readable label for every permission the server can issue', async () => {
      // The consent screen's half of the SCR-12 enumeration: with all five requested at once,
      // each one resolves to a label and a read/write qualifier, and none renders as a raw
      // identifier. `oauth-scope-copy.test.ts` enumerates the copy map itself.
      window.history.replaceState(
        null,
        '',
        `/oauth/authorize?sig=abc123&client_id=https%3A%2F%2Fclient.example&scope=${encodeURIComponent(
          OAUTH_ISSUABLE_SCOPES.join(' '),
        )}`,
      );
      useSession.mockReturnValue({
        data: { user: { email: 'ada@example.com' } },
        isPending: false,
        error: null,
      });

      render(<OAuthAuthorizePage />);

      await screen.findByRole('button', { name: 'Authorize' });
      for (const scope of OAUTH_ISSUABLE_SCOPES) {
        expect(screen.getByText(OAUTH_SCOPE_COPY[scope].label)).toBeInTheDocument();
        expect(screen.queryByText(scope)).toBeNull();
      }
      // The qualifier is unexpanded on every row: whether an app is about to read your work or
      // change it must not be hidden behind a disclosure the skimming reader never opens.
      expect(screen.getAllByText('Can make changes')).toHaveLength(3);
      expect(screen.getByText('View only')).toBeInTheDocument();
      expect(screen.getByText('Ongoing access')).toBeInTheDocument();
    });

    it('says in plain words what Authorize and Deny each do, naming the app', async () => {
      metadataGet.mockResolvedValue({
        ok: true,
        json: async () => ({ name: 'Client Example', icon: null }),
      });

      renderSignedRequest();

      const explanation = await screen.findByText(/Authorize lets Client Example/);
      expect(explanation).toBeInTheDocument();
      // Both halves of the decision, and where Deny sends you — the return host the screen
      // already discloses, not a vague "you will be returned".
      expect(explanation.textContent).toContain('until you disconnect it');
      expect(explanation.textContent).toContain(
        'Deny sends you back to callback.example without giving it anything.',
      );
    });

    it('paints the request before the session read answers', async () => {
      // SCR-03's principle applied here: who is asking and what they are asking for come from the
      // URL, so both are known on the first paint. This screen used to throw all of it away for a
      // bare "Loading…" until `/get-session` returned. Only the account row and the two decision
      // buttons may wait on the session.
      window.history.replaceState(null, '', `/oauth/authorize${SIGNED_QUERY}`);
      useSession.mockReturnValue({ data: null, isPending: true, error: null });

      render(<OAuthAuthorizePage />);

      expect(
        screen.getByRole('heading', { name: /wants access to your Docket account/ }),
      ).toBeInTheDocument();
      expect(screen.getByText('Read your work')).toBeInTheDocument();
      expect(screen.getByText('Stay connected')).toBeInTheDocument();
      expect(screen.getByText('callback.example')).toBeInTheDocument();

      // …and the two things that genuinely need the session are held back rather than guessed at.
      expect(screen.getByText('Checking your account…')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Authorize' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Deny' })).toBeDisabled();
    });

    it('keeps the decision reachable when the session read fails outright', async () => {
      // `unreachable` shares the pending treatment: the read is still retrying, and abandoning a
      // consent grant over one failed request is exactly the wrong response.
      window.history.replaceState(null, '', `/oauth/authorize${SIGNED_QUERY}`);
      useSession.mockReturnValue({ data: null, isPending: false, error: { status: 500 } });

      render(<OAuthAuthorizePage />);

      expect(screen.getByText('Read your work')).toBeInTheDocument();
      expect(replace).not.toHaveBeenCalled();
    });

    it('withholds the verified-domain claim when the server returned no metadata', async () => {
      // `metadataGet` resolves `{ ok: false }` by default. Without server-validated metadata the
      // host is just an attacker-supplied string that happens to parse, and calling it verified
      // on a consent screen is precisely the wrong thing to do.
      renderSignedRequest();

      await screen.findByRole('button', { name: 'Authorize' });
      expect(screen.queryByText('Verified domain')).not.toBeInTheDocument();
    });

    it('shows the verified domain once the server validates the client', async () => {
      metadataGet.mockResolvedValue({
        ok: true,
        json: async () => ({ name: 'Client Example', icon: null }),
      });

      renderSignedRequest();

      expect(await screen.findByText('Verified domain')).toBeInTheDocument();
      expect(screen.getByText('client.example')).toBeInTheDocument();
    });
  });
});
