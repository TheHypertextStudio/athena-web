'use client';

import type { JSX } from 'react';

import GoogleCalendarSettings from '@/components/settings/google-calendar-settings';
import { SettingsSectionPage } from '@/components/settings/settings-section-page';

/** Configure caller-owned Google Calendar sources from the global Connections hierarchy. */
export default function GlobalGoogleCalendarSettingsPage(): JSX.Element {
  return (
    <SettingsSectionPage
      title="Google Calendar"
      description="Choose the accounts and calendars Athena can use as data sources."
    >
      <GoogleCalendarSettings />
    </SettingsSectionPage>
  );
}
