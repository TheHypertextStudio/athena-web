import type { LucideIcon } from '@docket/ui/icons';
import { Inbox, LayoutTemplate, Settings, Workflow } from '@docket/ui/icons';

/** One Settings section in the sub-navigation. */
export interface SettingsSection {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly icon: LucideIcon;
  readonly href: string;
  /**
   * Whether the section is administrator-only, and therefore hidden from members who are not.
   *
   * @remarks
   * Hiding a row is a UX decision, never the access control — the API refuses the section's
   * every write with 403 regardless of what the nav shows. It exists because a link that always
   * leads to "you don't have permission" is worse than no link: it advertises a capability the
   * person cannot use and makes the product feel like it is withholding something.
   */
  readonly requiresManage?: boolean;
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
        key: 'general',
        label: 'General',
        description: 'Edit the name, purpose, address, logo, and terminology for this space.',
        icon: Settings,
        href: 'general',
      },
      {
        key: 'work-structure',
        label: 'Work structure',
        description: 'Set how deeply strategic initiatives can be nested.',
        icon: Workflow,
        href: 'work-structure',
      },
      {
        key: 'templates',
        label: 'Templates',
        description: 'Reusable starting points for the work you create most.',
        icon: LayoutTemplate,
        href: 'templates',
      },
      {
        key: 'import',
        label: 'Import',
        description: 'Move everything from another tool into Docket, once.',
        icon: Inbox,
        href: 'import',
      },
    ],
  },
];

/** The section the `settings` root redirects to for a **personal workspace**. */
export const DEFAULT_PERSONAL_SETTINGS_SECTION = 'general';
