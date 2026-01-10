/**
 * Billing OpenAPI schemas.
 *
 * These schemas define the API contract for billing endpoints and are used for:
 * - Request/response validation
 * - OpenAPI spec generation
 * - Generated client types
 *
 * @packageDocumentation
 */

import { z } from '@hono/zod-openapi';
import { TimestampSchema, successResponseSchema } from './common.js';

// =============================================================================
// Enums
// =============================================================================

export const PlanTierSchema = z.enum(['free', 'pro', 'team']).openapi({
  description: 'Subscription plan tier',
  example: 'pro',
});

export const BillingIntervalSchema = z.enum(['month', 'year']).openapi({
  description: 'Billing interval',
  example: 'month',
});

// =============================================================================
// Core Billing Schemas
// =============================================================================

export const SubscriptionSchema = z
  .object({
    planTier: PlanTierSchema,
    status: z.string().openapi({ description: 'Subscription status', example: 'active' }),
    entitlements: z.array(z.string()).openapi({ description: 'List of enabled features' }),
    currentPeriodStart: TimestampSchema.nullable().openapi({ description: 'Current period start' }),
    currentPeriodEnd: TimestampSchema.nullable().openapi({ description: 'Current period end' }),
    cancelAtPeriodEnd: z
      .boolean()
      .openapi({ description: 'Whether subscription will cancel at period end' }),
  })
  .openapi('Subscription');

export const EntitlementsSchema = z
  .object({
    planTier: PlanTierSchema,
    entitlements: z.array(z.string()).openapi({ description: 'List of enabled features' }),
  })
  .openapi('Entitlements');

export const FeatureAccessSchema = z
  .object({
    feature: z.string().openapi({ description: 'Feature identifier' }),
    hasAccess: z.boolean().openapi({ description: 'Whether user has access' }),
    planTier: PlanTierSchema,
  })
  .openapi('FeatureAccess');

export const PlanSchema = z
  .object({
    id: z.string().openapi({ description: 'Plan identifier' }),
    name: z.string().openapi({ description: 'Plan display name', example: 'Pro' }),
    description: z.string().openapi({ description: 'Plan description' }),
    monthlyPrice: z.number().openapi({ description: 'Monthly price in cents', example: 1200 }),
    yearlyPrice: z.number().openapi({ description: 'Yearly price in cents', example: 9600 }),
    features: z.array(z.string()).openapi({ description: 'List of included features' }),
    limits: z.record(z.string(), z.number()).openapi({ description: 'Plan limits' }),
  })
  .openapi('Plan');

export const InvoiceSchema = z
  .object({
    id: z.string().openapi({ description: 'Invoice ID' }),
    number: z.string().nullable().openapi({ description: 'Invoice number' }),
    status: z.string().openapi({ description: 'Invoice status' }),
    amount: z.number().openapi({ description: 'Amount in cents' }),
    currency: z.string().openapi({ description: 'Currency code', example: 'usd' }),
    createdAt: TimestampSchema.openapi({ description: 'Invoice creation date' }),
    pdfUrl: z.string().nullable().openapi({ description: 'URL to download PDF' }),
  })
  .openapi('Invoice');

export const PaymentMethodSchema = z
  .object({
    id: z.string().openapi({ description: 'Payment method ID' }),
    type: z.string().openapi({ description: 'Payment method type', example: 'card' }),
    card: z
      .object({
        brand: z.string().openapi({ description: 'Card brand', example: 'visa' }),
        last4: z.string().openapi({ description: 'Last 4 digits', example: '4242' }),
        expMonth: z.number().openapi({ description: 'Expiration month' }),
        expYear: z.number().openapi({ description: 'Expiration year' }),
      })
      .nullable()
      .openapi({ description: 'Card details' }),
    isDefault: z.boolean().openapi({ description: 'Whether this is the default payment method' }),
  })
  .openapi('PaymentMethod');

// =============================================================================
// Path Parameters
// =============================================================================

export const FeatureParamSchema = z
  .object({
    feature: z.string().openapi({
      description: 'Feature identifier',
      example: 'integrations',
      param: { name: 'feature', in: 'path' },
    }),
  })
  .openapi('FeatureParam');

export const PaymentMethodIdParamSchema = z
  .object({
    id: z.string().openapi({
      description: 'Payment method ID',
      param: { name: 'id', in: 'path' },
    }),
  })
  .openapi('PaymentMethodIdParam');

// =============================================================================
// Query Parameters
// =============================================================================

export const InvoicesQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(10)
      .openapi({
        description: 'Maximum number of invoices to return',
        example: 10,
        param: { name: 'limit', in: 'query' },
      }),
  })
  .openapi('InvoicesQuery');

// =============================================================================
// Request Bodies
// =============================================================================

export const CheckoutRequestSchema = z
  .object({
    planTier: z.enum(['pro', 'team']).openapi({
      description: 'Plan to upgrade to',
    }),
    billingInterval: BillingIntervalSchema.default('month').openapi({
      description: 'Billing interval',
    }),
    successUrl: z.url().openapi({
      description: 'URL to redirect after successful checkout',
    }),
    cancelUrl: z.url().openapi({
      description: 'URL to redirect after cancelled checkout',
    }),
    trialDays: z.number().int().min(0).optional().openapi({
      description: 'Number of trial days',
    }),
    couponCode: z.string().optional().openapi({
      description: 'Coupon code to apply',
    }),
  })
  .openapi('CheckoutRequest');

export const PortalRequestSchema = z
  .object({
    returnUrl: z.url().openapi({
      description: 'URL to return to after portal session',
    }),
  })
  .openapi('PortalRequest');

// =============================================================================
// Response Schemas
// =============================================================================

export const SubscriptionResponseSchema = successResponseSchema(
  SubscriptionSchema,
  'Subscription response',
).openapi('SubscriptionResponse');

export const EntitlementsResponseSchema = successResponseSchema(
  EntitlementsSchema,
  'Entitlements response',
).openapi('EntitlementsResponse');

export const FeatureAccessResponseSchema = successResponseSchema(
  FeatureAccessSchema,
  'Feature access response',
).openapi('FeatureAccessResponse');

export const PlansResponseSchema = successResponseSchema(
  z.object({ plans: z.array(PlanSchema) }),
  'Plans response',
).openapi('PlansResponse');

export const CheckoutResponseSchema = successResponseSchema(
  z.object({
    checkoutUrl: z.url().openapi({ description: 'Stripe checkout URL' }),
    sessionId: z.string().openapi({ description: 'Checkout session ID' }),
  }),
  'Checkout response',
).openapi('CheckoutResponse');

export const PortalResponseSchema = successResponseSchema(
  z.object({
    portalUrl: z.url().openapi({ description: 'Stripe portal URL' }),
  }),
  'Portal response',
).openapi('PortalResponse');

export const InvoicesResponseSchema = successResponseSchema(
  z.object({ invoices: z.array(InvoiceSchema) }),
  'Invoices response',
).openapi('InvoicesResponse');

export const PaymentMethodsResponseSchema = successResponseSchema(
  z.object({ paymentMethods: z.array(PaymentMethodSchema) }),
  'Payment methods response',
).openapi('PaymentMethodsResponse');

export const MessageResponseSchema = successResponseSchema(
  z.object({ message: z.string() }),
  'Message response',
).openapi('MessageResponse');

// =============================================================================
// Type Exports
// =============================================================================

export type PlanTier = z.infer<typeof PlanTierSchema>;
export type BillingInterval = z.infer<typeof BillingIntervalSchema>;
export type Subscription = z.infer<typeof SubscriptionSchema>;
export type Entitlements = z.infer<typeof EntitlementsSchema>;
export type FeatureAccess = z.infer<typeof FeatureAccessSchema>;
export type Plan = z.infer<typeof PlanSchema>;
export type Invoice = z.infer<typeof InvoiceSchema>;
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;
export type CheckoutRequest = z.infer<typeof CheckoutRequestSchema>;
export type PortalRequest = z.infer<typeof PortalRequestSchema>;
export type SubscriptionResponse = z.infer<typeof SubscriptionResponseSchema>;
export type EntitlementsResponse = z.infer<typeof EntitlementsResponseSchema>;
export type FeatureAccessResponse = z.infer<typeof FeatureAccessResponseSchema>;
export type PlansResponse = z.infer<typeof PlansResponseSchema>;
export type CheckoutResponse = z.infer<typeof CheckoutResponseSchema>;
export type PortalResponse = z.infer<typeof PortalResponseSchema>;
export type InvoicesResponse = z.infer<typeof InvoicesResponseSchema>;
export type PaymentMethodsResponse = z.infer<typeof PaymentMethodsResponseSchema>;
