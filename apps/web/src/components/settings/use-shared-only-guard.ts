'use client';

/**
 * `settings` — keeps a shared-workspace section off a personal one, wherever it is reached from.
 *
 * @remarks
 * The registry decides what the nav lists. It does not decide what a URL renders, and for three
 * sections those are different questions: Members, workspace Connections and Publishing exist only
 * for a shared workspace, and a personal workspace that reached one of their URLs directly still
 * rendered the whole surface. Publishing was the one that mattered — it offered to put one
 * person's private space on the web under a generated `personal-…` hostname.
 *
 * Two routes had each written their own redirect for this, which is the shape of the original
 * defect: a guard that has to be remembered per route is a guard that will be forgotten by the
 * fourth one. This reads `sharedOnly` off the registry, so a section declares the fact once and
 * both the nav and the route obey the same declaration.
 */
import { useAppRouter as useRouter } from '@/lib/interactions/navigation';
import { useEffect } from 'react';

import { useActiveOrg } from '@/components/active-org';
import { useAppParams } from '@/lib/app-location';

import { defaultSettingsSection, findSettingsSection, sectionHref } from './settings-registry';

/**
 * Redirect away from a shared-only section when the selected workspace is personal.
 *
 * @param sectionKey - The registry key of the section being rendered, if it has one.
 * @returns whether the caller should render nothing because a redirect is under way.
 */
export function useSharedOnlyGuard(sectionKey: string | undefined): boolean {
  const router = useRouter();
  const { orgId } = useAppParams<{ orgId?: string }>();
  const { activeOrg } = useActiveOrg();

  const isPersonal = activeOrg?.isPersonal ?? false;
  const section = sectionKey === undefined ? undefined : findSettingsSection(sectionKey);
  // Only a workspace-scoped route can be on the wrong workspace kind; the Personal group's own
  // sections have no `orgId` and are never shared-only.
  const blocked = isPersonal && orgId !== undefined && section?.sharedOnly === true;

  useEffect(() => {
    // `blocked` already required an `orgId`, so the route is workspace-scoped by the time we
    // build a replacement href for it.
    if (blocked) router.replace(sectionHref(orgId, defaultSettingsSection(true)));
  }, [blocked, orgId, router]);

  return blocked;
}
