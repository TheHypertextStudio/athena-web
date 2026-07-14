'use client';

import type { JSX } from 'react';

import GoogleCalendarSettings from '@/components/settings/google-calendar-settings';
import { SectionHeader } from '@/components/settings/section-header';

/** Configure caller-owned Google Calendar sources from the global Connections hierarchy. */
export default function GlobalGoogleCalendarSettingsPage(): JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Google Calendar"
        description="Choose the accounts and calendars Athena can use as data sources."
      />
      <GoogleCalendarSettings />
    </div>
  );
}
