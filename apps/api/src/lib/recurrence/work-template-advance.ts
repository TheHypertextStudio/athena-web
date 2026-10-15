import type { TemplateTransaction } from '../templates/persistence';
import { recordChangeSetInTransaction } from '../../mcp/change-set';
import { originFor, ruleProvenance } from '../provenance/context';
import {
  authorizeRetainedOccurrence,
  type RetainedOccurrenceRequest,
} from '../work-creation/retained-authority';
import { reflowManagedBlueprintAnchors } from '../work-template-blueprints/reflow';
import { applyRetainedDateReflow } from '../work-template-blueprints/retained-reflow';
import type { BlueprintReflowResult } from '../work-template-blueprints/reflow-write';
import type { TemplateOccurrenceMaterialization } from './work-template-adapter';
import { materializeTemplateOccurrence } from './work-template-adapter';
/** Cutover delta/effects and shared private date writes from one original completion event. */
export interface RetainedOccurrenceAdvance extends TemplateOccurrenceMaterialization {
  readonly reflow: BlueprintReflowResult;
}
/** Complete a pending cutover once, then date existing work through checked private shared reflow; never run lazy raw inserts. */
export async function advanceTemplateOccurrence(
  tx: TemplateTransaction,
  request: RetainedOccurrenceRequest,
  completedTaskId: string,
): Promise<RetainedOccurrenceAdvance> {
  const materialized = await materializeTemplateOccurrence(tx, request);
  const facts = await authorizeRetainedOccurrence(tx, request);
  const privateResult = await applyRetainedDateReflow(
    tx,
    facts.authority,
    new Set([completedTaskId]),
  );
  const publicResult = await reflowManagedBlueprintAnchors(
    tx,
    facts.authority,
    privateResult.rows.map((work) => ({ kind: work.kind, id: work.id })),
    new Set(privateResult.rows.map((work) => work.id)),
  );
  const reflow = {
    changes: [...privateResult.changes, ...publicResult.changes],
    rows: [...privateResult.rows, ...publicResult.rows],
  };
  if (reflow.changes.length && facts.caller.actorId !== null)
    await recordChangeSetInTransaction(tx, {
      orgId: facts.organizationId,
      actorId: facts.caller.actorId,
      origin: originFor(
        'recurrence_reflow',
        {},
        ruleProvenance('recurrence', { seriesId: facts.seriesId }),
      ),
      summary: 'Updated completion-dependent dates',
      changes: [...reflow.changes],
    });
  return { ...materialized, reflow };
}
