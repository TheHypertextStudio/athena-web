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

import { SectionHeader } from '@/components/settings/section-header';
import { SecurityTab } from '@/components/settings/security-tab';

/** A one-time success banner shown after confirming an email change (`?email-changed=1`). */
function EmailChangedBanner(): JSX.Element | null {
  const params = useAppSearchParams();
  if (params.get('email-changed') !== '1') return null;
  return (
    <p
      role="status"
      className="bg-primary/10 text-on-surface text-body-medium rounded-lg px-4 py-3"
    >
      Your email address has been updated.
    </p>
  );
}

/** The global caller-owned Security destination. */
export default function GlobalSecuritySettingsPage(): JSX.Element {
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
