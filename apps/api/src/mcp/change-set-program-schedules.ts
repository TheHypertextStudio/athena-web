import { recurrenceSeries, recurrenceSeriesRevision } from '@docket/db';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { WorkScheduleAuthoringResult } from '../lib/recurrence/schedule-authoring';
import type { StoredChange, Tx } from './change-set';
import type { RevertResult, StoredEntry } from './change-set-companions';
import { unchangedSince } from './change-set-values';

const KIND = 'program_default_schedule';
const snapshot = z.strictObject({
  ownerProgramId: z.string().min(1),
  createdBy: z.string().min(1),
  name: z.string(),
  status: z.literal('active'),
  pausedAt: z.null(),
  endedAt: z.null(),
  archivedAt: z.null(),
  revisionId: z.string().min(1),
});

/** Record an independently installed routine in the enclosing Program's original creation receipt. */
export function programDefaultScheduleChange(result: WorkScheduleAuthoringResult): StoredChange {
  const { series, revision } = result;
  return {
    kind: KIND,
    id: series.id,
    op: 'create',
    before: null,
    after: snapshot.parse({
      ownerProgramId: series.ownerProgramId,
      createdBy: series.createdBy,
      name: series.name,
      status: series.status,
      pausedAt: series.pausedAt,
      endedAt: series.endedAt,
      archivedAt: series.archivedAt,
      revisionId: revision.id,
    }),
  };
}

/** Whether a companion entry belongs to a Program's transactional routine installation. */
export function isProgramDefaultScheduleKind(kind: string): boolean {
  return kind === KIND;
}

/**
 * End only the unchanged installed copy, preserving every accepted run, revision and generated item.
 * The existing atomic undo engine also restores its Program; any companion conflict rolls back both.
 */
export async function revertProgramDefaultSchedule(
  entry: StoredEntry,
  orgId: string,
  tx: Tx,
): Promise<RevertResult> {
  const ref = { kind: 'work_schedule', id: entry.entityId };
  const after = snapshot.safeParse(entry.after);
  if (entry.op !== 'create' || !after.success)
    return { outcome: { ...ref, reverted: false, reason: 'no_prior_state' } };
  const where = and(
    eq(recurrenceSeries.organizationId, orgId),
    eq(recurrenceSeries.id, entry.entityId),
  );
  const [current] = await tx.select().from(recurrenceSeries).where(where).limit(1).for('update');
  if (!current) return { outcome: { ...ref, reverted: false, reason: 'gone' } };
  const { revisionId, ...seriesSnapshot } = after.data;
  if (!unchangedSince(current, seriesSnapshot))
    return { outcome: { ...ref, reverted: false, reason: 'changed_since' } };
  const [latest] = await tx
    .select({ id: recurrenceSeriesRevision.id })
    .from(recurrenceSeriesRevision)
    .where(
      and(
        eq(recurrenceSeriesRevision.organizationId, orgId),
        eq(recurrenceSeriesRevision.seriesId, current.id),
      ),
    )
    .orderBy(desc(recurrenceSeriesRevision.number))
    .limit(1)
    .for('update');
  if (latest?.id !== revisionId)
    return { outcome: { ...ref, reverted: false, reason: 'changed_since' } };
  await tx.update(recurrenceSeries).set({ status: 'ended', endedAt: new Date() }).where(where);
  return { outcome: { ...ref, reverted: true } };
}
