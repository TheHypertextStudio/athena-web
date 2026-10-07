/** Accepted daily commitments release the morning gate and require previewed changes. */
import type { Database } from '@docket/db';
import { dailyPlanDay } from '@docket/db';
import { and, eq } from 'drizzle-orm';
import { ConflictError } from '../../error';
import type { DayContext } from './directive-service';
import { hasRunCovering } from './repository';

async function acceptedDay(db: Database, hubId: string, date: string) {
  const [day] = await db
    .select({ accepted: dailyPlanDay.accepted })
    .from(dailyPlanDay)
    .where(and(eq(dailyPlanDay.hubId, hubId), eq(dailyPlanDay.date, date)))
    .limit(1);
  return day?.accepted ?? null;
}

/** Read daily acceptance before falling back to the weekly planning-run readiness. */
export async function dailyDirectiveReadiness(
  db: Database,
  hubId: string,
  date: string,
  blocks: number,
): Promise<Pick<DayContext, 'acceptedAt' | 'readiness'>> {
  const accepted = await acceptedDay(db, hubId, date);
  if (accepted) return { acceptedAt: new Date(accepted.original.acceptedAt), readiness: 'ready' };
  const planned = await hasRunCovering(db, hubId, date);
  return {
    acceptedAt: null,
    readiness: !planned ? 'not_generated' : blocks === 0 ? 'empty_week' : 'ready',
  };
}

/** Preserve the original release timestamp when reading older accepted days. */
export function dailyAcknowledgedAt(context: DayContext, stored: Date | null): Date | null {
  return stored ?? context.acceptedAt ?? null;
}

/** Reject legacy mutations once a person has accepted a daily snapshot. */
export async function requireLegacyPlanMutation(
  db: Database,
  hubId: string,
  date: string,
): Promise<void> {
  if (await acceptedDay(db, hubId, date))
    throw new ConflictError(
      'Preview changes through the daily-plan proposal before confirming them',
      'accepted_plan_requires_revision',
    );
}
