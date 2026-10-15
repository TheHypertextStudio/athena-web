import { processOccurrence } from '@docket/db';
import { BlueprintError, type BlueprintDateField } from '@docket/work/blueprints';
import { and, eq } from 'drizzle-orm';
import type { ActorCtx } from '../../context';
import type { TemplateTransaction } from '../templates/persistence';
import {
  writeBlueprintDerivedDate,
  type BlueprintReflowResult,
} from '../work-template-blueprints/reflow-write';
import type {
  BlueprintStoredWork,
  BlueprintWorkRef,
} from '../work-template-blueprints/snapshot-types';
import {
  authorizeNativeScheduleOccurrence,
  findNativeScheduleOccurrence,
  requireNativeScheduleFacts,
  type NativeScheduleFacts,
} from './schedule-native-facts';
import { loadNativeScheduleSnapshot } from './schedule-native-snapshot';
import { loadNativeScheduleAffectedSnapshot } from './schedule-native-affected';
import { nativeScheduleDateChanges } from '../../mcp/change-set-native-dates';
import {
  nativeDateOwnership,
  pinNativeScheduleDates,
  planNativeScheduleReflow,
} from './schedule-native-timing';

/** Native forest locked before an ordinary mutation; actual IDs and field ownership remain private. */
export interface PreparedNativeScheduleReflow {
  readonly facts: NativeScheduleFacts;
  readonly reference: BlueprintWorkRef;
  readonly explicitDates: readonly BlueprintDateField[];
  readonly affectedWorkIds: ReadonlySet<string>;
  readonly reconcileCompletion: boolean;
}
/** Register source-derived native dates only from this transaction's applied persisted claim and actual work. */
export async function registerNativeScheduleDateOwnership(
  tx: TemplateTransaction,
  input: { readonly organizationId: string; readonly occurrenceId: string },
): Promise<void> {
  const facts = await authorizeNativeScheduleOccurrence(tx, input);
  if (facts.occurrence.scheduleDateOwnership !== null) return;
  const snapshot = await loadNativeScheduleSnapshot(tx, facts, 'edit');
  const ownership = nativeDateOwnership(facts.document, facts.roots, snapshot.nodes);
  await tx
    .update(processOccurrence)
    .set({ scheduleDateOwnership: ownership })
    .where(
      and(
        eq(processOccurrence.organizationId, input.organizationId),
        eq(processOccurrence.id, input.occurrenceId),
      ),
    );
}
/** Lock the native forest's shared permission/write footprint before a foreground date or status mutation. */
export async function prepareNativeScheduleReflow(
  tx: TemplateTransaction,
  caller: ActorCtx,
  reference: BlueprintWorkRef,
  request: Readonly<Record<string, unknown>>,
): Promise<PreparedNativeScheduleReflow | null> {
  if (reference.kind !== 'task' && reference.kind !== 'project' && reference.kind !== 'milestone')
    return null;
  const occurrenceId = await findNativeScheduleOccurrence(tx, caller.orgId, {
    kind: reference.kind,
    id: reference.id,
  });
  if (!occurrenceId) return null;
  const facts = await authorizeNativeScheduleOccurrence(tx, {
    organizationId: caller.orgId,
    occurrenceId,
    actorId: caller.actorId,
    initiatingWork: reference,
  });
  const explicitDates = (['startDate', 'dueDate', 'targetDate'] as const).filter(
    (field) => request[field] !== undefined,
  );
  const snapshot = await loadNativeScheduleAffectedSnapshot(tx, facts, reference, explicitDates);
  return {
    facts,
    reference,
    explicitDates,
    affectedWorkIds: snapshot.affectedWorkIds,
    reconcileCompletion: request['state'] !== undefined || request['status'] !== undefined,
  };
}
async function writeNativeDates(
  tx: TemplateTransaction,
  facts: NativeScheduleFacts,
  rows: ReadonlyMap<string, BlueprintStoredWork>,
  plan: ReturnType<typeof planNativeScheduleReflow>,
): Promise<BlueprintReflowResult> {
  const changes: BlueprintReflowResult['changes'][number][] = [];
  const writtenRows: BlueprintStoredWork[] = [];
  for (const id of new Set(plan.dates.map((change) => change.id))) {
    const work = [...rows.values()].find((entry) => entry.id === id);
    if (!work) throw new BlueprintError('blueprint_invalid', 'Missing checked native date work.');
    const publicChanges = plan.publicChanges.filter((change) => change.id === id);
    const bindings = publicChanges.length
      ? {
          ...work.row.blueprintDateBindings,
          ...Object.fromEntries(publicChanges.map((change) => [change.field, change.binding])),
        }
      : undefined;
    const result = await writeBlueprintDerivedDate(tx, {
      organizationId: facts.organizationId,
      work,
      dates: Object.fromEntries(
        plan.dates
          .filter((change) => change.id === id)
          .map((change) => [change.field, change.value]),
      ),
      ...(bindings ? { bindings } : {}),
    });
    changes.push(...result.changes);
    writtenRows.push(...result.rows);
  }
  return { changes, rows: writtenRows };
}
interface NativeReflowExplicit {
  readonly workId: string;
  readonly fields: readonly BlueprintDateField[];
  readonly reference: BlueprintWorkRef;
  readonly reconcileCompletion: boolean;
}
function completionEffects(
  facts: NativeScheduleFacts,
  explicit: NativeReflowExplicit | null,
): Pick<BlueprintReflowResult, 'nativeCompletions'> {
  if (!explicit?.reconcileCompletion || !facts.caller) return {};
  return {
    nativeCompletions: [
      {
        occurrenceId: facts.occurrence.id,
        actorId: facts.caller.actorId,
        initiatingWork: explicit.reference,
      },
    ],
  };
}
function applyInferredPins(
  ownership: NonNullable<NativeScheduleFacts['occurrence']['scheduleDateOwnership']>,
  divergences: ReadonlySet<string> | undefined,
): NonNullable<NativeScheduleFacts['occurrence']['scheduleDateOwnership']> {
  if (!divergences) return ownership;
  return ownership.map((entry) =>
    divergences.has(`${entry.id}:${entry.field}`) ? { ...entry, manual: true } : entry,
  );
}
/** Apply checked managed anchors and normal descendant dates; internal movement does not create explicit pins. */
export async function reflowNativeScheduleDates(
  tx: TemplateTransaction,
  facts: NativeScheduleFacts,
  explicit: NativeReflowExplicit | null = null,
): Promise<BlueprintReflowResult> {
  requireNativeScheduleFacts(tx, facts.authority);
  const saved = facts.occurrence.scheduleDateOwnership;
  if (!saved)
    throw new BlueprintError('blueprint_invalid', 'Native date ownership has not been registered.');
  let ownership = explicit
    ? pinNativeScheduleDates(saved, explicit.workId, explicit.fields)
    : saved;
  const affectedSnapshot = explicit
    ? await loadNativeScheduleAffectedSnapshot(tx, facts, explicit.reference, explicit.fields)
    : null;
  const snapshot = affectedSnapshot ?? (await loadNativeScheduleSnapshot(tx, facts, 'edit'));
  if (!snapshot.context) return { changes: [], rows: [] };
  ownership = applyInferredPins(ownership, affectedSnapshot?.manualDivergences);
  const plan = planNativeScheduleReflow({
    nodes: snapshot.nodes,
    ownership,
    runDate: facts.occurrence.scheduledFor,
    context: snapshot.context,
    ...(affectedSnapshot ? { affectedNodeIds: affectedSnapshot.affectedWorkIds } : {}),
  });
  const result = await writeNativeDates(tx, facts, snapshot.rowsByRef, plan);
  if (JSON.stringify(saved) !== JSON.stringify(plan.ownership))
    await tx
      .update(processOccurrence)
      .set({ scheduleDateOwnership: [...plan.ownership] })
      .where(
        and(
          eq(processOccurrence.organizationId, facts.organizationId),
          eq(processOccurrence.id, facts.occurrence.id),
        ),
      );
  return {
    ...result,
    changes: [
      ...result.changes,
      ...nativeScheduleDateChanges(
        facts.occurrence.id,
        saved,
        plan.ownership,
        affectedSnapshot?.manualDivergences,
      ),
    ],
    ...completionEffects(facts, explicit),
  };
}
/** Continue the same checked native forest after the initiating ordinary mutation has written its actual dates/status. */
export async function applyNativeScheduleReflow(
  tx: TemplateTransaction,
  prepared: PreparedNativeScheduleReflow | null,
): Promise<BlueprintReflowResult> {
  if (!prepared) return { changes: [], rows: [] };
  return reflowNativeScheduleDates(tx, prepared.facts, {
    workId: prepared.reference.id,
    fields: prepared.explicitDates,
    reference: prepared.reference,
    reconcileCompletion: prepared.reconcileCompletion,
  });
}
