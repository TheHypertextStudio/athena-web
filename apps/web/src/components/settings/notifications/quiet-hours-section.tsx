import { getNotificationPreferences, type NotificationPreferences } from '@/lib/notifications-data';
import { ApiError, type ApiErrorCode } from '@/lib/api-errors';
import { SettingsSection, SectionError } from '@/components/settings/settings-section';
import { QuietHoursActions } from './quiet-hours-actions';

export async function QuietHoursSection() {
  let preferences: NotificationPreferences | null = null;
  let errorCode: ApiErrorCode | null = null;

  try {
    const result = await getNotificationPreferences();
    preferences = result.data;
  } catch (e) {
    errorCode = e instanceof ApiError ? e.code : 'unknown';
  }

  if (errorCode || !preferences) {
    return (
      <SettingsSection title="Quiet Hours" description="Pause notifications during specific times.">
        <SectionError code={errorCode ?? 'unknown'} />
      </SettingsSection>
    );
  }

  return (
    <SettingsSection title="Quiet Hours" description="Pause notifications during specific times.">
      <QuietHoursActions
        quietHoursEnabled={preferences.quietHoursEnabled}
        quietHoursStart={preferences.quietHoursStart ?? '22:00'}
        quietHoursEnd={preferences.quietHoursEnd ?? '08:00'}
        quietHoursTimezone={preferences.quietHoursTimezone ?? 'UTC'}
      />
    </SettingsSection>
  );
}
