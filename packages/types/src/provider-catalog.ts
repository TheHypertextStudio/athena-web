/**
 * `@docket/types` - pure provider capability catalog.
 *
 * @remarks
 * This file intentionally carries no server/runtime dependencies. API routes and web UI code can
 * share provider ids, capability flags, and identity/source mappings without importing adapter
 * implementations from `@docket/integrations`.
 */
import type { SourceSystemKind } from './event';
import type { IdentityProvider } from './identity';
import type { IntegrationPattern, IntegrationRole } from './integration';

/** Provider ids that expose the Connector port. */
export const CONNECTOR_PROVIDER_IDS = [
  'github',
  'drive',
  'linear',
  'gmail',
  'calendar',
  'gtasks',
  'outlook',
] as const;
/** Connector-provider id value. */
export type ConnectorProviderId = (typeof CONNECTOR_PROVIDER_IDS)[number];

/** Provider ids that expose an inbound webhook observer. */
export const WEBHOOK_PROVIDER_IDS = ['github', 'linear', 'slack', 'discord'] as const;
/** Webhook-provider id value. */
export type WebhookProviderId = (typeof WEBHOOK_PROVIDER_IDS)[number];

/** Provider ids shown in the Connections directory. */
export const DIRECTORY_PROVIDER_IDS = [...CONNECTOR_PROVIDER_IDS, 'slack'] as const;
/** Directory-provider id value. */
export type DirectoryProviderId = (typeof DIRECTORY_PROVIDER_IDS)[number];

/** Static provider metadata shared by API and web surfaces. */
export interface ProviderCatalogEntry {
  /** Stable provider id. */
  readonly id: DirectoryProviderId | 'discord';
  /** Human-readable provider name. */
  readonly name: string;
  /** Whether this provider exposes connector sync/import. */
  readonly connector: boolean;
  /** Whether this provider has inbound webhook observation. */
  readonly webhook: boolean;
  /** Whether this provider is shown in the Connections directory. */
  readonly directory: boolean;
  /** The connect-directory relationship pattern. */
  readonly pattern: IntegrationPattern;
  /** Roles the provider contributes when connected. */
  readonly roles: readonly IntegrationRole[];
  /** Connect-directory grouping key. */
  readonly category: string;
  /** Canonical event source-system badge, when the provider emits events. */
  readonly sourceSystem: SourceSystemKind | null;
  /** Better Auth identity provider that funds API access for connector calls. */
  readonly connectorIdentityProvider: IdentityProvider | null;
  /** Better Auth identity provider that can resolve external event participants. */
  readonly sourceIdentityProvider: IdentityProvider | null;
}

/** Shared provider catalog keyed by provider id. */
export const PROVIDER_CATALOG = {
  slack: {
    id: 'slack',
    name: 'Slack',
    connector: false,
    webhook: true,
    directory: true,
    pattern: 'connector',
    roles: ['signal'],
    category: 'communication',
    sourceSystem: 'slack',
    connectorIdentityProvider: null,
    sourceIdentityProvider: null,
  },
  github: {
    id: 'github',
    name: 'GitHub',
    connector: true,
    webhook: true,
    directory: true,
    pattern: 'connector',
    roles: ['code', 'work'],
    category: 'engineering',
    sourceSystem: 'github',
    connectorIdentityProvider: 'github',
    sourceIdentityProvider: 'github',
  },
  linear: {
    id: 'linear',
    name: 'Linear',
    connector: true,
    webhook: true,
    directory: true,
    pattern: 'connector',
    roles: ['work'],
    category: 'project-management',
    sourceSystem: 'linear',
    connectorIdentityProvider: 'linear',
    sourceIdentityProvider: 'linear',
  },
  drive: {
    id: 'drive',
    name: 'Google Drive',
    connector: true,
    webhook: false,
    directory: true,
    pattern: 'connector',
    roles: ['context'],
    category: 'documents',
    sourceSystem: null,
    connectorIdentityProvider: 'google',
    sourceIdentityProvider: null,
  },
  gmail: {
    id: 'gmail',
    name: 'Gmail',
    connector: true,
    webhook: false,
    directory: true,
    pattern: 'connector',
    roles: ['signal'],
    category: 'communication',
    sourceSystem: 'gmail',
    connectorIdentityProvider: 'google',
    sourceIdentityProvider: 'google',
  },
  calendar: {
    id: 'calendar',
    name: 'Google Calendar',
    connector: true,
    webhook: false,
    directory: true,
    pattern: 'connector',
    roles: ['time'],
    category: 'communication',
    sourceSystem: 'google_calendar',
    connectorIdentityProvider: 'google',
    sourceIdentityProvider: 'google',
  },
  gtasks: {
    id: 'gtasks',
    name: 'Google Tasks',
    connector: true,
    webhook: false,
    directory: true,
    pattern: 'connector',
    roles: ['work'],
    category: 'project-management',
    sourceSystem: null,
    connectorIdentityProvider: 'google',
    sourceIdentityProvider: null,
  },
  outlook: {
    id: 'outlook',
    name: 'Outlook',
    connector: true,
    webhook: false,
    directory: true,
    pattern: 'connector',
    roles: ['signal'],
    category: 'communication',
    sourceSystem: 'outlook',
    connectorIdentityProvider: 'microsoft',
    sourceIdentityProvider: null,
  },
  discord: {
    id: 'discord',
    name: 'Discord',
    connector: false,
    webhook: true,
    directory: false,
    pattern: 'connector',
    roles: ['signal'],
    category: 'communication',
    sourceSystem: 'discord',
    connectorIdentityProvider: null,
    sourceIdentityProvider: 'discord',
  },
} as const satisfies Record<DirectoryProviderId | 'discord', ProviderCatalogEntry>;

/** Return the canonical source-system badge for a provider, if it emits events. */
export function providerSourceSystem(
  provider: DirectoryProviderId | 'discord',
): SourceSystemKind | null {
  return PROVIDER_CATALOG[provider].sourceSystem;
}

/** Return the Better Auth provider whose grant funds a connector provider. */
export function connectorIdentityProvider(provider: ConnectorProviderId): IdentityProvider {
  return PROVIDER_CATALOG[provider].connectorIdentityProvider;
}

/** Return the linked identity provider that can resolve participants from an event source. */
export function sourceIdentityProvider(source: SourceSystemKind): IdentityProvider | null {
  for (const entry of Object.values(PROVIDER_CATALOG)) {
    if (entry.sourceSystem === source) return entry.sourceIdentityProvider;
  }
  return null;
}
