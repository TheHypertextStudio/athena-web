/**
 * Billing API integration tests.
 *
 * @packageDocumentation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resetMockDb, type MockDb } from './test-utils.js';

// Mock billing service
const mockBillingService = {
  createCheckoutSession: vi.fn(),
  createPortalSession: vi.fn(),
  cancelSubscription: vi.fn(),
  resumeSubscription: vi.fn(),
  getInvoices: vi.fn(),
  getPaymentMethods: vi.fn(),
  setDefaultPaymentMethod: vi.fn(),
  deletePaymentMethod: vi.fn(),
  handleWebhook: vi.fn(),
};

const mockDb = vi.hoisted(() => {
  const factory = (globalThis as { __athenaMockDbFactory?: () => MockDb }).__athenaMockDbFactory;
  if (!factory) {
    throw new Error('Mock DB factory not initialized');
  }
  return factory();
});

vi.mock('../../src/db/index.js', () => ({ db: mockDb }));

vi.mock('../../src/middleware/auth.js', () => ({
  requireAuth: async (
    _c: { set: (key: string, value: unknown) => void },
    next: () => Promise<void>,
  ) => {
    _c.set('userId', 'test-user-id');
    await next();
  },
  getUserId: (c: { get: (key: string) => unknown }) => c.get('userId') ?? 'test-user-id',
}));

vi.mock('../../src/lib/auth.js', () => ({
  auth: {
    api: { getSession: () => null },
    handler: () => new Response(),
  },
}));

vi.mock('../../src/services/billing/service.js', () => ({
  getBillingService: () => mockBillingService,
  DEFAULT_PLANS: [
    {
      id: 'free',
      name: 'Free',
      description: 'For personal use',
      prices: { monthlyPriceId: '', yearlyPriceId: '', monthlyPrice: 0, yearlyPrice: 0 },
      features: ['Up to 100 tasks'],
      entitlements: ['basic_tasks'],
      limits: { tasks: 100 },
    },
    {
      id: 'pro',
      name: 'Pro',
      description: 'For power users',
      prices: {
        monthlyPriceId: 'price_pro_monthly',
        yearlyPriceId: 'price_pro_yearly',
        monthlyPrice: 1200,
        yearlyPrice: 9600,
      },
      features: ['Unlimited tasks'],
      entitlements: ['basic_tasks', 'unlimited_tasks'],
      limits: { tasks: -1 },
    },
    {
      id: 'team',
      name: 'Team',
      description: 'For teams',
      prices: {
        monthlyPriceId: 'price_team_monthly',
        yearlyPriceId: 'price_team_yearly',
        monthlyPrice: 2400,
        yearlyPrice: 19200,
      },
      features: ['Team workspaces'],
      entitlements: ['basic_tasks', 'unlimited_tasks', 'team_workspaces'],
      limits: { tasks: -1 },
    },
  ],
}));

import { app } from '../../src/index.js';

describe('Billing API', () => {
  beforeEach(() => {
    resetMockDb(mockDb);
    vi.clearAllMocks();
  });

  describe('GET /api/billing/subscription', () => {
    it('should return free tier when no subscription exists', async () => {
      mockDb.query.subscriptions.findFirst.mockResolvedValue(null);

      const res = await app.request('/api/billing/subscription');
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        data: {
          planTier: string;
          status: string;
          entitlements: string[];
        };
      };
      expect(body.data.planTier).toBe('free');
      expect(body.data.status).toBe('active');
      expect(body.data.entitlements).toContain('basic_tasks');
      expect(body.data.entitlements).not.toContain('unlimited_tasks');
    });

    it('should return pro tier subscription', async () => {
      const mockSubscription = {
        id: 'sub-1',
        userId: 'test-user-id',
        planTier: 'pro',
        status: 'active',
        currentPeriodStart: new Date('2026-01-01'),
        currentPeriodEnd: new Date('2026-02-01'),
        cancelAtPeriodEnd: false,
      };
      mockDb.query.subscriptions.findFirst.mockResolvedValue(mockSubscription);

      const res = await app.request('/api/billing/subscription');
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        data: {
          planTier: string;
          entitlements: string[];
        };
      };
      expect(body.data.planTier).toBe('pro');
      expect(body.data.entitlements).toContain('unlimited_tasks');
      expect(body.data.entitlements).toContain('time_tracking');
    });

    it('should return team tier subscription', async () => {
      const mockSubscription = {
        id: 'sub-1',
        userId: 'test-user-id',
        planTier: 'team',
        status: 'active',
        currentPeriodStart: new Date('2026-01-01'),
        currentPeriodEnd: new Date('2026-02-01'),
        cancelAtPeriodEnd: false,
      };
      mockDb.query.subscriptions.findFirst.mockResolvedValue(mockSubscription);

      const res = await app.request('/api/billing/subscription');
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        data: {
          planTier: string;
          entitlements: string[];
        };
      };
      expect(body.data.planTier).toBe('team');
      expect(body.data.entitlements).toContain('team_workspaces');
      expect(body.data.entitlements).toContain('sso');
    });

    it('should handle subscription pending cancellation', async () => {
      const mockSubscription = {
        id: 'sub-1',
        userId: 'test-user-id',
        planTier: 'pro',
        status: 'active',
        currentPeriodStart: new Date('2026-01-01'),
        currentPeriodEnd: new Date('2026-02-01'),
        cancelAtPeriodEnd: true,
      };
      mockDb.query.subscriptions.findFirst.mockResolvedValue(mockSubscription);

      const res = await app.request('/api/billing/subscription');
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        data: {
          cancelAtPeriodEnd: boolean;
        };
      };
      expect(body.data.cancelAtPeriodEnd).toBe(true);
    });
  });

  describe('GET /api/billing/entitlements', () => {
    it('should return free entitlements when no subscription', async () => {
      mockDb.query.subscriptions.findFirst.mockResolvedValue(null);

      const res = await app.request('/api/billing/entitlements');
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        data: {
          planTier: string;
          entitlements: string[];
        };
      };
      expect(body.data.planTier).toBe('free');
      expect(body.data.entitlements).toContain('basic_tasks');
    });

    it('should return pro entitlements', async () => {
      const mockSubscription = {
        id: 'sub-1',
        userId: 'test-user-id',
        planTier: 'pro',
        status: 'active',
      };
      mockDb.query.subscriptions.findFirst.mockResolvedValue(mockSubscription);

      const res = await app.request('/api/billing/entitlements');
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        data: {
          planTier: string;
          entitlements: string[];
        };
      };
      expect(body.data.planTier).toBe('pro');
      expect(body.data.entitlements).toContain('integrations');
    });
  });

  describe('GET /api/billing/entitlements/:feature', () => {
    it('should return access true for basic feature on free plan', async () => {
      mockDb.query.subscriptions.findFirst.mockResolvedValue(null);

      const res = await app.request('/api/billing/entitlements/basic_tasks');
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        data: {
          feature: string;
          hasAccess: boolean;
          planTier: string;
        };
      };
      expect(body.data.feature).toBe('basic_tasks');
      expect(body.data.hasAccess).toBe(true);
      expect(body.data.planTier).toBe('free');
    });

    it('should return access false for pro feature on free plan', async () => {
      mockDb.query.subscriptions.findFirst.mockResolvedValue(null);

      const res = await app.request('/api/billing/entitlements/unlimited_tasks');
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        data: {
          feature: string;
          hasAccess: boolean;
        };
      };
      expect(body.data.feature).toBe('unlimited_tasks');
      expect(body.data.hasAccess).toBe(false);
    });

    it('should return access true for pro feature on pro plan', async () => {
      const mockSubscription = {
        id: 'sub-1',
        userId: 'test-user-id',
        planTier: 'pro',
        status: 'active',
      };
      mockDb.query.subscriptions.findFirst.mockResolvedValue(mockSubscription);

      const res = await app.request('/api/billing/entitlements/unlimited_tasks');
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        data: {
          hasAccess: boolean;
        };
      };
      expect(body.data.hasAccess).toBe(true);
    });
  });

  describe('GET /api/billing/plans', () => {
    it('should return available plans', async () => {
      const res = await app.request('/api/billing/plans');
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        data: {
          plans: {
            id: string;
            name: string;
            monthlyPrice: number;
          }[];
        };
      };
      expect(body.data.plans).toHaveLength(3);
      expect(body.data.plans[0]?.id).toBe('free');
      expect(body.data.plans[1]?.id).toBe('pro');
      expect(body.data.plans[2]?.id).toBe('team');
    });
  });

  describe('POST /api/billing/checkout', () => {
    it('should create checkout session for pro plan', async () => {
      mockBillingService.createCheckoutSession.mockResolvedValue({
        sessionId: 'cs_test_123',
        url: 'https://checkout.stripe.com/pay/cs_test_123',
      });

      const res = await app.request('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planTier: 'pro',
          successUrl: 'https://example.com/success',
          cancelUrl: 'https://example.com/cancel',
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        data: {
          checkoutUrl: string;
          sessionId: string;
        };
      };
      expect(body.data.checkoutUrl).toBe('https://checkout.stripe.com/pay/cs_test_123');
      expect(body.data.sessionId).toBe('cs_test_123');

      expect(mockBillingService.createCheckoutSession).toHaveBeenCalledWith({
        userId: 'test-user-id',
        planTier: 'pro',
        billingInterval: 'month',
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
        trialDays: undefined,
        couponCode: undefined,
      });
    });

    it('should create checkout session for team plan with yearly billing', async () => {
      mockBillingService.createCheckoutSession.mockResolvedValue({
        sessionId: 'cs_test_456',
        url: 'https://checkout.stripe.com/pay/cs_test_456',
      });

      const res = await app.request('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planTier: 'team',
          billingInterval: 'year',
          successUrl: 'https://example.com/success',
          cancelUrl: 'https://example.com/cancel',
        }),
      });

      expect(res.status).toBe(200);
      expect(mockBillingService.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          planTier: 'team',
          billingInterval: 'year',
        }),
      );
    });

    it('should handle checkout session creation failure', async () => {
      mockBillingService.createCheckoutSession.mockRejectedValue(
        new Error('Price not configured for this plan'),
      );

      const res = await app.request('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planTier: 'pro',
          successUrl: 'https://example.com/success',
          cancelUrl: 'https://example.com/cancel',
        }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Price not configured for this plan');
    });
  });

  describe('POST /api/billing/portal', () => {
    it('should return 404 when no subscription exists', async () => {
      mockDb.query.subscriptions.findFirst.mockResolvedValue(null);

      const res = await app.request('/api/billing/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          returnUrl: 'https://example.com/settings',
        }),
      });

      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('No subscription found');
    });

    it('should create portal session when subscription exists', async () => {
      const mockSubscription = {
        id: 'sub-1',
        userId: 'test-user-id',
        stripeCustomerId: 'cus_123456',
        planTier: 'pro',
        status: 'active',
      };
      mockDb.query.subscriptions.findFirst.mockResolvedValue(mockSubscription);
      mockBillingService.createPortalSession.mockResolvedValue({
        url: 'https://billing.stripe.com/session/test_session',
      });

      const res = await app.request('/api/billing/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          returnUrl: 'https://example.com/settings',
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        data: {
          portalUrl: string;
        };
      };
      expect(body.data.portalUrl).toBe('https://billing.stripe.com/session/test_session');
    });
  });

  describe('POST /api/billing/cancel', () => {
    it('should cancel subscription', async () => {
      mockBillingService.cancelSubscription.mockResolvedValue(undefined);

      const res = await app.request('/api/billing/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { message: string } };
      expect(body.data.message).toContain('canceled at the end');
      expect(mockBillingService.cancelSubscription).toHaveBeenCalledWith('test-user-id');
    });

    it('should handle cancellation failure', async () => {
      mockBillingService.cancelSubscription.mockRejectedValue(new Error('No subscription found'));

      const res = await app.request('/api/billing/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('No subscription found');
    });
  });

  describe('POST /api/billing/resume', () => {
    it('should resume subscription', async () => {
      mockBillingService.resumeSubscription.mockResolvedValue(undefined);

      const res = await app.request('/api/billing/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { message: string } };
      expect(body.data.message).toBe('Subscription resumed');
    });
  });

  describe('GET /api/billing/invoices', () => {
    it('should return user invoices', async () => {
      mockBillingService.getInvoices.mockResolvedValue([
        {
          id: 'inv_123',
          stripeInvoiceId: 'inv_123',
          status: 'paid',
          amountDue: 1200,
          amountPaid: 1200,
          currency: 'usd',
          createdAt: new Date('2026-01-01'),
        },
      ]);

      const res = await app.request('/api/billing/invoices');
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        data: { invoices: { id: string; status: string }[] };
      };
      expect(body.data.invoices).toHaveLength(1);
      expect(body.data.invoices[0]?.status).toBe('paid');
    });
  });

  describe('GET /api/billing/payment-methods', () => {
    it('should return user payment methods', async () => {
      mockBillingService.getPaymentMethods.mockResolvedValue([
        {
          id: 'pm_123',
          type: 'card',
          isDefault: true,
          card: { brand: 'visa', last4: '4242', expMonth: 12, expYear: 2028 },
        },
      ]);

      const res = await app.request('/api/billing/payment-methods');
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        data: { paymentMethods: { id: string; card: { last4: string } }[] };
      };
      expect(body.data.paymentMethods).toHaveLength(1);
      expect(body.data.paymentMethods[0]?.card.last4).toBe('4242');
    });
  });

  describe('POST /api/billing/payment-methods/:id/default', () => {
    it('should set default payment method', async () => {
      mockBillingService.setDefaultPaymentMethod.mockResolvedValue(undefined);

      const res = await app.request('/api/billing/payment-methods/pm_123/default', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
      expect(mockBillingService.setDefaultPaymentMethod).toHaveBeenCalledWith(
        'test-user-id',
        'pm_123',
      );
    });
  });

  describe('DELETE /api/billing/payment-methods/:id', () => {
    it('should delete payment method', async () => {
      mockBillingService.deletePaymentMethod.mockResolvedValue(undefined);

      const res = await app.request('/api/billing/payment-methods/pm_123', {
        method: 'DELETE',
      });

      expect(res.status).toBe(204);
      expect(mockBillingService.deletePaymentMethod).toHaveBeenCalledWith('pm_123');
    });
  });

  describe('POST /api/billing/webhook', () => {
    it('should return 400 when signature is missing', async () => {
      const res = await app.request('/api/billing/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'customer.subscription.created',
          data: { object: {} },
        }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Missing Stripe signature');
    });

    it('should handle valid webhook with signature', async () => {
      mockBillingService.handleWebhook.mockResolvedValue({
        handled: true,
        eventType: 'customer.subscription.created',
      });

      const res = await app.request('/api/billing/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'stripe-signature': 't=123,v1=abc123',
        },
        body: JSON.stringify({
          type: 'customer.subscription.created',
          data: { object: { id: 'sub_123' } },
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { received: boolean; eventType: string };
      expect(body.received).toBe(true);
      expect(body.eventType).toBe('customer.subscription.created');
    });

    it('should handle webhook signature verification failure', async () => {
      mockBillingService.handleWebhook.mockResolvedValue({
        handled: false,
        eventType: 'unknown',
        error: 'Invalid webhook signature',
      });

      const res = await app.request('/api/billing/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'stripe-signature': 'invalid_signature',
        },
        body: JSON.stringify({
          type: 'customer.subscription.created',
          data: { object: {} },
        }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Invalid webhook signature');
    });

    it('should handle subscription updated event', async () => {
      mockBillingService.handleWebhook.mockResolvedValue({
        handled: true,
        eventType: 'customer.subscription.updated',
      });

      const res = await app.request('/api/billing/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'stripe-signature': 't=123,v1=abc123',
        },
        body: JSON.stringify({
          type: 'customer.subscription.updated',
          data: { object: { id: 'sub_123' } },
        }),
      });

      expect(res.status).toBe(200);
    });

    it('should handle invoice.paid event', async () => {
      mockBillingService.handleWebhook.mockResolvedValue({
        handled: true,
        eventType: 'invoice.paid',
      });

      const res = await app.request('/api/billing/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'stripe-signature': 't=123,v1=abc123',
        },
        body: JSON.stringify({
          type: 'invoice.paid',
          data: { object: { id: 'inv_123' } },
        }),
      });

      expect(res.status).toBe(200);
    });
  });

  describe('Edge Cases', () => {
    describe('Unknown plan tier', () => {
      it('should return 500 for unknown plan tier', async () => {
        const mockSubscription = {
          id: 'sub-1',
          userId: 'test-user-id',
          planTier: 'unknown_tier',
          status: 'active',
          currentPeriodStart: new Date('2026-01-01'),
          currentPeriodEnd: new Date('2026-02-01'),
          cancelAtPeriodEnd: false,
        };
        mockDb.query.subscriptions.findFirst.mockResolvedValue(mockSubscription);

        const res = await app.request('/api/billing/subscription');
        expect(res.status).toBe(500);

        const body = (await res.json()) as { error: string };
        expect(body.error).toBe('Unknown plan tier');
      });
    });

    describe('Subscription statuses', () => {
      it('should handle past_due subscription status', async () => {
        const mockSubscription = {
          id: 'sub-1',
          userId: 'test-user-id',
          planTier: 'pro',
          status: 'past_due',
          currentPeriodStart: new Date('2026-01-01'),
          currentPeriodEnd: new Date('2026-02-01'),
          cancelAtPeriodEnd: false,
        };
        mockDb.query.subscriptions.findFirst.mockResolvedValue(mockSubscription);

        const res = await app.request('/api/billing/subscription');
        expect(res.status).toBe(200);

        const body = (await res.json()) as {
          data: {
            status: string;
            planTier: string;
          };
        };
        expect(body.data.status).toBe('past_due');
        expect(body.data.planTier).toBe('pro');
      });

      it('should handle trialing subscription status', async () => {
        const mockSubscription = {
          id: 'sub-1',
          userId: 'test-user-id',
          planTier: 'team',
          status: 'trialing',
          currentPeriodStart: new Date('2026-01-01'),
          currentPeriodEnd: new Date('2026-01-15'),
          cancelAtPeriodEnd: false,
        };
        mockDb.query.subscriptions.findFirst.mockResolvedValue(mockSubscription);

        const res = await app.request('/api/billing/subscription');
        expect(res.status).toBe(200);

        const body = (await res.json()) as {
          data: {
            status: string;
            planTier: string;
            entitlements: string[];
          };
        };
        expect(body.data.status).toBe('trialing');
        expect(body.data.planTier).toBe('team');
        expect(body.data.entitlements).toContain('team_workspaces');
      });
    });
  });
});
