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
import type { IntegrationOut } from '@docket/types';
import { Sparkles } from '@docket/ui/icons';
import { Badge } from '@docket/ui/primitives';
import { useSearchParams } from 'next/navigation';
import type { JSX } from 'react';

import { api } from '@/lib/api';
import { userErrorMessage } from '@/lib/problem';
import { apiQueryOptions, queryKeys, unwrap, useApiMutation, useApiQuery } from '@/lib/query';

import { CardNote } from './card-note';
import { IntegrationActionButton } from './integration-action-button';

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
  const searchParams = useSearchParams();
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
  const isPending = install.isPending || status === 'pending';
  const isErrored = !install.isPending && status === 'error';
  const workspaceName = existing?.connection.externalWorkspaceName;

  return (
    <section aria-label="Agents" className="flex flex-col gap-3">
      <h2 className="text-on-surface-variant text-xs font-medium">Agents</h2>
      <div className="bg-surface-container-low overflow-hidden rounded-xl">
        <div className="flex flex-wrap items-center gap-3 p-4 sm:flex-nowrap">
          <span className="bg-surface-container text-on-surface-variant flex size-9 shrink-0 items-center justify-center rounded-lg">
            <Sparkles aria-hidden="true" className="size-4" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-on-surface text-body-medium font-medium">
              Athena as a Linear Agent
            </span>
            <span className="text-on-surface-variant text-xs">
              Let teammates @-mention and delegate to Athena directly inside Linear.
            </span>
            {isConnected ? (
              <span className="text-on-surface-variant text-xs">
                {workspaceName ? `Installed to ${workspaceName}` : 'Installed'}
              </span>
            ) : null}
          </div>
          {integrationsQ.isPending ? (
            <span className="text-on-surface-variant text-xs">Checking…</span>
          ) : isConnected ? (
            <Badge variant="secondary" className="shrink-0">
              Installed
            </Badge>
          ) : (
            <IntegrationActionButton
              tone="primary"
              disabled={isPending}
              onClick={() => {
                install.mutate(undefined);
              }}
            >
              {isPending
                ? 'Connecting…'
                : isErrored
                  ? 'Try again'
                  : 'Install Athena as a Linear Agent'}
            </IntegrationActionButton>
          )}
        </div>

        {installReturn === 'connected' ? (
          <CardNote tone="muted">Athena was installed as a Linear agent.</CardNote>
        ) : null}

        {isErrored || installReturn === 'error' ? (
          <CardNote tone="error">
            Athena could not be installed as a Linear agent. Try again, or check that the Linear
            Agent app is configured for this workspace.
          </CardNote>
        ) : null}

        {integrationsQ.isError ? (
          <CardNote tone="error">
            {userErrorMessage(
              integrationsQ.error,
              'Could not load the Linear Agent install status.',
            )}
          </CardNote>
        ) : null}

        {install.isError ? (
          <CardNote tone="error">
            {userErrorMessage(install.error, 'Could not start the Linear Agent install.')}
          </CardNote>
        ) : null}
      </div>
    </section>
  );
}
