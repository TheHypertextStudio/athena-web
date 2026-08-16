/**
 * `settings` — the single settings registry: Personal (workspace-independent) plus Workspace
 * (scoped to whichever workspace is selected in the settings modal's switcher chip).
 *
 * @remarks
 * Replaces the former three-registry split (`global-sections.ts`, `sections.ts`,
 * `sections-personal.ts`), which had drifted: several real routes (`security`, `connected-apps`,
 * `connections`) existed with no registry entry at all, and personal-account concerns (Security,
 * Connected accounts, Connected apps, Notifications, Calendar, data export/deletion) were
 * duplicated between the global tree and a "personal workspace only" corner of the org tree. That
 * duplication is resolved by moving every person-level concern here, to the Personal group, and
 * deleting its org-scoped duplicate outright — see the settings redesign plan for the specific
 * merges. `Connections` is genuinely a workspace-level concern (a shared org's own data sources,
 * distinct from the caller's personal Connections above) and is shown only for shared orgs, since
 * a personal workspace's data sources are already the Personal group's Connections.
 */
import {
  AtSign,
  Cable,
  Calendar,
  CreditCard,
  Download,
  Globe,
  Inbox,
  LayoutTemplate,
  type LucideIcon,
  Link,
  MapPin,
  Settings,
  Shield,
  Sparkles,
  Tag,
  User,
  Users,
  Workflow,
  CircleDot,
} from '@docket/ui/icons';

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

/**
 * The user-owned Personal group — workspace-independent, always shown regardless of which
 * workspace is selected in the settings modal's switcher chip. Order follows mvp-plan §8.7.
 */
export const PERSONAL_SETTINGS_SECTIONS: readonly SettingsSection[] = [
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
    key: 'connected-accounts',
    label: 'Connected accounts',
    description: 'External accounts linked to your Docket identity.',
    icon: AtSign,
    href: 'connected-accounts',
  },
  {
    key: 'connected-apps',
    label: 'Connected apps',
    description: 'Manage external apps that can access Docket.',
    icon: Link,
    href: 'connected-apps',
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
    key: 'work-locations',
    label: 'Work locations',
    description: 'Manage regular places, location schedules, and account sync.',
    icon: MapPin,
    href: 'work-locations',
  },
  {
    key: 'security',
    label: 'Security',
    description: 'Protect your account and sign-in methods.',
    icon: Shield,
    href: 'security',
  },
  {
    key: 'data-privacy',
    label: 'Data & privacy',
    description: 'Export or delete your Docket data.',
    icon: Download,
    href: 'data-privacy',
  },
];

/** The Personal group as a single labelled cluster, for the unified nav. */
export const PERSONAL_SETTINGS_GROUP: SettingsSectionGroup = {
  label: 'Personal',
  sections: PERSONAL_SETTINGS_SECTIONS,
};

/** Build the absolute route for a Personal settings section. */
export function personalSectionHref(href: string): string {
  return `/settings/${href}`;
}

/** The first Personal Settings destination. */
export const DEFAULT_PERSONAL_SETTINGS_SECTION = 'profile';

/** Edit the workspace's own identity — shown for both a shared org and a personal workspace. */
const GENERAL_SECTION: SettingsSection = {
  key: 'general',
  label: 'General',
  description: 'Edit the workspace name, purpose, address, logo, and terminology.',
  icon: Settings,
  href: 'general',
};

/** Show the products owned by this workspace and provide the available billing action. */
const BILLING_SECTION: SettingsSection = {
  key: 'billing',
  label: 'Billing',
  description: 'View Docket Pro status, renewal dates, and billing actions.',
  icon: CreditCard,
  href: 'billing',
};

/** Manage who belongs to this workspace — shared orgs only, there is no roster otherwise. */
const MEMBERS_SECTION: SettingsSection = {
  key: 'members',
  label: 'Members & Access',
  description: 'Manage who belongs to this workspace and what they can do.',
  icon: Users,
  href: 'members',
};

/** How this workspace's own work is configured — shown for both workspace kinds. */
const WORK_CONFIGURATION_SECTIONS: readonly SettingsSection[] = [
  {
    key: 'statuses',
    label: 'Statuses',
    description: 'The states work moves through.',
    icon: CircleDot,
    href: 'statuses',
  },
  {
    key: 'work-structure',
    label: 'Work structure',
    description: 'Set how deeply strategic initiatives can be nested.',
    icon: Workflow,
    href: 'work-structure',
  },
  {
    key: 'labels',
    label: 'Labels',
    description: 'Your workspace’s own tags for organizing work.',
    icon: Tag,
    href: 'labels',
  },
  {
    key: 'templates',
    label: 'Templates',
    description: 'Reusable starting points for new work.',
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
  {
    key: 'automations',
    label: 'Automations',
    description: 'Rules that act on your email suggestions and tasks.',
    icon: Workflow,
    href: 'automations',
  },
];

/**
 * Connect this workspace's own tools — shared orgs only.
 *
 * @remarks
 * A personal workspace's data sources are already covered by the Personal group's own
 * Connections, so this section is omitted there rather than shown twice.
 */
const WORKSPACE_CONNECTIONS_SECTION: SettingsSection = {
  key: 'connections',
  label: 'Connections',
  description: "Connect tools to keep this workspace's data in sync with Docket.",
  icon: Cable,
  href: 'connections',
};

/** Choose the web address published pages answer on — shared orgs only, gated on management. */
const PUBLISHING_SECTION: SettingsSection = {
  key: 'publishing',
  label: 'Publishing',
  description: 'Choose the web address your published pages answer on.',
  icon: Globe,
  href: 'publishing',
  requiresManage: true,
};

/** The Settings sections for a **shared workspace**, grouped for the section list. */
export const WORKSPACE_SETTINGS_SECTION_GROUPS: readonly SettingsSectionGroup[] = [
  {
    label: 'Workspace',
    sections: [GENERAL_SECTION, MEMBERS_SECTION, BILLING_SECTION],
  },
  {
    label: 'Work configuration',
    sections: [...WORK_CONFIGURATION_SECTIONS, WORKSPACE_CONNECTIONS_SECTION],
  },
  {
    label: 'Advanced',
    sections: [PUBLISHING_SECTION],
  },
];

/**
 * The Settings sections for a **personal workspace**, grouped for the section list.
 *
 * @remarks
 * Omits Members & Access (there is no roster to manage), Connections (already covered by the
 * Personal group's own Connections), and the whole Advanced group (there is nothing to publish).
 */
export const PERSONAL_WORKSPACE_SETTINGS_SECTION_GROUPS: readonly SettingsSectionGroup[] = [
  {
    label: 'Workspace',
    sections: [GENERAL_SECTION, BILLING_SECTION],
  },
  {
    label: 'Work configuration',
    sections: WORK_CONFIGURATION_SECTIONS,
  },
];

/** Returns the workspace section groups for the given workspace kind. */
export function workspaceSettingsSectionGroups(
  isPersonal: boolean,
): readonly SettingsSectionGroup[] {
  return isPersonal
    ? PERSONAL_WORKSPACE_SETTINGS_SECTION_GROUPS
    : WORKSPACE_SETTINGS_SECTION_GROUPS;
}

/** Every workspace section for the given workspace kind, flattened, in display order. */
export function workspaceSettingsSections(isPersonal: boolean): readonly SettingsSection[] {
  return workspaceSettingsSectionGroups(isPersonal).flatMap((group) => group.sections);
}

/** Every section across all groups of the shared-org registry, flattened, in display order. */
export const SETTINGS_SECTIONS: readonly SettingsSection[] =
  WORKSPACE_SETTINGS_SECTION_GROUPS.flatMap((group) => group.sections);

/**
 * Find a section by key across every group — personal and workspace, both workspace kinds.
 *
 * @remarks
 * The registry is already the one place that knows a section's label and description, but only the
 * nav read it: each route page re-typed its own header copy, and the two Connections routes
 * disagreed about the wording of the same section. {@link SettingsSectionPage} resolves through
 * here so a section is named once and every route that reaches it says the same thing.
 *
 * Searches personal sections first: the keys are disjoint apart from the ones a personal workspace
 * deliberately shares with the personal group, and there the personal framing is the correct one.
 *
 * @param key - The section's registry key (e.g. `'connections'`).
 * @returns the section, or `undefined` when no group declares that key.
 */
export function findSettingsSection(key: string): SettingsSection | undefined {
  return (
    PERSONAL_SETTINGS_SECTIONS.find((section) => section.key === key) ??
    workspaceSettingsSections(false).find((section) => section.key === key) ??
    workspaceSettingsSections(true).find((section) => section.key === key)
  );
}

/** The section every workspace settings root redirects to, for either workspace kind. */
export const DEFAULT_WORKSPACE_SETTINGS_SECTION = 'general';

/** The default section key for the active workspace's settings root redirect. */
export function defaultSettingsSection(_isPersonal: boolean): string {
  return DEFAULT_WORKSPACE_SETTINGS_SECTION;
}

/** Build the absolute route for a workspace settings section in a given org. */
export function sectionHref(orgId: string, href: string): string {
  return `/orgs/${orgId}/settings/${href}`;
}
