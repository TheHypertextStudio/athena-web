'use client';

/**
 * The Members & Access settings section (mvp-plan §8.7).
 *
 * @remarks
 * The primary, always-available Settings section, reached at
 * `/orgs/[orgId]/settings/members`. It is a thin route wrapper around the existing
 * {@link MembersTab}, which owns its own data (members, roles, pending invitations), its own
 * `canManage` derivation, and every mutation (invite, role change, removal, revoke). Splitting
 * the former in-page tab into a routed page changes only where the content mounts — the
 * behavior is unchanged.
 *
 * Data is fetched at runtime, so the production build needs no running server.
 */
import { use, type JSX } from 'react';

import { MembersTab } from '@/components/settings/members-tab';
import { SectionHeader } from '@/components/settings/section-header';
import { SETTINGS_SECTIONS } from '@/components/settings/sections';

/** The registry entry for this section (its title + description copy). */
const SECTION = SETTINGS_SECTIONS.find((s) => s.key === 'members');

/**
 * The Members & Access section page.
 *
 * @param props - The dynamic route params (a Promise in the App Router).
 * @returns the rendered section.
 */
export default function MembersSettingsPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}): JSX.Element {
  const { orgId } = use(params);

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title={SECTION?.label ?? 'Members & Access'}
        description={
          SECTION?.description ?? 'Manage who belongs to this organization and what they can do.'
        }
      />
      <MembersTab orgId={orgId} />
    </div>
  );
}
