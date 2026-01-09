/**
 * Billing and subscription routes.
 *
 * Uses the BillingService for real Stripe integration.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { subscriptions } from '../db/schema/index.js';
import { requireAuth, getUserId } from '../middleware/auth.js';
import { getBillingService, DEFAULT_PLANS } from '../services/billing/service.js';
import type { PlanTier, BillingInterval } from '../services/billing/types.js';

const billingRoutes = new Hono();

billingRoutes.use('*', requireAuth);

const PLAN_TIER_VALUES = ['free', 'pro', 'team'] as const;
const DEFAULT_PLAN_TIER: PlanTier = 'free';
const DEFAULT_SUBSCRIPTION_STATUS = 'active' as const;
const DEFAULT_BILLING_LIST_LIMIT = 10;
const DEFAULT_BILLING_INTERVAL = 'month' as const;

type UpgradePlanTier = 'pro' | 'team';
type BillingIntervalValue = 'month' | 'year';

/**
 * Feature entitlements by plan tier.
 */
const PLAN_ENTITLEMENTS: Record<PlanTier, string[]> = {
  free: ['basic_tasks', 'basic_projects', 'basic_calendar', 'basic_activities'],
  pro: [
    'basic_tasks',
    'basic_projects',
    'basic_calendar',
    'basic_activities',
    'unlimited_tasks',
    'unlimited_projects',
    'time_tracking',
    'integrations',
    'export_data',
    'priority_support',
  ],
  team: [
    'basic_tasks',
    'basic_projects',
    'basic_calendar',
    'basic_activities',
    'unlimited_tasks',
    'unlimited_projects',
    'time_tracking',
    'integrations',
    'export_data',
    'priority_support',
    'team_workspaces',
    'team_collaboration',
    'admin_controls',
    'sso',
  ],
};

const isPlanTier = (value: string): value is PlanTier =>
  PLAN_TIER_VALUES.includes(value as PlanTier);

/**
 * Get current user's subscription and plan.
 * GET /api/billing/subscription
 */
billingRoutes.get('/subscription', async (c) => {
  const userId = getUserId(c);

  const result = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.userId, userId),
  });

  if (!result) {
    // User has no subscription, return free tier
    return c.json({
      data: {
        planTier: DEFAULT_PLAN_TIER,
        status: DEFAULT_SUBSCRIPTION_STATUS,
        entitlements: PLAN_ENTITLEMENTS[DEFAULT_PLAN_TIER],
        currentPeriodStart: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      },
    });
  }

  if (!isPlanTier(result.planTier)) {
    return c.json({ error: 'Unknown plan tier' }, 500);
  }
  const entitlements = PLAN_ENTITLEMENTS[result.planTier];

  return c.json({
    data: {
      planTier: result.planTier,
      status: result.status,
      entitlements,
      currentPeriodStart: result.currentPeriodStart,
      currentPeriodEnd: result.currentPeriodEnd,
      cancelAtPeriodEnd: result.cancelAtPeriodEnd,
    },
  });
});

/**
 * Check if user has access to a specific feature.
 * GET /api/billing/entitlements/:feature
 */
billingRoutes.get('/entitlements/:feature', async (c) => {
  const userId = getUserId(c);
  const feature = c.req.param('feature');

  const result = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.userId, userId),
  });

  let planTier: PlanTier = DEFAULT_PLAN_TIER;
  if (result) {
    if (!isPlanTier(result.planTier)) {
      return c.json({ error: 'Unknown plan tier' }, 500);
    }
    planTier = result.planTier;
  }
  const entitlements = PLAN_ENTITLEMENTS[planTier];
  const hasAccess = entitlements.includes(feature);

  return c.json({
    data: {
      feature,
      hasAccess,
      planTier,
    },
  });
});

/**
 * Get all entitlements for current user.
 * GET /api/billing/entitlements
 */
billingRoutes.get('/entitlements', async (c) => {
  const userId = getUserId(c);

  const result = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.userId, userId),
  });

  let planTier: PlanTier = DEFAULT_PLAN_TIER;
  if (result) {
    if (!isPlanTier(result.planTier)) {
      return c.json({ error: 'Unknown plan tier' }, 500);
    }
    planTier = result.planTier;
  }
  const entitlements = PLAN_ENTITLEMENTS[planTier];

  return c.json({
    data: {
      planTier,
      entitlements,
    },
  });
});

/**
 * Get available plans.
 * GET /api/billing/plans
 */
billingRoutes.get('/plans', (c) => {
  return c.json({
    data: {
      plans: DEFAULT_PLANS.map((plan) => ({
        id: plan.id,
        name: plan.name,
        description: plan.description,
        monthlyPrice: plan.prices.monthlyPrice,
        yearlyPrice: plan.prices.yearlyPrice,
        features: plan.features,
        limits: plan.limits,
      })),
    },
  });
});

/**
 * Create a Stripe checkout session for upgrading.
 * POST /api/billing/checkout
 */
billingRoutes.post('/checkout', async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json<{
    planTier: UpgradePlanTier;
    billingInterval?: BillingIntervalValue;
    successUrl: string;
    cancelUrl: string;
    trialDays?: number;
    couponCode?: string;
  }>();

  try {
    const billingService = getBillingService();
    const result = await billingService.createCheckoutSession({
      userId,
      planTier: body.planTier as PlanTier,
      billingInterval: (body.billingInterval ?? DEFAULT_BILLING_INTERVAL) as BillingInterval,
      successUrl: body.successUrl,
      cancelUrl: body.cancelUrl,
      trialDays: body.trialDays,
      couponCode: body.couponCode,
    });

    return c.json({
      data: {
        checkoutUrl: result.url,
        sessionId: result.sessionId,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create checkout session';
    return c.json({ error: message }, 400);
  }
});

/**
 * Create a Stripe portal session for managing subscription.
 * POST /api/billing/portal
 */
billingRoutes.post('/portal', async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json<{
    returnUrl: string;
  }>();

  const subscription = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.userId, userId),
  });

  if (!subscription) {
    return c.json({ error: 'No subscription found' }, 404);
  }

  try {
    const billingService = getBillingService();
    const result = await billingService.createPortalSession({
      userId,
      returnUrl: body.returnUrl,
    });

    return c.json({
      data: {
        portalUrl: result.url,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create portal session';
    return c.json({ error: message }, 400);
  }
});

/**
 * Cancel subscription at period end.
 * POST /api/billing/cancel
 */
billingRoutes.post('/cancel', async (c) => {
  const userId = getUserId(c);

  try {
    const billingService = getBillingService();
    await billingService.cancelSubscription(userId);

    return c.json({
      data: {
        message: 'Subscription will be canceled at the end of the current period',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to cancel subscription';
    return c.json({ error: message }, 400);
  }
});

/**
 * Resume a canceled subscription.
 * POST /api/billing/resume
 */
billingRoutes.post('/resume', async (c) => {
  const userId = getUserId(c);

  try {
    const billingService = getBillingService();
    await billingService.resumeSubscription(userId);

    return c.json({
      data: {
        message: 'Subscription resumed',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to resume subscription';
    return c.json({ error: message }, 400);
  }
});

/**
 * Get user's invoices.
 * GET /api/billing/invoices
 */
billingRoutes.get('/invoices', async (c) => {
  const userId = getUserId(c);
  const limit = parseInt(c.req.query('limit') ?? String(DEFAULT_BILLING_LIST_LIMIT), 10);

  try {
    const billingService = getBillingService();
    const invoices = await billingService.getInvoices(userId, limit);

    return c.json({
      data: {
        invoices,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch invoices';
    return c.json({ error: message }, 400);
  }
});

/**
 * Get user's payment methods.
 * GET /api/billing/payment-methods
 */
billingRoutes.get('/payment-methods', async (c) => {
  const userId = getUserId(c);

  try {
    const billingService = getBillingService();
    const paymentMethods = await billingService.getPaymentMethods(userId);

    return c.json({
      data: {
        paymentMethods,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch payment methods';
    return c.json({ error: message }, 400);
  }
});

/**
 * Set default payment method.
 * POST /api/billing/payment-methods/:id/default
 */
billingRoutes.post('/payment-methods/:id/default', async (c) => {
  const userId = getUserId(c);
  const paymentMethodId = c.req.param('id');

  try {
    const billingService = getBillingService();
    await billingService.setDefaultPaymentMethod(userId, paymentMethodId);

    return c.json({
      data: {
        message: 'Default payment method updated',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update payment method';
    return c.json({ error: message }, 400);
  }
});

/**
 * Delete a payment method.
 * DELETE /api/billing/payment-methods/:id
 */
billingRoutes.delete('/payment-methods/:id', async (c) => {
  const paymentMethodId = c.req.param('id');

  try {
    const billingService = getBillingService();
    await billingService.deletePaymentMethod(paymentMethodId);

    return c.body(null, 204);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete payment method';
    return c.json({ error: message }, 400);
  }
});

/**
 * Stripe webhook handler.
 * POST /api/billing/webhook
 */
billingRoutes.post('/webhook', async (c) => {
  const signature = c.req.header('stripe-signature');

  if (!signature) {
    return c.json({ error: 'Missing Stripe signature' }, 400);
  }

  try {
    const billingService = getBillingService();
    const payload = await c.req.text();
    const result = await billingService.handleWebhook(payload, signature);

    if (!result.handled && result.error) {
      return c.json({ error: result.error }, 400);
    }

    return c.json({ received: true, eventType: result.eventType });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Webhook handler failed';
    return c.json({ error: message }, 400);
  }
});

export { billingRoutes };
