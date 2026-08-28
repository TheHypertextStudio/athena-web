import '@testing-library/jest-dom/vitest';

import { QueryClient, QueryClientProvider, useMutation, useQuery } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { JSX, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UserFacingError } from '../../src/lib/problem';
import { ApiRequestError } from '../../src/lib/query';

const { billingGet, portalPost } = vi.hoisted(() => ({
  billingGet: vi.fn(),
  portalPost: vi.fn(),
}));

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          billing: {
            $get: billingGet,
            portal: { $post: portalPost },
          },
        },
      },
    },
  },
}));

import { BillingRecovery } from '../../src/components/billing/billing-recovery';

function okResponse<T>(body: T) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

function billingSummary(canManageBilling: boolean) {
  return {
    organizationId: 'org-1',
    checkoutEnabled: true,
    listPrice: { amount: 800, currency: 'usd', interval: 'month' },
    accessMode: 'read_only',
    products: [],
    canManageBilling,
    effectiveDiscount: null,
    applicationStatus: null,
    issuedCredit: null,
  };
}

function FailingRead({
  code,
  orgId = 'org-1',
}: {
  code: 'product_required' | 'billing_grace_expired';
  orgId?: string;
}): null {
  useQuery({
    queryKey: ['org', orgId, 'billing-recovery-trigger', code],
    queryFn: () =>
      Promise.reject(new UserFacingError('Caller-owned fallback.', { code, status: 402 })),
    retry: false,
  });
  return null;
}

function wrapper(client: QueryClient): ({ children }: { children: ReactNode }) => JSX.Element {
  return ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  billingGet.mockReset();
  portalPost.mockReset();
  window.history.replaceState(null, '', '/orgs/org-1/my-work?view=assigned');
});

afterEach(cleanup);

describe('BillingRecovery', () => {
  it('ignores a plan-gated read instead of blocking the application', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <>
        <BillingRecovery />
        <FailingRead code="product_required" />
      </>,
      { wrapper: wrapper(client) },
    );

    await waitFor(() => {
      expect(
        client.getQueryState(['org', 'org-1', 'billing-recovery-trigger', 'product_required'])
          ?.status,
      ).toBe('error');
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(billingGet).not.toHaveBeenCalled();
  });

  it('names the roles that can act when the current member cannot manage billing', async () => {
    billingGet.mockResolvedValue(okResponse(billingSummary(false)));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <>
        <BillingRecovery />
        <FailingRead code="billing_grace_expired" />
      </>,
      { wrapper: wrapper(client) },
    );

    expect(await screen.findByRole('status')).toHaveTextContent('Payment recovery ended');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByText(/workspace owner or administrator/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Update payment' })).not.toBeInTheDocument();
  });

  it('opens hosted payment recovery directly for a billing manager', async () => {
    billingGet.mockResolvedValue(okResponse(billingSummary(true)));
    portalPost.mockImplementation(() => new Promise(() => undefined));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <>
        <BillingRecovery />
        <FailingRead code="billing_grace_expired" />
      </>,
      { wrapper: wrapper(client) },
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Update payment' }));

    await waitFor(() => {
      expect(portalPost).toHaveBeenCalledWith({ param: { orgId: 'org-1' } });
    });
  });

  it('ignores a plan-gated write instead of opening global recovery', async () => {
    window.history.replaceState(null, '', '/orgs/org-b/my-work');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    function FailingWrite(): JSX.Element {
      const mutation = useMutation({
        mutationFn: () =>
          Promise.reject(
            new ApiRequestError({
              message: 'Caller-owned fallback.',
              code: 'product_required',
              status: 402,
              organizationId: 'org-a',
            }),
          ),
      });
      return (
        <button
          type="button"
          onClick={() => {
            mutation.mutate();
          }}
        >
          Run gated action
        </button>
      );
    }

    render(
      <>
        <BillingRecovery />
        <FailingWrite />
      </>,
      { wrapper: wrapper(client) },
    );

    fireEvent.click(screen.getByRole('button', { name: 'Run gated action' }));

    await waitFor(() => {
      expect(client.getMutationCache().getAll()[0]?.state.status).toBe('error');
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(billingGet).not.toHaveBeenCalled();
  });

  it('ignores unrelated request failures', async () => {
    function OrdinaryFailure(): null {
      useQuery({
        queryKey: ['ordinary-failure'],
        queryFn: () => Promise.reject(new UserFacingError('Could not save.', { status: 500 })),
        retry: false,
      });
      return null;
    }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <>
        <BillingRecovery />
        <OrdinaryFailure />
      </>,
      { wrapper: wrapper(client) },
    );

    await waitFor(() => {
      expect(client.getQueryState(['ordinary-failure'])?.status).toBe('error');
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(billingGet).not.toHaveBeenCalled();
  });
});
