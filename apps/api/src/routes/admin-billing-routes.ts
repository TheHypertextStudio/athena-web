import { billingExemption, db, lifecycleHold, organization } from '@docket/db';
import { and, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';

import {
  AdminBillingExemptionOut,
  AdminHoldOut,
  AdminOrgOut,
  ExtendTrialBody,
  GrantExemptionBody,
  PlaceHoldBody,
  SetLifecycleBody,
} from '../admin-dto';
import type { AppEnv } from '../context';
import { onReactivated, onTrialOrPaymentTerminal } from '../billing/lifecycle';
import { ConflictError, NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam } from '../lib/validate';
import { requireStaffRole } from '../permissions/staff-guard';

import {
  audit,
  holdParam,
  idParam,
  loadActiveExemptOrgIds,
  loadOrg,
  toExemptionOut,
  toHoldOut,
  toOrgOut,
} from './admin-serializers';

/** The Postgres SQLSTATE for a unique-constraint (including unique-index) violation. */
const UNIQUE_VIOLATION_CODE = '23505';

/** The SQLSTATE code carried directly on an error, if any. */
function sqlStateOf(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null || !('code' in err)) return undefined;
  const { code } = err;
  return typeof code === 'string' ? code : undefined;
}

/**
 * Whether a thrown error is a Postgres unique-constraint violation (SQLSTATE 23505).
 *
 * @remarks
 * Drizzle wraps the driver error in a `DrizzleQueryError`, whose own `code` is
 * `undefined` — the SQLSTATE lives on `err.cause.code` instead. Check both so this
 * is robust regardless of driver (postgres-js vs. PGlite) or wrapping.
 */
function isUniqueViolation(err: unknown): boolean {
  if (sqlStateOf(err) === UNIQUE_VIOLATION_CODE) return true;
  const cause =
    typeof err === 'object' && err !== null ? (err as { cause?: unknown }).cause : undefined;
  return sqlStateOf(cause) === UNIQUE_VIOLATION_CODE;
}

/**
 * Sub-router for lifecycle-hold and billing-action routes (mounted at `/orgs`).
 * All routes require staff auth (enforced by the parent admin router's middleware).
 */
export const adminBillingRoutes = new Hono<AppEnv>()
  .post(
    '/:id/holds',
    apiDoc({
      tag: 'Admin',
      summary: 'Place a lifecycle hold on an org',
      response: AdminHoldOut,
      description: `Places a named lifecycle hold on an organization — an operator's "do not delete" brake on the data-retention pipeline.

**Behavior.** Verifies the org exists (else \`404 not_found\`), then inserts a \`lifecycle_hold\` row with the required free-text \`reason\` and \`placedBy = \` the acting operator. While any un-released hold exists, the org counts toward \`activeHolds\` in metrics and the deletion sweep is expected to skip it, so it cannot silently advance \`export_window → pending_deletion → deleted\` while under investigation, dispute, or legal hold. The returned record has a null \`releasedAt\` (active).

**Side effects.** Creates the hold **and** writes a \`lifecycle_hold.placed\` operator audit event (subject = the org) capturing the hold id and reason.

**Access.** Behind \`staffMiddleware\`. Any staff tier may place a hold (it's a protective, reversible brake, not a billing change) — no \`requireStaffRole\` gate. Non-operator → \`403\`; anonymous → \`401\`.

**Related.** \`DELETE /admin/orgs/{id}/holds/{holdId}\` to release; \`GET /admin/metrics\` reports \`activeHolds\`.`,
    }),
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
    apiDoc({
      tag: 'Admin',
      summary: 'Release a lifecycle hold',
      response: AdminHoldOut,
      description: `Releases a previously placed lifecycle hold, lifting the operator brake so the org can resume its normal retention pipeline.

**Behavior.** Conditionally updates the hold matched by \`holdId\` AND \`organizationId\` AND still un-released (\`releasedAt IS NULL\`), stamping \`releasedAt = now\`. Returns the released record. Returns \`404 not_found\` when no active hold matches those three conditions — including a hold already released (the guard makes release idempotent) or a hold/org-id mismatch. Once the last active hold is released the deletion sweep may again advance the org.

**Side effects.** Writes a \`lifecycle_hold.released\` operator audit event (subject = the org) referencing the hold id.

**Access.** Behind \`staffMiddleware\` (any staff tier). Non-operator → \`403\`; anonymous → \`401\`.

**Related.** \`POST /admin/orgs/{id}/holds\` to place a hold.`,
    }),
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
    '/:id/billing-exemption',
    requireStaffRole('superadmin'),
    apiDoc({
      tag: 'Admin',
      summary: 'Grant a billing exemption',
      response: AdminBillingExemptionOut,
      description: `Grants an organization a permanent, free, Stripe-independent bypass of the agent-session entitlement gate — the operator mechanism for comping internal or gifted accounts.

**Behavior.** Verifies the org exists (else \`404 not_found\`), then inserts a \`billing_exemption\` row with the required free-text \`reason\` and \`grantedBy = \` the acting operator. A partial unique index enforces at most one active (\`revokedAt IS NULL\`) grant per org; attempting a second concurrent grant returns \`409 conflict\`. Once granted, \`assertAgentSessionsEntitled\` treats the org as entitled regardless of \`lifecycleState\`, indefinitely, until revoked.

**Side effects.** Creates the exemption **and** writes a \`billing.exemption_granted\` operator audit event (subject = the org) capturing the exemption id and reason.

**Access — superadmin only.** Gated by \`requireStaffRole('superadmin')\`: unlike the time-boxed \`finance\` actions (extend-trial, reactivate), this is an indefinite, full bypass of the revenue gate — the highest-blast-radius billing action, restricted to the top tier. \`support\`/\`finance\` → \`403 forbidden\`; non-operators \`403\`; anonymous \`401\`.

**Related.** \`DELETE /admin/orgs/{id}/billing-exemption\` to revoke; \`GET /admin/orgs/{id}\` reports \`isBillingExempt\`.`,
    }),
    zParam(idParam),
    zJson(GrantExemptionBody),
    async (c) => {
      const { id } = c.req.valid('param');
      const { reason } = c.req.valid('json');
      const { staffUserId } = c.get('staffCtx');
      await loadOrg(id);
      let inserted;
      try {
        inserted = await db
          .insert(billingExemption)
          .values({ organizationId: id, reason, grantedBy: staffUserId })
          .returning();
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new ConflictError(
            'An active billing exemption already exists for this organization',
          );
        }
        throw err;
      }
      const exemption = inserted[0];
      /* v8 ignore next -- @preserve defensive: insert always returns the inserted row */
      if (!exemption) throw new NotFoundError('Exemption insert returned no row');
      await audit(db, staffUserId, 'billing.exemption_granted', 'organization', id, {
        exemptionId: exemption.id,
        reason,
      });
      return ok(c, AdminBillingExemptionOut, toExemptionOut(exemption));
    },
  )
  .delete(
    '/:id/billing-exemption',
    requireStaffRole('superadmin'),
    apiDoc({
      tag: 'Admin',
      summary: 'Revoke a billing exemption',
      response: AdminBillingExemptionOut,
      description: `Revokes an organization's active billing exemption, reverting it to the normal Stripe-driven entitlement gate.

**Behavior.** Atomically updates the exemption row matched by \`organizationId\` AND still active (\`revokedAt IS NULL\`), stamping \`revokedAt = now\` and \`revokedBy = \` the acting operator, in one conditional \`UPDATE\`. Returns \`404 not_found\` when no active exemption matches — including an org with no exemption at all, or one already revoked (the guard makes revoke idempotent-safe: a second call 404s rather than double-firing). Returns the now-revoked record.

**Side effects.** Writes a \`billing.exemption_revoked\` operator audit event (subject = the org) referencing the exemption id.

**Access — superadmin only.** Same tier as granting. \`support\`/\`finance\` → \`403 forbidden\`; non-operators \`403\`; anonymous \`401\`.

**Related.** \`POST /admin/orgs/{id}/billing-exemption\` to grant.`,
    }),
    zParam(idParam),
    async (c) => {
      const { id } = c.req.valid('param');
      const { staffUserId } = c.get('staffCtx');
      const revoked = await db
        .update(billingExemption)
        .set({ revokedAt: new Date(), revokedBy: staffUserId })
        .where(and(eq(billingExemption.organizationId, id), isNull(billingExemption.revokedAt)))
        .returning();
      const exemption = revoked[0];
      if (!exemption) throw new NotFoundError('Active billing exemption not found');
      await audit(db, staffUserId, 'billing.exemption_revoked', 'organization', id, {
        exemptionId: exemption.id,
      });
      return ok(c, AdminBillingExemptionOut, toExemptionOut(exemption));
    },
  )
  .post(
    '/:id/extend-trial',
    requireStaffRole('finance'),
    apiDoc({
      tag: 'Admin',
      summary: 'Extend an org trial',
      response: AdminOrgOut,
      description: `Returns an organization to a clean \`trialing\` state — the operator goodwill/sales lever for extending a trial.

**Behavior.** Loads the org (else \`404 not_found\`), then sets \`lifecycleState = 'trialing'\` and clears both \`exportReadyAt\` and \`deleteAfterAt\`, which cancels any pending export window or scheduled deletion and removes the org from the delete sweep's path. The \`days\` body value (1..365) is recorded in the audit metadata as the operator's intent; the state reset itself is what re-opens the trial. Returns the updated org.

**Access — finance+.** Gated by \`requireStaffRole('finance')\` on top of \`staffMiddleware\`: extending a trial is a revenue-affecting billing concession, so it is restricted to \`finance\` (and \`superadmin\`, which outranks it). \`support\` operators get \`403 forbidden\`; non-operators \`403\`; anonymous \`401\`.

**Side effects.** Writes a \`billing.trial_extended\` operator audit event (subject = the org) capturing the requested \`days\` and the previous lifecycle state.

**Related.** \`POST /admin/orgs/{id}/reactivate\` (recover a lapsed paid org); \`POST /admin/orgs/{id}/lifecycle\` (force any state directly).`,
    }),
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
      const exemptIds = await loadActiveExemptOrgIds(db, [id]);
      return ok(c, AdminOrgOut, toOrgOut(next, exemptIds));
    },
  )
  .post(
    '/:id/reactivate',
    requireStaffRole('finance'),
    apiDoc({
      tag: 'Admin',
      summary: 'Reactivate an org',
      response: AdminOrgOut,
      description: `Rescues an organization out of the export window back to \`active\` — the operator equivalent of a recovered subscription.

**Behavior.** Loads the org (else \`404 not_found\`), then runs the shared \`onReactivated\` lifecycle transition: sets \`lifecycleState = 'active'\` and clears \`exportReadyAt\`/\`deleteAfterAt\`. The transition only applies to orgs not already \`deleted\` (a deleted org cannot be revived by reactivation) and is idempotent for an org already \`active\`. Returns the freshly re-loaded org so the response reflects the committed state.

**Access — finance+.** Gated by \`requireStaffRole('finance')\`: this manually undoes a payment-driven downgrade, a billing-sensitive action restricted to \`finance\` (and \`superadmin\`). \`support\` → \`403 forbidden\`; non-operators \`403\`; anonymous \`401\`.

**Side effects.** Writes a \`billing.reactivated\` operator audit event (subject = the org) recording the previous lifecycle state.

**Related.** \`POST /admin/orgs/{id}/extend-trial\` (return to trial instead); \`POST /admin/orgs/{id}/lifecycle\` (set any state).`,
    }),
    zParam(idParam),
    async (c) => {
      const { id } = c.req.valid('param');
      const { staffUserId } = c.get('staffCtx');
      const org = await loadOrg(id);
      await onReactivated(db, id);
      await audit(db, staffUserId, 'billing.reactivated', 'organization', id, {
        previousState: org.lifecycleState,
      });
      const exemptIds = await loadActiveExemptOrgIds(db, [id]);
      return ok(c, AdminOrgOut, toOrgOut(await loadOrg(id), exemptIds));
    },
  )
  .post(
    '/:id/lifecycle',
    requireStaffRole('finance'),
    apiDoc({
      tag: 'Admin',
      summary: 'Set an org lifecycle state',
      response: AdminOrgOut,
      description: `Forces an organization into an explicit data-lifecycle state — the operator's manual override over the billing-driven state machine, used to correct drift or stage a state for testing/support.

**Behavior.** Loads the org (else \`404 not_found\`), then routes the requested \`lifecycleState\` through the real transition logic rather than a blind column write, so invariants stay consistent: \`active\`/\`trialing\` run \`onReactivated\` (clearing the export/delete timestamps); \`export_window\` runs \`onTrialOrPaymentTerminal\` (stamping \`exportReadyAt = now\` and scheduling \`deleteAfterAt = now + 14 days\`); any other target (\`past_due\`, \`pending_deletion\`, \`deleted\`) is written directly. Returns the re-loaded org reflecting the committed state and timestamps.

**Access — finance+.** Gated by \`requireStaffRole('finance')\`: directly setting lifecycle state can trigger or cancel data deletion and override billing outcomes, so it is restricted to \`finance\` (and \`superadmin\`). \`support\` → \`403 forbidden\`; non-operators \`403\`; anonymous \`401\`.

**Side effects.** May schedule or cancel the export window / deletion timers (per above) **and** writes a \`lifecycle.state_set\` operator audit event (subject = the org) recording the \`from\` and \`to\` states.

**Related.** \`POST /admin/orgs/{id}/extend-trial\` and \`/reactivate\` are the safer, intent-specific shortcuts; \`GET /admin/lifecycle\` shows the resulting board.`,
    }),
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
      const exemptIds = await loadActiveExemptOrgIds(db, [id]);
      return ok(c, AdminOrgOut, toOrgOut(await loadOrg(id), exemptIds));
    },
  );
