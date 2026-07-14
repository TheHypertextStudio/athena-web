'use client';

import type { JSX } from 'react';
import { cn } from '@docket/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import {
  GLOBAL_SETTINGS_SECTIONS,
  globalSettingsSectionHref,
  type GlobalSettingsSection,
} from './global-sections';

/** The global Settings navigation. */
export function GlobalSettingsSectionNav(): JSX.Element {
  const pathname = usePathname();

  function isActive(section: GlobalSettingsSection): boolean {
    const href = globalSettingsSectionHref(section.href);
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <nav
      aria-label="Settings sections"
      className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-2 @3xl:mx-0 @3xl:flex-col @3xl:overflow-visible @3xl:px-0 @3xl:pb-0"
    >
      {GLOBAL_SETTINGS_SECTIONS.map((section) => {
        const Icon = section.icon;
        const active = isActive(section);
        return (
          <Link
            key={section.key}
            href={globalSettingsSectionHref(section.href)}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'text-body-medium flex min-h-10 w-auto shrink-0 items-center gap-2.5 rounded-md px-2.5 py-2 transition-colors focus-visible:ring-2 focus-visible:outline-none @3xl:w-full',
              'focus-visible:ring-ring',
              active
                ? 'bg-surface-container-highest text-on-surface font-medium'
                : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface',
            )}
          >
            <Icon aria-hidden="true" className="size-4 shrink-0" />
            <span className="truncate">{section.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
