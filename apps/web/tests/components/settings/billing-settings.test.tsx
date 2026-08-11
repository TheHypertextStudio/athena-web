import '@testing-library/jest-dom/vitest';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { JSX, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { billingGet, checkoutPost, portalPost } = vi.hoisted(() => ({
  billingGet: vi.fn(),
  checkoutPost: vi.fn(),
  portalPost: vi.fn(),
}));

vi.mock('../../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          billing: {
            $get: billingGet,
            checkout: { $post: checkoutPost },
            portal: { $post: portalPost },
          },
        },
      },
    },
  },
}));

import { BillingSettings } from '../../../src/components/settings/billing-settings';

function okResponse<T>(body: T) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

function wrapper(): ({ children }: { children: ReactNode }) => JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  billingGet.mockReset();
  checkoutPost.mockReset();
  portalPost.mockReset();
});

afterEach(cleanup);

describe('BillingSettings', () => {
  it('offers Docket Pro while preserving free personal Docket', async () => {
    billingGet.mockResolvedValue(
      okResponse({ organizationId: 'org-1', products: [], canManageBilling: true }),
    );

    render(<BillingSettings orgId="org-1" isPersonal />, { wrapper: wrapper() });

    expect(await screen.findByRole('button', { name: 'Add Docket Pro' })).toBeInTheDocument();
    expect(screen.getByText('Free')).toBeInTheDocument();
    expect(
      screen.getByText(/returns this workspace to free Docket without deleting its data/),
    ).toBeInTheDocument();
  });

  it('shows renewal and management for an active Stripe product', async () => {
    billingGet.mockResolvedValue(
      okResponse({
        organizationId: 'org-1',
        canManageBilling: true,
        products: [
          {
            productKey: 'docket_pro',
            name: 'Docket Pro',
            status: 'active',
            source: 'stripe',
            trialEndsAt: null,
            renewalDate: '2026-09-11T00:00:00.000Z',
          },
        ],
      }),
    );

    render(<BillingSettings orgId="org-1" isPersonal={false} />, { wrapper: wrapper() });

    expect(await screen.findByRole('button', { name: 'Manage Docket Pro' })).toBeInTheDocument();
    expect(screen.getByText(/Renews/)).toBeInTheDocument();
    expect(screen.getByText(/14-day period to export this shared workspace/)).toBeInTheDocument();
  });

  it('identifies a complimentary product without offering provider billing', async () => {
    billingGet.mockResolvedValue(
      okResponse({
        organizationId: 'org-1',
        canManageBilling: true,
        products: [
          {
            productKey: 'docket_pro',
            name: 'Docket Pro',
            status: 'active',
            source: 'complimentary',
            trialEndsAt: null,
            renewalDate: null,
          },
        ],
      }),
    );

    render(<BillingSettings orgId="org-1" isPersonal />, { wrapper: wrapper() });

    expect(await screen.findByText('Docket Pro is complimentary.')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Docket Pro/ })).not.toBeInTheDocument();
    });
  });
});
