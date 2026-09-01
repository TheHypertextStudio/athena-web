/** Pure receipt projection for selected canvas objects that leave the active graph query. */
import type { ObjectCommandReceipt, ObjectCommandValue } from '../../lib/contracts/object-command';

import type { CanvasPropertySnapshot } from '@/lib/actions';
import { toPlanningTimeframe } from '@/lib/planning-timeframe';

/** The direction whose resulting values should be projected into retained snapshots. */
export type CanvasReceiptDirection = 'forward' | 'undo' | 'redo';

function targetValue(
  before: ObjectCommandValue,
  after: ObjectCommandValue,
  direction: CanvasReceiptDirection,
): ObjectCommandValue {
  return direction === 'undo' ? before : after;
}

function setMembership(
  values: readonly string[],
  id: string,
  included: boolean,
): readonly string[] {
  if (included) return values.includes(id) ? values : [...values, id];
  return values.filter((value) => value !== id);
}

function updateTaskSnapshot(
  snapshot: Extract<CanvasPropertySnapshot, { kind: 'task' }>,
  entries: ObjectCommandReceipt['entries'],
  direction: CanvasReceiptDirection,
): Extract<CanvasPropertySnapshot, { kind: 'task' }> {
  let next = { ...snapshot };
  for (const entry of entries) {
    if (entry.objectId !== snapshot.id) continue;
    if (entry.kind === 'relation') {
      if (entry.relation !== 'label') continue;
      next = {
        ...next,
        labelIds: setMembership(
          next.labelIds,
          entry.relatedId,
          targetValue(entry.before, entry.after, direction) === true,
        ),
      };
      continue;
    }
    const value = targetValue(entry.before, entry.after, direction);
    switch (entry.property) {
      case 'state':
        if (typeof value === 'string') next = { ...next, state: value };
        break;
      case 'priority':
        if (typeof value === 'string') next = { ...next, priority: value as typeof next.priority };
        break;
      case 'assigneeId':
      case 'projectId':
      case 'programId':
      case 'milestoneId':
      case 'cycleId':
      case 'startDate':
      case 'dueDate':
        if (typeof value === 'string' || value === null)
          next = { ...next, [entry.property]: value };
        break;
      case 'estimate':
        if (typeof value === 'number' || value === null) next = { ...next, estimate: value };
        break;
      default:
        break;
    }
  }
  return next;
}

function updateProjectSnapshot(
  snapshot: Extract<CanvasPropertySnapshot, { kind: 'project' }>,
  entries: ObjectCommandReceipt['entries'],
  direction: CanvasReceiptDirection,
): Extract<CanvasPropertySnapshot, { kind: 'project' }> {
  let next = { ...snapshot };
  let startDate = snapshot.startTimeframe?.date ?? null;
  let startResolution = snapshot.startTimeframe?.resolution ?? null;
  let startFiscalMonth = snapshot.startTimeframe?.fiscalYearStartMonth ?? null;
  let targetDate = snapshot.targetTimeframe?.date ?? null;
  let targetResolution = snapshot.targetTimeframe?.resolution ?? null;
  let targetFiscalMonth = snapshot.targetTimeframe?.fiscalYearStartMonth ?? null;
  let startChanged = false;
  let targetChanged = false;
  for (const entry of entries) {
    if (entry.objectId !== snapshot.id) continue;
    if (entry.kind === 'relation') {
      if (entry.relation === 'label') {
        next = {
          ...next,
          labelIds: setMembership(
            next.labelIds,
            entry.relatedId,
            targetValue(entry.before, entry.after, direction) === true,
          ),
        };
      } else if (entry.relation === 'initiative') {
        next = {
          ...next,
          initiativeIds: setMembership(
            next.initiativeIds,
            entry.relatedId,
            targetValue(entry.before, entry.after, direction) === true,
          ),
        };
      }
      continue;
    }
    const value = targetValue(entry.before, entry.after, direction);
    switch (entry.property) {
      case 'status':
        if (typeof value === 'string') next = { ...next, status: value };
        break;
      case 'health':
        if (typeof value === 'string' || value === null) {
          next = { ...next, health: value as typeof next.health };
        }
        break;
      case 'priority':
        if (typeof value === 'string') next = { ...next, priority: value as typeof next.priority };
        break;
      case 'leadId':
      case 'teamId':
      case 'programId':
        if (typeof value === 'string' || value === null)
          next = { ...next, [entry.property]: value };
        break;
      case 'startDate':
        if (typeof value === 'string' || value === null) startDate = value;
        startChanged = true;
        break;
      case 'startDateResolution':
        startResolution = typeof value === 'string' ? (value as typeof startResolution) : null;
        startChanged = true;
        break;
      case 'startDateFiscalYearStartMonth':
        startFiscalMonth = typeof value === 'number' ? value : null;
        startChanged = true;
        break;
      case 'targetDate':
        if (typeof value === 'string' || value === null) targetDate = value;
        targetChanged = true;
        break;
      case 'targetDateResolution':
        targetResolution = typeof value === 'string' ? (value as typeof targetResolution) : null;
        targetChanged = true;
        break;
      case 'targetDateFiscalYearStartMonth':
        targetFiscalMonth = typeof value === 'number' ? value : null;
        targetChanged = true;
        break;
      default:
        break;
    }
  }
  if (startChanged) {
    next = {
      ...next,
      startTimeframe: toPlanningTimeframe(startDate, startResolution, startFiscalMonth),
    };
  }
  if (targetChanged) {
    next = {
      ...next,
      targetTimeframe: toPlanningTimeframe(targetDate, targetResolution, targetFiscalMonth),
    };
  }
  return next;
}

/**
 * Apply the successful subset of one command receipt to retained canvas property projections.
 *
 * @param snapshots - Selected property projections retained by the canvas boundary.
 * @param receipt - Server-normalized successful receipt entries.
 * @param direction - Whether to project forward, undo, or redo target values.
 * @returns Updated projections without changing objects that the receipt did not affect.
 */
export function applyCanvasReceiptToSnapshots(
  snapshots: readonly CanvasPropertySnapshot[],
  receipt: ObjectCommandReceipt,
  direction: CanvasReceiptDirection,
): readonly CanvasPropertySnapshot[] {
  if (receipt.entries.length === 0) return snapshots;
  return snapshots.map((snapshot) => {
    if (snapshot.kind !== receipt.objectKind) return snapshot;
    return snapshot.kind === 'task'
      ? updateTaskSnapshot(snapshot, receipt.entries, direction)
      : updateProjectSnapshot(snapshot, receipt.entries, direction);
  });
}
