'use client';

/**
 * `settings` — the Connected accounts tab: a discover-and-manage provider directory.
 *
 * @remarks
 * This is the place to **discover** which external accounts can be linked AND **manage** the ones
 * you have. Every supported provider is always shown as a {@link ProviderGroup} (driven by
 * {@link IDENTITY_PROVIDER_CATALOG}), with its linked accounts grouped beneath it — so the page
 * scales to many accounts across providers instead of being a one-button display. It is the *only*
 * place linking/unlinking happens; org **Connections** then pick one of these accounts to sync
 * resources from. User-scoped: the same directory shows regardless of which org's settings are open.
 *
 * A provider is connectable only when its OAuth is configured in this deployment
 * (`usePublicConfig().oauthProviders`, derived from real server credentials) — otherwise it reads
 * "Available soon" rather than offering a dead button. Only real linked accounts are listed.
 */
import type { IdentityOut, IdentityProvider } from '@docket/types';
import { Skeleton } from '@docket/ui/primitives';
import { useQueryClient } from '@tanstack/react-query';
import NextLink from 'next/link';
import { type JSX, useCallback, useMemo, useState } from 'react';

import { api } from '@/lib/api';
import { authClient } from '@/lib/auth-client';
import { readError } from '@/lib/problem';
import { usePublicConfig } from '@/lib/public-config';
import { STALE, apiQueryOptions, queryKeys, useApiQuery } from '@/lib/query';

import { IDENTITY_PROVIDER_CATALOG } from './identity-providers';
import { ProviderGroup } from './provider-group';

/** Props for {@link ConnectedAccountsTab}. */
export interface ConnectedAccountsTabProps {
  /** The active organization id (route context; identities are user-scoped, not org-scoped). */
  orgId: string;
}

/** The Connected accounts settings tab — a provider directory to discover and manage linked accounts. */
export function ConnectedAccountsTab({ orgId }: ConnectedAccountsTabProps): JSX.Element {
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [addingProvider, setAddingProvider] = useState<IdentityProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: config } = usePublicConfig();
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
  const configured = useMemo(() => {
    const providers = new Set<string>(config?.oauthProviders ?? []);
    if (identitiesQ.data?.googleOAuth?.available !== true) providers.delete('google');
    return providers;
  }, [config?.oauthProviders, identitiesQ.data?.googleOAuth?.available]);

  /** The linked accounts grouped by provider, so each provider lists its own. */
  const byProvider = useMemo(() => {
    const map = new Map<IdentityProvider, IdentityOut[]>();
    for (const identity of identities) {
      const list = map.get(identity.provider) ?? [];
      list.push(identity);
      map.set(identity.provider, list);
    }
    return map;
  }, [identities]);

  const onAdd = useCallback((provider: IdentityProvider): void => {
    setError(null);
    setAddingProvider(provider);
    // Redirects to the provider's account chooser; on return this page remounts and refetches.
    authClient
      .linkSocial({ provider, callbackURL: window.location.pathname })
      .catch((err: unknown) => {
        setError(readError(err, 'Could not start linking that account.'));
        setAddingProvider(null);
      });
  }, []);

  const onRemove = useCallback(
    (provider: IdentityProvider, accountId: string): void => {
      setError(null);
      setBusyId(accountId);
      authClient
        .unlinkAccount({ providerId: provider, accountId })
        .then(() => qc.invalidateQueries({ queryKey: queryKeys.identities() }))
        .catch((err: unknown) => {
          setError(readError(err, 'Could not remove this account.'));
        })
        .finally(() => {
          setBusyId(null);
        });
    },
    [qc],
  );

  return (
    <section className="flex flex-col gap-4" aria-label="Connected accounts">
      <p className="text-on-surface-variant text-body max-w-prose">
        Link the external accounts you work in — Docket can then sync their work. Choose what
        actually syncs, and into which workspace, in{' '}
        <NextLink
          href={`/orgs/${orgId}/settings/connections`}
          className="text-on-surface font-medium underline-offset-2 hover:underline"
        >
          Connections
        </NextLink>
        .
      </p>

      {error ? (
        <p role="alert" className="text-destructive text-body">
          {error}
        </p>
      ) : null}

      {loading ? (
        <ul className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <li key={i} className="border-outline-variant rounded-xl border p-4">
              <div className="flex items-center gap-3">
                <Skeleton className="size-9 rounded-lg" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-4 w-28" />
                </div>
                <Skeleton className="h-7 w-24 rounded-md" />
              </div>
            </li>
          ))}
        </ul>
      ) : loadError ? (
        <p role="alert" className="text-destructive text-body">
          {loadError}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {IDENTITY_PROVIDER_CATALOG.map((entry) => (
            <ProviderGroup
              key={entry.id}
              entry={entry}
              accounts={entry.kind === 'live' ? (byProvider.get(entry.id) ?? []) : []}
              configured={entry.kind === 'live' && configured.has(entry.id)}
              adding={entry.kind === 'live' && addingProvider === entry.id}
              busyId={busyId}
              onAdd={onAdd}
              onRemove={onRemove}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
