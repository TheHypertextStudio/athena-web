import {
  processInstance,
  processInstanceTask,
  processOccurrence,
  blueprintInvocation,
  retainedDateOwnership,
} from '@docket/db';
import { BlueprintError, deriveBlueprintDate } from '@docket/work/blueprints';
import { and, eq, sql } from 'drizzle-orm';
import type { ActorCtx } from '../../context';
import type { TemplateTransaction } from '../templates/persistence';
import {
  authorizeRetainedOccurrence,
  type AuthorizedRetainedOccurrence,
  type RetainedOccurrenceAuthority,
  requireRetainedOccurrenceAuthority,
} from '../work-creation/retained-authority';
import {
  loadRetainedDateRules,
  type RetainedDateRulePlan,
} from '../recurrence/work-template-date-rules';
import { retainedDateOwnershipChange } from '../../mcp/change-set-retained-dates';
import { loadBlueprintSnapshot } from './snapshot';
import type { BlueprintStoredWork, BlueprintWorkRef } from './snapshot-types';
import { writeBlueprintDerivedDate, type BlueprintReflowResult } from './reflow-write';

/** Authorize private timing only for the exact original Task being edited, on its existing occurrence. */
export async function prepareRetainedDateReflow(
  tx: TemplateTransaction,
  caller: ActorCtx,
  reference: BlueprintWorkRef,
): Promise<AuthorizedRetainedOccurrence | null> {
  if (reference.kind !== 'task') return null;
  const [bound] = await tx
    .select({
      instanceId: processInstance.id,
      occurrenceId: processOccurrence.id,
      seriesId: processOccurrence.seriesId,
      seriesRevisionId: processOccurrence.seriesRevisionId,
    })
    .from(processInstanceTask)
    .innerJoin(
      processInstance,
      and(
        eq(processInstance.id, processInstanceTask.instanceId),
        eq(processInstance.organizationId, caller.orgId),
      ),
    )
    .innerJoin(
      processOccurrence,
      and(
        eq(processOccurrence.id, processInstance.occurrenceId),
        eq(processOccurrence.organizationId, caller.orgId),
      ),
    )
    .innerJoin(
      blueprintInvocation,
      and(
        eq(blueprintInvocation.id, processOccurrence.blueprintInvocationId),
        eq(blueprintInvocation.organizationId, caller.orgId),
        sql`${blueprintInvocation.manifest}->>'kind'='published'`,
      ),
    )
    .where(
      and(
        eq(processInstanceTask.organizationId, caller.orgId),
        eq(processInstanceTask.taskId, reference.id),
      ),
    )
    .limit(1)
    .for('update', { of: processOccurrence });
  if (!bound) return null;
  const facts = await authorizeRetainedOccurrence(tx, {
    organizationId: caller.orgId,
    actorId: caller.actorId,
    ...bound,
  });
  const sourceIds = new Set(
    [...facts.mappedWork.values()]
      .filter((work) => work.id === reference.id)
      .map((work) => work.sourceStepId),
  );
  const plans = await managedCompletionPlans(tx, facts, sourceIds);
  for (const plan of [...plans].sort((a, b) =>
    `${a.scope.workKind}:${a.scope.workId}`.localeCompare(`${b.scope.workKind}:${b.scope.workId}`),
  ))
    await loadBlueprintSnapshot(
      tx,
      facts.authority,
      { kind: plan.scope.workKind, id: plan.scope.workId },
      { scope: 'reference', forUpdate: true, access: 'edit' },
    );
  return facts;
}
async function managedCompletionPlans(
  tx: TemplateTransaction,
  facts: AuthorizedRetainedOccurrence,
  sourceIds: ReadonlySet<string>,
): Promise<readonly RetainedDateRulePlan[]> {
  const plans = await loadRetainedDateRules(tx, facts.authority, sourceIds);
  const managed: RetainedDateRulePlan[] = [];
  for (const plan of plans) {
    if (plan.derivation.rule.kind !== 'after_completion') continue;
    const saved = await ownership(tx, plan);
    if (!saved || saved.manual) continue;
    const snapshot = await privateReference(tx, facts, plan, 'view');
    if (snapshot.root.state === 'completed' || snapshot.root.state === 'canceled') continue;
    if ((snapshot.root.dates[plan.field] ?? null) === saved.lastDerivedDate) managed.push(plan);
  }
  return managed;
}
/** Select only still-managed nonterminal private consumers before expanding their downstream write footprint. */
export async function managedRetainedCompletionReferences(
  tx: TemplateTransaction,
  facts: AuthorizedRetainedOccurrence,
  reference: BlueprintWorkRef,
): Promise<readonly BlueprintWorkRef[]> {
  if (reference.kind !== 'task') return [];
  const sourceIds = new Set(
    [...facts.mappedWork.values()]
      .filter((work) => work.id === reference.id)
      .map((work) => work.sourceStepId),
  );
  const plans = await managedCompletionPlans(tx, facts, sourceIds);
  return [
    ...new Map(
      plans.map((plan) => {
        const ref = { kind: plan.scope.workKind, id: plan.scope.workId };
        return [`${ref.kind}:${ref.id}`, ref] as const;
      }),
    ).values(),
  ];
}
function privateReference(
  tx: TemplateTransaction,
  facts: AuthorizedRetainedOccurrence,
  plan: RetainedDateRulePlan,
  access: 'view' | 'edit',
) {
  return loadBlueprintSnapshot(
    tx,
    facts.authority,
    { kind: plan.scope.workKind, id: plan.scope.workId },
    { scope: 'reference', forUpdate: true, access },
  );
}
async function ownership(
  tx: TemplateTransaction,
  plan: Awaited<ReturnType<typeof loadRetainedDateRules>>[number],
) {
  const [row] = await tx
    .select()
    .from(retainedDateOwnership)
    .where(
      and(
        eq(retainedDateOwnership.organizationId, plan.scope.organizationId),
        eq(retainedDateOwnership.occurrenceId, plan.scope.occurrenceId),
        eq(retainedDateOwnership.invocationId, plan.scope.invocationId),
        eq(retainedDateOwnership.sourceStepId, plan.scope.sourceStepId),
        eq(retainedDateOwnership.workKind, plan.scope.workKind),
        eq(retainedDateOwnership.workId, plan.scope.workId),
        eq(retainedDateOwnership.field, plan.field),
      ),
    )
    .limit(1)
    .for('update');
  return row;
}
type Ownership = typeof retainedDateOwnership.$inferSelect;
async function updateOwnership(
  tx: TemplateTransaction,
  saved: Ownership,
  patch: { manual?: boolean; lastDerivedDate?: string | null },
): Promise<BlueprintReflowResult['changes']> {
  if (
    (patch.manual ?? saved.manual) === saved.manual &&
    (patch.lastDerivedDate === undefined || patch.lastDerivedDate === saved.lastDerivedDate)
  )
    return [];
  const [after] = await tx
    .update(retainedDateOwnership)
    .set(patch)
    .where(
      and(
        eq(retainedDateOwnership.organizationId, saved.organizationId),
        eq(retainedDateOwnership.occurrenceId, saved.occurrenceId),
        eq(retainedDateOwnership.sourceStepId, saved.sourceStepId),
        eq(retainedDateOwnership.field, saved.field),
      ),
    )
    .returning();
  if (!after) throw new BlueprintError('blueprint_invalid', 'Missing private date ownership.');
  return [retainedDateOwnershipChange({ before: saved, after })];
}
async function applyPrivatePlan(
  tx: TemplateTransaction,
  facts: AuthorizedRetainedOccurrence,
  plan: RetainedDateRulePlan,
): Promise<BlueprintReflowResult> {
  const empty = { changes: [], rows: [] };
  const saved = await ownership(tx, plan);
  if (!saved || saved.manual) return empty; // Historical ownership is conservative until explicit adoption.
  const snapshot = await privateReference(tx, facts, plan, 'view');
  if (snapshot.root.state === 'completed' || snapshot.root.state === 'canceled') return empty;
  const work = snapshot.rowsByRef.get(`${plan.scope.workKind}:${plan.scope.workId}`);
  if (!work) throw new BlueprintError('blueprint_invalid', 'Missing private timing work.');
  const current = snapshot.root.dates[plan.field] ?? null;
  if (current !== saved.lastDerivedDate)
    return { changes: await updateOwnership(tx, saved, { manual: true }), rows: [] };
  const derived = deriveBlueprintDate(plan.derivation).value;
  const written =
    derived === current ? empty : await writePrivateDate(tx, facts, plan, work, derived);
  const ownershipChanges = await updateOwnership(tx, saved, { lastDerivedDate: derived });
  return { changes: [...written.changes, ...ownershipChanges], rows: written.rows };
}
async function writePrivateDate(
  tx: TemplateTransaction,
  facts: AuthorizedRetainedOccurrence,
  plan: RetainedDateRulePlan,
  work: BlueprintStoredWork,
  derived: string | null,
): Promise<BlueprintReflowResult> {
  await privateReference(tx, facts, plan, 'edit');
  return writeBlueprintDerivedDate(tx, {
    organizationId: facts.organizationId,
    work,
    dates: { [plan.field]: derived },
  });
}
async function applyPrivatePlans(
  tx: TemplateTransaction,
  facts: AuthorizedRetainedOccurrence,
  plans: readonly RetainedDateRulePlan[],
  alreadyAffected: ReadonlySet<string>,
): Promise<BlueprintReflowResult> {
  if (new Set([...alreadyAffected, ...plans.map((plan) => plan.scope.workId)]).size > 500)
    throw new BlueprintError('blueprint_limit', 'Reflow at most 500 affected work items.');
  const changes: BlueprintReflowResult['changes'][number][] = [];
  const rows: BlueprintReflowResult['rows'][number][] = [];
  for (const plan of plans) {
    const written = await applyPrivatePlan(tx, facts, plan);
    changes.push(...written.changes);
    rows.push(...written.rows);
  }
  return { changes, rows };
}
/** Apply checked cross-root completion timing through the same pure calendar and concrete date writer. */
export async function applyRetainedDateReflow(
  tx: TemplateTransaction,
  authority: RetainedOccurrenceAuthority | null,
  changedIds: ReadonlySet<string>,
  alreadyAffected: ReadonlySet<string> = new Set(),
): Promise<BlueprintReflowResult> {
  if (!authority) return { changes: [], rows: [] };
  const facts = requireRetainedOccurrenceAuthority(tx, authority);
  const sourceIds = new Set(
    [...facts.mappedWork.values()]
      .filter((work) => changedIds.has(work.id))
      .map((work) => work.sourceStepId),
  );
  return applyPrivatePlans(
    tx,
    facts,
    await loadRetainedDateRules(tx, authority, sourceIds),
    alreadyAffected,
  );
}
/** Re-derive only run-date anchors under a fresh checked occurrence token after its scheduled date changes. */
export async function applyRetainedRunDateReflow(
  tx: TemplateTransaction,
  authority: RetainedOccurrenceAuthority,
): Promise<BlueprintReflowResult> {
  const facts = requireRetainedOccurrenceAuthority(tx, authority);
  const plans = (await loadRetainedDateRules(tx, authority)).filter(
    (plan) => plan.derivation.rule.kind === 'anchor',
  );
  return applyPrivatePlans(tx, facts, plans, new Set());
}
