/**
 * The user-owned Settings registry.
 *
 * @remarks
 * These destinations are intentionally independent of an active workspace. Athena belongs to
 * the signed-in user and uses workspaces as contexts and data sources, not as the owner of the
 * assistant. Workspace administration remains linked from the final Workspaces destination.
 */
import {
  Calendar,
  Cable,
  Download,
  FolderKanban,
  Inbox,
  Link,
  Shield,
  Sparkles,
  User,
} from '@docket/ui/icons';

import type { SettingsSection } from './sections-personal';

/** A global user-owned Settings destination. */
export type GlobalSettingsSection = SettingsSection;

/** The global user-owned Settings sections, in product order. */
export const GLOBAL_SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    key: 'profile',
    label: 'Profile',
    description: 'Manage your name, email, and personal identity.',
    icon: User,
    href: 'profile',
  },
  {
    key: 'athena',
    label: 'Athena',
    description: 'Set how your chief of staff works with you.',
    icon: Sparkles,
    href: 'athena',
  },
  {
    key: 'connections',
    label: 'Connections',
    description: 'Connect the apps Athena uses as data sources.',
    icon: Cable,
    href: 'connections',
  },
  {
    key: 'notifications',
    label: 'Notifications',
    description: 'Decide what Athena tells you, and where.',
    icon: Inbox,
    href: 'notifications',
  },
  {
    key: 'calendar',
    label: 'Calendar',
    description: 'Set scheduling defaults and calendar sharing.',
    icon: Calendar,
    href: 'calendar',
  },
  {
    key: 'security',
    label: 'Security',
    description: 'Protect your account and sign-in methods.',
    icon: Shield,
    href: 'security',
  },
  {
    key: 'connected-apps',
    label: 'Connected apps',
    description: 'Manage external apps that can access Docket.',
    icon: Link,
    href: 'connected-apps',
  },
  {
    key: 'data-privacy',
    label: 'Data & privacy',
    description: 'Export or delete your Docket data.',
    icon: Download,
    href: 'data-privacy',
  },
  {
    key: 'workspaces',
    label: 'Workspaces',
    description: 'Choose a workspace and manage its settings.',
    icon: FolderKanban,
    href: 'workspaces',
  },
];

/** Build an absolute route for a global Settings section. */
export function globalSettingsSectionHref(href: string): string {
  return `/settings/${href}`;
}

/** The first global Settings destination. */
export const DEFAULT_GLOBAL_SETTINGS_SECTION = 'profile';
