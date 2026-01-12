import { getIntegrations, type LinkedIntegration } from '@/lib/integrations-data';
import { ApiError, type ApiErrorCode } from '@/lib/api-errors';
import { CATEGORY_INFO, getIntegrationsByCategory } from '@/lib/integrations';
import type {
  IntegrationCategory,
  IntegrationConnection,
  IntegrationProvider,
} from '@/lib/integrations';
import { SettingsSection, SectionError } from '@/components/settings/settings-section';
import { IntegrationCard } from '@/components/integrations';

const CATEGORY_ORDER: IntegrationCategory[] = [
  'productivity',
  'calendar',
  'communication',
  'storage',
  'design',
];

export async function IntegrationsListSection() {
  let integrations: LinkedIntegration[] = [];
  let errorCode: ApiErrorCode | null = null;

  try {
    const result = await getIntegrations();
    integrations = result.data;
  } catch (e) {
    errorCode = e instanceof ApiError ? e.code : 'unknown';
  }

  if (errorCode) {
    return (
      <SettingsSection title="Integrations" description="Connect your favorite tools.">
        <SectionError code={errorCode} />
      </SettingsSection>
    );
  }

  const getConnection = (provider: string): IntegrationConnection | null => {
    const connection = integrations.find((i) => i.provider === provider);
    if (!connection) return null;
    const accountName = connection.metadata?.accountName;
    return {
      id: connection.id,
      provider: connection.provider as IntegrationProvider,
      accountName: typeof accountName === 'string' ? accountName : undefined,
      connectedAt: connection.createdAt,
    };
  };

  return (
    <div className="space-y-6">
      {CATEGORY_ORDER.map((category) => {
        const categoryIntegrations = getIntegrationsByCategory(category);
        if (categoryIntegrations.length === 0) return null;

        const categoryInfo = CATEGORY_INFO[category];

        return (
          <SettingsSection
            key={category}
            title={categoryInfo.name}
            description={categoryInfo.description}
          >
            <div className="space-y-3">
              {categoryIntegrations.map((config) => (
                <IntegrationCard
                  key={config.provider}
                  config={config}
                  connection={getConnection(config.provider)}
                />
              ))}
            </div>
          </SettingsSection>
        );
      })}
    </div>
  );
}
