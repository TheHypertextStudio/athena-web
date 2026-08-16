'use client';

/**
 * The Security settings section (passkeys, email, sessions, and recovery codes).
 *
 * @remarks
 * The single, canonical Security page — the former `/orgs/[orgId]/settings/security` (personal
 * workspace only) has been removed; Security is a person-level concern with no workspace scope,
 * so it lives only here.
 *
 * Clicking the change-email confirmation link (sent by `ChangeEmailSection`) redirects the
 * browser back here with `?email-changed=1`, which {@link EmailChangedBanner} turns into a
 * one-time success banner.
 */
import { type JSX, Suspense } from 'react';
import { useAppSearchParams } from '@/lib/app-location';

import { SecurityTab } from '@/components/settings/security-tab';
import { SettingsSectionPage } from '@/components/settings/settings-section-page';

/** A one-time success banner shown after confirming an email change (`?email-changed=1`). */
function EmailChangedBanner(): JSX.Element | null {
  const params = useAppSearchParams();
  if (params.get('email-changed') !== '1') return null;
  return (
    <p
      role="status"
      className="bg-primary-container text-on-primary-container text-body-medium rounded-xl px-4 py-3"
    >
      Your email address has been updated.
    </p>
  );
}

/** The global caller-owned Security destination. */
export default function GlobalSecuritySettingsPage(): JSX.Element {
  return (
    <SettingsSectionPage
      title="Security"
      description="Manage your passkeys, email, active sessions, and recovery codes."
    >
      <Suspense>
        <EmailChangedBanner />
      </Suspense>
      <SecurityTab />
    </SettingsSectionPage>
  );
}
