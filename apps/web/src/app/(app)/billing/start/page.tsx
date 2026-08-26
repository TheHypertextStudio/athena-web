'use client';

import { Button } from '@docket/ui/primitives';
import type { JSX } from 'react';

import { useActiveOrg } from '@/components/active-org';
import Link from '@/components/docket-link';

/** Let an authenticated customer choose which organization should receive Docket Pro. */
export default function StartBillingPage(): JSX.Element {
  const { orgs, orgsLoading, orgsError } = useActiveOrg();

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-6 py-12">
      <div className="flex flex-col gap-2">
        <h1 className="text-on-surface text-headline-small">Choose a workspace</h1>
        <p className="text-on-surface-variant text-body-large">
          Docket Pro costs $8 USD per organization each month, plus tax where required. Each
          eligible workspace can start one 14-day trial. Billing settings will identify the role
          that can approve the purchase.
        </p>
      </div>

      {orgsLoading ? (
        <p className="text-on-surface-variant text-body-medium" role="status">
          Loading your workspaces…
        </p>
      ) : orgsError ? (
        <p className="text-error text-body-medium" role="alert">
          {orgsError}
        </p>
      ) : orgs.length === 0 ? (
        <div className="flex flex-col items-start gap-4">
          <p className="text-on-surface-variant text-body-medium">
            Create a workspace before you add Docket Pro.
          </p>
          <Button asChild>
            <Link href="/onboarding">Create a workspace</Link>
          </Button>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {orgs.map((org) => (
            <li
              key={org.id}
              className="border-outline-variant flex flex-nowrap items-center justify-between gap-4 rounded-lg border p-4"
            >
              <div className="min-w-0">
                <p className="text-on-surface text-title-medium truncate">{org.name}</p>
                <p className="text-on-surface-variant text-body-small">
                  {org.isPersonal ? 'Personal workspace' : 'Shared organization'}
                </p>
              </div>
              <Button asChild className="shrink-0">
                <Link href={`/orgs/${encodeURIComponent(org.id)}/settings/billing?upgrade=1`}>
                  Choose
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
