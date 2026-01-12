/**
 * Integration card component for the integrations list.
 */

import ChevronRightOutlinedIcon from '@mui/icons-material/ChevronRightOutlined';
import { LinkButton } from '@/components/ui/link-button';
import { Badge } from '@/components/ui/badge';
import { IntegrationIcon } from './integration-icons';
import type { IntegrationConfig, IntegrationConnection } from '@/lib/integrations';

interface IntegrationCardProps {
  config: IntegrationConfig;
  connection: IntegrationConnection | null;
}

/**
 * Card component for displaying an integration in the list view.
 * Links to the integration detail page/modal.
 */
export function IntegrationCard({ config, connection }: IntegrationCardProps) {
  const isConnected = !!connection;

  return (
    <LinkButton
      href={`/settings/integrations/detail/${config.provider}`}
      variant="text"
      className="group bg-surface-container-low hover:bg-surface-container flex h-auto w-full items-center justify-start gap-4 rounded-xl p-4"
    >
      <div className="bg-surface-container flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
        <IntegrationIcon provider={config.provider} size={20} />
      </div>
      <div className="min-w-0 flex-1 text-left">
        <div className="flex items-center gap-2">
          <span className="text-on-surface font-medium">{config.name}</span>
          {isConnected && (
            <Badge variant="secondary" className="text-xs">
              Connected
            </Badge>
          )}
        </div>
        <p className="text-on-surface-variant truncate text-sm">{config.shortDescription}</p>
      </div>
      <ChevronRightOutlinedIcon
        sx={{ fontSize: 20 }}
        className="text-on-surface-variant shrink-0 transition-transform group-hover:translate-x-0.5"
      />
    </LinkButton>
  );
}
