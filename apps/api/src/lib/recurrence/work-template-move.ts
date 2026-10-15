import { processOccurrence } from '@docket/db';
import { and, eq } from 'drizzle-orm';
import { ConflictError } from '../../error';
import type { TemplateTransaction } from '../templates/persistence';
import {
  authorizeRetainedOccurrence,
  type RetainedOccurrenceRequest,
} from '../work-creation/retained-authority';
import type { DeferredWorkEffect } from '../work-creation/types';
import { applyRetainedRunDateReflow } from '../work-template-blueprints/retained-reflow';
import { reflowManagedBlueprintAnchors } from '../work-template-blueprints/reflow';
import { recordChangeSetInTransaction } from '../../mcp/change-set';
import { originFor, ruleProvenance } from '../provenance/context';

/** Checked provider move; the stable occurrence binding and one-time materialization marker stay unchanged. */
export interface RetainedOccurrenceMove extends RetainedOccurrenceRequest {
  readonly scheduledFor: string;
  readonly originalScheduledFor?: string | undefined;
  readonly externalOccurrenceKey: string;
}
/** Move only managed dates through shared private/public derivation under freshly checked persisted authority. */
export async function moveRetainedOccurrence(
  tx: TemplateTransaction,
  request: RetainedOccurrenceMove,
): Promise<readonly DeferredWorkEffect[]> {
  const [occurrence] = await tx
    .select()
    .from(processOccurrence)
    .where(
      and(
        eq(processOccurrence.organizationId, request.organizationId),
        eq(processOccurrence.id, request.occurrenceId),
      ),
    )
    .limit(1)
    .for('update');
  if (occurrence?.externalOccurrenceKey !== request.externalOccurrenceKey)
    throw new ConflictError('Calendar occurrence binding changed');
  if (occurrence.scheduledFor === request.scheduledFor) return [];
  await authorizeRetainedOccurrence(tx, request);
  await tx
    .update(processOccurrence)
    .set({
      scheduledFor: request.scheduledFor,
      originalScheduledFor:
        occurrence.originalScheduledFor ?? request.originalScheduledFor ?? occurrence.scheduledFor,
    })
    .where(
      and(
        eq(processOccurrence.organizationId, request.organizationId),
        eq(processOccurrence.id, request.occurrenceId),
      ),
    );
  const facts = await authorizeRetainedOccurrence(tx, request);
  const privateResult = await applyRetainedRunDateReflow(tx, facts.authority);
  const publicResult = await reflowManagedBlueprintAnchors(
    tx,
    facts.authority,
    privateResult.rows.map((work) => ({ kind: work.kind, id: work.id })),
    new Set(privateResult.rows.map((work) => work.id)),
  );
  const changes = [...privateResult.changes, ...publicResult.changes];
  if (changes.length && facts.caller.actorId !== null)
    await recordChangeSetInTransaction(tx, {
      orgId: facts.organizationId,
      actorId: facts.caller.actorId,
      origin: originFor(
        'recurrence_move',
        {},
        ruleProvenance('recurrence', { seriesId: facts.seriesId }),
      ),
      summary: 'Moved calendar occurrence dates',
      changes,
    });
  return [...privateResult.rows, ...publicResult.rows].map((work) => ({
    kind: 'search',
    dedupeKey: `search:${work.kind}:${work.id}`,
    work,
  }));
}
