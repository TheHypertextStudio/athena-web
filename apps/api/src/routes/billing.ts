/**
 * `@docket/api` — org-scoped billing router (mounted at `/v1/orgs/:orgId/billing`).
 *
 * @remarks
 * All three endpoints go through the `@docket/boundaries` {@link BillingGateway}
 * **port** (resolved from {@link getContainer}) — never the Stripe SDK directly — so
 * local/test runs use the deterministic {@link InMemoryBillingGateway}. The org id
 * (from the path's actor context) is the gateway `referenceId`. Reads are open to any
 * org member; mutations (`/checkout`, `/portal`) require the `manage` capability via
 * {@link capabilityGuard}.
 */
import { z } from 'zod';
import { Hono } from 'hono';

import type { AppEnv } from '../context';
import { getContainer } from '../container';
import { env } from '../env';
import { ok } from '../lib/ok';
import { capabilityGuard } from '../permissions/capability-guard';
import { zJson } from '../lib/validate';

/** Subscription status returned by `GET /` — `null` when the org has no subscription. */
export const SubscriptionOut = z
  .object({
    id: z.string(),
    referenceId: z.string(),
    status: z.enum(['trialing', 'active', 'past_due', 'canceled']),
    currentPeriodEnd: z.string(),
    trialEnd: z.string().optional(),
  })
  .nullable();
/** Subscription status response value. */
export type SubscriptionOut = z.infer<typeof SubscriptionOut>;

/** Body for `POST /checkout`: redirect URLs (price + trial come from policy/env). */
export const CheckoutBody = z.object({
  successUrl: z.string().min(1).optional(),
  cancelUrl: z.string().min(1).optional(),
  priceKey: z.string().min(1).optional(),
  customerEmail: z.string().min(1).optional(),
});
/** Validated checkout-body value. */
export type CheckoutBody = z.infer<typeof CheckoutBody>;

/** Response for `POST /checkout` and `POST /portal`: a hosted provider URL to redirect to. */
export const RedirectOut = z.object({ url: z.string() });
/** Redirect-URL response value. */
export type RedirectOut = z.infer<typeof RedirectOut>;

/** Resolve the configured default price lookup key / price id for new subscriptions. */
function defaultPriceKey(): string {
  return env.STRIPE_PRICE_TEAM ?? env.DOCKET_PRICE_LOOKUP_TEAM ?? 'docket_team';
}

/** Build an absolute app URL for the given path (checkout success/cancel defaults). */
function appUrl(path: string): string {
  return `${env.API_URL}${path}`;
}

/** Org-scoped billing router: subscription status read + checkout/portal session opens. */
const billing = new Hono<AppEnv>()
  .get('/', async (c) => {
    const { orgId } = c.get('actorCtx');
    const sub = await getContainer().billing.getSubscription(orgId);
    const body: z.input<typeof SubscriptionOut> = sub
      ? {
          id: sub.id,
          referenceId: sub.referenceId,
          status: sub.status,
          currentPeriodEnd: sub.currentPeriodEnd,
          ...(sub.trialEnd ? { trialEnd: sub.trialEnd } : {}),
        }
      : null;
    return ok(c, SubscriptionOut, body);
  })
  .post('/checkout', capabilityGuard('manage'), zJson(CheckoutBody), async (c) => {
    const { orgId } = c.get('actorCtx');
    const input = c.req.valid('json');
    const result = await getContainer().billing.createCheckoutSession({
      referenceId: orgId,
      priceKey: input.priceKey ?? defaultPriceKey(),
      successUrl: input.successUrl ?? appUrl(`/billing/return?org=${orgId}&status=success`),
      cancelUrl: input.cancelUrl ?? appUrl(`/billing/return?org=${orgId}&status=cancel`),
      ...(input.customerEmail ? { customerEmail: input.customerEmail } : {}),
    });
    return ok(c, RedirectOut, { url: result.url });
  })
  .post('/portal', capabilityGuard('manage'), async (c) => {
    const { orgId } = c.get('actorCtx');
    const result = await getContainer().billing.createBillingPortalSession(orgId);
    return ok(c, RedirectOut, { url: result.url });
  });

export default billing;
