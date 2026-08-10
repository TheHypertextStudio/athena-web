'use client';

/**
 * `settings` — the unified settings-modal nav: the Personal group, always, followed by whichever
 * workspace is selected in the switcher chip.
 *
 * @remarks
 * Replaces the two former nav components (`global-settings-section-nav.tsx`,
 * `settings-section-nav.tsx`), each of which rendered exactly one registry and could not show
 * Personal and Workspace sections together. This one always renders both: the Personal group is
 * workspace-independent and never changes; the Workspace groups below it are for whichever
 * workspace {@link useContextState} currently resolves to (route org, else last-used, else the
 * personal space — the same resolution the main sidebar's switcher already uses), so switching the
 * chip changes this nav's second half without navigating away from Personal settings.
 */
import { useContextState } from '@docket/ui/components';
import { cn } from '@docket/ui';
import Link from 'next/link';
import type { JSX } from 'react';

import { useActiveOrg } from '@/components/active-org';
import { useAppPathname } from '@/lib/app-location';

import {
  PERSONAL_SETTINGS_GROUP,
  personalSectionHref,
  sectionHref,
  type SettingsSection,
  workspaceSettingsSectionGroups,
} from './settings-registry';
import { useCanManageOrg } from './use-can-manage-org';

/** Shared row layout for every settings link, personal or workspace. */
const ROW_BASE =
  'flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-body-medium transition-colors';

/** Props for {@link NavRow}. */
interface NavRowProps {
  /** The section's absolute route. */
  readonly href: string;
  /** The registry entry this row renders. */
  readonly section: SettingsSection;
}

/** One nav row (a real link), highlighted when its own route is the current page. */
function NavRow({ href, section }: NavRowProps): JSX.Element {
  const pathname = useAppPathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  const Icon = section.icon;
  return (
    <li className="shrink-0">
      <Link
        href={href}
        aria-current={active ? 'page' : undefined}
        className={cn(
          ROW_BASE,
          'focus-visible:ring-ring outline-none focus-visible:ring-2',
          active
            ? 'bg-surface-container-highest text-on-surface font-medium'
            : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface',
        )}
      >
        <Icon aria-hidden="true" className="size-4 shrink-0" />
        <span className="truncate">{section.label}</span>
      </Link>
    </li>
  );
}

/** Props for {@link NavGroup}. */
interface NavGroupProps {
  /** The group heading. */
  readonly label: string;
  /** The group's sections, already filtered for the current viewer. */
  readonly sections: readonly SettingsSection[];
  /** Build a section's absolute route. */
  readonly hrefFor: (section: SettingsSection) => string;
}

/** A labelled group of {@link NavRow}s. */
function NavGroup({ label, sections, hrefFor }: NavGroupProps): JSX.Element | null {
  if (sections.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-on-surface-variant px-2.5 text-xs font-medium">{label}</h2>
      <ul className="flex flex-col gap-0.5">
        {sections.map((section) => (
          <NavRow key={section.key} href={hrefFor(section)} section={section} />
        ))}
      </ul>
    </div>
  );
}

/** Props for {@link SettingsShellNav}. */
export interface SettingsShellNavProps {
  /** The workspace currently selected in the settings modal's switcher chip, or `null`. */
  readonly selectedOrgId: string | null;
  /** Whether that workspace is the caller's personal space. */
  readonly selectedOrgIsPersonal: boolean;
}

/** The full settings-modal nav: Personal, then the selected workspace's groups. */
export function SettingsShellNav({
  selectedOrgId,
  selectedOrgIsPersonal,
}: SettingsShellNavProps): JSX.Element {
  const { canManage } = useCanManageOrg(selectedOrgId ?? '');

  const workspaceGroups = selectedOrgId
    ? workspaceSettingsSectionGroups(selectedOrgIsPersonal)
        .map((group) => ({
          ...group,
          sections: group.sections.filter(
            (section) => canManage || section.requiresManage !== true,
          ),
        }))
        .filter((group) => group.sections.length > 0)
    : [];

  return (
    <nav aria-label="Settings sections" className="flex flex-col gap-5">
      <NavGroup
        label={PERSONAL_SETTINGS_GROUP.label}
        sections={PERSONAL_SETTINGS_GROUP.sections}
        hrefFor={(section) => personalSectionHref(section.href)}
      />
      {selectedOrgId
        ? workspaceGroups.map((group) => (
            <NavGroup
              key={group.label}
              label={group.label}
              sections={group.sections}
              hrefFor={(section) => sectionHref(selectedOrgId, section.href)}
            />
          ))
        : null}
    </nav>
  );
}

/** The workspace the settings modal's switcher chip should show. */
export interface SettingsShellWorkspace {
  /** The resolved workspace id, or `null` before the org list loads. */
  readonly orgId: string | null;
  /** Whether that workspace is the caller's personal space. */
  readonly isPersonal: boolean;
}

/** Resolve the workspace the settings modal's switcher chip should show. */
export function useSettingsShellWorkspace(): SettingsShellWorkspace {
  const { activeOrgId } = useContextState();
  const { orgs } = useActiveOrg();
  const selected = orgs.find((org) => org.id === activeOrgId) ?? null;
  return { orgId: selected?.id ?? null, isPersonal: selected?.isPersonal ?? false };
}
