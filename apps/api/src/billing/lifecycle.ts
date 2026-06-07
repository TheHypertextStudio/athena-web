/**
 * `@docket/api` — the organization data-lifecycle state machine.
 *
 * @remarks
 * Implements the real billing-driven org lifecycle (docs/engineering billing): a
 * trial or payment terminal moves an org into an **export window** (a 14-day grace
 * period during which its data stays readable/exportable), after which an idempotent
 * cron sweep advances it `export_window → pending_deletion → deleted`. Reactivation
 * (a recovered/active subscription) rescues an org out of the window back to
 * `active`. Synthetic/real billing webhook events ({@link BillingEvent}) are folded
 * into these transitions by {@link applyBillingEvent}.
 *
 * Every function takes the {@link Database} explicitly (so tests can pass an embedded
 * PGlite client) and an injectable `now` ISO-8601 string — the module never reads the
 * wall clock at import time. All transitions are **idempotent**: re-running with the
 * same `now` is a no-op, which is what makes the cron sweep safe to retry.
 */
import type { BillingEvent } from '@docket/boundaries';
import type { Database } from '@docket/db';
import { organization } from '@docket/db';
import { and, eq, inArray, isNotNull, lte, notInArray } from 'drizzle-orm';

/** The organization data-lifecycle state union, derived from the schema column. */
export type OrgLifecycleState = (typeof organization.$inferSelect)['lifecycleState'];

/** Number of days an org's data stays in the export window before deletion advances. */
export const EXPORT_WINDOW_DAYS = 14;

/** Milliseconds in {@link EXPORT_WINDOW_DAYS}. */
const EXPORT_WINDOW_MS = EXPORT_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/**
 * The outcome of a {@link sweepLifecycle} run — how many orgs advanced at each edge.
 *
 * @remarks
 * Both counts are zero on an idempotent re-run with the same `now`.
 */
export interface SweepResult {
  /** Orgs moved `export_window → pending_deletion` because their grace period elapsed. */
  readonly toPendingDeletion: number;
  /** Orgs moved `pending_deletion → deleted` because their grace period elapsed. */
  readonly toDeleted: number;
}

/**
 * Enter the export window: the org's trial ended or its payment terminally lapsed.
 *
 * @remarks
 * Sets `lifecycleState='export_window'`, stamps `exportReadyAt=now`, and schedules
 * `deleteAfterAt = now + {@link EXPORT_WINDOW_DAYS} days`. Idempotent for an org
 * already in `export_window` (the timestamps are simply re-stamped to the same
 * window); does not touch orgs already `pending_deletion`/`deleted`.
 *
 * @param db - The Drizzle database client.
 * @param orgId - The organization to move into the export window.
 * @param now - The ISO-8601 instant to anchor the window to.
 * @returns the number of organization rows updated (0 or 1).
 */
export async function onTrialOrPaymentTerminal(
  db: Database,
  orgId: string,
  now: string,
): Promise<number> {
  const nowDate = new Date(now);
  const deleteAfter = new Date(nowDate.getTime() + EXPORT_WINDOW_MS);
  const rows = await db
    .update(organization)
    .set({ lifecycleState: 'export_window', exportReadyAt: nowDate, deleteAfterAt: deleteAfter })
    .where(
      and(
        eq(organization.id, orgId),
        inArray(organization.lifecycleState, ['trialing', 'active', 'past_due', 'export_window']),
      ),
    )
    .returning({ id: organization.id });
  return rows.length;
}

/**
 * Rescue an org out of the export window: its subscription is healthy again.
 *
 * @remarks
 * Sets `lifecycleState='active'` and clears both `exportReadyAt` and `deleteAfterAt`.
 * Only applies to orgs not already `deleted` (a deleted org cannot be reactivated by
 * a billing event). Idempotent for an org already `active`.
 *
 * @param db - The Drizzle database client.
 * @param orgId - The organization to reactivate.
 * @returns the number of organization rows updated (0 or 1).
 */
export async function onReactivated(db: Database, orgId: string): Promise<number> {
  const rows = await db
    .update(organization)
    .set({ lifecycleState: 'active', exportReadyAt: null, deleteAfterAt: null })
    .where(
      and(
        eq(organization.id, orgId),
        inArray(organization.lifecycleState, ['trialing', 'active', 'past_due', 'export_window']),
      ),
    )
    .returning({ id: organization.id });
  return rows.length;
}

/**
 * Mark an org `past_due` without yet entering the export window.
 *
 * @remarks
 * A `past_due` payment is a soft warning state — Docket keeps the org usable until a
 * cancellation (the terminal event) moves it into the export window. Only advances
 * orgs currently `trialing`/`active`/`past_due`.
 *
 * @param db - The Drizzle database client.
 * @param orgId - The organization to mark past due.
 * @returns the number of organization rows updated (0 or 1).
 */
export async function onPastDue(db: Database, orgId: string): Promise<number> {
  const rows = await db
    .update(organization)
    .set({ lifecycleState: 'past_due' })
    .where(
      and(
        eq(organization.id, orgId),
        inArray(organization.lifecycleState, ['trialing', 'active', 'past_due']),
      ),
    )
    .returning({ id: organization.id });
  return rows.length;
}

/**
 * Idempotently advance every org whose export grace period has elapsed.
 *
 * @remarks
 * Two edges: orgs in `export_window` with `deleteAfterAt <= now` move to
 * `pending_deletion`; orgs that were *already* `pending_deletion` (before this sweep)
 * with `deleteAfterAt <= now` move to `deleted` (and have `exportReadyAt` nulled — the
 * export artifact is no longer offered). Orgs promoted to `pending_deletion` by *this*
 * sweep are explicitly excluded from the delete edge, so `pending_deletion` is a real,
 * observable dwell state for at least one sweep cycle rather than a transient one. The
 * sweep is idempotent: re-running with the same `now` deletes those now-pending orgs
 * and advances nothing else, so the cron handler can safely retry. The actual data
 * purge for a deleted org is a separate downstream concern (documented policy: the
 * state flip authorizes it); for this build "delete" is the state transition + clearing
 * the export pointer.
 *
 * @param db - The Drizzle database client.
 * @param now - The ISO-8601 instant the sweep evaluates `deleteAfterAt` against.
 * @returns the per-edge advance counts.
 */
export async function sweepLifecycle(db: Database, now: string): Promise<SweepResult> {
  const nowDate = new Date(now);

  const toPending = await db
    .update(organization)
    .set({ lifecycleState: 'pending_deletion' })
    .where(
      and(
        eq(organization.lifecycleState, 'export_window'),
        isNotNull(organization.deleteAfterAt),
        lte(organization.deleteAfterAt, nowDate),
      ),
    )
    .returning({ id: organization.id });
  const justPromoted = toPending.map((r) => r.id);

  // Delete only orgs that were already pending BEFORE this sweep — not the ones we just
  // promoted — so `pending_deletion` survives a full cycle and the sweep stays idempotent.
  const deleteWhere =
    justPromoted.length > 0
      ? and(
          eq(organization.lifecycleState, 'pending_deletion'),
          isNotNull(organization.deleteAfterAt),
          lte(organization.deleteAfterAt, nowDate),
          notInArray(organization.id, justPromoted),
        )
      : and(
          eq(organization.lifecycleState, 'pending_deletion'),
          isNotNull(organization.deleteAfterAt),
          lte(organization.deleteAfterAt, nowDate),
        );

  const toDeleted = await db
    .update(organization)
    .set({ lifecycleState: 'deleted', exportReadyAt: null })
    .where(deleteWhere)
    .returning({ id: organization.id });

  return { toPendingDeletion: toPending.length, toDeleted: toDeleted.length };
}

/** Map a {@link BillingEvent}'s subscription status onto the org lifecycle effect. */
type LifecycleEffect = 'active' | 'past_due' | 'export_window' | 'none';

/** Decide the lifecycle effect a billing event implies (pure; no I/O). */
function effectFor(event: BillingEvent): LifecycleEffect {
  // Prefer the subscription status when present (the normalized source of truth).
  const status = event.subscription?.status;
  if (status === 'trialing' || status === 'active') return 'active';
  if (status === 'past_due') return 'past_due';
  if (status === 'canceled') return 'export_window';

  // Fall back to the event type for events without a subscription snapshot.
  switch (event.type) {
    case 'checkout.completed':
    case 'subscription.created':
    case 'subscription.updated':
      return 'active';
    case 'subscription.trial_will_end':
      return 'none';
    case 'subscription.past_due':
      return 'past_due';
    case 'subscription.canceled':
      return 'export_window';
    /* v8 ignore next 2 -- @preserve exhaustive: every BillingEventType is handled above */
    default:
      return 'none';
  }
}

/**
 * Fold a normalized billing webhook event into the org's lifecycle state.
 *
 * @remarks
 * `trialing`/`active` (or a create/update event) reactivate the org; `past_due`
 * marks it past due; `canceled` (the terminal event) enters the export window via
 * {@link onTrialOrPaymentTerminal}. `subscription.trial_will_end` is informational
 * and changes no state. The event's `referenceId` is the organization id. Idempotent
 * by transition — replaying the same event yields the same terminal state.
 *
 * @param db - The Drizzle database client.
 * @param event - The normalized billing event (from the mock or real gateway).
 * @param now - The ISO-8601 instant to anchor any export window to.
 * @returns the resolved {@link OrgLifecycleState}-ish effect that was applied.
 */
export async function applyBillingEvent(
  db: Database,
  event: BillingEvent,
  now: string,
): Promise<LifecycleEffect> {
  const effect = effectFor(event);
  const orgId = event.referenceId;
  switch (effect) {
    case 'active':
      await onReactivated(db, orgId);
      return effect;
    case 'past_due':
      await onPastDue(db, orgId);
      return effect;
    case 'export_window':
      await onTrialOrPaymentTerminal(db, orgId, now);
      return effect;
    case 'none':
      return effect;
    /* v8 ignore start -- @preserve exhaustiveness guard: `effect` is `never`, unreachable */
    default: {
      // Exhaustiveness guard: `effect` is `never` here.
      const _exhaustive: never = effect;
      return _exhaustive;
    }
    /* v8 ignore stop */
  }
}
