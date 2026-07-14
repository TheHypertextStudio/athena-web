'use client';

/**
 * `settings` — the left section list for the Settings area (Linear-style sub-navigation).
 *
 * @remarks
 * Replaces the former in-page tab strip with a vertical, routed section list so Settings scales
 * as it grows toward a dozen sections. The list is driven entirely by the typed
 * {@link settingsSectionGroups} registry. Every visible section is a live Next.js route;
 * unfinished roadmap destinations are intentionally absent from production navigation.
 *
 * The registry is gated on whether the active workspace is the caller's **personal** space: the
 * nav reads `OrgSummary.isPersonal` from the shell-wide {@link useActiveOrg} context, so a
 * personal workspace never shows org/team-only sections (Members & Access, Teams, Roles, org
 * billing). It falls back to the org registry while the active org is still loading.
 *
 * The active row is resolved from the current pathname and exposes `aria-current="page"`; the
 * whole list is a `<nav>` landmark with labelled groups. Color comes from semantic tokens, and
 * every interactive row carries a visible focus ring for keyboard users.
 */
import type { JSX } from 'react';
import { cn } from '@docket/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useActiveOrg } from '@/components/active-org';

import { type SettingsSection, sectionHref, settingsSectionGroups } from './sections';

/** Props for {@link SettingsSectionNav}. */
export interface SettingsSectionNavProps {
  /** The active organization id (used to build each section's route). */
  orgId: string;
}

/** Shared row layout for each settings link. */
const ROW_BASE =
  'flex min-h-10 w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-body-medium transition-colors';

/**
 * The vertical Settings section list.
 *
 * @param props - The {@link SettingsSectionNavProps}.
 * @returns the rendered section navigation.
 */
export function SettingsSectionNav({ orgId }: SettingsSectionNavProps): JSX.Element {
  const pathname = usePathname();
  const { activeOrg } = useActiveOrg();
  // Default to the org registry while the active org is still loading (isPersonal unknown).
  const groups = settingsSectionGroups(activeOrg?.isPersonal ?? false);

  /** Whether a section's route is the one currently shown. */
  function isActive(section: SettingsSection): boolean {
    const href = sectionHref(orgId, section.href);
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <nav
      aria-label="Settings sections"
      className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-2 @3xl:mx-0 @3xl:flex-col @3xl:gap-6 @3xl:overflow-visible @3xl:px-0 @3xl:pb-0"
    >
      {groups.map((group) => (
        <div key={group.label} className="contents @3xl:flex @3xl:flex-col @3xl:gap-1">
          <h2 className="text-on-surface-variant hidden px-2.5 text-xs font-medium @3xl:block">
            {group.label}
          </h2>
          <ul className="flex gap-0.5 @3xl:flex-col">
            {group.sections.map((section) => {
              const Icon = section.icon;

              const active = isActive(section);
              return (
                <li key={section.key} className="shrink-0">
                  <Link
                    href={sectionHref(orgId, section.href)}
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
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
