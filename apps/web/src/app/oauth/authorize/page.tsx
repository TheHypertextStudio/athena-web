'use client';

/**
 * OAuth 2.1 consent page — the user-facing gate for MCP client authorization.
 *
 * @remarks
 * Better Auth's `mcp()` / `oidcProvider()` plugin redirects authenticated users here when
 * an external MCP client (Claude Desktop, Cursor, …) requests scopes. The URL carries three
 * query params set by Better Auth's authorize handler (authorize.mjs `consentPage` branch):
 *
 * - `consent_code` — the temporary code stored server-side; echoed back in the POST body.
 * - `client_id` — the OAuth client id (may be an HTTPS URL for CIMD clients).
 * - `scope` — space-separated list of Docket MCP scopes the client is requesting.
 *
 * The client's display name/icon come from `GET /v1/oauth/clients/:clientId/metadata` — the
 * **server-validated** row Better Auth's OAuth application table holds (for CIMD clients, the
 * `client_name`/`logo_uri` the server itself fetched and validated during the authorize
 * preflight; see `apps/api/src/mcp/cimd.ts`). This page never fetches the (attacker-controlled)
 * `client_id` URL directly — that would render whatever an untrusted client chose to serve.
 *
 * On **Approve**: POSTs to `/api/auth/oauth2/consent` with `{ accept: true, consent_code }`.
 * Better Auth stores the consent, exchanges the code for an authorization code, and returns
 * `{ redirectURI }` — the page then performs a client-side redirect to complete the flow.
 *
 * On **Deny**: POSTs the same endpoint with `{ accept: false, consent_code }`. Better Auth
 * returns `{ redirectURI }` pointing at the client's `redirect_uri` with `error=access_denied`.
 *
 * Unauthenticated users are redirected to `/sign-in` with the current search params preserved
 * so Better Auth can resume the flow after the user signs in.
 */
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@docket/ui/primitives';
import { useRouter, useSearchParams } from 'next/navigation';
import { type JSX, Suspense, useCallback, useEffect, useState } from 'react';

import { api } from '@/lib/api';
import { useSession } from '@/lib/auth-client';

/** Human-readable label + description for each Docket MCP scope. */
const SCOPE_LABELS: Record<string, { label: string; detail: string }> = {
  'work:read': {
    label: 'Read your work',
    detail: 'View your tasks, projects, programs, initiatives, and cycles.',
  },
  'work:write': {
    label: 'Create and update work',
    detail: 'Create tasks, update projects, post comments and status updates.',
  },
  'agents:run': {
    label: 'Manage agent sessions',
    detail: 'Trigger agent sessions, approve or reject proposed actions.',
  },
  'connectors:link': {
    label: 'Link external items',
    detail: 'Connect external tools and link items from integrated services.',
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

/** The inner consent page that reads searchParams and renders the form. */
function ConsentPage(): JSX.Element {
  const router = useRouter();
  const params = useSearchParams();
  const { data: session, isPending: sessionPending } = useSession();

  const consentCode = params.get('consent_code');
  const clientId = params.get('client_id') ?? '';
  const scopeParam = params.get('scope') ?? '';

  const requestedScopes = scopeParam
    .split(' ')
    .map((s) => s.trim())
    .filter(Boolean);

  const [clientMeta, setClientMeta] = useState<{ name: string; icon: string | null } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch CIMD metadata for URL-form client IDs.
  useEffect(() => {
    if (!clientId) return;
    void fetchClientMetadata(clientId).then(setClientMeta);
  }, [clientId]);

  // Redirect unauthenticated users to sign-in, preserving the consent params so Better Auth
  // can resume the flow after authentication (via the oidc_login_prompt cookie path).
  useEffect(() => {
    if (!sessionPending && !session) {
      const currentSearch = window.location.search;
      router.replace(`/sign-in${currentSearch}`);
    }
  }, [session, sessionPending, router]);

  const decide = useCallback(
    async (accept: boolean): Promise<void> => {
      if (!consentCode) {
        setError('Missing consent code. Please try connecting again.');
        return;
      }
      setPending(true);
      setError(null);
      try {
        const res = await fetch('/api/auth/oauth2/consent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accept, consent_code: consentCode }),
          credentials: 'same-origin',
        });
        if (!res.ok) {
          setError('Could not update authorization. Please try again.');
          return;
        }
        const { redirectURI } = (await res.json()) as { redirectURI: string };
        window.location.href = redirectURI;
      } catch {
        setError('Something went wrong. Please try again.');
      } finally {
        setPending(false);
      }
    },
    [consentCode],
  );

  if (sessionPending) {
    return (
      <main className="bg-surface flex min-h-screen items-center justify-center px-6 py-12">
        <div className="text-on-surface-variant text-body-medium">Loading…</div>
      </main>
    );
  }

  if (!session) {
    // The useEffect redirect is running; show nothing to avoid flash.
    return <main className="bg-surface flex min-h-screen items-center justify-center px-6 py-12" />;
  }

  if (!consentCode) {
    return (
      <main className="bg-surface flex min-h-screen items-center justify-center px-6 py-12">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            <CardTitle>Invalid request</CardTitle>
            <CardDescription>
              This authorization link is missing required parameters. Please try connecting your app
              again.
            </CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  const displayName = clientDisplayName(clientId, clientMeta);

  return (
    <main className="bg-surface flex min-h-screen items-center justify-center px-6 py-12">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-title-large">Authorize access</CardTitle>
          <CardDescription>
            <span className="text-on-surface font-medium">{displayName}</span> wants permission to
            access your Docket account as{' '}
            <span className="text-on-surface font-medium">{session.user.email}</span>.
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-6">
          {requestedScopes.length > 0 ? (
            <section aria-label="Requested permissions">
              <p className="text-on-surface-variant mb-3 text-sm font-medium">
                This app will be able to
              </p>
              <ul className="flex flex-col gap-3">
                {requestedScopes.map((scope) => {
                  const info = SCOPE_LABELS[scope];
                  return (
                    <li key={scope} className="flex flex-col gap-0.5">
                      <span className="text-on-surface text-body-medium font-medium">
                        {info?.label ?? scope}
                      </span>
                      {info?.detail ? (
                        <span className="text-on-surface-variant text-xs">{info.detail}</span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {error ? (
            <p role="alert" className="text-destructive text-body-medium">
              {error}
            </p>
          ) : null}

          <div className="flex flex-col gap-2">
            <Button
              type="button"
              disabled={pending}
              onClick={() => {
                void decide(true);
              }}
            >
              {pending ? 'Authorizing…' : 'Authorize'}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => {
                void decide(false);
              }}
            >
              Deny
            </Button>
          </div>

          <p className="text-on-surface-variant text-center text-xs">
            You can revoke this access at any time in Settings → Connected apps.
          </p>
        </CardContent>
      </Card>
    </main>
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
