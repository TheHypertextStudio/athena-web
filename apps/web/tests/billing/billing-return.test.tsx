import '@testing-library/jest-dom/vitest';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import type { JSX, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { billingGet, useAppSearchParams } = vi.hoisted(() => ({
  billingGet: vi.fn(),
  useAppSearchParams: vi.fn(),
}));

vi.mock('../../src/lib/app-location', () => ({ useAppSearchParams }));
vi.mock('../../src/lib/api', () => ({
  api: { v1: { orgs: { ':orgId': { billing: { $get: billingGet } } } } },
}));
vi.mock('../../src/components/docket-link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import BillingReturnPage from '../../src/app/(app)/billing/return/page';

function wrapper(): ({ children }: { children: ReactNode }) => JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  billingGet.mockReset();
  useAppSearchParams.mockReset();
});

afterEach(cleanup);

describe('BillingReturnPage', () => {
  it('shows confirmed only after the billing summary contains a Stripe entitlement', async () => {
    useAppSearchParams.mockReturnValue(new URLSearchParams('org=org-1&status=success'));
    billingGet.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          products: [{ source: 'stripe', status: 'trialing' }],
        }),
    });

    render(<BillingReturnPage />, { wrapper: wrapper() });

    expect(screen.getByRole('heading', { name: 'Confirming your payment' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Docket Pro is ready' })).toBeInTheDocument();
    expect(screen.getByText(/Stripe confirmed your subscription/)).toBeInTheDocument();
  });

  it('shows cancellation without polling billing state', () => {
    useAppSearchParams.mockReturnValue(new URLSearchParams('org=org-1&status=cancel'));

    render(<BillingReturnPage />, { wrapper: wrapper() });

    expect(screen.getByRole('heading', { name: 'Checkout canceled' })).toBeInTheDocument();
    expect(screen.getByText('No billing change was made.')).toBeInTheDocument();
    expect(billingGet).not.toHaveBeenCalled();
  });

  it('rejects a backslash return path that the browser would resolve to another origin', async () => {
    useAppSearchParams.mockReturnValue(
      new URLSearchParams('org=org-1&status=success&returnTo=%2F%5Cevil.example%2Fcollect'),
    );
    billingGet.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ products: [{ source: 'stripe', status: 'active' }] }),
    });

    render(<BillingReturnPage />, { wrapper: wrapper() });

    expect(await screen.findByRole('heading', { name: 'Docket Pro is ready' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open billing settings' })).toHaveAttribute(
      'href',
      '/orgs/org-1/settings/billing',
    );
    expect(screen.queryByRole('link', { name: 'Continue' })).not.toBeInTheDocument();
  });
});
