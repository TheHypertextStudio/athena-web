/**
 * Screening a replay object by object before anything is written. Every entry for one object is
 * checked first, because a composite tuple emits several entries and an undo must skip all of them
 * when a collaborator moved any one.
 */
import { cycle, program, team } from '@docket/db';

import type {
  ObjectCommandReceipt,
  ObjectCommandRelationReceiptEntry,
  ObjectCommandValue,
} from '../../contracts/object-command';
import { CapabilityError, NotFoundError } from '../../error';
import { applyExclusivity } from '../labels';
import { assertPlanningDateRange } from '../planning-timeframe';
import { resolveContainerStatus, resolveTaskStatus } from '../work-status';
import { assertResourceCapability } from './capabilities';
import { taskParentWouldCycle } from './graph-cycles';
import { ownedValidation, receiptId, validateReceiptEntryShape } from './receipt-validator';
import {
  assertActiveHumanProjectLead,
  assertActiveProject,
  assertActiveTask,
  assertActiveTaskAssignee,
  assertMilestoneForProject,
  assertReference,
} from './references';
import { replayReferenceRequirement, replayRequirementKey } from './replay-access';
import type { ReplayAccessDecision } from './replay-access';
import { replayRelationKey, type ReplayRelationFacts } from './replay-relations';
import type { CommandEntry, CommandScope, Dbh, TxScope } from './types';
import { normalize, normalizeProperty } from './value-transform';

type ObjectRow = Record<string, unknown>;

async function assertTaskTargetExists(
  database: Dbh,
  orgId: string,
  property: string,
  id: string,
  row: ObjectRow,
): Promise<void> {
  switch (property) {
    case 'assigneeId':
      return assertActiveTaskAssignee(database, orgId, id);
    case 'projectId':
      return assertActiveProject(database, orgId, id);
    case 'programId':
      return assertReference(database, program, orgId, id, 'Program not found');
    case 'cycleId':
      return assertReference(database, cycle, orgId, id, 'Cycle not found');
    case 'milestoneId':
      return assertMilestoneForProject(database, orgId, id, String(row['projectId']));
    case 'parentTaskId':
      return assertActiveTask(database, orgId, id);
    default:
      return;
  }
}

async function assertProjectTargetExists(
  database: Dbh,
  orgId: string,
  property: string,
  id: string,
): Promise<void> {
  switch (property) {
    case 'leadId':
      return assertActiveHumanProjectLead(database, orgId, id);
    case 'teamId':
      return assertReference(database, team, orgId, id, 'Team not found');
    case 'programId':
      return assertReference(database, program, orgId, id, 'Program not found');
    default:
      return;
  }
}

/** Require that the value an entry moves a reference column to still exists and is reachable. */
export async function assertReplayObjectTarget(
  scope: CommandScope,
  kind: 'task' | 'project',
  property: string,
  target: ObjectCommandValue,
  row: ObjectRow,
): Promise<void> {
  if (target === null) return;
  const { database, orgId } = scope;
  if (kind === 'task') {
    await assertTaskTargetExists(database, orgId, property, String(target), row);
  } else {
    await assertProjectTargetExists(database, orgId, property, String(target));
  }
  const requirement = replayReferenceRequirement(kind, property, target);
  if (requirement !== null) {
    await assertResourceCapability(scope, requirement.kind, requirement.id, requirement.capability);
  }
}

/** Everything the preflight reads, plus the two sets it marks objects in. */
export interface ReplayPreflightContext {
  readonly scope: TxScope;
  readonly receipt: ObjectCommandReceipt;
  readonly direction: 'undo' | 'redo';
  readonly lockedById: ReadonlyMap<string, ObjectRow>;
  readonly capabilityByTarget: ReadonlyMap<string, ReplayAccessDecision>;
  readonly relationFacts: ReplayRelationFacts;
  readonly conflicting: Set<string>;
  readonly denied: Set<string>;
}

/** The value one object's entries move each property to, in the direction being replayed. */
interface EntryTargets {
  readonly has: (property: string) => boolean;
  readonly of: (property: string) => ObjectCommandValue | undefined;
}

function entryTargets(entries: readonly CommandEntry[], direction: 'undo' | 'redo'): EntryTargets {
  return {
    has: (property) =>
      entries.some((entry) => entry.kind === 'object' && entry.property === property),
    of: (property) => {
      const entry = entries.find(
        (candidate) => candidate.kind === 'object' && candidate.property === property,
      );
      if (entry?.kind !== 'object') return undefined;
      return direction === 'undo' ? entry.before : entry.after;
    },
  };
}

/** A vanished, unreachable, or trashed object cannot take anything but its own restore. */
function objectUnreachable(
  context: ReplayPreflightContext,
  objectId: string,
  entries: readonly CommandEntry[],
): boolean {
  const row = context.lockedById.get(objectId);
  if (!row) return true;
  const decision = context.capabilityByTarget.get(
    replayRequirementKey(context.receipt.objectKind, objectId),
  );
  if (!decision?.allow) return true;
  return (
    row['archivedAt'] !== null &&
    entries.some((entry) => entry.kind !== 'object' || entry.property !== 'archivedAt')
  );
}

function relationTargetUnreachable(
  context: ReplayPreflightContext,
  entry: ObjectCommandRelationReceiptEntry,
): boolean {
  if (entry.relation !== 'dependency') {
    return !context.relationFacts.targetIds.has(`${entry.relation}:${entry.relatedId}`);
  }
  const related = context.lockedById.get(entry.relatedId);
  const decision = context.capabilityByTarget.get(
    replayRequirementKey(context.receipt.objectKind, entry.relatedId),
  );
  return related?.['archivedAt'] !== null || !decision?.allow;
}

async function objectTargetUnreachable(
  context: ReplayPreflightContext,
  property: string,
  target: ObjectCommandValue,
  row: ObjectRow,
): Promise<boolean> {
  try {
    await assertReplayObjectTarget(
      context.scope,
      context.receipt.objectKind,
      property,
      target,
      row,
    );
    return false;
  } catch (error) {
    if (error instanceof CapabilityError || error instanceof NotFoundError) return true;
    throw error;
  }
}

/** How one entry fared against the live row. */
type EntryOutcome = 'ok' | 'conflicting' | 'denied';

async function screenObjectEntry(
  context: ReplayPreflightContext,
  entry: Extract<CommandEntry, { kind: 'object' }>,
  row: ObjectRow,
): Promise<EntryOutcome> {
  const undoing = context.direction === 'undo';
  const expected = undoing ? entry.after : entry.before;
  if (normalizeProperty(entry.property, row[entry.property]) !== expected) return 'conflicting';
  const target = undoing ? entry.before : entry.after;
  return (await objectTargetUnreachable(context, entry.property, target, row)) ? 'denied' : 'ok';
}

function screenRelationEntry(
  context: ReplayPreflightContext,
  entry: ObjectCommandRelationReceiptEntry,
): EntryOutcome {
  if (relationTargetUnreachable(context, entry)) return 'denied';
  const expected = context.direction === 'undo' ? entry.after : entry.before;
  return context.relationFacts.existing.has(replayRelationKey(entry)) === expected
    ? 'ok'
    : 'conflicting';
}

/** Compare each entry against the live row and mark the object on the first mismatch. */
async function screenEntries(
  context: ReplayPreflightContext,
  objectId: string,
  entries: readonly CommandEntry[],
  row: ObjectRow,
): Promise<void> {
  for (const entry of entries) {
    validateReceiptEntryShape(context.receipt, entry);
    const outcome =
      entry.kind === 'object'
        ? await screenObjectEntry(context, entry, row)
        : screenRelationEntry(context, entry);
    if (outcome === 'conflicting') {
      context.conflicting.add(objectId);
      return;
    }
    if (outcome === 'denied') {
      context.denied.add(objectId);
      return;
    }
  }
}

/** Status resolutions reused across the objects of one replay. */
interface StatusCaches {
  readonly task: Map<string, Awaited<ReturnType<typeof resolveTaskStatus>>>;
  readonly project: Map<string, Awaited<ReturnType<typeof resolveContainerStatus>>>;
}

async function assertTaskStatusTarget(
  context: ReplayPreflightContext,
  row: ObjectRow,
  targets: EntryTargets,
  caches: StatusCaches,
): Promise<void> {
  if (targets.of('state') === undefined) return;
  const { database: tx, orgId } = context.scope;
  const teamId = String(row['teamId']);
  const state = String(targets.of('state'));
  const cacheKey = `${teamId}:${state}`;
  const status =
    caches.task.get(cacheKey) ?? (await resolveTaskStatus(orgId, teamId, state, 'state', tx));
  caches.task.set(cacheKey, status);
  if (
    targets.of('state') !== status.state ||
    targets.of('statusId') !== status.statusId ||
    (targets.of('completedAt') === null) !== (status.completedAt === null) ||
    (targets.of('canceledAt') === null) !== (status.canceledAt === null)
  ) {
    throw ownedValidation('Receipt contains an invalid Task status transition');
  }
}

async function assertProjectStatusTarget(
  context: ReplayPreflightContext,
  targets: EntryTargets,
  caches: StatusCaches,
): Promise<void> {
  if (targets.of('status') === undefined) return;
  const { database: tx, orgId } = context.scope;
  const cacheKey = String(targets.of('status'));
  const status =
    caches.project.get(cacheKey) ??
    (await resolveContainerStatus(orgId, 'project', cacheKey, 'status', tx));
  caches.project.set(cacheKey, status);
  if (targets.of('status') !== status.status || targets.of('statusId') !== status.statusId) {
    throw ownedValidation('Receipt contains an invalid Project status transition');
  }
}

/** Whether the Task this replay would produce violates an invariant the live row must keep. */
async function taskReplayConflicts(
  context: ReplayPreflightContext,
  objectId: string,
  row: ObjectRow,
  targets: EntryTargets,
): Promise<boolean> {
  const { database: tx, orgId } = context.scope;
  const nextProject = targets.has('projectId') ? targets.of('projectId') : row['projectId'];
  const nextMilestone = targets.has('milestoneId') ? targets.of('milestoneId') : row['milestoneId'];
  await assertMilestoneForProject(
    tx,
    orgId,
    receiptId(nextMilestone, 'milestone reference'),
    receiptId(nextProject, 'Project reference'),
  );
  const nextStart = targets.has('startDate')
    ? targets.of('startDate')
    : normalizeProperty('startDate', row['startDate']);
  const nextDue = targets.has('dueDate')
    ? targets.of('dueDate')
    : normalizeProperty('dueDate', row['dueDate']);
  if (typeof nextStart === 'string' && typeof nextDue === 'string' && nextDue < nextStart) {
    return true;
  }
  const parent = targets.of('parentTaskId');
  if (typeof parent !== 'string') return false;
  if (parent === objectId) throw ownedValidation('A task cannot be its own parent');
  return taskParentWouldCycle(tx, orgId, objectId, parent);
}

function projectReplayConflicts(row: ObjectRow, targets: EntryTargets): boolean {
  const nextStart = targets.has('startDate')
    ? targets.of('startDate')
    : normalize(row['startDate']);
  const nextTarget = targets.has('targetDate')
    ? targets.of('targetDate')
    : normalize(row['targetDate']);
  try {
    assertPlanningDateRange(
      nextStart === null ? null : new Date(String(nextStart)),
      nextTarget === null ? null : new Date(String(nextTarget)),
    );
    return false;
  } catch {
    return true;
  }
}

/** Where a Label move leaves the object: reachable, out of reach, or overtaken by a collaborator. */
function labelReplayOutcome(
  context: ReplayPreflightContext,
  objectId: string,
  entries: readonly CommandEntry[],
  row: ObjectRow,
): 'ok' | 'denied' | 'conflicting' {
  const { direction, relationFacts } = context;
  const labelEntries = entries.filter(
    (entry): entry is ObjectCommandRelationReceiptEntry =>
      entry.kind === 'relation' && entry.relation === 'label',
  );
  const attaches = labelEntries.some((entry) =>
    direction === 'undo' ? entry.before : entry.after,
  );
  if (!attaches) return 'ok';
  const targetIds = new Set(relationFacts.attachedLabelIdsByObject.get(objectId) ?? []);
  for (const entry of labelEntries) {
    const target = direction === 'undo' ? entry.before : entry.after;
    if (target) targetIds.add(entry.relatedId);
    else targetIds.delete(entry.relatedId);
  }
  const teamId = receiptId(row['teamId'], 'Team reference');
  const resolved = [...targetIds].map((id) => relationFacts.labelsById.get(id));
  if (
    resolved.some((item) => item === undefined || (item.teamId !== null && item.teamId !== teamId))
  ) {
    return 'denied';
  }
  const kept = applyExclusivity(
    resolved.filter((item): item is NonNullable<typeof item> => item !== undefined),
  );
  return kept.length === targetIds.size ? 'ok' : 'conflicting';
}

async function preflightObject(
  context: ReplayPreflightContext,
  objectId: string,
  entries: readonly CommandEntry[],
  caches: StatusCaches,
): Promise<void> {
  const { conflicting, denied, receipt } = context;
  const row = context.lockedById.get(objectId);
  if (!row || objectUnreachable(context, objectId, entries)) {
    denied.add(objectId);
    return;
  }
  await screenEntries(context, objectId, entries, row);
  if (conflicting.has(objectId) || denied.has(objectId)) return;
  const targets = entryTargets(entries, context.direction);
  if (receipt.objectKind === 'task') {
    await assertTaskStatusTarget(context, row, targets, caches);
  } else {
    await assertProjectStatusTarget(context, targets, caches);
  }
  const conflicts =
    receipt.objectKind === 'task'
      ? await taskReplayConflicts(context, objectId, row, targets)
      : projectReplayConflicts(row, targets);
  if (conflicts) {
    conflicting.add(objectId);
    return;
  }
  const outcome = labelReplayOutcome(context, objectId, entries, row);
  if (outcome === 'denied') denied.add(objectId);
  if (outcome === 'conflicting') conflicting.add(objectId);
}

/** Mark every object a replay cannot touch before any of them is written. */
export async function preflightReplay(
  context: ReplayPreflightContext,
  entriesByObject: ReadonlyMap<string, CommandEntry[]>,
): Promise<void> {
  const caches: StatusCaches = { task: new Map(), project: new Map() };
  for (const [objectId, entries] of entriesByObject) {
    await preflightObject(context, objectId, entries, caches);
  }
}
