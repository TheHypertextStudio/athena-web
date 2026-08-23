'use client';

import { Button } from '@docket/ui/primitives';
import Link from '@/components/docket-link';
import type { JSX } from 'react';

import { useAppSearchParams } from '@/lib/app-location';

/** Hosted-checkout return page; webhook state remains authoritative. */
export default function BillingReturnPage(): JSX.Element {
  const searchParams = useAppSearchParams();
  const org = searchParams.get('org');
  const status = searchParams.get('status');
  const completed = status === 'success';
  const billingHref = org ? `/orgs/${encodeURIComponent(org)}/settings/billing` : '/today';

  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-xl flex-col justify-center gap-6 px-6 py-16">
      <div className="flex flex-col gap-2">
        <h1 className="text-on-surface text-headline-small">
          {completed ? 'Checkout finished' : 'Checkout canceled'}
        </h1>
        <p className="text-on-surface-variant text-body-large">
          {completed
            ? 'Docket Pro becomes available after payment confirmation. Billing settings show its current status.'
            : 'No billing change was made.'}
        </p>
      </div>
      <div>
        <Button asChild>
          <Link href={billingHref}>{org ? 'Open billing settings' : 'Open Docket'}</Link>
        </Button>
      </div>
    </main>
  );
}
