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
import { Cable, Edit, Link as LinkIcon, Sparkles, TaskAlt } from '@docket/ui/icons';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@docket/ui/primitives';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type ComponentType, type JSX, Suspense, useCallback, useEffect, useState } from 'react';

import { signInReturnPath } from '@/components/app-shell-utils';
import { api } from '@/lib/api';
import { useSession } from '@/lib/auth-client';

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

/** Up to two initials for a display name, used as the avatar fallback (e.g. "Claude" → "C"). */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? '';
  const second = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : '';
  return `${first}${second}`.toUpperCase() || '?';
}

/** The centered card chrome every state of this screen shares: wordmark + warm backdrop. */
function ConsentShell({ children }: { children: JSX.Element }): JSX.Element {
  return (
    <main className="dark:bg-surface flex min-h-screen flex-col items-center justify-center gap-8 bg-[oklch(0.985_0.008_85)] px-6 py-12">
      <Link
        href="/"
        className="text-foreground wonk text-3xl font-semibold tracking-tight"
        style={{ fontFamily: 'var(--font-fraunces), Georgia, serif' }}
      >
        Docket
      </Link>
      {children}
    </main>
  );
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
    <div className="mb-2 flex items-center justify-center gap-3" aria-hidden="true">
      <Avatar className="border-outline-variant size-12 border">
        {clientIcon ? <AvatarImage src={clientIcon} alt="" /> : null}
        <AvatarFallback className="text-body-medium font-medium">
          {initials(displayName)}
        </AvatarFallback>
      </Avatar>
      <LinkIcon className="text-on-surface-variant size-5" />
      <span
        className="bg-primary/10 text-primary flex size-12 items-center justify-center rounded-full text-lg font-semibold"
        style={{ fontFamily: 'var(--font-fraunces), Georgia, serif' }}
      >
        D
      </span>
    </div>
  );
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

  // Redirect unauthenticated users to sign-in, then back to this exact consent screen (params
  // and all) once they authenticate. Must go through `signInReturnPath`'s `?callbackURL=`
  // wrapper - a bare `/sign-in${currentSearch}` puts `consent_code`/`client_id`/`scope` on
  // `/sign-in`'s own query string, which the sign-in page never reads (it only honors
  // `callbackURL`), so it falls back to the home destination and the OAuth grant is lost.
  useEffect(() => {
    if (!sessionPending && !session) {
      router.replace(signInReturnPath(`${window.location.pathname}${window.location.search}`));
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
      <ConsentShell>
        <div className="text-on-surface-variant text-body-medium">Loading…</div>
      </ConsentShell>
    );
  }

  if (!session) {
    // The useEffect redirect is running; show nothing to avoid flash.
    return <ConsentShell>{<></>}</ConsentShell>;
  }

  if (!consentCode) {
    return (
      <ConsentShell>
        <Card className="w-full max-w-sm">
          <CardHeader className="items-center text-center">
            <CardTitle>Invalid request</CardTitle>
            <CardDescription>
              This authorization link is missing required parameters. Please try connecting your app
              again.
            </CardDescription>
          </CardHeader>
        </Card>
      </ConsentShell>
    );
  }

  const displayName = clientDisplayName(clientId, clientMeta);

  return (
    <ConsentShell>
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <ConnectionHero displayName={displayName} clientIcon={clientMeta?.icon} />
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
                  const info = SCOPE_INFO[scope];
                  const Icon = info?.icon ?? Cable;
                  return (
                    <li key={scope} className="flex items-start gap-3">
                      <span
                        className="bg-surface-container-high text-on-surface-variant mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full"
                        aria-hidden="true"
                      >
                        <Icon className="size-4" />
                      </span>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-on-surface text-body-medium font-medium">
                          {info?.label ?? scope}
                        </span>
                        {info?.detail ? (
                          <span className="text-on-surface-variant text-xs">{info.detail}</span>
                        ) : null}
                      </div>
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
    </ConsentShell>
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
