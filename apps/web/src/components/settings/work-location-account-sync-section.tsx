'use client';

/** Connected-account status for bidirectional work-schedule exchange. */
import { Calendar, Google } from '@docket/ui/icons';
import { EmptyState } from '@docket/ui/components';
import { Button, DecorativeIcon } from '@docket/ui/primitives';
import type { JSX } from 'react';

import Link from '@/components/docket-link';
import { workLocationSyncDef } from '@/components/work-location/work-location-data';
import { useApiQuery } from '@/lib/query';

import { SETTINGS_NODES } from './settings-capabilities';
import { SettingsGroup } from './settings-group';
import { SettingRow } from './setting-row';
import { isActionable, syncStateCopy } from './work-location-copy';

function actionLabel(reason: string | null): string {
  if (reason === 'missing_scope') return 'Grant access';
  if (reason === 'reauth_required') return 'Reconnect';
  if (reason === 'unsupported_recurrence') return 'Open calendar settings';
  return 'Fix connection';
}

/** Show work-schedule capability and recovery next to the account that owns the grant. */
export function WorkLocationAccountSyncSection(): JSX.Element {
  const syncQ = useApiQuery(workLocationSyncDef());
  return (
    <SettingsGroup capability={SETTINGS_NODES.connectedAccountsWorkSchedule} body="rows">
      {(syncQ.data?.accounts ?? []).map((account) => (
        <SettingRow
          key={account.connectionId}
          leading={<DecorativeIcon icon={account.provider === 'google' ? Google : Calendar} />}
          label={account.accountLabel ?? account.provider}
          description={syncStateCopy(account.state, account.reason)}
          trailing={
            isActionable(account.state, account.reason) ? (
              <Button asChild variant="outline" size="sm">
                <Link href="/settings/connections/google-calendar">
                  {actionLabel(account.reason)}
                </Link>
              </Button>
            ) : undefined
          }
        />
      ))}
      {syncQ.data?.accounts.length === 0 ? (
        <EmptyState
          icon={Google}
          title="No calendar account linked"
          body="Link a Google account if you want working-location changes to stay aligned."
          frame="none"
          action={
            <Button asChild variant="outline" size="sm">
              <Link href="/settings/connections/google-calendar">Link Google account</Link>
            </Button>
          }
        />
      ) : null}
    </SettingsGroup>
  );
}
