/**
 * `settings` — the typed registry of Settings sections that drives the sub-navigation.
 *
 * @remarks
 * The Settings area uses a Linear-style left section list with routed sub-pages (rather than
 * in-page tabs) so it scales as the surface grows toward a dozen sections. This module is the
 * single source of truth for that list: each section is a `{ key, label, description, icon,
 * href, status }` record, and the nav, the layout, and the section-root redirect all derive
 * from it. Adding a future section (Billing, Teams, Roles, …) is a one-line edit here.
 *
 * Sections may be grouped into labelled clusters (e.g. "Organization" vs "Workspace") so the
 * list stays legible as it grows. The `href` is a *suffix* relative to the org's `settings`
 * root; {@link sectionHref} joins it with the active org id at render time so the registry
 * stays org-agnostic.
 */
import type { LucideIcon } from '@docket/ui/icons';
import { ListChecks, Settings as SettingsIcon, Sparkles } from '@docket/ui/icons';

/** A settings section's availability: a live routed page, or a planned ("coming soon") stub. */
export type SectionStatus = 'available' | 'coming-soon';

/** One Settings section in the sub-navigation. */
export interface SettingsSection {
  /** Stable section key (used as the React key and for active matching). */
  readonly key: string;
  /** Visible label in the section list. */
  readonly label: string;
  /** A short, plain-language summary shown on the section's own page header. */
  readonly description: string;
  /** Leading glyph for the section row. */
  readonly icon: LucideIcon;
  /**
   * The route suffix relative to the org's `settings` root (e.g. `members`). The empty string
   * denotes the settings root itself; it is not used for a navigable section.
   */
  readonly href: string;
  /** Whether the section is a live routed page or a planned placeholder. */
  readonly status: SectionStatus;
}

/** A labelled cluster of sections in the section list. */
export interface SettingsSectionGroup {
  /** The cluster's heading (e.g. "Organization"). */
  readonly label: string;
  /** The sections in this cluster, in display order. */
  readonly sections: readonly SettingsSection[];
}

/**
 * The Settings sections, grouped for the section list.
 *
 * @remarks
 * The three `available` sections (Members & Access, Integrations, Vocabulary) are live routed
 * pages. The remaining entries are `coming-soon` placeholders rendered as visibly-disabled
 * rows so the information architecture reads as intentional and complete; promoting one to a
 * real page is a matter of flipping its `status` and adding the matching route segment.
 */
export const SETTINGS_SECTION_GROUPS: readonly SettingsSectionGroup[] = [
  {
    label: 'Organization',
    sections: [
      {
        key: 'members',
        label: 'Members & Access',
        description: 'Manage who belongs to this organization and what they can do.',
        icon: SettingsIcon,
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
        icon: SettingsIcon,
        href: 'roles',
        status: 'coming-soon',
      },
      {
        key: 'billing',
        label: 'Billing',
        description: 'Manage your plan, seats, and invoices.',
        icon: SettingsIcon,
        href: 'billing',
        status: 'coming-soon',
      },
    ],
  },
  {
    label: 'Workspace',
    sections: [
      {
        key: 'integrations',
        label: 'Integrations',
        description: 'Connect the tools your team already uses.',
        icon: ListChecks,
        href: 'integrations',
        status: 'available',
      },
      {
        key: 'vocabulary',
        label: 'Vocabulary',
        description: 'Choose the language Docket speaks across this organization.',
        icon: Sparkles,
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

/** Every section across all groups, flattened, in display order. */
export const SETTINGS_SECTIONS: readonly SettingsSection[] = SETTINGS_SECTION_GROUPS.flatMap(
  (group) => group.sections,
);

/** The section the `settings` root redirects to (the primary, always-available section). */
export const DEFAULT_SETTINGS_SECTION = 'members';

/**
 * Build the absolute route for a section in a given org.
 *
 * @param orgId - The active organization id.
 * @param href - The section's route suffix (its {@link SettingsSection.href}).
 * @returns the absolute org-scoped settings route.
 */
export function sectionHref(orgId: string, href: string): string {
  return `/orgs/${orgId}/settings/${href}`;
}
