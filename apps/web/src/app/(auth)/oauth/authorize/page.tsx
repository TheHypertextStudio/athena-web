'use client';

/**
 * OAuth 2.1 consent page — the user-facing gate for MCP client authorization.
 *
 * @remarks
 * Better Auth's `oauthProvider()` plugin redirects authenticated users here when
 * an external MCP client (Claude Desktop, Cursor, …) requests scopes. The URL carries the
 * **signed authorization query** — every parameter of the original `/oauth2/authorize` request
 * plus an `exp` and a `sig` — rather than a short opaque handle:
 *
 * - `sig` — the HMAC over the query the plugin issued; its presence marks a well-formed request,
 *   and the endpoint re-verifies it server-side before honoring anything here.
 * - `client_id` — the OAuth client id (may be an HTTPS URL for CIMD clients).
 * - `scope` — space-separated list of scopes the client is requesting.
 * - `redirect_uri` — where the browser is sent once a decision is made.
 *
 * The deprecated `oidcProvider()` pair issued a `consent_code` instead; that contract is gone.
 * Nothing on this page is trusted — the query is echoed back verbatim and the server decides.
 *
 * The client's display name/icon come from `GET /v1/oauth/clients/:clientId/metadata` — the
 * **server-validated** row Better Auth's OAuth application table holds (for CIMD clients, the
 * `client_name`/`logo_uri` the server itself fetched and validated during the authorize
 * preflight; see `apps/api/src/mcp/cimd.ts`). This page never fetches the (attacker-controlled)
 * `client_id` URL directly — that would render whatever an untrusted client chose to serve.
 *
 * **Layout.** The screen composes {@link AuthLayout}: the request context (who is asking, as which
 * account, which verified domain, where the browser will be returned) fills the card's left column
 * and the permission list plus the decision buttons fill the right.
 *
 * Permissions are collapsed disclosures inside one tonal block capped at `45dvh`. That cap is the
 * fix, not decoration: the previous `max-w-sm` card put `Authorize` below an unbounded scope list
 * with no scroll container anywhere, so a five-scope request on a laptop pushed the primary action
 * off-screen. The server accepts arbitrary requested scopes, so the row count has no ceiling — only
 * bounding the list keeps the decision reachable at any viewport height.
 *
 * This file lives under the `(auth)` route group — which does not change its `/oauth/authorize`
 * URL — so it inherits the layout publishing `--font-fraunces`. Outside the group the wordmark's
 * display face silently resolved to Georgia.
 *
 * On **Approve**: POSTs to `/api/auth/oauth2/consent` with `{ accept: true, oauth_query }`, where
 * `oauth_query` is this page's own query string echoed back unmodified. Better Auth verifies the
 * signature, stores the consent, mints an authorization code, and returns `{ redirect_uri }` —
 * the page then performs a client-side redirect to complete the flow.
 *
 * On **Deny**: POSTs the same endpoint with `{ accept: false, oauth_query }`. Better Auth returns
 * a `redirect_uri` pointing at the client's callback with `error=access_denied`.
 *
 * Unauthenticated users are redirected to `/sign-in` with the current search params preserved
 * so Better Auth can resume the flow after the user signs in.
 */
import { AuthLayout } from '@docket/ui/components';
import {
  Cable,
  ChevronDown,
  Edit,
  Link as LinkIcon,
  RefreshCw,
  Sparkles,
  TaskAlt,
} from '@docket/ui/icons';
import { Avatar, AvatarFallback, AvatarImage, Button } from '@docket/ui/primitives';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type ComponentType, type JSX, Suspense, useCallback, useEffect, useState } from 'react';

import { signInReturnPath } from '@/components/app-shell-utils';
import Wordmark from '@/components/wordmark';
import { api } from '@/lib/api';
import { useSession } from '@/lib/auth-client';
import { resolveSessionStatus } from '@/lib/session-status';

/** Human-readable label, description, and icon for each Docket MCP scope. */
const SCOPE_INFO: Record<
  string,
  { label: string; detail: string; icon: ComponentType<{ className?: string }> }
> = {
  'work:read': {
    label: 'Read your work',
    detail: 'View your tasks, projects, programs, initiatives, and cycles.',
    icon: TaskAlt,
  },
  'work:write': {
    label: 'Create and update work',
    detail: 'Create tasks, update projects, post comments and status updates.',
    icon: Edit,
  },
  'agents:run': {
    label: 'Manage agent sessions',
    detail: 'Trigger agent sessions, approve or reject proposed actions.',
    icon: Sparkles,
  },
  'connectors:link': {
    label: 'Link external items',
    detail: 'Connect external tools and link items from integrated services.',
    icon: Cable,
  },
  // Not a Docket capability — this is the standard OAuth scope that lets the app refresh its
  // own access without prompting again. Described in plain terms because the person reading
  // this screen is deciding whether to trust an app, not reading an OAuth spec.
  offline_access: {
    label: 'Stay connected',
    detail: 'Keep working on your behalf without asking you to sign in again.',
    icon: RefreshCw,
  },
};

/** Fetch the server-validated display metadata for an OAuth client. Returns `null` on any failure. */
async function fetchClientMetadata(
  clientId: string,
): Promise<{ name: string; icon: string | null } | null> {
  try {
    const res = await api.v1.oauth.clients[':clientId'].metadata.$get({ param: { clientId } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Derive a display name for the client: prefer the server's name, fall back to the domain. */
function clientDisplayName(clientId: string, metadata: { name: string } | null): string {
  if (metadata?.name) return metadata.name;
  try {
    return new URL(clientId).hostname;
  } catch {
    return clientId;
  }
}

/** The hostname of an absolute URL, or `null` when the value is absent or unparseable. */
function hostOf(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

/** Up to two initials for a display name, used as the avatar fallback (e.g. "Claude" → "C"). */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? '';
  const second = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : '';
  return `${first}${second}`.toUpperCase() || '?';
}

/** The two-mark "X connects to Docket" hero: the requesting client's icon, linked to Docket's. */
function ConnectionHero({
  displayName,
  clientIcon,
}: {
  displayName: string;
  clientIcon: string | null | undefined;
}): JSX.Element {
  return (
    <div className="flex items-center gap-2" aria-hidden="true">
      <Avatar className="border-outline-variant bg-surface size-8 border">
        {clientIcon ? <AvatarImage src={clientIcon} alt="" /> : null}
        <AvatarFallback className="text-body-small font-medium">
          {initials(displayName)}
        </AvatarFallback>
      </Avatar>
      <LinkIcon className="text-on-surface-variant size-3.5" />
      <span className="bg-primary/10 text-primary font-display wonk text-body-medium flex size-8 items-center justify-center rounded-full font-semibold">
        D
      </span>
    </div>
  );
}

/** One labelled row of the request context (`Your account`, `Returns to`). */
function ContextRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-on-surface-variant text-label-medium">{label}</dt>
      {/* `break-words`, not `break-all`: a long address should wrap at the last point that fits,
          not slice a word in half the moment the column narrows. */}
      <dd className="text-on-surface text-body-medium break-words">{value}</dd>
    </div>
  );
}

/**
 * One requested permission, as a disclosure row.
 *
 * @remarks
 * Native `<details>`/`<summary>` rather than a bespoke component: it is keyboard-operable and
 * screen-reader-announced for free, and the repo has no Collapsible primitive to reach for.
 * Collapsed by default, so a five-scope request reads as a short scannable list instead of five
 * stacked paragraphs — the label alone says what is being granted, and the detail is one click
 * away for anyone who wants it.
 *
 * A scope the app does not recognize has no detail to reveal, so it renders as a plain row: an
 * empty disclosure that opens onto nothing is worse than no disclosure at all.
 */
function ScopeRow({ scope }: { scope: string }): JSX.Element {
  const info = SCOPE_INFO[scope];
  const Icon = info?.icon ?? Cable;
  const label = info?.label ?? scope;

  const glyph = (
    <span className="text-on-surface-variant flex size-5 shrink-0 items-center justify-center">
      <Icon className="size-3.5" />
    </span>
  );

  if (!info?.detail) {
    return (
      <li className="border-outline-variant flex min-h-11 items-center gap-3 border-b px-3 py-2.5 last:border-b-0">
        <span aria-hidden="true">{glyph}</span>
        <span className="text-on-surface text-body-medium min-w-0 font-medium break-words">
          {label}
        </span>
      </li>
    );
  }

  return (
    <li className="border-outline-variant border-b last:border-b-0">
      <details className="group">
        <summary className="focus-visible:ring-ring flex min-h-11 cursor-pointer list-none items-center gap-3 px-3 py-2.5 outline-none focus-visible:ring-2 [&::-webkit-details-marker]:hidden">
          <span aria-hidden="true">{glyph}</span>
          <span className="text-on-surface text-body-medium min-w-0 flex-1 font-medium break-words">
            {label}
          </span>
          <ChevronDown
            aria-hidden="true"
            className="text-on-surface-variant size-4 shrink-0 transition-transform group-open:rotate-180"
          />
        </summary>
        {/* `ml-10` aligns the detail under the label rather than the icon (size-7 + gap-3). */}
        <p className="text-on-surface-variant text-body-small mr-3 mb-3 ml-8">{info.detail}</p>
      </details>
    </li>
  );
}

/** The inner consent page that reads searchParams and renders the form. */
function ConsentPage(): JSX.Element {
  const router = useRouter();
  const params = useSearchParams();
  const { data: session, isPending: sessionPending, error: sessionError } = useSession();

  // `oauthProvider()` redirects here with the SIGNED authorization query — every original
  // authorize parameter plus `exp`/`sig` — not the `consent_code` the deprecated oidcProvider()
  // pair issued. The whole query string is echoed back as `oauth_query`, which a `before` hook
  // on the consent endpoint signature-verifies to reload the pending authorization. `sig` is
  // therefore the marker of a well-formed request.
  const signature = params.get('sig');
  const clientId = params.get('client_id') ?? '';
  const scopeParam = params.get('scope') ?? '';
  const returnHost = hostOf(params.get('redirect_uri'));

  const requestedScopes = scopeParam
    .split(' ')
    .map((s) => s.trim())
    .filter(Boolean);

  const [clientMeta, setClientMeta] = useState<{ name: string; icon: string | null } | null>(null);
  const [pending, setPending] = useState<'accept' | 'deny' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch CIMD metadata for URL-form client IDs.
  useEffect(() => {
    if (!clientId) return;
    void fetchClientMetadata(clientId).then(setClientMeta);
  }, [clientId]);

  // Redirect unauthenticated users to sign-in, then back to this exact consent screen (params
  // and all) once they authenticate. Must go through `signInReturnPath`'s `?callbackURL=`
  // wrapper - a bare `/sign-in${currentSearch}` puts the signed authorize params on
  // `/sign-in`'s own query string, which the sign-in page never reads (it only honors
  // `callbackURL`), so it falls back to the home destination and the OAuth grant is lost.
  //
  // Gated on the shared four-way classifier rather than the `!sessionPending && !session` boolean
  // pair this used to test. That pair cannot tell "signed out" from "could not ask", so a dropped
  // connection or a 5xx on `/get-session` bounced an authenticated user out of a consent flow they
  // were in the middle of granting. Only a server-confirmed `signed-out` may redirect; `unreachable`
  // falls through to the pending treatment below, where the session read is still retrying.
  const sessionStatus = resolveSessionStatus({
    hasSession: Boolean(session),
    isPending: sessionPending,
    hasError: Boolean(sessionError),
    pendingTimedOut: false,
  });
  useEffect(() => {
    if (sessionStatus === 'signed-out') {
      router.replace(signInReturnPath(`${window.location.pathname}${window.location.search}`));
    }
  }, [sessionStatus, router]);

  const decide = useCallback(
    async (accept: boolean): Promise<void> => {
      if (!signature) {
        setError('This authorization link is incomplete. Please try connecting again.');
        return;
      }
      setPending(accept ? 'accept' : 'deny');
      setError(null);
      try {
        const res = await fetch('/api/auth/oauth2/consent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // Echo the signed query back verbatim (minus the leading `?`) — the endpoint verifies
          // the signature over the exact string it issued, so re-serializing from `params` would
          // risk reordering or re-encoding it into a signature mismatch.
          body: JSON.stringify({ accept, oauth_query: window.location.search.replace(/^\?/, '') }),
          credentials: 'same-origin',
        });
        if (!res.ok) {
          setError('Could not update authorization. Please try again.');
          return;
        }
        // The handler answers `{ redirect: true, url }` even though the plugin's own OpenAPI
        // metadata for this route documents `redirect_uri`. Prefer what it actually emits and
        // fall back to the documented name, so a future version aligning with its docs keeps
        // working — and surface a real error rather than navigating to `undefined`.
        const body = (await res.json()) as { url?: string; redirect_uri?: string };
        const destination = body.url ?? body.redirect_uri;
        if (!destination) {
          setError('Could not complete authorization. Please try connecting again.');
          return;
        }
        window.location.href = destination;
      } catch {
        setError('Something went wrong. Please try again.');
      } finally {
        setPending(null);
      }
    },
    [signature],
  );

  // `unreachable` shares the pending treatment on purpose: the session read is still retrying, and a
  // consent grant is exactly the wrong thing to abandon over one failed request.
  if (sessionStatus === 'pending' || sessionStatus === 'unreachable') {
    return (
      <AuthLayout brand={<Wordmark className="text-2xl" />} intro={null}>
        <p className="text-on-surface-variant text-body-medium">Loading…</p>
      </AuthLayout>
    );
  }

  if (!session) {
    // The useEffect redirect is running; show nothing to avoid flash.
    return (
      <AuthLayout brand={<Wordmark className="text-2xl" />} intro={null}>
        <></>
      </AuthLayout>
    );
  }

  if (!signature) {
    return (
      <AuthLayout
        brand={<Wordmark className="text-2xl" />}
        intro={<h1 className="text-headline-small text-on-surface font-medium">Invalid request</h1>}
      >
        <p className="text-on-surface-variant text-body-medium">
          This authorization link is missing required parameters. Start the connection again from
          the app you were trying to connect.
        </p>
        {/* The previous version of this state rendered a header and nothing else, leaving the
            person on a screen with no control of any kind. */}
        <Link
          href="/"
          className="text-primary text-body-medium inline-flex min-h-10 w-fit items-center font-medium underline-offset-4 hover:underline"
        >
          Back to Docket
        </Link>
      </AuthLayout>
    );
  }

  const displayName = clientDisplayName(clientId, clientMeta);
  // Only call the domain "verified" when the server actually returned validated metadata for this
  // client id. Without it the hostname is just an attacker-supplied string we happen to be able to
  // parse, and labelling that as verified is precisely the wrong thing to do on a consent screen.
  const verifiedHost = clientMeta ? hostOf(clientId) : null;

  return (
    <AuthLayout
      brand={<Wordmark className="text-2xl" />}
      intro={
        <>
          <ConnectionHero displayName={displayName} clientIcon={clientMeta?.icon} />
          <h1 className="text-headline-small text-on-surface font-medium">
            {displayName} wants access to your Docket account
          </h1>
          <dl className="border-outline-variant mt-1 flex flex-col gap-3 border-t pt-4">
            {verifiedHost ? <ContextRow label="Verified domain" value={verifiedHost} /> : null}
            <ContextRow label="Your account" value={session.user.email} />
            {returnHost ? <ContextRow label="Returns to" value={returnHost} /> : null}
          </dl>
        </>
      }
    >
      {requestedScopes.length > 0 ? (
        <section aria-label="Requested permissions" className="flex min-w-0 flex-col gap-3">
          <p className="text-on-surface text-label-large">This app will be able to</p>
          {/* One tonal block rather than a card per permission: the list reads as a single object
              being granted. Capped and scrollable because the server accepts arbitrary requested
              scopes, so the row count has no ceiling — without the cap a long list would push the
              decision buttons off a short viewport, which is the failure this redesign fixes. */}
          <ul className="bg-surface-container-high max-h-[45dvh] overflow-y-auto rounded-lg">
            {requestedScopes.map((scope) => (
              <ScopeRow key={scope} scope={scope} />
            ))}
          </ul>
        </section>
      ) : null}

      {error ? (
        <p role="alert" className="text-destructive text-body-medium">
          {error}
        </p>
      ) : null}

      {/* Reversed so the primary lands on the right at width and first when stacked. */}
      <div className="flex flex-col-reverse gap-2 @3xl:flex-row @3xl:justify-end">
        <Button
          type="button"
          variant="outline"
          size="lg"
          disabled={pending !== null}
          onClick={() => {
            void decide(false);
          }}
        >
          {pending === 'deny' ? 'Denying…' : 'Deny'}
        </Button>
        <Button
          type="button"
          size="lg"
          disabled={pending !== null}
          onClick={() => {
            void decide(true);
          }}
        >
          {pending === 'accept' ? 'Authorizing…' : 'Authorize'}
        </Button>
      </div>

      <p className="text-on-surface-variant text-body-small">
        Revoke access any time in{' '}
        <Link
          href="/settings/connected-apps"
          className="text-primary font-medium underline-offset-4 hover:underline"
        >
          Connected apps
        </Link>
        .
      </p>
    </AuthLayout>
  );
}

/**
 * The OAuth 2.1 consent page.
 *
 * @remarks
 * Wrapped in `<Suspense>` because `useSearchParams()` requires it in Next.js App Router.
 */
export default function OAuthAuthorizePage(): JSX.Element {
  return (
    <Suspense>
      <ConsentPage />
    </Suspense>
  );
}
