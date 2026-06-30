'use client';

/** Nested Google Calendar configuration page. */
import { use, type JSX } from 'react';

import { GoogleCalendarSettings } from '@/components/settings/google-calendar-settings';
import { SectionHeader } from '@/components/settings/section-header';

/** Configure first-party Google Calendar accounts and visible calendars. */
export default function GoogleCalendarSettingsPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}): JSX.Element {
  use(params);
  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Google Calendar"
        description="Choose which linked Google calendars appear in agenda views."
      />
      <GoogleCalendarSettings />
    </div>
  );
}
