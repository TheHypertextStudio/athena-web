import type { LucideIcon } from '@docket/ui/icons';
import { Cable, Inbox, Link, ListChecks, Translate, Trash2, Users } from '@docket/ui/icons';

/** A settings section's availability: a live routed page, or a planned ("coming soon") stub. */
export type SectionStatus = 'available' | 'coming-soon';

/** One Settings section in the sub-navigation. */
export interface SettingsSection {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly icon: LucideIcon;
  readonly href: string;
  readonly status: SectionStatus;
}

/** A labelled cluster of sections in the section list. */
export interface SettingsSectionGroup {
  readonly label: string;
  readonly sections: readonly SettingsSection[];
}

/** The Settings sections for a **personal workspace**, grouped for the section list. */
export const PERSONAL_SETTINGS_SECTION_GROUPS: readonly SettingsSectionGroup[] = [
  {
    label: 'Your space',
    sections: [
      {
        key: 'vocabulary',
        label: 'Language',
        description: 'Choose the words Docket uses across your space.',
        icon: Translate,
        href: 'vocabulary',
        status: 'available',
      },
      {
        key: 'connections',
        label: 'Connections',
        description: 'Connect a tool to keep it in sync with Docket.',
        icon: Cable,
        href: 'connections',
        status: 'available',
      },
      {
        key: 'import',
        label: 'Import',
        description: 'Move everything from another tool into Docket, once.',
        icon: Inbox,
        href: 'import',
        status: 'available',
      },
      {
        key: 'connected-apps',
        label: 'Authorized apps',
        description:
          'External apps (via MCP) you have authorized to read and act on your Docket account.',
        icon: Link,
        href: 'connected-apps',
        status: 'available',
      },
      {
        key: 'notifications',
        label: 'Notifications',
        description: 'Decide what Docket tells you, and where.',
        icon: ListChecks,
        href: 'notifications',
        status: 'coming-soon',
      },
    ],
  },
  {
    label: 'Account',
    sections: [
      {
        key: 'connected-accounts',
        label: 'Connected accounts',
        description: 'The external accounts (Google, …) linked to your Docket identity.',
        icon: Users,
        href: 'connected-accounts',
        status: 'available',
      },
      {
        key: 'danger',
        label: 'Danger zone',
        description: 'Permanently delete your personal data.',
        icon: Trash2,
        href: 'danger',
        status: 'coming-soon',
      },
    ],
  },
];

/** The section the `settings` root redirects to for a **personal workspace**. */
export const DEFAULT_PERSONAL_SETTINGS_SECTION = 'vocabulary';
