'use client';

/**
 * Shared integration detail content component.
 *
 * Used by both the modal and full-page detail views.
 */

import LinkOutlinedIcon from '@mui/icons-material/LinkOutlined';
import LinkOffOutlinedIcon from '@mui/icons-material/LinkOffOutlined';
import CheckCircleOutlinedIcon from '@mui/icons-material/CheckCircleOutlined';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import { useIntegrations } from '@/hooks/use-integrations';
import { getIntegrationConfig, CATEGORY_INFO } from '@/lib/integrations';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { IntegrationIcon } from './integration-icons';

interface IntegrationDetailContentProps {
  provider: string;
}

/**
 * Detail content for an integration.
 * Shows description, scopes, connection status, and connect/disconnect actions.
 */
export function IntegrationDetailContent({ provider }: IntegrationDetailContentProps) {
  const config = getIntegrationConfig(provider);
  const { integrations, isLoading, connect, isConnecting, disconnect, isDisconnecting } =
    useIntegrations();

  if (!config) {
    return (
      <div className="py-8 text-center">
        <p className="text-on-surface-variant">Integration not found.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-12 w-12 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-24" />
          </div>
        </div>
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const connection = integrations.find((i) => i.provider === provider);
  const isConnected = !!connection;
  const categoryInfo = CATEGORY_INFO[config.category];

  const handleConnect = () => {
    connect({
      provider: config.provider,
      redirectUri: `${window.location.origin}/settings/integrations/detail/${config.provider}`,
    });
  };

  const handleDisconnect = () => {
    if (connection && confirm(`Are you sure you want to disconnect ${config.name}?`)) {
      disconnect(connection.id);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="bg-surface-container flex h-12 w-12 shrink-0 items-center justify-center rounded-xl">
          <IntegrationIcon provider={config.provider} size={24} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-on-surface text-xl font-semibold">{config.name}</h2>
          <Badge variant="outline" className="mt-1">
            {categoryInfo.name}
          </Badge>
        </div>
      </div>

      {/* Description */}
      <div>
        <p className="text-on-surface-variant">{config.description}</p>
      </div>

      {/* Connection Status */}
      {connection && (
        <div className="border-tertiary/30 bg-tertiary/5 rounded-xl border p-4">
          <div className="text-tertiary flex items-center gap-2">
            <CheckCircleOutlinedIcon sx={{ fontSize: 20 }} />
            <span className="font-medium">Connected</span>
          </div>
          <div className="text-on-surface-variant mt-2 space-y-1 text-sm">
            {typeof connection.metadata?.['accountName'] === 'string' && (
              <p>Account: {connection.metadata['accountName']}</p>
            )}
            <p>
              Connected on{' '}
              {new Date(connection.createdAt).toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </p>
          </div>
        </div>
      )}

      {/* Scopes */}
      <div>
        <h3 className="text-on-surface mb-3 flex items-center gap-2 font-medium">
          <LockOutlinedIcon sx={{ fontSize: 18 }} />
          Permissions
        </h3>
        <div className="space-y-2">
          {config.scopes.map((scope) => (
            <div
              key={scope.id}
              className="border-outline-variant bg-surface-container-lowest rounded-lg border p-3"
            >
              <div className="text-on-surface font-medium">{scope.name}</div>
              <div className="text-on-surface-variant text-sm">{scope.description}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Action Button */}
      <div className="pt-2">
        {isConnected ? (
          <Button
            variant="outline"
            onClick={handleDisconnect}
            disabled={isDisconnecting}
            className="w-full"
          >
            <LinkOffOutlinedIcon sx={{ fontSize: 18 }} className="mr-2" />
            {isDisconnecting ? 'Disconnecting...' : 'Disconnect'}
          </Button>
        ) : (
          <Button
            variant="filled"
            onClick={handleConnect}
            disabled={isConnecting}
            className="w-full"
          >
            <LinkOutlinedIcon sx={{ fontSize: 18 }} className="mr-2" />
            {isConnecting ? 'Connecting...' : 'Connect'}
          </Button>
        )}
      </div>
    </div>
  );
}
