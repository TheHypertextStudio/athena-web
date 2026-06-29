/**
 * `settings` — the typed registry of Settings sections that drives the sub-navigation.
 *
 * @remarks
 * Each section is a `{ key, label, description, icon, href, status }` record.
 * The nav, the layout, and the section-root redirect all derive from this registry.
 * `settingsSectionGroups` picks the correct registry for the active workspace type.
 */
import {
  Cable,
  CreditCard,
  Inbox,
  ListChecks,
  Shield,
  Sparkles,
  Translate,
  Users,
} from '@docket/ui/icons';

export type { SectionStatus, SettingsSection, SettingsSectionGroup } from './sections-personal';
export {
  DEFAULT_PERSONAL_SETTINGS_SECTION,
  PERSONAL_SETTINGS_SECTION_GROUPS,
} from './sections-personal';
import {
  DEFAULT_PERSONAL_SETTINGS_SECTION,
  PERSONAL_SETTINGS_SECTION_GROUPS,
} from './sections-personal';
import type { SettingsSection, SettingsSectionGroup } from './sections-personal';

/** The Settings sections for a **shared organization**, grouped for the section list. */
export const SETTINGS_SECTION_GROUPS: readonly SettingsSectionGroup[] = [
  {
    label: 'Organization',
    sections: [
      {
        key: 'members',
        label: 'Members & Access',
        description: 'Manage who belongs to this workspace and what they can do.',
        icon: Users,
        href: 'members',
        status: 'available',
      },
      {
        key: 'teams',
        label: 'Teams',
        description: 'Group members into teams that own work together.',
        icon: ListChecks,
        href: 'teams',
        status: 'coming-soon',
      },
      {
        key: 'roles',
        label: 'Roles & Permissions',
        description: 'Define what each role can see and change.',
        icon: Shield,
        href: 'roles',
        status: 'coming-soon',
      },
      {
        key: 'billing',
        label: 'Billing',
        description: 'Manage your plan, seats, and invoices.',
        icon: CreditCard,
        href: 'billing',
        status: 'coming-soon',
      },
    ],
  },
  {
    label: 'Workspace',
    sections: [
      {
        key: 'connections',
        label: 'Connections',
        description: 'Connect a tool to keep it in sync with your team.',
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
        key: 'vocabulary',
        label: 'Language',
        description: 'Choose the language Docket speaks across this organization.',
        icon: Translate,
        href: 'vocabulary',
        status: 'available',
      },
      {
        key: 'agents',
        label: 'Agents',
        description: 'Configure the AI teammates that work alongside your team.',
        icon: Sparkles,
        href: 'agents',
        status: 'coming-soon',
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
];

/** Returns the section groups for the active workspace. */
export function settingsSectionGroups(isPersonal: boolean): readonly SettingsSectionGroup[] {
  return isPersonal ? PERSONAL_SETTINGS_SECTION_GROUPS : SETTINGS_SECTION_GROUPS;
}

/** Every section for the active workspace, flattened across its groups, in display order. */
export function settingsSections(isPersonal: boolean): readonly SettingsSection[] {
  return settingsSectionGroups(isPersonal).flatMap((group) => group.sections);
}

/** Every section across all groups of the org registry, flattened, in display order. */
export const SETTINGS_SECTIONS: readonly SettingsSection[] = SETTINGS_SECTION_GROUPS.flatMap(
  (group) => group.sections,
);

/** The section the `settings` root redirects to for a **shared org**. */
export const DEFAULT_SETTINGS_SECTION = 'members';

/** The default section key for the active workspace's settings root redirect. */
export function defaultSettingsSection(isPersonal: boolean): string {
  return isPersonal ? DEFAULT_PERSONAL_SETTINGS_SECTION : DEFAULT_SETTINGS_SECTION;
}

/** Build the absolute route for a section in a given org. */
export function sectionHref(orgId: string, href: string): string {
  return `/orgs/${orgId}/settings/${href}`;
}
