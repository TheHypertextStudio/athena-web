import type { IntegrationOut } from '@docket/types';
import {
  Calendar,
  Folder,
  Github,
  Layers,
  type LucideIcon,
  Mail,
  MessageSquare,
  Sparkles,
  TaskAlt,
} from '@docket/ui/icons';

/** PROVIDER_ICON maps integration providers to their display icon component. */
export const PROVIDER_ICON: Record<string, LucideIcon> = {
  github: Github,
  linear: Layers,
  drive: Folder,
  gmail: Mail,
  outlook: Mail,
  calendar: Calendar,
  gtasks: TaskAlt,
  slack: MessageSquare,
};

/**
 * Providers whose connect ceremony is a full-page redirect to `GET /:id/connect-url` (a signed
 * provider consent/install URL that calls back to `/internal/integrations/<provider>/callback`)
 * rather than a Better Auth social-link. The callback returns to settings with
 * `?<provider>=connected|error`.
 */
export const REDIRECT_CONNECT_PROVIDERS: ReadonlySet<string> = new Set(['slack']);

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
 * grant; GitHub, Linear, and Microsoft (Outlook) each have their own. Used to decide which
 * provider's OAuth redirect to launch when finishing/repairing a connection.
 */
export function socialProviderForConnector(
  provider: string,
): 'google' | 'github' | 'linear' | 'microsoft' {
  if (provider === 'github') return 'github';
  if (provider === 'linear') return 'linear';
  if (provider === 'outlook') return 'microsoft';
  return 'google';
}

// Provider/connector *availability* (isMockMode, connectorOAuthConfigured, connectorAvailable) is
// derived from the server's `/v1/config` — see `@/lib/public-config`. This module holds only the
// static display catalog (icons, labels) and the connector → social-provider mapping above, so no
// component reads availability from the environment.

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
