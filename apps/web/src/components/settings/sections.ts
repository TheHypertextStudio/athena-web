/**
 * `settings` — the typed registry of Settings sections that drives the sub-navigation.
 *
 * @remarks
 * Each section is a `{ key, label, description, icon, href }` record.
 * The nav, the layout, and the section-root redirect all derive from this registry.
 * `settingsSectionGroups` picks the correct registry for the active workspace type.
 */
import { Inbox, Settings, Sparkles, Users, Workflow } from '@docket/ui/icons';

export type { SettingsSection, SettingsSectionGroup } from './sections-personal';
export {
  DEFAULT_PERSONAL_SETTINGS_SECTION,
  PERSONAL_SETTINGS_SECTION_GROUPS,
} from './sections-personal';
import {
  DEFAULT_PERSONAL_SETTINGS_SECTION,
  PERSONAL_SETTINGS_SECTION_GROUPS,
} from './sections-personal';
import type { SettingsSection, SettingsSectionGroup } from './sections-personal';

/** The Settings sections for a **shared workspace**, grouped for the section list. */
export const SETTINGS_SECTION_GROUPS: readonly SettingsSectionGroup[] = [
  {
    label: 'Workspace',
    sections: [
      {
        key: 'general',
        label: 'General',
        description: 'Edit the workspace name, purpose, address, logo, and terminology.',
        icon: Settings,
        href: 'general',
      },
      {
        key: 'members',
        label: 'Members & Access',
        description: 'Manage who belongs to this workspace and what they can do.',
        icon: Users,
        href: 'members',
      },
    ],
  },
  {
    label: 'Workflows',
    sections: [
      {
        key: 'work-structure',
        label: 'Work structure',
        description: 'Set how deeply strategic initiatives can be nested.',
        icon: Workflow,
        href: 'work-structure',
      },
      {
        key: 'import',
        label: 'Import',
        description: 'Move everything from another tool into Docket, once.',
        icon: Inbox,
        href: 'import',
      },
      {
        key: 'automations',
        label: 'Automations',
        description: 'Rules that act on your email suggestions and tasks.',
        icon: Sparkles,
        href: 'automations',
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
export const DEFAULT_SETTINGS_SECTION = 'general';

/** The default section key for the active workspace's settings root redirect. */
export function defaultSettingsSection(isPersonal: boolean): string {
  return isPersonal ? DEFAULT_PERSONAL_SETTINGS_SECTION : DEFAULT_SETTINGS_SECTION;
}

/** Build the absolute route for a section in a given org. */
export function sectionHref(orgId: string, href: string): string {
  return `/orgs/${orgId}/settings/${href}`;
}
