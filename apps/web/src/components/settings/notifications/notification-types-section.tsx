import { getNotificationPreferences, type NotificationPreferences } from '@/lib/notifications-data';
import { ApiError, type ApiErrorCode } from '@/lib/api-errors';
import { SettingsSection, SectionError } from '@/components/settings/settings-section';
import { NotificationTypesActions } from './notification-types-actions';

export async function NotificationTypesSection() {
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
      <SettingsSection
        title="Notification Types"
        description="Choose which notifications to receive."
      >
        <SectionError code={errorCode ?? 'unknown'} />
      </SettingsSection>
    );
  }

  return (
    <SettingsSection
      title="Notification Types"
      description="Choose which notifications to receive."
    >
      <NotificationTypesActions
        taskDeadlineReminders={preferences.taskDeadlineReminders}
        eventReminders={preferences.eventReminders}
        dailyPlanningReminder={preferences.dailyPlanningReminder}
        weeklyReviewReminder={preferences.weeklyReviewReminder}
      />
    </SettingsSection>
  );
}
