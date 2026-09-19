/** Forward handlers for the operations that rewrite object columns. */
import { organization, project, task } from '@docket/db';
import type { DateResolution } from '@docket/work/planning-timeframe';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import type { ObjectCommandIn, ObjectCommandValue } from '../../contracts/object-command';
import { ConflictError, NotFoundError } from '../../error';
import { assertPlanningDateRange, planningDatePatch } from '../planning-timeframe';
import { closeCompletingUserTaskTimersBatch } from '../task-state';
import { resolveContainerStatus, resolveTaskStatus } from '../work-status';
import { assertResourceCapability } from './capabilities';
import { recordTaskFieldChanges } from './effects';
import { taskParentWouldCycleAny } from './graph-cycles';
import { updateTaskStatuses, type ObjectPatch } from './object-writes';
import { ownedValidation } from './receipt-validator';
import type { CommandEntry, ForwardContext, Tx } from './types';
import { dbValue, normalize, normalizeProperty } from './value-transform';

type TaskRow = typeof task.$inferSelect;
type ProjectRow = typeof project.$inferSelect;
type TaskStatusResolution = Awaited<ReturnType<typeof resolveTaskStatus>>;
type ProjectStatusResolution = Awaited<ReturnType<typeof resolveContainerStatus>>;
type PropertyOperation = Extract<
  ObjectCommandIn['operation'],
  { type: 'replace_property' | 'trash' | 'restore' | 'change_parent' }
>;

const TASK_STATUS_TUPLE = ['state', 'statusId', 'completedAt', 'canceledAt'];
const PROJECT_STATUS_TUPLE = ['status', 'statusId'];

/** Whether a command operation rewrites object columns rather than edges. */
export function isPropertyOperation(operation: ObjectCommandIn['operation']): boolean {
  return ['replace_property', 'trash', 'restore', 'change_parent'].includes(operation.type);
}

/** The single column an operation names, with terminal and hierarchy moves mapped to theirs. */
function operationProperty(op: PropertyOperation): string {
  switch (op.type) {
    case 'replace_property':
      return op.property;
    case 'change_parent':
      return 'parentTaskId';
    default:
      return 'archivedAt';
  }
}

/** The value an operation writes, with a trash stamping now and a restore clearing the column. */
function operationValue(op: PropertyOperation): unknown {
  switch (op.type) {
    case 'replace_property':
      return op.value;
    case 'change_parent':
      return op.parentId;
    case 'trash':
      return new Date().toISOString();
    default:
      return null;
  }
}

/** Build the receipt entries for one object's changed columns. */
function objectEntries(
  objectId: string,
  properties: readonly string[],
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  normalizer: (property: string, value: unknown) => ObjectCommandValue,
): CommandEntry[] {
  return properties.map((property) => ({
    kind: 'object',
    objectId,
    property,
    before: normalizer(property, before[property]),
    after: normalizer(property, after[property]),
  }));
}

/** Pull the changed columns out of a row or patch for the audit record. */
function auditFields(
  source: Record<string, unknown>,
  properties: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(properties.map((property) => [property, source[property]]));
}

function auditOperation(op: PropertyOperation, property: string): 'archive' | 'update' {
  return property === 'archivedAt' && op.type === 'trash' ? 'archive' : 'update';
}

/** Require a live, reachable parent that reparenting this selection would not put in a cycle. */
async function assertParentAssignable(context: ForwardContext, parentId: string): Promise<void> {
  const { scope, command } = context;
  const { database: tx, orgId } = scope;
  const parents = await tx
    .select()
    .from(task)
    .where(and(eq(task.organizationId, orgId), eq(task.id, parentId), isNull(task.archivedAt)));
  if (!parents[0]) throw new NotFoundError('Task not found');
  await assertResourceCapability(scope, 'task', parents[0].id, 'contribute');
  if (new Set<string>(command.objectIds).has(parentId)) {
    throw ownedValidation('A task cannot be its own parent', ['operation', 'parentId']);
  }
  if (await taskParentWouldCycleAny(tx, orgId, command.objectIds, parentId)) {
    throw new ConflictError('Task hierarchy would contain a cycle');
  }
}

async function resolveTaskStatusByTeam(
  tx: Tx,
  orgId: string,
  rows: readonly TaskRow[],
  value: unknown,
): Promise<ReadonlyMap<string, TaskStatusResolution>> {
  if (typeof value !== 'string') throw ownedValidation('Task state must be a string');
  const statusByTeam = new Map<string, TaskStatusResolution>();
  for (const teamId of new Set(rows.map((row) => row.teamId))) {
    statusByTeam.set(teamId, await resolveTaskStatus(orgId, teamId, value, 'state', tx));
  }
  return statusByTeam;
}

function taskPatch(
  row: TaskRow,
  property: string,
  value: unknown,
  statusByTeam: ReadonlyMap<string, TaskStatusResolution>,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    [property]: dbValue(property, normalizeProperty(property, value)),
  };
  if (property === 'state') {
    const status = statusByTeam.get(row.teamId);
    if (!status) throw new NotFoundError('Task status not found');
    patch['state'] = status.state;
    patch['statusId'] = status.statusId;
    patch['completedAt'] = status.completedAt;
    patch['canceledAt'] = status.canceledAt;
  }
  const nextStart = property === 'startDate' ? (patch['startDate'] as Date | null) : row.startDate;
  const nextDue = property === 'dueDate' ? (patch['dueDate'] as Date | null) : row.dueDate;
  if (nextStart && nextDue && nextDue < nextStart) {
    throw ownedValidation('Due date cannot fall before the anticipated start date');
  }
  return patch;
}

/**
 * Run the Task write. A status move carries per-row values, so it goes through the recordset
 * update; every other property writes one identical patch across the whole selection.
 */
async function executeTaskWrites(
  tx: Tx,
  orgId: string,
  property: string,
  writes: readonly ObjectPatch[],
): Promise<ReadonlyMap<string, TaskRow>> {
  const updateUniformly = async (): Promise<TaskRow[]> =>
    writes.length === 0
      ? []
      : tx
          .update(task)
          .set(writes[0]?.patch ?? {})
          .where(
            and(
              eq(task.organizationId, orgId),
              inArray(
                task.id,
                writes.map((write) => write.id),
              ),
            ),
          )
          .returning();
  const updatedRows =
    property === 'state' ? await updateTaskStatuses(tx, orgId, writes) : await updateUniformly();
  if (updatedRows.length !== writes.length) throw new ConflictError('Task changed during update');
  return new Map(updatedRows.map((row) => [row.id, row]));
}

async function applyTaskPropertyWrites(
  context: ForwardContext,
  rows: readonly TaskRow[],
  property: string,
  value: unknown,
): Promise<void> {
  const { scope, entries, audit, effects } = context;
  const { database: tx, orgId, actorId } = scope;
  const op = context.command.operation as PropertyOperation;
  const statusByTeam =
    property === 'state'
      ? await resolveTaskStatusByTeam(tx, orgId, rows, value)
      : new Map<string, TaskStatusResolution>();
  const changedProperties = property === 'state' ? TASK_STATUS_TUPLE : [property];
  const writes: { id: string; patch: Record<string, unknown>; before: TaskRow }[] = [];
  for (const row of rows) {
    const patch = taskPatch(row, property, value, statusByTeam);
    entries.push(...objectEntries(row.id, changedProperties, row, patch, normalizeProperty));
    audit.push({
      kind: 'task',
      id: row.id,
      op: auditOperation(op, property),
      before: auditFields(row, changedProperties),
      after: auditFields(patch, changedProperties),
    });
    writes.push({ id: row.id, patch, before: row });
  }
  const updatedById = await executeTaskWrites(tx, orgId, property, writes);
  const changedTasks: { before: TaskRow; after: TaskRow }[] = [];
  for (const write of writes) {
    const updated = updatedById.get(write.id);
    if (!updated) throw new ConflictError('Task changed during update');
    if (property === 'state') {
      effects.taskStateMutations.push({ before: write.before, after: updated });
    } else {
      changedTasks.push({ before: write.before, after: updated });
    }
  }
  effects.timerStops.push(
    ...(await closeCompletingUserTaskTimersBatch(tx, actorId, effects.taskStateMutations)),
  );
  await recordTaskFieldChanges(scope, effects, [...effects.taskStateMutations, ...changedTasks]);
}

async function organizationFiscalYearStartMonth(tx: Tx, orgId: string): Promise<number> {
  const [settings] = await tx
    .select({ fiscalYearStartMonth: organization.fiscalYearStartMonth })
    .from(organization)
    .where(eq(organization.id, orgId))
    .limit(1);
  if (!settings) throw new NotFoundError('Organization not found');
  return settings.fiscalYearStartMonth;
}

/** Build the three-column patch a Project timeframe move writes, and range-check the result. */
function timeframePatch(
  row: ProjectRow,
  property: 'startTimeframe' | 'targetTimeframe',
  value: unknown,
  fiscalYearStartMonth: number,
): { readonly patch: Record<string, unknown>; readonly properties: readonly string[] } {
  const timeframe = value as { date: string | null; resolution: DateResolution | null };
  const isStart = property === 'startTimeframe';
  const dateProperty = isStart ? 'startDate' : 'targetDate';
  const resolutionProperty = isStart ? 'startDateResolution' : 'targetDateResolution';
  const fiscalProperty = isStart
    ? 'startDateFiscalYearStartMonth'
    : 'targetDateFiscalYearStartMonth';
  const planned = planningDatePatch(
    { date: timeframe.date, resolution: timeframe.resolution },
    fiscalYearStartMonth,
    isStart ? 'start' : 'target',
    dateProperty,
    resolutionProperty,
  );
  if (!planned) throw ownedValidation('Timeframe value is required');
  assertPlanningDateRange(
    isStart ? planned.date : row.startDate,
    isStart ? row.targetDate : planned.date,
  );
  return {
    patch: {
      [dateProperty]: planned.date,
      [resolutionProperty]: planned.resolution,
      [fiscalProperty]: planned.fiscalYearStartMonth,
    },
    properties: [dateProperty, resolutionProperty, fiscalProperty],
  };
}

function projectPatch(
  property: string,
  value: unknown,
  resolvedStatus: ProjectStatusResolution | null,
): Record<string, unknown> {
  const patch: Record<string, unknown> = { [property]: dbValue(property, normalize(value)) };
  if (property === 'status') {
    if (!resolvedStatus) throw new NotFoundError('Project status not found');
    patch['status'] = resolvedStatus.status;
    patch['statusId'] = resolvedStatus.statusId;
  }
  return patch;
}

async function executeProjectWrites(
  tx: Tx,
  orgId: string,
  writes: readonly { readonly id: string; readonly patch: Record<string, unknown> }[],
  statusChanged: boolean,
): Promise<readonly ProjectRow[]> {
  const updatedRows =
    writes.length === 0
      ? []
      : await tx
          .update(project)
          .set(writes[0]?.patch ?? {})
          .where(
            and(
              eq(project.organizationId, orgId),
              inArray(
                project.id,
                writes.map((write) => write.id),
              ),
            ),
          )
          .returning();
  if (updatedRows.length !== writes.length)
    throw new ConflictError('Project changed during update');
  return statusChanged ? updatedRows : [];
}

function pushProjectTimeframeChange(
  context: ForwardContext,
  row: ProjectRow,
  built: { readonly patch: Record<string, unknown>; readonly properties: readonly string[] },
): void {
  const { entries, audit } = context;
  entries.push(
    ...objectEntries(row.id, built.properties, row, built.patch, (_property, value) =>
      normalize(value),
    ),
  );
  audit.push({
    kind: 'project',
    id: row.id,
    op: 'update',
    before: auditFields(row, built.properties),
    after: auditFields(built.patch, built.properties),
  });
}

async function resolveProjectStatus(
  tx: Tx,
  orgId: string,
  value: unknown,
): Promise<ProjectStatusResolution> {
  if (typeof value !== 'string') throw ownedValidation('Project status must be a string');
  return resolveContainerStatus(orgId, 'project', value, 'status', tx);
}

async function applyProjectPropertyWrites(
  context: ForwardContext,
  rows: readonly ProjectRow[],
  property: string,
  value: unknown,
): Promise<void> {
  const { scope, entries, audit, effects } = context;
  const { database: tx, orgId } = scope;
  const op = context.command.operation as PropertyOperation;
  const fiscalYearStartMonth = await organizationFiscalYearStartMonth(tx, orgId);
  const resolvedStatus =
    property === 'status' ? await resolveProjectStatus(tx, orgId, value) : null;
  const isTimeframe = property === 'startTimeframe' || property === 'targetTimeframe';
  const changedProperties = property === 'status' ? PROJECT_STATUS_TUPLE : [property];
  const writes: { id: string; patch: Record<string, unknown> }[] = [];
  for (const row of rows) {
    if (isTimeframe) {
      const built = timeframePatch(row, property, value, fiscalYearStartMonth);
      pushProjectTimeframeChange(context, row, built);
      writes.push({ id: row.id, patch: built.patch });
      continue;
    }
    const patch = projectPatch(property, value, resolvedStatus);
    entries.push(...objectEntries(row.id, changedProperties, row, patch, normalizeProperty));
    audit.push({
      kind: 'project',
      id: row.id,
      op: auditOperation(op, property),
      before: auditFields(row, changedProperties),
      after: auditFields(patch, changedProperties),
    });
    writes.push({ id: row.id, patch });
  }
  effects.projectStatusRows.push(
    ...(await executeProjectWrites(tx, orgId, writes, property === 'status')),
  );
}

/** Apply a replace_property, trash, restore, or change_parent command to the locked rows. */
export async function applyPropertyOperation(
  context: ForwardContext,
  rows: readonly (TaskRow | ProjectRow)[],
): Promise<void> {
  const op = context.command.operation as PropertyOperation;
  const property = operationProperty(op);
  const value = operationValue(op);
  if (op.type === 'change_parent' && op.parentId !== null) {
    await assertParentAssignable(context, op.parentId);
  }
  if (context.command.objectKind === 'task') {
    await applyTaskPropertyWrites(context, rows as readonly TaskRow[], property, value);
    return;
  }
  await applyProjectPropertyWrites(context, rows as readonly ProjectRow[], property, value);
}
