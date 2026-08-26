'use client';

import { Button } from '@docket/ui/primitives';
import Link from '@/components/docket-link';
import { useEffect, useState, type JSX } from 'react';

import { api } from '@/lib/api';
import { useAppSearchParams } from '@/lib/app-location';
import { apiQueryOptions, queryKeys, useApiQuery } from '@/lib/query';

/** How long the return page waits for Stripe webhook reconciliation. */
const CONFIRMATION_TIMEOUT_MS = 15_000;

/** Hosted-checkout return page; webhook state remains authoritative. */
export default function BillingReturnPage(): JSX.Element {
  const searchParams = useAppSearchParams();
  const org = searchParams.get('org');
  const status = searchParams.get('status');
  const requestedReturn = searchParams.get('returnTo');
  const returnTo =
    requestedReturn?.startsWith('/') && !requestedReturn.startsWith('//') ? requestedReturn : null;
  const completed = status === 'success';
  const [timedOut, setTimedOut] = useState(false);
  const billingHref = org ? `/orgs/${encodeURIComponent(org)}/settings/billing` : '/today';
  const billingQ = useApiQuery(
    apiQueryOptions(
      queryKeys.billing(org ?? ''),
      () => api.v1.orgs[':orgId'].billing.$get({ param: { orgId: org ?? '' } }),
      'Could not confirm Docket Pro yet.',
      {
        enabled: completed && Boolean(org),
        refetchInterval: (query) => {
          if (timedOut) return false;
          const data = query.state.data;
          return data?.products.some(
            (product) =>
              product.source === 'stripe' &&
              ['trialing', 'active', 'past_due'].includes(product.status),
          )
            ? false
            : 1_000;
        },
      },
    ),
  );

  useEffect(() => {
    if (!completed || !org) return;
    const timeout = window.setTimeout(() => {
      setTimedOut(true);
    }, CONFIRMATION_TIMEOUT_MS);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [completed, org]);

  const confirmed =
    completed &&
    billingQ.data?.products.some(
      (product) =>
        product.source === 'stripe' && ['trialing', 'active', 'past_due'].includes(product.status),
    );
  const nextHref = confirmed && returnTo ? returnTo : billingHref;
  const failed = completed && Boolean(org) && billingQ.isError;
  const title = !completed
    ? 'Checkout canceled'
    : confirmed
      ? 'Docket Pro is ready'
      : failed
        ? 'We could not confirm billing'
        : timedOut
          ? 'Payment is still processing'
          : 'Confirming your payment';
  const description = !completed
    ? 'No billing change was made.'
    : confirmed
      ? 'Stripe confirmed your subscription, and Docket Pro is available now.'
      : failed
        ? 'Open Billing settings to check the current status or try again.'
        : timedOut
          ? 'Stripe has not confirmed the subscription yet. You can leave this page and check Billing settings later.'
          : 'Docket is waiting for Stripe to confirm the subscription. This usually takes a few seconds.';

  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-xl flex-col justify-center gap-6 px-6 py-16">
      <div className="flex flex-col gap-2" aria-live="polite">
        <h1 className="text-on-surface text-headline-small">{title}</h1>
        <p className="text-on-surface-variant text-body-large">{description}</p>
      </div>
      <div>
        <Button asChild>
          <Link href={nextHref}>
            {confirmed && returnTo ? 'Continue' : org ? 'Open billing settings' : 'Open Docket'}
          </Link>
        </Button>
      </div>
    </main>
  );
}
