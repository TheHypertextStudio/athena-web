/**
 * Billing OpenAPI route definitions.
 *
 * @packageDocumentation
 */

import { createRoute } from '@hono/zod-openapi';
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
  ValidationErrorSchema,
} from '@athena/types/openapi/common';

// =============================================================================
// Get Subscription
// =============================================================================

export const getSubscription = createRoute({
  method: 'get',
  path: '/subscription',
  tags: ['Billing'],
  summary: 'Get subscription',
  description: 'Get current subscription status and plan details.',
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
  },
});

// =============================================================================
// Get Entitlements
// =============================================================================

export const getEntitlements = createRoute({
  method: 'get',
  path: '/entitlements',
  tags: ['Billing'],
  summary: 'Get entitlements',
  description: 'Get all feature entitlements for the current plan.',
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
  },
});

// =============================================================================
// Check Feature Access
// =============================================================================

export const checkFeatureAccess = createRoute({
  method: 'get',
  path: '/entitlements/{feature}',
  tags: ['Billing'],
  summary: 'Check feature access',
  description: 'Check if user has access to a specific feature.',
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
  },
});

// =============================================================================
// Get Available Plans
// =============================================================================

export const getPlans = createRoute({
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

export const createCheckout = createRoute({
  method: 'post',
  path: '/checkout',
  tags: ['Billing'],
  summary: 'Create checkout session',
  description: 'Create a Stripe checkout session for plan upgrade.',
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
      description: 'Validation error',
      content: {
        'application/json': {
          schema: ValidationErrorSchema,
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

export const createPortal = createRoute({
  method: 'post',
  path: '/portal',
  tags: ['Billing'],
  summary: 'Create portal session',
  description: 'Create a Stripe customer portal session for billing management.',
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
// Cancel Subscription
// =============================================================================

export const cancelSubscription = createRoute({
  method: 'post',
  path: '/cancel',
  tags: ['Billing'],
  summary: 'Cancel subscription',
  description: 'Cancel subscription at the end of the current billing period.',
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

export const resumeSubscription = createRoute({
  method: 'post',
  path: '/resume',
  tags: ['Billing'],
  summary: 'Resume subscription',
  description: 'Resume a cancelled subscription before it expires.',
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

export const getInvoices = createRoute({
  method: 'get',
  path: '/invoices',
  tags: ['Billing'],
  summary: 'Get invoices',
  description: 'Get billing history and invoices.',
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

export const getPaymentMethods = createRoute({
  method: 'get',
  path: '/payment-methods',
  tags: ['Billing'],
  summary: 'Get payment methods',
  description: 'Get saved payment methods.',
  responses: {
    200: {
      description: 'Payment methods retrieved successfully',
      content: {
        'application/json': {
          schema: PaymentMethodsResponseSchema,
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

export const setDefaultPaymentMethod = createRoute({
  method: 'post',
  path: '/payment-methods/{id}/default',
  tags: ['Billing'],
  summary: 'Set default payment method',
  description: 'Set a payment method as the default.',
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

export const deletePaymentMethod = createRoute({
  method: 'delete',
  path: '/payment-methods/{id}',
  tags: ['Billing'],
  summary: 'Delete payment method',
  description: 'Delete a saved payment method.',
  request: {
    params: PaymentMethodIdParamSchema,
  },
  responses: {
    204: {
      description: 'Payment method deleted successfully',
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
