'use client';

/**
 * `settings` — the Connected accounts tab.
 *
 * @remarks
 * Lists the external **identities** (Google / GitHub / Linear accounts) the user linked to their
 * Docket identity, from `GET /v1/me/identities` (a Google email is decoded server-side from the
 * stored id token; GitHub/Linear carry none, so they show by provider name). This is the *only*
 * place linking/unlinking happens — org **Connections** then pick one of these identities to sync
 * resources from. User-scoped: the same list shows regardless of which org's settings are open.
 *
 * Only providers whose OAuth is actually configured for this deployment are offered, and only real
 * linked accounts are listed — never a fabricated placeholder (an unlinked provider just shows an
 * honest empty state).
 */
import type { IdentityOut, IdentityProvider } from '@docket/types';
import { EmptyState } from '@docket/ui/components';
import { Users } from '@docket/ui/icons';
import { Badge, Button, Skeleton } from '@docket/ui/primitives';
import { useQueryClient } from '@tanstack/react-query';
import { type JSX, useCallback, useState } from 'react';

import { oauthProviderOptions } from '@/app/(auth)/_lib/oauth-providers';
import { api } from '@/lib/api';
import { authClient } from '@/lib/auth-client';
import { readError } from '@/lib/problem';
import { usePublicConfig } from '@/lib/public-config';
import { STALE, apiQueryOptions, queryKeys, useApiQuery } from '@/lib/query';

/** Human-readable provider names (the identity's `provider` is a Better Auth `socialProviders` key). */
const PROVIDER_NAME: Record<IdentityProvider, string> = {
  google: 'Google',
  github: 'GitHub',
  linear: 'Linear',
};

/** Friendly labels for the Google OAuth scopes we request (raw URLs are unreadable). */
const SCOPE_LABEL: Record<string, string> = {
  'https://www.googleapis.com/auth/tasks': 'Tasks',
  'https://www.googleapis.com/auth/calendar.readonly': 'Calendar',
  'https://www.googleapis.com/auth/drive.readonly': 'Drive',
  'https://mail.google.com/': 'Gmail',
};

/** The friendly, de-duplicated access labels for an identity's granted scopes. */
function accessLabels(scopes: readonly string[]): string[] {
  const labels = scopes.map((s) => SCOPE_LABEL[s]).filter((l): l is string => Boolean(l));
  return [...new Set(labels)];
}

/** The display label for an identity: its email, then name, then the provider name. */
function identityLabel(identity: IdentityOut): string {
  return identity.email ?? identity.name ?? PROVIDER_NAME[identity.provider];
}

/** Props for {@link ConnectedAccountsTab}. */
export interface ConnectedAccountsTabProps {
  /** The active organization id (route context; identities are user-scoped, not org-scoped). */
  orgId: string;
}

/** The Connected accounts settings tab — link/remove external identities across providers. */
export function ConnectedAccountsTab({ orgId: _orgId }: ConnectedAccountsTabProps): JSX.Element {
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [addingProvider, setAddingProvider] = useState<IdentityProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Offer linking only for providers whose OAuth is actually wired in this deployment (from the
  // server's /v1/config). You can link several accounts of the same provider, so each stays
  // available even after one is linked.
  const { data: config } = usePublicConfig();
  const linkable = oauthProviderOptions(config?.oauthProviders ?? []);

  const identitiesQ = useApiQuery(
    apiQueryOptions(
      queryKeys.identities(),
      () => api.v1.me.identities.$get(),
      'Could not load connected accounts.',
      { staleTime: STALE.static },
    ),
  );
  const identities: readonly IdentityOut[] = identitiesQ.data?.items ?? [];
  const loading = identitiesQ.isPending;
  const loadError = identitiesQ.isError ? identitiesQ.error.message : null;

  const onAdd = useCallback(async (provider: IdentityProvider): Promise<void> => {
    setError(null);
    setAddingProvider(provider);
    try {
      // Redirects to the provider's account chooser; on return this page remounts and refetches.
      await authClient.linkSocial({ provider, callbackURL: window.location.pathname });
    } catch (err) {
      setError(readError(err, `Could not start linking a ${PROVIDER_NAME[provider]} account.`));
      setAddingProvider(null);
    }
  }, []);

  const onRemove = useCallback(
    async (provider: IdentityProvider, accountId: string): Promise<void> => {
      setError(null);
      setBusyId(accountId);
      try {
        await authClient.unlinkAccount({ providerId: provider, accountId });
        await qc.invalidateQueries({ queryKey: queryKeys.identities() });
      } catch (err) {
        setError(readError(err, 'Could not remove this account.'));
      } finally {
        setBusyId(null);
      }
    },
    [qc],
  );

  return (
    <section className="flex flex-col gap-4" aria-label="Connected accounts">
      <div className="flex items-start justify-between gap-3">
        <p className="text-on-surface-variant text-body max-w-prose">
          Linking an account lets Docket sync the work it holds. Set up what actually syncs in{' '}
          <span className="text-on-surface font-medium">Connections</span>.
        </p>
        {linkable.length > 0 ? (
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            {linkable.map((p) => (
              <Button
                key={p.id}
                type="button"
                size="sm"
                disabled={addingProvider !== null}
                onClick={() => {
                  void onAdd(p.id);
                }}
              >
                {addingProvider === p.id ? 'Opening…' : `Add ${PROVIDER_NAME[p.id]}`}
              </Button>
            ))}
          </div>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-destructive text-body">
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className="flex flex-col gap-2">
          {[0, 1].map((i) => (
            <div key={i} className="flex items-center gap-4 py-2">
              <Skeleton className="h-9 w-9 rounded-full" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-28" />
              </div>
              <Skeleton className="h-8 w-16 rounded-md" />
            </div>
          ))}
        </div>
      ) : loadError ? (
        <p role="alert" className="text-destructive text-body">
          {loadError}
        </p>
      ) : identities.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No accounts linked"
          body={
            linkable.length > 0
              ? 'Link an account to sync its work into Docket.'
              : 'No accounts can be linked in this workspace yet.'
          }
          className="border-none p-8"
        />
      ) : (
        <ul className="border-outline-variant divide-outline-variant flex flex-col divide-y rounded-lg border">
          {identities.map((identity) => {
            const label = identityLabel(identity);
            const access = accessLabels(identity.scopes);
            return (
              <li key={identity.accountId} className="flex items-center gap-4 px-4 py-3">
                <span className="bg-surface-container text-on-surface-variant text-body flex size-9 shrink-0 items-center justify-center rounded-full font-medium">
                  {label.charAt(0).toUpperCase()}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-on-surface text-body truncate font-medium">{label}</span>
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="text-on-surface-variant text-xs">
                      {PROVIDER_NAME[identity.provider]}
                    </span>
                    {access.map((a) => (
                      <Badge key={a} variant="secondary" className="text-xs font-normal">
                        {a}
                      </Badge>
                    ))}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busyId === identity.accountId}
                  onClick={() => {
                    void onRemove(identity.provider, identity.accountId);
                  }}
                >
                  {busyId === identity.accountId ? 'Removing…' : 'Remove'}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
