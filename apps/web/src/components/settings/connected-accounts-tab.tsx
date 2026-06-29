'use client';

/**
 * `settings` — the Connected accounts tab.
 *
 * @remarks
 * Lists the external **identities** (Google accounts) the user linked to their Docket identity,
 * from `GET /v1/me/identities` (the email is decoded server-side from the stored id token). This
 * is the *only* place linking/unlinking happens — org **Connections** then pick one of these
 * identities to sync resources from. User-scoped: the same list shows regardless of which org's
 * settings are open.
 */
import type { IdentityOut } from '@docket/types';
import { EmptyState } from '@docket/ui/components';
import { Users } from '@docket/ui/icons';
import { Badge, Button, Skeleton } from '@docket/ui/primitives';
import { useQueryClient } from '@tanstack/react-query';
import { type JSX, useCallback, useState } from 'react';

import { api } from '@/lib/api';
import { authClient } from '@/lib/auth-client';
import { readError } from '@/lib/problem';
import { apiQueryOptions, queryKeys, useApiQuery } from '@/lib/query';

import { connectorOAuthConfigured } from './integrations-config';

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

/** Props for {@link ConnectedAccountsTab}. */
export interface ConnectedAccountsTabProps {
  /** The active organization id (route context; identities are user-scoped, not org-scoped). */
  orgId: string;
}

/** The Connected accounts settings tab — link/remove external Google identities. */
export function ConnectedAccountsTab({ orgId: _orgId }: ConnectedAccountsTabProps): JSX.Element {
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Real linking needs Google OAuth configured; in local mock mode a synthetic identity already
  // stands in, so there's nothing to add.
  const canLink = connectorOAuthConfigured('gtasks');

  const identitiesQ = useApiQuery(
    apiQueryOptions(
      queryKeys.identities(),
      () => api.v1.me.identities.$get(),
      'Could not load connected accounts.',
    ),
  );
  const identities: readonly IdentityOut[] = identitiesQ.data?.items ?? [];
  const loading = identitiesQ.isPending;
  const loadError = identitiesQ.isError ? identitiesQ.error.message : null;

  const onAdd = useCallback(async (): Promise<void> => {
    setError(null);
    setAdding(true);
    try {
      // Redirects to Google's account chooser; on return this page remounts and refetches.
      await authClient.linkSocial({ provider: 'google', callbackURL: window.location.pathname });
    } catch (err) {
      setError(readError(err, 'Could not start linking a Google account.'));
      setAdding(false);
    }
  }, []);

  const onRemove = useCallback(
    async (accountId: string): Promise<void> => {
      setError(null);
      setBusyId(accountId);
      try {
        await authClient.unlinkAccount({ providerId: 'google', accountId });
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
          Linking a Google account lets Docket sync the work it holds. Set up what actually syncs in{' '}
          <span className="text-on-surface font-medium">Connections</span>.
        </p>
        {canLink ? (
          <Button
            type="button"
            size="sm"
            disabled={adding}
            onClick={() => {
              void onAdd();
            }}
          >
            {adding ? 'Opening…' : 'Add account'}
          </Button>
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
            canLink
              ? 'Link a Google account to sync its tasks into Docket.'
              : 'Linking a Google account is not available in this workspace yet.'
          }
          className="border-none p-8"
        />
      ) : (
        <ul className="border-outline-variant divide-outline-variant flex flex-col divide-y rounded-lg border">
          {identities.map((identity) => {
            const label = identity.email ?? identity.name ?? 'Google account';
            const access = accessLabels(identity.scopes);
            return (
              <li key={identity.accountId} className="flex items-center gap-4 px-4 py-3">
                <span className="bg-surface-container text-on-surface-variant text-body flex size-9 shrink-0 items-center justify-center rounded-full font-medium">
                  {label.charAt(0).toUpperCase()}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-on-surface text-body truncate font-medium">{label}</span>
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="text-on-surface-variant text-xs">Google</span>
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
                    void onRemove(identity.accountId);
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
