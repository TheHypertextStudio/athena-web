import type { IntegrationOut } from '@docket/types';
import {
  Calendar,
  Folder,
  Github,
  Layers,
  type LucideIcon,
  Mail,
  Sparkles,
  TaskAlt,
} from '@docket/ui/icons';

import { configuredOAuthProviders } from '@/app/(auth)/_lib/oauth-providers';

/** PROVIDER_ICON maps integration providers to their display icon component. */
export const PROVIDER_ICON: Record<string, LucideIcon> = {
  github: Github,
  linear: Layers,
  drive: Folder,
  gmail: Mail,
  calendar: Calendar,
  gtasks: TaskAlt,
};

/** providerIcon returns the icon component for an integration provider. */
export function providerIcon(provider: string): LucideIcon {
  return PROVIDER_ICON[provider] ?? Sparkles;
}

/** CATEGORY_LABEL maps integration enum values to user-facing labels. */
export const CATEGORY_LABEL: Record<string, string> = {
  engineering: 'Engineering',
  'project-management': 'Project management',
  documents: 'Documents',
  communication: 'Communication',
};

/** STATUS_LABEL maps integration enum values to user-facing labels + badge variants. */
export const STATUS_LABEL: Record<
  IntegrationOut['status'],
  { label: string; variant: 'secondary' | 'destructive' | 'outline' }
> = {
  // `pending` is created-but-not-yet-validated: never shown as connected.
  pending: { label: 'Not connected', variant: 'outline' },
  connected: { label: 'Connected', variant: 'secondary' },
  error: { label: 'Needs attention', variant: 'destructive' },
  disconnected: { label: 'Disconnected', variant: 'outline' },
};

/**
 * Map a connector provider to the Better Auth social provider whose OAuth grant funds it.
 *
 * @remarks
 * Mirrors the server's `socialProviderId`: all four Google products share the one `google`
 * grant; GitHub and Linear each have their own. Used to decide which provider's OAuth redirect
 * to launch when finishing/repairing a connection.
 */
export function socialProviderForConnector(provider: string): 'google' | 'github' | 'linear' {
  if (provider === 'github') return 'github';
  if (provider === 'linear') return 'linear';
  return 'google';
}

/**
 * Whether this deployment has real OAuth wired for the provider's social grant.
 *
 * @remarks
 * When true (production), finishing a connection must go through the provider's OAuth consent
 * redirect. When false (local/mock dev, where {@link configuredOAuthProviders} is empty), the
 * connection is validated directly against the mock connector with no redirect — so the
 * validate-before-connected guarantee holds in every environment.
 */
export function connectorOAuthConfigured(provider: string): boolean {
  const social = socialProviderForConnector(provider);
  return configuredOAuthProviders().some((p) => p.id === social);
}

/**
 * Whether this is the local mock deployment (every boundary is mocked).
 *
 * @remarks
 * Read via DOT-notation `process.env.NEXT_PUBLIC_APP_MODE` so Next inlines it at build time.
 */
export function isMockMode(): boolean {
  return process.env.NEXT_PUBLIC_APP_MODE === 'local';
}

/**
 * Whether a connector can actually be set up in this deployment.
 *
 * @remarks
 * A connector is "available" only when its OAuth grant is reachable — either the local mock
 * (everything is mocked) or real OAuth is configured for its social provider. Without that,
 * connecting would only ever produce a broken `needs_reauth`/`error` row, so the UI must show it
 * as "Available soon" rather than offering to configure it (never claim a connector works when
 * nothing is set up).
 */
export function connectorAvailable(provider: string): boolean {
  return isMockMode() || connectorOAuthConfigured(provider);
}

/** categoryLabel returns display copy for an integration provider category. */
export function categoryLabel(category: string): string {
  return (
    CATEGORY_LABEL[category] ??
    category
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
  );
}
