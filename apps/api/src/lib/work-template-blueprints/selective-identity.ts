import type { TemplateTargetType } from '@docket/work/template-contract';
import type {
  WorkTemplateAssignment,
  WorkTemplateIdentity,
} from '@docket/work/work-template-reference';
import { and, eq } from 'drizzle-orm';
import type { ActorCtx } from '../../context';
import { ConflictError } from '../../error';
import {
  recordChangeSetInTransaction,
  trackedFields,
  type StoredChange,
} from '../../mcp/change-set';
import type { TemplateTransaction } from '../templates/persistence';
import { originFor } from '../provenance/context';
import { workTemplateIdentityOut } from '../work-template-creation';
import {
  lockTemplateWork,
  requireWorkAccess,
  selectedVersion,
  workTables,
} from '../work-template-selection';
import { readBlueprintClosure, lockBlueprintClosures } from './resolve';

/** Preserve identity-only compatibility without reading or changing existing descendant content. */
export async function prepareTemplateIdentityOnly(
  tx: TemplateTransaction,
  caller: ActorCtx,
  kind: TemplateTargetType,
  input: { id: string; selection: WorkTemplateAssignment },
) {
  const { id, selection } = input;
  await requireWorkAccess(tx, caller, kind, id);
  const graph = await readBlueprintClosure(tx, {
    organizationId: caller.orgId,
    kind,
    ...selection,
  });
  await lockBlueprintClosures(tx, [graph]);
  const before = await lockTemplateWork(tx, caller.orgId, kind, id);
  const version = await selectedVersion(tx, caller.orgId, kind, selection, before.teamId);
  return { caller, kind, id, selection, before, version };
}

/** Apply the checked identity using the sole identity-only writer; aggregate callers own its receipt. */
export async function writePreparedTemplateIdentityOnly(
  tx: TemplateTransaction,
  prepared: Awaited<ReturnType<typeof prepareTemplateIdentityOnly>>,
): Promise<{ identity: WorkTemplateIdentity; change: StoredChange }> {
  const { caller, kind, id, selection, before, version } = prepared;
  const table = workTables[kind];
  const [after] = await tx
    .update(table)
    .set({
      workTypeId: selection.workTypeId,
      workTypeVersionId: version.id,
      workTypeAssignedAt: new Date(),
      workTypeAssignmentSource: 'changed',
    })
    .where(and(eq(table.id, id), eq(table.organizationId, caller.orgId)))
    .returning();
  if (!after) throw new ConflictError('Work changed.');
  return {
    identity: workTemplateIdentityOut(after),
    change: {
      kind,
      id,
      op: 'update',
      before: trackedFields(kind, before.row),
      after: trackedFields(kind, after),
    },
  };
}

/** Preserve ordinary single-item identity assignment and its existing reversible receipt. */
export async function assignTemplateIdentityOnly(
  tx: TemplateTransaction,
  caller: ActorCtx,
  kind: TemplateTargetType,
  input: { id: string; selection: WorkTemplateAssignment },
): Promise<WorkTemplateIdentity> {
  const result = await writePreparedTemplateIdentityOnly(
    tx,
    await prepareTemplateIdentityOnly(tx, caller, kind, input),
  );
  await recordChangeSetInTransaction(tx, {
    orgId: caller.orgId,
    actorId: caller.actorId,
    origin: originFor('work_template_assignment'),
    summary: 'Changed template',
    changes: [result.change],
  });
  return result.identity;
}
