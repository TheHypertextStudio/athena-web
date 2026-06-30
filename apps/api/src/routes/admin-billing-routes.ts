import { db, lifecycleHold, organization } from '@docket/db';
import { and, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';

import {
  AdminHoldOut,
  AdminOrgOut,
  ExtendTrialBody,
  PlaceHoldBody,
  SetLifecycleBody,
} from '../admin-dto';
import type { AppEnv } from '../context';
import { onReactivated, onTrialOrPaymentTerminal } from '../billing/lifecycle';
import { NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam } from '../lib/validate';
import { requireStaffRole } from '../permissions/staff-guard';

import { audit, holdParam, idParam, loadOrg, toHoldOut, toOrgOut } from './admin-serializers';

/**
 * Sub-router for lifecycle-hold and billing-action routes (mounted at `/orgs`).
 * All routes require staff auth (enforced by the parent admin router's middleware).
 */
export const adminBillingRoutes = new Hono<AppEnv>()
  .post(
    '/:id/holds',
    apiDoc({ tag: 'Admin', summary: 'Place a lifecycle hold on an org', response: AdminHoldOut }),
    zParam(idParam),
    zJson(PlaceHoldBody),
    async (c) => {
      const { id } = c.req.valid('param');
      const { reason } = c.req.valid('json');
      const { staffUserId } = c.get('staffCtx');
      await loadOrg(id);
      const inserted = await db
        .insert(lifecycleHold)
        .values({ organizationId: id, reason, placedBy: staffUserId })
        .returning();
      const hold = inserted[0];
      /* v8 ignore next -- @preserve defensive: insert always returns the inserted row */
      if (!hold) throw new NotFoundError('Hold insert returned no row');
      await audit(db, staffUserId, 'lifecycle_hold.placed', 'organization', id, {
        holdId: hold.id,
        reason,
      });
      return ok(c, AdminHoldOut, toHoldOut(hold));
    },
  )
  .delete(
    '/:id/holds/:holdId',
    apiDoc({ tag: 'Admin', summary: 'Release a lifecycle hold', response: AdminHoldOut }),
    zParam(holdParam),
    async (c) => {
      const { id, holdId } = c.req.valid('param');
      const { staffUserId } = c.get('staffCtx');
      const released = await db
        .update(lifecycleHold)
        .set({ releasedAt: new Date() })
        .where(
          and(
            eq(lifecycleHold.id, holdId),
            eq(lifecycleHold.organizationId, id),
            isNull(lifecycleHold.releasedAt),
          ),
        )
        .returning();
      const hold = released[0];
      if (!hold) throw new NotFoundError('Active hold not found');
      await audit(db, staffUserId, 'lifecycle_hold.released', 'organization', id, { holdId });
      return ok(c, AdminHoldOut, toHoldOut(hold));
    },
  )
  .post(
    '/:id/extend-trial',
    requireStaffRole('finance'),
    apiDoc({ tag: 'Admin', summary: 'Extend an org trial', response: AdminOrgOut }),
    zParam(idParam),
    zJson(ExtendTrialBody),
    async (c) => {
      const { id } = c.req.valid('param');
      const { days } = c.req.valid('json');
      const { staffUserId } = c.get('staffCtx');
      const org = await loadOrg(id);
      const updated = await db
        .update(organization)
        .set({ lifecycleState: 'trialing', exportReadyAt: null, deleteAfterAt: null })
        .where(eq(organization.id, id))
        .returning();
      const next = updated[0];
      /* v8 ignore next -- @preserve defensive: the org was just loaded, so the update returns it */
      if (!next) throw new NotFoundError('Organization not found');
      await audit(db, staffUserId, 'billing.trial_extended', 'organization', id, {
        days,
        previousState: org.lifecycleState,
      });
      return ok(c, AdminOrgOut, toOrgOut(next));
    },
  )
  .post(
    '/:id/reactivate',
    requireStaffRole('finance'),
    apiDoc({ tag: 'Admin', summary: 'Reactivate an org', response: AdminOrgOut }),
    zParam(idParam),
    async (c) => {
      const { id } = c.req.valid('param');
      const { staffUserId } = c.get('staffCtx');
      const org = await loadOrg(id);
      await onReactivated(db, id);
      await audit(db, staffUserId, 'billing.reactivated', 'organization', id, {
        previousState: org.lifecycleState,
      });
      return ok(c, AdminOrgOut, toOrgOut(await loadOrg(id)));
    },
  )
  .post(
    '/:id/lifecycle',
    requireStaffRole('finance'),
    apiDoc({ tag: 'Admin', summary: 'Set an org lifecycle state', response: AdminOrgOut }),
    zParam(idParam),
    zJson(SetLifecycleBody),
    async (c) => {
      const { id } = c.req.valid('param');
      const { lifecycleState } = c.req.valid('json');
      const { staffUserId } = c.get('staffCtx');
      const org = await loadOrg(id);
      const now = new Date().toISOString();
      if (lifecycleState === 'active' || lifecycleState === 'trialing') {
        await onReactivated(db, id);
      } else if (lifecycleState === 'export_window') {
        await onTrialOrPaymentTerminal(db, id, now);
      } else {
        await db.update(organization).set({ lifecycleState }).where(eq(organization.id, id));
      }
      await audit(db, staffUserId, 'lifecycle.state_set', 'organization', id, {
        from: org.lifecycleState,
        to: lifecycleState,
      });
      return ok(c, AdminOrgOut, toOrgOut(await loadOrg(id)));
    },
  );
