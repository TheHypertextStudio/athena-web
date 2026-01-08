/**
 * Billing service with Stripe integration.
 *
 * @packageDocumentation
 */

import Stripe from 'stripe';
import { db } from '../../db/index.js';
import { subscriptions, users } from '../../db/schema/index.js';
import { eq } from 'drizzle-orm';
import { env } from '../../lib/env.js';
import type {
  PlanTier,
  PlanConfig,
  BillingServiceConfig,
  CreateCheckoutOptions,
  CheckoutResult,
  CreatePortalOptions,
  PortalResult,
  SubscriptionData,
  CustomerData,
  InvoiceData,
  PaymentMethodData,
  WebhookResult,
  SubscriptionStatus,
} from './types.js';

type InvoiceWithSubscription = Stripe.Invoice & {
  subscription?: string | Stripe.Subscription | null;
};

type SubscriptionWithPeriod = Stripe.Subscription & {
  current_period_start?: number;
  current_period_end?: number;
};

/**
 * Default plan configurations.
 */
export const DEFAULT_PLANS: PlanConfig[] = [
  {
    id: 'free',
    name: 'Free',
    description: 'For personal use',
    prices: {
      monthlyPriceId: '',
      yearlyPriceId: '',
      monthlyPrice: 0,
      yearlyPrice: 0,
    },
    features: ['Up to 100 tasks', 'Up to 5 projects', 'Basic calendar', 'Activity tracking'],
    entitlements: ['basic_tasks', 'basic_projects', 'basic_calendar', 'basic_activities'],
    limits: {
      tasks: 100,
      projects: 5,
      workspaces: 1,
      storageGb: 1,
    },
  },
  {
    id: 'pro',
    name: 'Pro',
    description: 'For power users',
    prices: {
      monthlyPriceId: '', // Set via environment
      yearlyPriceId: '',
      monthlyPrice: 1200, // $12/month
      yearlyPrice: 9600, // $96/year ($8/month)
    },
    features: [
      'Unlimited tasks',
      'Unlimited projects',
      'Advanced time tracking',
      'All integrations',
      'Data export',
      'Priority support',
    ],
    entitlements: [
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
    limits: {
      tasks: -1, // Unlimited
      projects: -1,
      workspaces: 3,
      storageGb: 10,
      integrations: -1,
    },
  },
  {
    id: 'team',
    name: 'Team',
    description: 'For teams and organizations',
    prices: {
      monthlyPriceId: '',
      yearlyPriceId: '',
      monthlyPrice: 2400, // $24/user/month
      yearlyPrice: 19200, // $192/user/year ($16/month)
    },
    features: [
      'Everything in Pro',
      'Team workspaces',
      'Collaboration features',
      'Admin controls',
      'SSO/SAML',
      'Audit logs',
    ],
    entitlements: [
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
    limits: {
      tasks: -1,
      projects: -1,
      workspaces: -1,
      storageGb: 100,
      integrations: -1,
      teamMembers: -1,
    },
  },
];

/**
 * Billing service for Stripe integration.
 */
export class BillingService {
  private readonly stripe: Stripe;
  private readonly webhookSecret: string;
  private readonly plans: Map<PlanTier, PlanConfig>;

  constructor(config: BillingServiceConfig) {
    this.stripe = new Stripe(config.stripeSecretKey, {
      apiVersion: '2025-01-27.acacia' as Stripe.LatestApiVersion,
      typescript: true,
    });
    this.webhookSecret = config.stripeWebhookSecret;
    this.plans = new Map(config.plans.map((p) => [p.id, p]));
  }

  /**
   * Get or create a Stripe customer for a user.
   */
  async getOrCreateCustomer(userId: string): Promise<CustomerData> {
    // Check if user already has a Stripe customer ID
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user) {
      throw new Error('User not found');
    }

    // Check existing subscription for customer ID
    const existingSub = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.userId, userId),
    });

    if (existingSub?.stripeCustomerId) {
      const customer = await this.stripe.customers.retrieve(existingSub.stripeCustomerId);
      if (customer.deleted) {
        // Customer was deleted, create new one
        return this.createCustomer(userId, user.email, user.name);
      }
      const stripeCustomer = customer as Stripe.Customer;
      return {
        stripeCustomerId: existingSub.stripeCustomerId,
        email: stripeCustomer.email ?? user.email,
        name: stripeCustomer.name ?? user.name,
        defaultPaymentMethodId: (() => {
          const pm = stripeCustomer.invoice_settings.default_payment_method;
          if (typeof pm === 'string') return pm;
          if (pm && typeof pm === 'object' && 'id' in pm) return pm.id;
          return undefined;
        })(),
      };
    }

    // Create new customer
    return this.createCustomer(userId, user.email, user.name);
  }

  /**
   * Create a new Stripe customer.
   */
  private async createCustomer(
    userId: string,
    email: string,
    name?: string,
  ): Promise<CustomerData> {
    const customer = await this.stripe.customers.create({
      email,
      name,
      metadata: {
        userId,
      },
    });

    return {
      stripeCustomerId: customer.id,
      email: customer.email ?? email,
      name: customer.name ?? name,
    };
  }

  /**
   * Create a checkout session for subscribing to a plan.
   */
  async createCheckoutSession(options: CreateCheckoutOptions): Promise<CheckoutResult> {
    const plan = this.plans.get(options.planTier);
    if (!plan || options.planTier === 'free') {
      throw new Error('Invalid plan for checkout');
    }

    const priceId =
      options.billingInterval === 'year' ? plan.prices.yearlyPriceId : plan.prices.monthlyPriceId;

    if (!priceId) {
      throw new Error('Price not configured for this plan');
    }

    const customer = await this.getOrCreateCustomer(options.userId);

    const subscriptionData: Stripe.Checkout.SessionCreateParams.SubscriptionData = {
      metadata: {
        userId: options.userId,
        planTier: options.planTier,
      },
    };

    if (options.trialDays) {
      subscriptionData.trial_period_days = options.trialDays;
    }

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      customer: customer.stripeCustomerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: options.successUrl,
      cancel_url: options.cancelUrl,
      metadata: {
        userId: options.userId,
        planTier: options.planTier,
      },
      subscription_data: subscriptionData,
    };

    if (options.couponCode) {
      sessionParams.discounts = [{ coupon: options.couponCode }];
    }

    const session = await this.stripe.checkout.sessions.create(sessionParams);

    return {
      sessionId: session.id,
      url: session.url ?? '',
    };
  }

  /**
   * Create a billing portal session.
   */
  async createPortalSession(options: CreatePortalOptions): Promise<PortalResult> {
    const customer = await this.getOrCreateCustomer(options.userId);

    const session = await this.stripe.billingPortal.sessions.create({
      customer: customer.stripeCustomerId,
      return_url: options.returnUrl,
    });

    return {
      url: session.url,
    };
  }

  /**
   * Get user's current subscription.
   */
  async getSubscription(userId: string): Promise<SubscriptionData | null> {
    const sub = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.userId, userId),
    });

    if (!sub) {
      return null;
    }

    return {
      id: sub.id,
      stripeSubscriptionId: sub.stripeSubscriptionId ?? '',
      customerId: sub.stripeCustomerId,
      planTier: sub.planTier as PlanTier,
      status: sub.status as SubscriptionStatus,
      billingInterval: 'month', // Default to monthly, can be stored separately if needed
      currentPeriodStart: sub.currentPeriodStart ?? new Date(),
      currentPeriodEnd: sub.currentPeriodEnd ?? new Date(),
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    };
  }

  /**
   * Cancel a subscription at period end.
   */
  async cancelSubscription(userId: string): Promise<void> {
    const sub = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.userId, userId),
    });

    if (!sub?.stripeSubscriptionId) {
      throw new Error('No subscription found');
    }

    await this.stripe.subscriptions.update(sub.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });

    await db
      .update(subscriptions)
      .set({
        cancelAtPeriodEnd: true,
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.id, sub.id));
  }

  /**
   * Resume a canceled subscription.
   */
  async resumeSubscription(userId: string): Promise<void> {
    const sub = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.userId, userId),
    });

    if (!sub?.stripeSubscriptionId) {
      throw new Error('No subscription found');
    }

    await this.stripe.subscriptions.update(sub.stripeSubscriptionId, {
      cancel_at_period_end: false,
    });

    await db
      .update(subscriptions)
      .set({
        cancelAtPeriodEnd: false,
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.id, sub.id));
  }

  /**
   * Get user's invoices.
   */
  async getInvoices(userId: string, limit = 10): Promise<InvoiceData[]> {
    const sub = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.userId, userId),
    });

    if (!sub?.stripeCustomerId) {
      return [];
    }

    const invoices = await this.stripe.invoices.list({
      customer: sub.stripeCustomerId,
      limit,
    });

    return invoices.data.map((inv: Stripe.Invoice) => {
      const invoice = inv as InvoiceWithSubscription;
      const subscriptionValue = invoice.subscription;
      const subscriptionId =
        typeof subscriptionValue === 'string' ? subscriptionValue : subscriptionValue?.id;
      return {
        id: inv.id,
        stripeInvoiceId: inv.id,
        customerId: typeof inv.customer === 'string' ? inv.customer : (inv.customer?.id ?? ''),
        subscriptionId,
        status: (inv.status ?? 'draft') as 'draft' | 'open' | 'paid' | 'uncollectible' | 'void',
        amountDue: inv.amount_due,
        amountPaid: inv.amount_paid,
        currency: inv.currency,
        invoicePdfUrl: inv.invoice_pdf ?? undefined,
        hostedInvoiceUrl: inv.hosted_invoice_url ?? undefined,
        createdAt: new Date(inv.created * 1000),
        paidAt: inv.status_transitions.paid_at
          ? new Date(inv.status_transitions.paid_at * 1000)
          : undefined,
      };
    });
  }

  /**
   * Get user's payment methods.
   */
  async getPaymentMethods(userId: string): Promise<PaymentMethodData[]> {
    const customer = await this.getOrCreateCustomer(userId);

    const paymentMethods = await this.stripe.paymentMethods.list({
      customer: customer.stripeCustomerId,
      type: 'card',
    });

    return paymentMethods.data.map((pm: Stripe.PaymentMethod) => ({
      id: pm.id,
      type: 'card' as const,
      isDefault: pm.id === customer.defaultPaymentMethodId,
      card: pm.card
        ? {
            brand: pm.card.brand,
            last4: pm.card.last4,
            expMonth: pm.card.exp_month,
            expYear: pm.card.exp_year,
          }
        : undefined,
    }));
  }

  /**
   * Set default payment method.
   */
  async setDefaultPaymentMethod(userId: string, paymentMethodId: string): Promise<void> {
    const customer = await this.getOrCreateCustomer(userId);

    await this.stripe.customers.update(customer.stripeCustomerId, {
      invoice_settings: {
        default_payment_method: paymentMethodId,
      },
    });
  }

  /**
   * Delete a payment method.
   */
  async deletePaymentMethod(paymentMethodId: string): Promise<void> {
    await this.stripe.paymentMethods.detach(paymentMethodId);
  }

  /**
   * Get plan configuration.
   */
  getPlan(planTier: PlanTier): PlanConfig | undefined {
    return this.plans.get(planTier);
  }

  /**
   * Get all plans.
   */
  getPlans(): PlanConfig[] {
    return Array.from(this.plans.values());
  }

  /**
   * Check if user has entitlement.
   */
  async hasEntitlement(userId: string, entitlement: string): Promise<boolean> {
    const sub = await this.getSubscription(userId);
    const planTier = sub?.planTier ?? 'free';
    const plan = this.plans.get(planTier);
    return plan?.entitlements.includes(entitlement) ?? false;
  }

  /**
   * Handle Stripe webhook.
   */
  async handleWebhook(payload: string | Buffer, signature: string): Promise<WebhookResult> {
    let event: Stripe.Event;

    try {
      event = this.stripe.webhooks.constructEvent(payload, signature, this.webhookSecret);
    } catch (err) {
      return {
        handled: false,
        eventType: 'unknown',
        error: err instanceof Error ? err.message : 'Invalid webhook signature',
      };
    }

    try {
      switch (event.type) {
        case 'checkout.session.completed':
          this.handleCheckoutComplete(event.data.object);
          break;

        case 'customer.subscription.created':
        case 'customer.subscription.updated':
          await this.handleSubscriptionUpdate(event.data.object);
          break;

        case 'customer.subscription.deleted':
          await this.handleSubscriptionDeleted(event.data.object);
          break;

        case 'invoice.paid':
          await this.handleInvoicePaid(event.data.object);
          break;

        case 'invoice.payment_failed':
          await this.handlePaymentFailed(event.data.object);
          break;

        default:
          // Unhandled event type
          return {
            handled: false,
            eventType: event.type,
          };
      }

      return {
        handled: true,
        eventType: event.type,
      };
    } catch (err) {
      return {
        handled: false,
        eventType: event.type,
        error: err instanceof Error ? err.message : 'Webhook handler failed',
      };
    }
  }

  private handleCheckoutComplete(session: Stripe.Checkout.Session): void {
    const userId = session.metadata?.['userId'];
    if (!userId) return;

    // Subscription will be created via subscription.created webhook
    // This is just for any checkout-specific handling
  }

  private async handleSubscriptionUpdate(subscription: Stripe.Subscription): Promise<void> {
    const userId = subscription.metadata['userId'];
    if (!userId) return;

    const planTier = (subscription.metadata['planTier'] ?? 'pro') as 'free' | 'pro' | 'team';
    const customerId =
      typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
    const periodStart = (subscription as SubscriptionWithPeriod).current_period_start;
    const periodEnd = (subscription as SubscriptionWithPeriod).current_period_end;
    if (typeof periodStart !== 'number' || typeof periodEnd !== 'number') {
      throw new Error('Subscription period is missing');
    }

    const now = new Date();
    const existingSub = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.userId, userId),
    });

    // Map Stripe status to our status enum
    const statusMap: Record<string, 'active' | 'past_due' | 'canceled' | 'trialing' | 'paused'> = {
      active: 'active',
      past_due: 'past_due',
      canceled: 'canceled',
      trialing: 'trialing',
      paused: 'paused',
      incomplete: 'past_due',
      incomplete_expired: 'canceled',
      unpaid: 'past_due',
    };

    const subData = {
      stripeSubscriptionId: subscription.id,
      stripeCustomerId: customerId,
      planTier,
      status: statusMap[subscription.status] ?? 'active',
      currentPeriodStart: new Date(periodStart * 1000),
      currentPeriodEnd: new Date(periodEnd * 1000),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      updatedAt: now,
    };

    if (existingSub) {
      await db.update(subscriptions).set(subData).where(eq(subscriptions.id, existingSub.id));
    } else {
      await db.insert(subscriptions).values({
        id: crypto.randomUUID(),
        userId,
        ...subData,
        createdAt: now,
      });
    }
  }

  private async handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
    const userId = subscription.metadata['userId'];
    if (!userId) return;

    await db
      .update(subscriptions)
      .set({
        status: 'canceled',
        cancelAtPeriodEnd: true,
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.userId, userId));
  }

  private async handleInvoicePaid(_invoice: Stripe.Invoice): Promise<void> {
    // Handle successful payment - could send notification, update usage, etc.
  }

  private async handlePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    const customerId =
      typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
    if (!customerId) return;

    // Update subscription status if payment failed
    const sub = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.stripeCustomerId, customerId),
    });

    if (sub) {
      await db
        .update(subscriptions)
        .set({
          status: 'past_due',
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.id, sub.id));
    }
  }
}

/**
 * Create billing service from environment.
 */
export function createBillingService(): BillingService {
  // Use validated Stripe config object
  if (!env.stripeConfig) {
    throw new Error(
      'Stripe configuration missing - set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET',
    );
  }

  // Load price IDs from environment
  const plans = DEFAULT_PLANS.map((plan) => {
    let monthlyPriceId = plan.prices.monthlyPriceId;
    let yearlyPriceId = plan.prices.yearlyPriceId;

    // Map plan IDs to env config price IDs
    if (plan.id === 'pro') {
      monthlyPriceId = env.STRIPE_PRICE_ID_PRO_MONTHLY ?? monthlyPriceId;
      yearlyPriceId = env.STRIPE_PRICE_ID_PRO_YEARLY ?? yearlyPriceId;
    } else if (plan.id === 'team') {
      monthlyPriceId = env.STRIPE_PRICE_ID_TEAM_MONTHLY ?? monthlyPriceId;
      yearlyPriceId = env.STRIPE_PRICE_ID_TEAM_YEARLY ?? yearlyPriceId;
    }

    return {
      ...plan,
      prices: {
        ...plan.prices,
        monthlyPriceId,
        yearlyPriceId,
      },
    };
  });

  return new BillingService({
    stripeSecretKey: env.stripeConfig.secretKey,
    stripeWebhookSecret: env.stripeConfig.webhookSecret,
    plans,
  });
}

// Singleton instance
let billingServiceInstance: BillingService | null = null;

/**
 * Get the shared billing service instance.
 */
export function getBillingService(): BillingService {
  billingServiceInstance ??= createBillingService();
  return billingServiceInstance;
}
