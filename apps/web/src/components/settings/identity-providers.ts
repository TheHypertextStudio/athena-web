/**
 * `settings` — the identity-provider catalog for the Connected accounts directory.
 *
 * @remarks
 * The Connected accounts page is a **discover-and-manage** directory: every supported provider is
 * always shown, so the page reads as a catalog rather than a one-button display. Entries are either
 * `live` (a real Better Auth social provider — google/github/linear — whose actual connectability in
 * this deployment is decided by `usePublicConfig().oauthProviders`) or `coming-soon` (a roadmap
 * provider rendered as a disabled entry). Linkable availability is NEVER read from the environment
 * here — that lives in `@/lib/public-config`; this file is the pure display catalog (id, name, icon).
 */
import type { IdentityProvider } from '@docket/types';
import {
  Calendar,
  Github,
  Google,
  Layers,
  type LucideIcon,
  Target,
  Workflow,
} from '@docket/ui/icons';

/** A real, linkable identity provider (its OAuth may or may not be wired in this deployment). */
export interface LiveIdentityProvider {
  readonly kind: 'live';
  /** The Better Auth `socialProviders` key. */
  readonly id: IdentityProvider;
  readonly name: string;
  readonly icon: LucideIcon;
}

/** A roadmap provider, shown as a disabled "Coming soon" catalog entry. */
export interface ComingSoonProvider {
  readonly kind: 'coming-soon';
  /** A stable display key (not a Better Auth provider — not yet wired). */
  readonly id: string;
  readonly name: string;
  readonly icon: LucideIcon;
}

/** One entry in the Connected accounts provider directory. */
export type IdentityProviderEntry = LiveIdentityProvider | ComingSoonProvider;

/**
 * The Connected accounts directory, in display order: the live providers first, then the roadmap
 * ones as "Coming soon". Extending the directory is a single edit here.
 */
export const IDENTITY_PROVIDER_CATALOG: readonly IdentityProviderEntry[] = [
  { kind: 'live', id: 'google', name: 'Google', icon: Google },
  { kind: 'live', id: 'github', name: 'GitHub', icon: Github },
  { kind: 'live', id: 'linear', name: 'Linear', icon: Layers },
  // Slack is intentionally absent: it is an org *integration* (Settings → Connections), not a
  // sign-in identity — listing it here as an account would conflate the two.
  { kind: 'coming-soon', id: 'jira', name: 'Jira', icon: Workflow },
  { kind: 'coming-soon', id: 'asana', name: 'Asana', icon: Target },
  { kind: 'coming-soon', id: 'apple-calendar', name: 'Apple Calendar', icon: Calendar },
];

/** Friendly labels for the Google OAuth scopes we request (the raw URLs are unreadable). */
const SCOPE_LABEL: Record<string, string> = {
  'https://www.googleapis.com/auth/tasks': 'Tasks',
  'https://www.googleapis.com/auth/calendar.readonly': 'Calendar',
  'https://www.googleapis.com/auth/drive.readonly': 'Drive',
  'https://mail.google.com/': 'Gmail',
};

/** The friendly, de-duplicated access labels for an identity's granted scopes (Google only today). */
export function accessLabels(scopes: readonly string[]): string[] {
  const labels = scopes.map((s) => SCOPE_LABEL[s]).filter((l): l is string => Boolean(l));
  return [...new Set(labels)];
}
