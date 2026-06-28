/**
 * Billing and subscription routes.
 *
 * Uses the BillingService for real Stripe integration.
 *
 * @packageDocumentation
 */

import { createRoute, z } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import {
  FeatureParamSchema,
  PaymentMethodIdParamSchema,
  InvoicesQuerySchema,
  CheckoutRequestSchema,
  PortalRequestSchema,
  SubscriptionResponseSchema,
  EntitlementsResponseSchema,
  FeatureAccessResponseSchema,
  PlansResponseSchema,
  CheckoutResponseSchema,
  PortalResponseSchema,
  InvoicesResponseSchema,
  PaymentMethodsResponseSchema,
  MessageResponseSchema,
} from '@athena/types/openapi/billing';
import {
  ErrorResponseSchema,
  NotFoundErrorSchema,
  UnauthorizedErrorSchema,
} from '@athena/types/openapi/common';
import { db } from '../db/index.js';
import { subscriptions } from '../db/schema/index.js';
import { requireAuth, getUserId } from '../middleware/auth.js';
import { createOpenAPIApp } from '../lib/openapi.js';
import { getBillingService, DEFAULT_PLANS } from '../services/billing/service.js';
import type { PlanTier, BillingInterval } from '../services/billing/types.js';
import {
  DEFAULT_PLAN_TIER,
  DEFAULT_SUBSCRIPTION_STATUS,
  ERROR_UNKNOWN_PLAN_TIER,
  ERROR_NO_SUBSCRIPTION,
  ERROR_INVALID_CHECKOUT_PLAN,
  ERROR_PRICE_NOT_CONFIGURED,
  ERROR_CHECKOUT_SESSION_FAILED,
  ERROR_PORTAL_SESSION_FAILED,
  ERROR_CANCEL_SUBSCRIPTION_FAILED,
  ERROR_RESUME_SUBSCRIPTION_FAILED,
  ERROR_FETCH_INVOICES_FAILED,
  ERROR_FETCH_PAYMENT_METHODS_FAILED,
  ERROR_UPDATE_PAYMENT_METHOD_FAILED,
  ERROR_DELETE_PAYMENT_METHOD_FAILED,
  ERROR_WEBHOOK_HANDLER_FAILED,
  PLAN_ENTITLEMENTS,
  toInvoice,
  toPaymentMethod,
  isPlanTier,
} from './billing/helpers.js';

const billingRoutes = createOpenAPIApp();
const authMiddleware = [requireAuth];


// =============================================================================
// Get Subscription
// =============================================================================

const getSubscription = createRoute({
  method: 'get',
  path: '/subscription',
  tags: ['Billing'],
  summary: 'Get subscription',
  description: 'Get current subscription status and plan details.',
  middleware: authMiddleware,
  responses: {
    200: {
      description: 'Subscription retrieved successfully',
      content: {
        'application/json': {
          schema: SubscriptionResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
    500: {
      description: 'Failed to resolve subscription',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// =============================================================================
// Get Entitlements
// =============================================================================

const getEntitlements = createRoute({
  method: 'get',
  path: '/entitlements',
  tags: ['Billing'],
  summary: 'Get entitlements',
  description: 'Get all feature entitlements for the current plan.',
  middleware: authMiddleware,
  responses: {
    200: {
      description: 'Entitlements retrieved successfully',
      content: {
        'application/json': {
          schema: EntitlementsResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
    500: {
      description: 'Failed to resolve entitlements',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// =============================================================================
// Check Feature Access
// =============================================================================

const checkFeatureAccess = createRoute({
  method: 'get',
  path: '/entitlements/{feature}',
  tags: ['Billing'],
  summary: 'Check feature access',
  description: 'Check if user has access to a specific feature.',
  middleware: authMiddleware,
  request: {
    params: FeatureParamSchema,
  },
  responses: {
    200: {
      description: 'Feature access status retrieved',
      content: {
        'application/json': {
          schema: FeatureAccessResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
    500: {
      description: 'Failed to resolve entitlements',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// =============================================================================
// Get Available Plans
// =============================================================================

const getPlans = createRoute({
  method: 'get',
  path: '/plans',
  tags: ['Billing'],
  summary: 'Get available plans',
  description: 'Get all available subscription plans. Does not require authentication.',
  responses: {
    200: {
      description: 'Plans retrieved successfully',
      content: {
        'application/json': {
          schema: PlansResponseSchema,
        },
      },
    },
  },
});

// =============================================================================
// Create Checkout Session
// =============================================================================

const createCheckout = createRoute({
  method: 'post',
  path: '/checkout',
  tags: ['Billing'],
  summary: 'Create checkout session',
  description: 'Create a Stripe checkout session for plan upgrade.',
  middleware: authMiddleware,
  request: {
    body: {
      content: {
        'application/json': {
          schema: CheckoutRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Checkout session created',
      content: {
        'application/json': {
          schema: CheckoutResponseSchema,
        },
      },
    },
    400: {
      description: 'Checkout error',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Create Portal Session
// =============================================================================

const createPortal = createRoute({
  method: 'post',
  path: '/portal',
  tags: ['Billing'],
  summary: 'Create portal session',
  description: 'Create a Stripe customer portal session for billing management.',
  middleware: authMiddleware,
  request: {
    body: {
      content: {
        'application/json': {
          schema: PortalRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Portal session created',
      content: {
        'application/json': {
          schema: PortalResponseSchema,
        },
      },
    },
    400: {
      description: 'Portal session error',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
    404: {
      description: 'Subscription not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// =============================================================================
// Cancel Subscription
// =============================================================================

const cancelSubscription = createRoute({
  method: 'post',
  path: '/cancel',
  tags: ['Billing'],
  summary: 'Cancel subscription',
  description: 'Cancel subscription at the end of the current billing period.',
  middleware: authMiddleware,
  responses: {
    200: {
      description: 'Subscription cancellation scheduled',
      content: {
        'application/json': {
          schema: MessageResponseSchema,
        },
      },
    },
    400: {
      description: 'No active subscription',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Resume Subscription
// =============================================================================

const resumeSubscription = createRoute({
  method: 'post',
  path: '/resume',
  tags: ['Billing'],
  summary: 'Resume subscription',
  description: 'Resume a cancelled subscription before it expires.',
  middleware: authMiddleware,
  responses: {
    200: {
      description: 'Subscription resumed',
      content: {
        'application/json': {
          schema: MessageResponseSchema,
        },
      },
    },
    400: {
      description: 'Subscription cannot be resumed',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Get Invoices
// =============================================================================

const getInvoices = createRoute({
  method: 'get',
  path: '/invoices',
  tags: ['Billing'],
  summary: 'Get invoices',
  description: 'Get billing history and invoices.',
  middleware: authMiddleware,
  request: {
    query: InvoicesQuerySchema,
  },
  responses: {
    200: {
      description: 'Invoices retrieved successfully',
      content: {
        'application/json': {
          schema: InvoicesResponseSchema,
        },
      },
    },
    400: {
      description: 'Failed to fetch invoices',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Get Payment Methods
// =============================================================================

const getPaymentMethods = createRoute({
  method: 'get',
  path: '/payment-methods',
  tags: ['Billing'],
  summary: 'Get payment methods',
  description: 'Get saved payment methods.',
  middleware: authMiddleware,
  responses: {
    200: {
      description: 'Payment methods retrieved successfully',
      content: {
        'application/json': {
          schema: PaymentMethodsResponseSchema,
        },
      },
    },
    400: {
      description: 'Failed to fetch payment methods',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Set Default Payment Method
// =============================================================================

const setDefaultPaymentMethod = createRoute({
  method: 'post',
  path: '/payment-methods/{id}/default',
  tags: ['Billing'],
  summary: 'Set default payment method',
  description: 'Set a payment method as the default.',
  middleware: authMiddleware,
  request: {
    params: PaymentMethodIdParamSchema,
  },
  responses: {
    200: {
      description: 'Default payment method updated',
      content: {
        'application/json': {
          schema: MessageResponseSchema,
        },
      },
    },
    400: {
      description: 'Failed to update payment method',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
    404: {
      description: 'Payment method not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Delete Payment Method
// =============================================================================

const deletePaymentMethod = createRoute({
  method: 'delete',
  path: '/payment-methods/{id}',
  tags: ['Billing'],
  summary: 'Delete payment method',
  description: 'Delete a saved payment method.',
  middleware: authMiddleware,
  request: {
    params: PaymentMethodIdParamSchema,
  },
  responses: {
    204: {
      description: 'Payment method deleted successfully',
    },
    400: {
      description: 'Failed to delete payment method',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
    404: {
      description: 'Payment method not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Stripe Webhook
// =============================================================================

const stripeSignatureHeaderSchema = z.object({
  'stripe-signature': z.string().optional(),
});

const billingWebhook = createRoute({
  method: 'post',
  path: '/webhook',
  tags: ['Billing'],
  summary: 'Stripe webhook',
  description: 'Handle Stripe webhook events.',
  request: {
    headers: stripeSignatureHeaderSchema,
    body: {
      content: {
        'text/plain': {
          schema: z.string(),
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: 'Webhook processed',
      content: {
        'application/json': {
          schema: z.object({
            received: z.boolean(),
            eventType: z.string().optional(),
          }),
        },
      },
    },
    400: {
      description: 'Webhook error',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

/**
 * Get current user's subscription and plan.
 * GET /api/billing/subscription
 */
billingRoutes.openapi(getSubscription, async (c) => {
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
    }, 200);
  }

  if (!isPlanTier(result.planTier)) {
    return c.json({ error: ERROR_UNKNOWN_PLAN_TIER }, 500);
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
  }, 200);
});

/**
 * Check if user has access to a specific feature.
 * GET /api/billing/entitlements/:feature
 */
billingRoutes.openapi(checkFeatureAccess, async (c) => {
  const userId = getUserId(c);
  const { feature } = c.req.valid('param');

  const result = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.userId, userId),
  });

  let planTier: PlanTier = DEFAULT_PLAN_TIER;
  if (result) {
    if (!isPlanTier(result.planTier)) {
      return c.json({ error: ERROR_UNKNOWN_PLAN_TIER }, 500);
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
  }, 200);
});

/**
 * Get all entitlements for current user.
 * GET /api/billing/entitlements
 */
billingRoutes.openapi(getEntitlements, async (c) => {
  const userId = getUserId(c);

  const result = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.userId, userId),
  });

  let planTier: PlanTier = DEFAULT_PLAN_TIER;
  if (result) {
    if (!isPlanTier(result.planTier)) {
      return c.json({ error: ERROR_UNKNOWN_PLAN_TIER }, 500);
    }
    planTier = result.planTier;
  }
  const entitlements = PLAN_ENTITLEMENTS[planTier];

  return c.json({
    data: {
      planTier,
      entitlements,
    },
  }, 200);
});

/**
 * Get available plans.
 * GET /api/billing/plans
 */
billingRoutes.openapi(getPlans, (c) => {
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
  }, 200);
});

/**
 * Create a Stripe checkout session for upgrading.
 * POST /api/billing/checkout
 */
billingRoutes.openapi(createCheckout, async (c) => {
  const userId = getUserId(c);
  const body = c.req.valid('json');

  try {
    const billingService = getBillingService();
    const result = await billingService.createCheckoutSession({
      userId,
      planTier: body.planTier as PlanTier,
      billingInterval: body.billingInterval as BillingInterval,
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
    }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === ERROR_INVALID_CHECKOUT_PLAN || message === ERROR_PRICE_NOT_CONFIGURED) {
      return c.json({ error: message }, 400);
    }
    return c.json({ error: ERROR_CHECKOUT_SESSION_FAILED }, 400);
  }
});

/**
 * Create a Stripe portal session for managing subscription.
 * POST /api/billing/portal
 */
billingRoutes.openapi(createPortal, async (c) => {
  const userId = getUserId(c);
  const body = c.req.valid('json');

  const subscription = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.userId, userId),
  });

  if (!subscription) {
    return c.json({ error: ERROR_NO_SUBSCRIPTION }, 404);
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
    }, 200);
  } catch {
    return c.json({ error: ERROR_PORTAL_SESSION_FAILED }, 400);
  }
});

/**
 * Cancel subscription at period end.
 * POST /api/billing/cancel
 */
billingRoutes.openapi(cancelSubscription, async (c) => {
  const userId = getUserId(c);

  try {
    const billingService = getBillingService();
    await billingService.cancelSubscription(userId);

    return c.json({
      data: {
        message: 'Subscription will be canceled at the end of the current period',
      },
    }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const errorMessage =
      message === ERROR_NO_SUBSCRIPTION ? ERROR_NO_SUBSCRIPTION : ERROR_CANCEL_SUBSCRIPTION_FAILED;
    return c.json({ error: errorMessage }, 400);
  }
});

/**
 * Resume a canceled subscription.
 * POST /api/billing/resume
 */
billingRoutes.openapi(resumeSubscription, async (c) => {
  const userId = getUserId(c);

  try {
    const billingService = getBillingService();
    await billingService.resumeSubscription(userId);

    return c.json({
      data: {
        message: 'Subscription resumed',
      },
    }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const errorMessage =
      message === ERROR_NO_SUBSCRIPTION ? ERROR_NO_SUBSCRIPTION : ERROR_RESUME_SUBSCRIPTION_FAILED;
    return c.json({ error: errorMessage }, 400);
  }
});

/**
 * Get user's invoices.
 * GET /api/billing/invoices
 */
billingRoutes.openapi(getInvoices, async (c) => {
  const userId = getUserId(c);
  const { limit } = c.req.valid('query');

  try {
    const billingService = getBillingService();
    const invoices = await billingService.getInvoices(userId, limit);
    const invoiceList = invoices.map((invoice) => toInvoice(invoice));

    return c.json({
      data: {
        invoices: invoiceList,
      },
    }, 200);
  } catch {
    return c.json({ error: ERROR_FETCH_INVOICES_FAILED }, 400);
  }
});

/**
 * Get user's payment methods.
 * GET /api/billing/payment-methods
 */
billingRoutes.openapi(getPaymentMethods, async (c) => {
  const userId = getUserId(c);

  try {
    const billingService = getBillingService();
    const paymentMethods = await billingService.getPaymentMethods(userId);
    const methodList = paymentMethods.map((paymentMethod) => toPaymentMethod(paymentMethod));

    return c.json({
      data: {
        paymentMethods: methodList,
      },
    }, 200);
  } catch {
    return c.json({ error: ERROR_FETCH_PAYMENT_METHODS_FAILED }, 400);
  }
});

/**
 * Set default payment method.
 * POST /api/billing/payment-methods/:id/default
 */
billingRoutes.openapi(setDefaultPaymentMethod, async (c) => {
  const userId = getUserId(c);
  const { id: paymentMethodId } = c.req.valid('param');

  try {
    const billingService = getBillingService();
    await billingService.setDefaultPaymentMethod(userId, paymentMethodId);

    return c.json({
      data: {
        message: 'Default payment method updated',
      },
    }, 200);
  } catch {
    return c.json({ error: ERROR_UPDATE_PAYMENT_METHOD_FAILED }, 400);
  }
});

/**
 * Delete a payment method.
 * DELETE /api/billing/payment-methods/:id
 */
billingRoutes.openapi(deletePaymentMethod, async (c) => {
  const { id: paymentMethodId } = c.req.valid('param');

  try {
    const billingService = getBillingService();
    await billingService.deletePaymentMethod(paymentMethodId);

    return c.body(null, 204);
  } catch {
    return c.json({ error: ERROR_DELETE_PAYMENT_METHOD_FAILED }, 400);
  }
});

/**
 * Stripe webhook handler.
 * POST /api/billing/webhook
 */
billingRoutes.openapi(billingWebhook, async (c) => {
  const { 'stripe-signature': signature } = c.req.valid('header');

  if (!signature) {
    return c.json({ error: 'Missing Stripe signature' }, 400);
  }

  try {
    const billingService = getBillingService();
    const payload = await c.req.text();
    z.string().min(1).parse(payload);
    const result = await billingService.handleWebhook(payload, signature);

    if (!result.handled && result.error) {
      return c.json({ error: result.error }, 400);
    }

    return c.json({ received: true, eventType: result.eventType }, 200);
  } catch {
    return c.json({ error: ERROR_WEBHOOK_HANDLER_FAILED }, 400);
  }
});

export { billingRoutes };
