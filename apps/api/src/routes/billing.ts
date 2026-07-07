/**
 * `@docket/api` — org-scoped billing + lifecycle router (mounted at `/v1/orgs/:orgId/billing`).
 *
 * @remarks
 * Subscription reads + checkout/portal opens go through the `@docket/integrations`
 * {@link BillingGateway} **port** (resolved from {@link getContainer}) — never the
 * Stripe SDK directly — so local/test runs use the deterministic
 * {@link InMemoryBillingGateway}. The org id (from the path's actor context) is the
 * gateway `referenceId`.
 *
 * This router also exposes the **org-facing** slice of the data-lifecycle pipeline
 * (data-model §3): `GET /lifecycle` reads `lifecycle_state` / `export_ready_at` /
 * `delete_after_at`; `POST /lifecycle/start-export-window` cancels the subscription
 * and opens the 14-day export window; `POST /lifecycle/reactivate` rescues an org out
 * of the window when its subscription is healthy again. The admin-only transitions
 * (place / release {@link lifecycleHold}) live in the `/admin/*` surface, not here.
 *
 * `POST /export` generates a downloadable snapshot of the org's entire work layer and
 * stores it via the {@link BlobStore} port, stamping `export_ready_at` on the org.
 *
 * Subscription/lifecycle reads are open to any org member; every mutation (`/checkout`,
 * `/portal`, `/export`, the lifecycle transitions) requires the `manage` capability via
 * {@link capabilityGuard}.
 */
import { db, organization } from '@docket/db';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { onReactivated, onTrialOrPaymentTerminal } from '../billing/lifecycle';
import type { AppEnv } from '../context';
import { getContainer } from '../container';
import { env } from '../env';
import { NotFoundError } from '../error';
import { collectWorkLayer } from '../lib/export-collect';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';

/** Subscription status returned by `GET /` — `null` when the org has no subscription. */
export const SubscriptionOut = z
  .object({
    id: z.string().describe("The billing provider's subscription id (e.g. a Stripe `sub_…` id)."),
    referenceId: z
      .string()
      .describe(
        'The Docket entity the subscription belongs to — the organization id (the gateway `referenceId`).',
      ),
    status: z
      .enum(['trialing', 'active', 'past_due', 'canceled'])
      .describe(
        'Provider subscription status: `trialing` (in a free trial), `active` (paid and current), `past_due` (a payment failed and is being retried), or `canceled` (ended). Drives the derived data-lifecycle state at `GET /lifecycle`.',
      ),
    currentPeriodEnd: z
      .string()
      .describe(
        'ISO-8601 instant the current billing period ends — when an active subscription next renews, or a canceled one lapses.',
      ),
    trialEnd: z
      .string()
      .optional()
      .describe(
        'ISO-8601 instant the free trial ends; omitted when the subscription is not (or no longer) trialing.',
      ),
  })
  .nullable();
/** Subscription status response value. */
export type SubscriptionOut = z.infer<typeof SubscriptionOut>;

/** Body for `POST /checkout`: redirect URLs (price + trial come from policy/env). */
export const CheckoutBody = z.object({
  successUrl: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Absolute URL the provider redirects to after a successful checkout. Defaults to the app `/billing/return?org=…&status=success` page.',
    ),
  cancelUrl: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Absolute URL the provider redirects to if the buyer abandons checkout. Defaults to the app `/billing/return?org=…&status=cancel` page.',
    ),
  priceKey: z
    .string()
    .min(1)
    .optional()
    .describe(
      'The price lookup key / price id to subscribe to. Defaults to the configured team price (env `STRIPE_PRICE_TEAM` / `DOCKET_PRICE_LOOKUP_TEAM`, else `docket_team`). The amount and trial come from policy/env, never the client.',
    ),
  customerEmail: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Email to pre-fill on the hosted checkout page; omit to let the provider collect it.',
    ),
});
/** Validated checkout-body value. */
export type CheckoutBody = z.infer<typeof CheckoutBody>;

/** Response for `POST /checkout` and `POST /portal`: a hosted provider URL to redirect to. */
export const RedirectOut = z.object({
  url: z
    .string()
    .describe(
      'The hosted provider URL the client should redirect the user to (a Stripe checkout or customer-portal URL).',
    ),
});
/** Redirect-URL response value. */
export type RedirectOut = z.infer<typeof RedirectOut>;

/**
 * The org's data-lifecycle status returned by `GET /lifecycle` and the lifecycle
 * transition endpoints (data-model §3).
 *
 * @remarks
 * `lifecycleState` is one of `trialing | active | past_due | export_window |
 * pending_deletion | deleted`. `exportReadyAt` is set once the org enters the export
 * window (or a manual export is generated); `deleteAfterAt` is the instant the cron
 * sweep may advance the org toward deletion. Both timestamps are `null` for a healthy
 * org.
 */
export const LifecycleOut = z
  .object({
    organizationId: z.string().describe('The organization this lifecycle status describes.'),
    lifecycleState: z
      .enum(['trialing', 'active', 'past_due', 'export_window', 'pending_deletion', 'deleted'])
      .describe(
        "The org's data-lifecycle state (data-model §3): `trialing`/`active` are healthy; `past_due` is a failed payment under retry; `export_window` is the 14-day grace period after cancellation where data can still be exported; `pending_deletion` is queued for the cron sweep to purge (writes are frozen with a 402 `card_required`); `deleted` is purged.",
      ),
    exportReadyAt: z
      .string()
      .nullable()
      .describe(
        'ISO-8601 instant a downloadable export became available (set on entering the export window or generating one manually); `null` for a healthy org.',
      ),
    deleteAfterAt: z
      .string()
      .nullable()
      .describe(
        'ISO-8601 instant after which the background cron sweep may advance the org toward deletion; `null` for a healthy org.',
      ),
  })
  .meta({ id: 'LifecycleOut', description: "An organization's data-lifecycle status." });
/** Org data-lifecycle status value. */
export type LifecycleOut = z.infer<typeof LifecycleOut>;

/**
 * Response for `POST /export`: a fetchable URL for the generated work-layer archive
 * plus the instant the URL stops being offered.
 */
export const ExportOut = z
  .object({
    downloadUrl: z
      .string()
      .describe(
        'A fetchable URL for the generated work-layer JSON archive, served from the BlobStore.',
      ),
    expiresAt: z
      .string()
      .describe(
        'ISO-8601 instant the download URL stops being advertised as valid (14 days after generation).',
      ),
  })
  .meta({ id: 'ExportOut', description: "A generated work-layer export's download URL." });
/** Work-layer export response value. */
export type ExportOut = z.infer<typeof ExportOut>;

/** Days a generated export download URL is advertised as valid for. */
const EXPORT_TTL_DAYS = 14;

/** Milliseconds in {@link EXPORT_TTL_DAYS}. */
const EXPORT_TTL_MS = EXPORT_TTL_DAYS * 24 * 60 * 60 * 1000;

/** Resolve the configured default price lookup key / price id for new subscriptions. */
function defaultPriceKey(): string {
  return env.STRIPE_PRICE_TEAM ?? env.DOCKET_PRICE_LOOKUP_TEAM ?? 'docket_team';
}

/** Build an absolute app URL for the given path (checkout success/cancel defaults). */
function appUrl(path: string): string {
  return `${env.API_URL}${path}`;
}

/** Load the org row for the actor's org, or 404 if it is missing/already purged. */
async function loadOrg(orgId: string): Promise<typeof organization.$inferSelect> {
  const rows = await db.select().from(organization).where(eq(organization.id, orgId)).limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('Organization not found');
  return row;
}

/** Map an organization row's lifecycle columns onto the {@link LifecycleOut} shape. */
function toLifecycleOut(o: typeof organization.$inferSelect): z.input<typeof LifecycleOut> {
  return {
    organizationId: o.id,
    lifecycleState: o.lifecycleState,
    exportReadyAt: o.exportReadyAt ? o.exportReadyAt.toISOString() : null,
    deleteAfterAt: o.deleteAfterAt ? o.deleteAfterAt.toISOString() : null,
  };
}

/** Org-scoped billing + lifecycle router: subscription, checkout/portal, export, lifecycle. */
const billing = new Hono<AppEnv>()
  .get(
    '/',
    apiDoc({
      tag: 'Billing',
      summary: 'Get the org subscription',
      response: SubscriptionOut,
      description: `Return the organization's current subscription as {@link SubscriptionOut}, or \`null\` when the org has never subscribed. The read goes through the \`@docket/billing\` BillingGateway **port** (resolved from the container), never the Stripe SDK directly - so local/test runs serve deterministic in-memory state while production reads Stripe. The org id is the gateway \`referenceId\`. \`status\` is one of \`trialing\` | \`active\` | \`past_due\` | \`canceled\`, with \`currentPeriodEnd\` and an optional \`trialEnd\`. Open to any org member (a read). This reports the *provider* subscription; the Docket-side data-lifecycle state derived from it lives at \`GET /lifecycle\`. Related: \`POST /checkout\` (start a subscription), \`POST /portal\` (manage it).`,
    }),
    async (c) => {
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
    },
  )
  .post(
    '/checkout',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Billing',
      summary: 'Open a checkout session',
      capability: 'manage',
      response: RedirectOut,
      description: `Open a hosted provider checkout session and return {@link RedirectOut} \`{ url }\` — the Stripe-hosted URL the client redirects the buyer to in order to start (or restart) the org's subscription. Goes through the BillingGateway port (in-memory in local/test, Stripe in production) with the org id as \`referenceId\`. The body fields are all optional: \`successUrl\`/\`cancelUrl\` default to the app's \`/billing/return\` page stamped with the org and outcome; \`priceKey\` defaults to the configured team price (env \`STRIPE_PRICE_TEAM\` / \`DOCKET_PRICE_LOOKUP_TEAM\`, else \`docket_team\`); \`customerEmail\` pre-fills checkout when supplied (the price and trial otherwise come from policy/env, never the client).

Side effect: creates a checkout session with the provider; the actual subscription state only changes once the buyer completes checkout and the provider's webhook lands (which drives the lifecycle transitions). Requires \`manage\` — committing the org to a paid plan is an administrative act. Related: \`POST /portal\` (manage an existing subscription), \`GET /\` (current subscription), \`GET /lifecycle\` (derived lifecycle state).`,
    }),
    zJson(CheckoutBody),
    async (c) => {
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
    },
  )
  .post(
    '/portal',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Billing',
      summary: 'Open the billing portal',
      capability: 'manage',
      response: RedirectOut,
      description: `Open the provider's hosted billing portal and return {@link RedirectOut} \`{ url }\` — the Stripe customer-portal URL where an admin manages the existing subscription (update the payment method, change/cancel the plan, view invoices). Goes through the BillingGateway port with the org id as \`referenceId\`. Side effect: any change the admin makes in the portal flows back via the provider webhook, which drives Docket's subscription + lifecycle state — this route only mints the portal link. Requires \`manage\`. Related: \`POST /checkout\` (start a subscription), \`GET /\` (current state), \`POST /lifecycle/reactivate\` (rescue an org out of the export window once billing is healthy).`,
    }),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const result = await getContainer().billing.createBillingPortalSession(orgId);
      return ok(c, RedirectOut, { url: result.url });
    },
  )
  .get(
    '/lifecycle',
    apiDoc({
      tag: 'Billing',
      summary: 'Get the org lifecycle status',
      response: LifecycleOut,
      description: `Return the org's **data-lifecycle** status as {@link LifecycleOut} (data-model §3): the \`lifecycleState\` (\`trialing\` | \`active\` | \`past_due\` | \`export_window\` | \`pending_deletion\` | \`deleted\`) plus \`exportReadyAt\` and \`deleteAfterAt\` timestamps. This is the Docket-side view of what a failed/cancelled subscription *means for the org's data* — distinct from the raw provider subscription at \`GET /\`. A healthy org reports \`null\` for both timestamps; once it enters the export window \`exportReadyAt\` is set and \`deleteAfterAt\` marks when the background cron sweep may advance it toward deletion. When an org is \`pending_deletion\` (or otherwise frozen), write endpoints across the API reject with a typed 402 (\`card_required\`) — this endpoint, a read open to any org member, is how a client discovers that state. A missing/purged org 404s. Related: \`POST /lifecycle/start-export-window\`, \`POST /lifecycle/reactivate\`, \`POST /export\`.`,
    }),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const org = await loadOrg(orgId);
      return ok(c, LifecycleOut, toLifecycleOut(org));
    },
  )
  .post(
    '/lifecycle/start-export-window',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Billing',
      summary: 'Start the data export window',
      capability: 'manage',
      response: LifecycleOut,
      description: `Voluntarily wind the org down: cancel the provider subscription and open the **14-day data-export window**, returning the updated {@link LifecycleOut} (now \`export_window\`, with \`exportReadyAt\`/\`deleteAfterAt\` stamped). This is the org-facing entry into the deletion pipeline (data-model §3) — the grace period during which an admin can still generate and download a full export via \`POST /export\` before the cron sweep advances the org toward \`pending_deletion\` and eventual deletion.

Side effects: the subscription cancel is best-effort against the gateway (a never-subscribed org simply has nothing to cancel), then the lifecycle transition (\`onTrialOrPaymentTerminal\`) is written — the lifecycle state, not the provider, is the source of truth Docket acts on. A missing org 404s first (so this never silently no-ops). Requires \`manage\`. Reversible while still healthy via \`POST /lifecycle/reactivate\`. Note the admin-only holds (place/release \`lifecycleHold\`) live in the \`/admin/*\` surface, not here. Related: \`POST /export\`, \`POST /lifecycle/reactivate\`.`,
    }),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      // Existence-check first so a missing org 404s instead of silently no-op'ing.
      await loadOrg(orgId);
      // Cancel the provider subscription, then open the org's export window. The cancel
      // is best-effort against the gateway (a never-subscribed org has nothing to cancel);
      // the lifecycle transition is the source of truth Docket acts on.
      await getContainer().billing.cancelSubscription(orgId);
      const now = new Date().toISOString();
      await onTrialOrPaymentTerminal(db, orgId, now);
      const org = await loadOrg(orgId);
      return ok(c, LifecycleOut, toLifecycleOut(org));
    },
  )
  .post(
    '/lifecycle/reactivate',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Billing',
      summary: 'Reactivate the org subscription',
      capability: 'manage',
      response: LifecycleOut,
      description: `Rescue an org back out of the data-export window and return the updated {@link LifecycleOut}. When an org's subscription is healthy again, \`onReactivated\` clears the \`export_window\`/terminal lifecycle state (and its \`exportReadyAt\`/\`deleteAfterAt\` stamps), restoring normal read/write operation and lifting the frozen-org 402 write-gate. This is the inverse of \`POST /lifecycle/start-export-window\`. A missing org 404s. Requires \`manage\`. Note this drives the *lifecycle* state; re-establishing the actual paid subscription is done through \`POST /checkout\` / \`POST /portal\`. Related: \`GET /lifecycle\`.`,
    }),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      await loadOrg(orgId);
      await onReactivated(db, orgId);
      const org = await loadOrg(orgId);
      return ok(c, LifecycleOut, toLifecycleOut(org));
    },
  )
  .post(
    '/export',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Billing',
      summary: 'Generate a work-layer export',
      capability: 'manage',
      response: ExportOut,
      description: `Generate a downloadable snapshot of the org's entire work layer and return {@link ExportOut} \`{ downloadUrl, expiresAt }\`. The handler scans the org's work-layer tables (\`collectWorkLayer\`), serializes them to a single JSON document, and writes it through the BlobStore **port** (in-memory/local or real object storage) under \`exports/<orgId>/<timestamp>.json\`. The returned \`downloadUrl\` is advertised as valid for 14 days (\`expiresAt\`).

Side effect: stamps \`exportReadyAt\` on the org so both the org's \`GET /lifecycle\` view and the admin lifecycle views reflect the fresh artifact — this is the export an admin takes before letting the deletion pipeline proceed, and it can be generated at any time (not only inside the export window). A missing/purged org 404s. Requires \`manage\`. Related: \`POST /lifecycle/start-export-window\` (which opens the grace period this export is meant for), \`GET /lifecycle\`.`,
    }),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      // Prove the org exists (and is the actor's own, since orgId comes from actorCtx)
      // before doing the work-layer scan + blob write.
      await loadOrg(orgId);

      const now = new Date();
      const document = {
        organizationId: orgId,
        generatedAt: now.toISOString(),
        tables: await collectWorkLayer(orgId),
      };
      const bytes = new TextEncoder().encode(JSON.stringify(document));
      const key = `exports/${orgId}/${now.getTime()}.json`;
      const stored = await getContainer().blob.put(key, bytes, 'application/json');

      // Stamp export_ready_at so the org + admin lifecycle views reflect the fresh artifact.
      await db.update(organization).set({ exportReadyAt: now }).where(eq(organization.id, orgId));

      const expiresAt = new Date(now.getTime() + EXPORT_TTL_MS).toISOString();
      return ok(c, ExportOut, { downloadUrl: stored.url, expiresAt });
    },
  );

export default billing;
