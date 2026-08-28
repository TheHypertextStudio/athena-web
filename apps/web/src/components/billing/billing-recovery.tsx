'use client';

import { Button } from '@docket/ui/primitives';
import { useQueryClient } from '@tanstack/react-query';
import type { JSX } from 'react';
import { useCallback, useEffect, useState } from 'react';

import { api } from '@/lib/api';
import { UserFacingError, userErrorMessage } from '@/lib/problem';
import {
  ApiRequestError,
  apiQueryOptions,
  queryKeys,
  unwrap,
  useApiMutation,
  useApiQuery,
} from '@/lib/query';

type BillingRecoveryCode = 'billing_grace_expired';

interface BillingRecoveryRequest {
  readonly code: BillingRecoveryCode;
  readonly orgId: string;
}

/** Resolve only a payment failure that changed existing shared work to read-only. */
export function billingRecoveryCode(error: unknown): BillingRecoveryCode | null {
  if (!(error instanceof UserFacingError)) return null;
  return error.code === 'billing_grace_expired' ? error.code : null;
}

/** Resolve the organization carried by the failed request or its standardized query key. */
function billingRecoveryOrganizationId(
  error: unknown,
  queryKey?: readonly unknown[],
): string | null {
  const requestOrgId = error instanceof ApiRequestError ? error.organizationId : undefined;
  const queryOrgId =
    queryKey?.[0] === 'org' && typeof queryKey[1] === 'string' ? queryKey[1] : undefined;
  if (requestOrgId && queryOrgId && requestOrgId !== queryOrgId) return null;
  return requestOrgId ?? queryOrgId ?? null;
}

/**
 * Offer payment recovery without taking focus, navigation, or the current task away from a user.
 *
 * @remarks
 * TanStack Query owns every API read and write in the product, so its public caches provide the
 * complete observation boundary for an expired payment grace period. A missing product is not a
 * recovery event. Feature surfaces own `product_required` and may explain Docket Pro inline.
 */
export function BillingRecovery(): JSX.Element | null {
  const queryClient = useQueryClient();
  const [request, setRequest] = useState<BillingRecoveryRequest | null>(null);

  const showRecovery = useCallback((error: unknown, queryKey?: readonly unknown[]): void => {
    const code = billingRecoveryCode(error);
    const failedOrgId = billingRecoveryOrganizationId(error, queryKey);
    if (!code || !failedOrgId) return;
    setRequest({ code, orgId: failedOrgId });
  }, []);

  useEffect(() => {
    const unsubscribeQueries = queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated' || event.query.state.status !== 'error') return;
      showRecovery(event.query.state.error, event.query.queryKey as readonly unknown[]);
    });
    const unsubscribeMutations = queryClient.getMutationCache().subscribe((event) => {
      if (event.type !== 'updated' || event.mutation.state.status !== 'error') return;
      showRecovery(event.mutation.state.error);
    });
    return () => {
      unsubscribeQueries();
      unsubscribeMutations();
    };
  }, [queryClient, showRecovery]);

  const billingQ = useApiQuery(
    apiQueryOptions(
      queryKeys.billing(request?.orgId ?? ''),
      () => api.v1.orgs[':orgId'].billing.$get({ param: { orgId: request?.orgId ?? '' } }),
      'Could not load billing access.',
      { enabled: request !== null },
    ),
  );
  const portal = useApiMutation<{ url: string }, undefined>({
    mutationFn: () =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].billing.portal.$post({ param: { orgId: request?.orgId ?? '' } }),
        'Could not open payment settings.',
      ),
    onSuccess: ({ url }) => {
      window.location.assign(url);
    },
  });

  if (!request) return null;

  const canManageBilling = billingQ.data?.canManageBilling === true;
  return (
    <section
      role="status"
      aria-live="polite"
      aria-label="Payment recovery"
      className="border-outline-variant bg-surface-container-high text-on-surface fixed right-4 bottom-4 left-4 z-50 flex max-w-xl flex-col gap-3 rounded-xl border p-4 sm:left-auto"
    >
      <div className="min-w-0">
        <h2 className="text-title-medium">Payment recovery ended</h2>
        <p className="text-on-surface-variant text-body-medium mt-1">
          Shared work is read-only. Update the payment method to restore editing. Docket has not
          deleted the workspace.
        </p>
      </div>

      {billingQ.isSuccess && !canManageBilling ? (
        <p className="text-on-surface-variant text-body-medium">
          A workspace owner or administrator can update the payment method.
        </p>
      ) : null}
      {billingQ.isError ? (
        <p role="alert" className="text-error text-body-medium">
          {userErrorMessage(billingQ.error, 'Could not confirm who can manage billing.')}
        </p>
      ) : null}
      {portal.error ? (
        <p role="alert" className="text-error text-body-medium">
          {userErrorMessage(portal.error, 'Could not open payment settings.')}
        </p>
      ) : null}

      <div className="flex flex-nowrap items-center justify-end gap-2 overflow-x-auto">
        <Button
          type="button"
          variant="outline"
          className="shrink-0"
          onClick={() => {
            setRequest(null);
          }}
        >
          Dismiss
        </Button>
        {billingQ.isPending ? (
          <Button type="button" className="shrink-0" disabled>
            Checking access
          </Button>
        ) : canManageBilling ? (
          <Button
            type="button"
            className="shrink-0"
            disabled={portal.isPending}
            onClick={() => {
              portal.mutate(undefined);
            }}
          >
            Update payment
          </Button>
        ) : null}
      </div>
    </section>
  );
}
