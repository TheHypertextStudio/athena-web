'use client';

/**
 * `settings` — the admin-only "Install Athena as a Linear Agent" card.
 *
 * @remarks
 * Installing the Linear Agent platform app is a single, workspace-level admin grant
 * (`actor=app`) that lets `@athena` be mentioned and delegated to directly inside Linear — a
 * categorically different relationship from the `provider: 'linear'` data-sync connector the
 * generic Connections directory manages (see `integrations-linear-agent.ts`). It is intentionally
 * NOT one more row in {@link ProviderCategorySection}'s generic provider list: it gets its own
 * small, distinctly-labelled section so it never reads as "connect your personal Linear account."
 *
 * Renders nothing for a non-manager viewer rather than a disabled affordance — the decision to
 * grant Athena a workspace-wide app install is an administrative trust call a regular member has
 * no action to take on, so there is nothing for them to see (mirrors
 * {@link RecoveryNudgeBanner}'s "renders nothing when not applicable" shape, which is the one other
 * settings-adjacent surface in this codebase that fully hides rather than disables).
 *
 * The `provider: 'linear_agent'` integration row appears in the same
 * `GET /v1/orgs/:orgId/integrations` list every other integration does, so this reuses that cached
 * read (`queryKeys.integrations`) rather than adding a second fetch. Installing calls
 * `GET /v1/orgs/:orgId/integrations/linear-agent/install` for a signed authorize URL and navigates
 * the browser there; Linear's callback lands back on this page with `?linear_agent=connected` or
 * `?linear_agent=error` (see `integrations-linear-agent-oauth.ts`'s `settingsRedirect`).
 */
import type { IntegrationOut } from '@docket/connections/integration-contract';
import { Sparkles } from '@docket/ui/icons';
import { Badge, Button, DecorativeIcon } from '@docket/ui/primitives';
import { useAppSearchParams } from '@/lib/app-location';
import type { JSX } from 'react';

import { api } from '@/lib/api';
import { userErrorMessage } from '@/lib/problem';
import { apiQueryOptions, queryKeys, unwrap, useApiMutation, useApiQuery } from '@/lib/query';

import { CardNote } from './card-note';
import { SettingRow } from './setting-row';
import { SettingsGroup } from './settings-group';
import { SETTINGS_NODES } from './settings-capabilities';

/** Props for {@link LinearAgentInstallCard}. */
export interface LinearAgentInstallCardProps {
  /** The active organization id. */
  orgId: string;
  /** Whether the caller may install/manage the Linear Agent (org `manage` capability). */
  canManage: boolean;
}

/**
 * The admin-only "Install Athena as a Linear Agent" card.
 *
 * @param props - The {@link LinearAgentInstallCardProps}.
 * @returns the card, or `null` for a viewer who cannot manage the org.
 */
export function LinearAgentInstallCard({
  orgId,
  canManage,
}: LinearAgentInstallCardProps): JSX.Element | null {
  const searchParams = useAppSearchParams();
  const installReturn = searchParams.get('linear_agent');

  const integrationsQ = useApiQuery(
    apiQueryOptions(
      queryKeys.integrations(orgId),
      () => api.v1.orgs[':orgId'].integrations.$get({ param: { orgId } }),
      'Could not load the Linear Agent install status.',
    ),
  );

  const install = useApiMutation({
    mutationFn: () =>
      unwrap(
        () => api.v1.orgs[':orgId'].integrations['linear-agent'].install.$get({ param: { orgId } }),
        'Could not start the Linear Agent install.',
      ),
    onSuccess: (result) => {
      window.location.assign(result.url);
    },
  });

  // Admins/owners only — a regular member has no action to take on a workspace-level app grant,
  // so the section is absent entirely rather than shown read-only or disabled.
  if (!canManage) return null;

  const items: readonly IntegrationOut[] = integrationsQ.data?.items ?? [];
  const existing = items.find((item) => item.provider === 'linear_agent');
  const status = existing?.status;
  const isConnected = status === 'connected';
  // A persisted pending row only means a prior browser redirect did not come back. It must not
  // strand the workspace behind a disabled second step; a fresh click starts Linear's complete
  // installer again and lands on either Installed or a durable error.
  const isPending = install.isPending;
  const isErrored = !install.isPending && status === 'error';
  const workspaceName = existing?.connection.externalWorkspaceName;

  // Pinned beneath the row rather than stacked inside it: a CardNote paints its own full-bleed
  // tonal band, which only reads as one when it spans the group.
  const footer = (
    <>
      {installReturn === 'connected' ? (
        <CardNote tone="muted">Athena was installed as a Linear agent.</CardNote>
      ) : null}
      {isErrored || installReturn === 'error' ? (
        <CardNote tone="error">
          Athena could not be installed as a Linear agent. Try again, or check that the Linear Agent
          app is configured for this workspace.
        </CardNote>
      ) : null}
      {integrationsQ.isError ? (
        <CardNote tone="error">
          {userErrorMessage(integrationsQ.error, 'Could not load the Linear Agent install status.')}
        </CardNote>
      ) : null}
      {install.isError ? (
        <CardNote tone="error">
          {userErrorMessage(install.error, 'Could not start the Linear Agent install.')}
        </CardNote>
      ) : null}
    </>
  );

  return (
    <SettingsGroup capability={SETTINGS_NODES.connectionsAgents} body="rows" footer={footer}>
      <SettingRow
        leading={<DecorativeIcon icon={Sparkles} />}
        label="Athena as a Linear Agent"
        description={
          <>
            Let teammates @-mention and delegate to Athena directly inside Linear.
            {isConnected ? (
              <span className="block">
                {workspaceName ? `Installed to ${workspaceName}` : 'Installed'}
              </span>
            ) : null}
          </>
        }
        trailing={
          integrationsQ.isPending ? (
            <span className="text-on-surface-variant text-body-small">Checking…</span>
          ) : isConnected ? (
            <Badge variant="secondary">Installed</Badge>
          ) : (
            <Button
              controlSize="md"
              variant="outline"
              disabled={isPending}
              onClick={() => {
                install.mutate(undefined);
              }}
            >
              {isPending ? 'Connecting…' : isErrored ? 'Try again' : 'Install'}
            </Button>
          )
        }
      />
    </SettingsGroup>
  );
}
