import type { JSX, ReactNode } from 'react';

import { SettingsHeaderSubtitle } from '@/components/settings/settings-header-subtitle';
import { SettingsSectionNav } from '@/components/settings/settings-section-nav';

/**
 * The Settings shell layout (mvp-plan §8.7).
 *
 * @remarks
 * Wraps every `/orgs/[orgId]/settings/…` route in a Linear-style two-pane settings frame: a
 * left {@link SettingsSectionNav} section list and a content outlet for the active section's
 * routed page. This replaces the former single-page tab strip so the area scales as it grows
 * toward a dozen sections — each section is now a real route with its own URL, history entry,
 * and prefetchable navigation.
 *
 * A thin async Server Component: it only unwraps the org id from the route `params` (a Promise
 * in the App Router) and hands it to the client section nav, so the shell itself stays off the
 * client bundle while the nav owns the `usePathname` active-state logic. The surrounding
 * app-shell frame (org rail + context sidebar) is provided by the `(app)` group layout above.
 *
 * @param props - The route children (the active section page) and the dynamic route params.
 * @returns the rendered settings shell.
 */
export default async function SettingsLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ orgId: string }>;
}): Promise<JSX.Element> {
  const { orgId } = await params;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <SettingsHeaderSubtitle />
      </header>

      <div className="flex flex-col gap-8 md:flex-row md:gap-12">
        <aside className="md:w-56 md:shrink-0">
          <div className="md:sticky md:top-8">
            <SettingsSectionNav orgId={orgId} />
          </div>
        </aside>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
