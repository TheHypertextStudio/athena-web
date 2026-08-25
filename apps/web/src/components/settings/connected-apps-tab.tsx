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
 *
 * Permission names come from `@/lib/oauth-scope-copy` — the same module the consent screen at
 * `/oauth/authorize` renders from. This roster is where someone goes to check what they agreed to,
 * so it must call each permission by the name they agreed to it under; this file previously kept
 * its own parallel label map, which drifted ("Read work" here, "Read your work" there) and fell
 * back to printing the raw scope identifier for anything it did not recognise.
 */
import { EmptyState } from '@docket/ui/components';
import { WriteError } from './write-error';
import { Link } from '@docket/ui/icons';
import { Avatar, AvatarFallback, Badge, Button, Skeleton } from '@docket/ui/primitives';
import { type JSX, useCallback, useState } from 'react';

import { api } from '@/lib/api';
import { describeScope } from '@/lib/oauth-scope-copy';
import { mcpUrl, usePublicConfig } from '@/lib/public-config';
import {
  STALE,
  apiQueryOptions,
  queryKeys,
  unwrap,
  useApiMutation,
  useLiveApiQuery,
} from '@/lib/query';

import { ConfirmDestructiveDialog } from '@/components/confirm-destructive-dialog';
import { LoadFailure } from './load-failure';
import { SettingsGroup } from './settings-group';
import { SETTINGS_NODES } from './settings-capabilities';
import { ClientSetup } from './mcp-setup-panels';
import { userErrorMessage } from '@/lib/problem';

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
  const { data: config } = usePublicConfig();
  const mcpServerUrl = mcpUrl(config);

  const appsQ = useLiveApiQuery(
    apiQueryOptions(
      queryKeys.connectedApps(),
      () => api.v1.me['connected-apps'].$get(),
      'Could not load connected apps.',
      { staleTime: STALE.static },
    ),
    15_000,
  );

  const apps: readonly ConnectedApp[] = appsQ.data?.items ?? [];
  const loading = appsQ.isPending;
  const loadError = appsQ.isError
    ? userErrorMessage(appsQ.error, 'Could not update connected apps.')
    : null;

  const revoke = useApiMutation({
    mutationFn: (clientId: string) =>
      unwrap(
        () => api.v1.me['connected-apps'][':clientId'].$delete({ param: { clientId } }),
        'Could not revoke access.',
      ),
    invalidateKeys: [queryKeys.connectedApps()],
  });
  const [revokingId, setRevokingId] = useState<string | null>(null);
  // Revoking breaks a third-party integration the moment it lands, and the app is named by a
  // row the pointer is already over — worth one question before it stops working.
  const [confirmRevoke, setConfirmRevoke] = useState<ConnectedApp | null>(null);
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
      <SettingsGroup capability={SETTINGS_NODES.connectedAppsClient}>
        <ClientSetup mcpUrl={mcpServerUrl} />
      </SettingsGroup>

      {/* No separator element here. It painted nothing once the grouping border came off, so it
          announced a boundary to assistive tech that nobody could see. Two sibling sections, each
          with its own heading and 32px between them, are already separated. */}

      {/* ── Authorized clients roster ── */}
      <SettingsGroup
        capability={SETTINGS_NODES.connectedAppsAccess}
        body="rows"
        // What revoking actually does, in the same words the consent screen used to grant it.
        // This copy carried a "for up to 15 minutes" caveat while the resource server checked only
        // the token's signature, and an app holding a live key kept working until it expired.
        // `apps/api/src/mcp/auth.ts` now re-checks the stored grant on every call, so the caveat is
        // gone and the immediate claim is one the product actually keeps.
      >
        {/* placeholder: the OAuth apps this person has authorized — how many, their names, icons,
            granted permissions and consent dates. Everything above (the heading and the paragraph
            explaining what revoking does) is static copy and paints first. */}
        {loading ? (
          <div className="flex flex-col gap-2">
            {[0, 1].map((i) => (
              <div key={i} className="flex items-center gap-4 py-2">
                <Skeleton className="h-9 w-9 rounded-xl" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-8 w-16 rounded-md" />
              </div>
            ))}
          </div>
        ) : loadError ? (
          <LoadFailure message={loadError} retrying />
        ) : apps.length === 0 ? (
          <EmptyState
            icon={Link}
            title="No apps connected"
            body="Claude Desktop, Cursor, and other tools you connect will appear here, with the permissions you approved."
            frame="none"
          />
        ) : (
          <ul>
            {apps.map((app) => (
              <li key={app.clientId} className="flex items-center gap-4 px-4 py-3">
                <Avatar className="size-9 shrink-0 rounded-md">
                  <AvatarFallback className="text-label-large rounded-md">
                    {app.name.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-on-surface text-label-large truncate">{app.name}</span>
                  {/* Same words the consent screen used when this grant was approved — the roster
                      is where a person checks what they agreed to, so it must not rename it. Going
                      through `describeScope` also removes the `?? scope` fallback that used to
                      print a raw identifier (`connectors:link`) at a reader the moment a granted
                      scope left the issuable set. */}
                  <div className="flex flex-wrap gap-1">
                    {app.scopes.map((scope) => (
                      <Badge key={scope} variant="secondary" className="text-body-small">
                        {describeScope(scope).label}
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
                    setConfirmRevoke(app);
                  }}
                >
                  {revokingId === app.clientId ? 'Revoking…' : 'Revoke'}
                </Button>
              </li>
            ))}
          </ul>
        )}

        <ConfirmDestructiveDialog
          open={confirmRevoke !== null}
          onOpenChange={(open) => {
            if (!open) setConfirmRevoke(null);
          }}
          title={`Revoke ${confirmRevoke?.name ?? ''}?`}
          description="The app loses access immediately and has to ask for your approval again to reconnect."
          confirmLabel="Revoke access"
          pending={revokingId !== null}
          onConfirm={() => {
            if (confirmRevoke) revokeApp(confirmRevoke.clientId);
            setConfirmRevoke(null);
          }}
        />

        {revoke.isError ? (
          <WriteError
            message={userErrorMessage(revoke.error, 'Could not update connected apps.')}
          />
        ) : null}
      </SettingsGroup>
    </div>
  );
}
