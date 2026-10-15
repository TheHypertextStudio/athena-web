import { genId } from '@docket/db';
import { and, eq } from 'drizzle-orm';
import type { BlueprintState, OptionalChoice } from '@docket/work/work-template-blueprint';
import type { WorkTemplateAssignment } from '@docket/work/work-template-reference';
import { ConflictError } from '../../error';
import type { TemplateTransaction } from '../templates/persistence';
import { workTables } from '../work-template-selection';
import { replaceLabels } from '../labels';
import { applyStartingStatus, type StartingStatusWrite } from '../work-template-starting-writes';
import type { PreparedSelectiveReview } from './selective-review';

function acceptedRootState(
  review: PreparedSelectiveReview,
  previous: BlueprintState | null,
  facts: {
    owned: readonly { blockerId: string; blockedId: string }[];
    manifest: PreparedSelectiveReview['tree']['manifest'];
    optionalChoices: readonly OptionalChoice[];
  },
): BlueprintState {
  const { snapshot } = review;
  return {
    revision: (previous?.revision ?? 0) + 1,
    generationKey: previous?.generationKey ?? genId(),
    resolvedManifest: [...facts.manifest],
    optionalChoices: [...facts.optionalChoices],
    creationTimezone: snapshot.context.timezone,
    workingWeekdays: [...snapshot.context.workingWeekdays],
    lastApplicationChangeSetId: null,
    managedDependencies: [...facts.owned],
  };
}

/** Write only selected starting fields and the reviewed root identity/state. */
export async function updateSelectiveRoot(
  tx: TemplateTransaction,
  review: PreparedSelectiveReview,
  selection: WorkTemplateAssignment,
  facts: {
    owned: readonly { blockerId: string; blockedId: string }[];
    manifest: PreparedSelectiveReview['tree']['manifest'];
    optionalChoices: readonly OptionalChoice[];
  },
): Promise<StartingStatusWrite> {
  const { caller, kind, snapshot, graph } = review;
  const before = snapshot.rowsByRef.get(`${kind}:${snapshot.root.id}`);
  if (!before || before.kind === 'milestone') throw new ConflictError('Reviewed root changed.');
  const fields = selection.applyFields ?? [],
    table = workTables[kind];
  const patch = Object.fromEntries(
    fields
      .filter((field) => field !== 'labels' && field !== 'status')
      .map((field) => [field, review.starting?.values[field]]),
  );
  const previous = before.row.blueprintState;
  await tx
    .update(table)
    .set({
      ...patch,
      workTypeId: graph.root.workTypeId,
      workTypeVersionId: graph.root.versionId,
      workTypeAssignedAt: new Date(),
      workTypeAssignmentSource: review.preview.mode === 'update' ? 'updated' : 'changed',
      blueprintState: acceptedRootState(review, previous, facts),
    })
    .where(and(eq(table.id, before.id), eq(table.organizationId, caller.orgId)));
  if (fields.includes('labels') && review.starting)
    await replaceLabels(tx, kind, before.id, caller.orgId, review.starting.labels);
  return fields.includes('status') && review.starting
    ? applyStartingStatus(tx, caller, kind, before.row, review.starting.values['status'])
    : { changes: [], effect: null };
}
