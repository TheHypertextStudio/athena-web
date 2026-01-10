import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined';
import CheckCircleOutlinedIcon from '@mui/icons-material/CheckCircleOutlined';
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined';
import {
  getAIPreferences,
  getAIProviders,
  type AIProvider,
  type AIPreferences,
  type AIProvidersInfo,
} from '@/lib/ai-data';
import { ApiError, type ApiErrorCode } from '@/lib/api-errors';
import {
  SettingsSection,
  SettingsItemCard,
  SectionError,
} from '@/components/settings/settings-section';

const PROVIDER_NAMES: Record<AIProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
};

const PROVIDER_DESCRIPTIONS: Record<AIProvider, string> = {
  openai: 'GPT-4 and other OpenAI models',
  anthropic: 'Claude and other Anthropic models',
};

const ALL_PROVIDERS: AIProvider[] = ['openai', 'anthropic'];

export async function AvailableProvidersSection() {
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
        title="Available Providers"
        description="AI providers configured for your account."
      >
        <SectionError code={errorCode ?? 'unknown'} />
      </SettingsSection>
    );
  }

  const availableProviders = providers.providers;
  const defaultProvider = providers.default;
  const selectedProvider = preferences.preferredProvider ?? defaultProvider;

  return (
    <SettingsSection
      title="Available Providers"
      description="AI providers configured for your account."
    >
      <div className="space-y-3">
        {ALL_PROVIDERS.map((provider) => {
          const isAvailable = availableProviders.includes(provider);
          const isDefault = provider === defaultProvider;
          const isSelected = provider === selectedProvider;

          return (
            <SettingsItemCard
              key={provider}
              icon={<AutoAwesomeOutlinedIcon sx={{ fontSize: 20 }} />}
              title={PROVIDER_NAMES[provider]}
              description={PROVIDER_DESCRIPTIONS[provider]}
              badge={
                isSelected ? (
                  <span className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-xs font-medium">
                    Selected
                  </span>
                ) : isDefault ? (
                  <span className="text-on-surface-variant text-xs">(Default)</span>
                ) : undefined
              }
              action={
                isAvailable ? (
                  <div className="text-tertiary flex items-center gap-1 text-sm">
                    <CheckCircleOutlinedIcon sx={{ fontSize: 16 }} />
                    Configured
                  </div>
                ) : (
                  <div className="text-on-surface-variant flex items-center gap-1 text-sm">
                    <CancelOutlinedIcon sx={{ fontSize: 16 }} />
                    Not configured
                  </div>
                )
              }
            />
          );
        })}
      </div>
      <p className="text-on-surface-variant mt-4 text-sm">
        Contact your administrator to configure additional AI providers.
      </p>
    </SettingsSection>
  );
}
