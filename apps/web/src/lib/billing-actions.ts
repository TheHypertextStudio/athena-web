'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';

const API_BASE = process.env['API_URL'] ?? 'http://localhost:4000';

async function fetchWithAuth<T>(path: string, options?: RequestInit): Promise<T> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get('better-auth.session_token');

  const baseHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    Cookie: sessionCookie ? `better-auth.session_token=${sessionCookie.value}` : '',
  };

  if (options?.headers) {
    const additionalHeaders = new Headers(options.headers);
    additionalHeaders.forEach((value, key) => {
      baseHeaders[key] = value;
    });
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: baseHeaders,
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch ${path}: ${String(res.status)}`);
  }

  return res.json() as Promise<T>;
}

export async function cancelSubscription() {
  await fetchWithAuth('/api/billing/cancel', { method: 'POST' });
  revalidatePath('/settings/billing');
}

export async function resumeSubscription() {
  await fetchWithAuth('/api/billing/resume', { method: 'POST' });
  revalidatePath('/settings/billing');
}

export async function createPortalSession(returnUrl: string): Promise<{ portalUrl: string }> {
  const result = await fetchWithAuth<{ data: { portalUrl: string } }>('/api/billing/portal', {
    method: 'POST',
    body: JSON.stringify({ returnUrl }),
  });
  return { portalUrl: result.data.portalUrl };
}

export async function createCheckoutSession(data: {
  planTier: 'pro' | 'team';
  billingInterval?: 'month' | 'year';
  successUrl: string;
  cancelUrl: string;
}): Promise<{ checkoutUrl: string; sessionId: string }> {
  const result = await fetchWithAuth<{ data: { checkoutUrl: string; sessionId: string } }>(
    '/api/billing/checkout',
    {
      method: 'POST',
      body: JSON.stringify(data),
    },
  );
  return result.data;
}
