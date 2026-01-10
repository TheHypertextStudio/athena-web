/**
 * Server-side data fetching for billing settings.
 *
 * @packageDocumentation
 */

import { cookies } from 'next/headers';
import { mapResponseToError } from './api-errors';

const API_BASE = process.env.API_URL ?? 'http://localhost:4000';

async function fetchWithAuth<T>(path: string): Promise<T> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get('better-auth.session_token');

  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      Cookie: sessionCookie ? `better-auth.session_token=${sessionCookie.value}` : '',
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    throw await mapResponseToError(res);
  }

  return res.json() as Promise<T>;
}

// Types
export interface Subscription {
  planTier: 'free' | 'pro' | 'team';
  status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'paused';
  entitlements: string[];
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

export interface Plan {
  id: string;
  tier: 'free' | 'pro' | 'team';
  name: string;
  description: string;
  monthlyPrice: number;
  yearlyPrice: number;
  features: string[];
}

export interface Invoice {
  id: string;
  amountPaid: number;
  currency: string;
  status: string;
  createdAt: string;
  invoicePdfUrl: string | null;
}

export interface PaymentMethod {
  id: string;
  type: string;
  isDefault: boolean;
  card?: {
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
  };
}

// Data fetchers
export async function getSubscription(): Promise<{ data: Subscription }> {
  return fetchWithAuth('/api/billing/subscription');
}

export async function getPlans(): Promise<{ data: { plans: Plan[] } }> {
  return fetchWithAuth('/api/billing/plans');
}

export async function getInvoices(limit = 5): Promise<{ data: { invoices: Invoice[] } }> {
  return fetchWithAuth(`/api/billing/invoices?limit=${String(limit)}`);
}

export async function getPaymentMethods(): Promise<{ data: { paymentMethods: PaymentMethod[] } }> {
  return fetchWithAuth('/api/billing/payment-methods');
}
