'use client';

/** Nested Google Calendar configuration page. */
import type { JSX } from 'react';

import GoogleCalendarSettings from '@/components/settings/google-calendar-settings';
import { useConnectionsParent } from '@/components/settings/use-connections-parent';
import { useAppParams } from '@/lib/app-location';
import { SettingsSectionPage } from '@/components/settings/settings-section-page';

/** Configure first-party Google Calendar accounts and visible calendars. */
export default function GoogleCalendarSettingsPage(): JSX.Element {
  const { orgId } = useAppParams<{ orgId: string }>();
  const parent = useConnectionsParent(orgId);

  return (
    <SettingsSectionPage
      title="Google Calendar"
      description="Choose which linked Google calendars appear in agenda views."
      parent={parent}
    >
      <GoogleCalendarSettings />
    </SettingsSectionPage>
  );
}
