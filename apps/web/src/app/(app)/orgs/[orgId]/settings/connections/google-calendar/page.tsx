'use client';

/** Nested Google Calendar configuration page. */
import type { JSX } from 'react';

import GoogleCalendarSettings from '@/components/settings/google-calendar-settings';
import { SettingsSectionPage } from '@/components/settings/settings-section-page';

/** Configure first-party Google Calendar accounts and visible calendars. */
export default function GoogleCalendarSettingsPage(): JSX.Element {
  return (
    <SettingsSectionPage
      title="Google Calendar"
      description="Choose which linked Google calendars appear in agenda views."
    >
      <GoogleCalendarSettings />
    </SettingsSectionPage>
  );
}
