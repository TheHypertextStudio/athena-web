'use client';

/**
 * `settings` — the left section list for the Settings area (Linear-style sub-navigation).
 *
 * @remarks
 * Replaces the former in-page tab strip with a vertical, routed section list so Settings scales
 * as it grows toward a dozen sections. The list is driven entirely by the typed
 * {@link settingsSectionGroups} registry: each `available` section renders as a Next.js
 * `Link` (so navigation is real routing, prefetched, and works with browser history), and each
 * `coming-soon` section renders as a visibly-disabled row with a "Soon" badge so the
 * information architecture reads as complete without promising routes that do not exist.
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
import { Badge } from '@docket/ui/primitives';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useActiveOrg } from '@/components/active-org';

import { type SettingsSection, sectionHref, settingsSectionGroups } from './sections';

/** Props for {@link SettingsSectionNav}. */
export interface SettingsSectionNavProps {
  /** The active organization id (used to build each section's route). */
  orgId: string;
}

/** Shared row layout for both the active link rows and the disabled placeholder rows. */
const ROW_BASE =
  'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors';

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
    <nav aria-label="Settings sections" className="flex flex-col gap-6">
      {groups.map((group) => (
        <div key={group.label} className="flex flex-col gap-1">
          <h2 className="text-on-surface-variant px-2.5 text-xs font-medium">{group.label}</h2>
          <ul className="flex flex-col gap-0.5">
            {group.sections.map((section) => {
              const Icon = section.icon;

              if (section.status === 'coming-soon') {
                return (
                  <li key={section.key}>
                    <span
                      aria-disabled="true"
                      title="Coming soon"
                      className={cn(ROW_BASE, 'text-on-surface-variant/60 cursor-not-allowed')}
                    >
                      <Icon aria-hidden="true" className="size-4 shrink-0" />
                      <span className="flex-1 truncate">{section.label}</span>
                      <Badge variant="secondary" className="font-normal">
                        Soon
                      </Badge>
                    </span>
                  </li>
                );
              }

              const active = isActive(section);
              return (
                <li key={section.key}>
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
                    <span className="flex-1 truncate">{section.label}</span>
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
