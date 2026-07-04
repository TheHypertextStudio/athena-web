/**
 * `@docket/api` — the email-suggestion lifecycle sweep (expiry + retention purge).
 *
 * @remarks
 * Suggestions are transient proposals, not records: a pending suggestion the user never
 * triaged goes stale (the email is old news), and resolved rows only matter long enough to
 * audit what happened. This sweep — run by the daily `lifecycle-sweep` cron alongside the
 * org data-lifecycle machine — (1) expires pending suggestions older than
 * {@link EXPIRE_PENDING_AFTER_DAYS} (status `expired`, so the lane never shows stale
 * proposals and the dedup indexes keep protecting against re-ingest), and (2) hard-deletes
 * resolved rows (accepted/dismissed/expired) older than {@link PURGE_RESOLVED_AFTER_DAYS} —
 * the ingest-time snapshot (`emailMeta`) is purged with the row, honoring the
 * minimal-retention posture (accepted suggestions live on as the task + its attachment).
 * Idempotent and safe to re-run. See `docs/engineering/specs/email-to-task.md`.
 */
import { db, emailSuggestion } from '@docket/db';
import { and, eq, inArray, lt } from 'drizzle-orm';

/** Days a `pending` suggestion may sit untriaged before it expires. */
export const EXPIRE_PENDING_AFTER_DAYS = 30;

/** Days a resolved (accepted/dismissed/expired) row is retained before hard deletion. */
export const PURGE_RESOLVED_AFTER_DAYS = 90;

/** The outcome of one suggestion-lifecycle sweep. */
export interface SuggestionLifecycleResult {
  /** Pending suggestions expired this run. */
  readonly expired: number;
  /** Resolved rows hard-deleted this run. */
  readonly purged: number;
}

/**
 * Expire stale pending suggestions and purge old resolved ones.
 *
 * @param now - The sweep's reference time (read at request time, never module scope).
 */
export async function sweepEmailSuggestionLifecycle(now: Date): Promise<SuggestionLifecycleResult> {
  const expireBefore = new Date(now.getTime() - EXPIRE_PENDING_AFTER_DAYS * 24 * 60 * 60 * 1000);
  const purgeBefore = new Date(now.getTime() - PURGE_RESOLVED_AFTER_DAYS * 24 * 60 * 60 * 1000);

  const expired = await db
    .update(emailSuggestion)
    .set({ status: 'expired' })
    .where(and(eq(emailSuggestion.status, 'pending'), lt(emailSuggestion.createdAt, expireBefore)))
    .returning({ id: emailSuggestion.id });

  const purged = await db
    .delete(emailSuggestion)
    .where(
      and(
        inArray(emailSuggestion.status, ['accepted', 'dismissed', 'expired']),
        lt(emailSuggestion.createdAt, purgeBefore),
      ),
    )
    .returning({ id: emailSuggestion.id });

  return { expired: expired.length, purged: purged.length };
}
