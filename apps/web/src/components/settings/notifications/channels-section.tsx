import { getNotificationPreferences, type NotificationPreferences } from '@/lib/notifications-data';
import { ApiError, type ApiErrorCode } from '@/lib/api-errors';
import { SettingsSection, SectionError } from '@/components/settings/settings-section';
import { ChannelsActions } from './channels-actions';

export async function ChannelsSection() {
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
      <SettingsSection title="Channels" description="Choose how you want to receive notifications.">
        <SectionError code={errorCode ?? 'unknown'} />
      </SettingsSection>
    );
  }

  return (
    <SettingsSection title="Channels" description="Choose how you want to receive notifications.">
      <ChannelsActions
        emailEnabled={preferences.emailEnabled}
        pushEnabled={preferences.pushEnabled}
        smsEnabled={preferences.smsEnabled}
        slackEnabled={preferences.slackEnabled}
        inAppEnabled={preferences.inAppEnabled}
      />
    </SettingsSection>
  );
}
