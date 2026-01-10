import {
  getAIPreferences,
  getAIProviders,
  type AIPreferences,
  type AIProvidersInfo,
} from '@/lib/ai-data';
import { ApiError, type ApiErrorCode } from '@/lib/api-errors';
import { SettingsSection, SettingsRow, SectionError } from '@/components/settings/settings-section';
import { ProviderSelectionActions } from './provider-selection-actions';

export async function ProviderSelectionSection() {
  let preferences: AIPreferences | null = null;
  let providers: AIProvidersInfo | null = null;
  let errorCode: ApiErrorCode | null = null;

  try {
    const [prefsResult, providersResult] = await Promise.all([
      getAIPreferences(),
      getAIProviders(),
    ]);
    preferences = prefsResult.data;
    providers = providersResult.data;
  } catch (e) {
    errorCode = e instanceof ApiError ? e.code : 'unknown';
  }

  if (errorCode || !preferences || !providers) {
    return (
      <SettingsSection
        title="AI Provider"
        description="Choose which AI provider powers Athena's intelligence."
      >
        <SectionError code={errorCode ?? 'unknown'} />
      </SettingsSection>
    );
  }

  const currentProvider = preferences.preferredProvider ?? providers.default;
  const availableProviders = providers.providers;

  return (
    <SettingsSection
      title="AI Provider"
      description="Choose which AI provider powers Athena's intelligence."
    >
      <SettingsRow
        label="Preferred Provider"
        description="The AI service used for suggestions and assistance"
      >
        <ProviderSelectionActions
          currentProvider={currentProvider}
          availableProviders={availableProviders}
        />
      </SettingsRow>
    </SettingsSection>
  );
}
