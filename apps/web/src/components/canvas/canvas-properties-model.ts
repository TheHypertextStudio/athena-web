/** Pure aggregation, compatibility, projection, and command helpers for canvas bulk Properties. */
import type { ObjectCommandIn } from '../../lib/contracts/object-command';
import type { ProjectOverviewItem } from '../../lib/contracts/project';
import type { Node } from '@xyflow/react';

import type { CanvasPropertySnapshot } from '@/lib/actions';
import { toPlanningTimeframe } from '@/lib/planning-timeframe';

import { taskData } from './task-node';

/** One scalar aggregation without using null as a mixed sentinel. */
export type ScalarAggregation<T> =
  { readonly state: 'same'; readonly value: T } | { readonly state: 'mixed' };

/** Whether every, some, or no selected objects carry one association. */
export type AssociationAggregation = 'all' | 'some' | 'none';

/** Aggregate a scalar property across a nonempty selection. */
export function aggregateScalar<TSnapshot, TValue>(
  snapshots: readonly TSnapshot[],
  read: (snapshot: TSnapshot) => TValue,
  equal: (left: TValue, right: TValue) => boolean = Object.is,
): ScalarAggregation<TValue> {
  const first = read(snapshots[0] as TSnapshot);
  return snapshots.every((snapshot) => equal(read(snapshot), first))
    ? { state: 'same', value: first }
    : { state: 'mixed' };
}

/** Aggregate one association across a selection. */
export function aggregateAssociation<TSnapshot>(
  snapshots: readonly TSnapshot[],
  associationId: string,
  read: (snapshot: TSnapshot) => readonly string[],
): AssociationAggregation {
  const count = snapshots.filter((snapshot) => read(snapshot).includes(associationId)).length;
  if (count === 0) return 'none';
  return count === snapshots.length ? 'all' : 'some';
}

/** Validate the command envelope invariants that the editor can check locally. */
export function guardCanvasPropertySelection(
  snapshots: readonly CanvasPropertySnapshot[],
): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  if (snapshots.length === 0) return { ok: false, reason: 'Select at least one object.' };
  if (snapshots.length > 500) {
    return { ok: false, reason: 'Properties supports at most 500 selected objects.' };
  }
  const first = snapshots[0];
  if (first === undefined) return { ok: false, reason: 'Select at least one object.' };
  if (snapshots.some(({ kind }) => kind !== first.kind)) {
    return { ok: false, reason: 'Properties requires one object type.' };
  }
  if (snapshots.some(({ organizationId }) => organizationId !== first.organizationId)) {
    return { ok: false, reason: 'Properties requires one workspace.' };
  }
  if (new Set(snapshots.map(({ id }) => id)).size !== snapshots.length) {
    return { ok: false, reason: 'Properties requires unique objects.' };
  }
  return { ok: true };
}

/** Scalar properties available through the bulk command DTO. */
export type CanvasScalarProperty =
  | 'state'
  | 'priority'
  | 'assigneeId'
  | 'projectId'
  | 'programId'
  | 'milestoneId'
  | 'cycleId'
  | 'startDate'
  | 'dueDate'
  | 'estimate'
  | 'status'
  | 'health'
  | 'leadId'
  | 'teamId'
  | 'startTimeframe'
  | 'targetTimeframe';

/** Build one atomic scalar replacement over the selection. */
export function buildScalarCommand(
  snapshots: readonly CanvasPropertySnapshot[],
  property: CanvasScalarProperty,
  value: unknown,
  commandId: string,
): ObjectCommandIn {
  const first = snapshots[0];
  if (first === undefined) throw new Error('A scalar property command requires a selection.');
  return {
    commandId,
    objectKind: first.kind,
    objectIds: snapshots.map(({ id }) => id),
    operation: { type: 'replace_property', property, value },
  } as ObjectCommandIn;
}

/** Build the add-to-all or remove-from-all command implied by one tri-state association. */
export function buildAssociationCommand(
  snapshots: readonly CanvasPropertySnapshot[],
  association: 'label' | 'initiative',
  associationId: string,
  commandId: string,
): ObjectCommandIn {
  const first = snapshots[0];
  if (first === undefined) throw new Error('An association command requires a selection.');
  const state = aggregateAssociation(snapshots, associationId, (snapshot) =>
    association === 'label'
      ? snapshot.labelIds
      : snapshot.kind === 'project'
        ? snapshot.initiativeIds
        : [],
  );
  return {
    commandId,
    objectKind: first.kind,
    objectIds: snapshots.map(({ id }) => id),
    operation: {
      type: state === 'all' ? 'remove_association' : 'add_association',
      association,
      associationIds: [associationId],
    },
  } as ObjectCommandIn;
}

/** Build a safe removal command even when only part of the selection has the association. */
export function buildAssociationRemovalCommand(
  snapshots: readonly CanvasPropertySnapshot[],
  association: 'label' | 'initiative',
  associationId: string,
  commandId: string,
): ObjectCommandIn {
  const first = snapshots[0];
  if (first === undefined) throw new Error('An association command requires a selection.');
  return {
    commandId,
    objectKind: first.kind,
    objectIds: snapshots.map(({ id }) => id),
    operation: {
      type: 'remove_association',
      association,
      associationIds: [associationId],
    },
  } as ObjectCommandIn;
}

/** Return one shared non-null reference, or null when it is absent or mixed. */
export function commonNonNullValue<TSnapshot>(
  snapshots: readonly TSnapshot[],
  read: (snapshot: TSnapshot) => string | null,
): string | null {
  const aggregate = aggregateScalar(snapshots, read);
  return aggregate.state === 'same' ? aggregate.value : null;
}

/** Intersect valid Task status keys while preserving the first Team's order. */
export function intersectTaskStatusKeys(
  snapshots: readonly Extract<CanvasPropertySnapshot, { kind: 'task' }>[],
  keysForTeam: (teamId: string) => readonly string[],
): readonly string[] {
  const teams = [...new Set(snapshots.map(({ teamId }) => teamId))];
  const first = keysForTeam(teams[0] ?? '');
  const remaining = teams.slice(1).map((teamId) => new Set(keysForTeam(teamId)));
  return first.filter((key) => remaining.every((keys) => keys.has(key)));
}

/** Keep global Labels and Team Labels valid for every selected object's Team. */
export function compatibleLabels<
  T extends { readonly id: string; readonly teamId?: string | null | undefined },
>(snapshots: readonly CanvasPropertySnapshot[], labels: readonly T[]): readonly T[] {
  return labels.filter(
    ({ teamId }) => teamId == null || snapshots.every((snapshot) => snapshot.teamId === teamId),
  );
}

/** Project overview rows already contain the complete approved Project property projection. */
export function projectRowsToPropertySnapshots(
  rows: readonly ProjectOverviewItem[],
  organizationId: string,
): readonly Extract<CanvasPropertySnapshot, { kind: 'project' }>[] {
  return rows.map((row) => ({
    kind: 'project',
    id: row.id,
    organizationId,
    status: row.status,
    health: row.health ?? null,
    priority: row.priority,
    leadId: row.leadId ?? null,
    teamId: row.teamId,
    programId: row.programId ?? null,
    labelIds: row.labelIds,
    initiativeIds: row.initiativeIds,
    startTimeframe: toPlanningTimeframe(
      row.startDate,
      row.startDateResolution,
      row.startDateFiscalYearStartMonth,
    ),
    targetTimeframe: toPlanningTimeframe(
      row.targetDate,
      row.targetDateResolution,
      row.targetDateFiscalYearStartMonth,
    ),
  }));
}

/** Filtered Task nodes retain the complete approved Task property projection. */
export function taskNodesToPropertySnapshots(
  nodes: readonly Node[],
  organizationId: string,
): readonly Extract<CanvasPropertySnapshot, { kind: 'task' }>[] {
  return nodes.map((node) => {
    const data = taskData(node);
    return {
      kind: 'task',
      id: node.id,
      organizationId,
      state: data.state,
      priority: data.priority,
      assigneeId: data.assigneeId,
      projectId: data.projectId,
      programId: data.programId,
      milestoneId: data.milestoneId,
      cycleId: data.cycleId,
      labelIds: data.labelIds,
      teamId: data.teamId,
      startDate: data.startDate,
      dueDate: data.dueDate,
      estimate: data.estimate,
    };
  });
}
