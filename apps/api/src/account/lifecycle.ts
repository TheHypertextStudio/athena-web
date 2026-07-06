/**
 * `@docket/api` — the account (user) end-of-life state machine.
 *
 * @remarks
 * The account-level mirror of `apps/api/src/billing/lifecycle.ts`. Scheduling deletion moves
 * the user's `hub` into a recoverable `pending_deletion` grace window (`delete_after_at = now
 * + {@link ACCOUNT_GRACE_DAYS}`); signing back in and cancelling rescues it. After the window
 * elapses, an idempotent cron sweep hard-deletes the user via {@link purgeUser}, which also
 * tears down the rows a raw `DELETE user` would orphan (no-FK `user_id` columns and the orgs
 * the user solely occupies). Every function takes the {@link Database} + an injectable `now`
 * ISO string and is safe to re-run.
 */
import type { Database } from '@docket/db';
import {
  dailyDigest,
  contactPoint,
  event,
  eventRecipient,
  hub,
  idempotencyKey,
  notification,
  notificationPreference,
  notificationRecipient,
  organization,
  streamSubscription,
  user,
} from '@docket/db';
import { and, eq, inArray, isNotNull, lte } from 'drizzle-orm';

import { analyzeAccountOwnership, findSoleOccupiedOrgIds } from './blockers';

/**
 * The tables keyed by a plain-text `user_id` with NO foreign key to `user`, so they never
 * cascade on a user delete and must be purged explicitly.
 *
 * @remarks
 * Kept as one exported list so {@link purgeUser} and the schema-drift test stay in lockstep —
 * adding another such table is a single edit here, and the test fails if the schema gains a
 * no-FK `user_id` table this list forgets.
 */
export const USER_KEYED_NO_FK_TABLES = [
  contactPoint,
  notification,
  notificationPreference,
  notificationRecipient,
  event,
  eventRecipient,
  streamSubscription,
  dailyDigest,
  idempotencyKey,
] as const;

/** Days a scheduled-deletion account stays recoverable before the purge runs. */
export const ACCOUNT_GRACE_DAYS = 14;

/** Milliseconds in {@link ACCOUNT_GRACE_DAYS}. */
const ACCOUNT_GRACE_MS = ACCOUNT_GRACE_DAYS * 24 * 60 * 60 * 1000;

/** The outcome of a {@link sweepAccountDeletions} run. */
export interface AccountDeletionSweepResult {
  /** Accounts hard-deleted because their grace window elapsed and no blocker remained. */
  readonly purged: number;
  /** Accounts left pending because a sole-owner-of-shared-org conflict appeared since scheduling. */
  readonly skipped: number;
}

/**
 * Schedule a user's account for deletion: enter the recoverable grace window.
 *
 * @remarks
 * Sets `hub.deletion_state='pending_deletion'`, stamps `deletion_requested_at=now`, and
 * schedules `delete_after_at = now + {@link ACCOUNT_GRACE_DAYS} days`. Idempotent for an
 * account already pending (the window is re-stamped to the new `now`).
 *
 * @param db - The database client.
 * @param userId - The user scheduling deletion.
 * @param now - The ISO-8601 instant to anchor the grace window to.
 * @returns the number of hub rows updated (0 or 1).
 */
export async function scheduleAccountDeletion(
  db: Database,
  userId: string,
  now: string,
): Promise<number> {
  const nowDate = new Date(now);
  const deleteAfter = new Date(nowDate.getTime() + ACCOUNT_GRACE_MS);
  const rows = await db
    .update(hub)
    .set({
      deletionState: 'pending_deletion',
      deletionRequestedAt: nowDate,
      deleteAfterAt: deleteAfter,
    })
    .where(eq(hub.userId, userId))
    .returning({ id: hub.id });
  return rows.length;
}

/**
 * Cancel a scheduled deletion: rescue the account back to `active`.
 *
 * @remarks
 * Resets `deletion_state='active'` and clears both timestamps. Idempotent for an already
 * active account.
 *
 * @param db - The database client.
 * @param userId - The user cancelling deletion.
 * @returns the number of hub rows updated (0 or 1).
 */
export async function cancelAccountDeletion(db: Database, userId: string): Promise<number> {
  const rows = await db
    .update(hub)
    .set({ deletionState: 'active', deletionRequestedAt: null, deleteAfterAt: null })
    .where(eq(hub.userId, userId))
    .returning({ id: hub.id });
  return rows.length;
}

/**
 * Hard-delete a user and every row a raw `DELETE user` would leave behind.
 *
 * @remarks
 * Runs in a transaction. First removes the no-FK `user_id` rows (which carry no foreign key
 * and so never cascade), then the orgs the user solely occupies (their personal workspace +
 * any shared org nobody else joined — `organization` has no FK back to `user`), then the
 * `user` row itself, whose cascades clean up `hub`, `actor`, `session`, `account`, `passkey`,
 * the oauth tables, and `account_export`.
 *
 * @param db - The database client.
 * @param userId - The user to purge.
 * @param soleOccupiedOrgIds - Precomputed sole-occupied org ids (the sweep already has these
 *   from its ownership scan); recomputed when omitted.
 */
export async function purgeUser(
  db: Database,
  userId: string,
  soleOccupiedOrgIds?: readonly string[],
): Promise<void> {
  const orgIds = soleOccupiedOrgIds ?? (await findSoleOccupiedOrgIds(db, userId));
  await db.transaction(async (tx) => {
    // 1. No-FK `user_id` rows — these never cascade on a user delete.
    for (const table of USER_KEYED_NO_FK_TABLES) {
      await tx.delete(table).where(eq(table.userId, userId));
    }

    // 2. Orgs the user solely occupies — no FK from `organization` to `user`, so these would
    //    be orphaned. Deleting them cascades all their org-scoped children.
    if (orgIds.length > 0) {
      await tx.delete(organization).where(inArray(organization.id, [...orgIds]));
    }

    // 3. The user — cascades hub, actor (across every org), session, account, passkey,
    //    oauth*, and account_export.
    await tx.delete(user).where(eq(user.id, userId));
  });
}

/**
 * Idempotently hard-delete every account whose deletion grace window has elapsed.
 *
 * @remarks
 * Finds hubs in `pending_deletion` with `delete_after_at <= now`. For each, the ownership
 * blockers are re-evaluated: if the user has *become* the sole owner of a shared org since
 * scheduling (e.g. a co-owner left), the purge is skipped so the org is never orphaned —
 * otherwise {@link purgeUser} runs. Safe to retry: a re-run with the same `now` re-purges
 * nothing (the rows are gone) and re-skips the same conflicted accounts.
 *
 * @param db - The database client.
 * @param now - The ISO-8601 instant the sweep evaluates `delete_after_at` against.
 * @returns the per-outcome counts.
 */
export async function sweepAccountDeletions(
  db: Database,
  now: string,
): Promise<AccountDeletionSweepResult> {
  const nowDate = new Date(now);
  const due = await db
    .select({ userId: hub.userId })
    .from(hub)
    .where(
      and(
        eq(hub.deletionState, 'pending_deletion'),
        isNotNull(hub.deleteAfterAt),
        lte(hub.deleteAfterAt, nowDate),
      ),
    );

  let purged = 0;
  let skipped = 0;
  for (const { userId } of due) {
    // One ownership scan yields both the blocker check and the orgs to purge.
    const { blockers, soleOccupiedOrgIds } = await analyzeAccountOwnership(db, userId);
    if (blockers.length > 0) {
      skipped += 1;
      continue;
    }
    await purgeUser(db, userId, soleOccupiedOrgIds);
    purged += 1;
  }
  return { purged, skipped };
}
