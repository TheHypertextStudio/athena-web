'use client';

import { useSharedOnlyGuard } from '@/components/settings/use-shared-only-guard';
import { useAppParams } from '@/lib/app-location';
import type { JSX } from 'react';
import { PublishingSettings } from '@/components/publishing/publishing-settings';
import { SettingsSectionPage } from '@/components/settings/settings-section-page';

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

  // See `use-shared-only-guard.ts`: the condition comes from the registry, so a fourth
  // shared-only section cannot acquire a guard that disagrees with the nav.
  if (useSharedOnlyGuard('publishing')) return <></>;

  return (
    <SettingsSectionPage sectionKey="publishing">
      <PublishingSettings orgId={orgId} />
    </SettingsSectionPage>
  );
}
