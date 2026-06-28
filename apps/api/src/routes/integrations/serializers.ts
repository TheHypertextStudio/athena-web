/**
 * Integration route serializers.
 *
 * @packageDocumentation
 */

import type {
  IntegrationMapping,
  LinkedIntegration,
} from '@athena/types/openapi/integrations';
import type { linkedIntegrations } from '../../db/schema/index.js';
import type { ExternalMapping, SyncDirection } from '../../services/sync/mapping-service.js';

type ApiSyncDirection = 'pull' | 'push' | 'bidirectional';
type LinkedIntegrationRow = Pick<
  typeof linkedIntegrations.$inferSelect,
  'id' | 'provider' | 'externalAccountId' | 'scopes' | 'metadata' | 'createdAt' | 'updatedAt'
>;

const toApiSyncDirection = (direction: SyncDirection): ApiSyncDirection => {
  switch (direction) {
    case 'inbound':
      return 'pull';
    case 'outbound':
      return 'push';
    case 'bidirectional':
      return 'bidirectional';
  }
};

export const toIntegrationMapping = (mapping: ExternalMapping): IntegrationMapping => ({
  id: mapping.id,
  integrationId: mapping.integrationId,
  entityType: mapping.entityType,
  localEntityId: mapping.localEntityId,
  externalId: mapping.externalId,
  syncDirection: toApiSyncDirection(mapping.syncDirection),
  externalVersion: mapping.externalVersion,
  lastSyncedFromExternal: mapping.lastSyncedFromExternal,
  lastSyncedToExternal: mapping.lastSyncedToExternal,
  metadata: mapping.metadata,
  createdAt: mapping.createdAt,
  updatedAt: mapping.updatedAt,
});

export const toLinkedIntegration = (
  integration: LinkedIntegrationRow,
): LinkedIntegration => {
  const metadata =
    integration.metadata && typeof integration.metadata === 'object'
      ? (integration.metadata as Record<string, unknown>)
      : null;

  return {
    id: integration.id,
    provider: integration.provider,
    externalAccountId: integration.externalAccountId,
    scopes: integration.scopes ?? null,
    metadata,
    createdAt: integration.createdAt,
    updatedAt: integration.updatedAt,
  };
};

export const toServiceSyncDirection = (direction: ApiSyncDirection): SyncDirection => {
  switch (direction) {
    case 'pull':
      return 'inbound';
    case 'push':
      return 'outbound';
    case 'bidirectional':
      return 'bidirectional';
  }
};
