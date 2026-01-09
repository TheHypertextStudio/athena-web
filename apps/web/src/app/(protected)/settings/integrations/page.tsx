'use client';

/**
 * Integrations settings page.
 *
 * Displays all available integrations grouped by category.
 * Each integration card links to a detail view (modal when navigating, full page on direct link).
 */

import { useIntegrations } from '@/hooks/use-integrations';
import { CATEGORY_INFO, getIntegrationsByCategory } from '@/lib/integrations';
import type { IntegrationCategory, IntegrationConnection } from '@/lib/integrations';
import { SettingsSection } from '@/components/settings/settings-section';
import { IntegrationCard } from '@/components/integrations';
import { Skeleton } from '@/components/ui/skeleton';

const CATEGORY_ORDER: IntegrationCategory[] = [
  'productivity',
  'calendar',
  'communication',
  'storage',
  'design',
];

export default function IntegrationsSettingsPage() {
  const { integrations, isLoading } = useIntegrations();

  const getConnection = (provider: string): IntegrationConnection | null => {
    const connection = integrations.find((i) => i.provider === provider);
    if (!connection) return null;
    const accountName = connection.metadata?.['accountName'];
    return {
      id: connection.id,
      provider: connection.provider,
      accountName: typeof accountName === 'string' ? accountName : undefined,
      connectedAt: connection.createdAt,
    };
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        {CATEGORY_ORDER.map((category) => (
          <div key={category} className="space-y-3">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-64" />
            <div className="space-y-3 pt-2">
              <Skeleton className="h-[72px] w-full rounded-xl" />
              <Skeleton className="h-[72px] w-full rounded-xl" />
            </div>
          </div>
        ))}
      </div>
    );
  }

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
