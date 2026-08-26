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
 * This router keeps the deprecated `GET /lifecycle` response for older clients. Billing no
 * longer changes account-retention state. The confirmed Danger Zone account-deletion flow owns
 * retention, while Docket Pro access comes from the organization's billing entitlement.
 *
 * `POST /export` generates a downloadable snapshot of the org's entire work layer and
 * stores it via the {@link BlobStore} port, stamping `export_ready_at` on the org.
 *
 * Subscription and lifecycle reads are open to any org member. Every mutation (`/checkout`,
 * `/portal`, and `/export`) requires the `manage` capability via {@link capabilityGuard}.
 */
import {
  BILLING_DISCOUNT_APPLICATION_STATUSES,
  BILLING_DISCOUNT_AWARD_STATUSES,
  billingCredit,
  billingDiscountApplication,
  billingDiscountAward,
  db,
  genId,
  organization,
  organizationProductEntitlement,
} from '@docket/db';
import {
  PRODUCT_ENTITLEMENT_SOURCES,
  PRODUCT_ENTITLEMENT_STATUSES,
  PRODUCT_KEYS,
} from '@docket/billing/contracts';
import { and, desc, eq, gt, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import {
  acquireCheckoutAttempt,
  completeCheckoutAttempt,
  ensureBillingCustomer,
  failCheckoutAttempt,
  getBillingCustomer,
} from '@docket/billing/application/provider-state';
import type { AppEnv } from '../context';
import { getContainer } from '../container';
import { env } from '../env';
import {
  BillingCustomerMissingError,
  BillingUnavailableError,
  CheckoutPendingError,
  NotFoundError,
  SubscriptionExistsError,
} from '../error';
import { collectWorkLayer } from '../lib/export-collect';
import { ok } from '../lib/ok';
import { apiDoc, describeRoute } from '../lib/openapi-route';
import { zJson } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';
import billingDiscounts from './billing-discounts';

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

/** One paid product owned by an organization. */
export const BillingProductOut = z.object({
  productKey: z.enum(PRODUCT_KEYS),
  name: z.literal('Docket Pro'),
  status: z.enum(PRODUCT_ENTITLEMENT_STATUSES),
  source: z.enum(PRODUCT_ENTITLEMENT_SOURCES),
  trialEndsAt: z.string().nullable(),
  renewalDate: z.string().nullable(),
  cancelAtPeriodEnd: z.boolean(),
  cancellationDate: z.string().nullable(),
  graceEndsAt: z.string().nullable(),
  providerObservedAt: z.string().nullable(),
});
/** Organization product response value. */
export type BillingProductOut = z.infer<typeof BillingProductOut>;

/** Organization billing summary. Baseline Docket is represented by an empty products array. */
export const BillingSummaryOut = z.object({
  organizationId: z.string(),
  checkoutEnabled: z.boolean(),
  listPrice: z.object({
    amount: z.literal(800),
    currency: z.literal('usd'),
    interval: z.literal('month'),
  }),
  accessMode: z.enum(['writable', 'read_only']),
  products: z.array(BillingProductOut),
  canManageBilling: z.boolean(),
  effectiveDiscount: z
    .object({
      percentOff: z.number().int(),
      status: z.enum(BILLING_DISCOUNT_AWARD_STATUSES),
      startsAt: z.string(),
      endsAt: z.string(),
      reviewAt: z.string(),
    })
    .nullable(),
  applicationStatus: z.enum(BILLING_DISCOUNT_APPLICATION_STATUSES).nullable(),
  issuedCredit: z
    .object({
      amount: z.number().int(),
      currency: z.string(),
      issuedAt: z.string(),
    })
    .nullable(),
});
/** Organization billing summary response value. */
export type BillingSummaryOut = z.infer<typeof BillingSummaryOut>;

/** Body for `POST /checkout`; product, price, redirects, and trial are server policy. */
export const CheckoutBody = z
  .object({
    returnTo: z
      .string()
      .max(2_000)
      .refine((value) => value.startsWith('/') && !value.startsWith('//'))
      .optional()
      .describe('Same-origin product path to restore after Stripe confirms access.'),
  })
  .strict();
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
 * Deprecated account-retention status returned by `GET /lifecycle`.
 *
 * @remarks
 * Billing cancellation and payment failure never mutate these fields. The confirmed Danger Zone
 * account-deletion flow owns retention state. Billing keeps this read response for older clients
 * while customer access comes from {@link BillingSummaryOut.accessMode}.
 */
export const LifecycleOut = z
  .object({
    organizationId: z.string().describe('The organization this lifecycle status describes.'),
    lifecycleState: z
      .enum(['trialing', 'active', 'past_due', 'export_window', 'pending_deletion', 'deleted'])
      .describe(
        "The organization's legacy account-retention state. Billing does not change this value. Older `export_window` and `pending_deletion` values remain visible for compatibility while access comes from the billing summary.",
      ),
    exportReadyAt: z
      .string()
      .nullable()
      .describe(
        'ISO-8601 instant a downloadable export became available through the independent export flow, or `null` when no export is ready.',
      ),
    deleteAfterAt: z
      .string()
      .nullable()
      .describe(
        'Legacy account-deletion deadline retained for older clients. Billing never sets this value.',
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
        "API path for the generated work-layer JSON archive. Requires the caller's session and the org `manage` capability; it is not a direct object-store link.",
      ),
    expiresAt: z
      .string()
      .describe(
        'ISO-8601 instant the download stops working (14 days after generation), enforced on every read.',
      ),
  })
  .meta({ id: 'ExportOut', description: "A generated work-layer export's download path." });
/** Work-layer export response value. */
export type ExportOut = z.infer<typeof ExportOut>;

/** The authenticated route the generated export is served from. */
function exportDownloadPath(orgId: string): string {
  return `/v1/orgs/${orgId}/billing/export/file`;
}

/** Days a generated export download is valid for. */
const EXPORT_TTL_DAYS = 14;

/** Milliseconds in {@link EXPORT_TTL_DAYS}. */
const EXPORT_TTL_MS = EXPORT_TTL_DAYS * 24 * 60 * 60 * 1000;

/** Resolve the configured default price lookup key / price id for new subscriptions. */
function defaultPriceKey(): string {
  return (
    env.STRIPE_PRICE_DOCKET_PRO ??
    env.DOCKET_PRICE_LOOKUP_DOCKET_PRO ??
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- One-release compatibility for the former Docket Team configuration.
    env.STRIPE_PRICE_TEAM ??
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- One-release compatibility for the former Docket Team configuration.
    env.DOCKET_PRICE_LOOKUP_TEAM ??
    'docket_pro_monthly'
  );
}

/** Read the rollout flag safely when test-only validation skipping leaves raw env strings. */
function checkoutRolloutEnabled(value: unknown): boolean {
  return value === true || value === 'true';
}

/** Build an absolute app URL for the given path (checkout success/cancel defaults). */
function appUrl(path: string): string {
  return `${env.WEB_URL}${path}`;
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
      summary: 'Get organization products',
      response: BillingSummaryOut,
      description:
        'Returns the organization products recorded by Docket and whether this member may manage billing. An empty products array means the organization has baseline Docket only.',
    }),
    async (c) => {
      const actorCtx = c.get('actorCtx');
      const org = await loadOrg(actorCtx.orgId);
      const [products, applications, awards, credits] = await Promise.all([
        db
          .select()
          .from(organizationProductEntitlement)
          .where(eq(organizationProductEntitlement.organizationId, actorCtx.orgId)),
        db
          .select({ status: billingDiscountApplication.status })
          .from(billingDiscountApplication)
          .where(eq(billingDiscountApplication.organizationId, actorCtx.orgId))
          .orderBy(desc(billingDiscountApplication.createdAt))
          .limit(1),
        db
          .select()
          .from(billingDiscountAward)
          .where(eq(billingDiscountAward.organizationId, actorCtx.orgId))
          .orderBy(desc(billingDiscountAward.createdAt))
          .limit(1),
        db
          .select()
          .from(billingCredit)
          .where(
            and(
              eq(billingCredit.organizationId, actorCtx.orgId),
              eq(billingCredit.status, 'issued'),
            ),
          )
          .orderBy(desc(billingCredit.createdAt))
          .limit(1),
      ]);
      const now = Date.now();
      const pro = products.find((product) => product.productKey === 'docket_pro');
      const hasWritablePro =
        (pro?.source === 'complimentary' && pro.status === 'active') ||
        pro?.status === 'trialing' ||
        pro?.status === 'active' ||
        (pro?.status === 'past_due' && pro.graceEndsAt !== null && pro.graceEndsAt.getTime() > now);
      return ok(c, BillingSummaryOut, {
        organizationId: actorCtx.orgId,
        checkoutEnabled: checkoutRolloutEnabled(env.BILLING_ENABLED),
        listPrice: { amount: 800, currency: 'usd', interval: 'month' },
        accessMode: org.isPersonal || hasWritablePro ? 'writable' : 'read_only',
        canManageBilling: actorCtx.capabilities.includes('manage'),
        effectiveDiscount:
          awards[0] &&
          ['active', 'ending'].includes(awards[0].status) &&
          awards[0].endsAt.getTime() > now
            ? {
                percentOff: awards[0].percentOff,
                status: awards[0].status,
                startsAt: awards[0].startsAt.toISOString(),
                endsAt: awards[0].endsAt.toISOString(),
                reviewAt: awards[0].reviewAt.toISOString(),
              }
            : null,
        applicationStatus: applications[0]?.status ?? null,
        issuedCredit: credits[0]?.issuedAt
          ? {
              amount: credits[0].totalAmount,
              currency: credits[0].currency,
              issuedAt: credits[0].issuedAt.toISOString(),
            }
          : null,
        products: products.map((product) => ({
          productKey: BillingProductOut.shape.productKey.parse(product.productKey),
          name: 'Docket Pro' as const,
          status: product.status,
          source: product.source,
          trialEndsAt: product.trialEndsAt?.toISOString() ?? null,
          renewalDate: product.currentPeriodEnd?.toISOString() ?? null,
          cancelAtPeriodEnd: product.cancelAtPeriodEnd,
          cancellationDate: product.cancelAtPeriodEnd
            ? (product.currentPeriodEnd?.toISOString() ?? null)
            : null,
          graceEndsAt: product.graceEndsAt?.toISOString() ?? null,
          providerObservedAt: product.providerObservedAt?.toISOString() ?? null,
        })),
      });
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
      description: `Open a hosted Stripe checkout session for Docket Pro and return {@link RedirectOut} \`{ url }\`. The server selects the Docket Pro price, the app's \`/billing/return\` URLs, whether this organization receives its first 14-day trial, and the signed-in Better Auth account email used to pre-fill Checkout.

Side effect: creates a checkout session. Docket Pro ownership changes only after a signed Stripe webhook records the subscription state; returning from checkout does not grant access. Requires \`manage\` because adding a paid product is an organization billing action. Related: \`POST /portal\` (manage Docket Pro), \`GET /\` (owned products), \`GET /lifecycle\` (data lifecycle).`,
    }),
    zJson(CheckoutBody),
    async (c) => {
      if (!env.BILLING_ENABLED) {
        throw new BillingUnavailableError('Docket Pro checkout is not open yet');
      }
      const { orgId } = c.get('actorCtx');
      const input = c.req.valid('json');
      await loadOrg(orgId);
      const existing = await db
        .select({
          productKey: organizationProductEntitlement.productKey,
          status: organizationProductEntitlement.status,
        })
        .from(organizationProductEntitlement)
        .where(eq(organizationProductEntitlement.organizationId, orgId))
        .limit(1);
      const entitlement = existing[0];
      if (
        entitlement &&
        (entitlement.status === 'trialing' ||
          entitlement.status === 'active' ||
          entitlement.status === 'past_due')
      ) {
        throw new SubscriptionExistsError();
      }

      const now = new Date();
      const gateway = getContainer().billing;
      const lease = await acquireCheckoutAttempt(
        db,
        orgId,
        'docket_pro',
        now,
        new Date(now.getTime() + 24 * 60 * 60 * 1000),
      );
      if (lease.kind === 'reusable') return ok(c, RedirectOut, { url: lease.url });
      if (lease.kind === 'pending') throw new CheckoutPendingError();
      let account;
      let award: { providerCouponId: string | null } | undefined;
      try {
        const providerSubscriptions = await gateway.listSubscriptions(orgId);
        if (providerSubscriptions.some((subscription) => subscription.status !== 'canceled')) {
          throw new SubscriptionExistsError();
        }
        try {
          account = await ensureBillingCustomer(db, gateway, orgId, c.get('session')?.user.email);
        } catch {
          throw new BillingCustomerMissingError();
        }
        [award] = await db
          .select({ providerCouponId: billingDiscountAward.providerCouponId })
          .from(billingDiscountAward)
          .where(
            and(
              eq(billingDiscountAward.organizationId, orgId),
              inArray(billingDiscountAward.status, ['scheduled', 'active']),
              gt(billingDiscountAward.endsAt, now),
            ),
          )
          .limit(1);
      } catch (error) {
        await failCheckoutAttempt(db, lease.id, now);
        throw error;
      }
      const returnTo = input.returnTo ?? `/orgs/${orgId}/settings/billing`;
      const returnQuery = encodeURIComponent(returnTo);
      // Keep this lease reserved when Stripe times out. The result is unknown, so a new
      // idempotency key could create a second subscription before the first reply arrives.
      const result = await gateway.createCheckoutSession({
        referenceId: orgId,
        customerId: account.stripeCustomerId,
        priceKey: defaultPriceKey(),
        successUrl: appUrl(`/billing/return?org=${orgId}&status=success&returnTo=${returnQuery}`),
        cancelUrl: appUrl(`/billing/return?org=${orgId}&status=cancel&returnTo=${returnQuery}`),
        trialDays: existing.length === 0 && account.trialConsumedAt === null ? 14 : 0,
        ...(award?.providerCouponId ? { couponId: award.providerCouponId } : {}),
        idempotencyKey: `docket:checkout:${lease.id}`,
      });
      await completeCheckoutAttempt(db, lease.id, result.sessionId, result.url, now);
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
      description: `Open the provider's hosted billing portal and return {@link RedirectOut} \`{ url }\` — the Stripe customer-portal URL where an admin manages Docket Pro (update the payment method, cancel Docket Pro, or view invoices). Goes through the BillingGateway port with the durable Stripe customer id. Any change the admin makes in the portal flows back through signed provider webhooks, which update Docket Pro access without changing account-retention fields. This route only mints the portal link. Requires \`manage\`. Related: \`POST /checkout\` (add Docket Pro) and \`GET /\` (current state).`,
    }),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const [complimentary] = await db
        .select({ source: organizationProductEntitlement.source })
        .from(organizationProductEntitlement)
        .where(
          and(
            eq(organizationProductEntitlement.organizationId, orgId),
            eq(organizationProductEntitlement.productKey, 'docket_pro'),
            eq(organizationProductEntitlement.status, 'active'),
            eq(organizationProductEntitlement.source, 'complimentary'),
          ),
        )
        .limit(1);
      if (complimentary) {
        throw new SubscriptionExistsError(
          'Complimentary Docket Pro does not use Stripe billing management',
        );
      }
      const account = await getBillingCustomer(db, orgId);
      if (!account) throw new BillingCustomerMissingError();
      const result = await getContainer().billing.createBillingPortalSession({
        customerId: account.stripeCustomerId,
        returnUrl: appUrl(`/orgs/${orgId}/settings/billing`),
      });
      return ok(c, RedirectOut, { url: result.url });
    },
  )
  .get(
    '/lifecycle',
    apiDoc({
      tag: 'Billing',
      summary: 'Get the org lifecycle status',
      response: LifecycleOut,
      description: `Return the org's deprecated account-retention fields as {@link LifecycleOut}. Billing cancellation and payment failure never write these fields. The confirmed Danger Zone account-deletion flow owns retention state. Current customer access, cancellation, and grace state come from \`GET /\`. This read remains for older clients while they migrate to the billing summary. A missing or purged organization returns 404. Related: \`GET /\` and \`POST /export\`.`,
    }),
    async (c) => {
      const { orgId } = c.get('actorCtx');
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
      description: `Generate a downloadable snapshot of the org's entire work layer and return {@link ExportOut} \`{ downloadUrl, expiresAt }\`. The handler scans the org's work-layer tables (\`collectWorkLayer\`), serializes them to a single JSON document, and writes it through the BlobStore **port** (in-memory/local or real object storage) under \`exports/<orgId>/<ulid>.json\`. \`downloadUrl\` is the API path \`GET /v1/orgs/:orgId/billing/export/file\` — a session and the \`manage\` capability are required to read it, and the 14-day \`expiresAt\` is enforced there on every read rather than advertised. Generating a new export deletes the object the previous one wrote.

Side effect: stamps \`exportReadyAt\` so the API can enforce the 14-day download lifetime. Export remains available to administrators in every non-deleted billing state and does not schedule deletion. A missing or purged organization returns 404. Requires \`manage\`. Related: \`GET /lifecycle\`.`,
    }),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      // Prove the org exists (and is the actor's own, since orgId comes from actorCtx)
      // before doing the work-layer scan + blob write.
      const org = await loadOrg(orgId);

      const now = new Date();
      const document = {
        organizationId: orgId,
        generatedAt: now.toISOString(),
        tables: await collectWorkLayer(orgId),
      };
      const bytes = new TextEncoder().encode(JSON.stringify(document));
      // A ULID rather than a timestamp: the object store keeps objects publicly readable, so a key
      // derived from the org id and the clock is one an outsider can reconstruct. This one carries
      // 80 bits nobody outside this transaction ever sees.
      const key = `exports/${orgId}/${genId()}.json`;
      await getContainer().blob.put(key, bytes, 'application/json');

      // The download route uses this timestamp to enforce the 14-day export lifetime.
      await db
        .update(organization)
        .set({ exportReadyAt: now, exportBlobKey: key })
        .where(eq(organization.id, orgId));

      // Drop the superseded object. Best-effort: an orphaned blob is a cost and retention problem,
      // never a reason to fail an export the caller is entitled to.
      if (org.exportBlobKey && org.exportBlobKey !== key) {
        await getContainer()
          .blob.delete(org.exportBlobKey)
          .catch(() => undefined);
      }

      const expiresAt = new Date(now.getTime() + EXPORT_TTL_MS).toISOString();
      return ok(c, ExportOut, { downloadUrl: exportDownloadPath(orgId), expiresAt });
    },
  )
  .route('/discounts', billingDiscounts);

/**
 * Stream the generated work-layer export.
 *
 * @remarks
 * Mounted separately from the typed RPC router because it returns raw bytes rather than a JSON
 * envelope — the same convention `meAccountExportDownload` follows for the personal archive.
 *
 * This route is the boundary. `POST /export` used to answer with the object store's own URL, which
 * needed no session, honoured no expiry, and stayed live after the org was deleted; `expiresAt` was
 * a number the handler computed and nothing enforced. Access is now the org's `manage` capability
 * plus a TTL check on every read, and the key never leaves the server.
 */
export const billingExportDownload: Hono<AppEnv> = new Hono<AppEnv>().get(
  '/file',
  capabilityGuard('manage'),
  describeRoute({
    tags: ['Billing'],
    summary: 'Download the generated work-layer export',
    description: `Stream the most recent work-layer export as \`application/json\` bytes. Requires the \`manage\` capability on the org, and the export must have been generated within the last ${EXPORT_TTL_DAYS} days — the \`expiresAt\` returned by \`POST /export\` is enforced here rather than merely advertised. Returns **404** when no export has been generated, when it has expired, or when the underlying object has already been swept.`,
  }),
  async (c) => {
    const { orgId } = c.get('actorCtx');
    const org = await loadOrg(orgId);
    if (!org.exportBlobKey || !org.exportReadyAt) throw new NotFoundError('Export not found.');
    if (Date.now() - org.exportReadyAt.getTime() > EXPORT_TTL_MS) {
      throw new NotFoundError('Export has expired.');
    }
    const bytes = await getContainer().blob.get(org.exportBlobKey);
    if (!bytes) throw new NotFoundError('Export file is no longer available.');
    // Copy into a fresh `ArrayBuffer`-backed view so the body is a valid `BodyInit` — same reason
    // `meAccountExportDownload` does it.
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="docket-export-${orgId}.json"`,
      },
    });
  },
);

export default billing;
