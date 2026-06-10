'use client';

/**
 * `settings` — the Connected Apps tab.
 *
 * @remarks
 * Shows an MCP client setup guide (dropdown → client-specific deep link or config snippet),
 * then lists every OAuth client the user has explicitly consented to — drawn from
 * `GET /v1/me/connected-apps` — with a per-client revoke button.
 *
 * Connected apps are **user-scoped** (not org-scoped): the same list appears regardless of
 * which org's settings the user is viewing. The tab is only shown in the personal workspace
 * settings (`PERSONAL_SETTINGS_SECTION_GROUPS`) to reflect this.
 */
import { EmptyState } from '@docket/ui/components';
import { Link } from '@docket/ui/icons';
import { Badge, Button, Skeleton } from '@docket/ui/primitives';
import { type JSX, useCallback, useState } from 'react';

import { api } from '@/lib/api';
import { queryKeys, unwrap, useApiMutation, useApiQuery } from '@/lib/query';

import { ClientSetup } from './mcp-setup-panels';

/** Human-readable label for each Docket MCP scope token. */
const SCOPE_LABEL: Record<string, string> = {
  'work:read': 'Read work',
  'work:write': 'Create & update work',
  'agents:run': 'Manage agents',
  'connectors:link': 'Link external items',
};

/** One authorized MCP client as returned by `GET /v1/me/connected-apps`. */
interface ConnectedApp {
  clientId: string;
  name: string;
  icon: string | null;
  scopes: string[];
  consentedAt: string;
}

/** Props for {@link ConnectedAppsTab}. */
export interface ConnectedAppsTabProps {
  /** The active organization id (used for MCP URL derivation, not for scoping queries). */
  orgId: string;
}

/**
 * The Connected Apps settings tab — MCP client setup guide + authorized client roster.
 */
export function ConnectedAppsTab({ orgId: _orgId }: ConnectedAppsTabProps): JSX.Element {
  const mcpUrl =
    process.env['NEXT_PUBLIC_MCP_URL'] ??
    `${typeof window !== 'undefined' ? window.location.origin.replace('app.', 'api.') : ''}/mcp`;

  const appsQ = useApiQuery(
    queryKeys.connectedApps(),
    () => api.v1.me['connected-apps'].$get(),
    'Could not load connected apps.',
  );

  const apps: readonly ConnectedApp[] = appsQ.data?.items ?? [];
  const loading = appsQ.isPending;
  const loadError = appsQ.isError ? appsQ.error.message : null;

  const revoke = useApiMutation({
    mutationFn: (clientId: string) =>
      unwrap(
        () => api.v1.me['connected-apps'][':clientId'].$delete({ param: { clientId } }),
        'Could not revoke access.',
      ),
    invalidateKeys: [queryKeys.connectedApps()],
  });
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const revokeApp = useCallback(
    (clientId: string) => {
      setRevokingId(clientId);
      revoke.mutate(clientId, {
        onSettled: () => {
          setRevokingId(null);
        },
      });
    },
    [revoke],
  );

  return (
    <div className="flex flex-col gap-8">
      {/* ── Setup guide ── */}
      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-on-surface text-body font-medium">Connect an MCP client</h2>
          <p className="text-on-surface-variant text-body leading-relaxed">
            Give Claude Desktop, Cursor, or any MCP-compatible tool access to your Docket account.
          </p>
        </div>

        <ClientSetup mcpUrl={mcpUrl} />
      </section>

      <div className="border-outline-variant border-t" role="separator" />

      {/* ── Authorized clients roster ── */}
      <section className="flex flex-col gap-4" aria-label="Authorized MCP clients">
        <div className="flex flex-col gap-1">
          <h2 className="text-on-surface text-body font-medium">Apps with access to your Docket</h2>
          <p className="text-on-surface-variant text-body">
            Each app below can read or act on your work using the scopes you approved. Revoking
            removes all their access tokens immediately — they will need to re-authorize.
          </p>
        </div>

        {loading ? (
          <div className="flex flex-col gap-2">
            {[0, 1].map((i) => (
              <div key={i} className="flex items-center gap-4 py-2">
                <Skeleton className="h-9 w-9 rounded-lg" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-8 w-16 rounded-md" />
              </div>
            ))}
          </div>
        ) : loadError ? (
          <p role="alert" className="text-destructive text-body">
            {loadError}
          </p>
        ) : apps.length === 0 ? (
          <EmptyState
            icon={Link}
            title="No apps connected"
            body="When you authorize an MCP client, it appears here."
            className="border-none p-8"
          />
        ) : (
          <ul className="border-outline-variant divide-outline-variant flex flex-col divide-y rounded-lg border">
            {apps.map((app) => (
              <li key={app.clientId} className="flex items-center gap-4 px-4 py-3">
                <span className="bg-surface-container text-on-surface-variant text-body flex size-9 shrink-0 items-center justify-center rounded-lg font-medium">
                  {app.name.charAt(0).toUpperCase()}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-on-surface text-body truncate font-medium">{app.name}</span>
                  <div className="flex flex-wrap gap-1">
                    {app.scopes.map((scope) => (
                      <Badge key={scope} variant="secondary" className="text-xs font-normal">
                        {SCOPE_LABEL[scope] ?? scope}
                      </Badge>
                    ))}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={revokingId === app.clientId}
                  onClick={() => {
                    revokeApp(app.clientId);
                  }}
                >
                  {revokingId === app.clientId ? 'Revoking…' : 'Revoke'}
                </Button>
              </li>
            ))}
          </ul>
        )}

        {revoke.isError ? (
          <p role="alert" className="text-destructive text-body">
            {revoke.error.message}
          </p>
        ) : null}
      </section>
    </div>
  );
}
