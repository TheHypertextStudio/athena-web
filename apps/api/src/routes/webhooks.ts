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
import { applyBillingEvent } from '@docket/billing/application/lifecycle';
import {
  claimProviderEvent,
  completeProviderEvent,
  getBillingCustomer,
} from '@docket/billing/application/provider-state';
import type { BillingEvent, BillingGateway } from '@docket/billing/contracts';
import {
  billingDiscountAward,
  billingDiscountProgram,
  db,
  organizationBillingAccount,
} from '@docket/db';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';

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
    if (event.referenceId && event.type !== 'subscription.trial_will_end') {
      const subscription = await gateway.getSubscription(event.referenceId);
      if (subscription) {
        event = {
          ...event,
          type: event.type === 'checkout.completed' ? 'subscription.updated' : event.type,
          subscription,
        };
      }
    }
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
  const account = event.referenceId ? await getBillingCustomer(db, event.referenceId) : null;
  let countryEffect: 'verified' | 'awaiting_billing_country' | 'unsupported_country' | null = null;
  if (account?.countryVerificationRequired && account.countryVerifiedAt === null) {
    if (!event.customerId || event.customerId !== account.stripeCustomerId) {
      countryEffect = 'awaiting_billing_country';
    } else {
      const country = await gateway.getCustomerBillingCountry(event.customerId);
      if (!country) {
        countryEffect = 'awaiting_billing_country';
      } else if (country !== 'US') {
        await gateway.cancelSubscription(event.referenceId);
        countryEffect = 'unsupported_country';
      } else {
        await db
          .update(organizationBillingAccount)
          .set({ billingCountry: country, countryVerifiedAt: new Date(now) })
          .where(eq(organizationBillingAccount.organizationId, event.referenceId));
        countryEffect = 'verified';
      }
    }
  }
  const effect = await db.transaction(async (tx) => {
    if (!(await claimProviderEvent(tx, event))) return 'duplicate' as const;
    if (countryEffect === 'awaiting_billing_country' || countryEffect === 'unsupported_country') {
      await completeProviderEvent(tx, event.id, new Date(now));
      return countryEffect;
    }
    const applied = await applyBillingEvent(tx, event, now);
    if (event.type === 'subscription.paid') {
      const [scheduled] = await tx
        .select({ award: billingDiscountAward, program: billingDiscountProgram })
        .from(billingDiscountAward)
        .leftJoin(
          billingDiscountProgram,
          eq(billingDiscountProgram.key, billingDiscountAward.programKey),
        )
        .where(
          and(
            eq(billingDiscountAward.organizationId, event.referenceId),
            eq(billingDiscountAward.status, 'scheduled'),
          ),
        )
        .limit(1);
      if (scheduled) {
        const startsAt = new Date(event.createdAt);
        const endsAt = new Date(startsAt);
        endsAt.setUTCMonth(endsAt.getUTCMonth() + (scheduled.program?.reviewMonths ?? 12));
        await tx
          .update(billingDiscountAward)
          .set({ status: 'active', startsAt, endsAt, reviewAt: endsAt })
          .where(eq(billingDiscountAward.id, scheduled.award.id));
      }
    }
    await completeProviderEvent(tx, event.id, new Date(now));
    return applied;
  });
  return c.json({ received: true, effect });
});

export default webhooks;
