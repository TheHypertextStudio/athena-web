'use client';

/**
 * A dismissible sidebar banner prompting the user to reconnect integrations whose credentials
 * expired or failed decryption after a key rotation.
 */
import type { IntegrationOut } from '@docket/connections/integration-contract';
import { InlineBanner } from '@docket/ui/components';
import { Cable } from '@docket/ui/icons';
import { type JSX, useEffect, useState } from 'react';

import { sectionHref } from '@/components/settings/settings-registry';
import { api } from '@/lib/api';
import { useAppRouter as useRouter } from '@/lib/interactions/navigation';
import { fetchAllIntegrations } from '@/lib/org-collection-pages';
import { STALE, apiQueryOptions, queryKeys, useApiQuery } from '@/lib/query';

/** Props for {@link IntegrationReauthBanner}. */
export interface IntegrationReauthBannerProps {
  /** Active workspace id; null hides the banner. */
  orgId: string | null;
}

/**
 * Show a compact banner whenever one or more integrations in the active workspace require
 * reconnection (`status === 'error'` with `lastErrorKind === 'auth'`).
 */
export function IntegrationReauthBanner({
  orgId,
}: IntegrationReauthBannerProps): JSX.Element | null {
  const router = useRouter();
  const [dismissedSignature, setDismissedSignature] = useState<string | null>(null);

  const integrationsQ = useApiQuery(
    apiQueryOptions(
      queryKeys.integrations(orgId ?? 'none'),
      () => fetchAllIntegrations(api, orgId ?? ''),
      'Could not load integration status.',
      { enabled: Boolean(orgId), staleTime: STALE.volatile },
    ),
  );

  const items: readonly IntegrationOut[] = integrationsQ.data?.items ?? [];
  const broken = items.filter((item) => item.status === 'error' && item.lastErrorKind === 'auth');
  const signature = broken
    .map((item) => item.id)
    .sort()
    .join(',');

  // Self-reset when the broken set changes or clears so a new auth failure re-prompts.
  useEffect(() => {
    if (signature.length === 0 && dismissedSignature !== null) {
      setDismissedSignature(null);
    }
  }, [signature, dismissedSignature]);

  if (!orgId || broken.length === 0 || dismissedSignature === signature) return null;

  const count = broken.length;
  const title =
    count === 1 ? '1 connection needs attention' : `${String(count)} connections need attention`;
  const message =
    count === 1
      ? 'Reconnect this integration in Settings to restore syncing and tools.'
      : 'Reconnect these integrations in Settings to restore syncing and tools.';

  return (
    <InlineBanner
      tone="critical"
      title={title}
      icon={<Cable aria-hidden="true" className="size-4" />}
      action={{
        label: 'Review connections',
        onSelect: () => {
          router.push(sectionHref(orgId, 'connections'));
        },
      }}
      dismissLabel="Dismiss connection reminder"
      onDismiss={() => {
        setDismissedSignature(signature);
      }}
    >
      {message}
    </InlineBanner>
  );
}
