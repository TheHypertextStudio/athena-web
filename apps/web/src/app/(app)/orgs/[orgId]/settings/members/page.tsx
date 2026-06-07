'use client';

/**
 * The Members & Access settings section (mvp-plan §8.7).
 *
 * @remarks
 * The primary, always-available Settings section for a **shared org**, reached at
 * `/orgs/[orgId]/settings/members`. It is a thin route wrapper around the existing
 * {@link MembersTab}, which owns its own data (members, roles, pending invitations), its own
 * `canManage` derivation, and every mutation (invite, role change, removal, revoke). Splitting
 * the former in-page tab into a routed page changes only where the content mounts — the
 * behavior is unchanged.
 *
 * Members & Access is an org-only concept: a **personal** workspace is the caller's own
 * organization-of-one, with no other members to manage. So this page guards against a personal
 * workspace — if the active org is personal it redirects to the personal default section
 * ({@link defaultSettingsSection}) and renders a calm placeholder rather than the org members
 * UI, which keeps the route unreachable from the (personal) nav and via a typed/bookmarked URL.
 *
 * Data is fetched at runtime, so the production build needs no running server.
 */
import { use, useEffect, type JSX } from 'react';
import { useRouter } from 'next/navigation';

import { useActiveOrg } from '@/components/active-org';
import { MembersTab } from '@/components/settings/members-tab';
import { SectionHeader } from '@/components/settings/section-header';
import {
  defaultSettingsSection,
  sectionHref,
  SETTINGS_SECTIONS,
} from '@/components/settings/sections';

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
  const router = useRouter();
  const { activeOrg } = useActiveOrg();
  const isPersonal = activeOrg?.isPersonal ?? false;

  // Members & Access does not apply to a personal workspace; send it to the personal default.
  useEffect(() => {
    if (isPersonal) {
      router.replace(sectionHref(orgId, defaultSettingsSection(true)));
    }
  }, [isPersonal, orgId, router]);

  if (isPersonal) {
    return (
      <p className="text-muted-foreground text-sm" role="status">
        Opening settings&hellip;
      </p>
    );
  }

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
