/**
 * `@docket/api` — the billing webhook handler (mounted OUTSIDE the RPC `AppType`).
 *
 * @remarks
 * `POST /internal/billing/webhook` receives provider webhook payloads and folds each into the
 * org data-lifecycle via {@link applyBillingEvent}. It is non-RPC (no typed client
 * contract) and lives in `server.ts` next to `/api/auth`, because webhooks are an
 * untyped external edge.
 *
 * The handler reads the **raw** request body (never a re-parsed JSON object — Stripe's
 * HMAC is computed over the exact bytes received) and the `Stripe-Signature` header. When
 * the resolved {@link BillingGateway} is the real Stripe adapter (it exposes
 * {@link RealStripeGateway.verifyWebhook}), the signature is verified and the verified
 * Stripe event is mapped into a normalized {@link BillingEvent}; a missing signature or a
 * forged/tampered body is rejected (`400`). When the resolved gateway is the deterministic
 * {@link InMemoryBillingGateway} (local/test), it has no verifier and emits
 * already-normalized events, so the raw body is parsed and shape-checked instead. `now` is
 * read at request time (never at module scope).
 */
import type { BillingEvent, BillingGateway } from '@docket/billing';
import { db } from '@docket/db';
import { Hono } from 'hono';

import { applyBillingEvent } from '../billing/lifecycle';
import { getContainer } from '../container';

/**
 * A {@link BillingGateway} that can verify provider webhook signatures (the real Stripe
 * adapter). The mock gateway does not implement this — its absence selects the
 * trusted, pre-normalized local/test path.
 */
type WebhookVerifyingGateway = BillingGateway & {
  verifyWebhook(rawBody: string | Buffer, signature: string): Promise<BillingEvent | null>;
};

/** Whether the resolved billing gateway verifies real provider webhook signatures. */
function canVerifyWebhook(gateway: BillingGateway): gateway is WebhookVerifyingGateway {
  return typeof (gateway as Partial<WebhookVerifyingGateway>).verifyWebhook === 'function';
}

/** Narrow an untrusted JSON value to a {@link BillingEvent} (defensive parse). */
function asBillingEvent(value: unknown): BillingEvent | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v['id'] !== 'string' || typeof v['type'] !== 'string') return null;
  if (typeof v['referenceId'] !== 'string' || typeof v['createdAt'] !== 'string') return null;
  return value as BillingEvent;
}

/** The billing-webhook app: verifies (real) or shape-checks (mock) then advances the lifecycle. */
const webhooks = new Hono().post('/webhook', async (c) => {
  // Read the RAW bytes first: Stripe's signature is an HMAC over the exact request body,
  // so it must never be re-parsed/re-serialized before verification.
  const rawBody = await c.req.text();
  const gateway = getContainer().billing;

  let event: BillingEvent | null;
  if (canVerifyWebhook(gateway)) {
    // Real Stripe path: the signature MUST be present and valid, else reject.
    const signature = c.req.header('stripe-signature');
    if (!signature) return c.json({ error: 'missing stripe-signature header' }, 400);
    try {
      event = await gateway.verifyWebhook(rawBody, signature);
    } catch {
      // Bad signature, tampered body, or missing secret — never trust the payload.
      return c.json({ error: 'webhook signature verification failed' }, 400);
    }
    // Verified, but Docket does not model this event type: acknowledge without effect.
    if (!event) return c.json({ received: true, effect: null });
  } else {
    // Mock path (local/test): the gateway emits already-normalized events; shape-check only.
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      parsed = null;
    }
    event = asBillingEvent(parsed);
    if (!event) return c.json({ error: 'invalid billing event' }, 400);
  }

  const now = new Date().toISOString();
  const effect = await applyBillingEvent(db, event, now);
  return c.json({ received: true, effect });
});

export default webhooks;
