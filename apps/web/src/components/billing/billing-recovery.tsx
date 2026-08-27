'use client';

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@docket/ui/primitives';
import { useQueryClient } from '@tanstack/react-query';
import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import DocketLink from '@/components/docket-link';
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

type BillingRecoveryCode = 'product_required' | 'billing_grace_expired';

interface BillingRecoveryRequest {
  readonly code: BillingRecoveryCode;
  readonly orgId: string;
  readonly returnTo: string;
}

/** Props for the application-wide billing recovery interaction. */
export interface BillingRecoveryProps {
  /** The workspace whose current product state caused the failed action. */
  readonly orgId: string | null;
  /** Customer-facing workspace name used to explain whose access needs attention. */
  readonly workspaceName?: string | undefined;
}

/** Resolve only the two product-access failures that need application-wide recovery. */
export function billingRecoveryCode(error: unknown): BillingRecoveryCode | null {
  if (!(error instanceof UserFacingError)) return null;
  return error.code === 'product_required' || error.code === 'billing_grace_expired'
    ? error.code
    : null;
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

/** Read the exact location that the customer should regain after billing succeeds. */
function currentReturnPath(): string {
  return `${window.location.pathname}${window.location.search}`;
}

/** Build the billing-settings route without letting the current location become a new origin. */
function billingSettingsHref(orgId: string, returnTo: string): string {
  const query = new URLSearchParams({ returnTo });
  return `/orgs/${orgId}/settings/billing?${query.toString()}`;
}

/**
 * Recover product-gated reads and writes from one shared, customer-owned interaction.
 *
 * @remarks
 * TanStack Query owns every API read and write in the product, so its query and mutation caches are
 * the only complete observation boundary. This component subscribes to those public caches and
 * opens only for stable `product_required` or `billing_grace_expired` codes. It never renders a
 * provider message. The authenticated billing summary supplies the caller's organization
 * permission, which the API derives from the Better Auth-backed actor context.
 */
export function BillingRecovery({ orgId, workspaceName }: BillingRecoveryProps): JSX.Element {
  const queryClient = useQueryClient();
  const [request, setRequest] = useState<BillingRecoveryRequest | null>(null);

  const showRecovery = useCallback((error: unknown, queryKey?: readonly unknown[]): void => {
    const code = billingRecoveryCode(error);
    const failedOrgId = billingRecoveryOrganizationId(error, queryKey);
    if (!code || !failedOrgId) return;
    setRequest({ code, orgId: failedOrgId, returnTo: currentReturnPath() });
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

  const settingsHref = useMemo(
    () => (request ? billingSettingsHref(request.orgId, request.returnTo) : '/billing/start'),
    [request],
  );
  const canManageBilling = billingQ.data?.canManageBilling === true;
  const accessResolved = billingQ.isSuccess;
  const productRequired = request?.code === 'product_required';
  const subject =
    request?.orgId === orgId
      ? (workspaceName ?? 'This workspace')
      : 'The workspace for that action';

  return (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) setRequest(null);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {productRequired ? 'Docket Pro is required' : 'Payment recovery ended'}
          </DialogTitle>
          <DialogDescription>
            {productRequired
              ? `${subject} needs Docket Pro for that action. Your work is still here. Review the plan and return to this exact place after Checkout.`
              : 'The payment recovery period has ended, so shared work is read-only. Update the payment method to restore editing. Docket has not deleted the workspace.'}
          </DialogDescription>
        </DialogHeader>

        {accessResolved && !canManageBilling ? (
          <p className="text-on-surface-variant text-body-medium">
            A workspace owner or administrator can change billing. Ask one of them to{' '}
            {productRequired ? 'add Docket Pro' : 'update the payment method'}.
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
            Not now
          </Button>
          {billingQ.isPending && request ? (
            <Button type="button" className="shrink-0" disabled>
              Checking access
            </Button>
          ) : productRequired && (canManageBilling || billingQ.isError) ? (
            <Button asChild className="shrink-0">
              <DocketLink href={settingsHref}>Review Docket Pro</DocketLink>
            </Button>
          ) : request?.code === 'billing_grace_expired' && canManageBilling ? (
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
      </DialogContent>
    </Dialog>
  );
}
