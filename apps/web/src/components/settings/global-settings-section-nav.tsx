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
    <nav aria-label="Settings sections" className="flex flex-col gap-1">
      {GLOBAL_SETTINGS_SECTIONS.map((section) => {
        const Icon = section.icon;
        const active = isActive(section);
        return (
          <Link
            key={section.key}
            href={globalSettingsSectionHref(section.href)}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'text-body flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 transition-colors focus-visible:ring-2 focus-visible:outline-none',
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
