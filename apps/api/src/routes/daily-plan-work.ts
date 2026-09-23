/** Recorded human work for a personal planning day. */
import { db, timeInterval } from '@docket/db';
import { and, eq, gt, isNull, lt, or } from 'drizzle-orm';

/** Clip work intervals to the person's local day without changing ledger history. */
export async function loadRecordedDayWork(hubId: string, dayStart: Date, dayEnd: Date) {
  const intervals = await db
    .select()
    .from(timeInterval)
    .where(
      and(
        eq(timeInterval.hubId, hubId),
        eq(timeInterval.actorKind, 'human'),
        isNull(timeInterval.supersededById),
        lt(timeInterval.startedAt, dayEnd),
        or(isNull(timeInterval.endedAt), gt(timeInterval.endedAt, dayStart)),
      ),
    );
  const now = Date.now();
  return intervals.map((entry) => {
    const start = Math.max(entry.startedAt.getTime(), dayStart.getTime());
    const end = Math.min(entry.endedAt?.getTime() ?? now, dayEnd.getTime());
    return {
      taskId: entry.taskId,
      startedAt: entry.startedAt.toISOString(),
      endedAt: entry.endedAt?.toISOString() ?? null,
      recordedMinutes: Math.max(0, Math.round((end - start) / 60_000)),
    };
  });
}
