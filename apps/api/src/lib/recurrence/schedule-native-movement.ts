import { processOccurrence } from '@docket/db';
import { BlueprintCivilDate } from '@docket/work/work-template-blueprint';
import { and, eq } from 'drizzle-orm';
import { ConflictError } from '../../error';
import { recordChangeSetInTransaction } from '../../mcp/change-set';
import type { TemplateTransaction } from '../templates/persistence';
import type { DeferredWorkEffect } from '../work-creation/types';
import { originFor, ruleProvenance } from '../provenance/context';
import { authorizeNativeScheduleOccurrence } from './schedule-native-facts';
import { reflowNativeScheduleDates } from './schedule-native-reflow';

/** Stable provider move identity; no title pattern or replacement work is accepted. */
export interface NativeScheduleOccurrenceMove {
  readonly organizationId: string;
  readonly occurrenceId: string;
  readonly scheduledFor: string;
  readonly externalOccurrenceKey: string;
  readonly originalScheduledFor?: string | undefined;
}
/** Move an applied native occurrence through checked private ownership and the ordinary shared date engine. */
export async function moveNativeScheduleOccurrence(
  tx: TemplateTransaction,
  input: NativeScheduleOccurrenceMove,
): Promise<readonly DeferredWorkEffect[]> {
  BlueprintCivilDate.parse(input.scheduledFor);
  const before = await authorizeNativeScheduleOccurrence(tx, input);
  if (before.occurrence.externalOccurrenceKey !== input.externalOccurrenceKey)
    throw new ConflictError('Calendar occurrence binding changed');
  if (before.occurrence.scheduledFor === input.scheduledFor) return [];
  if (before.occurrence.status === 'completed' || before.occurrence.status === 'canceled')
    return [];
  await tx
    .update(processOccurrence)
    .set({
      scheduledFor: input.scheduledFor,
      originalScheduledFor:
        before.occurrence.originalScheduledFor ??
        input.originalScheduledFor ??
        before.occurrence.scheduledFor,
    })
    .where(
      and(
        eq(processOccurrence.organizationId, input.organizationId),
        eq(processOccurrence.id, input.occurrenceId),
      ),
    );
  const facts = await authorizeNativeScheduleOccurrence(tx, input);
  const reflow = await reflowNativeScheduleDates(tx, facts);
  if (reflow.changes.length && facts.caller)
    await recordChangeSetInTransaction(tx, {
      orgId: facts.organizationId,
      actorId: facts.caller.actorId,
      origin: originFor(
        'recurrence_move',
        {},
        ruleProvenance('recurrence', { seriesId: facts.series.id }),
      ),
      summary: 'Moved calendar occurrence dates',
      changes: reflow.changes,
    });
  return reflow.rows.map((work) => ({
    kind: 'search',
    dedupeKey: `search:${work.kind}:${work.id}`,
    work,
  }));
}
