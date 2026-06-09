/**
 * `@docket/api` — date-derived current-cycle resolver.
 *
 * @remarks
 * Cycles auto-roll on a configurable cadence (DECISION: cycles are no longer created by
 * hand; the "current" cycle is whichever team-scoped window contains today, not a
 * manually-set status). This helper resolves the current cycle for a team by date — the
 * cycle whose `[startsAt, endsAt]` window contains `now` — so quick-capture can attach a
 * freshly-captured task to the live cycle when one exists, and leave `cycleId` null when
 * the team has no covering window. The cycle window's own generation is owned by the
 * cycles surface; this read-only resolver only selects the covering window.
 */
import { cycle, db } from '@docket/db';
import { and, desc, eq, lte, gte } from 'drizzle-orm';

/**
 * Resolve the team's current cycle id by date, or `null` when none covers `now`.
 *
 * @remarks
 * Selects the org+team cycle whose window contains the instant `now`
 * (`startsAt <= now <= endsAt`). When several windows overlap (they should not for an
 * auto-rolled cadence) the latest-starting one wins, matching the cycles list order.
 *
 * @param orgId - The active organization id (tenant scope).
 * @param teamId - The team whose cadence the cycle belongs to (cycles are team-scoped).
 * @param now - The instant to test the window against (defaults to the current time).
 * @returns the covering cycle's id, or `null` when no window contains `now`.
 */
export async function resolveCurrentCycleId(
  orgId: string,
  teamId: string,
  now: Date = new Date(),
): Promise<string | null> {
  const rows = await db
    .select({ id: cycle.id })
    .from(cycle)
    .where(
      and(
        eq(cycle.organizationId, orgId),
        eq(cycle.teamId, teamId),
        lte(cycle.startsAt, now),
        gte(cycle.endsAt, now),
      ),
    )
    .orderBy(desc(cycle.startsAt))
    .limit(1);
  return rows[0]?.id ?? null;
}
