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
 *
 * Settings is gated on whether the active workspace is the caller's **personal** space. A
 * personal workspace is an organization-of-one purely as an engineering practicality (one
 * tenant-scoped data model); that must never leak into the UX. So {@link settingsSectionGroups}
 * returns a *different* registry for a personal workspace — the org/multi-tenant sections
 * (Members & Access, Teams, Roles, org billing) are absent, replaced by a small set framed as
 * the user's own space (Language, Integrations & Import, Notifications, and a Danger zone).
 * Shared orgs keep the full org registry unchanged.
 */
import type { LucideIcon } from '@docket/ui/icons';
import {
  Cable,
  CreditCard,
  Link,
  ListChecks,
  Shield,
  Sparkles,
  Translate,
  Trash2,
  Users,
} from '@docket/ui/icons';

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
 * The Settings sections for a **shared organization**, grouped for the section list.
 *
 * @remarks
 * The three `available` sections (Members & Access, Integrations, Vocabulary) are live routed
 * pages. The remaining entries are `coming-soon` placeholders rendered as visibly-disabled
 * rows so the information architecture reads as intentional and complete; promoting one to a
 * real page is a matter of flipping its `status` and adding the matching route segment.
 *
 * This is the registry a multi-member org sees. A personal workspace sees
 * {@link PERSONAL_SETTINGS_SECTION_GROUPS} instead — choose between them with
 * {@link settingsSectionGroups}.
 */
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
        key: 'integrations',
        label: 'Integrations',
        description: 'Connect the tools your team already uses.',
        icon: Cable,
        href: 'integrations',
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

/**
 * The Settings sections for a **personal workspace**, grouped for the section list.
 *
 * @remarks
 * A personal workspace is the caller's own space, not an organization with other people in it,
 * so none of the org/multi-tenant sections apply: there are no other members to manage, no
 * teams to organize, no roles to assign, and no org-as-company billing. This registry omits all
 * of them. What remains is framed as *your space*: the same live Integrations and Vocabulary
 * pages (relabelled as personal preferences), a planned Notifications section, and a Danger zone
 * for deleting your personal data.
 *
 * The two live sections reuse the existing `integrations` and `vocabulary` routes — the gate is
 * purely presentational, so the underlying pages are shared with the org registry; only the
 * surrounding labels and the omission of the org sections differ.
 */
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
        key: 'integrations',
        label: 'Integrations & import',
        description: 'Connect your tools and bring your existing work into Docket.',
        icon: Cable,
        href: 'integrations',
        status: 'available',
      },
      {
        key: 'connected-apps',
        label: 'Connected apps',
        description: 'MCP clients authorized to read and act on your Docket account.',
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

/**
 * The Settings section groups for the active workspace.
 *
 * @remarks
 * The single gate for the Settings information architecture: a personal workspace gets the
 * personal registry ({@link PERSONAL_SETTINGS_SECTION_GROUPS} — no org/team/billing sections),
 * a shared org gets the full org registry ({@link SETTINGS_SECTION_GROUPS}). Every consumer
 * (the section nav, the layout header, the root redirect, the section guards) derives from this
 * one function so the gate can never be applied inconsistently.
 *
 * @param isPersonal - Whether the active workspace is the caller's personal space
 *   (`OrgSummary.isPersonal`).
 * @returns the section groups to render for that workspace.
 */
export function settingsSectionGroups(isPersonal: boolean): readonly SettingsSectionGroup[] {
  return isPersonal ? PERSONAL_SETTINGS_SECTION_GROUPS : SETTINGS_SECTION_GROUPS;
}

/**
 * Every section for the active workspace, flattened across its groups, in display order.
 *
 * @param isPersonal - Whether the active workspace is the caller's personal space.
 * @returns the flattened section list for that workspace.
 */
export function settingsSections(isPersonal: boolean): readonly SettingsSection[] {
  return settingsSectionGroups(isPersonal).flatMap((group) => group.sections);
}

/**
 * Every section across all groups of the **org** registry, flattened, in display order.
 *
 * @remarks
 * Retained for the routed section pages (Members, Integrations, Vocabulary), which look up
 * their own header copy by key. Personal-only consumers should use {@link settingsSections}.
 */
export const SETTINGS_SECTIONS: readonly SettingsSection[] = SETTINGS_SECTION_GROUPS.flatMap(
  (group) => group.sections,
);

/**
 * The section the `settings` root redirects to for a **shared org** (the primary,
 * always-available section).
 */
export const DEFAULT_SETTINGS_SECTION = 'members';

/**
 * The section the `settings` root redirects to for a **personal workspace**.
 *
 * @remarks
 * Members & Access does not exist in a personal workspace, so the personal default must be an
 * always-available *personal* section. Language (the Vocabulary route) is the calmest landing.
 */
export const DEFAULT_PERSONAL_SETTINGS_SECTION = 'vocabulary';

/**
 * The default section the `settings` root redirects to for the active workspace.
 *
 * @remarks
 * Guarantees a personal workspace never lands on (or is redirected to) the org-only Members &
 * Access section: it resolves to {@link DEFAULT_PERSONAL_SETTINGS_SECTION} (an available
 * personal section) for a personal space, and {@link DEFAULT_SETTINGS_SECTION} otherwise.
 *
 * @param isPersonal - Whether the active workspace is the caller's personal space.
 * @returns the default section's route suffix for that workspace.
 */
export function defaultSettingsSection(isPersonal: boolean): string {
  return isPersonal ? DEFAULT_PERSONAL_SETTINGS_SECTION : DEFAULT_SETTINGS_SECTION;
}

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
