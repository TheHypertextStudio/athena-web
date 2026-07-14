import type { LucideIcon } from '@docket/ui/icons';
import { Inbox, Workflow } from '@docket/ui/icons';

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
        key: 'work-structure',
        label: 'Work structure',
        description: 'Set how deeply strategic initiatives can be nested.',
        icon: Workflow,
        href: 'work-structure',
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
    ],
  },
];

/** The section the `settings` root redirects to for a **personal workspace**. */
export const DEFAULT_PERSONAL_SETTINGS_SECTION = 'work-structure';
