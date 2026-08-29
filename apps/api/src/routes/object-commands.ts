/** Organization-scoped transactional object commands and conflict-safe receipt replay. */
import {
  actor,
  changeSet,
  changeSetEntry,
  cycle,
  db,
  initiative,
  initiativeProject,
  label,
  milestone,
  organization,
  program,
  project,
  projectDependency,
  projectLabel,
  task,
  taskDependency,
  taskLabel,
  team,
} from '@docket/db';
import {
  ObjectCommandReplayAccessIn,
  ObjectCommandReplayAccessResult,
  ObjectCommandRequest,
  ObjectCommandResult,
  type ObjectCommandIn,
  type ObjectCommandReceipt,
  type ObjectCommandRelationReceiptEntry,
  type ObjectCommandRequest as ObjectCommandRequestValue,
  type ObjectCommandValue,
} from '@docket/types';
import {
  canActor,
  canActorBatch,
  CAPABILITY_RANK,
  type Capability,
  type ResourceKind,
} from '@docket/authz';
import type { DateResolution } from '@docket/work/planning-timeframe';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';

import type { AppEnv } from '../context';
import {
  CapabilityError,
  ConflictError,
  NotFoundError,
  PayloadTooLargeError,
  ValidationError,
} from '../error';
import { deferAfterResponse } from '../lib/after-response';
import { completeIdempotencyInTransaction, type IdempotencyClaim } from '../lib/idempotency';
import {
  enqueueObjectCommandEffectJob,
  processObjectCommandEffectJobs,
  type ObjectCommandEffect,
} from '../lib/object-command-effects';
import { assertPlanningDateRange, planningDatePatch } from '../lib/planning-timeframe';
import { applyExclusivity, resolveLabelCatalog, type ResolvedLabel } from '../lib/labels';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { MAX_OBJECT_COMMAND_BYTES } from '../lib/http-limits';
import { rawResultRowCount } from '../lib/raw-result';
import { assertSharedWorkWritable } from '../product-capability';
import { serializableTx } from '../lib/serializable-tx';
import { zJson } from '../lib/validate';
import {
  edgeKey,
  objectCommandChangeSetId,
  recordChangeSetInTx,
  type RecordedChange,
} from '../mcp/change-set';
import { resolveContainerStatus, resolveTaskStatus } from '../lib/work-status';
import type { TaskStateMutation } from '../lib/task-state';
import {
  diffTaskFields,
  resolveTaskChangeLabelGroups,
  writeTaskChangeGroups,
  type RecordTaskChangesInput,
} from '../lib/task-audit';

type CommandEntry = ObjectCommandReceipt['entries'][number];

const TASK_PROPERTIES = new Set([
  'state',
  'statusId',
  'completedAt',
  'canceledAt',
  'priority',
  'assigneeId',
  'projectId',
  'programId',
  'milestoneId',
  'cycleId',
  'startDate',
  'dueDate',
  'estimate',
  'parentTaskId',
  'archivedAt',
]);
const PROJECT_PROPERTIES = new Set([
  'status',
  'statusId',
  'priority',
  'health',
  'leadId',
  'teamId',
  'programId',
  'startDate',
  'startDateResolution',
  'startDateFiscalYearStartMonth',
  'targetDate',
  'targetDateResolution',
  'targetDateFiscalYearStartMonth',
  'archivedAt',
]);

function ownedValidation(message: string, path: (string | number)[] = []): ValidationError {
  return new ValidationError(new z.ZodError([{ code: 'custom', path, message, input: undefined }]));
}

function normalize(value: unknown): ObjectCommandValue {
  if (value instanceof Date) return value.toISOString();
  if (value === undefined) return null;
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  throw new Error('Command receipt value was not scalar');
}

function normalizeProperty(property: string, value: unknown): ObjectCommandValue {
  if (value instanceof Date && ['startDate', 'dueDate'].includes(property)) {
    return value.toISOString().slice(0, 10);
  }
  return normalize(value);
}

function dbValue(property: string, value: ObjectCommandValue): unknown {
  if (
    value !== null &&
    ['startDate', 'dueDate', 'targetDate', 'archivedAt', 'completedAt', 'canceledAt'].includes(
      property,
    )
  ) {
    return new Date(String(value));
  }
  return value;
}

function validateReceiptEntryShape(receipt: ObjectCommandReceipt, entry: CommandEntry): void {
  const allowed = receipt.objectKind === 'task' ? TASK_PROPERTIES : PROJECT_PROPERTIES;
  if (entry.kind === 'object') {
    if (!allowed.has(entry.property)) {
      throw ownedValidation('Receipt contains an unsupported property');
    }
    if (entry.property === 'archivedAt' && !['trash', 'restore'].includes(receipt.action)) {
      throw ownedValidation('Receipt action does not match its archived field');
    }
    if (entry.property === 'parentTaskId' && receipt.action !== 'change_parent') {
      throw ownedValidation('Receipt action does not match its hierarchy field');
    }
    if (
      !['archivedAt', 'parentTaskId'].includes(entry.property) &&
      receipt.action !== 'replace_property'
    ) {
      throw ownedValidation('Receipt action does not match its property fields');
    }
    return;
  }
  if (entry.relation === 'initiative' && receipt.objectKind !== 'project') {
    throw ownedValidation('Receipt contains an unsupported relation');
  }
  if (entry.relation === 'dependency') {
    if (!['add_dependency', 'remove_dependency'].includes(receipt.action)) {
      throw ownedValidation('Receipt action does not match its dependency relation');
    }
    return;
  }
  if (!['add_association', 'remove_association'].includes(receipt.action)) {
    throw ownedValidation('Receipt action does not match its association relation');
  }
}

function assertReceiptStatusTupleShape(receipt: ObjectCommandReceipt): void {
  const properties =
    receipt.objectKind === 'task'
      ? ['state', 'statusId', 'completedAt', 'canceledAt']
      : ['status', 'statusId'];
  const propertySet = new Set(properties);
  const countsByObject = new Map<string, Map<string, number>>();
  for (const entry of receipt.entries) {
    if (entry.kind !== 'object' || !propertySet.has(entry.property)) continue;
    const counts = countsByObject.get(entry.objectId) ?? new Map<string, number>();
    counts.set(entry.property, (counts.get(entry.property) ?? 0) + 1);
    countsByObject.set(entry.objectId, counts);
  }
  for (const counts of countsByObject.values()) {
    if (
      receipt.action !== 'replace_property' ||
      properties.some((property) => counts.get(property) !== 1)
    ) {
      throw ownedValidation('Receipt contains an incomplete or duplicate status tuple');
    }
  }
}

function assertReceiptTimeframeTupleShape(receipt: ObjectCommandReceipt): void {
  if (receipt.objectKind !== 'project') return;
  for (const properties of [
    ['startDate', 'startDateResolution', 'startDateFiscalYearStartMonth'],
    ['targetDate', 'targetDateResolution', 'targetDateFiscalYearStartMonth'],
  ]) {
    const propertySet = new Set(properties);
    const countsByObject = new Map<string, Map<string, number>>();
    for (const entry of receipt.entries) {
      if (entry.kind !== 'object' || !propertySet.has(entry.property)) continue;
      const counts = countsByObject.get(entry.objectId) ?? new Map<string, number>();
      counts.set(entry.property, (counts.get(entry.property) ?? 0) + 1);
      countsByObject.set(entry.objectId, counts);
    }
    for (const counts of countsByObject.values()) {
      if (
        receipt.action !== 'replace_property' ||
        properties.some((property) => counts.get(property) !== 1)
      ) {
        throw ownedValidation('Receipt contains an incomplete or duplicate Project timeframe');
      }
    }
  }
}

function validateReplayReceipt(receipt: ObjectCommandReceipt): void {
  assertReceiptStatusTupleShape(receipt);
  assertReceiptTimeframeTupleShape(receipt);
  for (const entry of receipt.entries) validateReceiptEntryShape(receipt, entry);
}

interface ReplayRequirement {
  readonly kind: ResourceKind;
  readonly id: string;
  readonly capability: Capability;
}

function replayRequirementKey(kind: ResourceKind, id: string): string {
  return `${kind}:${id}`;
}

function replayReferenceRequirement(
  objectKind: ObjectCommandReceipt['objectKind'],
  property: string,
  target: ObjectCommandValue,
): ReplayRequirement | null {
  if (target === null) return null;
  const id = String(target);
  if (objectKind === 'task') {
    if (property === 'projectId') return { kind: 'project', id, capability: 'contribute' };
    if (property === 'programId') return { kind: 'program', id, capability: 'contribute' };
    if (property === 'parentTaskId') return { kind: 'task', id, capability: 'contribute' };
    return null;
  }
  if (property === 'teamId') return { kind: 'team', id, capability: 'contribute' };
  if (property === 'programId') return { kind: 'program', id, capability: 'contribute' };
  return null;
}

function replayRequirements(
  receipt: ObjectCommandReceipt,
  direction: 'undo' | 'redo',
): ReadonlyMap<string, ReplayRequirement> {
  const requiredByTarget = new Map<string, ReplayRequirement>();
  const addRequirement = (requirement: ReplayRequirement): void => {
    const key = replayRequirementKey(requirement.kind, requirement.id);
    const current = requiredByTarget.get(key);
    if (
      current === undefined ||
      CAPABILITY_RANK[requirement.capability] > CAPABILITY_RANK[current.capability]
    ) {
      requiredByTarget.set(key, requirement);
    }
  };
  for (const entry of receipt.entries) {
    let capability: Capability = 'contribute';
    if (
      entry.kind === 'object' &&
      receipt.objectKind === 'project' &&
      entry.property === 'archivedAt'
    ) {
      capability = 'manage';
    } else if (
      entry.kind === 'object' &&
      (entry.property === 'assigneeId' || entry.property === 'leadId')
    ) {
      capability = 'assign';
    }
    addRequirement({ kind: receipt.objectKind, id: entry.objectId, capability });
    if (entry.kind === 'relation' && entry.relation === 'dependency') {
      addRequirement({ kind: receipt.objectKind, id: entry.relatedId, capability: 'contribute' });
    }
    if (entry.kind === 'object') {
      const target = direction === 'undo' ? entry.before : entry.after;
      const reference = replayReferenceRequirement(receipt.objectKind, entry.property, target);
      if (reference !== null) addRequirement(reference);
    }
  }
  return requiredByTarget;
}

type ReplayAccessDecision = Awaited<ReturnType<typeof canActorBatch>>[number];

async function replayCapabilityByTarget(
  database: Dbh,
  orgId: string,
  actorId: string,
  requiredByTarget: ReadonlyMap<string, ReplayRequirement>,
): Promise<ReadonlyMap<string, ReplayAccessDecision>> {
  const capabilityByTarget = new Map<string, ReplayAccessDecision>();
  for (const required of ['contribute', 'assign', 'manage'] as const) {
    const targets = [...requiredByTarget.values()].filter(
      ({ capability }) => capability === required,
    );
    if (targets.length === 0) continue;
    const decisions = await canActorBatch(
      actorId,
      required,
      targets.map(({ kind, id }) => ({ kind, id, orgId })),
      database,
    );
    targets.forEach(({ kind, id }, index) => {
      const decision = decisions[index];
      if (decision) capabilityByTarget.set(replayRequirementKey(kind, id), decision);
    });
  }
  return capabilityByTarget;
}

function durableValueMatches(left: unknown, right: unknown): boolean {
  const normalized = (value: unknown): unknown =>
    value instanceof Date ? value.toISOString() : value;
  return normalized(left) === normalized(right);
}

function durablePropertyMatches(
  objectKind: 'task' | 'project',
  property: string,
  left: unknown,
  right: unknown,
): boolean {
  if (
    objectKind === 'task' &&
    ['startDate', 'dueDate'].includes(property) &&
    typeof left === 'string' &&
    typeof right === 'string'
  ) {
    return left.slice(0, 10) === right;
  }
  return durableValueMatches(left, right);
}

function durableRelationKind(
  objectKind: 'task' | 'project',
  relation: ObjectCommandRelationReceiptEntry['relation'],
): string {
  if (relation === 'dependency') return objectKind === 'task' ? 'blocks' : 'project_blocks';
  if (relation === 'initiative') return 'project_contributes_to';
  return objectKind === 'task' ? 'task_has_label' : 'project_has_label';
}

async function assertReceiptMatchesDurableChange(
  database: Dbh,
  orgId: string,
  actorId: string,
  receipt: ObjectCommandReceipt,
): Promise<void> {
  const durableId = objectCommandChangeSetId(orgId, actorId, receipt.commandId);
  const [set] = await database
    .select({ summary: changeSet.summary, origin: changeSet.origin })
    .from(changeSet)
    .where(
      and(
        eq(changeSet.id, durableId),
        eq(changeSet.organizationId, orgId),
        eq(changeSet.actorId, actorId),
      ),
    )
    .limit(1);
  if (set?.origin.tool !== 'canvas' || set.summary !== receipt.action.replaceAll('_', ' ')) {
    throw ownedValidation('Receipt does not match a recorded canvas command');
  }
  const recorded = await database
    .select()
    .from(changeSetEntry)
    .where(eq(changeSetEntry.changeSetId, durableId));
  const objectsByIdentity = new Map<string, (typeof recorded)[number]>();
  const relationsByIdentity = new Map<string, (typeof recorded)[number]>();
  for (const candidate of recorded) {
    for (const property of new Set([
      ...Object.keys(candidate.before ?? {}),
      ...Object.keys(candidate.after ?? {}),
    ])) {
      objectsByIdentity.set(`${candidate.entityKind}:${candidate.entityId}:${property}`, candidate);
    }
    relationsByIdentity.set(`${candidate.entityKind}:${candidate.entityId}`, candidate);
  }
  for (const entry of receipt.entries) {
    if (entry.kind === 'object') {
      const match = objectsByIdentity.get(
        `${receipt.objectKind}:${entry.objectId}:${entry.property}`,
      );
      if (
        !match?.before ||
        !match.after ||
        !Object.hasOwn(match.before, entry.property) ||
        !Object.hasOwn(match.after, entry.property) ||
        !durablePropertyMatches(
          receipt.objectKind,
          entry.property,
          match.before[entry.property],
          entry.before,
        ) ||
        !durablePropertyMatches(
          receipt.objectKind,
          entry.property,
          match.after[entry.property],
          entry.after,
        )
      ) {
        throw ownedValidation('Receipt differs from its recorded canvas command');
      }
      continue;
    }
    const match = relationsByIdentity.get(
      `${durableRelationKind(receipt.objectKind, entry.relation)}:${edgeKey(entry.objectId, entry.relatedId)}`,
    );
    const beforeEdge = match?.before;
    const afterEdge = match?.after;
    const edge = afterEdge ?? beforeEdge;
    if (
      !match ||
      edge?.['from'] !== entry.objectId ||
      edge['to'] !== entry.relatedId ||
      Boolean(beforeEdge) !== entry.before ||
      Boolean(afterEdge) !== entry.after
    ) {
      throw ownedValidation('Receipt differs from its recorded canvas command');
    }
  }
}

function receiptId(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value === 'string') return value;
  throw ownedValidation(`Receipt contains an invalid ${field}`);
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Dbh = typeof db | Tx;

interface CommandEffects {
  readonly taskStateMutations: TaskStateMutation[];
  readonly taskFieldChanges: (RecordTaskChangesInput & { readonly assignmentChanged: boolean })[];
  readonly projectStatusRows: (typeof project.$inferSelect)[];
}

interface CommandExecution {
  readonly result: z.input<typeof ObjectCommandResult>;
  readonly effects: CommandEffects;
}

function objectCommandEffects(
  request: ObjectCommandRequestValue,
  execution: CommandExecution,
): ObjectCommandEffect[] {
  const { result, effects } = execution;
  const changedIds = new Set(result.receipt.entries.map((entry) => entry.objectId));
  const archivedById = new Map<string, boolean>();
  for (const entry of result.receipt.entries) {
    if (entry.kind !== 'object' || entry.property !== 'archivedAt') continue;
    const target =
      'direction' in request && request.direction === 'undo' ? entry.before : entry.after;
    archivedById.set(entry.objectId, target !== null);
  }
  return [
    ...effects.taskStateMutations.map((mutation): ObjectCommandEffect => ({
      kind: 'task_state',
      mutation,
    })),
    ...effects.taskFieldChanges.map((change): ObjectCommandEffect => ({
      kind: 'task_fields',
      change,
    })),
    ...effects.projectStatusRows.map((row): ObjectCommandEffect => ({
      kind: 'project_status',
      project: { id: row.id, name: row.name, status: row.status },
    })),
    ...[...changedIds].map((entityId): ObjectCommandEffect => ({
      kind: 'entity_write',
      sourceTable: result.receipt.objectKind,
      entityId,
      operation: archivedById.get(entityId) === true ? 'delete' : 'upsert',
    })),
  ];
}

function scheduleCommandEffects(): void {
  deferAfterResponse('object-command-consequences', async () => {
    await processObjectCommandEffectJobs({ limit: 10 });
  });
}

async function assertResourceCapability(
  database: Dbh,
  orgId: string,
  actorId: string,
  kind: ResourceKind,
  id: string,
  required: Capability,
): Promise<void> {
  const result = await canActor(actorId, required, { kind, id, orgId }, database);
  if (result.allow) return;
  if (result.effectiveCapability === null)
    throw new NotFoundError(`${kind.charAt(0).toUpperCase()}${kind.slice(1)} not found`);
  throw new CapabilityError();
}

async function assertResourceCapabilities(
  database: Dbh,
  orgId: string,
  actorId: string,
  kind: 'task' | 'project',
  ids: readonly string[],
  required: Capability,
): Promise<void> {
  const results = await canActorBatch(
    actorId,
    required,
    ids.map((id) => ({ kind, id, orgId })),
    database,
  );
  if (results.some((result) => !result.allow && result.effectiveCapability === null)) {
    throw new NotFoundError(`${kind === 'task' ? 'Task' : 'Project'} not found`);
  }
  if (results.some((result) => !result.allow)) throw new CapabilityError();
}

async function taskCycleWouldClose(
  database: Pick<typeof db, 'execute'>,
  orgId: string,
  blockingId: string,
  blockedId: string,
): Promise<boolean> {
  const result = await database.execute(sql`
    WITH RECURSIVE reach AS (
      SELECT blocked_task_id AS n FROM task_dependency
        WHERE blocking_task_id = ${blockedId} AND organization_id = ${orgId}
      UNION
      SELECT d.blocked_task_id FROM task_dependency d
        JOIN reach r ON d.blocking_task_id = r.n WHERE d.organization_id = ${orgId}
    )
    SELECT 1 AS hit FROM reach WHERE n = ${blockingId} LIMIT 1
  `);
  return rawResultRowCount(result) > 0;
}

async function projectCycleWouldClose(
  database: Pick<typeof db, 'execute'>,
  orgId: string,
  blockingId: string,
  blockedId: string,
): Promise<boolean> {
  const result = await database.execute(sql`
    WITH RECURSIVE reach AS (
      SELECT blocked_project_id AS n FROM project_dependency
        WHERE blocking_project_id = ${blockedId} AND organization_id = ${orgId}
      UNION
      SELECT d.blocked_project_id FROM project_dependency d
        JOIN reach r ON d.blocking_project_id = r.n WHERE d.organization_id = ${orgId}
    )
    SELECT 1 AS hit FROM reach WHERE n = ${blockingId} LIMIT 1
  `);
  return rawResultRowCount(result) > 0;
}

async function taskParentWouldCycle(
  database: Pick<typeof db, 'execute'>,
  orgId: string,
  taskId: string,
  parentId: string,
): Promise<boolean> {
  const result = await database.execute(sql`
    WITH RECURSIVE descendants AS (
      SELECT id FROM task WHERE parent_task_id = ${taskId} AND organization_id = ${orgId}
      UNION
      SELECT t.id FROM task t JOIN descendants d ON t.parent_task_id = d.id
        WHERE t.organization_id = ${orgId}
    ) SELECT 1 AS hit FROM descendants WHERE id = ${parentId} LIMIT 1
  `);
  return rawResultRowCount(result) > 0;
}

async function taskParentWouldCycleAny(
  database: Pick<typeof db, 'execute'>,
  orgId: string,
  taskIds: readonly string[],
  parentId: string,
): Promise<boolean> {
  const ids = sql.join(
    taskIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const result = await database.execute(sql`
    WITH RECURSIVE descendants AS (
      SELECT id FROM task WHERE organization_id = ${orgId} AND id IN (${ids})
      UNION
      SELECT child.id FROM task child
        JOIN descendants parent ON child.parent_task_id = parent.id
        WHERE child.organization_id = ${orgId}
    )
    SELECT 1 AS hit FROM descendants WHERE id = ${parentId} LIMIT 1
  `);
  return rawResultRowCount(result) > 0;
}

async function updateTaskStatuses(
  tx: Tx,
  orgId: string,
  writes: readonly {
    readonly id: string;
    readonly patch: Record<string, unknown>;
  }[],
): Promise<(typeof task.$inferSelect)[]> {
  if (writes.length === 0) return [];
  const payload = JSON.stringify(
    writes.map((write) => ({
      id: write.id,
      state: write.patch['state'],
      status_id: write.patch['statusId'],
      completed_at: write.patch['completedAt'],
      canceled_at: write.patch['canceledAt'],
    })),
  );
  const patches = sql`jsonb_to_recordset(${payload}::jsonb)
    AS status_patch(id text, state text, status_id text, completed_at timestamp, canceled_at timestamp)`;
  return tx
    .update(task)
    .set({
      state: sql`status_patch.state`,
      statusId: sql`status_patch.status_id`,
      completedAt: sql`status_patch.completed_at`,
      canceledAt: sql`status_patch.canceled_at`,
    })
    .from(patches)
    .where(
      and(
        eq(task.organizationId, orgId),
        isNull(task.archivedAt),
        sql`${task.id} = status_patch.id`,
      ),
    )
    .returning();
}

const REPLAY_INTEGER_PROPERTIES = new Set([
  'estimate',
  'startDateFiscalYearStartMonth',
  'targetDateFiscalYearStartMonth',
]);
const REPLAY_TIMESTAMP_PROPERTIES = new Set([
  'startDate',
  'dueDate',
  'targetDate',
  'archivedAt',
  'completedAt',
  'canceledAt',
]);

function replayPatchSource(
  kind: 'task' | 'project',
  updates: readonly { readonly id: string; readonly patch: Record<string, unknown> }[],
  properties: readonly string[],
): ReturnType<typeof sql> {
  const definitions = sql.join(
    [
      sql`${sql.identifier('id')} text`,
      ...properties.map((property) => {
        const type =
          property === 'priority'
            ? sql.raw('task_priority')
            : property === 'health'
              ? sql.raw('health')
              : ['startDateResolution', 'targetDateResolution'].includes(property)
                ? sql.raw('planning_date_resolution')
                : REPLAY_INTEGER_PROPERTIES.has(property)
                  ? sql.raw('integer')
                  : REPLAY_TIMESTAMP_PROPERTIES.has(property)
                    ? sql.raw('timestamp')
                    : sql.raw('text');
        return sql`${sql.identifier(property)} ${type}`;
      }),
    ],
    sql`, `,
  );
  return sql`jsonb_to_recordset(${JSON.stringify(
    updates.map((update) => ({ id: update.id, ...update.patch })),
  )}::jsonb) AS replay_patch(${definitions})`;
}

async function updateReplayObjects(
  tx: Tx,
  orgId: string,
  kind: 'task' | 'project',
  updates: readonly { readonly id: string; readonly patch: Record<string, unknown> }[],
): Promise<readonly (typeof task.$inferSelect | typeof project.$inferSelect)[]> {
  if (updates.length === 0) return [];
  const properties = [...new Set(updates.flatMap((update) => Object.keys(update.patch)))];
  const patch = Object.fromEntries(
    properties.map((property) => [property, sql`replay_patch.${sql.identifier(property)}`]),
  );
  const source = replayPatchSource(kind, updates, properties);
  return kind === 'task'
    ? tx
        .update(task)
        .set(patch)
        .from(source)
        .where(and(eq(task.organizationId, orgId), sql`${task.id} = replay_patch.id`))
        .returning()
    : tx
        .update(project)
        .set(patch)
        .from(source)
        .where(and(eq(project.organizationId, orgId), sql`${project.id} = replay_patch.id`))
        .returning();
}

async function assertActiveProject(database: Dbh, orgId: string, id: string | null): Promise<void> {
  if (id === null) return;
  const rows = await database
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.organizationId, orgId), eq(project.id, id), isNull(project.archivedAt)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError('Project not found');
}

async function assertMilestoneForProject(
  database: Dbh,
  orgId: string,
  milestoneId: string | null,
  projectId: string | null,
): Promise<void> {
  if (milestoneId === null) return;
  const rows = await database
    .select({ projectId: milestone.projectId })
    .from(milestone)
    .innerJoin(project, eq(milestone.projectId, project.id))
    .where(
      and(
        eq(milestone.id, milestoneId),
        eq(project.organizationId, orgId),
        isNull(project.archivedAt),
      ),
    )
    .limit(1);
  if (!rows[0]) throw new NotFoundError('Milestone not found');
  if (rows[0].projectId !== projectId) {
    throw ownedValidation("Milestone must belong to the task's project", ['operation', 'value']);
  }
}

async function assertMilestonesRemainInProject(
  database: Dbh,
  orgId: string,
  milestoneIds: readonly string[],
  projectId: string | null,
): Promise<void> {
  const ids = [...new Set(milestoneIds)];
  if (ids.length === 0) return;
  const rows = await database
    .select({ id: milestone.id, projectId: milestone.projectId })
    .from(milestone)
    .innerJoin(project, eq(milestone.projectId, project.id))
    .where(
      and(
        inArray(milestone.id, ids),
        eq(project.organizationId, orgId),
        isNull(project.archivedAt),
      ),
    );
  if (rows.length !== ids.length) throw new NotFoundError('Milestone not found');
  if (rows.some((row) => row.projectId !== projectId)) {
    throw ownedValidation("Milestone must belong to the task's project", ['operation', 'value']);
  }
}

async function assertReference(
  database: Dbh,
  table: typeof actor | typeof program | typeof cycle | typeof team,
  orgId: string,
  id: string | null,
  message: string,
): Promise<void> {
  if (id === null) return;
  const rows = await database
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.organizationId, orgId), eq(table.id, id)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError(message);
}

async function assertActiveHumanProjectLead(
  database: Dbh,
  orgId: string,
  id: string | null,
): Promise<void> {
  if (id === null) return;
  const rows = await database
    .select({ id: actor.id })
    .from(actor)
    .where(
      and(
        eq(actor.organizationId, orgId),
        eq(actor.id, id),
        eq(actor.kind, 'human'),
        eq(actor.status, 'active'),
        isNull(actor.archivedAt),
      ),
    )
    .limit(1);
  if (!rows[0]) throw new NotFoundError('Lead not found');
}

async function assertActiveTaskAssignee(
  database: Dbh,
  orgId: string,
  id: string | null,
): Promise<void> {
  if (id === null) return;
  const rows = await database
    .select({ id: actor.id })
    .from(actor)
    .where(
      and(
        eq(actor.organizationId, orgId),
        eq(actor.id, id),
        inArray(actor.kind, ['human', 'agent']),
        eq(actor.status, 'active'),
        isNull(actor.archivedAt),
      ),
    )
    .limit(1);
  if (!rows[0]) throw new NotFoundError('Assignee not found');
}

async function validateReferences(
  database: Dbh,
  orgId: string,
  actorId: string,
  command: ObjectCommandIn,
  rows: readonly (typeof task.$inferSelect | typeof project.$inferSelect)[],
): Promise<void> {
  const op = command.operation;
  if (op.type === 'replace_property') {
    if (command.objectKind === 'task') {
      if (op.property === 'assigneeId') await assertActiveTaskAssignee(database, orgId, op.value);
      if (op.property === 'projectId') {
        await assertActiveProject(database, orgId, op.value);
        if (op.value !== null) {
          await assertResourceCapability(
            database,
            orgId,
            actorId,
            'project',
            op.value,
            'contribute',
          );
        }
      }
      if (op.property === 'programId') {
        await assertReference(database, program, orgId, op.value, 'Program not found');
        if (op.value !== null) {
          await assertResourceCapability(
            database,
            orgId,
            actorId,
            'program',
            op.value,
            'contribute',
          );
        }
      }
      if (op.property === 'cycleId')
        await assertReference(database, cycle, orgId, op.value, 'Cycle not found');
      if (op.property === 'milestoneId') {
        if (op.value !== null) {
          const projectIds = new Set(
            (rows as readonly (typeof task.$inferSelect)[]).map((row) => row.projectId),
          );
          if (projectIds.size !== 1) {
            throw ownedValidation("Milestone must belong to the task's project", [
              'operation',
              'value',
            ]);
          }
          await assertMilestoneForProject(
            database,
            orgId,
            op.value,
            projectIds.values().next().value ?? null,
          );
        }
      }
      if (op.property === 'projectId') {
        await assertMilestonesRemainInProject(
          database,
          orgId,
          (rows as readonly (typeof task.$inferSelect)[])
            .map((row) => row.milestoneId)
            .filter((id): id is string => id !== null),
          op.value,
        );
      }
    } else {
      if (op.property === 'leadId') await assertActiveHumanProjectLead(database, orgId, op.value);
      if (op.property === 'teamId') {
        await assertReference(database, team, orgId, op.value, 'Team not found');
        if (op.value !== null) {
          await assertResourceCapability(database, orgId, actorId, 'team', op.value, 'contribute');
        }
      }
      if (op.property === 'programId') {
        await assertReference(database, program, orgId, op.value, 'Program not found');
        if (op.value !== null) {
          await assertResourceCapability(
            database,
            orgId,
            actorId,
            'program',
            op.value,
            'contribute',
          );
        }
      }
    }
  }
  if (op.type === 'add_association' || op.type === 'remove_association') {
    const table = op.association === 'label' ? label : initiative;
    const referenceRows = await database
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.organizationId, orgId), inArray(table.id, op.associationIds)));
    if (referenceRows.length !== new Set<string>(op.associationIds as string[]).size) {
      throw new NotFoundError(
        op.association === 'label' ? 'Label not found' : 'Initiative not found',
      );
    }
  }
}

async function executeForward(
  orgId: string,
  actorId: string,
  command: ObjectCommandIn,
  idempotencyClaim?: IdempotencyClaim,
): Promise<CommandExecution> {
  const apply = async (tx: Tx): Promise<CommandExecution> => {
    const effects: CommandEffects = {
      taskStateMutations: [],
      taskFieldChanges: [],
      projectStatusRows: [],
    };
    const rows =
      command.objectKind === 'task'
        ? await tx
            .select()
            .from(task)
            .where(and(eq(task.organizationId, orgId), inArray(task.id, command.objectIds)))
            .for('update')
        : await tx
            .select()
            .from(project)
            .where(and(eq(project.organizationId, orgId), inArray(project.id, command.objectIds)))
            .for('update');
    if (rows.length !== command.objectIds.length)
      throw new NotFoundError(`${command.objectKind === 'task' ? 'Task' : 'Project'} not found`);
    if (command.operation.type !== 'restore' && rows.some((row) => row.archivedAt !== null)) {
      throw new NotFoundError(`${command.objectKind === 'task' ? 'Task' : 'Project'} not found`);
    }
    await assertResourceCapabilities(
      tx,
      orgId,
      actorId,
      command.objectKind,
      rows.map((row) => row.id),
      command.objectKind === 'task' &&
        command.operation.type === 'replace_property' &&
        command.operation.property === 'assigneeId'
        ? 'assign'
        : command.objectKind === 'project' &&
            command.operation.type === 'replace_property' &&
            command.operation.property === 'leadId'
          ? 'assign'
          : command.objectKind === 'project' &&
              ['trash', 'restore'].includes(command.operation.type)
            ? 'manage'
            : 'contribute',
    );
    await validateReferences(tx, orgId, actorId, command, rows);
    await assertSharedWorkWritable(orgId, undefined, tx);

    const entries: CommandEntry[] = [];
    const audit: RecordedChange[] = [];
    const op = command.operation;

    if (
      op.type === 'replace_property' ||
      op.type === 'trash' ||
      op.type === 'restore' ||
      op.type === 'change_parent'
    ) {
      const property =
        op.type === 'replace_property'
          ? op.property
          : op.type === 'change_parent'
            ? 'parentTaskId'
            : 'archivedAt';
      const value =
        op.type === 'replace_property'
          ? op.value
          : op.type === 'change_parent'
            ? op.parentId
            : op.type === 'trash'
              ? new Date().toISOString()
              : null;
      if (op.type === 'change_parent' && op.parentId !== null) {
        const parents = await tx
          .select()
          .from(task)
          .where(
            and(eq(task.organizationId, orgId), eq(task.id, op.parentId), isNull(task.archivedAt)),
          );
        if (!parents[0]) throw new NotFoundError('Task not found');
        await assertResourceCapability(tx, orgId, actorId, 'task', parents[0].id, 'contribute');
        if (new Set<string>(command.objectIds).has(op.parentId)) {
          throw ownedValidation('A task cannot be its own parent', ['operation', 'parentId']);
        }
        if (await taskParentWouldCycleAny(tx, orgId, command.objectIds, op.parentId)) {
          throw new ConflictError('Task hierarchy would contain a cycle');
        }
      }
      if (command.objectKind === 'task') {
        const taskRows = rows as (typeof task.$inferSelect)[];
        const statusByTeam = new Map<string, Awaited<ReturnType<typeof resolveTaskStatus>>>();
        if (property === 'state') {
          if (typeof value !== 'string') throw ownedValidation('Task state must be a string');
          for (const teamId of new Set(taskRows.map((row) => row.teamId))) {
            statusByTeam.set(teamId, await resolveTaskStatus(orgId, teamId, value, 'state', tx));
          }
        }
        const writes: {
          id: string;
          patch: Record<string, unknown>;
          before: typeof task.$inferSelect;
        }[] = [];
        for (const row of taskRows) {
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
          const nextStart =
            property === 'startDate' ? (patch['startDate'] as Date | null) : row.startDate;
          const nextDue = property === 'dueDate' ? (patch['dueDate'] as Date | null) : row.dueDate;
          if (nextStart && nextDue && nextDue < nextStart)
            throw ownedValidation('Due date cannot fall before the anticipated start date');
          const changedProperties =
            property === 'state'
              ? (['state', 'statusId', 'completedAt', 'canceledAt'] as const)
              : ([property] as const);
          for (const changedProperty of changedProperties) {
            entries.push({
              kind: 'object',
              objectId: row.id,
              property: changedProperty,
              before: normalizeProperty(changedProperty, row[changedProperty as keyof typeof row]),
              after: normalizeProperty(changedProperty, patch[changedProperty]),
            });
          }
          audit.push({
            kind: 'task',
            id: row.id,
            op: property === 'archivedAt' && op.type === 'trash' ? 'archive' : 'update',
            before: {
              [property]: row[property as keyof typeof row],
              ...(property === 'state'
                ? {
                    statusId: row.statusId,
                    completedAt: row.completedAt,
                    canceledAt: row.canceledAt,
                  }
                : {}),
            },
            after: {
              [property]: patch[property],
              ...(property === 'state'
                ? {
                    statusId: patch['statusId'],
                    completedAt: patch['completedAt'],
                    canceledAt: patch['canceledAt'],
                  }
                : {}),
            },
          });
          writes.push({ id: row.id, patch, before: row });
        }
        const changedTasks: {
          before: typeof task.$inferSelect;
          after: typeof task.$inferSelect;
        }[] = [];
        const updatedRows =
          property === 'state'
            ? await updateTaskStatuses(tx, orgId, writes)
            : writes.length === 0
              ? []
              : await tx
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
        if (updatedRows.length !== writes.length) {
          throw new ConflictError('Task changed during update');
        }
        const updatedById = new Map(updatedRows.map((row) => [row.id, row]));
        for (const write of writes) {
          const updated = updatedById.get(write.id);
          if (!updated) throw new ConflictError('Task changed during update');
          if (property === 'state') {
            effects.taskStateMutations.push({ before: write.before, after: updated });
          } else {
            changedTasks.push({ before: write.before, after: updated });
          }
        }
        const auditedTasks = [...effects.taskStateMutations, ...changedTasks];
        const resolvedChanges = await resolveTaskChangeLabelGroups(
          orgId,
          auditedTasks.map(({ before, after }) => diffTaskFields(before, after)),
          tx,
        );
        const consequences = auditedTasks.map(({ before, after }, index) => {
          const changes = resolvedChanges[index] ?? [];
          const consequence: RecordTaskChangesInput & { readonly assignmentChanged: boolean } = {
            organizationId: orgId,
            taskId: after.id,
            title: after.title,
            actorId,
            changes,
            assignmentChanged: before.assigneeId !== after.assigneeId && after.assigneeId !== null,
          };
          return consequence;
        });
        await writeTaskChangeGroups(tx, consequences);
        effects.taskFieldChanges.push(...consequences);
      } else {
        const writes: {
          id: string;
          patch: Record<string, unknown>;
          statusChanged: boolean;
        }[] = [];
        const [settings] = await tx
          .select({ fiscalYearStartMonth: organization.fiscalYearStartMonth })
          .from(organization)
          .where(eq(organization.id, orgId))
          .limit(1);
        if (!settings) throw new NotFoundError('Organization not found');
        const resolvedProjectStatus =
          property === 'status'
            ? typeof value !== 'string'
              ? (() => {
                  throw ownedValidation('Project status must be a string');
                })()
              : await resolveContainerStatus(orgId, 'project', value, 'status', tx)
            : null;
        for (const row of rows as (typeof project.$inferSelect)[]) {
          if (property === 'startTimeframe' || property === 'targetTimeframe') {
            const timeframe = value as { date: string | null; resolution: DateResolution | null };
            const isStart = property === 'startTimeframe';
            const dateProperty = isStart ? 'startDate' : 'targetDate';
            const resolutionProperty = isStart ? 'startDateResolution' : 'targetDateResolution';
            const fiscalProperty = isStart
              ? 'startDateFiscalYearStartMonth'
              : 'targetDateFiscalYearStartMonth';
            const planned = planningDatePatch(
              { date: timeframe.date, resolution: timeframe.resolution },
              settings.fiscalYearStartMonth,
              isStart ? 'start' : 'target',
              dateProperty,
              resolutionProperty,
            );
            if (!planned) throw ownedValidation('Timeframe value is required');
            const patch = {
              [dateProperty]: planned.date,
              [resolutionProperty]: planned.resolution,
              [fiscalProperty]: planned.fiscalYearStartMonth,
            };
            assertPlanningDateRange(
              isStart ? planned.date : row.startDate,
              isStart ? row.targetDate : planned.date,
            );
            entries.push(
              {
                kind: 'object',
                objectId: row.id,
                property: dateProperty,
                before: normalize(row[dateProperty]),
                after: normalize(planned.date),
              },
              {
                kind: 'object',
                objectId: row.id,
                property: resolutionProperty,
                before: normalize(row[resolutionProperty]),
                after: normalize(planned.resolution),
              },
              {
                kind: 'object',
                objectId: row.id,
                property: fiscalProperty,
                before: normalize(row[fiscalProperty]),
                after: normalize(planned.fiscalYearStartMonth),
              },
            );
            audit.push({
              kind: 'project',
              id: row.id,
              op: 'update',
              before: {
                [dateProperty]: row[dateProperty],
                [resolutionProperty]: row[resolutionProperty],
                [fiscalProperty]: row[fiscalProperty],
              },
              after: {
                [dateProperty]: planned.date,
                [resolutionProperty]: planned.resolution,
                [fiscalProperty]: planned.fiscalYearStartMonth,
              },
            });
            writes.push({ id: row.id, patch, statusChanged: false });
            continue;
          }
          const patch: Record<string, unknown> = {
            [property]: dbValue(property, normalize(value)),
          };
          if (property === 'status') {
            if (!resolvedProjectStatus) throw new NotFoundError('Project status not found');
            patch['status'] = resolvedProjectStatus.status;
            patch['statusId'] = resolvedProjectStatus.statusId;
          }
          const changedProperties =
            property === 'status' ? (['status', 'statusId'] as const) : ([property] as const);
          for (const changedProperty of changedProperties) {
            entries.push({
              kind: 'object',
              objectId: row.id,
              property: changedProperty,
              before: normalizeProperty(changedProperty, row[changedProperty as keyof typeof row]),
              after: normalizeProperty(changedProperty, patch[changedProperty]),
            });
          }
          audit.push({
            kind: 'project',
            id: row.id,
            op: property === 'archivedAt' && op.type === 'trash' ? 'archive' : 'update',
            before: {
              [property]: row[property as keyof typeof row],
              ...(property === 'status' ? { statusId: row.statusId } : {}),
            },
            after: {
              [property]: patch[property],
              ...(property === 'status' ? { statusId: patch['statusId'] } : {}),
            },
          });
          writes.push({ id: row.id, patch, statusChanged: property === 'status' });
        }
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
        if (updatedRows.length !== writes.length) {
          throw new ConflictError('Project changed during update');
        }
        if (writes[0]?.statusChanged) {
          effects.projectStatusRows.push(...updatedRows);
        }
      }
    } else if (op.type === 'add_association' || op.type === 'remove_association') {
      const shouldExist = op.type === 'add_association';
      if (op.association === 'label') {
        const table = command.objectKind === 'task' ? taskLabel : projectLabel;
        const objectColumn =
          command.objectKind === 'task' ? taskLabel.taskId : projectLabel.projectId;
        const attached = await tx
          .select({ objectId: objectColumn, labelId: table.labelId })
          .from(table)
          .where(and(eq(table.organizationId, orgId), inArray(objectColumn, command.objectIds)));
        const catalog = await resolveLabelCatalog(
          orgId,
          [...new Set([...attached.map((edge) => edge.labelId), ...op.associationIds])],
          tx,
        );
        const labelsById = new Map(catalog.map((item) => [item.id, item]));
        const requested = op.associationIds.map((id) => labelsById.get(id));
        if (requested.some((item) => item === undefined))
          throw new NotFoundError('Label not found');
        const attachedByObject = new Map<string, string[]>();
        for (const edge of attached) {
          attachedByObject.set(edge.objectId, [
            ...(attachedByObject.get(edge.objectId) ?? []),
            edge.labelId,
          ]);
        }
        const requestedIds = new Set<string>(op.associationIds as readonly string[]);
        const added: { objectId: string; relatedId: string }[] = [];
        const removed: { objectId: string; relatedId: string }[] = [];
        for (const row of rows) {
          const existing = (attachedByObject.get(row.id) ?? [])
            .map((id) => labelsById.get(id))
            .filter((item): item is NonNullable<typeof item> => item !== undefined);
          const incoming = shouldExist
            ? requested.map((item) => {
                if (!item || (item.teamId !== null && item.teamId !== row.teamId)) {
                  throw new NotFoundError('Label not found');
                }
                return item;
              })
            : [];
          const next = shouldExist
            ? applyExclusivity([
                ...existing.filter((item) => !requestedIds.has(item.id)),
                ...incoming,
              ])
            : existing.filter((item) => !requestedIds.has(item.id));
          const beforeIds = new Set(existing.map((item) => item.id));
          const afterIds = new Set(next.map((item) => item.id));
          for (const relatedId of new Set([...beforeIds, ...afterIds])) {
            const before = beforeIds.has(relatedId);
            const after = afterIds.has(relatedId);
            if (before === after) continue;
            entries.push({
              kind: 'relation',
              objectId: row.id,
              relation: 'label',
              relatedId,
              before,
              after,
            });
            audit.push({
              kind: command.objectKind === 'task' ? 'task_has_label' : 'project_has_label',
              from: row.id,
              to: relatedId,
              linked: after,
            });
            (after ? added : removed).push({ objectId: row.id, relatedId });
          }
        }
        for (let offset = 0; offset < removed.length; offset += 250) {
          const batch = removed.slice(offset, offset + 250);
          const deleted = await tx
            .delete(table)
            .where(
              and(
                eq(table.organizationId, orgId),
                or(
                  ...batch.map((edge) =>
                    and(eq(objectColumn, edge.objectId), eq(table.labelId, edge.relatedId)),
                  ),
                ),
              ),
            )
            .returning();
          if (deleted.length !== batch.length) {
            throw new ConflictError('Label associations changed concurrently');
          }
        }
        for (let offset = 0; offset < added.length; offset += 250) {
          const batch = added.slice(offset, offset + 250);
          const inserted =
            command.objectKind === 'task'
              ? await tx
                  .insert(taskLabel)
                  .values(
                    batch.map((edge) => ({
                      organizationId: orgId,
                      taskId: edge.objectId,
                      labelId: edge.relatedId,
                    })),
                  )
                  .onConflictDoNothing()
                  .returning({ id: taskLabel.taskId })
              : await tx
                  .insert(projectLabel)
                  .values(
                    batch.map((edge) => ({
                      organizationId: orgId,
                      projectId: edge.objectId,
                      labelId: edge.relatedId,
                    })),
                  )
                  .onConflictDoNothing()
                  .returning({ id: projectLabel.projectId });
          if (inserted.length !== batch.length) {
            throw new ConflictError('Label associations changed concurrently');
          }
        }
      } else {
        const existing = await tx
          .select({
            projectId: initiativeProject.projectId,
            initiativeId: initiativeProject.initiativeId,
          })
          .from(initiativeProject)
          .where(
            and(
              eq(initiativeProject.organizationId, orgId),
              inArray(initiativeProject.projectId, command.objectIds),
              inArray(initiativeProject.initiativeId, op.associationIds),
            ),
          );
        const existingKeys = new Set(
          existing.map((edge) => edgeKey(edge.projectId, edge.initiativeId)),
        );
        const changed = command.objectIds.flatMap((objectId) =>
          op.associationIds.flatMap((relatedId) => {
            const existed = existingKeys.has(edgeKey(objectId, relatedId));
            return existed === shouldExist ? [] : [{ objectId, relatedId, existed }];
          }),
        );
        const batchSize = 250;
        for (let offset = 0; offset < changed.length; offset += batchSize) {
          const batch = changed.slice(offset, offset + batchSize);
          if (shouldExist) {
            const inserted = await tx
              .insert(initiativeProject)
              .values(
                batch.map((edge) => ({
                  organizationId: orgId,
                  projectId: edge.objectId,
                  initiativeId: edge.relatedId,
                })),
              )
              .onConflictDoNothing()
              .returning({ projectId: initiativeProject.projectId });
            if (inserted.length !== batch.length) {
              throw new ConflictError('Initiative associations changed concurrently');
            }
          } else {
            const deleted = await tx
              .delete(initiativeProject)
              .where(
                and(
                  eq(initiativeProject.organizationId, orgId),
                  or(
                    ...batch.map((edge) =>
                      and(
                        eq(initiativeProject.projectId, edge.objectId),
                        eq(initiativeProject.initiativeId, edge.relatedId),
                      ),
                    ),
                  ),
                ),
              )
              .returning({ projectId: initiativeProject.projectId });
            if (deleted.length !== batch.length) {
              throw new ConflictError('Initiative associations changed concurrently');
            }
          }
        }
        for (const edge of changed) {
          entries.push({
            kind: 'relation',
            objectId: edge.objectId,
            relation: 'initiative',
            relatedId: edge.relatedId,
            before: edge.existed,
            after: shouldExist,
          });
          audit.push({
            kind: 'project_contributes_to',
            from: edge.objectId,
            to: edge.relatedId,
            linked: shouldExist,
          });
        }
      }
    } else {
      const dependencyOp = op as {
        type: 'add_dependency' | 'remove_dependency';
        blockingId: string;
        blockedId: string;
      };
      if (dependencyOp.blockingId === dependencyOp.blockedId)
        throw ownedValidation('An object cannot depend on itself');
      const endpointIds = [dependencyOp.blockingId, dependencyOp.blockedId];
      const selectedIds = new Set<string>(command.objectIds as readonly string[]);
      if (
        selectedIds.size !== new Set(endpointIds).size ||
        endpointIds.some((id) => !selectedIds.has(id))
      ) {
        throw ownedValidation('Dependency endpoints must match the selected objects');
      }
      const endpointRows =
        command.objectKind === 'task'
          ? await tx
              .select({ id: task.id })
              .from(task)
              .where(
                and(
                  eq(task.organizationId, orgId),
                  inArray(task.id, endpointIds),
                  isNull(task.archivedAt),
                ),
              )
          : await tx
              .select({ id: project.id })
              .from(project)
              .where(
                and(
                  eq(project.organizationId, orgId),
                  inArray(project.id, endpointIds),
                  isNull(project.archivedAt),
                ),
              );
      if (endpointRows.length !== 2)
        throw new NotFoundError(`${command.objectKind === 'task' ? 'Task' : 'Project'} not found`);
      const shouldExist = dependencyOp.type === 'add_dependency';
      {
        const table = command.objectKind === 'task' ? taskDependency : projectDependency;
        const blocking =
          command.objectKind === 'task'
            ? taskDependency.blockingTaskId
            : projectDependency.blockingProjectId;
        const blocked =
          command.objectKind === 'task'
            ? taskDependency.blockedTaskId
            : projectDependency.blockedProjectId;
        const existing = await tx
          .select()
          .from(table)
          .where(
            and(
              eq(table.organizationId, orgId),
              eq(blocking, dependencyOp.blockingId),
              eq(blocked, dependencyOp.blockedId),
            ),
          )
          .limit(1);
        if (shouldExist && existing[0]) throw new ConflictError('Dependency edge already exists');
        if (!shouldExist && !existing[0]) throw new NotFoundError('Dependency edge not found');
        if (
          shouldExist &&
          (command.objectKind === 'task'
            ? await taskCycleWouldClose(tx, orgId, dependencyOp.blockingId, dependencyOp.blockedId)
            : await projectCycleWouldClose(
                tx,
                orgId,
                dependencyOp.blockingId,
                dependencyOp.blockedId,
              ))
        ) {
          throw new ConflictError('Dependency would contain a cycle');
        }
        if (shouldExist) {
          if (command.objectKind === 'task') {
            await tx.insert(taskDependency).values({
              organizationId: orgId,
              blockingTaskId: dependencyOp.blockingId,
              blockedTaskId: dependencyOp.blockedId,
            });
          } else {
            await tx.insert(projectDependency).values({
              organizationId: orgId,
              blockingProjectId: dependencyOp.blockingId,
              blockedProjectId: dependencyOp.blockedId,
            });
          }
        } else
          await tx
            .delete(table)
            .where(and(eq(blocking, dependencyOp.blockingId), eq(blocked, dependencyOp.blockedId)));
      }
      entries.push({
        kind: 'relation',
        objectId: dependencyOp.blockingId,
        relation: 'dependency',
        relatedId: dependencyOp.blockedId,
        before: !shouldExist,
        after: shouldExist,
      });
      audit.push({
        kind: command.objectKind === 'task' ? 'blocks' : 'project_blocks',
        from: dependencyOp.blockingId,
        to: dependencyOp.blockedId,
        linked: shouldExist,
      });
    }

    await recordChangeSetInTx(tx, {
      id: objectCommandChangeSetId(orgId, actorId, command.commandId),
      orgId,
      actorId,
      origin: { tool: 'canvas', client: 'web', sessionId: command.commandId },
      summary: command.operation.type.replaceAll('_', ' '),
      changes: audit,
      recordEmpty: true,
    });
    const result: z.input<typeof ObjectCommandResult> = {
      appliedIds: command.objectIds,
      conflictingIds: [],
      deniedIds: [],
      receipt: {
        commandId: command.commandId,
        objectKind: command.objectKind,
        action: command.operation.type,
        entries,
      },
    };
    const execution = { effects, result };
    await enqueueObjectCommandEffectJob(tx, {
      version: 1,
      organizationId: orgId,
      actorId,
      commandId: command.commandId,
      occurredAt: new Date().toISOString(),
      effects: objectCommandEffects(command, execution),
    });
    if (idempotencyClaim) {
      await completeIdempotencyInTransaction(tx, idempotencyClaim, {
        organizationId: orgId,
        responseStatus: 200,
        responseBody: result,
      });
    }
    return execution;
  };
  return serializableTx(apply);
}

function replayRelationKey(entry: ObjectCommandRelationReceiptEntry): string {
  return `${entry.relation}:${entry.objectId}:${entry.relatedId}`;
}

interface ReplayRelationFacts {
  readonly existing: ReadonlySet<string>;
  readonly targetIds: ReadonlySet<string>;
  readonly attachedLabelIdsByObject: ReadonlyMap<string, readonly string[]>;
  readonly labelsById: ReadonlyMap<string, ResolvedLabel & { readonly teamId: string | null }>;
}

async function loadReplayRelationFacts(
  tx: Tx,
  orgId: string,
  objectKind: 'task' | 'project',
  entries: readonly ObjectCommandRelationReceiptEntry[],
): Promise<ReplayRelationFacts> {
  const existing = new Set<string>();
  const targetIds = new Set<string>();
  const attachedLabelIdsByObject = new Map<string, string[]>();
  const labelsById = new Map<string, ResolvedLabel & { readonly teamId: string | null }>();
  const labelEntries = entries.filter((entry) => entry.relation === 'label');
  if (labelEntries.length > 0) {
    const objectIds = [...new Set(labelEntries.map((entry) => entry.objectId))];
    const requestedIds = new Set(labelEntries.map((entry) => entry.relatedId));
    const attached =
      objectKind === 'task'
        ? await tx
            .select({ objectId: taskLabel.taskId, labelId: taskLabel.labelId })
            .from(taskLabel)
            .where(and(eq(taskLabel.organizationId, orgId), inArray(taskLabel.taskId, objectIds)))
        : await tx
            .select({ objectId: projectLabel.projectId, labelId: projectLabel.labelId })
            .from(projectLabel)
            .where(
              and(
                eq(projectLabel.organizationId, orgId),
                inArray(projectLabel.projectId, objectIds),
              ),
            );
    for (const edge of attached) {
      attachedLabelIdsByObject.set(edge.objectId, [
        ...(attachedLabelIdsByObject.get(edge.objectId) ?? []),
        edge.labelId,
      ]);
      if (requestedIds.has(edge.labelId)) existing.add(`label:${edge.objectId}:${edge.labelId}`);
    }
    const catalog = await resolveLabelCatalog(
      orgId,
      [...new Set([...attached.map((edge) => edge.labelId), ...requestedIds])],
      tx,
    );
    for (const item of catalog) {
      labelsById.set(item.id, item);
      targetIds.add(`label:${item.id}`);
    }
  }

  const initiativeEntries = entries.filter((entry) => entry.relation === 'initiative');
  if (initiativeEntries.length > 0) {
    const objectIds = [...new Set(initiativeEntries.map((entry) => entry.objectId))];
    const relatedIds = [...new Set(initiativeEntries.map((entry) => entry.relatedId))];
    const [targets, attached] = await Promise.all([
      tx
        .select({ id: initiative.id })
        .from(initiative)
        .where(and(eq(initiative.organizationId, orgId), inArray(initiative.id, relatedIds))),
      tx
        .select({
          objectId: initiativeProject.projectId,
          relatedId: initiativeProject.initiativeId,
        })
        .from(initiativeProject)
        .where(
          and(
            eq(initiativeProject.organizationId, orgId),
            inArray(initiativeProject.projectId, objectIds),
            inArray(initiativeProject.initiativeId, relatedIds),
          ),
        ),
    ]);
    for (const row of targets) targetIds.add(`initiative:${row.id}`);
    for (const edge of attached) existing.add(`initiative:${edge.objectId}:${edge.relatedId}`);
  }

  const dependencyEntries = entries.filter((entry) => entry.relation === 'dependency');
  if (dependencyEntries.length > 0) {
    const objectIds = [...new Set(dependencyEntries.map((entry) => entry.objectId))];
    const relatedIds = [...new Set(dependencyEntries.map((entry) => entry.relatedId))];
    const attached =
      objectKind === 'task'
        ? await tx
            .select({
              objectId: taskDependency.blockingTaskId,
              relatedId: taskDependency.blockedTaskId,
            })
            .from(taskDependency)
            .where(
              and(
                eq(taskDependency.organizationId, orgId),
                inArray(taskDependency.blockingTaskId, objectIds),
                inArray(taskDependency.blockedTaskId, relatedIds),
              ),
            )
        : await tx
            .select({
              objectId: projectDependency.blockingProjectId,
              relatedId: projectDependency.blockedProjectId,
            })
            .from(projectDependency)
            .where(
              and(
                eq(projectDependency.organizationId, orgId),
                inArray(projectDependency.blockingProjectId, objectIds),
                inArray(projectDependency.blockedProjectId, relatedIds),
              ),
            );
    for (const edge of attached) existing.add(`dependency:${edge.objectId}:${edge.relatedId}`);
  }
  return { existing, targetIds, attachedLabelIdsByObject, labelsById };
}

async function applyReplayRelationEntries(
  tx: Tx,
  orgId: string,
  objectKind: 'task' | 'project',
  direction: 'undo' | 'redo',
  entries: readonly ObjectCommandRelationReceiptEntry[],
  conflicting: Set<string>,
): Promise<ObjectCommandRelationReceiptEntry[]> {
  const successfulKeys = new Set<string>();
  const groups = new Map<string, ObjectCommandRelationReceiptEntry[]>();
  for (const entry of entries) {
    const shouldExist = direction === 'undo' ? entry.before : entry.after;
    const key = `${entry.relation}:${shouldExist ? 'add' : 'remove'}`;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  const chunks = <T>(items: readonly T[]): T[][] => {
    const result: T[][] = [];
    for (let offset = 0; offset < items.length; offset += 250) {
      result.push(items.slice(offset, offset + 250));
    }
    return result;
  };
  const finish = (
    attempted: readonly ObjectCommandRelationReceiptEntry[],
    returnedKeys: ReadonlySet<string>,
  ): void => {
    for (const entry of attempted) {
      const key = replayRelationKey(entry);
      if (returnedKeys.has(key)) successfulKeys.add(key);
      else conflicting.add(entry.objectId);
    }
  };

  for (const action of ['add', 'remove'] as const) {
    const labelEntries = groups.get(`label:${action}`) ?? [];
    for (const batch of chunks(labelEntries)) {
      if (objectKind === 'task') {
        const returned =
          action === 'add'
            ? await tx
                .insert(taskLabel)
                .values(
                  batch.map((entry) => ({
                    organizationId: orgId,
                    taskId: entry.objectId,
                    labelId: entry.relatedId,
                  })),
                )
                .onConflictDoNothing()
                .returning({ objectId: taskLabel.taskId, relatedId: taskLabel.labelId })
            : await tx
                .delete(taskLabel)
                .where(
                  and(
                    eq(taskLabel.organizationId, orgId),
                    or(
                      ...batch.map((entry) =>
                        and(
                          eq(taskLabel.taskId, entry.objectId),
                          eq(taskLabel.labelId, entry.relatedId),
                        ),
                      ),
                    ),
                  ),
                )
                .returning({ objectId: taskLabel.taskId, relatedId: taskLabel.labelId });
        finish(batch, new Set(returned.map((row) => `label:${row.objectId}:${row.relatedId}`)));
      } else {
        const returned =
          action === 'add'
            ? await tx
                .insert(projectLabel)
                .values(
                  batch.map((entry) => ({
                    organizationId: orgId,
                    projectId: entry.objectId,
                    labelId: entry.relatedId,
                  })),
                )
                .onConflictDoNothing()
                .returning({ objectId: projectLabel.projectId, relatedId: projectLabel.labelId })
            : await tx
                .delete(projectLabel)
                .where(
                  and(
                    eq(projectLabel.organizationId, orgId),
                    or(
                      ...batch.map((entry) =>
                        and(
                          eq(projectLabel.projectId, entry.objectId),
                          eq(projectLabel.labelId, entry.relatedId),
                        ),
                      ),
                    ),
                  ),
                )
                .returning({ objectId: projectLabel.projectId, relatedId: projectLabel.labelId });
        finish(batch, new Set(returned.map((row) => `label:${row.objectId}:${row.relatedId}`)));
      }
    }

    const initiativeEntries = groups.get(`initiative:${action}`) ?? [];
    for (const batch of chunks(initiativeEntries)) {
      const returned =
        action === 'add'
          ? await tx
              .insert(initiativeProject)
              .values(
                batch.map((entry) => ({
                  organizationId: orgId,
                  projectId: entry.objectId,
                  initiativeId: entry.relatedId,
                })),
              )
              .onConflictDoNothing()
              .returning({
                objectId: initiativeProject.projectId,
                relatedId: initiativeProject.initiativeId,
              })
          : await tx
              .delete(initiativeProject)
              .where(
                and(
                  eq(initiativeProject.organizationId, orgId),
                  or(
                    ...batch.map((entry) =>
                      and(
                        eq(initiativeProject.projectId, entry.objectId),
                        eq(initiativeProject.initiativeId, entry.relatedId),
                      ),
                    ),
                  ),
                ),
              )
              .returning({
                objectId: initiativeProject.projectId,
                relatedId: initiativeProject.initiativeId,
              });
      finish(batch, new Set(returned.map((row) => `initiative:${row.objectId}:${row.relatedId}`)));
    }

    const dependencyEntries = groups.get(`dependency:${action}`) ?? [];
    const validDependencyEntries: ObjectCommandRelationReceiptEntry[] = [];
    for (const entry of dependencyEntries) {
      if (
        action === 'add' &&
        (objectKind === 'task'
          ? await taskCycleWouldClose(tx, orgId, entry.objectId, entry.relatedId)
          : await projectCycleWouldClose(tx, orgId, entry.objectId, entry.relatedId))
      ) {
        conflicting.add(entry.objectId);
      } else {
        validDependencyEntries.push(entry);
      }
    }
    for (const batch of chunks(validDependencyEntries)) {
      if (objectKind === 'task') {
        const returned =
          action === 'add'
            ? await tx
                .insert(taskDependency)
                .values(
                  batch.map((entry) => ({
                    organizationId: orgId,
                    blockingTaskId: entry.objectId,
                    blockedTaskId: entry.relatedId,
                  })),
                )
                .onConflictDoNothing()
                .returning({
                  objectId: taskDependency.blockingTaskId,
                  relatedId: taskDependency.blockedTaskId,
                })
            : await tx
                .delete(taskDependency)
                .where(
                  and(
                    eq(taskDependency.organizationId, orgId),
                    or(
                      ...batch.map((entry) =>
                        and(
                          eq(taskDependency.blockingTaskId, entry.objectId),
                          eq(taskDependency.blockedTaskId, entry.relatedId),
                        ),
                      ),
                    ),
                  ),
                )
                .returning({
                  objectId: taskDependency.blockingTaskId,
                  relatedId: taskDependency.blockedTaskId,
                });
        finish(
          batch,
          new Set(returned.map((row) => `dependency:${row.objectId}:${row.relatedId}`)),
        );
      } else {
        const returned =
          action === 'add'
            ? await tx
                .insert(projectDependency)
                .values(
                  batch.map((entry) => ({
                    organizationId: orgId,
                    blockingProjectId: entry.objectId,
                    blockedProjectId: entry.relatedId,
                  })),
                )
                .onConflictDoNothing()
                .returning({
                  objectId: projectDependency.blockingProjectId,
                  relatedId: projectDependency.blockedProjectId,
                })
            : await tx
                .delete(projectDependency)
                .where(
                  and(
                    eq(projectDependency.organizationId, orgId),
                    or(
                      ...batch.map((entry) =>
                        and(
                          eq(projectDependency.blockingProjectId, entry.objectId),
                          eq(projectDependency.blockedProjectId, entry.relatedId),
                        ),
                      ),
                    ),
                  ),
                )
                .returning({
                  objectId: projectDependency.blockingProjectId,
                  relatedId: projectDependency.blockedProjectId,
                });
        finish(
          batch,
          new Set(returned.map((row) => `dependency:${row.objectId}:${row.relatedId}`)),
        );
      }
    }
  }
  return entries.filter((entry) => successfulKeys.has(replayRelationKey(entry)));
}

async function assertReplayObjectTarget(
  database: Dbh,
  orgId: string,
  actorId: string,
  kind: 'task' | 'project',
  property: string,
  target: ObjectCommandValue,
  row: Record<string, unknown>,
): Promise<void> {
  if (target === null) return;
  if (kind === 'task') {
    if (property === 'assigneeId') await assertActiveTaskAssignee(database, orgId, String(target));
    if (property === 'projectId') {
      await assertActiveProject(database, orgId, String(target));
    }
    if (property === 'programId') {
      await assertReference(database, program, orgId, String(target), 'Program not found');
    }
    if (property === 'cycleId')
      await assertReference(database, cycle, orgId, String(target), 'Cycle not found');
    if (property === 'milestoneId')
      await assertMilestoneForProject(database, orgId, String(target), String(row['projectId']));
    if (property === 'parentTaskId') {
      const rows = await database
        .select({ id: task.id })
        .from(task)
        .where(
          and(eq(task.id, String(target)), eq(task.organizationId, orgId), isNull(task.archivedAt)),
        )
        .limit(1);
      if (!rows[0]) throw new NotFoundError('Task not found');
    }
  } else {
    if (property === 'leadId') await assertActiveHumanProjectLead(database, orgId, String(target));
    if (property === 'teamId') {
      await assertReference(database, team, orgId, String(target), 'Team not found');
    }
    if (property === 'programId') {
      await assertReference(database, program, orgId, String(target), 'Program not found');
    }
  }
  const requirement = replayReferenceRequirement(kind, property, target);
  if (requirement !== null) {
    await assertResourceCapability(
      database,
      orgId,
      actorId,
      requirement.kind,
      requirement.id,
      requirement.capability,
    );
  }
}

async function checkReplayAccess(
  orgId: string,
  actorId: string,
  direction: 'undo' | 'redo',
  receipt: ObjectCommandReceipt,
): Promise<z.input<typeof ObjectCommandReplayAccessResult>> {
  validateReplayReceipt(receipt);
  await assertReceiptMatchesDurableChange(db, orgId, actorId, receipt);
  const requiredByTarget = replayRequirements(receipt, direction);
  const capabilityByTarget = await replayCapabilityByTarget(db, orgId, actorId, requiredByTarget);
  const deniedIds = [
    ...new Set(
      [...requiredByTarget.values()]
        .filter(({ kind, id }) => !capabilityByTarget.get(replayRequirementKey(kind, id))?.allow)
        .map(({ id }) => id),
    ),
  ];
  return { allowed: deniedIds.length === 0, deniedIds };
}

async function executeReplay(
  orgId: string,
  actorId: string,
  request: Extract<ObjectCommandRequestValue, { direction: string }>,
  idempotencyClaim?: IdempotencyClaim,
): Promise<CommandExecution> {
  const { receipt, direction } = request;
  validateReplayReceipt(receipt);
  const requiredByTarget = replayRequirements(receipt, direction);
  const apply = async (tx: Tx): Promise<CommandExecution> => {
    const effects: CommandEffects = {
      taskStateMutations: [],
      taskFieldChanges: [],
      projectStatusRows: [],
    };
    await assertReceiptMatchesDurableChange(tx, orgId, actorId, receipt);
    const successful: CommandEntry[] = [];
    const conflicting = new Set<string>();
    const denied = new Set<string>();
    const entriesByObject = new Map<string, CommandEntry[]>();
    const relationEntriesToApply: ObjectCommandRelationReceiptEntry[] = [];
    const changedTasks: {
      before: typeof task.$inferSelect;
      after: typeof task.$inferSelect;
    }[] = [];
    for (const entry of receipt.entries) {
      entriesByObject.set(entry.objectId, [...(entriesByObject.get(entry.objectId) ?? []), entry]);
    }
    const receiptObjectIds = new Set(entriesByObject.keys());
    for (const entry of receipt.entries) {
      if (entry.kind === 'relation' && entry.relation === 'dependency') {
        receiptObjectIds.add(entry.relatedId);
      }
    }
    const table = receipt.objectKind === 'task' ? task : project;
    const lockedRows = await tx
      .select()
      .from(table)
      .where(and(eq(table.organizationId, orgId), inArray(table.id, [...receiptObjectIds])))
      .for('update');
    const lockedById = new Map(lockedRows.map((row) => [row.id, row as Record<string, unknown>]));
    const capabilityByTarget = await replayCapabilityByTarget(tx, orgId, actorId, requiredByTarget);
    if ([...capabilityByTarget.values()].some((result) => result.allow)) {
      await assertSharedWorkWritable(orgId, undefined, tx);
    }
    const relationEntries = receipt.entries.filter(
      (entry): entry is ObjectCommandRelationReceiptEntry => entry.kind === 'relation',
    );
    const relationFacts = await loadReplayRelationFacts(
      tx,
      orgId,
      receipt.objectKind,
      relationEntries,
    );
    const taskStatusCache = new Map<string, Awaited<ReturnType<typeof resolveTaskStatus>>>();
    const projectStatusCache = new Map<
      string,
      Awaited<ReturnType<typeof resolveContainerStatus>>
    >();

    // Preflight every entry for an object before changing any of them. A composite timeframe emits
    // two receipt entries, and undo must skip both when a collaborator changed either half.
    for (const [objectId, entries] of entriesByObject) {
      const row = lockedById.get(objectId);
      if (!row) {
        denied.add(objectId);
        continue;
      }
      if (!capabilityByTarget.get(replayRequirementKey(receipt.objectKind, objectId))?.allow) {
        denied.add(objectId);
        continue;
      }
      if (
        row['archivedAt'] !== null &&
        entries.some((entry) => entry.kind !== 'object' || entry.property !== 'archivedAt')
      ) {
        denied.add(objectId);
        continue;
      }
      for (const entry of entries) {
        validateReceiptEntryShape(receipt, entry);
        const expected = direction === 'undo' ? entry.after : entry.before;
        const target = direction === 'undo' ? entry.before : entry.after;
        if (entry.kind === 'object') {
          if (normalizeProperty(entry.property, row[entry.property]) !== expected) {
            conflicting.add(objectId);
            break;
          }
          try {
            await assertReplayObjectTarget(
              tx,
              orgId,
              actorId,
              receipt.objectKind,
              entry.property,
              target,
              row,
            );
          } catch (error) {
            if (error instanceof CapabilityError || error instanceof NotFoundError) {
              denied.add(objectId);
              break;
            }
            throw error;
          }
        } else {
          if (entry.relation === 'dependency') {
            const related = lockedById.get(entry.relatedId);
            if (
              related?.['archivedAt'] !== null ||
              !capabilityByTarget.get(replayRequirementKey(receipt.objectKind, entry.relatedId))
                ?.allow
            ) {
              denied.add(objectId);
              break;
            }
          } else if (!relationFacts.targetIds.has(`${entry.relation}:${entry.relatedId}`)) {
            denied.add(objectId);
            break;
          }
          if (relationFacts.existing.has(replayRelationKey(entry)) !== expected) {
            conflicting.add(objectId);
            break;
          }
        }
      }
      if (conflicting.has(objectId) || denied.has(objectId)) continue;
      const targetFor = (property: string): ObjectCommandValue | undefined => {
        const entry = entries.find(
          (candidate) => candidate.kind === 'object' && candidate.property === property,
        );
        if (entry?.kind !== 'object') return undefined;
        return direction === 'undo' ? entry.before : entry.after;
      };
      const hasTarget = (property: string): boolean =>
        entries.some((entry) => entry.kind === 'object' && entry.property === property);
      if (receipt.objectKind === 'task' && targetFor('state') !== undefined) {
        const cacheKey = `${String(row['teamId'])}:${String(targetFor('state'))}`;
        let status = taskStatusCache.get(cacheKey);
        if (!status) {
          status = await resolveTaskStatus(
            orgId,
            String(row['teamId']),
            String(targetFor('state')),
            'state',
            tx,
          );
          taskStatusCache.set(cacheKey, status);
        }
        if (
          targetFor('state') !== status.state ||
          targetFor('statusId') !== status.statusId ||
          (targetFor('completedAt') === null) !== (status.completedAt === null) ||
          (targetFor('canceledAt') === null) !== (status.canceledAt === null)
        ) {
          throw ownedValidation('Receipt contains an invalid Task status transition');
        }
      }
      if (receipt.objectKind === 'project' && targetFor('status') !== undefined) {
        const cacheKey = String(targetFor('status'));
        let status = projectStatusCache.get(cacheKey);
        if (!status) {
          status = await resolveContainerStatus(orgId, 'project', cacheKey, 'status', tx);
          projectStatusCache.set(cacheKey, status);
        }
        if (targetFor('status') !== status.status || targetFor('statusId') !== status.statusId) {
          throw ownedValidation('Receipt contains an invalid Project status transition');
        }
      }
      if (receipt.objectKind === 'task') {
        const nextProject = hasTarget('projectId') ? targetFor('projectId') : row['projectId'];
        const nextMilestone = hasTarget('milestoneId')
          ? targetFor('milestoneId')
          : row['milestoneId'];
        await assertMilestoneForProject(
          tx,
          orgId,
          receiptId(nextMilestone, 'milestone reference'),
          receiptId(nextProject, 'Project reference'),
        );
        const nextStart = hasTarget('startDate')
          ? targetFor('startDate')
          : normalizeProperty('startDate', row['startDate']);
        const nextDue = hasTarget('dueDate')
          ? targetFor('dueDate')
          : normalizeProperty('dueDate', row['dueDate']);
        if (typeof nextStart === 'string' && typeof nextDue === 'string' && nextDue < nextStart) {
          conflicting.add(objectId);
          continue;
        }
        const parent = targetFor('parentTaskId');
        if (typeof parent === 'string') {
          if (parent === objectId) throw ownedValidation('A task cannot be its own parent');
          if (await taskParentWouldCycle(tx, orgId, objectId, parent)) {
            conflicting.add(objectId);
            continue;
          }
        }
      } else {
        const nextStart = hasTarget('startDate')
          ? targetFor('startDate')
          : normalize(row['startDate']);
        const nextTarget = hasTarget('targetDate')
          ? targetFor('targetDate')
          : normalize(row['targetDate']);
        try {
          assertPlanningDateRange(
            nextStart === null ? null : new Date(String(nextStart)),
            nextTarget === null ? null : new Date(String(nextTarget)),
          );
        } catch {
          conflicting.add(objectId);
          continue;
        }
      }
      const labelEntries = entries.filter(
        (entry): entry is ObjectCommandRelationReceiptEntry =>
          entry.kind === 'relation' && entry.relation === 'label',
      );
      const replayAddsLabel = labelEntries.some((entry) =>
        direction === 'undo' ? entry.before : entry.after,
      );
      if (labelEntries.length > 0 && replayAddsLabel) {
        const targetIds = new Set(relationFacts.attachedLabelIdsByObject.get(objectId) ?? []);
        for (const entry of labelEntries) {
          const target = direction === 'undo' ? entry.before : entry.after;
          if (target) targetIds.add(entry.relatedId);
          else targetIds.delete(entry.relatedId);
        }
        const teamId = receiptId(row['teamId'], 'Team reference');
        const resolved = [...targetIds].map((id) => relationFacts.labelsById.get(id));
        if (
          resolved.some(
            (item) => item === undefined || (item.teamId !== null && item.teamId !== teamId),
          )
        ) {
          denied.add(objectId);
          continue;
        }
        if (
          applyExclusivity(
            resolved.filter((item): item is NonNullable<typeof item> => item !== undefined),
          ).length !== targetIds.size
        ) {
          conflicting.add(objectId);
          continue;
        }
      }
    }
    const tupleProperties =
      receipt.objectKind === 'task'
        ? new Set(['state', 'statusId', 'completedAt', 'canceledAt'])
        : new Set(['status', 'statusId']);
    const tupleEntries = new Set<CommandEntry>();
    const tupleUpdates: { id: string; patch: Record<string, unknown> }[] = [];
    for (const [objectId, entries] of entriesByObject) {
      if (conflicting.has(objectId) || denied.has(objectId)) continue;
      const tuple = entries.filter(
        (entry) => entry.kind === 'object' && tupleProperties.has(entry.property),
      );
      if (tuple.length === 0) continue;
      tupleUpdates.push({
        id: objectId,
        patch: Object.fromEntries(
          tuple.map((entry) => {
            if (entry.kind !== 'object') throw ownedValidation('Invalid status tuple');
            const target = direction === 'undo' ? entry.before : entry.after;
            return [entry.property, target];
          }),
        ),
      });
      for (const entry of tuple) tupleEntries.add(entry);
    }
    const tupleRows = await updateReplayObjects(tx, orgId, receipt.objectKind, tupleUpdates);
    const tupleRowsById = new Map(tupleRows.map((row) => [row.id, row]));
    for (const update of tupleUpdates) {
      const updated = tupleRowsById.get(update.id);
      const before = lockedById.get(update.id);
      if (!updated || !before) {
        conflicting.add(update.id);
        continue;
      }
      if (receipt.objectKind === 'task') {
        effects.taskStateMutations.push({
          before: before as typeof task.$inferSelect,
          after: updated as typeof task.$inferSelect,
        });
      } else {
        effects.projectStatusRows.push(updated as typeof project.$inferSelect);
      }
      successful.push(
        ...(entriesByObject.get(update.id) ?? []).filter((entry) => tupleEntries.has(entry)),
      );
    }

    const objectUpdates: { id: string; patch: Record<string, unknown> }[] = [];
    for (const [objectId, entries] of entriesByObject) {
      if (conflicting.has(objectId) || denied.has(objectId)) continue;
      const objectEntries = entries.filter(
        (entry) => entry.kind === 'object' && !tupleEntries.has(entry),
      );
      if (objectEntries.length === 0) continue;
      objectUpdates.push({
        id: objectId,
        patch: Object.fromEntries(
          objectEntries.map((entry) => {
            if (entry.kind !== 'object') throw ownedValidation('Invalid object receipt entry');
            return [entry.property, direction === 'undo' ? entry.before : entry.after];
          }),
        ),
      });
    }
    const objectRows = await updateReplayObjects(tx, orgId, receipt.objectKind, objectUpdates);
    const objectRowsById = new Map(objectRows.map((row) => [row.id, row]));
    for (const update of objectUpdates) {
      const updated = objectRowsById.get(update.id);
      const before = lockedById.get(update.id);
      if (!updated || !before) {
        conflicting.add(update.id);
        continue;
      }
      if (receipt.objectKind === 'task') {
        changedTasks.push({
          before: before as typeof task.$inferSelect,
          after: updated as typeof task.$inferSelect,
        });
      }
      successful.push(
        ...(entriesByObject.get(update.id) ?? []).filter(
          (entry) => entry.kind === 'object' && !tupleEntries.has(entry),
        ),
      );
    }
    relationEntriesToApply.push(
      ...receipt.entries.filter(
        (entry): entry is ObjectCommandRelationReceiptEntry =>
          entry.kind === 'relation' &&
          !conflicting.has(entry.objectId) &&
          !denied.has(entry.objectId),
      ),
    );
    successful.push(
      ...(await applyReplayRelationEntries(
        tx,
        orgId,
        receipt.objectKind,
        direction,
        relationEntriesToApply,
        conflicting,
      )),
    );
    const auditedTasks = [...effects.taskStateMutations, ...changedTasks];
    const resolvedChanges = await resolveTaskChangeLabelGroups(
      orgId,
      auditedTasks.map(({ before, after }) => diffTaskFields(before, after)),
      tx,
    );
    const taskConsequences = auditedTasks.map(({ before, after }, index) => ({
      organizationId: orgId,
      taskId: after.id,
      title: after.title,
      actorId,
      changes: resolvedChanges[index] ?? [],
      assignmentChanged: before.assigneeId !== after.assigneeId && after.assigneeId !== null,
    }));
    await writeTaskChangeGroups(tx, taskConsequences);
    effects.taskFieldChanges.push(...taskConsequences);
    const appliedIds = [...new Set(successful.map((entry) => entry.objectId))];
    const result: z.input<typeof ObjectCommandResult> = {
      appliedIds,
      conflictingIds: [...conflicting],
      deniedIds: [...denied],
      receipt: { ...receipt, entries: successful },
    };
    const execution = { effects, result };
    await enqueueObjectCommandEffectJob(tx, {
      version: 1,
      organizationId: orgId,
      actorId,
      commandId: request.commandId,
      occurredAt: new Date().toISOString(),
      effects: objectCommandEffects(request, execution),
    });
    if (idempotencyClaim) {
      await completeIdempotencyInTransaction(tx, idempotencyClaim, {
        organizationId: orgId,
        responseStatus: 200,
        responseBody: result,
      });
    }
    return execution;
  };
  return serializableTx(apply);
}

/** POST endpoints for replay access checks and transactional object commands. */
const objectCommands = new Hono<AppEnv>()
  .post(
    '/replay-access',
    bodyLimit({
      maxSize: MAX_OBJECT_COMMAND_BYTES,
      onError: () => {
        throw new PayloadTooLargeError(MAX_OBJECT_COMMAND_BYTES);
      },
    }),
    apiDoc({
      tag: 'Objects',
      summary: 'Check current access to replay an object command',
      response: ObjectCommandReplayAccessResult,
    }),
    zJson(ObjectCommandReplayAccessIn),
    async (c) => {
      const { direction, receipt } = c.req.valid('json');
      const { orgId, actorId } = c.get('actorCtx');
      return ok(
        c,
        ObjectCommandReplayAccessResult,
        await checkReplayAccess(orgId, actorId, direction, receipt),
      );
    },
  )
  .post(
    '/',
    bodyLimit({
      maxSize: MAX_OBJECT_COMMAND_BYTES,
      onError: () => {
        throw new PayloadTooLargeError(MAX_OBJECT_COMMAND_BYTES);
      },
    }),
    apiDoc({
      tag: 'Objects',
      summary: 'Apply, undo, or redo an object command',
      response: ObjectCommandResult,
    }),
    zJson(ObjectCommandRequest),
    async (c) => {
      const request = c.req.valid('json');
      const key = c.req.header('Idempotency-Key');
      if (key !== request.commandId)
        throw ownedValidation('Idempotency-Key must match commandId', ['commandId']);
      const { orgId, actorId } = c.get('actorCtx');
      const idempotencyClaim = c.get('idempotencyClaim');
      const execution =
        'direction' in request
          ? await executeReplay(orgId, actorId, request, idempotencyClaim)
          : await executeForward(orgId, actorId, request, idempotencyClaim);
      if (idempotencyClaim) c.set('idempotencyCompleted', true);
      scheduleCommandEffects();
      return ok(c, ObjectCommandResult, execution.result);
    },
  );

export default objectCommands;
