/**
 * `@docket/api` — the billing webhook handler (mounted OUTSIDE the RPC `AppType`).
 *
 * @remarks
 * `POST /v1/billing/webhook` receives normalized {@link BillingEvent}s — from the
 * real Stripe adapter (which maps + verifies provider payloads) or, in local/test, the
 * deterministic {@link InMemoryBillingGateway} — and folds each into the org
 * data-lifecycle via {@link applyBillingEvent}. It is non-RPC (no typed client
 * contract) and lives in `server.ts` next to `/api/auth`, because webhooks are an
 * untyped external edge.
 *
 * The real Stripe signature check belongs here (see the clearly-marked spot below);
 * the mock gateway emits already-normalized events, so no verification is needed in
 * local/test. `now` is read at request time (never at module scope).
 */
import type { BillingEvent } from '@docket/boundaries';
import { db } from '@docket/db';
import { Hono } from 'hono';

import { applyBillingEvent } from '../billing/lifecycle';

/** Narrow an untrusted JSON value to a {@link BillingEvent} (defensive parse). */
function asBillingEvent(value: unknown): BillingEvent | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v['id'] !== 'string' || typeof v['type'] !== 'string') return null;
  if (typeof v['referenceId'] !== 'string' || typeof v['createdAt'] !== 'string') return null;
  return value as BillingEvent;
}

/** The billing-webhook app: parses a normalized event and advances the org lifecycle. */
const webhooks = new Hono().post('/webhook', async (c) => {
  // --- Real Stripe signature verification spot -------------------------------
  // In production, verify the `Stripe-Signature` header against STRIPE_WEBHOOK_SECRET
  // and map the verified Stripe event into a normalized BillingEvent here. The mock
  // gateway emits already-normalized BillingEvents, so local/test needs no check.
  // ---------------------------------------------------------------------------
  const raw: unknown = await c.req.json().catch(() => null);
  const event = asBillingEvent(raw);
  if (!event) return c.json({ error: 'invalid billing event' }, 400);

  const now = new Date().toISOString();
  const effect = await applyBillingEvent(db, event, now);
  return c.json({ received: true, effect });
});

export default webhooks;
