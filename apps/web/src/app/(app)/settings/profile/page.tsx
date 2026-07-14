'use client';

import type { JSX } from 'react';
import { useSession } from '@/lib/auth-client';
import { SectionHeader } from '@/components/settings/section-header';

/** The signed-in user's profile destination. */
export default function GlobalProfileSettingsPage(): JSX.Element {
  const { data: session, isPending } = useSession();

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Profile"
        description="Manage your name, email, and personal identity."
      />
      {isPending ? (
        <p className="text-on-surface-variant text-body" role="status">
          Loading your profile…
        </p>
      ) : session ? (
        <section className="border-outline-variant flex max-w-2xl flex-col gap-4 rounded-lg border p-5">
          <div>
            <h2 className="text-on-surface text-sm font-semibold">Your identity</h2>
            <p className="text-on-surface-variant text-sm">
              This is the identity Athena uses when working across your connected services.
            </p>
          </div>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-on-surface-variant">Name</dt>
              <dd className="text-on-surface font-medium">{session.user.name || 'Not set'}</dd>
            </div>
            <div>
              <dt className="text-on-surface-variant">Email</dt>
              <dd className="text-on-surface font-medium">{session.user.email}</dd>
            </div>
          </dl>
          <p className="text-on-surface-variant text-xs">
            Profile editing will be added here as the account profile API becomes available.
          </p>
        </section>
      ) : null}
    </div>
  );
}
