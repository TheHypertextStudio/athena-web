import { getUserSettings, type UserSettings } from '@/lib/account-data';
import { ApiError, type ApiErrorCode } from '@/lib/api-errors';
import { SettingsSection, SectionError } from '@/components/settings/settings-section';
import { PreferencesActions } from './preferences-actions';

export async function PreferencesSection() {
  let settings: UserSettings | null = null;
  let errorCode: ApiErrorCode | null = null;

  try {
    const result = await getUserSettings();
    settings = result.data;
  } catch (e) {
    errorCode = e instanceof ApiError ? e.code : 'unknown';
  }

  if (errorCode || !settings) {
    return (
      <SettingsSection title="Preferences" description="Customize your daily planning experience.">
        <SectionError code={errorCode ?? 'unknown'} />
      </SettingsSection>
    );
  }

  return (
    <SettingsSection title="Preferences" description="Customize your daily planning experience.">
      <PreferencesActions
        storedTimezone={settings.timezone}
        dailyPlanningTime={settings.dailyPlanningTime}
        dailyReviewTime={settings.dailyReviewTime}
      />
    </SettingsSection>
  );
}
