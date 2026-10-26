import { db, markRetainedDatesManual, initiativeProgram, initiativeProject } from '@docket/db';
import { and, eq } from 'drizzle-orm';
import {
  BlueprintError,
  reflowBlueprint,
  type BlueprintDateField,
  type ExistingBlueprintNode,
  type PlannedDateChange,
} from '@docket/work/blueprints';
import { enqueueSearchUpsert } from '../../search/write-through';
import type { TemplateTransaction } from '../templates/persistence';
import { readBlueprintWork } from './snapshot-rows';
import { loadBlueprintSnapshot } from './snapshot';
import { snapshotCivilDate } from './snapshot-map';
import { affectedBlueprintNodes } from './reflow-selection';
import { snapshotCaller } from './snapshot-access';
import { retainedDateOwnershipChange } from '../../mcp/change-set-retained-dates';
import { selectiveReceiptChanges } from './selective-receipt';
import { requestsBlueprintReflow } from './date-ownership';
import type {
  AuthorizedBlueprintSnapshot,
  BlueprintStoredWork,
  BlueprintWorkRef,
  BlueprintSnapshotAuthority,
} from './snapshot-types';

import { writeBlueprintDerivedDate, type BlueprintReflowResult } from './reflow-write';
import {
  prepareRetainedDateReflow,
  applyRetainedDateReflow,
  managedRetainedCompletionReferences,
} from './retained-reflow';
import type { AuthorizedRetainedOccurrence } from '../work-creation/retained-authority';
import {
  prepareNativeScheduleReflow,
  applyNativeScheduleReflow,
  type PreparedNativeScheduleReflow,
} from '../recurrence/schedule-native-reflow';
import { advanceNativeScheduleOccurrence } from '../recurrence/schedule-native-completion';
export type { BlueprintReflowResult } from './reflow-write';
/** Authorized original snapshot retained across one enclosing ordinary mutation. */
export interface PreparedBlueprintReflow {
  readonly snapshot: AuthorizedBlueprintSnapshot;
  readonly authority: BlueprintSnapshotAuthority;
  readonly retained: AuthorizedRetainedOccurrence | null;
  readonly reference: BlueprintWorkRef;
  readonly explicitDates: readonly BlueprintDateField[];
  readonly anchorIds: ReadonlySet<string>;
  readonly affectedWorkIds: ReadonlySet<string>;
  readonly native?: PreparedNativeScheduleReflow | null;
}
function taskParent(work: Extract<BlueprintStoredWork, { kind: 'task' }>): BlueprintWorkRef | null {
  const parents = [
    ['task', work.row.parentTaskId],
    ['milestone', work.row.milestoneId],
    ['project', work.row.projectId],
    ['program', work.row.programId],
  ] as const;
  for (const [kind, id] of parents) if (id) return { kind, id };
  return null;
}
function physicalParent(work: BlueprintStoredWork): BlueprintWorkRef | null {
  switch (work.kind) {
    case 'task':
      return taskParent(work);
    case 'milestone':
      return { kind: 'project', id: work.row.projectId };
    case 'project':
      return work.row.programId ? { kind: 'program', id: work.row.programId } : null;
    default:
      return null;
  }
}
async function currentPhysicalParent(
  tx: TemplateTransaction,
  orgId: string,
  work: BlueprintStoredWork,
): Promise<BlueprintWorkRef | null> {
  const parent = physicalParent(work);
  if (parent) return parent;
  if (
    (work.kind !== 'project' && work.kind !== 'program') ||
    work.row.blueprintParentKind !== 'initiative' ||
    !work.row.blueprintParentId
  )
    return null;
  const table = work.kind === 'project' ? initiativeProject : initiativeProgram;
  const id = work.kind === 'project' ? initiativeProject.projectId : initiativeProgram.programId;
  const [link] = await tx
    .select({ initiativeId: table.initiativeId })
    .from(table)
    .where(
      and(
        eq(table.organizationId, orgId),
        eq(id, work.id),
        eq(table.initiativeId, work.row.blueprintParentId),
      ),
    )
    .limit(1);
  return link ? { kind: 'initiative', id: link.initiativeId } : null;
}
async function generationRoot(
  tx: TemplateTransaction,
  orgId: string,
  ref: BlueprintWorkRef,
  retained: AuthorizedRetainedOccurrence | null,
): Promise<{ readonly root: BlueprintWorkRef; readonly ancestorIds: readonly string[] }> {
  let current = ref;
  const seen = new Set<string>();
  for (;;) {
    const key = `${current.kind}:${current.id}`;
    if (seen.has(key) || seen.size > 500)
      throw new BlueprintError('blueprint_loop', 'Existing work ancestry is invalid.');
    seen.add(key);
    const work = await readBlueprintWork(tx, orgId, current);
    if (
      work.row.blueprintState ||
      retained?.rootRefs.some((root) => root.kind === current.kind && root.id === current.id)
    )
      return {
        root: current,
        ancestorIds: [...seen].map((key) => key.slice(key.indexOf(':') + 1)),
      };
    const parent = await currentPhysicalParent(tx, orgId, work);
    if (!parent)
      return {
        root: current,
        ancestorIds: [...seen].map((key) => key.slice(key.indexOf(':') + 1)),
      };
    current = parent;
  }
}
async function privateCompletionFootprint(
  tx: TemplateTransaction,
  facts: AuthorizedRetainedOccurrence | null,
  reference: BlueprintWorkRef,
): Promise<ReadonlySet<string>> {
  const affected = new Set<string>();
  if (!facts) return affected;
  const consumers = await managedRetainedCompletionReferences(tx, facts, reference);
  for (const consumer of [...consumers].sort((a, b) =>
    `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`),
  )) {
    const generation = await generationRoot(tx, facts.organizationId, consumer, facts);
    const snapshot = await loadBlueprintSnapshot(tx, facts.authority, generation.root, {
      scope: 'affected',
      seeds: [consumer],
      ancestorIds: generation.ancestorIds,
      dateAnchors: [consumer.id],
      forUpdate: true,
      access: 'edit',
    });
    affected.add(consumer.id);
    for (const id of affectedBlueprintNodes(
      snapshot.nodes,
      new Set([consumer.id]),
      new Set([consumer.id]),
    ))
      affected.add(id);
    if (affected.size > 500)
      throw new BlueprintError('blueprint_limit', 'Reflow at most 500 affected work items.');
  }
  return affected;
}
/** Check and lock the complete generation before its initiating ordinary write. */
export async function prepareBlueprintReflow(
  tx: TemplateTransaction,
  authority: BlueprintSnapshotAuthority,
  reference: BlueprintWorkRef,
  request: Readonly<Record<string, unknown>>,
): Promise<PreparedBlueprintReflow | null> {
  if (!requestsBlueprintReflow(request)) return null;
  const caller = snapshotCaller(tx, authority);
  const native = caller.actor
    ? await prepareNativeScheduleReflow(tx, caller.actor, reference, request)
    : null;
  const retained = native
    ? null
    : (caller.retained ??
      (caller.actor ? await prepareRetainedDateReflow(tx, caller.actor, reference) : null));
  const generation = await generationRoot(tx, caller.orgId, reference, retained);
  const snapshot = await loadBlueprintSnapshot(tx, authority, generation.root, {
    scope: 'affected',
    seeds: [reference],
    ancestorIds: generation.ancestorIds,
    dateAnchors: (['startDate', 'dueDate', 'targetDate'] as const).some(
      (field) => request[field] !== undefined,
    )
      ? [reference.id]
      : [],
    forUpdate: true,
    access: 'edit',
  });
  const explicitDates = (['startDate', 'dueDate', 'targetDate'] as const).filter(
    (field) => request[field] !== undefined,
  );
  const anchorIds = new Set(explicitDates.length ? [reference.id] : []);
  // Affected work counts the dependents a change rewrites, not the row being changed.
  const affectedWorkIds = new Set([
    ...affectedBlueprintNodes(snapshot.nodes, new Set([reference.id]), anchorIds),
    ...(await privateCompletionFootprint(tx, retained, reference)),
    ...[...(native?.affectedWorkIds ?? [])].filter((id) => id !== reference.id),
  ]);
  if (affectedWorkIds.size > 500)
    throw new BlueprintError('blueprint_limit', 'Reflow at most 500 affected work items.');
  return {
    snapshot,
    authority,
    retained,
    native,
    reference,
    explicitDates,
    anchorIds,
    affectedWorkIds,
  };
}
function currentNode(
  node: ExistingBlueprintNode,
  work: BlueprintStoredWork,
): ExistingBlueprintNode {
  const dates = { ...node.dates };
  for (const field of ['startDate', 'dueDate', 'targetDate'] as const)
    if (field in work.row)
      dates[field] = snapshotCivilDate(work.row[field as keyof typeof work.row] as Date | null);
  let state = node.state;
  if (work.kind === 'task')
    state = work.row.completedAt ? 'completed' : work.row.canceledAt ? 'canceled' : 'unstarted';
  return {
    ...node,
    dates,
    dateBindings: work.row.blueprintDateBindings,
    everStarted: work.row.blueprintEverStarted,
    state,
  };
}
function completionFacts(
  snapshot: AuthorizedBlueprintSnapshot,
  rows: ReadonlyMap<string, BlueprintStoredWork>,
) {
  return snapshot.context.completions.map((fact) => {
    const work = fact.id ? rows.get(`task:${fact.id}`) : undefined;
    if (work?.kind !== 'task') return fact;
    return {
      ...fact,
      state: work.row.completedAt
        ? ('completed' as const)
        : work.row.canceledAt
          ? ('canceled' as const)
          : ('open' as const),
      completedAt: work.row.completedAt ? work.row.completedAt.toISOString() : null,
    };
  });
}
async function applyDateChanges(
  tx: TemplateTransaction,
  orgId: string,
  rows: ReadonlyMap<string, BlueprintStoredWork>,
  planned: readonly PlannedDateChange[],
): Promise<BlueprintReflowResult> {
  const result: {
    changes: BlueprintReflowResult['changes'][number][];
    rows: BlueprintStoredWork[];
  } = { changes: [], rows: [] };
  for (const id of new Set(planned.map((change) => change.id))) {
    const work = [...rows.values()].find((row) => row.id === id);
    if (!work) throw new BlueprintError('blueprint_invalid', 'Missing authorized derived row.');
    const changes = planned.filter((entry) => entry.id === id),
      bindings = { ...work.row.blueprintDateBindings };
    for (const change of changes) bindings[change.field] = change.binding;
    const written = await writeBlueprintDerivedDate(tx, {
      organizationId: orgId,
      work,
      dates: Object.fromEntries(changes.map((change) => [change.field, change.value])),
      bindings,
    });
    result.changes.push(...written.changes);
    result.rows.push(...written.rows);
  }
  return result;
}
/** Reflow accepted managed dates after all direct/cascade writes, before the existing receipt commits. */
export async function applyBlueprintReflow(
  tx: TemplateTransaction,
  prepared: PreparedBlueprintReflow | null,
  changedIds: readonly string[] = [],
): Promise<BlueprintReflowResult> {
  if (!prepared) return { changes: [], rows: [] };
  if (prepared.native) return applyNativeScheduleReflow(tx, prepared.native);
  return applyNonNativeBlueprintReflow(tx, prepared, changedIds);
}
async function applyNonNativeBlueprintReflow(
  tx: TemplateTransaction,
  prepared: PreparedBlueprintReflow,
  changedIds: readonly string[],
): Promise<BlueprintReflowResult> {
  const { snapshot, reference } = prepared;
  const privateManual =
    reference.kind === 'task' || reference.kind === 'project' || reference.kind === 'milestone'
      ? await markRetainedDatesManual(tx, {
          organizationId: snapshot.context.organizationId,
          workKind: reference.kind,
          workId: reference.id,
          fields: prepared.explicitDates,
        })
      : [];
  const rows = new Map<string, BlueprintStoredWork>();
  for (const work of snapshot.rowsByRef.values())
    rows.set(
      `${work.kind}:${work.id}`,
      await readBlueprintWork(tx, snapshot.context.organizationId, work),
    );
  const nodes = snapshot.nodes.map((node) => {
    const work = rows.get(`${node.kind}:${node.id}`);
    if (!work) throw new BlueprintError('blueprint_invalid', 'Missing current work.');
    return currentNode(node, work);
  });
  const seeds = new Set([reference.id, ...changedIds]);
  const anchors = prepared.anchorIds;
  const planned = reflowBlueprint({
    nodes,
    context: { ...snapshot.context, completions: completionFacts(snapshot, rows) },
    affectedNodeIds: affectedBlueprintNodes(nodes, seeds, anchors),
    anchorChanges: [],
  });
  const publicChanges = await applyDateChanges(tx, snapshot.context.organizationId, rows, planned);
  const privateChanges = await applyRetainedDateReflow(
    tx,
    prepared.retained?.authority ?? null,
    seeds,
    affectedBlueprintNodes(nodes, seeds, anchors),
  );
  const downstream = privateChanges.rows.length
    ? await reflowManagedBlueprintAnchors(
        tx,
        prepared.retained?.authority ?? prepared.authority,
        privateChanges.rows,
        prepared.affectedWorkIds,
      )
    : { changes: [], rows: [] };
  return {
    changes: selectiveReceiptChanges([
      ...privateManual.map(retainedDateOwnershipChange),
      ...publicChanges.changes,
      ...privateChanges.changes,
      ...downstream.changes,
    ]),
    rows: [...publicChanges.rows, ...privateChanges.rows, ...downstream.rows],
  };
}
/** Drain derived search projection updates once after the caller's transaction commits. */
export async function finishBlueprintReflow(
  orgId: string,
  result: BlueprintReflowResult,
): Promise<void> {
  for (const work of result.rows) await enqueueSearchUpsert(orgId, work.kind, work.id);
  for (const completion of new Map(
    (result.nativeCompletions ?? []).map((entry) => [entry.occurrenceId, entry]),
  ).values())
    await advanceNativeScheduleOccurrence(db, { organizationId: orgId, ...completion });
}

/** Reflow public descendants of trusted managed anchors without turning those accepted anchors into manual edits. */
export async function reflowManagedBlueprintAnchors(
  tx: TemplateTransaction,
  authority: BlueprintSnapshotAuthority,
  references: readonly BlueprintWorkRef[],
  alreadyAffected: ReadonlySet<string> = new Set(),
): Promise<BlueprintReflowResult> {
  const prepared: PreparedBlueprintReflow[] = [];
  const affected = new Set([...alreadyAffected, ...references.map((ref) => ref.id)]);
  for (const reference of new Map(
    references.map((ref) => [`${ref.kind}:${ref.id}`, ref]),
  ).values()) {
    const value = await prepareBlueprintReflow(tx, authority, reference, { targetDate: null });
    if (!value) continue;
    for (const id of value.affectedWorkIds) affected.add(id);
    if (affected.size > 500)
      throw new BlueprintError('blueprint_limit', 'Reflow at most 500 affected work items.');
    prepared.push({
      ...value,
      explicitDates: [],
      native: value.native ? { ...value.native, explicitDates: [] } : null,
    });
  }
  const changes: BlueprintReflowResult['changes'][number][] = [];
  const rows: BlueprintStoredWork[] = [];
  const nativeCompletions: NonNullable<BlueprintReflowResult['nativeCompletions']>[number][] = [];
  for (const value of prepared) {
    const result = await applyBlueprintReflow(tx, value);
    changes.push(...result.changes);
    rows.push(...result.rows);
    nativeCompletions.push(...(result.nativeCompletions ?? []));
  }
  return {
    changes: selectiveReceiptChanges(changes),
    rows,
    nativeCompletions,
  };
}
