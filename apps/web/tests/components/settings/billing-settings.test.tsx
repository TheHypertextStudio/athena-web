import '@testing-library/jest-dom/vitest';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { JSX, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { billingGet, discountsGet, checkoutPost, portalPost } = vi.hoisted(() => ({
  billingGet: vi.fn(),
  discountsGet: vi.fn(),
  checkoutPost: vi.fn(),
  portalPost: vi.fn(),
}));

vi.mock('../../../src/lib/auth-client', () => ({
  useSession: () => ({
    data: { user: { email: 'student@unlv.edu', emailVerified: true } },
  }),
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
            discounts: {
              $get: discountsGet,
              applications: {
                $post: vi.fn(),
                ':applicationId': {
                  evidence: { $post: vi.fn() },
                  supplement: { $post: vi.fn() },
                  withdraw: { $post: vi.fn() },
                },
              },
              renew: { $post: vi.fn() },
            },
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

/** Build a current billing response with one optional product override. */
function summary(
  product?: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    organizationId: 'org-1',
    checkoutEnabled: true,
    listPrice: { amount: 800, currency: 'usd', interval: 'month' },
    accessMode: product ? 'writable' : 'read_only',
    canManageBilling: true,
    effectiveDiscount: null,
    applicationStatus: null,
    issuedCredit: null,
    products: product
      ? [
          {
            productKey: 'docket_pro',
            name: 'Docket Pro',
            status: 'active',
            source: 'stripe',
            trialEndsAt: null,
            renewalDate: null,
            cancelAtPeriodEnd: false,
            cancellationDate: null,
            graceEndsAt: null,
            providerObservedAt: null,
            ...product,
          },
        ]
      : [],
    ...extra,
  };
}

beforeEach(() => {
  billingGet.mockReset();
  discountsGet.mockReset();
  discountsGet.mockResolvedValue(
    okResponse({
      applicationsEnabled: true,
      programs: [
        {
          key: 'student',
          name: 'Student',
          percentOff: 50,
          reviewMonths: 12,
          terms: 'For the verified person’s personal workspace.',
        },
        {
          key: 'nonprofit',
          name: 'Nonprofit',
          percentOff: 50,
          reviewMonths: 12,
          terms: 'For verified nonprofit organizations.',
        },
      ],
      application: null,
      award: null,
      credit: null,
    }),
  );
  checkoutPost.mockReset();
  portalPost.mockReset();
});

afterEach(cleanup);

describe('BillingSettings', () => {
  it('shows free personal access and the US launch price before Checkout', async () => {
    billingGet.mockResolvedValue(okResponse(summary(undefined, { accessMode: 'writable' })));

    render(<BillingSettings orgId="org-1" isPersonal />, { wrapper: wrapper() });

    expect(
      await screen.findByRole('button', { name: 'Start Docket Pro trial' }),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Free')).toHaveLength(2);
    expect(screen.getByText(/Personal planning.*remain writable/)).toBeInTheDocument();
    expect(await screen.findByText(/50% off Docket Pro/)).toBeInTheDocument();
  });

  it('preserves the original product location when billing recovery starts Checkout', async () => {
    window.history.replaceState(
      null,
      '',
      '/orgs/org-1/settings/billing?returnTo=%2Forgs%2Forg-1%2Fmy-work%3Fview%3Dassigned',
    );
    billingGet.mockResolvedValue(okResponse(summary(undefined, { accessMode: 'writable' })));
    checkoutPost.mockImplementation(() => new Promise(() => undefined));

    render(<BillingSettings orgId="org-1" isPersonal />, { wrapper: wrapper() });
    fireEvent.click(await screen.findByRole('button', { name: 'Start Docket Pro trial' }));

    await waitFor(() => {
      expect(checkoutPost).toHaveBeenCalledWith({
        param: { orgId: 'org-1' },
        json: { returnTo: '/orgs/org-1/my-work?view=assigned' },
      });
    });
  });

  it('explains the rollout pause instead of offering checkout or a new application', async () => {
    billingGet.mockResolvedValue(
      okResponse(summary(undefined, { accessMode: 'writable', checkoutEnabled: false })),
    );
    discountsGet.mockResolvedValue(
      okResponse({
        applicationsEnabled: false,
        programs: [
          {
            key: 'student',
            name: 'Student',
            percentOff: 50,
            reviewMonths: 12,
            terms: 'For the verified person’s personal workspace.',
          },
        ],
        application: null,
        award: null,
        credit: null,
      }),
    );

    render(<BillingSettings orgId="org-1" isPersonal />, { wrapper: wrapper() });

    expect(await screen.findByText(/checkout is not open yet/i)).toBeInTheDocument();
    expect(await screen.findByText(/discount applications are not open yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Start Docket Pro/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Apply for/i })).not.toBeInTheDocument();
  });

  it('shows renewal and management for an active Stripe product', async () => {
    billingGet.mockResolvedValue(okResponse(summary({ renewalDate: '2026-09-11T00:00:00.000Z' })));

    render(<BillingSettings orgId="org-1" isPersonal={false} />, { wrapper: wrapper() });

    expect(await screen.findByRole('button', { name: 'Manage billing' })).toBeInTheDocument();
    expect(screen.getByText(/next renewal/)).toBeInTheDocument();
    expect(screen.getByText(/\$8 USD per organization each month, plus tax/)).toBeInTheDocument();
    expect(screen.queryByText(/delet/i)).not.toBeInTheDocument();
  });

  it('uses the no-deletion cancellation contract', async () => {
    billingGet.mockResolvedValue(
      okResponse(
        summary({
          cancelAtPeriodEnd: true,
          cancellationDate: '2026-09-11T00:00:00.000Z',
          renewalDate: '2026-09-11T00:00:00.000Z',
        }),
      ),
    );

    render(<BillingSettings orgId="org-1" isPersonal={false} />, { wrapper: wrapper() });

    expect(await screen.findByText('Cancellation scheduled')).toBeInTheDocument();
    expect(screen.getByText(/shared work becomes read-only/)).toBeInTheDocument();
    expect(screen.getByText(/Docket does not delete workspace data/)).toBeInTheDocument();
  });

  it('does not promise a first charge after a trial cancellation is scheduled', async () => {
    billingGet.mockResolvedValue(
      okResponse(
        summary({
          status: 'trialing',
          trialEndsAt: '2026-09-11T12:00:00.000Z',
          cancelAtPeriodEnd: true,
          cancellationDate: '2026-09-11T12:00:00.000Z',
          renewalDate: '2026-09-11T12:00:00.000Z',
        }),
      ),
    );

    render(<BillingSettings orgId="org-1" isPersonal={false} />, { wrapper: wrapper() });

    expect(await screen.findByText('Cancellation scheduled')).toBeInTheDocument();
    expect(screen.getByText(/trial ends Sep 11, 2026/i)).toBeInTheDocument();
    expect(screen.queryByText(/first monthly charge/i)).not.toBeInTheDocument();
  });

  it('shows the recovery deadline and direct payment action while past due', async () => {
    billingGet.mockResolvedValue(
      okResponse(summary({ status: 'past_due', graceEndsAt: '2026-09-01T12:00:00.000Z' })),
    );

    render(<BillingSettings orgId="org-1" isPersonal={false} />, { wrapper: wrapper() });

    expect(await screen.findByText(/We could not collect this payment/)).toHaveTextContent(
      /by Sep 1, 2026/,
    );
    expect(screen.getByRole('button', { name: 'Update payment method' })).toBeInTheDocument();
  });

  it('identifies complimentary Pro without price, renewal, payment, or discount controls', async () => {
    billingGet.mockResolvedValue(
      okResponse(summary({ source: 'complimentary', renewalDate: null })),
    );

    render(<BillingSettings orgId="org-1" isPersonal />, { wrapper: wrapper() });

    expect(await screen.findByText('Complimentary Docket Pro')).toBeInTheDocument();
    expect(screen.getByText(/All current and future Docket Pro features/)).toBeInTheDocument();
    expect(screen.queryByText(/\$8/)).not.toBeInTheDocument();
    expect(screen.queryByText('Discounts')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
  });

  it('tells non-managers who can act without hiding status or dates', async () => {
    billingGet.mockResolvedValue(
      okResponse(
        summary(
          { status: 'trialing', trialEndsAt: '2026-08-29T12:00:00.000Z' },
          { canManageBilling: false },
        ),
      ),
    );

    render(<BillingSettings orgId="org-1" isPersonal />, { wrapper: wrapper() });

    expect(await screen.findByText(/trial ends Aug 29, 2026/i)).toBeInTheDocument();
    expect(screen.getByText(/workspace administrator can change billing/i)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
