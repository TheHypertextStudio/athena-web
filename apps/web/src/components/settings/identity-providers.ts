/**
 * `settings` — the identity-provider catalog for the Connected accounts directory.
 *
 * @remarks
 * The Connected accounts page is a **discover-and-manage** directory: every supported provider is
 * contains only real Better Auth social providers. Runtime availability is resolved by the
 * consuming surface so unavailable providers remain absent unless the user already linked one.
 */
import type { IdentityProvider } from '@docket/types';
import { Github, Google, Layers, type LucideIcon } from '@docket/ui/icons';

/** A real identity provider that can be linked when runtime configuration permits it. */
export interface IdentityProviderEntry {
  readonly kind: 'live';
  /** The Better Auth `socialProviders` key. */
  readonly id: IdentityProvider;
  readonly name: string;
  readonly icon: LucideIcon;
}

/** The real Connected accounts directory in display order. */
export const IDENTITY_PROVIDER_CATALOG: readonly IdentityProviderEntry[] = [
  { kind: 'live', id: 'google', name: 'Google', icon: Google },
  { kind: 'live', id: 'github', name: 'GitHub', icon: Github },
  { kind: 'live', id: 'linear', name: 'Linear', icon: Layers },
];

/** Friendly labels for the Google OAuth scopes we request (the raw URLs are unreadable). */
const SCOPE_LABEL: Record<string, string> = {
  'https://www.googleapis.com/auth/tasks': 'Tasks',
  'https://www.googleapis.com/auth/calendar.readonly': 'Calendar',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly': 'Calendar',
  'https://www.googleapis.com/auth/calendar.events': 'Calendar editing',
  'https://www.googleapis.com/auth/gmail.modify': 'Gmail',
};

/** The friendly, de-duplicated access labels for an identity's granted scopes (Google only today). */
export function accessLabels(scopes: readonly string[]): string[] {
  const labels = scopes.map((s) => SCOPE_LABEL[s]).filter((l): l is string => Boolean(l));
  return [...new Set(labels)];
}
