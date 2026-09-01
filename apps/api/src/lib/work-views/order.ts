import type { Database, db } from '@docket/db';
import { initiative, program, project, projectTeam, task, workItemOrder } from '@docket/db';
import { satisfies, type Capability } from '@docket/authz';
import {
  FractionalRank,
  WorkViewOrderResponse,
  type WorkViewOrderRequest,
  type WorkViewOrderResponse as WorkViewOrderResponseValue,
} from '@docket/work/work-view-contract';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { ApiError, CapabilityError, NotFoundError } from '../../error';
import { labelsForSubject, replaceLabels, resolveLabelSet } from '../labels';
import { rawResultRows } from '../raw-result';
import { diffTaskFields, recordTaskChanges, resolveTaskChangeLabels } from '../task-audit';
import {
  applySubtaskCompletionPolicy,
  finishTaskStateTransition,
  writeTaskStateTransition,
} from '../task-state';
import {
  landingStatus,
  resolveContainerStatus,
  resolveTaskStatus,
  terminalStampsFor,
} from '../work-status';
import { enqueueSearchUpsert } from '../../search/write-through';
import { emitEvent } from '../../routes/event-emit';
import { assertMilestoneInOrg, assertTaskCapability, loadTask } from '../../routes/task-helpers';
import { compileAuthorizationSql } from './authorization-sql';
import { compileRosterCtes } from './context-sql';
import { compileProjectTeamMembershipSql } from './project-team-sql';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const REBALANCE_HALF_WINDOWS = [16, 32, 64] as const;
const callerRow = z.object({ user_id: z.string().nullable() }).loose();
const countRow = z.object({ count: z.number().int().nonnegative() }).loose();
type WorkViewTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type AfterCommit = () => Promise<void>;
const noAfterCommit: AfterCommit = async () => undefined;

async function executeOne<TSchema extends z.ZodType>(
  database: Database | WorkViewTransaction,
  statement: ReturnType<typeof sql>,
  schema: TSchema,
): Promise<z.output<TSchema>> {
  const rows = await executeRows(database, statement, schema);
  const row = rows[0];
  if (!row) throw new TypeError('A work-view order query returned no row.');
  return row;
}

async function executeRows<TSchema extends z.ZodType>(
  database: Database | WorkViewTransaction,
  statement: ReturnType<typeof sql>,
  schema: TSchema,
): Promise<z.output<TSchema>[]> {
  const result: unknown = await database.execute(statement);
  return z.array(schema).parse(rawResultRows<unknown>(result));
}

function contextId(context: WorkViewOrderRequest['context'], organizationId: string): string {
  switch (context.kind) {
    case 'organization':
      return organizationId;
    case 'team':
      return context.teamId;
    case 'project':
      return context.projectId;
    case 'program':
      return context.programId;
    case 'initiative':
      return context.initiativeId;
  }
}

function betweenRanks(lower: string | null, upper: string | null): string {
  if (lower === null && upper === null) return 'V';
  if (upper === null) return `${lower}V`;
  if (lower === null) {
    if (upper.length > 1) return upper.slice(0, -1).replace(/\.$/, '');
    const upperIndex = ALPHABET.indexOf(upper);
    if (upperIndex > 0) return ALPHABET[Math.floor(upperIndex / 2)] ?? '0';
    throw new TypeError('The first stored rank has no predecessor.');
  }
  if (lower >= upper) throw new TypeError('Order neighbors are reversed.');
  let index = 0;
  while (lower[index] === upper[index] && index < lower.length && index < upper.length) {
    index += 1;
  }
  const prefix = lower.slice(0, index);
  const low = index < lower.length ? ALPHABET.indexOf(lower[index] ?? '') : -1;
  const high = index < upper.length ? ALPHABET.indexOf(upper[index] ?? '') : ALPHABET.length;
  if (low < -1 || high < 0) throw new TypeError('Stored ranks use an unsupported alphabet.');
  if (high - low > 1) {
    return `${prefix}${ALPHABET[Math.floor((low + high) / 2)] ?? 'V'}`;
  }
  const candidate = `${lower}V`;
  if (candidate < upper) return candidate;
  const dotted = `${lower}.V`;
  if (dotted < upper) return dotted;
  throw new TypeError('Stored ranks need bounded rebalancing.');
}

async function assertVisibleInContext(input: ReorderWorkViewInput): Promise<void> {
  const uniqueItemIds = [
    input.request.itemId,
    ...(input.request.beforeId === null ? [] : [input.request.beforeId]),
    ...(input.request.afterId === null ? [] : [input.request.afterId]),
  ].filter((itemId, index, itemIds) => itemIds.indexOf(itemId) === index);
  const caller = await executeOne(
    input.database,
    sql`select user_id from actor where id=${input.actorId}
      and organization_id=${input.organizationId} and kind='human'
      and status='active' and archived_at is null`,
    callerRow,
  );
  if (input.request.target === 'initiative') {
    const context = input.request.context;
    const contextScope =
      context.kind === 'organization'
        ? sql`e.organization_id=${input.organizationId}`
        : (() => {
            const rootId = context.initiativeId;
            const rootAuthorized = sql`exists (
              select 1 from initiative e where e.id=${rootId}
                and ${compileAuthorizationSql(
                  'initiative',
                  input.organizationId,
                  input.actorId,
                  caller.user_id,
                )}
            )`;
            return sql`(e.id=${rootId} or (${rootAuthorized} and exists (
              with recursive ancestors(id) as (
                select e.id
                union
                select edge.parent_initiative_id
                from initiative_hierarchy_link edge
                join ancestors child on child.id=edge.child_initiative_id
                where edge.context_organization_id=${input.organizationId}
              )
              select 1 from ancestors where id=${rootId}
            )))`;
          })();
    const found = await executeOne(
      input.database,
      sql`select count(distinct e.id)::int count from initiative e
        where e.id in (${sql.join(
          uniqueItemIds.map((itemId) => sql`${itemId}`),
          sql`, `,
        )})
        and ${compileAuthorizationSql(
          'initiative',
          input.organizationId,
          input.actorId,
          caller.user_id,
        )}
        and ${contextScope}`,
      countRow,
    );
    if (found.count !== uniqueItemIds.length) throw new NotFoundError('Work item not found');
    return;
  }
  const ctes = compileRosterCtes(
    input.request.target,
    input.request.context,
    input.organizationId,
    input.actorId,
    caller.user_id,
    sql`e.id in (${sql.join(
      uniqueItemIds.map((itemId) => sql`${itemId}`),
      sql`, `,
    )})`,
    sql`e.id in (${sql.join(
      uniqueItemIds.map((itemId) => sql`${itemId}`),
      sql`, `,
    )})`,
  );
  const found = await executeOne(
    input.database,
    sql`with recursive ${ctes} select count(*)::int count from matched`,
    countRow,
  );
  if (found.count !== uniqueItemIds.length) throw new NotFoundError('Work item not found');
}

async function assertReference(
  database: WorkViewTransaction,
  tableName: string,
  organizationId: string,
  id: string,
  message: string,
): Promise<void> {
  const found = await executeOne(
    database,
    sql`select count(*)::int count from ${sql.raw(tableName)}
      where id=${id} and organization_id=${organizationId}`,
    countRow,
  );
  if (found.count !== 1) throw new NotFoundError(message);
}

async function replaceOneLabel(
  tx: WorkViewTransaction,
  target: WorkViewOrderRequest['target'],
  itemId: string,
  organizationId: string,
  sourceLabelId: string | null,
  destinationLabelId: string | null,
): Promise<void> {
  const existing = await labelsForSubject(target, organizationId, itemId, tx);
  let teamIds: readonly string[] = [];
  if (target === 'task') {
    const owner = await executeOne(
      tx,
      sql`select (select owned_team.id from task subject
          join team owned_team on owned_team.id=subject.team_id
            and owned_team.organization_id=subject.organization_id
          where subject.id=${itemId} and subject.organization_id=${organizationId}) id`,
      z.object({ id: z.string().nullable() }).loose(),
    );
    teamIds = owner.id ? [owner.id] : [];
  } else if (target === 'project') {
    const memberships = await executeRows(
      tx,
      sql`select project_teams.team_id from project e
        cross join lateral (${compileProjectTeamMembershipSql(
          sql`e.id`,
          sql`e.organization_id`,
          sql`e.team_id`,
        )}) project_teams
        where e.id=${itemId} and e.organization_id=${organizationId}`,
      z.object({ team_id: z.string() }).loose(),
    );
    teamIds = memberships.map((membership) => membership.team_id);
  }
  const retained = existing
    .map((label) => label.id)
    .filter((labelId) => labelId !== sourceLabelId && labelId !== destinationLabelId);
  const next = await resolveLabelSet(
    organizationId,
    [...retained, ...(destinationLabelId === null ? [] : [destinationLabelId])],
    { teamIds, dbh: tx },
  );
  await replaceLabels(tx, target, itemId, organizationId, next);
}

function stringValue(value: unknown, field: string): string {
  if (typeof value === 'string') return value;
  throw new TypeError(`Mutable group ${field} requires a string value.`);
}

function nullableStringValue(value: unknown, field: string): string | null {
  return value === null ? null : stringValue(value, field);
}

async function mutateGroup(
  tx: WorkViewTransaction,
  input: ReorderWorkViewInput,
): Promise<AfterCommit> {
  const { request, organizationId, actorId } = input;
  if (request.groupField === null) return noAfterCommit;
  if (request.target === 'initiative') {
    const owned = await executeOne(
      tx,
      sql`select count(*)::int count from initiative
        where id=${request.itemId} and organization_id=${organizationId}`,
      countRow,
    );
    if (owned.count !== 1) throw new NotFoundError('Work item not found');
  }
  const value = request.groupValue;
  if (request.groupField === 'labels') {
    await replaceOneLabel(
      tx,
      request.target,
      request.itemId,
      organizationId,
      nullableStringValue(request.sourceGroupValue, 'labels'),
      nullableStringValue(value, 'labels'),
    );
    return () => enqueueSearchUpsert(organizationId, request.target, request.itemId);
  }
  if (request.groupField === 'status') {
    if (request.target === 'task') {
      const before = (
        await tx
          .select()
          .from(task)
          .where(
            and(
              eq(task.id, request.itemId),
              eq(task.organizationId, organizationId),
              isNull(task.archivedAt),
            ),
          )
          .limit(1)
      )[0];
      if (!before) throw new NotFoundError('Work item not found');
      const transition = await resolveTaskStatus(
        organizationId,
        before.teamId,
        stringValue(value, 'status'),
        'status',
        tx,
      );
      const mutation = await writeTaskStateTransition(tx, {
        before,
        statusId: transition.statusId,
        state: transition.state,
        completedAt: transition.completedAt,
        canceledAt: transition.canceledAt,
      });
      if (!mutation) throw new NotFoundError('Work item not found');
      const cascades = await applySubtaskCompletionPolicy(tx, mutation);
      return async () => {
        await finishTaskStateTransition({ actorId }, mutation);
        for (const cascade of cascades) {
          await finishTaskStateTransition({ actorId: null }, cascade);
        }
      };
    }
    const status = await resolveContainerStatus(
      organizationId,
      request.target,
      stringValue(value, 'status'),
      'status',
      tx,
    );
    const table = { project, program, initiative }[request.target];
    const updated = await tx
      .update(table)
      .set({ status: status.status, statusId: status.statusId })
      .where(and(eq(table.id, request.itemId), eq(table.organizationId, organizationId)))
      .returning();
    const changed = updated[0];
    if (!changed) throw new NotFoundError('Work item not found');
    const title = 'name' in changed ? changed.name : request.itemId;
    return async () => {
      await emitEvent({
        organizationId,
        kind: 'status_change',
        actorId,
        title,
        subject: { type: request.target, id: request.itemId, title },
        detail: { schema: 'docket.state_change', fromState: null, toState: status.status },
      });
      await enqueueSearchUpsert(organizationId, request.target, request.itemId);
    };
  }
  const actorValue =
    value === null
      ? null
      : typeof value === 'object' && 'kind' in value
        ? value.kind === 'current-actor'
          ? actorId
          : stringValue(value.actorId, request.groupField)
        : stringValue(value, request.groupField);
  if (request.groupField === 'teams') {
    const sourceTeamId = nullableStringValue(request.sourceGroupValue, 'teams');
    const destinationTeamId = nullableStringValue(value, 'teams');
    if (destinationTeamId !== null) {
      await assertReference(tx, 'team', organizationId, destinationTeamId, 'Team not found');
    }
    const current = (
      await tx
        .select({ teamId: project.teamId })
        .from(project)
        .where(and(eq(project.id, request.itemId), eq(project.organizationId, organizationId)))
        .limit(1)
    )[0];
    if (!current) throw new NotFoundError('Work item not found');
    if (sourceTeamId === destinationTeamId) return noAfterCommit;
    if (sourceTeamId !== null) {
      await tx
        .delete(projectTeam)
        .where(
          and(
            eq(projectTeam.organizationId, organizationId),
            eq(projectTeam.projectId, request.itemId),
            eq(projectTeam.teamId, sourceTeamId),
          ),
        );
    }
    if (destinationTeamId !== null) {
      await tx
        .insert(projectTeam)
        .values({
          organizationId,
          projectId: request.itemId,
          teamId: destinationTeamId,
          isPrimary: false,
        })
        .onConflictDoUpdate({
          target: [projectTeam.projectId, projectTeam.teamId],
          set: { isPrimary: false },
        });
    }
    let primaryTeamId =
      current.teamId === null || current.teamId === sourceTeamId
        ? destinationTeamId
        : current.teamId;
    if (primaryTeamId === null) {
      const remaining = (
        await tx
          .select({ teamId: projectTeam.teamId })
          .from(projectTeam)
          .where(
            and(
              eq(projectTeam.organizationId, organizationId),
              eq(projectTeam.projectId, request.itemId),
            ),
          )
          .orderBy(projectTeam.teamId)
          .limit(1)
      )[0];
      primaryTeamId = remaining?.teamId ?? null;
    }
    await tx
      .update(projectTeam)
      .set({ isPrimary: false })
      .where(
        and(
          eq(projectTeam.organizationId, organizationId),
          eq(projectTeam.projectId, request.itemId),
          eq(projectTeam.isPrimary, true),
        ),
      );
    if (primaryTeamId !== null) {
      await tx
        .insert(projectTeam)
        .values({
          organizationId,
          projectId: request.itemId,
          teamId: primaryTeamId,
          isPrimary: true,
        })
        .onConflictDoUpdate({
          target: [projectTeam.projectId, projectTeam.teamId],
          set: { isPrimary: true },
        });
    }
    await tx
      .update(project)
      .set({ teamId: primaryTeamId })
      .where(and(eq(project.id, request.itemId), eq(project.organizationId, organizationId)));
    return () => enqueueSearchUpsert(organizationId, 'project', request.itemId);
  }
  if (request.target === 'task') {
    if (request.groupField === 'team') {
      const teamId = stringValue(actorValue, 'team');
      await assertReference(tx, 'team', organizationId, teamId, 'Team not found');
      const before = (
        await tx
          .select()
          .from(task)
          .where(
            and(
              eq(task.id, request.itemId),
              eq(task.organizationId, organizationId),
              isNull(task.archivedAt),
            ),
          )
          .limit(1)
      )[0];
      if (!before) throw new NotFoundError('Work item not found');
      if (before.teamId === teamId) return noAfterCommit;
      const destination = await landingStatus(organizationId, 'task', teamId, tx);
      const stamps = terminalStampsFor(destination.category);
      await tx
        .update(task)
        .set({ teamId })
        .where(
          and(
            eq(task.id, request.itemId),
            eq(task.organizationId, organizationId),
            isNull(task.archivedAt),
          ),
        );
      const mutation = await writeTaskStateTransition(tx, {
        before,
        statusId: destination.id,
        state: destination.key,
        ...stamps,
      });
      if (!mutation) throw new NotFoundError('Work item not found');
      const cascades = await applySubtaskCompletionPolicy(tx, mutation);
      return async () => {
        await finishTaskStateTransition({ actorId }, mutation);
        for (const cascade of cascades) {
          await finishTaskStateTransition({ actorId: null }, cascade);
        }
      };
    }
    const scalar = {
      priority: { column: 'priority', reference: null, message: '' },
      assignee: { column: 'assigneeId', reference: 'actor', message: 'Assignee not found' },
      delegate: { column: 'delegateId', reference: 'actor', message: 'Delegate not found' },
      project: { column: 'projectId', reference: 'project', message: 'Project not found' },
      program: { column: 'programId', reference: 'program', message: 'Program not found' },
      cycle: { column: 'cycleId', reference: 'cycle', message: 'Cycle not found' },
      milestone: { column: 'milestoneId', reference: 'milestone', message: 'Milestone not found' },
    }[request.groupField];
    const nextValue =
      request.groupField === 'priority'
        ? stringValue(value, 'priority')
        : nullableStringValue(actorValue, request.groupField);
    if (scalar.reference && nextValue !== null) {
      await assertReference(tx, scalar.reference, organizationId, nextValue, scalar.message);
    }
    const before = (
      await tx
        .select()
        .from(task)
        .where(and(eq(task.id, request.itemId), eq(task.organizationId, organizationId)))
        .limit(1)
    )[0];
    if (!before) throw new NotFoundError('Work item not found');
    const after = (
      await tx
        .update(task)
        .set({ [scalar.column]: nextValue })
        .where(and(eq(task.id, request.itemId), eq(task.organizationId, organizationId)))
        .returning()
    )[0];
    if (!after) throw new NotFoundError('Work item not found');
    return async () => {
      if (request.groupField === 'assignee' && nextValue !== null) {
        await emitEvent({
          organizationId,
          kind: 'assignment',
          actorId,
          title: after.title,
          subject: { type: 'task', id: after.id, title: after.title },
        });
      }
      await recordTaskChanges({
        organizationId,
        taskId: after.id,
        title: after.title,
        actorId,
        changes: await resolveTaskChangeLabels(organizationId, diffTaskFields(before, after)),
      });
      await enqueueSearchUpsert(organizationId, 'task', after.id);
    };
  }
  if (request.groupField === 'priority') {
    const table = request.target === 'project' ? project : initiative;
    const updated = await tx
      .update(table)
      .set({ priority: stringValue(value, 'priority') as never })
      .where(and(eq(table.id, request.itemId), eq(table.organizationId, organizationId)))
      .returning({ id: table.id });
    if (!updated[0]) throw new NotFoundError('Work item not found');
    return () => enqueueSearchUpsert(organizationId, request.target, request.itemId);
  }
  const scalar =
    request.groupField === 'lead'
      ? { table: project, column: 'leadId', reference: 'actor', message: 'Lead not found' }
      : request.groupField === 'leadTeam'
        ? { table: initiative, column: 'leadTeamId', reference: 'team', message: 'Team not found' }
        : {
            table: request.target === 'program' ? program : initiative,
            column: 'ownerId',
            reference: 'actor',
            message: 'Owner not found',
          };
  if (actorValue !== null) {
    await assertReference(tx, scalar.reference, organizationId, actorValue, scalar.message);
  }
  const updated = await tx
    .update(scalar.table)
    .set({ [scalar.column]: actorValue })
    .where(
      and(eq(scalar.table.id, request.itemId), eq(scalar.table.organizationId, organizationId)),
    )
    .returning({ id: scalar.table.id });
  if (!updated[0]) throw new NotFoundError('Work item not found');
  return () => enqueueSearchUpsert(organizationId, request.target, request.itemId);
}

async function neighborRank(
  database: WorkViewTransaction,
  input: ReorderWorkViewInput,
  itemId: string | null,
): Promise<string | null> {
  if (itemId === null) return null;
  const contextType = input.request.context.kind;
  const id = contextId(input.request.context, input.organizationId);
  const rows = await database
    .select({ rank: workItemOrder.rank })
    .from(workItemOrder)
    .where(
      and(
        eq(workItemOrder.organizationId, input.organizationId),
        eq(workItemOrder.contextType, contextType),
        eq(workItemOrder.contextId, id),
        eq(workItemOrder.target, input.request.target),
        eq(workItemOrder.itemId, itemId),
      ),
    )
    .limit(1);
  return rows[0]?.rank ?? null;
}

const orderRow = z.object({ item_id: z.string(), rank: FractionalRank }).loose();

function allocateRanks(
  lower: string | null,
  upper: string | null,
  count: number,
): z.output<typeof FractionalRank>[] | null {
  if (count === 0) return [];
  let middle: z.output<typeof FractionalRank>;
  try {
    middle = FractionalRank.parse(betweenRanks(lower, upper));
  } catch {
    return null;
  }
  const leftCount = Math.floor(count / 2);
  const rightCount = count - leftCount - 1;
  const left = allocateRanks(lower, middle, leftCount);
  if (!left) return null;
  const right = allocateRanks(middle, upper, rightCount);
  return right ? [...left, middle, ...right] : null;
}

async function boundedOrderRows(
  tx: WorkViewTransaction,
  input: ReorderWorkViewInput,
  comparator: '<=' | '>=',
  anchor: string,
  limit: number,
): Promise<z.output<typeof orderRow>[]> {
  const contextType = input.request.context.kind;
  const id = contextId(input.request.context, input.organizationId);
  const comparison = comparator === '<=' ? sql`rank <= ${anchor}` : sql`rank >= ${anchor}`;
  const direction = comparator === '<=' ? sql`desc` : sql`asc`;
  return executeRows(
    tx,
    sql`select item_id, rank from work_item_order
      where organization_id=${input.organizationId} and context_type=${contextType}
        and context_id=${id} and target=${input.request.target} and ${comparison}
      order by rank ${direction}, item_id ${direction} limit ${limit}`,
    orderRow,
  );
}

async function writeRanks(
  tx: WorkViewTransaction,
  input: ReorderWorkViewInput,
  rows: readonly { readonly itemId: string; readonly rank: z.output<typeof FractionalRank> }[],
): Promise<void> {
  if (rows.length === 0) return;
  const contextType = input.request.context.kind;
  const id = contextId(input.request.context, input.organizationId);
  await tx
    .insert(workItemOrder)
    .values(
      rows.map((row) => ({
        organizationId: input.organizationId,
        contextType,
        contextId: id,
        target: input.request.target,
        itemId: row.itemId,
        rank: row.rank,
      })),
    )
    .onConflictDoUpdate({
      target: [
        workItemOrder.organizationId,
        workItemOrder.contextType,
        workItemOrder.contextId,
        workItemOrder.target,
        workItemOrder.itemId,
      ],
      set: { rank: sql`excluded.rank`, updatedAt: new Date() },
    });
}

async function rebalanceNeighborhood(
  tx: WorkViewTransaction,
  input: ReorderWorkViewInput,
  after: string | null,
  before: string | null,
  halfWindow: number,
): Promise<boolean> {
  const center = after ?? before;
  if (center === null) return false;
  const [descending, ascending] = await Promise.all([
    boundedOrderRows(tx, input, '<=', after ?? center, halfWindow + 1),
    boundedOrderRows(tx, input, '>=', before ?? center, halfWindow + 1),
  ]);
  const lowerBoundary = descending[halfWindow]?.rank ?? null;
  const upperBoundary = ascending[halfWindow]?.rank ?? null;
  const byItem = new Map<string, z.output<typeof orderRow>>();
  for (const row of [...descending.slice(0, halfWindow), ...ascending.slice(0, halfWindow)]) {
    byItem.set(row.item_id, row);
  }
  const window = [...byItem.values()].sort(
    (left, right) =>
      left.rank.localeCompare(right.rank) || left.item_id.localeCompare(right.item_id),
  );
  const ranks = allocateRanks(lowerBoundary, upperBoundary, window.length);
  if (!ranks) return false;
  await writeRanks(
    tx,
    input,
    window.map((row, index) => {
      const rank = ranks[index];
      if (!rank) throw new TypeError('Bounded rank allocation returned too few positions.');
      return { itemId: row.item_id, rank };
    }),
  );
  return true;
}

async function materializeMissingNeighbors(
  tx: WorkViewTransaction,
  input: ReorderWorkViewInput,
  before: string | null,
  after: string | null,
): Promise<void> {
  const missing = [
    ...(input.request.afterId !== null && after === null ? [input.request.afterId] : []),
    ...(input.request.beforeId !== null && before === null ? [input.request.beforeId] : []),
  ];
  if (missing.length === 0) return;
  if (missing.length === 1) {
    const missingItemId = missing[0];
    if (!missingItemId) throw new TypeError('A missing order neighbor had no item id.');
    let rebalanceAfter = after;
    let rebalanceBefore = before;
    const materializeAdjacent = async (): Promise<boolean> => {
      [before, after] = await Promise.all([
        neighborRank(tx, input, input.request.beforeId),
        neighborRank(tx, input, input.request.afterId),
      ]);
      const contextType = input.request.context.kind;
      const id = contextId(input.request.context, input.organizationId);
      const existing = after ?? before;
      const missingAfter = input.request.afterId !== null && after === null;
      const boundary = await executeRows(
        tx,
        existing === null
          ? sql`select item_id, rank from work_item_order
              where organization_id=${input.organizationId} and context_type=${contextType}
                and context_id=${id} and target=${input.request.target}
              order by rank ${missingAfter ? sql`desc` : sql`asc`},
                item_id ${missingAfter ? sql`desc` : sql`asc`} limit 1`
          : missingAfter
            ? sql`select item_id, rank from work_item_order
              where organization_id=${input.organizationId} and context_type=${contextType}
                and context_id=${id} and target=${input.request.target} and rank < ${existing}
              order by rank desc, item_id desc limit 1`
            : sql`select item_id, rank from work_item_order
              where organization_id=${input.organizationId} and context_type=${contextType}
                and context_id=${id} and target=${input.request.target} and rank > ${existing}
              order by rank asc, item_id asc limit 1`,
        orderRow,
      );
      const lower = missingAfter ? (boundary[0]?.rank ?? null) : existing;
      const upper = missingAfter ? existing : (boundary[0]?.rank ?? null);
      rebalanceAfter = lower;
      rebalanceBefore = upper;
      let rank: z.output<typeof FractionalRank>;
      try {
        rank = FractionalRank.parse(betweenRanks(lower, upper));
      } catch {
        return false;
      }
      await writeRanks(tx, input, [{ itemId: missingItemId, rank }]);
      return true;
    };
    if (await materializeAdjacent()) return;
    for (const halfWindow of REBALANCE_HALF_WINDOWS) {
      if (!(await rebalanceNeighborhood(tx, input, rebalanceAfter, rebalanceBefore, halfWindow))) {
        continue;
      }
      if (await materializeAdjacent()) return;
    }
    throw new ApiError(409, 'conflict', 'The surrounding work order changed; try again');
  }
  const contextType = input.request.context.kind;
  const id = contextId(input.request.context, input.organizationId);
  const append = async (): Promise<{ readonly success: boolean; readonly tail: string | null }> => {
    const tail = await executeRows(
      tx,
      sql`select item_id, rank from work_item_order
        where organization_id=${input.organizationId} and context_type=${contextType}
          and context_id=${id} and target=${input.request.target}
        order by rank desc, item_id desc limit 1`,
      orderRow,
    );
    let lower = tail[0]?.rank ?? null;
    const rows: { itemId: string; rank: z.output<typeof FractionalRank> }[] = [];
    for (const itemId of missing) {
      let candidate: z.output<typeof FractionalRank>;
      try {
        candidate = FractionalRank.parse(betweenRanks(lower, null));
      } catch {
        return { success: false, tail: lower };
      }
      rows.push({ itemId, rank: candidate });
      lower = candidate;
    }
    await writeRanks(tx, input, rows);
    return { success: true, tail: lower };
  };
  let result = await append();
  if (result.success) return;
  for (const halfWindow of REBALANCE_HALF_WINDOWS) {
    if (!(await rebalanceNeighborhood(tx, input, result.tail, null, halfWindow))) continue;
    result = await append();
    if (result.success) return;
  }
  throw new ApiError(409, 'conflict', 'The surrounding work order changed; try again');
}

async function rankForMove(
  tx: WorkViewTransaction,
  input: ReorderWorkViewInput,
): Promise<z.output<typeof FractionalRank>> {
  const unoccupiedRank = async (
    lower: string | null,
    upper: string | null,
  ): Promise<z.output<typeof FractionalRank> | null> => {
    let candidateLower = lower;
    for (let attempt = 0; attempt < 65; attempt += 1) {
      let candidate: z.output<typeof FractionalRank>;
      try {
        candidate = FractionalRank.parse(betweenRanks(candidateLower, upper));
      } catch {
        return null;
      }
      const occupied = await executeOne(
        tx,
        sql`select count(*)::int count from work_item_order
          where organization_id=${input.organizationId}
            and context_type=${input.request.context.kind}
            and context_id=${contextId(input.request.context, input.organizationId)}
            and target=${input.request.target} and rank=${candidate}
            and item_id<>${input.request.itemId}`,
        countRow,
      );
      if (occupied.count === 0) return candidate;
      candidateLower = candidate;
    }
    return null;
  };
  const readNeighbors = () =>
    Promise.all([
      neighborRank(tx, input, input.request.beforeId),
      neighborRank(tx, input, input.request.afterId),
    ]);
  let [before, after] = await readNeighbors();
  const missing =
    (input.request.beforeId !== null && before === null) ||
    (input.request.afterId !== null && after === null);
  if (missing) {
    await materializeMissingNeighbors(tx, input, before, after);
    [before, after] = await readNeighbors();
  }
  const candidate = await unoccupiedRank(after, before);
  if (candidate) return candidate;

  for (const halfWindow of REBALANCE_HALF_WINDOWS) {
    if (!(await rebalanceNeighborhood(tx, input, after, before, halfWindow))) continue;
    [before, after] = await readNeighbors();
    const retry = await unoccupiedRank(after, before);
    if (retry) return retry;
  }
  throw new ApiError(409, 'conflict', 'The surrounding work order changed; try again');
}

/** Inputs for one authorized work-view reorder. */
export interface ReorderWorkViewInput {
  readonly database: Database;
  readonly organizationId: string;
  readonly actorId: string;
  /** Organization capabilities resolved for the current actor. */
  readonly capabilities: readonly string[];
  readonly request: WorkViewOrderRequest;
}

/**
 * Apply a mutable group drop and persist one bounded contextual fractional rank.
 *
 * @param input - Database, authenticated scope, and validated reorder request.
 * @returns The stored rank acknowledgement.
 */
export async function reorderWorkView(
  input: ReorderWorkViewInput,
): Promise<WorkViewOrderResponseValue> {
  if (input.request.target === 'task') {
    const target = await loadTask(input.organizationId, input.request.itemId);
    await assertTaskCapability(input.organizationId, input.actorId, target, 'contribute');
    if (input.request.groupField === 'assignee' || input.request.groupField === 'delegate') {
      await assertTaskCapability(input.organizationId, input.actorId, target, 'assign');
    }
    if (input.request.groupField === 'milestone') {
      await assertMilestoneInOrg(
        input.organizationId,
        nullableStringValue(input.request.groupValue, 'milestone'),
        target.projectId,
      );
    }
  } else if (
    !input.capabilities.some((capability) => satisfies(capability as Capability, 'contribute'))
  ) {
    throw new CapabilityError();
  }
  await assertVisibleInContext(input);
  const committed = await input.database.transaction(async (tx) => {
    const lockKey = [
      input.organizationId,
      input.request.target,
      input.request.context.kind,
      contextId(input.request.context, input.organizationId),
    ].join(':');
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
    const rank = await rankForMove(tx, input);
    const finish = await mutateGroup(tx, input);
    await tx
      .insert(workItemOrder)
      .values({
        organizationId: input.organizationId,
        contextType: input.request.context.kind,
        contextId: contextId(input.request.context, input.organizationId),
        target: input.request.target,
        itemId: input.request.itemId,
        rank,
      })
      .onConflictDoUpdate({
        target: [
          workItemOrder.organizationId,
          workItemOrder.contextType,
          workItemOrder.contextId,
          workItemOrder.target,
          workItemOrder.itemId,
        ],
        set: { rank },
      });
    return { finish, rank };
  });
  await committed.finish();
  return WorkViewOrderResponse.parse({
    target: input.request.target,
    itemId: input.request.itemId,
    rank: committed.rank,
  });
}
