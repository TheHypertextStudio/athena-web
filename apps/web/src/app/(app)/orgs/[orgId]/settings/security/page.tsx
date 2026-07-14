'use client';

/**
 * The Security settings section (passkeys, email, sessions, and recovery codes).
 *
 * @remarks
 * Reached at `/orgs/[orgId]/settings/security` (personal workspace only — see
 * {@link PERSONAL_SETTINGS_SECTION_GROUPS}, "Account" group). These are person-level concerns,
 * not org-level ones, so this page guards against a shared org: if the active org is not personal
 * it redirects to the org default section and renders a calm placeholder, keeping the route
 * unreachable from the (shared-org) nav and via a typed URL.
 *
 * Clicking the change-email confirmation link (sent by {@link ChangeEmailSection}) redirects the
 * browser back here with `?email-changed=1`, which {@link EmailChangedBanner} turns into a
 * one-time success banner.
 *
 * Data is fetched at runtime, so the production build needs no running server.
 */
import { type JSX, Suspense, use, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { useActiveOrg } from '@/components/active-org';
import { SectionHeader } from '@/components/settings/section-header';
import { defaultSettingsSection, sectionHref } from '@/components/settings/sections';
import { SecurityTab } from '@/components/settings/security-tab';

/** A one-time success banner shown after confirming an email change (`?email-changed=1`). */
function EmailChangedBanner(): JSX.Element | null {
  const params = useSearchParams();
  if (params.get('email-changed') !== '1') return null;
  return (
    <p role="status" className="bg-primary/10 text-on-surface text-body-medium rounded-lg px-4 py-3">
      Your email address has been updated.
    </p>
  );
}

/** The Security section page. */
export default function SecuritySettingsPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}): JSX.Element {
  const { orgId } = use(params);
  const router = useRouter();
  const { activeOrg } = useActiveOrg();
  const isPersonal = activeOrg?.isPersonal ?? false;

  // These sections are personal-only; send a shared org to its default section.
  useEffect(() => {
    if (activeOrg && !isPersonal) {
      router.replace(sectionHref(orgId, defaultSettingsSection(false)));
    }
  }, [activeOrg, isPersonal, orgId, router]);

  if (activeOrg && !isPersonal) {
    return (
      <p className="text-on-surface-variant text-body-medium" role="status">
        Opening settings&hellip;
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Security"
        description="Manage your passkeys, email, active sessions, and recovery codes."
      />
      <Suspense>
        <EmailChangedBanner />
      </Suspense>
      <SecurityTab />
    </div>
  );
}
