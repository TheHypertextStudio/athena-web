/**
 * Billing service types.
 *
 * @packageDocumentation
 */

/**
 * Subscription plan tiers.
 */
export type PlanTier = 'free' | 'pro' | 'team';

/**
 * Subscription status.
 */
export type SubscriptionStatus =
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'trialing'
  | 'paused'
  | 'unpaid';

/**
 * Billing interval.
 */
export type BillingInterval = 'month' | 'year';

/**
 * Price configuration.
 */
export interface PriceConfig {
  /**
   * Stripe price ID for monthly billing.
   */
  monthlyPriceId: string;

  /**
   * Stripe price ID for yearly billing.
   */
  yearlyPriceId: string;

  /**
   * Monthly price in cents.
   */
  monthlyPrice: number;

  /**
   * Yearly price in cents.
   */
  yearlyPrice: number;
}

/**
 * Plan configuration.
 */
export interface PlanConfig {
  id: PlanTier;
  name: string;
  description: string;
  prices: PriceConfig;
  features: string[];
  entitlements: string[];
  limits: {
    tasks?: number;
    projects?: number;
    workspaces?: number;
    teamMembers?: number;
    storageGb?: number;
    integrations?: number;
  };
}

/**
 * Customer data.
 */
export interface CustomerData {
  stripeCustomerId: string;
  email: string;
  name?: string;
  defaultPaymentMethodId?: string;
}

/**
 * Subscription data.
 */
export interface SubscriptionData {
  id: string;
  stripeSubscriptionId: string;
  customerId: string;
  planTier: PlanTier;
  status: SubscriptionStatus;
  billingInterval: BillingInterval;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  canceledAt?: Date;
  trialStart?: Date;
  trialEnd?: Date;
}

/**
 * Checkout session creation options.
 */
export interface CreateCheckoutOptions {
  userId: string;
  email?: string;
  planTier: PlanTier;
  billingInterval: BillingInterval;
  successUrl: string;
  cancelUrl: string;
  trialDays?: number;
  couponCode?: string;
}

/**
 * Checkout session result.
 */
export interface CheckoutResult {
  sessionId: string;
  url: string;
}

/**
 * Portal session options.
 */
export interface CreatePortalOptions {
  userId: string;
  returnUrl: string;
}

/**
 * Portal session result.
 */
export interface PortalResult {
  url: string;
}

/**
 * Invoice data.
 */
export interface InvoiceData {
  id: string;
  stripeInvoiceId: string;
  customerId: string;
  subscriptionId?: string;
  status: 'draft' | 'open' | 'paid' | 'uncollectible' | 'void';
  amountDue: number;
  amountPaid: number;
  currency: string;
  invoicePdfUrl?: string;
  hostedInvoiceUrl?: string;
  createdAt: Date;
  paidAt?: Date;
}

/**
 * Payment method data.
 */
export interface PaymentMethodData {
  id: string;
  type: 'card' | 'bank_account' | 'other';
  isDefault: boolean;
  card?: {
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
  };
}

/**
 * Usage record for metered billing.
 */
export interface UsageRecord {
  subscriptionItemId: string;
  quantity: number;
  timestamp: Date;
  action: 'increment' | 'set';
}

/**
 * Billing service configuration.
 */
export interface BillingServiceConfig {
  stripeSecretKey: string;
  stripeWebhookSecret: string;
  plans: PlanConfig[];
}

/**
 * Webhook event types we handle.
 */
export type WebhookEventType =
  | 'checkout.session.completed'
  | 'customer.created'
  | 'customer.updated'
  | 'customer.deleted'
  | 'customer.subscription.created'
  | 'customer.subscription.updated'
  | 'customer.subscription.deleted'
  | 'customer.subscription.paused'
  | 'customer.subscription.resumed'
  | 'customer.subscription.trial_will_end'
  | 'invoice.created'
  | 'invoice.paid'
  | 'invoice.payment_failed'
  | 'invoice.payment_action_required'
  | 'payment_method.attached'
  | 'payment_method.detached';

/**
 * Webhook handler result.
 */
export interface WebhookResult {
  handled: boolean;
  eventType: string;
  error?: string;
}
