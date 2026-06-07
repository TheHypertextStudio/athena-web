'use client';

/**
 * The Settings area root — redirects to the workspace's default section.
 *
 * @remarks
 * The settings shell always shows a concrete section, so the bare `/orgs/[orgId]/settings`
 * route has no content of its own; it redirects to the default section for the active workspace.
 * That default is gated on whether the workspace is the caller's **personal** space: a personal
 * workspace has no org-only Members & Access section, so it lands on its personal default
 * ({@link defaultSettingsSection}) rather than `members`.
 *
 * It is a client component because the personal-vs-org distinction (`OrgSummary.isPersonal`) is
 * only known client-side via {@link useActiveOrg}. To stay flicker-free it waits until the
 * active org is known (`activeOrg` non-null — always the case under a `settings` route once the
 * caller's orgs load) before redirecting, so it never bounces a personal workspace through the
 * org default first. A calm one-line placeholder shows during that brief window.
 */
import { use, useEffect, type JSX } from 'react';
import { useRouter } from 'next/navigation';

import { useActiveOrg } from '@/components/active-org';
import { defaultSettingsSection, sectionHref } from '@/components/settings/sections';

/**
 * The Settings area root redirect.
 *
 * @param props - The dynamic route params (a Promise in the App Router).
 * @returns a calm placeholder while it resolves the destination, then redirects.
 */
export default function SettingsRootPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}): JSX.Element {
  const { orgId } = use(params);
  const router = useRouter();
  const { activeOrg } = useActiveOrg();

  useEffect(() => {
    // Wait until the active org is known so a personal workspace never bounces through the org
    // default. Under a `settings` route the route org is always set once orgs load.
    if (!activeOrg) return;
    router.replace(sectionHref(orgId, defaultSettingsSection(activeOrg.isPersonal)));
  }, [activeOrg, orgId, router]);

  return (
    <p className="text-muted-foreground text-sm" role="status">
      Opening settings&hellip;
    </p>
  );
}
