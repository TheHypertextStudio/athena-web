'use client';

/**
 * `settings` — the **Creating** group on the personal Profile page.
 *
 * @remarks
 * One row today: whether opening a create composer reopens the newest pending draft of that kind.
 * The value is the `composer.resumeDrafts` group of the caller's Hub preferences, read through the
 * shared `hubPreferences` key and written with a focused PATCH that the API deep-merges, so the
 * toggle never erases a sibling preference group.
 */
import type { HubPreferences } from '@docket/planning/hub-preferences-contract';
import { Switch } from '@docket/ui/primitives';
import type { JSX } from 'react';

import { api } from '@/lib/api';
import { userErrorMessage } from '@/lib/problem';
import { apiQueryOptions, queryKeys, unwrap, useApiMutation, useLiveApiQuery } from '@/lib/query';

import { LoadFailure } from './load-failure';
import { SettingRow } from './setting-row';
import { SettingRowStatus } from './setting-row-status';
import { SETTINGS_NODES } from './settings-capabilities';
import { SettingsGroup } from './settings-group';

/** How often the preference read refreshes while the Profile page is on screen. */
const HUB_PREFERENCES_POLL_MS = 15_000;

const LOAD_FALLBACK = 'Could not load your creating preferences.';
const SAVE_FALLBACK = 'Could not save your creating preferences.';

/** The stored value, or the value a save in flight is about to store. */
function resolveChecked(persisted: boolean, pendingPatch: HubPreferences | undefined): boolean {
  if (pendingPatch?.composer?.resumeDrafts === undefined) return persisted;
  return pendingPatch.composer.resumeDrafts;
}

/** The Creating group: composer behavior the signed-in user owns. */
export function ComposerPreferencesSection(): JSX.Element {
  const preferencesQ = useLiveApiQuery(
    apiQueryOptions(queryKeys.hubPreferences(), () => api.v1.hub.preferences.$get(), LOAD_FALLBACK),
    HUB_PREFERENCES_POLL_MS,
  );
  const save = useApiMutation<HubPreferences, HubPreferences>({
    mutationFn: (json) => unwrap(() => api.v1.hub.preferences.$patch({ json }), SAVE_FALLBACK),
    invalidateKeys: [queryKeys.hubPreferences()],
  });

  const persisted = preferencesQ.data?.composer?.resumeDrafts === true;
  const checked = resolveChecked(persisted, save.isPending ? save.variables : undefined);

  return (
    <SettingsGroup
      capability={SETTINGS_NODES.profileCreating}
      body="rows"
      action={
        <SettingRowStatus
          pending={save.isPending}
          saved={save.isSuccess}
          {...(save.isError ? { error: userErrorMessage(save.error, SAVE_FALLBACK) } : {})}
        />
      }
    >
      {preferencesQ.isError ? (
        <LoadFailure message={userErrorMessage(preferencesQ.error, LOAD_FALLBACK)} retrying />
      ) : (
        <SettingRow
          label="Resume drafts when creating"
          description="Open a composer with your newest unsaved draft of that kind. Drafts stay available from the Drafts chip and page either way."
          trailing={
            <Switch
              aria-label="Resume drafts when creating"
              checked={checked}
              disabled={preferencesQ.isPending || save.isPending}
              onCheckedChange={(resumeDrafts) => {
                save.mutate({ composer: { resumeDrafts } });
              }}
            />
          }
        />
      )}
    </SettingsGroup>
  );
}
