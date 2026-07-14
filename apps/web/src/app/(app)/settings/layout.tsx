import type { JSX, ReactNode } from 'react';

import { GlobalSettingsSectionNav } from '@/components/settings/global-settings-section-nav';

/** The user-owned Settings shell, independent of the active workspace. */
export default function GlobalSettingsLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 @2xl:p-6 @4xl:p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-on-surface text-title-large">Settings</h1>
        <p className="text-on-surface-variant text-body-medium">
          Manage your relationship with Athena and Docket.
        </p>
      </header>

      <div className="flex flex-col gap-6 @3xl:flex-row @3xl:gap-12">
        <aside className="@3xl:w-56 @3xl:shrink-0">
          <div className="@3xl:sticky @3xl:top-8">
            <GlobalSettingsSectionNav />
          </div>
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
