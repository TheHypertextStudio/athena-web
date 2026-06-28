/**
 * Billing route helpers.
 *
 * @packageDocumentation
 */

import type { PlanTier, InvoiceData, PaymentMethodData } from '../../services/billing/types.js';
import type { Invoice, PaymentMethod } from '@athena/types/openapi/billing';

export const PLAN_TIER_VALUES = ['free', 'pro', 'team'] as const;
export const DEFAULT_PLAN_TIER: PlanTier = 'free';
export const DEFAULT_SUBSCRIPTION_STATUS = 'active' as const;
export const DEFAULT_BILLING_INTERVAL = 'month' as const;

export const ERROR_UNKNOWN_PLAN_TIER = 'Unknown plan tier';
export const ERROR_NO_SUBSCRIPTION = 'No subscription found';
export const ERROR_INVALID_CHECKOUT_PLAN = 'Invalid plan for checkout';
export const ERROR_PRICE_NOT_CONFIGURED = 'Price not configured for this plan';
export const ERROR_CHECKOUT_SESSION_FAILED = 'Failed to create checkout session';
export const ERROR_PORTAL_SESSION_FAILED = 'Failed to create portal session';
export const ERROR_CANCEL_SUBSCRIPTION_FAILED = 'Failed to cancel subscription';
export const ERROR_RESUME_SUBSCRIPTION_FAILED = 'Failed to resume subscription';
export const ERROR_FETCH_INVOICES_FAILED = 'Failed to fetch invoices';
export const ERROR_FETCH_PAYMENT_METHODS_FAILED = 'Failed to fetch payment methods';
export const ERROR_UPDATE_PAYMENT_METHOD_FAILED = 'Failed to update payment method';
export const ERROR_DELETE_PAYMENT_METHOD_FAILED = 'Failed to delete payment method';
export const ERROR_WEBHOOK_HANDLER_FAILED = 'Webhook handler failed';

export type UpgradePlanTier = 'pro' | 'team';
export type BillingIntervalValue = 'month' | 'year';

/**
 * Feature entitlements by plan tier.
 */
export const PLAN_ENTITLEMENTS: Record<PlanTier, string[]> = {
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

export const isPlanTier = (value: string): value is PlanTier =>
  PLAN_TIER_VALUES.includes(value as PlanTier);

export const toInvoice = (invoice: InvoiceData): Invoice => ({
  id: invoice.id,
  number: null,
  status: invoice.status,
  amount: invoice.amountDue,
  currency: invoice.currency,
  createdAt: invoice.createdAt,
  pdfUrl: invoice.invoicePdfUrl ?? null,
});

export const toPaymentMethod = (paymentMethod: PaymentMethodData): PaymentMethod => ({
  id: paymentMethod.id,
  type: paymentMethod.type,
  card: paymentMethod.card ?? null,
  isDefault: paymentMethod.isDefault,
});
