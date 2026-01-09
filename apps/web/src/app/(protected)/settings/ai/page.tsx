'use client';

import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined';
import CheckCircleOutlinedIcon from '@mui/icons-material/CheckCircleOutlined';
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined';
import { useAIPreferences } from '@/hooks/use-ai';
import {
  SettingsSection,
  SettingsRow,
  SettingsItemCard,
} from '@/components/settings/settings-section';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { AIProvider } from '@/lib/api-client';

const PROVIDER_NAMES: Record<AIProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
};

const PROVIDER_DESCRIPTIONS: Record<AIProvider, string> = {
  openai: 'GPT-4 and other OpenAI models',
  anthropic: 'Claude and other Anthropic models',
};

export default function AISettingsPage() {
  const { preferences, isLoadingPreferences, providers, isLoadingProviders, update, isUpdating } =
    useAIPreferences();

  const isLoading = isLoadingPreferences || isLoadingProviders;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-[200px] w-full" />
        <Skeleton className="h-[150px] w-full" />
      </div>
    );
  }

  const availableProviders = providers?.providers ?? [];
  const defaultProvider = providers?.default;

  const handleProviderChange = (provider: AIProvider) => {
    update({ preferredProvider: provider });
  };

  return (
    <div className="space-y-6">
      {/* Provider Selection */}
      <SettingsSection
        title="AI Provider"
        description="Choose which AI provider powers Athena's intelligence."
      >
        <SettingsRow
          label="Preferred Provider"
          description="The AI service used for suggestions and assistance"
        >
          <Select
            value={preferences?.preferredProvider ?? defaultProvider ?? 'openai'}
            onValueChange={(value) => {
              handleProviderChange(value as AIProvider);
            }}
            disabled={isUpdating || availableProviders.length === 0}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Select provider" />
            </SelectTrigger>
            <SelectContent>
              {availableProviders.map((provider) => (
                <SelectItem key={provider} value={provider}>
                  {PROVIDER_NAMES[provider]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
      </SettingsSection>

      {/* Provider Status */}
      <SettingsSection
        title="Available Providers"
        description="AI providers configured for your account."
      >
        <div className="space-y-3">
          {(['openai', 'anthropic'] as AIProvider[]).map((provider) => {
            const isAvailable = availableProviders.includes(provider);
            const isDefault = provider === defaultProvider;
            const isSelected = provider === (preferences?.preferredProvider ?? defaultProvider);

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
    </div>
  );
}
