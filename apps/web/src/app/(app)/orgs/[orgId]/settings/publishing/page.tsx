'use client';

import { useAppParams } from '@/lib/app-location';
import { useRouter } from 'next/navigation';
import { useEffect, type JSX } from 'react';

import { useActiveOrg } from '@/components/active-org';
import { PublishingSettings } from '@/components/publishing/publishing-settings';
import { defaultSettingsSection, sectionHref } from '@/components/settings/settings-registry';

/**
 * Settings → Publishing: where this workspace's published pages answer on the web.
 *
 * @remarks
 * A thin route wrapper. The section is administrator-only in three independent places, which is
 * the point: the nav hides it for non-admins, this surface renders no controls for them, and the
 * API returns 403 for every underlying write regardless of what any client does.
 *
 * It is also hidden from a **personal** workspace, and that gate has to live here as well as in
 * the registry. The registry only decides what the nav lists; a personal workspace that reached
 * this URL directly still rendered the full surface, publishing address and all — offering to put
 * one person's private space on the web under a generated `personal-…` hostname. Nav-level gating
 * and route-level gating drifting apart is how that happened, so this mirrors the redirect
 * `members/page.tsx` uses for the same reason.
 *
 * @returns The publishing settings section, or a redirect on a personal workspace.
 */
export default function PublishingSettingsPage(): JSX.Element {
  const { orgId } = useAppParams<{ orgId: string }>();
  const router = useRouter();
  const { activeOrg } = useActiveOrg();
  const isPersonal = activeOrg?.isPersonal ?? false;

  useEffect(() => {
    if (isPersonal) {
      router.replace(sectionHref(orgId, defaultSettingsSection(true)));
    }
  }, [isPersonal, orgId, router]);

  if (isPersonal) {
    return (
      <p className="text-on-surface-variant text-body-medium" role="status">
        Opening settings&hellip;
      </p>
    );
  }

  return <PublishingSettings orgId={orgId} />;
}
