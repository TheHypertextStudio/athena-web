import { recurrenceSeries, type Database } from '@docket/db';
import type { WorkScheduleLifecycle } from '@docket/work/work-schedule-management';
import { and, eq } from 'drizzle-orm';
import { ConflictError } from '../../error';
import { assertSharedWorkWritable } from '../../product-capability';
import { requireScheduleAccess, type ScheduleAccessRequest } from './schedule-access';
import { recoverNativeScheduleContinuations } from './schedule-native-recovery';

/** Preserve the existing pause/resume/end policy under a checked schedule-row lock. */
export async function transitionWorkSchedule(
  database: Database,
  input: ScheduleAccessRequest,
  command: WorkScheduleLifecycle,
): Promise<void> {
  await database.transaction(async (tx) => {
    await tx
      .select({ id: recurrenceSeries.id })
      .from(recurrenceSeries)
      .where(
        and(
          eq(recurrenceSeries.id, input.seriesId),
          eq(recurrenceSeries.organizationId, input.organizationId),
        ),
      )
      .for('update');
    const { series } = await requireScheduleAccess(tx, input, 'manage');
    if (series.status === 'ended' && command.action !== 'end')
      throw new ConflictError('Ended schedules cannot resume or pause');
    await assertSharedWorkWritable(input.organizationId, undefined, tx);
    const now = new Date();
    const values =
      command.action === 'pause'
        ? { status: 'paused' as const, pausedAt: series.pausedAt ?? now }
        : command.action === 'resume'
          ? { status: 'active' as const, pausedAt: null }
          : { status: 'ended' as const, endedAt: series.endedAt ?? now };
    await tx
      .update(recurrenceSeries)
      .set(values)
      .where(
        and(
          eq(recurrenceSeries.id, series.id),
          eq(recurrenceSeries.organizationId, input.organizationId),
        ),
      );
  });
  if (command.action === 'resume') await recoverNativeScheduleContinuations(database, input);
}
