/**
 * `@docket/api` — org-scoped billing + lifecycle router (mounted at `/v1/orgs/:orgId/billing`).
 *
 * @remarks
 * Subscription reads + checkout/portal opens go through the `@docket/boundaries`
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
import {
  comment,
  cycle,
  db,
  initiative,
  label,
  milestone,
  organization,
  program,
  project,
  savedView,
  task,
  team,
  update,
} from '@docket/db';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { onReactivated, onTrialOrPaymentTerminal } from '../billing/lifecycle';
import type { AppEnv } from '../context';
import { getContainer } from '../container';
import { env } from '../env';
import { NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { zJson } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';

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
    organizationId: z.string(),
    lifecycleState: z.enum([
      'trialing',
      'active',
      'past_due',
      'export_window',
      'pending_deletion',
      'deleted',
    ]),
    exportReadyAt: z.string().nullable(),
    deleteAfterAt: z.string().nullable(),
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
    downloadUrl: z.string(),
    expiresAt: z.string(),
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

/**
 * Collect every org-scoped work-layer table for an org into a single export document.
 *
 * @remarks
 * Each table is filtered by `organization_id = orgId` so the snapshot is strictly
 * tenant-scoped — no cross-org rows can leak into the archive. The shape is a flat
 * map of `tableName → rows[]`, suitable for re-import or offline inspection.
 *
 * @param orgId - The organization whose work layer to snapshot.
 * @returns the per-table row collections.
 */
async function collectWorkLayer(orgId: string): Promise<Record<string, unknown[]>> {
  const [
    teams,
    initiatives,
    programs,
    projects,
    milestones,
    cycles,
    tasks,
    labels,
    comments,
    updates,
    savedViews,
  ] = await Promise.all([
    db.select().from(team).where(eq(team.organizationId, orgId)),
    db.select().from(initiative).where(eq(initiative.organizationId, orgId)),
    db.select().from(program).where(eq(program.organizationId, orgId)),
    db.select().from(project).where(eq(project.organizationId, orgId)),
    db.select().from(milestone).where(eq(milestone.organizationId, orgId)),
    db.select().from(cycle).where(eq(cycle.organizationId, orgId)),
    db.select().from(task).where(eq(task.organizationId, orgId)),
    db.select().from(label).where(eq(label.organizationId, orgId)),
    db.select().from(comment).where(eq(comment.organizationId, orgId)),
    db.select().from(update).where(eq(update.organizationId, orgId)),
    db.select().from(savedView).where(eq(savedView.organizationId, orgId)),
  ]);
  return {
    team: teams,
    initiative: initiatives,
    program: programs,
    project: projects,
    milestone: milestones,
    cycle: cycles,
    task: tasks,
    label: labels,
    comment: comments,
    update: updates,
    savedView: savedViews,
  };
}

/** Org-scoped billing + lifecycle router: subscription, checkout/portal, export, lifecycle. */
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
  })
  .get('/lifecycle', async (c) => {
    const { orgId } = c.get('actorCtx');
    const org = await loadOrg(orgId);
    return ok(c, LifecycleOut, toLifecycleOut(org));
  })
  .post('/lifecycle/start-export-window', capabilityGuard('manage'), async (c) => {
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
  })
  .post('/lifecycle/reactivate', capabilityGuard('manage'), async (c) => {
    const { orgId } = c.get('actorCtx');
    await loadOrg(orgId);
    await onReactivated(db, orgId);
    const org = await loadOrg(orgId);
    return ok(c, LifecycleOut, toLifecycleOut(org));
  })
  .post('/export', capabilityGuard('manage'), async (c) => {
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
  });

export default billing;
